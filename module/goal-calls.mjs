/* Задачи миссии по ходу боя: приоритетная цель выбыла — AWACS сразу говорит, что с задачей.
   «Уничтожить», «Перехватить», «Вывести из строя»: сбита — поражена, сколько осталось; последняя — «Все цели поражены»;
   ушла с поля — цель потеряна. «Защитить», «Сопроводить»: сбита — задача провалена. Итог миссии по-прежнему решает ведущий
   (окно «Итог миссии» после боя с подсказкой по сводке). Говорит главный ведущий, раз на машину за бой. */
import { SYSTEM_ID, TB } from "./config.mjs";

export const KILL = ["destroy", "intercept", "disable"], KEEP = ["protect", "escort"];
const lead = () => !!game.user?.isGM && (game.users?.activeGM?.isSelf ?? true);
const DEAD = () => CONFIG.specialStatusEffects?.DEFEATED ?? "dead";

/** Выбыла ли машина: down — сбита (в этом бою или Doom), retreat — ушла с поля, null — в бою. */
export function outOf(actor, combatId) {
  if (!actor) return "down";
  if (actor.getFlag?.(SYSTEM_ID, "down")?.combat === combatId || actor.system?.markers?.doom || actor.statuses?.has?.(DEAD())) return "down";
  if (actor.statuses?.has?.("retreat")) return "retreat";
  return null;
}

/** Приоритетные цели сцены с задачей: { name, uuid, task, out, hidden }. Скрытые (подкрепление ещё не вышло) не называются. */
export function liveGoals(tokens, combatId) {
  return tokens.filter(t => t.actor?.type === "npc" && t.actor.system?.priority && t.actor.system.task)
    .map(t => ({ name: String(t.getFlag?.(SYSTEM_ID, "radioCall") ?? "") || t.name, uuid: t.actor.uuid, task: t.actor.system.task, out: t.hidden ? null : outOf(t.actor, combatId), hidden: !!t.hidden }));
}

const left = n => (n === 1 ? "осталась одна цель" : n >= 2 && n <= 4 ? `осталось ${n} цели` : `осталось ${n} целей`);

/** Реплика AWACS о выбывшей цели g ({ name, task, out }) при остальных goals: { text, caution } или null. */
export function goalCall(g, goals) {
  if (!g?.out) return null;
  const verb = TB.tasks[g.task] ?? "Задача";
  if (KILL.includes(g.task)) {
    if (g.out === "retreat") return { text: `Цель «${g.name}» уходит из района! Мы её потеряли.`, caution: { title: "MISSION UPDATE", sub: `${verb}: цель ушла` } };
    const kill = goals.filter(x => KILL.includes(x.task)), rest = kill.filter(x => !x.out && !x.hidden).length;
    if (rest) return { text: `Цель «${g.name}» поражена, ${left(rest)}.` };
    // подкрепление с целями ещё не вышло: не выдавать его
    if (kill.some(x => x.hidden)) return { text: `Цель «${g.name}» поражена. Других целей пока не вижу.` };
    const fled = kill.filter(x => x.out === "retreat").length;
    if (fled) return { text: `Цель «${g.name}» поражена. Больше целей в районе нет, ушли: ${fled}.`, caution: { title: "MISSION UPDATE", sub: "Целей в районе нет" }, allDone: true };
    return { text: `Цель «${g.name}» поражена. Все цели поражены!`, caution: { title: "MISSION UPDATE", sub: "Все цели поражены" }, allDone: true };
  }
  if (KEEP.includes(g.task) && g.out === "down")
    return { text: `«${g.name}» потерян! Задача «${verb}» провалена.`, caution: { title: "MISSION UPDATE", sub: `${verb}: «${g.name}» потерян` } };
  return null;
}

const said = new Set();
async function check() {
  const c = game.combat;
  if (!lead() || !c?.started) return;
  const scene = c.scene ?? canvas?.scene;
  const goals = liveGoals([...(scene?.tokens ?? [])], c.id);
  const fresh = goals.filter(g => g.out && !said.has(`${c.id}:${g.uuid}`));
  if (!fresh.length) return;
  const { sendRadio } = await import("./radio.mjs");
  for (const g of fresh) {
    said.add(`${c.id}:${g.uuid}`);
    const call = goalCall(g, goals);
    if (!call) continue;
    await sendRadio(call);
    // лимит времени больше не нужен: задача выполнена раньше срока
    if (call.allDone) await (await import("./downtime.mjs")).stopTimers();
  }
}

export function registerGoalCalls() {
  let timer = null;
  const soon = () => { if (!lead() || !game.combat?.started) return; clearTimeout(timer); timer = setTimeout(() => check().catch(err => console.error(`${SYSTEM_ID} | задачи`, err)), 400); };
  const watched = change => [`flags.${SYSTEM_ID}.down`, "system.markers.doom"].some(p => foundry.utils.hasProperty(change, p));
  Hooks.on("updateActor", (a, change) => { if (watched(change)) soon(); });
  Hooks.on("updateActorDelta", (d, change) => { if (watched(change)) soon(); });
  Hooks.on("createActiveEffect", effect => { if (effect.statuses?.has?.("retreat") || effect.statuses?.has?.(DEAD())) soon(); });
  // уже выбывшие до начала боя не объявляются
  Hooks.on("combatStart", combat => {
    if (!game.user.isGM) return;
    for (const g of liveGoals([...(combat.scene?.tokens ?? [])], combat.id)) if (g.out) said.add(`${combat.id}:${g.uuid}`);
  });
  Hooks.on("deleteCombat", () => said.clear());
}
