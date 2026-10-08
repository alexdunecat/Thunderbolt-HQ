/* Счётчик действий в бою: сколько из заявленных действий уже сделано за ход и был ли бросок.
   Считаются кнопки листа (Lock On!, Fox Two!, Guns, Break!, передышка, Leadership, Вплотную, проверки навыков),
   кнопки Speed ±, переход токена в другую зону (Move) и смена высоты (Climb / Dive).
   Смену скорости вместе с Move или Climb / Dive в тот же ход правила дают бесплатно.
   Запрещено: действовать до заявки и не в свой ход, сверх заявки, второй бросок за ход, Move дальше соседней зоны
   и Climb / Dive больше чем на ступень. Ведущий может переставить токен в обход правил, перетаскивая его с Shift.
   Move и Climb / Dive засчитываются в момент перемещения, и двигавший видит об этом сообщение. */
import { SYSTEM_ID } from "./config.mjs";
import { PASS, isOut } from "./documents/combat.mjs";

export const ACT_NAMES = {
  lock: "Lock On!", missile: "Fox Two!", guns: "Guns, Guns, Guns!", break: "Break!", recover: "Передышка",
  lead: "Leadership", formup: "Вплотную", sam: "Пуск ЗРК", skill: "Проверка", speed: "Change Speed", move: "Move", climb: "Climb / Dive"
};

/** Боец текущего боя для актёра или токена: сначала по токену, потом по актёру. */
export function combatantOf(actor, token = null) {
  const c = game.combat;
  if (!c?.started || !actor) return null;
  const tokId = token?.id ?? (actor.isToken ? actor.token?.id : null);
  return c.combatants.find(x => tokId && x.tokenId === tokId)
    ?? c.combatants.find(x => x.actor === actor || (!actor.isToken && x.actorId === actor.id))
    ?? null;
}

/** Заявлено действий: 1–3, отложивший ход — свои, пропуск — 0. */
export function declaredOf(c) {
  const v = c?.initiative;
  if (typeof v !== "number") return null;
  if (v === PASS) return 0;
  return v > PASS ? v - PASS : v;
}

/** Что сделано за этот ход: { used, rolled, freeSpeed, list }. */
export function spentOf(c) {
  const s = c?.getFlag(SYSTEM_ID, "acts");
  return s?.round === c?.parent?.round ? s : { round: c?.parent?.round, used: 0, rolled: false, freeSpeed: false, list: [] };
}

/** Почему действие сейчас нельзя сделать, или null. Вне боя ограничений нет. */
export function actionProblem(actor, what, { rolled = false, token = null } = {}) {
  const c = combatantOf(actor, token);
  if (!c) return null;
  const combat = c.parent, name = ACT_NAMES[what] ?? what;
  if (isOut(c)) return `${c.name} выбыл из боя: действий нет.`;
  if (combat.getFlag(SYSTEM_ID, "ready") !== combat.round) return `${c.name}: сначала заявка действий на этот раунд.`;
  if (combat.combatant?.id !== c.id) return `${c.name}: «${name}» только в свой ход.`;
  const s = spentOf(c), n = declaredOf(c) ?? 0;
  const free = what === "speed" && (s.freeSpeed || speedGoing(s));
  if (!free && s.used >= n) return n === 0 ? `${c.name}: ход пропущен, действий нет.` : `${c.name}: все заявленные действия (${n}) уже сделаны.`;
  if (rolled && s.rolled) return `${c.name}: бросок за этот ход уже был, а он один.`;
  return null;
}

/** Скорость меняли последним действием: подстройка в том же Change Speed (по книге Speed меняется сразу до любого значения). */
const speedGoing = s => !!s.list.at(-1)?.startsWith(ACT_NAMES.speed);

/** Можно ли действие; если нет, объяснить. */
export function allowAction(actor, what, opts) {
  const p = actionProblem(actor, what, opts);
  if (p) ui.notifications.warn(p);
  return !p;
}

/** Второй бросок за ход (Improved Fox Two! решается уже в окне пуска). */
export function allowRoll(actor) {
  const c = combatantOf(actor);
  if (!c || !spentOf(c).rolled) return true;
  ui.notifications.warn(`${c.name}: бросок за этот ход уже был, а он один.`);
  return false;
}

/**
 * Отметить сделанное действие. what — ключ из ACT_NAMES; rolled — с броском.
 * Move и Climb / Dive открывают бесплатную смену скорости в этот ход.
 */
export async function spendAction(actor, what, { rolled = false, token = null } = {}) {
  const c = combatantOf(actor, token);
  if (!c?.isOwner) return;
  const name = ACT_NAMES[what] ?? what;
  const s = foundry.utils.deepClone(spentOf(c));
  if (what === "speed" && speedGoing(s)) return;   // та же смена скорости, не новое действие
  const free = what === "speed" && s.freeSpeed;
  if (free) s.freeSpeed = false;
  else s.used += 1;
  if (what === "move" || what === "climb") s.freeSpeed = true;
  if (rolled) s.rolled = true;
  s.list.push(free ? `${name} (заодно)` : name);
  await c.setFlag(SYSTEM_ID, "acts", s);
}

/** Строка для листа и трекера: «1 из 2», «бросок был». */
export function actsSummary(actor) {
  const c = combatantOf(actor);
  if (!c) return null;
  const s = spentOf(c), n = declaredOf(c);
  const turn = c.parent.combatant?.id === c.id;
  const label = `${turn ? "Ваш ход" : "Ход"}: действий ${s.used}${n === null ? ", заявки ещё нет" : ` из ${n}`}${s.rolled ? " · бросок был" : ""}${s.freeSpeed ? " · скорость можно сменить заодно" : ""}`;
  return { used: s.used, declared: n, rolled: s.rolled, freeSpeed: s.freeSpeed, list: s.list.join(", "), over: n !== null && s.used > n, turn, label };
}

/** На сколько зон сдвигается токен (по центру): 0 — в своей зоне. */
function zoneStep(doc, to) {
  const scene = doc.parent, gs = scene?.grid?.size;
  if (!gs || scene.grid.type === CONST.GRID_TYPES.GRIDLESS) return 0;
  const w = to.width ?? doc.width, h = to.height ?? doc.height;
  const zone = (x, y, ww, hh) => [Math.floor((x + (ww * gs) / 2) / gs), Math.floor((y + (hh * gs) / 2) / gs)];
  const [a, b] = zone(doc.x, doc.y, doc.width, doc.height), [p, q] = zone(to.x ?? doc.x, to.y ?? doc.y, w, h);
  return Math.max(Math.abs(a - p), Math.abs(b - q));
}

/** Засчитать Move и Climb / Dive по токену и сказать об этом тому, кто двигал. */
async function countMove(doc, acts) {
  for (const what of acts) await spendAction(doc.actor, what, { token: doc });
  const c = combatantOf(doc.actor, doc);
  if (!c) return;
  const s = spentOf(c), n = declaredOf(c) ?? 0;
  ui.notifications.info(`${doc.name}: ${acts.map(a => ACT_NAMES[a]).join(" и ")} засчитан${acts.length > 1 ? "ы" : ""}, действий ${s.used} из ${n}.`);
}

export function registerActions() {
  // Move и Climb / Dive проверяются и засчитываются ещё до перемещения: только этот хук точно знает, откуда шёл токен
  Hooks.on("preUpdateToken", (doc, change, options) => {
    if (options.tbKeep || !doc.actor) return;
    const moving = "x" in change || "y" in change || "elevation" in change;
    if (!moving || !game.combat?.started) return;
    if (!combatantOf(doc.actor, doc)) return console.log(`${SYSTEM_ID} | ${doc.name}: токена нет в текущем бою, перемещение не считается`);
    const gmFree = game.user.isGM && !!game.keyboard?.isModifierActive?.(KeyboardManager.MODIFIER_KEYS.SHIFT);
    const problems = [], acts = [];
    if ("x" in change || "y" in change) {
      const d = zoneStep(doc, change);
      if (d > 0) {
        acts.push("move");
        const p = actionProblem(doc.actor, "move", { token: doc });
        if (p) problems.push(p);
        else if (d > 1) problems.push(`${doc.name}: Move только в соседнюю зону, а здесь ${d}.`);
      }
    }
    if ("elevation" in change && change.elevation !== doc.elevation && [1, 2, 3].includes(change.elevation)) {
      acts.push("climb");
      const p = actionProblem(doc.actor, "climb", { token: doc });
      if (p) problems.push(p);
      else if (Math.abs(change.elevation - doc.elevation) > 1) problems.push(`${doc.name}: Climb / Dive меняет высоту только на одну ступень.`);
    }
    if (problems.length && !gmFree) { ui.notifications.warn(problems[0]); return false; }
    if (gmFree && problems.length) return;   // ведущий с Shift: в обход правил и без счёта
    console.log(`${SYSTEM_ID} | ${doc.name}: ${acts.join(", ") || "в своей зоне"}${problems.length ? ` (в обход: ${problems[0]})` : ""}`);
    if (acts.length) countMove(doc, acts);
  });
  // Change Speed: кнопки ±, поле листа и полоска токена. Сброс после Break!, сваливание и т. п. идут с options.tbFree.
  Hooks.on("preUpdateActor", (actor, change, options) => {
    if (options.tbFree || !foundry.utils.hasProperty(change, "system.speed")) return;
    const v = Number(change.system.speed);
    if (!Number.isFinite(v) || v === actor.system.speed || !combatantOf(actor)) return;
    const p = actionProblem(actor, "speed");
    if (p) { ui.notifications.warn(p); return false; }
    spendAction(actor, "speed");
  });
  // смена высоты из листа проверяется так же, как ▲▼ на токене
  Hooks.on("preUpdateActor", (actor, change, options) => {
    if (options.tbSync || !foundry.utils.hasProperty(change, "system.alt") || change.system.alt === actor.system.alt) return;
    const order = ["low", "med", "high"], step = Math.abs(order.indexOf(change.system.alt) - order.indexOf(actor.system.alt));
    const p = actionProblem(actor, "climb") ?? (step > 1 && combatantOf(actor) ? `${actor.name}: Climb / Dive меняет высоту только на одну ступень.` : null);
    if (!p) return;
    ui.notifications.warn(p);
    return false;
  });
  // лист и трекер показывают счётчик
  Hooks.on("updateCombatant", c => { if (c.actor?.sheet?.rendered) c.actor.sheet.render(false); });
}
