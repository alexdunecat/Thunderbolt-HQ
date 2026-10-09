/* Подсветка дальности: у выделенного самолёта клетки сетки (зоны) закрашиваются по тому, что до них достаёт.
   Без выбранного спецоружия — стандартная ракета: своя зона (пушка, захват, ракеты), соседние (захват и ракеты),
   через одну (ракеты по удержанному захвату). Значок прицела у спецоружия на листе переключает подсветку на него:
   своя дальность, вся зона операции (LAAM, XLAA, LACM) или линия рельсовой пушки через цель. Пыльная буря оставляет
   только свою зону. Видит только тот, кто выделил; выбор оружия помнит этот клиент. */
import { SYSTEM_ID, TB } from "./config.mjs";
import { cellOf, hasRule, weatherAt } from "./scene.mjs";

const LAYER = "tb-range";
// цвета «Брифинга»: мятный, синий своих, жёлтый
const OWN = { color: 0x9be3bf, alpha: 0.2, border: 0x9be3bf };
const NEAR = { color: 0x6cc4ff, alpha: 0.13, border: 0x6cc4ff };
const HOLD = { color: 0xf2c14e, alpha: 0.08, border: 0xf2c14e };
const WEAPON = { color: 0xf2c14e, alpha: 0.14, border: 0xf2c14e };
const FAR = { color: 0xf2c14e, alpha: 0.05, border: 0x8a7a4a };

const aimed = new Map();

export function registerRange() {
  game.settings.register(SYSTEM_ID, "rangeHighlight", {
    name: "Подсветка дальности", hint: "У выделенного самолёта зоны подсвечиваются по стандартной ракете или по спецоружию, отмеченному прицелом на листе.",
    scope: "client", config: true, type: Boolean, default: true, onChange: () => refreshSoon()
  });
  for (const ev of ["controlToken", "updateToken", "deleteToken", "updateScene", "createItem", "updateItem", "deleteItem", "targetToken", "updateActor", "updateActorDelta"])
    Hooks.on(ev, refreshSoon);
  Hooks.on("canvasReady", () => refreshSoon());
}

/** Спецоружие, по которому идёт подсветка у этого актёра (предмет или null — стандартная ракета). */
export function aimedWeapon(actor) {
  const id = actor ? aimed.get(actor.uuid) : null;
  const w = id ? actor.items.get(id) : null;
  return w?.type === "weapon" ? w : null;
}

/** Переключить подсветку на спецоружие и обратно на стандартную ракету. */
export function toggleAim(actor, itemId) {
  if (aimed.get(actor.uuid) === itemId) aimed.delete(actor.uuid);
  else aimed.set(actor.uuid, itemId);
  refreshSoon();
  return aimed.get(actor.uuid) ?? null;
}

let timer = null;
function refreshSoon() {
  clearTimeout(timer);
  timer = setTimeout(draw, 40);
}

function armed(actor) {
  if (!actor) return false;
  if (actor.type === "pilot") return true;
  if (actor.type !== "npc" || actor.system.grp === "obj") return false;
  return !hasRule(actor, "civilian");
}

/** Клетки, которые надо закрасить: Map "i,j" → стиль (позже записанный не перекрывает более важный). */
function shape(token, weapon, block, bounds) {
  const cells = new Map();
  const put = (i, j, style) => {
    if (i < 0 || j < 0 || i > bounds.i || j > bounds.j) return;
    const k = `${i},${j}`;
    if (!cells.has(k)) cells.set(k, { i, j, style });
  };
  const dist = (i, j) => Math.max(0, block.r0 - i, i - block.r1, block.c0 - j, j - block.c1);
  const rings = (max, styleOf) => {
    for (let i = block.r0 - max; i <= block.r1 + max; i++)
      for (let j = block.c0 - max; j <= block.c1 + max; j++) { const d = dist(i, j); if (d <= max) put(i, j, styleOf(d)); }
  };
  const all = style => { for (let i = 0; i <= bounds.i; i++) for (let j = 0; j <= bounds.j; j++) put(i, j, style); };

  rings(0, () => OWN);
  if (weatherAt(token.actor, token).ownZone) return cells;
  if (!weapon) { rings(TB.range.missile, d => d === 1 ? NEAR : HOLD); return cells; }

  const s = weapon.system;
  if (s.target === "line") {
    // рельсовая пушка: линия от самолёта через цель до края карты; без цели — восемь направлений
    const target = game.user.targets.first() ?? lockedToken(token.actor);
    const from = token.center;
    const dirs = target && target !== token ? [[target.center.x - from.x, target.center.y - from.y]]
      : [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
    const len = Math.hypot(canvas.dimensions.width, canvas.dimensions.height);
    for (const [dx, dy] of dirs) {
      const n = Math.hypot(dx, dy) || 1, step = canvas.grid.size / 6;
      for (let t = 0; t <= len; t += step) {
        const o = canvas.grid.getOffset({ x: from.x + dx / n * t, y: from.y + dy / n * t });
        put(o.i, o.j, target ? WEAPON : FAR);
      }
    }
    return cells;
  }
  const reach = s.reach;
  if (reach >= TB.range.operation) { all(WEAPON); return cells; }
  rings(Math.min(reach, 8), () => WEAPON);
  return cells;
}

function lockedToken(actor) {
  const uuid = actor?.system?.lockUuid;
  return uuid ? canvas.tokens.placeables.find(t => t.actor?.uuid === uuid) ?? null : null;
}

function draw() {
  const grid = canvas?.ready ? canvas.interface?.grid : null;
  if (!grid) return;
  const layer = grid.addHighlightLayer(LAYER);
  grid.clearHighlightLayer(LAYER);
  let on = true;
  try { on = game.settings.get(SYSTEM_ID, "rangeHighlight"); } catch {}
  const controlled = canvas.tokens.controlled;
  if (!on || controlled.length !== 1 || canvas.grid.type === CONST.GRID_TYPES.GRIDLESS || canvas.grid.isHexagonal) return;
  const token = controlled[0];
  if (!armed(token.actor) || token.document.hidden && !game.user.isGM) return;
  const block = blockOf(token);
  if (!block) return;
  const bounds = canvas.grid.getOffset({ x: canvas.dimensions.width - 1, y: canvas.dimensions.height - 1 });
  for (const { i, j, style } of shape(token, aimedWeapon(token.actor), block, bounds).values()) {
    const p = canvas.grid.getTopLeftPoint({ i, j });
    grid.highlightPosition(LAYER, { x: p.x, y: p.y, color: style.color, border: style.border, alpha: style.alpha });
  }
  layer.visible = true;
}

/** Клетки под токеном: { r0, c0, r1, c1 }. */
function blockOf(token) {
  const d = token.document;
  if ((d.width ?? 1) <= 1 && (d.height ?? 1) <= 1) {
    const c = cellOf(token);
    return c && { r0: c.row, r1: c.row, c0: c.col, c1: c.col };
  }
  const gs = canvas.grid.size;
  const a = canvas.grid.getOffset({ x: d.x + 1, y: d.y + 1 }), b = canvas.grid.getOffset({ x: d.x + d.width * gs - 1, y: d.y + d.height * gs - 1 });
  return { r0: a.i, c0: a.j, r1: b.i, c1: b.j };
}
