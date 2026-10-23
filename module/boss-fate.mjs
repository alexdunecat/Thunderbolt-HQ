/* Гибель крупных целей по их правилам, а не только когда выбиты все системы.
   Сразу: «Аркбёрд» без всех пяти двигателей, SOLG без всех ядер или с выбитым ядром в стволе.
   Через раунд: воздушный корабль без двигателей падает (10 урона всему на земле под ним), «Рузвельт» без реактора
   взрывается (6 в его зоне, 3 в соседних). В конце раунда: «Тарпан» без гусениц опрокидывается, после шкалы «Перегрев» гибнет.
   Отложенная гибель — флаг unit.fate { kind, round, strike }, урон — удар по площади (strikes.mjs) в зоне корабля.
   Решает активный ведущий; вернул системе HP до срока — гибель отменяется. */
import { SYSTEM_ID } from "./config.mjs";
import { resolveActor } from "./utils.mjs";
import { hasRule, tokenOf } from "./scene.mjs";
import { sysCount } from "./scales.mjs";

const ENGINE = /двигат|сопл|ускорител/i;
const gone = (a, re) => { const c = sysCount(a, re); return c.total > 0 && c.alive === 0; };
const lead = () => !!game.user?.isGM && (game.users?.activeGM?.isSelf ?? true);
const dead = a => !!a?.statuses?.has?.(CONFIG.specialStatusEffects?.DEFEATED) || !!a?.system?.markers?.doom;

/**
 * Правила гибели. test — условие по системам; delay — через сколько раундов (0 — в конце этого, нет — сразу);
 * strike — удар в зоне корабля в тот же конец раунда; why — строка в чат; warn — предупреждение AWACS.
 */
export const FATES = {
  engines: { test: a => gone(a, ENGINE), why: "все двигатели уничтожены, «Аркбёрд» падает в океан вместе с грузом" },
  solgcores: { test: a => gone(a, /^ядр(?!.*ствол)/i), why: "уничтожены все ядра, SOLG взрывается в небе" },
  solgbarrel: { test: a => gone(a, /ствол/i), why: "ядро в стволе уничтожено, SOLG взрывается" },
  pwreactor: { test: a => gone(a, /реактор/i), delay: 1, strike: "reactor", why: "реактор взорвался",
    warn: n => `${q(n)}: реактор уничтожен! Корабль уходит вверх на Высокую и в конце следующего раунда взорвётся: 6 урона в его зоне, 3 в соседних. Уходите оттуда!` },
  aerialfall: { test: a => gone(a, /двигат/i), delay: 1, strike: "fall", why: "двигатели уничтожены, корабль упал",
    warn: n => `${q(n)} потерял двигатели и падает! В конце следующего раунда рухнет: всё на земле под ним получит 10 урона.` },
  pwfallmulti: { test: a => gone(a, /двигат|сопл/i), delay: 1, strike: "fall", why: "все двигатели уничтожены, корабль упал",
    warn: n => `${q(n)} потерял все двигатели и падает! В конце следующего раунда рухнет: всё на земле под ним получит 10 урона.` },
  capsize: { test: a => gone(a, /гусениц/i), delay: 0, why: "гусеницы со стабилизаторами уничтожены, линкор опрокинулся",
    warn: n => `${q(n)} теряет устойчивость: в конце раунда опрокинется.` }
};

/** Правило гибели, которое сейчас сработало у цели, или null. */
export const fateOf = actor => actor?.type === "npc" ? Object.keys(FATES).find(k => hasRule(actor, k) && FATES[k].test(actor)) ?? null : null;

const fateFlag = a => a?.getFlag?.(SYSTEM_ID, "unit")?.fate ?? null;
/** Имя в кавычках, если своих кавычек в нём нет. */
const q = n => (/[«»"]/.test(n) ? n : `«${n}»`);
const nameOf = a => a?.token?.name ?? tokenOf(a)?.name ?? a?.name ?? "";

/** Цель уничтожена по своему правилу: Doom, «сбит» в бою, взрыв у всех. */
export async function bossDown(actor, why) {
  if (!actor || dead(actor)) return false;
  await actor.unsetFlag?.(SYSTEM_ID, "unit.fate");
  game.socket?.emit(`system.${SYSTEM_ID}`, { type: "sound", key: "boom" });
  import("./sounds.mjs").then(m => m.cueAll("boom")).catch(() => null);
  await actor.markDoom(why);
  return true;
}

/** Системы цели изменились: проверить её правило гибели (сразу, отложить или отменить отложенную). */
export async function checkFate(actor) {
  if (!lead() || actor?.type !== "npc" || dead(actor)) return;
  const k = fateOf(actor), F = k ? FATES[k] : null, pending = fateFlag(actor);
  if (!F) {
    // HP системе вернули до срока: гибели не будет
    if (pending) {
      await actor.unsetFlag(SYSTEM_ID, "unit.fate");
      if (pending.strike) { const { cancelStrike } = await import("./strikes.mjs"); await cancelStrike(pending.strike, "системы восстановлены").catch(() => null); }
    }
    return;
  }
  const combat = game.combat?.started ? game.combat : null;
  if (F.delay === undefined || !combat) return bossDown(actor, F.why);
  if (pending) return;
  const round = combat.round + F.delay;
  let strike = null;
  if (F.strike) {
    const { scheduleStrike } = await import("./strikes.mjs");
    strike = await scheduleStrike(combat, actor, F.strike, round);
  }
  await actor.setFlag(SYSTEM_ID, "unit.fate", { kind: k, round, strike });
  if (F.warn) {
    const { sendRadio } = await import("./radio.mjs");
    await sendRadio({ speaker: "AWACS", side: "ally", caution: { level: "warning", title: "WARNING", sub: nameOf(actor) }, text: F.warn(nameOf(actor)) });
  }
}

/** Конец раунда: отложенная гибель, чей срок пришёл (после ударов по площади этого раунда). */
export async function resolveFates(combat, round) {
  if (!lead()) return;
  const seen = new Set();
  for (const c of combat.combatants) {
    const a = c.actor;
    if (!a || seen.has(a.uuid)) continue;
    seen.add(a.uuid);
    const f = fateFlag(a);
    if (f && f.round <= round) await bossDown(a, FATES[f.kind]?.why ?? "цель уничтожена");
  }
}

/** Удар по площади сработал: если это взрыв или падение самого корабля — он уничтожен. */
export async function strikeDone(strike) {
  const src = strike.destroy ? resolveActor(strike.destroy) : strike.kind === "reactor" && strike.sourceUuid ? resolveActor(strike.sourceUuid) : null;
  if (!src || src.type !== "npc") return;
  const f = fateFlag(src);
  await bossDown(src, FATES[f?.kind]?.why ?? (strike.kind === "reactor" ? "реактор взорвался" : "корабль упал"));
}

export function registerBossFate() {
  const busy = new Set();
  const run = actor => {
    if (!actor || busy.has(actor.uuid)) return;
    busy.add(actor.uuid);
    checkFate(actor).catch(err => console.warn(`${SYSTEM_ID} | гибель цели`, err)).finally(() => busy.delete(actor.uuid));
  };
  Hooks.on("updateActor", (a, ch, options) => { if (!options?.tbUndo && foundry.utils.hasProperty(ch, "system.systems")) run(a); });
  // несвязанный токен: системы меняются в его delta
  Hooks.on("updateToken", (doc, ch, options) => { if (!options?.tbUndo && foundry.utils.hasProperty(ch, "delta.system.systems")) run(doc.actor); });
}

