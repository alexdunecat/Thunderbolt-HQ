/* Расчёты тактической подсветки (range.mjs рисует): куда долетит выделенная машина за оставшиеся действия хода,
   что ей грозит по зонам (ЗРК и зенитки противника, опасная погода, удары по площади) и кого она достанет из выбранной зоны.
   Move — одно действие на одну соседнюю зону (8 соседей), из торнадо — 2 действия, «Полный газ» (Punch It, раз за вылет) —
   одним действием до 3 зон. Корабли не выходят на сушу, в туннеле только по правилам туннеля. */
import { SYSTEM_ID, TB } from "./config.mjs";
import { cellOf, altOf, sideOf, canFireAt, flyingBoss, hasRule, landBlocked, tunnelMoveProblem, inNarrowTunnel, AA_GUN, sysGunReach } from "./scene.mjs";
import { combatantOf, declaredOf, spentOf } from "./actions.mjs";
import { quietAA } from "./stealth.mjs";
import { strikesOfCombat, STRIKES } from "./strikes.mjs";

export const zkey = (col, row) => `${col},${row}`;
const cheb = (a, b) => Math.max(Math.abs(a.col - b.col), Math.abs(a.row - b.row));
const N8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

/** Неиспользованный в этом вылете триггер «Полный газ» (Punch It). */
export function punchReady(actor) {
  return actor?.items?.find?.(i => i.type === "trigger" && i.system.key === "punch" && !i.system.used) ?? null;
}

/**
 * Сколько действий на Move есть: в свой ход — сколько осталось из заявки; до заявки, не в свой ход и вне боя — план
 * (заявка, а без неё — до 3). Возвращает { left, plan, why }.
 */
export function movesLeft(actor, token) {
  const c = combatantOf(actor, token?.document ?? token);
  if (!c) return { left: 3, plan: true, why: "вне боя: до 3 действий" };
  const n = declaredOf(c);
  const turn = c.parent.combatant?.id === c.id && c.parent.getFlag(SYSTEM_ID, "ready") === c.parent.round;
  if (!turn) return { left: n ?? 3, plan: true, why: n === null ? "заявки нет: до 3 действий" : `не ваш ход: по заявке ${n}` };
  return { left: Math.max(0, n - spentOf(c).used), plan: false, why: "" };
}

/** Где центр токена окажется, если поставить его в клетку (для проверок суши и туннеля). */
function placeIn(doc, col, row, gs) {
  return { x: (col + 0.5) * gs - (doc.width ?? 1) * gs / 2, y: (row + 0.5) * gs - (doc.height ?? 1) * gs / 2 };
}

/** Торнадо в клетке на высоте машины: выход из неё — 2 Move. */
function tornadoAt(scene, col, row, alt) {
  if (alt === "strat") return false;
  const ids = new Set([...(scene?.getFlag?.(SYSTEM_ID, "weather") ?? []), ...(scene?.getFlag?.(SYSTEM_ID, "weatherCells")?.[zkey(col, row)] ?? [])]);
  return ids.has("tornado");
}

/**
 * Куда долетит токен: Map "col,row" → { col, row, cost, punch }. cost — действий на дорогу (0 — своя зона),
 * punch — только с «Полным газом». bounds: { cols, rows } — размер карты в клетках.
 */
export function moveCells(token, { left, bounds, punch = !!punchReady(token.actor) } = {}) {
  const doc = token.document, scene = doc?.parent ?? canvas?.scene, gs = scene?.grid?.size ?? canvas?.grid?.size;
  const start = cellOf(token);
  const out = new Map();
  if (!start || !gs) return out;
  const alt = altOf(token, token.actor);
  const inside = (c, r) => c >= 0 && r >= 0 && c < bounds.cols && r < bounds.rows;
  const blocked = (c, r) => !!landBlocked(doc, placeIn(doc, c, r, gs));
  out.set(zkey(start.col, start.row), { col: start.col, row: start.row, cost: 0, punch: false });
  // в узком туннеле только соседние секции по правилам туннеля, один шаг
  if (inNarrowTunnel(token, token.actor)) {
    if (left < 1) return out;
    for (const [dc, dr] of N8) {
      const c = start.col + dc, r = start.row + dr;
      if (inside(c, r) && !tunnelMoveProblem(doc, placeIn(doc, c, r, gs))) out.set(zkey(c, r), { col: c, row: r, cost: 1, punch: false });
    }
    return out;
  }
  // обычный полёт: волна по клеткам, шаг 1 действие, из торнадо 2
  const cost = new Map([[zkey(start.col, start.row), 0]]);
  const queue = [{ col: start.col, row: start.row, k: 0 }];
  while (queue.length) {
    queue.sort((a, b) => a.k - b.k);
    const cur = queue.shift();
    if (cur.k > cost.get(zkey(cur.col, cur.row))) continue;
    const step = tornadoAt(scene, cur.col, cur.row, alt) ? 2 : 1;
    for (const [dc, dr] of N8) {
      const c = cur.col + dc, r = cur.row + dr, k = cur.k + step, key = zkey(c, r);
      if (!inside(c, r) || k > left || blocked(c, r) || (cost.has(key) && cost.get(key) <= k)) continue;
      cost.set(key, k);
      queue.push({ col: c, row: r, k });
    }
  }
  for (const [key, k] of cost) { const [c, r] = key.split(",").map(Number); out.set(key, { col: c, row: r, cost: k, punch: false }); }
  // «Полный газ»: одним действием до 3 зон (раз за вылет); показываются только зоны, куда без него за ход не долететь
  if (punch && left >= 1) {
    const reach = 3;
    for (let r = start.row - reach; r <= start.row + reach; r++)
      for (let c = start.col - reach; c <= start.col + reach; c++) {
        const key = zkey(c, r);
        if (out.has(key) || !inside(c, r) || blocked(c, r)) continue;
        out.set(key, { col: c, row: r, cost: 1, punch: true });
      }
  }
  return out;
}

/** Видит ли пользователь токен (скрытые от игроков не выдаём). */
const seen = t => t?.actor && (game.user.isGM || (!t.document.hidden && t.visible !== false));
const dead = a => !!a?.statuses?.has?.(CONFIG.specialStatusEffects?.DEFEATED);

/** Враждебен ли стрелок выделенной машине: противник для игроков и союзников, игроки и союзники для противника. Нейтралы не угроза. */
const hostile = (shooter, me) => sideOf(shooter) !== "neutral" && canFireAt(shooter, me);

/**
 * Угрозы по клеткам для машины на её высоте: Map "col,row" → [{ what, name, quiet }].
 * ЗРК (наземные и корабельные) держат свою и соседние зоны, зенитки — свою (или по описанию системы),
 * удары по площади текущего боя — свои зоны, опасная погода — клетки с ней.
 */
export function threatCells(token, { tokens = canvas?.tokens?.placeables ?? [], combat = game.combat } = {}) {
  const me = token.actor, alt = altOf(token, me), out = new Map();
  const add = (col, row, t) => { const k = zkey(col, row); if (!out.has(k)) out.set(k, []); out.get(k).push(t); };
  const ring = (cell, n, t) => { for (let r = cell.row - n; r <= cell.row + n; r++) for (let c = cell.col - n; c <= cell.col + n; c++) add(c, r, t); };
  // наземь и море до стратосферы не достают
  const aloft = alt !== "strat";
  for (const t of tokens) {
    const a = t.actor;
    if (t === token || a === me || a?.type !== "npc" || !seen(t) || dead(a) || !hostile(a, me)) continue;
    const cell = cellOf(t);
    if (!cell) continue;
    const s = a.system, name = t.name, quiet = !!quietAA(a);
    const flies = !!flyingBoss(a);
    if (s.kind === "ground" && aloft) {
      if (s.ground?.ga != null) ring(cell, TB.range.lockOn, { what: "ЗРК", name, quiet });
      if (hasRule(a, "aafire") && s.ground?.gun) ring(cell, TB.range.guns, { what: "ЗЕН", name, quiet });
    }
    if (s.kind === "ship" && (aloft || flies)) {
      const live = (s.systems ?? []).filter(y => (y.value ?? 0) > 0);
      if (live.some(y => y.ga != null && y.ga !== "")) ring(cell, TB.range.lockOn, { what: "ЗРК", name, quiet });
      const aa = live.filter(y => (y.gun ?? 0) > 0 && (AA_GUN.test(y.name) || flies));
      if (aa.length) ring(cell, Math.max(...aa.map(sysGunReach)), { what: "ЗАК", name, quiet });
    }
  }
  // удары по площади этого боя: по высоте машины
  for (const st of combat?.started ? strikesOfCombat(combat) : []) {
    if (!(st.alts ?? []).includes(alt)) continue;
    for (const z of st.zones) { const [c, r] = z.split(",").map(Number); add(c, r, { what: "УДАР", name: STRIKES[st.kind]?.label ?? st.label ?? "удар", quiet: false }); }
  }
  // опасная погода в клетках (вся сцена — не отмечается: она везде одинакова)
  const scene = token.document?.parent ?? canvas?.scene;
  const WX = { lightning: "ГРОЗА", tornado: "ТОРНАДО", dust: "ПЫЛЬ", hurrA: "УРАГАН", hurrW: "УРАГАН" };
  if (alt !== "strat") for (const [k, ids] of Object.entries(scene?.getFlag?.(SYSTEM_ID, "weatherCells") ?? {})) {
    const [c, r] = k.split(",").map(Number);
    for (const id of ids) {
      const d = TB.weather[id];
      if (!WX[id] || (d?.alts && !d.alts.includes(alt))) continue;
      add(c, r, { what: WX[id], name: d?.name ?? id, quiet: false, wx: true });
    }
  }
  return out;
}

/**
 * Кого машина достанет, если окажется в клетке cell: { lock: [имена], gun: [имена] }.
 * Захват — своя и соседние зоны, пушка — своя (по зонам, без учёта высот: подсказка для плана хода).
 */
export function reachFrom(token, cell, { tokens = canvas?.tokens?.placeables ?? [] } = {}) {
  const me = token.actor, out = { lock: [], gun: [], tokens: [] };
  for (const t of tokens) {
    const a = t.actor;
    if (t === token || a === me || !["pilot", "npc"].includes(a?.type) || !seen(t) || dead(a) || !canFireAt(me, a)) continue;
    if (a.type === "npc" && (a.system.grp === "civil" || hasRule(a, "civilian"))) continue;
    const c = cellOf(t);
    if (!c) continue;
    const d = cheb(cell, c);
    if (d <= TB.range.guns) { out.gun.push(t.name); out.lock.push(t.name); out.tokens.push({ t, d }); }
    else if (d <= TB.range.lockOn) { out.lock.push(t.name); out.tokens.push({ t, d }); }
  }
  return out;
}
