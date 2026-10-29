/* События миссии по ходу боя: реплика по радио в начале заданного раунда или когда выбудет машина (сбита, уничтожена,
   ушла с поля). Задаются в Планшете AWACS («События по ходу боя»), импорт миссии кладёт их в сцену (флаг events).
   Каждое звучит раз за бой; что уже прозвучало, помнит бой. Всё делает главный ведущий. */
import { SYSTEM_ID } from "./config.mjs";
import { goneUnit } from "./reinforce.mjs";

const lead = () => !!game.user?.isGM && (game.users?.activeGM?.isSelf ?? true);

/** События сцены: [{ round } | { after, afterName }, speaker, side, text, caution]. */
export const eventsOf = scene => scene?.getFlag?.(SYSTEM_ID, "events") ?? [];

/** Номера событий, которым пора звучать: раунд наступил или машина выбыла; fired — уже прозвучавшие. */
export function dueEvents(events, round, fired = [], gone = goneUnit) {
  const done = new Set(fired);
  return events.map((e, i) => i).filter(i => {
    if (done.has(i)) return false;
    const e = events[i];
    if (Number(e.round) > 0) return round >= Number(e.round);
    return !!e.after && gone(e.after);
  });
}

/** Сыграть события боя, которым пора. */
export async function playEvents(combat) {
  if (!lead() || !combat?.started) return [];
  const scene = combat.scene ?? canvas?.scene;
  const events = eventsOf(scene);
  if (!events.length) return [];
  const fired = combat.getFlag(SYSTEM_ID, "eventsFired") ?? [];
  const due = dueEvents(events, combat.round, fired);
  if (!due.length) return [];
  await combat.setFlag(SYSTEM_ID, "eventsFired", [...fired, ...due]);
  const { sendRadio } = await import("./radio.mjs");
  for (const i of due) {
    const e = events[i];
    await sendRadio({ speaker: e.speaker || "AWACS", text: e.text, side: e.side || "ally", caution: e.caution ? { title: "CAUTION", sub: e.side === "enemy" ? "Перехват переговоров" : "" } : null });
  }
  return due;
}

export function registerMissionEvents() {
  let timer = null;
  const soon = () => {
    if (!lead() || !game.combat?.started) return;
    clearTimeout(timer);
    timer = setTimeout(() => playEvents(game.combat).catch(err => console.error(`${SYSTEM_ID} | события миссии`, err)), 500);
  };
  Hooks.on("updateCombat", (combat, change) => { if ("round" in change && combat.started) soon(); });
  Hooks.on("combatStart", () => soon());
  Hooks.on("updateActor", (a, change) => { if (foundry.utils.hasProperty(change, `flags.${SYSTEM_ID}.down`)) soon(); });
  Hooks.on("updateActorDelta", (d, change) => { if (foundry.utils.hasProperty(change, `flags.${SYSTEM_ID}.down`)) soon(); });
  Hooks.on("createActiveEffect", effect => { if (effect.statuses?.has?.("retreat")) soon(); });
  Hooks.on("deleteToken", () => soon());
}
