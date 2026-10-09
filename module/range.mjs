/* Подсветка дальности: у выделенного самолёта клетки сетки (зоны) закрашиваются по тому, что до них достаёт.
   Своя зона — пушка, захват и ракеты; соседняя — захват и ракеты; через одну — ракеты по удержанному захвату;
   дальше — спецоружие со своей дальностью. Пыльная буря оставляет только свою зону. Видит только тот, кто выделил. */
import { SYSTEM_ID, TB } from "./config.mjs";
import { cellOf, hasRule, weatherAt } from "./scene.mjs";

const LAYER = "tb-range";
// цвета «Брифинга»: мятный, синий своих, жёлтый
const RINGS = [
  { color: 0x9be3bf, alpha: 0.2, border: 0x9be3bf },
  { color: 0x6cc4ff, alpha: 0.13, border: 0x6cc4ff },
  { color: 0xf2c14e, alpha: 0.08, border: 0xf2c14e },
  { color: 0xf2c14e, alpha: 0.04, border: 0x8a7a4a }
];

export function registerRange() {
  game.settings.register(SYSTEM_ID, "rangeHighlight", {
    name: "Подсветка дальности", hint: "У выделенного самолёта зоны подсвечиваются: своя (пушка, захват, ракеты), соседние (захват, ракеты), через одну (ракеты по захвату) и дальше для спецоружия.",
    scope: "client", config: true, type: Boolean, default: true, onChange: () => refreshSoon()
  });
  for (const ev of ["controlToken", "updateToken", "deleteToken", "updateScene", "createItem", "updateItem", "deleteItem"]) Hooks.on(ev, refreshSoon);
  Hooks.on("canvasReady", () => refreshSoon());
}

let timer = null;
function refreshSoon() {
  clearTimeout(timer);
  timer = setTimeout(draw, 40);
}

/** Дальность спецоружия актёра (конечная, больше обычной ракеты): самое дальнее. */
function weaponRings(actor) {
  let far = 0;
  for (const i of actor.items ?? []) {
    if (i.type !== "weapon") continue;
    const r = i.system.reach;
    if (Number.isFinite(r) && r > far && r < TB.range.operation) far = r;
  }
  return far;
}

function armed(actor) {
  if (!actor) return false;
  if (actor.type === "pilot") return true;
  if (actor.type !== "npc" || actor.system.grp === "obj") return false;
  return !hasRule(actor, "civilian");
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

  const dusty = weatherAt(token.actor, token).ownZone;
  const max = dusty ? 0 : Math.max(TB.range.missile, Math.min(weaponRings(token.actor), 6));
  const block = blockOf(token);
  if (!block) return;
  const rows = canvas.grid.getOffset({ x: canvas.dimensions.width - 1, y: canvas.dimensions.height - 1 });
  for (let i = block.r0 - max; i <= block.r1 + max; i++) {
    for (let j = block.c0 - max; j <= block.c1 + max; j++) {
      if (i < 0 || j < 0 || i > rows.i || j > rows.j) continue;
      const d = Math.max(0, block.r0 - i, i - block.r1, block.c0 - j, j - block.c1);
      if (d > max) continue;
      const ring = RINGS[Math.min(d, RINGS.length - 1)];
      const p = canvas.grid.getTopLeftPoint({ i, j });
      grid.highlightPosition(LAYER, { x: p.x, y: p.y, color: ring.color, border: ring.border, alpha: ring.alpha });
    }
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
