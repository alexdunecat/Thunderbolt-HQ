/* Сцена: зоны (клетки сетки), высота токенов, дальность атак и погода. Одна клетка сетки = одна зона. */
import { SYSTEM_ID, TB } from "./config.mjs";
import { esc } from "./utils.mjs";

export const ALT_ORDER = ["low", "med", "high", "strat"];

/** Токен актёра на текущей сцене (для несвязанных токенов — свой токен). */
export function tokenOf(actor) {
  if (!actor || !canvas?.ready) return null;
  if (actor.isToken) return actor.token?.object ?? null;
  return actor.getActiveTokens()[0] ?? null;
}

const propKeys = a => [...(a?.system?.props ?? []), ...(a?.system?.rules ?? [])].map(p => p?.key ?? p);

/**
 * Воздушный босс: летающий крейсер (Средняя или Высокая), Аркбёрд и падающий SOLG (от стратосферы до Средней),
 * баллистическая ракета (только стратосфера: ниже её не перехватить). Иначе null.
 */
export function flyingBoss(actor) {
  if (actor?.type !== "npc") return null;
  const keys = propKeys(actor);
  if (actor.system.key === "arkbird" || keys.includes("strato") || keys.includes("solgfall")) return ["med", "high", "strat"];
  if (actor.system.key === "icbm" || keys.includes("ballistic")) return ["strat"];
  // старые миры: Аркбёрд из компендиума до 0.4.54
  if (keys.includes("highonly")) return ["high"];
  if (keys.includes("aerialship")) return ["med", "high"];
  return null;
}

export const hasRule = (actor, key) => propKeys(actor).includes(key);

/**
 * По кому бьёт пушка: самолёты — по всем; наземка с «Зенитным огнём» (Шилка, Вулкан, Тунгуска, зенитная батарея) — только по воздуху,
 * остальная наземка (танки, БМП, БТР) — только по земле и морю; корабельные орудия систем — по воздуху.
 */
export function gunVs(actor) {
  if (actor?.type !== "npc" || actor.system.kind === "air" || flyingBoss(actor)) return "any";
  if (actor.system.kind === "ground") return hasRule(actor, "aafire") ? "air" : "ground";
  return "air";
}

/** Летит ли машина: пилот, воздушный NPC или воздушный босс. */
export const isFlying = actor => actor?.type === "pilot" || (actor?.type === "npc" && actor.system.kind === "air") || !!flyingBoss(actor);

/** Высота токена: по elevation (1 Низкая, 2 Средняя, 3 Высокая, 4 стратосфера), иначе по листу актёра. Воздушный босс не выходит из своих высот. */
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
  // летающие боссы (Аркбёрд, SOLG, летающие крейсеры) — воздушные цели, хотя их системы бьют как по кораблю
  const air = isAirTarget(target);
  // зенитные ракеты Аркбёрда бьют вниз на все высоты
  const downAll = air && hasRule(attacker, "strato");
  if (altA === "strat" && !downAll && (!air || !["strat", "high"].includes(altB))) problems.push("Из стратосферы бьют только по целям в стратосфере и на Высокой.");
  else if (air && altB === "strat" && !["strat", "high"].includes(altA)) problems.push("До стратосферы достают только из стратосферы и с Высокой.");
  else if (altA === "high" && !downAll && (!air || altB === "low")) problems.push("С Высокой нельзя бить по земле и по целям на Низкой.");
  else if (air && altB === "low" && altA !== "low") problems.push("По воздушной цели на Низкой бьют только с Низкой.");
  // туннель: наружу и снаружи не достать; в узком туннеле только своя секция и одна вперёд (на Изгибе только своя)
  const ta = tunnelAt(a, attacker), tb = tunnelAt(b, target.actor);
  if (ta && !tb) problems.push("Из туннеля наружу не достать.");
  else if (tb && !ta) problems.push("Цель в туннеле: снаружи её не достать.");
  else if (ta && ta.type !== "hall") {
    const same = tb.col === ta.col && tb.row === ta.row;
    const fwd = ta.type !== "bend" && tb.n === ta.n + tunnelDir(a) && Math.abs(tb.col - ta.col) + Math.abs(tb.row - ta.row) === 1;
    if (!same && !fwd) problems.push(ta.type === "bend" ? "На изгибе туннеля бьют только по своей секции." : "Из туннеля бьют только по своей секции и на одну вперёд.");
  }
  return { dist, far, problems };
}

/** Цель в воздухе: самолёт, пилот или летающий босс. */
export const isAirTarget = t => t?.kind === "air" || !!flyingBoss(t?.actor);

/** Ракета с Высокой по цели в стратосфере: A-A −2 (ракета на пределе высоты). Строка для карточки броска или null. */
export function stratLift(attacker, target) {
  const a = tokenOf(attacker), b = target?.token ?? tokenOf(target?.actor);
  if (!a || !b || !isAirTarget(target)) return null;
  return altOf(a, attacker) === "high" && altOf(b, target.actor) === "strat" ? ["предел высоты", -2] : null;
}

/** Потолок машины: ключ высоты (med, high, strat) или null — без ограничения (босс, машина без ключа, не самолёт). */
export function ceilingOf(actor) {
  if (!actor || flyingBoss(actor)) return null;
  const key = actor.type === "pilot" ? actor.system.plane?.system?.key : actor.type === "npc" && actor.system.kind === "air" ? actor.system.key : null;
  return (key && TB.maxAlt[key]) || null;
}

/** Высота с учётом потолка: выше потолка машина не бывает. */
export function capAlt(actor, alt) {
  const ceil = ceilingOf(actor);
  return ceil && ALT_ORDER.indexOf(alt) > ALT_ORDER.indexOf(ceil) ? ceil : alt;
}

/** Что мешает подняться на эту высоту: потолок машины; в стратосферу только со Speed 3 и выше. null — можно. */
export function climbProblem(actor, to) {
  const ceil = ceilingOf(actor);
  if (ceil && ALT_ORDER.indexOf(to) > ALT_ORDER.indexOf(ceil)) return `${actor.name}: потолок машины — ${TB.altitudes[ceil]}, выше не подняться.`;
  if (to !== "strat" || flyingBoss(actor)) return null;
  return (actor?.system?.speed ?? 0) >= 3 ? null : `${actor.name}: в стратосферу поднимаются только со Speed 3 и выше.`;
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
  // в стратосферу погода не достаёт
  if (alt === "strat") ids.clear();
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

/* ---------- вода и суша ---------- */
export const WATER = ["sea", "lake", "coast", "port"];

/**
 * Почему корабль не может встать в эту точку: клетка — суша (местность из импорта миссии, флаг terrainCells).
 * На сушу выходит только сухопутный линкор (правило landship); воздушные корабли летают. Без карты местности — null.
 */
export function landBlocked(doc, to) {
  const a = doc.actor, scene = doc.parent;
  if (a?.type !== "npc" || a.system.kind !== "ship" || flyingBoss(a) || hasRule(a, "landship")) return null;
  const cells = scene?.getFlag(SYSTEM_ID, "terrainCells");
  const gs = scene?.grid?.size;
  if (!cells || !gs) return null;
  const w = (to.width ?? doc.width) * gs, h = (to.height ?? doc.height) * gs;
  const x = (to.x ?? doc.x) + w / 2, y = (to.y ?? doc.y) + h / 2;
  const ter = cells[`${Math.floor(x / gs)},${Math.floor(y / gs)}`];
  if (!ter || WATER.includes(ter)) return null;
  return `${doc.name}: корабль не выходит на сушу. На берег заходит только сухопутный линкор.`;
}

/* ---------- туннели (секции из Планшета: флаг сцены tunnelCells, "col,row" → { type, n }) ---------- */
const TSIDE = [[0, -1], [1, 0], [0, 1], [-1, 0]];

/** Секция туннеля в клетке: { type, n, col, row } или null. */
export function sectionAt(scene, col, row) {
  const s = scene?.getFlag?.(SYSTEM_ID, "tunnelCells")?.[`${col},${row}`];
  return s ? { ...s, col, row } : null;
}

/**
 * Секция, в которой находится токен: под ним туннель и он на её высоте. Иначе null.
 * Низкая над секцией — внутри; Средняя над Залом — внутри, только если самолёт залетел туда из туннеля
 * (флаг токена tunnelIn), а не пролетает над Залом снаружи.
 */
export function tunnelAt(token, actor = token?.actor) {
  const cell = token ? cellOf(token) : null;
  if (!cell) return null;
  const sec = sectionAt(token.document?.parent ?? canvas?.scene, cell.col, cell.row);
  if (!sec) return null;
  const alt = altOf(token, actor);
  return alt === "low" || (sec.type === "hall" && alt === "med" && !!token.document?.getFlag?.(SYSTEM_ID, "tunnelIn")) ? sec : null;
}

/** В туннеле, но не в Зале: здесь действуют правила туннеля. */
export const inNarrowTunnel = (token, actor) => { const s = tunnelAt(token, actor); return s && s.type !== "hall" ? s : null; };

/** Направление полёта по туннелю: +1 к выходу, −1 после разворота в Зале. */
export const tunnelDir = token => token?.document?.getFlag?.(SYSTEM_ID, "tunnelDir") ?? 1;

/** Соседние по стороне секции с номером n + dir. */
export function nextSections(scene, sec, dir = 1) {
  return TSIDE.map(([dc, dr]) => sectionAt(scene, sec.col + dc, sec.row + dr)).filter(s => s && s.n === sec.n + dir);
}

/** Стены сбивают ракеты: в туннеле (кроме Зала) +2 к защите от ракет. */
export const wallBonus = (token, actor) => (token && isFlying(actor ?? token.actor) && inNarrowTunnel(token, actor) ? 2 : 0);

/** Почему нельзя сменить высоту в туннеле или над ним: внутри Climb и Dive нет, внутрь сверху только через Шахту. */
export function tunnelClimbProblem(token, to) {
  const cell = token ? cellOf(token) : null;
  const sec = cell && sectionAt(token.document?.parent ?? canvas?.scene, cell.col, cell.row);
  if (!sec || sec.type === "hall" || sec.type === "shaft") return null;
  const from = altOf(token);
  if (from === "low") return `${token.name}: в туннеле Climb и Dive нельзя, выход только вперёд.`;
  if (to === "low") return `${token.name}: под этим участком туннель, внутрь только через вход или шахту.`;
  return null;
}

/** Почему этот Move в туннеле не по правилам: только вперёд, наружу из последней секции, внутрь через вход. null — можно. */
export function tunnelMoveProblem(doc, to) {
  const scene = doc.parent;
  if (!scene?.getFlag?.(SYSTEM_ID, "tunnelCells") || !isFlying(doc.actor)) return null;
  const gs = scene.grid?.size ?? canvas.grid.size, w = (doc.width ?? 1) * gs / 2, h = (doc.height ?? 1) * gs / 2;
  const fc = Math.floor((doc.x + w) / gs), fr = Math.floor((doc.y + h) / gs);
  const tc = Math.floor(((to.x ?? doc.x) + w) / gs), tr = Math.floor(((to.y ?? doc.y) + h) / gs);
  if (fc === tc && fr === tr) return null;
  const token = doc.object ?? { document: doc, actor: doc.actor };
  const alt = altOf(token, doc.actor);
  const from = sectionAt(scene, fc, fr), dest = sectionAt(scene, tc, tr);
  const inside = from && (alt === "low" || (from.type === "hall" && alt === "med" && !!doc.getFlag?.(SYSTEM_ID, "tunnelIn")));
  if (!inside) {
    // внутрь по Низкой: только в крайнюю секцию (вход с любого конца); Зал открыт; в Шахту только Dive сверху
    if (dest && alt === "low" && dest.type === "shaft") return `${doc.name}: в шахту входят только Dive сверху.`;
    if (dest && alt === "low" && dest.type !== "hall" && nextSections(scene, dest, -1).length && nextSections(scene, dest, 1).length)
      return `${doc.name}: в туннель входят только через вход или шахту.`;
    return null;
  }
  if (from.type === "hall") return null;
  const dir = doc.getFlag?.(SYSTEM_ID, "tunnelDir") ?? 1;
  const fwd = nextSections(scene, from, dir);
  if (dest && fwd.some(s => s.col === tc && s.row === tr)) return null;
  if (!dest && !fwd.length) return null;
  return `${doc.name}: в туннеле летят только вперёд${fwd.length ? `, к секции ${from.n + dir}` : ""}.`;
}
