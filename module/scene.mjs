/* Сцена: зоны (клетки сетки), высота токенов, дальность атак и погода. Одна клетка сетки = одна зона. */
import { SYSTEM_ID, TB } from "./config.mjs";
import { esc } from "./utils.mjs";

const ALT_ORDER = ["low", "med", "high"];

/** Токен актёра на текущей сцене (для несвязанных токенов — свой токен). */
export function tokenOf(actor) {
  if (!actor || !canvas?.ready) return null;
  if (actor.isToken) return actor.token?.object ?? null;
  return actor.getActiveTokens()[0] ?? null;
}

/** Высота токена: по elevation (1 Low, 2 Medium, 3 High), иначе по листу актёра. */
export function altOf(token, actor = token?.actor) {
  const elev = token?.document?.elevation;
  const byElev = Object.entries(TB.altElevation).find(([, v]) => v === elev)?.[0];
  if (actor?.type === "npc" && actor.system.kind !== "air") return "low";
  return byElev ?? actor?.system.alt ?? "med";
}

/** Клетка токена: { col, row } или null на сцене без сетки. */
export function cellOf(token) {
  if (!token || !canvas?.ready || canvas.grid.type === CONST.GRID_TYPES.GRIDLESS) return null;
  const o = canvas.grid.getOffset(token.center);
  return { col: o.j, row: o.i };
}

function isAir(actor) { return actor?.type === "pilot" || actor?.system.kind === "air"; }

/** Расстояние в зонах. Между воздушными целями соседний уровень высоты тоже считается соседней зоной. null — проверить нельзя. */
export function zoneDistance(a, b) {
  if (!a || !b || !canvas?.ready || canvas.grid.type === CONST.GRID_TYPES.GRIDLESS) return null;
  if (a.document?.parent !== b.document?.parent) return null;
  let dh;
  try { dh = Math.round(canvas.grid.measurePath([a.center, b.center]).spaces); }
  catch {
    const p = cellOf(a), q = cellOf(b);
    dh = Math.max(Math.abs(p.col - q.col), Math.abs(p.row - q.row));
  }
  const da = isAir(a.actor) && isAir(b.actor) ? Math.abs(ALT_ORDER.indexOf(altOf(a)) - ALT_ORDER.indexOf(altOf(b))) : 0;
  return Math.max(dh, da);
}

export function rangeLabel(r) {
  if (r >= TB.range.operation) return "вся зона операции";
  return r === 0 ? "только своя зона" : r === 1 ? "своя и соседние зоны" : `до ${r} зон`;
}

/**
 * Что мешает атаке или захвату: дальность, погода «цели только в своей зоне», запреты по высоте.
 * target: { actor, token, kind }. Возвращает { dist, problems: [строки] }.
 */
export function reachProblems(attacker, target, range) {
  const problems = [];
  const a = tokenOf(attacker), b = target?.token ?? tokenOf(target?.actor);
  if (!a || !b) return { dist: null, problems };
  const wa = weatherAt(attacker, a), wb = weatherAt(target.actor, b);
  const dusty = (wa.ownZone || wb.ownZone) && range > 0;
  if (dusty) range = 0;
  const dist = zoneDistance(a, b);
  if (dist !== null && dist > range)
    problems.push(`Цель в ${dist} ${dist === 1 ? "зоне" : "зонах"} от вас, а дальность: ${rangeLabel(range)}.${dusty ? " Пыльная буря: цели только в своей зоне." : ""}`);
  const altA = altOf(a, attacker), altB = altOf(b, target.actor);
  const air = target.kind === "air";
  if (altA === "high" && (!air || altB === "low")) problems.push("С High нельзя бить по земле и по целям на Low.");
  else if (air && altB === "low" && altA !== "low") problems.push("По воздушной цели на Low бьют только с Low.");
  return { dist, problems };
}

/** Спросить ведущего или игрока, стрелять ли вне правил дальности. true — продолжать. */
export async function confirmReach(problems, what) {
  if (!problems.length) return true;
  return Dialog.confirm({
    title: `${what}: вне дальности`,
    content: `<div class="tb-dialog"><ul>${problems.map(p => `<li>${esc(p)}</li>`).join("")}</ul><p>Всё равно продолжить?</p></div>`,
    defaultYes: false,
    options: { classes: ["dialog", "thunderbolt"] }
  });
}

/* ---------- погода ---------- */

/** Погода в точке актёра: вся сцена + клетка токена (из импорта миссии), с учётом высоты. */
export function weatherAt(actor, token = tokenOf(actor)) {
  const scene = token?.document?.parent ?? game.scenes?.viewed ?? null;
  const ids = new Set(scene?.getFlag(SYSTEM_ID, "weather") ?? []);
  const cell = token ? cellOf(token) : null;
  if (cell) for (const id of scene?.getFlag(SYSTEM_ID, "weatherCells")?.[`${cell.col},${cell.row}`] ?? []) ids.add(id);
  const alt = token ? altOf(token, actor) : (actor?.system.alt ?? "med");
  const w = { list: [], ev: 0, aa: 0, ag: 0, push: 0, spd: 0, comp2: false, ownZone: false };
  for (const id of ids) {
    const d = TB.weather[id];
    if (!d || (d.alts && !d.alts.includes(alt))) continue;
    w.list.push({ id, ...d });
    for (const [k, v] of Object.entries(d.mods ?? {})) w[k] += v;
    if (d.comp2) w.comp2 = true;
    if (d.ownZone) w.ownZone = true;
  }
  return w;
}

/** Строки погоды для карточки броска: [["☁ Облачность", −1], …] по ключу модификатора. */
export function weatherParts(w, key) {
  return w.list.filter(d => d.mods?.[key]).map(d => [`${d.ico} ${d.name}`, d.mods[key]]);
}

/** Защита воздушной цели с погодой: max(Evasion + погода, Break!) + Speed. */
export function defenseWithWeather(actor, w) {
  const s = actor.system;
  if (actor.type === "npc" && s.kind !== "air") return s.defense ?? null;
  const ev = (s.evasion ?? s.stats?.ev ?? 0) + (w?.ev ?? 0);
  return Math.max(ev, s.breakEv ?? -Infinity) + (s.speed ?? 0);
}
