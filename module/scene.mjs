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

const propKeys = a => [...(a?.system?.props ?? []), ...(a?.system?.rules ?? [])].map(p => p?.key ?? p);

/** Воздушный босс: летающий крейсер (Medium или High) или Аркбёрд (всегда High). Иначе null. */
export function flyingBoss(actor) {
  if (actor?.type !== "npc") return null;
  const keys = propKeys(actor);
  if (actor.system.key === "arkbird" || keys.includes("highonly")) return ["high"];
  if (keys.includes("aerialship")) return ["med", "high"];
  return null;
}

/** Летит ли машина: пилот, воздушный NPC или воздушный босс. */
export const isFlying = actor => actor?.type === "pilot" || (actor?.type === "npc" && actor.system.kind === "air") || !!flyingBoss(actor);

/** Высота токена: по elevation (1 Low, 2 Medium, 3 High), иначе по листу актёра. Воздушный босс не выходит из своих высот. */
export function altOf(token, actor = token?.actor) {
  const elev = token?.document?.elevation;
  const byElev = Object.entries(TB.altElevation).find(([, v]) => v === elev)?.[0];
  const boss = flyingBoss(actor);
  if (boss) {
    const want = byElev ?? actor.system.alt;
    return boss.includes(want) ? want : boss[boss.length - 1];
  }
  if (actor?.type === "npc" && actor.system.kind !== "air") return "low";
  return byElev ?? actor?.system.alt ?? "med";
}

/** Клетка токена: { col, row } или null на сцене без сетки. */
export function cellOf(token) {
  if (!token || !canvas?.ready || canvas.grid.type === CONST.GRID_TYPES.GRIDLESS) return null;
  const o = canvas.grid.getOffset(token.center);
  return { col: o.j, row: o.i };
}

const isAir = isFlying;

/** Клетки токена: { c0, r0, c1, r1 }. Токен не больше клетки — клетка его центра, большой — все клетки под ним. */
function cellsOf(token) {
  const d = token.document;
  if ((d?.width ?? 1) <= 1 && (d?.height ?? 1) <= 1) { const c = cellOf(token); return c && { c0: c.col, c1: c.col, r0: c.row, r1: c.row }; }
  const gs = canvas.grid.size;
  const a = canvas.grid.getOffset({ x: d.x + 1, y: d.y + 1 }), b = canvas.grid.getOffset({ x: d.x + d.width * gs - 1, y: d.y + d.height * gs - 1 });
  return { c0: a.j, r0: a.i, c1: b.j, r1: b.i };
}

/** Расстояние в зонах. Между воздушными целями соседний уровень высоты тоже считается соседней зоной.
    Большой токен стоит во всех своих клетках: считается до ближайшей. null — проверить нельзя. */
export function zoneDistance(a, b) {
  if (!a || !b || !canvas?.ready || canvas.grid.type === CONST.GRID_TYPES.GRIDLESS) return null;
  if (a.document?.parent !== b.document?.parent) return null;
  let dh;
  const big = t => (t.document?.width ?? 1) > 1 || (t.document?.height ?? 1) > 1;
  if (big(a) || big(b)) {
    const p = cellsOf(a), q = cellsOf(b);
    if (!p || !q) return null;
    dh = Math.max(0, p.c0 - q.c1, q.c0 - p.c1, p.r0 - q.r1, q.r0 - p.r1);
  } else {
    try { dh = Math.round(canvas.grid.measurePath([a.center, b.center]).spaces); }
    catch {
      const p = cellOf(a), q = cellOf(b);
      dh = Math.max(Math.abs(p.col - q.col), Math.abs(p.row - q.row));
    }
  }
  const da = isAir(a.actor) && isAir(b.actor) ? Math.abs(ALT_ORDER.indexOf(altOf(a)) - ALT_ORDER.indexOf(altOf(b))) : 0;
  return Math.max(dh, da);
}

/** Сторона: пилот игрока — "player", NPC — enemy, ally или neutral (по умолчанию противник). */
export function sideOf(actor) {
  if (actor?.type === "pilot") return "player";
  return TB.sides[actor?.system?.side] ? actor.system.side : "enemy";
}

/** Можно ли стрелять: по своей стороне нельзя (игроки и союзники — одна сторона), по противнику и нейтралу можно. */
export function canFireAt(shooter, target) {
  const team = s => (s === "player" ? "ally" : s);
  return team(sideOf(shooter)) !== team(sideOf(target));
}

export function rangeLabel(r) {
  if (r >= TB.range.operation) return "вся зона операции";
  return r === 0 ? "только своя зона" : r === 1 ? "своя и соседние зоны" : `до ${r} зон`;
}

/**
 * Что мешает атаке или захвату: дальность, погода «цели только в своей зоне», запреты по высоте.
 * target: { actor, token, kind }. Возвращает { dist, far (дальше дальности), problems: [строки] }.
 */
export function reachProblems(attacker, target, range) {
  const problems = [];
  const a = tokenOf(attacker), b = target?.token ?? tokenOf(target?.actor);
  if (!a || !b) return { dist: null, problems };
  const wa = weatherAt(attacker, a), wb = weatherAt(target.actor, b);
  const dusty = (wa.ownZone || wb.ownZone) && range > 0;
  if (dusty) range = 0;
  const dist = zoneDistance(a, b);
  const far = dist !== null && dist > range;
  if (far)
    problems.push(`Цель в ${dist} ${dist === 1 ? "зоне" : "зонах"} от вас, а дальность: ${rangeLabel(range)}.${dusty ? " Пыльная буря: цели только в своей зоне." : ""}`);
  const altA = altOf(a, attacker), altB = altOf(b, target.actor);
  const air = target.kind === "air";
  if (altA === "high" && (!air || altB === "low")) problems.push("С High нельзя бить по земле и по целям на Low.");
  else if (air && altB === "low" && altA !== "low") problems.push("По воздушной цели на Low бьют только с Low.");
  return { dist, far, problems };
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
  // удар молнии: до конца следующего хода −1 Evasion и ракеты только с броском
  if (struckBy(actor)) {
    w.list.push({ id: "struck", ico: "ϟ", name: "Удар молнии", mods: { ev: -1 }, txt: "−1 Evasion и ракеты только с броском до конца следующего хода" });
    w.ev -= 1;
    w.struck = true;
  }
  return w;
}

/** Самолёт поражён молнией в этом или прошлом раунде текущего боя (действует до конца его следующего хода). */
export function struckBy(actor) {
  const f = actor?.getFlag?.(SYSTEM_ID, "struck"), c = game.combat;
  return !!f && !!c && f.combat === c.id && c.round <= f.round + 1;
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
