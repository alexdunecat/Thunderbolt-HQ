/* Токены в зоне: самолёты и цели меньше клетки, в одной зоне помещается несколько.
   Новый или передвинутый токен сам встаёт на свободное место своей клетки. */
import { SYSTEM_ID } from "./config.mjs";

export const SIZE_CHOICES = { "0.5": "1/2 клетки: до 4 токенов в зоне", "0.33": "1/3 клетки: до 9 токенов в зоне", "1": "Вся клетка: 1 токен в зоне" };

export function registerTokenSettings() {
  game.settings.register(SYSTEM_ID, "tokenSize", {
    name: "TB.TokenSizeName", hint: "TB.TokenSizeHint", scope: "world", config: true, type: String,
    choices: SIZE_CHOICES, default: "0.5"
  });
  Hooks.on("preCreateToken", onPreCreate);
  Hooks.on("preUpdateToken", onPreUpdate);
}

/** Размер токена в клетках по настройке мира: 1, 0.5 или 0.3333. */
export function tokenSize() {
  const n = Math.round(1 / (Number(game.settings.get(SYSTEM_ID, "tokenSize")) || 0.5));
  return n > 1 ? Number((1 / n).toFixed(4)) : 1;
}

const ours = doc => ["pilot", "npc"].includes(doc.actor?.type);
const squareScene = scene => !!scene && scene === canvas?.scene && canvas.ready && scene.grid.type === CONST.GRID_TYPES.SQUARE;
/** Сколько мест по стороне клетки для токена размером w (0 — размер не делит клетку ровно). */
const perSide = w => { const n = Math.round(1 / w); return n >= 1 && Math.abs(n * w - 1) < 0.02 ? n : 0; };
const center = (t, gs) => ({ x: t.x + (t.width * gs) / 2, y: t.y + (t.height * gs) / 2 });

/* Места, занятые в этом же обновлении: при перетаскивании группы остальные токены ещё стоят на старых местах. */
let claimed = new Set();
let claimTimer = null;
function claim(scene, s) {
  claimed.add(`${scene.id}:${s.x},${s.y}`);
  clearTimeout(claimTimer);
  claimTimer = setTimeout(() => { claimed = new Set(); }, 300);
}

/**
 * Ближайшее к (px, py) свободное место в клетке точки c для токена размером w.
 * busy(sx, sy, step) — занято ли место. Возвращает { x, y } или null.
 */
function nearestSlot(scene, c, px, py, w, busy) {
  const n = perSide(w);
  if (!n) return null;
  const o = canvas.grid.getTopLeftPoint(c), step = scene.grid.size / n;
  let best = null;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const sx = Math.round(o.x + i * step), sy = Math.round(o.y + j * step);
    if (busy(sx, sy, step)) continue;
    const d = Math.hypot(sx - px, sy - py);
    if (!best || d < best.d) best = { x: sx, y: sy, d };
  }
  return best;
}

/** Место занято другим токеном сцены (его центр внутри места) или уже отдано в этом обновлении. */
const busyOnScene = (scene, ignoreId) => (sx, sy, step) => claimed.has(`${scene.id}:${sx},${sy}`) ||
  scene.tokens.some(t => {
    if (t.id === ignoreId) return false;
    const c = center(t, scene.grid.size);
    return c.x >= sx && c.x < sx + step && c.y >= sy && c.y < sy + step;
  });

function onPreCreate(doc, data, options) {
  if (options.tbKeep || !ours(doc)) return;
  const scene = doc.parent;
  const upd = {}, size = tokenSize();
  if (doc.width === 1 && doc.height === 1 && size < 1) upd.width = upd.height = size;
  const w = upd.width ?? doc.width;
  if (squareScene(scene) && doc.width === doc.height) {
    // клетка — та, куда бросили; место — первое свободное по порядку
    const c = center(doc, scene.grid.size), o = canvas.grid.getTopLeftPoint(c);
    const s = nearestSlot(scene, c, o.x, o.y, w, busyOnScene(scene, null));
    if (s) { upd.x = s.x; upd.y = s.y; claim(scene, s); }
  }
  if (Object.keys(upd).length) doc.updateSource(upd);
}

/** Shift при перетаскивании: поставить токен точно туда, куда отпустили. */
const freePlacement = () => !!game.keyboard?.isModifierActive?.(KeyboardManager.MODIFIER_KEYS.SHIFT);

function onPreUpdate(doc, change, options) {
  if (options.tbKeep || !ours(doc) || !("x" in change || "y" in change) || freePlacement()) return;
  const scene = doc.parent;
  const w = change.width ?? doc.width, h = change.height ?? doc.height;
  if (!squareScene(scene) || w >= 1 || w !== h) return;
  const px = change.x ?? doc.x, py = change.y ?? doc.y;
  const s = nearestSlot(scene, center({ x: px, y: py, width: w, height: h }, scene.grid.size), px, py, w, busyOnScene(scene, doc.id));
  if (!s) return;   // все места заняты: токен встаёт поверх, как обычно
  claim(scene, s);
  if (s.x !== px || s.y !== py) { change.x = s.x; change.y = s.y; }
}

/** Ведущий: токены самолётов и целей на сцене привести к размеру из настройки и разложить по местам в своих зонах. */
export async function arrangeSceneTokens() {
  const scene = canvas?.scene;
  if (!game.user.isGM || !squareScene(scene)) return ui.notifications.warn("Нужна открытая сцена с квадратной сеткой.");
  const size = tokenSize(), gs = scene.grid.size;
  const taken = new Set(), updates = [];
  for (const t of scene.tokens.filter(ours)) {
    const c = center(t, gs);
    // все места зоны заняты: встать поверх, в первое место
    const s = nearestSlot(scene, c, t.x, t.y, size, (sx, sy) => taken.has(`${sx},${sy}`)) ?? nearestSlot(scene, c, -1e9, -1e9, size, () => false);
    const x = s?.x ?? t.x, y = s?.y ?? t.y;
    taken.add(`${x},${y}`);
    if (t.width !== size || t.height !== size || t.x !== x || t.y !== y) updates.push({ _id: t.id, width: size, height: size, x, y });
  }
  if (updates.length) await scene.updateEmbeddedDocuments("Token", updates, { tbKeep: true, animate: false });
  ui.notifications.info(updates.length ? `Токенов разложено по зонам: ${updates.length}.` : "Все токены уже на местах.");
}
