/* Счётчик действий в бою: сколько из заявленных действий уже сделано за ход и был ли бросок.
   Считаются кнопки листа (Lock On!, Fox Two!, Guns, Break!, передышка, Leadership, Вплотную, проверки навыков),
   кнопки Speed ±, переход токена в другую зону (Move) и смена высоты (Climb / Dive).
   Смену скорости вместе с Move или Climb / Dive в тот же ход правила дают бесплатно.
   Ничего не запрещается: при превышении заявки, втором броске или действии не в свой ход приходит предупреждение. */
import { SYSTEM_ID } from "./config.mjs";
import { PASS } from "./documents/combat.mjs";

export const ACT_NAMES = {
  lock: "Lock On!", missile: "Fox Two!", guns: "Guns, Guns, Guns!", break: "Break!", recover: "Передышка",
  lead: "Leadership", formup: "Вплотную", skill: "Проверка", speed: "Change Speed", move: "Move", climb: "Climb / Dive"
};

/** Боец текущего боя для актёра (у несвязанных токенов — свой). */
export function combatantOf(actor) {
  const c = game.combat;
  if (!c?.started || !actor) return null;
  return c.combatants.find(x => x.actor === actor || (x.actorId === actor.id && !actor.isToken && x.token?.actorLink)) ?? null;
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

/**
 * Отметить действие. what — ключ из ACT_NAMES; rolled — с броском; free — не тратит действие.
 * Move и Climb / Dive открывают бесплатную смену скорости в этот ход.
 */
export async function spendAction(actor, what, { rolled = false } = {}) {
  const c = combatantOf(actor);
  if (!c?.isOwner) return;
  const combat = c.parent, name = ACT_NAMES[what] ?? what;
  if (combat.combatant?.id !== c.id) ui.notifications.warn(`${c.name}: «${name}» не в свой ход.`);
  const s = foundry.utils.deepClone(spentOf(c));
  let free = false;
  if (what === "speed" && s.freeSpeed) { free = true; s.freeSpeed = false; }
  if (!free) s.used += 1;
  if (what === "move" || what === "climb") s.freeSpeed = true;
  if (rolled) {
    if (s.rolled) ui.notifications.warn(`${c.name}: бросок за этот ход уже был, а по правилам он один.`);
    s.rolled = true;
  }
  s.list.push(free ? `${name} (заодно)` : name);
  const n = declaredOf(c);
  if (!free && n !== null && s.used > n) ui.notifications.warn(`${c.name}: заявлено ${n}, это уже ${s.used}-е действие.`);
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

export function registerActions() {
  // Move и Climb / Dive: токен сменил зону или высоту руками своего владельца
  Hooks.on("preUpdateToken", (doc, change, options) => {
    if ("x" in change || "y" in change) options.tbFrom = { x: doc.x, y: doc.y, w: doc.width, h: doc.height };
    if ("elevation" in change) options.tbElev = doc.elevation;
  });
  Hooks.on("updateToken", (doc, change, options, userId) => {
    if (userId !== game.user.id || options.tbKeep || !doc.actor || !combatantOf(doc.actor)) return;
    const gs = doc.parent?.grid?.size;
    if (options.tbFrom && gs && doc.parent.grid.type !== CONST.GRID_TYPES.GRIDLESS) {
      const f = options.tbFrom, zone = (x, y, w, h) => [Math.floor((x + (w * gs) / 2) / gs), Math.floor((y + (h * gs) / 2) / gs)];
      const [a, b] = zone(f.x, f.y, f.w, f.h), [p, q] = zone(doc.x, doc.y, doc.width, doc.height);
      const d = Math.max(Math.abs(a - p), Math.abs(b - q));
      if (d > 0) {
        if (d > 1) ui.notifications.warn(`${doc.name}: Move только в соседнюю зону, а токен ушёл на ${d}.`);
        spendAction(doc.actor, "move");
      }
    }
    if ("tbElev" in options && options.tbElev !== doc.elevation && [1, 2, 3].includes(doc.elevation)) {
      if (Math.abs(doc.elevation - options.tbElev) > 1) ui.notifications.warn(`${doc.name}: Climb / Dive меняет высоту только на одну ступень.`);
      spendAction(doc.actor, "climb");
    }
  });
  // лист и трекер показывают счётчик
  Hooks.on("updateCombatant", c => { if (c.actor?.sheet?.rendered) c.actor.sheet.render(false); });
}
