/* Тактическая подсветка выделенной машины. Режимы (переключатель в шапке HUD, настройка клиента «Подсветка»):
   «Дальность» — клетки сетки (зоны) по тому, что до них достаёт отсюда. Без выбранного спецоружия — стандартная ракета:
   своя зона (пушка, захват, ракеты), соседние (захват и ракеты), а пока самолёт держит захват — ещё и через одну.
   Значок прицела у спецоружия на листе переключает подсветку на него: своя дальность, вся зона операции (LAAM, XLAA, LACM)
   или линия рельсовой пушки через цель. Пыльная буря оставляет только свою зону.
   «Ход» — куда долетит за оставшиеся действия хода, с ценой в действиях; «Угрозы» — то же плюс ЗРК, зенитки, удары и погода
   по зонам (tactical.mjs). В режимах хода наведение мыши на зону показывает, кого оттуда достать, а при перетаскивании
   токена у курсора — цена Move. «Авто» — ход в свой ход, дальность в остальное время. Видит только тот, кто выделил. */
import { SYSTEM_ID, TB } from "./config.mjs";
import { cellOf, hasRule, weatherAt, landBlocked, tunnelMoveProblem } from "./scene.mjs";
import { moveCells, movesLeft, threatCells, reachFrom, zkey } from "./tactical.mjs";
import { combatantOf, actionProblem } from "./actions.mjs";

const LAYER = "tb-range", LAYER_T = "tb-range-threat", LAYER_H = "tb-range-hover";
// цвета «Брифинга»: мятный, синий своих, жёлтый
const OWN = { color: 0x9be3bf, alpha: 0.2, border: 0x9be3bf };
const NEAR = { color: 0x6cc4ff, alpha: 0.13, border: 0x6cc4ff };
const HOLD = { color: 0xf2c14e, alpha: 0.08, border: 0xf2c14e };
const WEAPON = { color: 0xf2c14e, alpha: 0.14, border: 0xf2c14e };
const FAR = { color: 0xf2c14e, alpha: 0.05, border: 0x8a7a4a };

const aimed = new Map();

/** Режимы подсветки: подпись для переключателя и подсказка. */
export const HL_MODES = {
  auto: { label: "АВТО", hint: "Ход в свой ход, дальность в остальное время" },
  range: { label: "ДАЛЬН", hint: "Дальность: кого достану отсюда" },
  move: { label: "ХОД", hint: "Ход: куда долечу за оставшиеся действия и за сколько" },
  threat: { label: "УГРОЗЫ", hint: "Угрозы: куда долечу, и где ЗРК, зенитки, удары и опасная погода" },
  off: { label: "ВЫКЛ", hint: "Без подсветки" }
};

export function registerRange() {
  game.settings.register(SYSTEM_ID, "rangeHighlight", {
    name: "Подсветка дальности", scope: "client", config: false, type: Boolean, default: true, onChange: () => refreshSoon()
  });
  game.settings.register(SYSTEM_ID, "hlMode", {
    name: "Подсветка", hint: "Что подсвечивается у выделенной машины. Переключается и в шапке HUD.",
    scope: "client", config: true, type: String, default: "auto",
    choices: Object.fromEntries(Object.entries(HL_MODES).map(([k, v]) => [k, `${v.label[0]}${v.label.slice(1).toLowerCase()}: ${v.hint.split(": ")[1] ?? v.hint}`])),
    onChange: () => { refreshSoon(); Hooks.callAll(`${SYSTEM_ID}.hlMode`); }
  });
  Hooks.on("controlToken", refreshSoon);
  // чужие правки во время боя приходят часто: перерисовывать, только когда что-то выделено
  for (const ev of ["deleteToken", "updateScene", "createItem", "updateItem", "deleteItem", "targetToken", "updateActor", "updateActorDelta", "updateCombat", "updateCombatant", "deleteCombat"])
    Hooks.on(ev, () => { if (canvas?.tokens?.controlled?.length) refreshSoon(); });
  // токен: только когда он сдвинулся, сменил высоту, скрылся или поменялись данные его машины (не имя, картинка, полоски)
  const TOKEN_KEYS = ["x", "y", "elevation", "hidden", "delta", "width", "height"];
  Hooks.on("updateToken", (doc, change) => { if (canvas?.tokens?.controlled?.length && TOKEN_KEYS.some(k => k in change)) refreshSoon(); });
  Hooks.on("canvasReady", () => refreshSoon());
  Hooks.on("canvasTearDown", () => { labels = null; marks = null; hideTip(); });
  globalThis.window?.addEventListener("pointermove", onPointer, { passive: true });
  globalThis.window?.addEventListener("pointerup", () => setTimeout(hideTip, 0));
}

/** Текущий режим этого клиента. */
export function hlMode() {
  try {
    if (game.settings.get(SYSTEM_ID, "rangeHighlight") === false) return "off";
    const m = game.settings.get(SYSTEM_ID, "hlMode");
    return HL_MODES[m] ? m : "auto";
  } catch { return "auto"; }
}

/** Поставить режим (из переключателя HUD). */
export async function setHlMode(m) {
  if (!HL_MODES[m]) return;
  if (game.settings.get(SYSTEM_ID, "rangeHighlight") === false) await game.settings.set(SYSTEM_ID, "rangeHighlight", true);
  await game.settings.set(SYSTEM_ID, "hlMode", m);
}

/** Переключатель режимов для шапки HUD и панелей целей. */
export function hlSwitch() {
  const cur = hlMode();
  return `<span class="tb-hud-hl" title="Подсветка на карте у выделенной машины">${Object.entries(HL_MODES).map(([k, v]) =>
    `<a data-hud-hl="${k}" class="${k === cur ? "on" : ""}" title="${v.hint}">${v.label}</a>`).join("")}</span>`;
}

/** Какой слой рисовать сейчас: auto — ход в свой ход (заявка уже есть), иначе дальность. */
function effective(token) {
  const m = hlMode();
  if (m !== "auto") return m;
  const c = combatantOf(token.actor, token.document);
  return c && c.parent.combatant?.id === c.id && c.parent.getFlag(SYSTEM_ID, "ready") === c.parent.round ? "move" : "range";
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
  // стандартная ракета: своя и соседние зоны; через одну — только пока самолёт держит захват (он срывается дальше двух зон)
  if (!weapon) { rings(token.actor.system?.lockUuid ? TB.range.lockHold : TB.range.lockOn, d => d === 1 ? NEAR : HOLD); return cells; }

  const s = weapon.system;
  if (s.target === "line") {
    // EMRG: линия от самолёта по стороне или диагонали до края карты — восемь направлений, своя клетка не в счёт
    const o = canvas.grid.getOffset(token.center);
    for (const [di, dj] of [[0, 1], [0, -1], [1, 0], [-1, 0], [1, 1], [1, -1], [-1, 1], [-1, -1]])
      for (let i = o.i + di, j = o.j + dj; i >= 0 && j >= 0 && i <= bounds.i && j <= bounds.j; i += di, j += dj) put(i, j, FAR);
    return cells;
  }
  const reach = s.reach;
  if (reach >= TB.range.operation) { all(WEAPON); return cells; }
  rings(Math.min(reach, 8), () => WEAPON);
  return cells;
}

const MOVE = [null, { color: 0x6cc4ff, alpha: 0.18, border: 0x6cc4ff }, { color: 0x6cc4ff, alpha: 0.11, border: 0x4f8fb8 }, { color: 0x6cc4ff, alpha: 0.06, border: 0x3d6e8c }];
const PUNCH = { color: 0xf2c14e, alpha: 0.1, border: 0xf2c14e };
const THREAT = n => ({ color: 0xff4a3a, alpha: Math.min(0.34, 0.1 + 0.07 * n), border: 0xff4a3a });
const QUIET = { color: 0xff9a3a, alpha: 0.07, border: 0x8a5a2a };
const WXS = { color: 0xb18cff, alpha: 0.09, border: 0x8a6ad0 };
let labels = null, marks = null;

/** Контейнер подписей поверх сетки (цены хода, угрозы, «отсюда достану»). */
function layerOf(name) {
  const cur = name === "labels" ? labels : marks;
  if (cur && !cur.destroyed) { cur.removeChildren().forEach(c => c.destroy()); return cur; }
  const c = canvas.interface.addChild(new PIXI.Container());
  if (name === "labels") labels = c; else marks = c;
  return c;
}

/* Стили подписей одни на все клетки: новый PIXI.TextStyle на каждую цифру при каждой перерисовке не нужен. */
const styles = new Map();
function textStyle(fill, fontSize, align, gs) {
  const k = `${fill}|${fontSize}|${align}|${gs}`;
  if (!styles.has(k)) styles.set(k, new PIXI.TextStyle({
    fontFamily: "Jura, sans-serif", fontSize, fontWeight: "700", fill, stroke: 0x02080a, strokeThickness: 3, wordWrap: true, wordWrapWidth: gs - 8, align
  }));
  return styles.get(k);
}

function text(box, str, x, y, { fill = 0xd9f2ff, size, align = "left" } = {}) {
  const gs = canvas.grid.size;
  const t = box.addChild(new PreciseText(str, textStyle(fill, size ?? Math.max(12, Math.round(gs / 8)), align, gs)));
  t.position.set(x, y);
  return t;
}

/** Что нарисовано сейчас: для наведения мыши и подсказки при перетаскивании. */
let state = null;

function draw() {
  const grid = canvas?.ready ? canvas.interface?.grid : null;
  if (!grid) return;
  const layer = grid.addHighlightLayer(LAYER), tl = grid.addHighlightLayer(LAYER_T);
  grid.clearHighlightLayer(LAYER); grid.clearHighlightLayer(LAYER_T); grid.clearHighlightLayer(LAYER_H);
  layerOf("labels"); layerOf("marks");
  state = null; hover = null;
  const controlled = canvas.tokens.controlled;
  if (controlled.length !== 1 || canvas.grid.type === CONST.GRID_TYPES.GRIDLESS || canvas.grid.isHexagonal) return;
  const token = controlled[0];
  if (!armed(token.actor) || token.document.hidden && !game.user.isGM) return;
  const mode = effective(token);
  if (mode === "off") return;
  const bounds = canvas.grid.getOffset({ x: canvas.dimensions.width - 1, y: canvas.dimensions.height - 1 });
  const paint = (name, i, j, style) => { const p = canvas.grid.getTopLeftPoint({ i, j }); grid.highlightPosition(name, { x: p.x, y: p.y, color: style.color, border: style.border, alpha: style.alpha }); };
  if (mode === "range") {
    const block = blockOf(token);
    if (!block) return;
    for (const { i, j, style } of shape(token, aimedWeapon(token.actor), block, bounds).values()) paint(LAYER, i, j, style);
    layer.visible = true;
    return;
  }
  // ход: клетки по цене в действиях, своя зона мятная; не в свой ход — бледнее (план)
  const ml = movesLeft(token.actor, token);
  const cells = moveCells(token, { left: ml.left, bounds: { cols: bounds.j + 1, rows: bounds.i + 1 } });
  const gs = canvas.grid.size;
  for (const c of cells.values()) {
    const base = c.cost === 0 ? OWN : c.punch ? PUNCH : MOVE[Math.min(3, c.cost)];
    paint(LAYER, c.row, c.col, ml.plan ? { ...base, alpha: base.alpha * 0.55 } : base);
    if (c.cost === 0) continue;
    const p = canvas.grid.getTopLeftPoint({ i: c.row, j: c.col });
    text(labels, c.punch ? `⚡${c.cost}` : String(c.cost), p.x + 5, p.y + 3, { fill: c.punch ? 0xffd77a : 0xbfe6ff, size: Math.max(14, Math.round(gs / 6)) });
  }
  const own = cellOf(token);
  if (own) {
    const p = canvas.grid.getTopLeftPoint({ i: own.row, j: own.col });
    text(labels, ml.plan ? `план · ${ml.why}` : `осталось ${ml.left}`, p.x + 5, p.y + 3, { fill: 0x9be3bf, size: Math.max(11, Math.round(gs / 10)) });
  }
  let threats = new Map();
  if (mode === "threat") {
    threats = threatCells(token);
    for (const [k, list] of threats) {
      const [col, row] = k.split(",").map(Number);
      if (col < 0 || row < 0 || col > bounds.j || row > bounds.i) continue;
      const loud = list.filter(t => !t.quiet && !t.wx);
      paint(LAYER_T, row, col, loud.length ? THREAT(loud.length) : list.some(t => t.quiet) ? QUIET : WXS);
      const tags = new Map();
      for (const t of list) tags.set(t.what + (t.quiet ? "·тихо" : ""), (tags.get(t.what + (t.quiet ? "·тихо" : "")) ?? 0) + 1);
      const p = canvas.grid.getTopLeftPoint({ i: row, j: col });
      const str = [...tags].map(([w, n]) => `${w}${n > 1 ? `×${n}` : ""}`).join(" ");
      const lab = text(labels, str, p.x + 5, p.y + gs - 4, { fill: loud.length ? 0xffb3a8 : 0xffd9a8, size: Math.max(11, Math.round(gs / 10)) });
      lab.anchor.set(0, 1);
    }
    tl.visible = true;
  }
  state = { token, cells, threats, left: ml.left, plan: ml.plan, why: ml.why, start: own, mode };
  layer.visible = true;
}

/* ---------- наведение мыши: кого достану из этой зоны ---------- */

let hover = null, raf = 0, lastEv = null;
function onPointer(ev) {
  lastEv = ev;
  if (raf) return;
  raf = requestAnimationFrame(() => { raf = 0; pointerFrame(lastEv); });
}

function pointerFrame(ev) {
  if (!state || !canvas?.ready || state.token.destroyed) return hideTip();
  const view = canvas.app?.view;
  const over = ev.target === view;
  const p = over ? (canvas.canvasCoordinatesFromClient?.({ x: ev.clientX, y: ev.clientY }) ?? canvas.mousePosition) : null;
  const dragging = !!canvas.tokens.preview?.children?.length;
  if (dragging) return dragTip(ev, p);
  hideTip();
  const o = p ? canvas.grid.getOffset(p) : null;
  const key = o ? zkey(o.j, o.i) : null;
  if (key === hover) return;
  hover = key;
  const grid = canvas.interface.grid;
  grid.clearHighlightLayer(LAYER_H);
  const box = layerOf("marks");
  const c = key && state.cells.get(key);
  if (!c || c.cost === 0) return;
  // захват из этой зоны: своя и соседние; цели в ней — рамками
  const gs = canvas.grid.size;
  for (let i = c.row - TB.range.lockOn; i <= c.row + TB.range.lockOn; i++)
    for (let j = c.col - TB.range.lockOn; j <= c.col + TB.range.lockOn; j++) {
      const q = canvas.grid.getTopLeftPoint({ i, j });
      grid.highlightPosition(LAYER_H, { x: q.x, y: q.y, color: 0xffc94a, border: 0xffc94a, alpha: i === c.row && j === c.col ? 0.12 : 0.04 });
    }
  const r = reachFrom(state.token, c);
  const g = box.addChild(new PIXI.Graphics());
  for (const { t, d } of r.tokens) {
    const col = d === 0 ? 0xff4a3a : 0xffc94a, rad = Math.max(t.w, t.h) / 2 + 6;
    g.lineStyle(3, col, 0.95).drawCircle(t.center.x, t.center.y, rad);
    g.lineStyle(2, col, 0.95).moveTo(t.center.x - rad - 8, t.center.y).lineTo(t.center.x - rad + 4, t.center.y)
      .moveTo(t.center.x + rad - 4, t.center.y).lineTo(t.center.x + rad + 8, t.center.y);
  }
  const q = canvas.grid.getTopLeftPoint({ i: c.row, j: c.col });
  const lines = r.lock.length ? [`захват: ${r.lock.join(", ")}`, ...(r.gun.length ? [`пушка: ${r.gun.join(", ")}`] : [])] : ["отсюда никого"];
  const ths = state.threats.get(key);
  if (ths?.length) lines.push(`угрозы: ${[...new Set(ths.map(t => t.name))].join(", ")}`);
  const bg = box.addChild(new PIXI.Graphics());
  const t = text(box, lines.join("\n"), q.x + 6, q.y + gs + 4, { fill: 0xfff1cf, size: Math.max(12, Math.round(gs / 9)) });
  t.style.wordWrapWidth = gs * 2.4;
  bg.beginFill(0x05090a, 0.82).lineStyle(1, 0xffc94a, 0.8).drawRoundedRect(q.x + 2, q.y + gs + 1, t.width + 10, t.height + 6, 3).endFill();
}

/* ---------- подсказка при перетаскивании токена ---------- */

let tip = null;
function hideTip() { if (tip) tip.style.display = "none"; }

function dragTip(ev, p) {
  const { token, cells, left, plan, start } = state;
  const clone = canvas.tokens.preview.children.find(c => c.document?.id === token.document.id);
  if (!clone || !start) return hideTip();
  const o = canvas.grid.getOffset(clone.center ?? p ?? token.center), dest = { col: o.j, row: o.i };
  const d = Math.max(Math.abs(dest.col - start.col), Math.abs(dest.row - start.row));
  if (!d) return hideTip();
  const c = cells.get(zkey(dest.col, dest.row));
  const gs = canvas.grid.size, doc = token.document;
  const to = { x: (dest.col + 0.5) * gs - doc.width * gs / 2, y: (dest.row + 0.5) * gs - doc.height * gs / 2 };
  let ok = false, line = "";
  const why = landBlocked(doc, to) ?? (d === 1 ? tunnelMoveProblem(doc, to) : null) ?? (game.combat?.started && !plan ? actionProblem(token.actor, "move", { token: doc }) : null);
  if (why) line = `нельзя: ${why.replace(/^[^:]*: /, "")}`;
  else if (c?.punch && d <= 3) { ok = true; line = `«Полный газ»: ${d} зоны одним действием (раз за вылет) · останется ${Math.max(0, left - 1)}`; }
  else if (d === 1 && c) { ok = true; line = `Move: 1 действие · останется ${Math.max(0, left - c.cost)}`; }
  else if (c) line = `за один перенос — только соседняя зона; сюда ${c.cost} Move по очереди`;
  else line = `не долететь: нужно ${d} действ., ${plan ? "по плану" : "осталось"} ${left}`;
  if (plan && !why) line += " (план: не ваш ход)";
  if (!tip) { tip = document.createElement("div"); tip.id = "tb-move-tip"; document.body.appendChild(tip); }
  tip.className = ok ? "ok" : "bad";
  tip.textContent = line;
  tip.style.display = "block";
  tip.style.left = `${ev.clientX + 18}px`;
  tip.style.top = `${ev.clientY + 14}px`;
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
