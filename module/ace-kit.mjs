/* Асы в полную силу (Стрэйнджриал 9.5): цифры листа и отметки триггеров. Без хуков и окон: это читают модель данных,
   броски и лист. Хуки, кнопки и эффекты триггеров — в ace-play.mjs. */
import { SYSTEM_ID, TB, inCampaign, sortieUsed, sortieMark, sysOff } from "./config.mjs";
import { squadPoints, operationsDone } from "./squadrons.mjs";

/** У аса очков навыков на столько больше, чем у самого опытного пилота; Strain — Strain машины + столько. */
export const ACE_SKILL_EXTRA = 2, ACE_STRAIN_EXTRA = 5, PLANE_STRAIN_DEFAULT = 10;

/** Strain машин пилотов по ключу (из каталога; заполняется при загрузке мира). */
export const PLANE_STR = new Map();
export function setPlaneStrains(planes = []) {
  for (const p of planes) if (p?.key && Number.isFinite(p.stats?.str)) PLANE_STR.set(p.key, p.stats.str);
}

export const isAce = a => a?.type === "npc" && a.system?.tier === "ace";

/** Strain машины аса: своё поле листа, иначе Strain такой же машины пилотов, иначе 10. */
export function acePlaneStrain(sys) {
  const own = sys?.stats?.str;
  return Number.isFinite(own) ? own : PLANE_STR.get(sys?.key) ?? PLANE_STRAIN_DEFAULT;
}

/** Бюджет навыков аса: самый опытный пилот кампании (сумма навыков) + 2. pilots — для проверок без Foundry. */
export function aceBudget(pilots = globalThis.game?.actors?.filter?.(inCampaign) ?? []) {
  const best = Math.max(0, ...pilots.map(p => squadPoints(p.system?.skills)));
  return best + ACE_SKILL_EXTRA;
}

/** Сколько триггеров положено асу: 2 + пройденные операции, у Немезиды на 1 больше. */
export const aceSlots = actor => 2 + operationsDone() + (actor?.system?.nemesis ? 1 : 0);

/** Триггеры аса на листе: [{ key, name, text, how, used }]. */
export function aceTriggersOf(actor) {
  if (!isAce(actor)) return [];
  return (actor.system.aceTriggers ?? []).filter(k => TB.aceTriggers[k])
    .map(k => ({ key: k, ...TB.aceTriggers[k], used: sortieUsed(actor, `ace_${k}`) }));
}

/** Триггер есть у аса и в этом вылете ещё не сработал. */
export const aceReady = (actor, key) => isAce(actor) && (actor.system.aceTriggers ?? []).includes(key) && !sortieUsed(actor, `ace_${key}`);

/** Отметить триггер сработавшим (раз за вылет): правка для actor.update. */
export const aceUsedPatch = (actor, key) => ({ [`flags.${SYSTEM_ID}.sortie`]: { ...(actor.getFlag?.(SYSTEM_ID, "sortie") ?? {}), [`ace_${key}`]: sortieMark(actor) } });

/** Ключ раунда для «Чутья аса». */
export const roundKeyNow = () => { const c = globalThis.game?.combat; return c?.started ? `${c.id}:${c.round}` : ""; };

/** «Чутьё аса»: уже было в этом раунде. */
export const instinctUsed = actor => !!roundKeyNow() && actor?.getFlag?.(SYSTEM_ID, "instinct") === roundKeyNow();

/** Почему «Чутьё аса» сейчас нельзя, или "" — можно. */
export function instinctProblem(actor) {
  if (!isAce(actor)) return "это не ас";
  if (!roundKeyNow()) return "только в начатом бою";
  if (actor.statuses?.has(globalThis.CONFIG?.specialStatusEffects?.DEFEATED)) return "ас сбит";
  if (sysOff(actor.system, "ma")) return `MAWS ${actor.system.jam === "ma" ? "заглушён РЭБ" : "сломан"}: ас не знает о пуске`;
  if (instinctUsed(actor)) return "в этом раунде уже было";
  return "";
}

/** Отметки «Добыча» и «Я тебя помню» у аса: { prey: {uuid, name}, remember: {uuid, name} }. */
export const aceMarks = actor => actor?.getFlag?.(SYSTEM_ID, "aceFx") ?? {};

/** Ас, для которого этот пилот сейчас «Добыча» (держит его на захвате), или null: Lead этому пилоту не помогает. */
export function preyedBy(pilot) {
  if (pilot?.type !== "pilot" || !globalThis.canvas?.ready) return null;
  const dead = globalThis.CONFIG?.specialStatusEffects?.DEFEATED;
  for (const t of canvas.tokens.placeables) {
    const a = t.actor;
    if (!isAce(a) || a.statuses?.has(dead)) continue;
    const p = aceMarks(a).prey;
    if (p?.uuid === pilot.uuid && a.system.lockUuid === pilot.uuid) return a;
  }
  return null;
}
