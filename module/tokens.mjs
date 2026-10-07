/* Токены в зоне: самолёты и цели меньше клетки, в одной зоне помещается несколько.
   Новый или передвинутый токен сам встаёт на свободное место своей клетки.
   Foundry v12 не даёт токену быть меньше половины клетки, поэтому при размере 1/3 токен остаётся в полклетки,
   а картинка уменьшается до трети и встаёт в центр своего места.
   Большие цели (стратегические бомбардировщики, летающие крейсеры, подводные авианосцы, корабли крупнее катера) занимают несколько клеток. */
import { SYSTEM_ID, footprintOf, footprintTexture } from "./config.mjs";

export const SIZE_CHOICES = { "0.5": "1/2 клетки: до 4 токенов в зоне", "0.33": "1/3 клетки: до 9 токенов в зоне", "1": "Вся клетка: 1 токен в зоне" };

export function registerTokenSettings() {
  game.settings.register(SYSTEM_ID, "tokenSize", {
    name: "TB.TokenSizeName", hint: "TB.TokenSizeHint", scope: "world", config: true, type: String,
    choices: SIZE_CHOICES, default: "0.5"
  });
  Hooks.on("preCreateToken", onPreCreate);
  Hooks.on("preUpdateToken", onPreUpdate);
}

/** Мест по стороне клетки по настройке мира: 1, 2 или 3. */
export function slotsPerSide() {
  return Math.max(1, Math.round(1 / (Number(game.settings.get(SYSTEM_ID, "tokenSize")) || 0.5)));
}

/** Наименьший размер токена, который принимает Foundry (в v12 — полклетки). */
const minWidth = () => ((game.release?.generation ?? 12) >= 13 ? 0.05 : 0.5);

/** Размер документа токена и масштаб картинки для n мест по стороне. */
export function tokenLook(n = slotsPerSide()) {
  const size = 1 / n, width = Math.max(size, minWidth());
  return { width, scale: Number((size / width).toFixed(4)) };
}

const ours = doc => ["pilot", "npc"].includes(doc.actor?.type);
const squareScene = scene => !!scene && scene === canvas?.scene && canvas.ready && scene.grid.type === CONST.GRID_TYPES.SQUARE;
const center = (t, gs, w = t.width, h = t.height) => ({ x: t.x + (w * gs) / 2, y: t.y + (h * gs) / 2 });
/** Видимый размер токена в клетках (документ × масштаб картинки) → мест по стороне. */
const perSideOf = (w, scale) => { const v = w * Math.abs(scale ?? 1), n = Math.round(1 / v); return n >= 1 && Math.abs(n * v - 1) < 0.03 ? n : 0; };

/* Места, занятые в этом же обновлении: при перетаскивании группы остальные токены ещё стоят на старых местах. */
let claimed = new Set();
let claimTimer = null;
const slotKey = (scene, s) => `${scene.id}:${Math.round(s.x)},${Math.round(s.y)}`;
function claim(scene, s) {
  claimed.add(slotKey(scene, s));
  clearTimeout(claimTimer);
  claimTimer = setTimeout(() => { claimed = new Set(); }, 300);
}

/**
 * Ближайшее к точке p свободное место (его центр) в клетке точки c, n мест по стороне.
 * busy(slot, step) — занято ли место. Возвращает { x, y } центра места или null.
 */
function nearestSlot(scene, c, p, n, busy) {
  if (!n) return null;
  const o = canvas.grid.getTopLeftPoint(c), step = scene.grid.size / n;
  let best = null;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const s = { x: o.x + (i + 0.5) * step, y: o.y + (j + 0.5) * step };
    if (busy(s, step)) continue;
    const d = Math.hypot(s.x - p.x, s.y - p.y);
    if (!best || d < best.d) best = { ...s, d };
  }
  return best;
}

/** Место занято другим токеном сцены (его центр внутри места) или уже отдано в этом обновлении. */
const busyOnScene = (scene, ignoreId) => (s, step) => claimed.has(slotKey(scene, s)) ||
  scene.tokens.some(t => {
    if (t.id === ignoreId) return false;
    const c = center(t, scene.grid.size);
    return Math.abs(c.x - s.x) < step / 2 && Math.abs(c.y - s.y) < step / 2;
  });

/** Верхний левый угол токена шириной w, чтобы его центр встал в центр места. */
const topLeft = (s, w, gs) => ({ x: Math.round(s.x - (w * gs) / 2), y: Math.round(s.y - (w * gs) / 2) });

/** Верхний левый угол большого токена w×h, чтобы он лёг по клеткам вокруг клетки точки c. */
function bigTopLeft(c, w, h, gs) {
  const o = canvas.grid.getTopLeftPoint(c);
  return { x: o.x - Math.floor((w - 1) / 2) * gs, y: o.y - Math.floor((h - 1) / 2) * gs };
}

/** Новый токен большой цели: размер по таблице, вид сверху, клетки вокруг места, куда бросили. */
function createBig(doc, fp) {
  const scene = doc.parent, upd = {};
  const [w, h] = doc.width === 1 && doc.height === 1 ? fp : [doc.width, doc.height];
  if (w !== doc.width || h !== doc.height) {
    Object.assign(upd, { width: w, height: h, texture: { scaleX: 1, scaleY: 1 } });
    const src = footprintTexture(doc.texture?.src);
    if (src !== doc.texture?.src) upd.texture.src = src;
  }
  if (squareScene(scene)) Object.assign(upd, bigTopLeft(center(doc, scene.grid.size), w, h, scene.grid.size));
  if (Object.keys(upd).length) doc.updateSource(upd);
}

function onPreCreate(doc, data, options) {
  if (options.tbKeep || !ours(doc)) return;
  const fp = footprintOf(doc.actor?.system);
  if (fp) return createBig(doc, fp);
  const scene = doc.parent;
  const upd = {};
  let w = doc.width, scale = doc.texture?.scaleX ?? 1;
  if (doc.width === 1 && doc.height === 1 && slotsPerSide() > 1) {
    const look = tokenLook();
    w = look.width; scale = look.scale;
    Object.assign(upd, { width: w, height: w, texture: { scaleX: scale, scaleY: scale } });
  }
  if (squareScene(scene) && doc.width === doc.height) {
    // клетка — та, куда бросили; место — первое свободное по порядку
    const gs = scene.grid.size, c = center(doc, gs), o = canvas.grid.getTopLeftPoint(c);
    const s = nearestSlot(scene, c, o, perSideOf(w, scale), busyOnScene(scene, null));
    if (s) { Object.assign(upd, topLeft(s, w, gs)); claim(scene, s); }
  }
  if (Object.keys(upd).length) doc.updateSource(upd);
}

/** Shift при перетаскивании: поставить токен точно туда, куда отпустили. */
const freePlacement = () => !!game.keyboard?.isModifierActive?.(KeyboardManager.MODIFIER_KEYS.SHIFT);

function onPreUpdate(doc, change, options) {
  if (options.tbKeep || !ours(doc) || !("x" in change || "y" in change) || freePlacement()) return;
  const scene = doc.parent;
  const w = change.width ?? doc.width, h = change.height ?? doc.height;
  const n = perSideOf(w, change.texture?.scaleX ?? doc.texture?.scaleX);
  if (!squareScene(scene) || n < 2 || w !== h) return;
  const gs = scene.grid.size;
  const c = center({ x: change.x ?? doc.x, y: change.y ?? doc.y }, gs, w, h);
  const s = nearestSlot(scene, c, c, n, busyOnScene(scene, doc.id));
  if (!s) return;   // все места заняты: токен встаёт поверх, как обычно
  claim(scene, s);
  const p = topLeft(s, w, gs);
  change.x = p.x; change.y = p.y;
}

/** Ведущий: токены самолётов и целей на сцене привести к размеру из настройки и разложить по местам в своих зонах. */
export async function arrangeSceneTokens() {
  const scene = canvas?.scene;
  if (!game.user.isGM || !squareScene(scene)) return ui.notifications.warn("Нужна открытая сцена с квадратной сеткой.");
  const n = slotsPerSide(), { width, scale } = n > 1 ? tokenLook(n) : { width: 1, scale: 1 }, gs = scene.grid.size;
  const taken = new Set(), updates = [];
  const key = s => `${Math.round(s.x)},${Math.round(s.y)}`;
  for (const t of scene.tokens.filter(ours)) {
    const c = center(t, gs);
    const fp = footprintOf(t.actor?.system);
    if (fp) {
      const p = bigTopLeft(c, fp[0], fp[1], gs), src = footprintTexture(t.texture.src);
      if (t.width !== fp[0] || t.height !== fp[1] || t.x !== p.x || t.y !== p.y || t.texture.scaleX !== 1 || src !== t.texture.src)
        updates.push({ _id: t.id, width: fp[0], height: fp[1], ...p, "texture.scaleX": 1, "texture.scaleY": 1, "texture.src": src });
      continue;
    }
    // все места зоны заняты: встать поверх, в первое место
    const s = nearestSlot(scene, c, c, n, s => taken.has(key(s))) ?? nearestSlot(scene, c, { x: -1e9, y: -1e9 }, n, () => false);
    taken.add(key(s));
    const p = topLeft(s, width, gs);
    if (t.width !== width || t.height !== width || t.x !== p.x || t.y !== p.y || t.texture.scaleX !== scale || t.texture.scaleY !== scale)
      updates.push({ _id: t.id, width, height: width, x: p.x, y: p.y, "texture.scaleX": scale, "texture.scaleY": scale });
  }
  if (updates.length) await scene.updateEmbeddedDocuments("Token", updates, { tbKeep: true, animate: false });
  ui.notifications.info(updates.length ? `Токенов разложено по зонам: ${updates.length}.` : "Все токены уже на местах.");
}
