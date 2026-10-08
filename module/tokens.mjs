/* Токены в зоне: одна клетка сетки сцены — это зона, а зона делится на 3×3 места.
   Обычный самолёт или цель занимает одно место, большие цели — несколько мест, но всегда в пределах одной зоны
   (стратегические бомбардировщики и крупные самолёты 2×2, Аркбёрд 2×3, летающие крейсеры 3×2, подводные авианосцы 1×3,
   корабли крупнее катера 1×2). Новый или передвинутый токен сам встаёт на свободные места своей зоны.
   Foundry v12 даёт токену размер только с шагом в полклетки, поэтому документ токена чуть больше,
   а картинка уменьшается до нужного числа мест и встаёт в центр своего блока. */
import { footprintOf, footprintTexture } from "./config.mjs";

/** Мест по стороне зоны. */
export const CELLS = 3;
const ONE = [1, 1];

export function registerTokenSettings() {
  Hooks.on("preCreateToken", onPreCreate);
  Hooks.on("preUpdateToken", onPreUpdate);
}

/** Шаг размера токена: в v12 полклетки, в v13 ограничения нет. */
const sizeStep = () => ((game?.release?.generation ?? 12) >= 13 ? 0 : 0.5);

/**
 * Размер документа токена и масштаб картинки для блока w×h мест.
 * Картинка (с пропорциями блока) вписывается в документ и масштабируется до w/3 × h/3 зоны.
 */
export function cellLook([w, h] = ONE, step = sizeStep()) {
  const vw = w / CELLS, vh = h / CELLS;
  const up = v => (step ? Math.max(step, Math.ceil(v / step - 1e-6) * step) : v);
  const width = up(vw), height = up(vh);
  const fitW = Math.min(width, (height * vw) / vh);
  return { width, height, scale: Number((vw / fitW).toFixed(4)) };
}

const ours = doc => ["pilot", "npc"].includes(doc.actor?.type);
const squareScene = scene => !!scene && scene.grid?.type === CONST.GRID_TYPES.SQUARE;
const center = (t, gs, w = t.width, h = t.height) => ({ x: t.x + (w * gs) / 2, y: t.y + (h * gs) / 2 });
const fpOf = doc => footprintOf(doc.actor?.system) ?? ONE;
const same = (a, b) => Math.abs((a ?? 1) - b) < 1e-3;
/** Токен того размера, который ему даёт система (а не растянутый вручную). */
const looksRight = (w, h, scale, look) => same(w, look.width) && same(h, look.height) && same(Math.abs(scale ?? 1), look.scale);

/** Левый верхний угол зоны, в которой лежит точка p. */
function zoneOf(scene, p) {
  const gs = scene.grid.size;
  if (scene === canvas?.scene && canvas.ready) return canvas.grid.getTopLeftPoint(p);
  return { x: Math.floor(p.x / gs) * gs, y: Math.floor(p.y / gs) * gs };
}

/** Блок мест токена, центр которого в точке c: { zx, zy, i, j, w, h }. */
function blockAt(scene, c, [w, h]) {
  const z = zoneOf(scene, c), cs = scene.grid.size / CELLS;
  const clamp = (v, n) => Math.max(0, Math.min(CELLS - n, Math.round(v)));
  return { zx: z.x, zy: z.y, i: clamp((c.x - z.x) / cs - w / 2, w), j: clamp((c.y - z.y) / cs - h / 2, h), w, h };
}
const cellKeys = b => {
  const out = [];
  for (let dj = 0; dj < b.h; dj++) for (let di = 0; di < b.w; di++) out.push(`${b.zx},${b.zy}:${b.i + di},${b.j + dj}`);
  return out;
};

/* Места, занятые в этом же обновлении: при перетаскивании группы остальные токены ещё стоят на старых местах. */
let claimed = new Set();
let claimTimer = null;
function claim(scene, b) {
  for (const k of cellKeys(b)) claimed.add(`${scene.id}|${k}`);
  clearTimeout(claimTimer);
  claimTimer = setTimeout(() => { claimed = new Set(); }, 300);
}

/** Занятые места сцены: блоки всех наших токенов, кроме ignoreId, и места, отданные в этом обновлении. */
function takenOnScene(scene, ignoreId) {
  const taken = new Set([...claimed].filter(k => k.startsWith(`${scene.id}|`)).map(k => k.slice(scene.id.length + 1)));
  for (const t of scene.tokens) {
    if (t.id === ignoreId || !ours(t)) continue;
    for (const k of cellKeys(blockAt(scene, center(t, scene.grid.size), fpOf(t)))) taken.add(k);
  }
  return taken;
}

/**
 * Свободный блок w×h мест в зоне точки c, ближайший к точке p.
 * Возвращает блок с центром { x, y } или null, если в зоне нет места.
 */
function freeBlock(scene, c, p, [w, h], taken) {
  const z = zoneOf(scene, c), cs = scene.grid.size / CELLS;
  let best = null;
  for (let j = 0; j + h <= CELLS; j++) for (let i = 0; i + w <= CELLS; i++) {
    const b = { zx: z.x, zy: z.y, i, j, w, h };
    if (cellKeys(b).some(k => taken.has(k))) continue;
    const x = z.x + (i + w / 2) * cs, y = z.y + (j + h / 2) * cs, d = Math.hypot(x - p.x, y - p.y);
    if (!best || d < best.d) best = { ...b, x, y, d };
  }
  return best;
}

/** Верхний левый угол документа токена, чтобы его центр встал в центр блока. */
const topLeft = (s, look, gs) => ({ x: Math.round(s.x - (look.width * gs) / 2), y: Math.round(s.y - (look.height * gs) / 2) });

/** Обновление, которое приводит токен к размеру системы: документ, масштаб и для больших целей вид сверху. */
function lookUpdate(doc, fp, look) {
  const upd = { width: look.width, height: look.height, texture: { scaleX: look.scale, scaleY: look.scale } };
  if (fp !== ONE) {
    upd.texture.fit = "contain";
    const src = footprintTexture(doc.texture?.src);
    if (src !== doc.texture?.src) upd.texture.src = src;
  }
  return upd;
}

/**
 * Места для новых токенов, которые ставит не Foundry, а сама система (импорт миссии).
 * Возвращает функцию (fp, zoneCol, zoneRow) → { width, height, x, y, texture }.
 */
export function zonePacker(scene) {
  const taken = new Set(), gs = scene.grid.size;
  return (fp, c, r) => {
    fp = fp ?? ONE;
    const look = cellLook(fp), z = { x: c * gs, y: r * gs };
    const s = freeBlock(scene, z, z, fp, taken) ?? { ...freeBlock(scene, z, z, fp, new Set()) };
    for (const k of cellKeys(s)) taken.add(k);
    const tex = { scaleX: look.scale, scaleY: look.scale, ...(fp !== ONE ? { fit: "contain" } : {}) };
    return { width: look.width, height: look.height, ...topLeft(s, look, gs), texture: tex };
  };
}

function onPreCreate(doc, data, options) {
  if (options.tbKeep || !ours(doc)) return;
  const scene = doc.parent, real = footprintOf(doc.actor?.system), fp = real ?? ONE, look = cellLook(fp);
  const upd = {};
  // свежий токен 1×1 или старый большой токен размером в зоны получают размер в местах
  const fresh = (doc.width === 1 && doc.height === 1) || (real && doc.width === real[0] && doc.height === real[1]);
  if (fresh) foundry.utils.mergeObject(upd, lookUpdate(doc, real ?? ONE, look));
  else if (!looksRight(doc.width, doc.height, doc.texture?.scaleX, look)) return;
  if (squareScene(scene)) {
    // зона — та, куда бросили; место — первое свободное по порядку
    const gs = scene.grid.size, c = center(doc, gs), o = zoneOf(scene, c);
    const s = freeBlock(scene, c, o, fp, takenOnScene(scene, null));
    if (s) { Object.assign(upd, topLeft(s, look, gs)); claim(scene, s); }
  }
  if (Object.keys(upd).length) doc.updateSource(upd);
}

/** Shift при перетаскивании: поставить токен точно туда, куда отпустили. */
const freePlacement = () => !!game.keyboard?.isModifierActive?.(KeyboardManager.MODIFIER_KEYS.SHIFT);

function onPreUpdate(doc, change, options) {
  if (options.tbKeep || !ours(doc) || !("x" in change || "y" in change) || freePlacement()) return;
  const scene = doc.parent;
  if (!squareScene(scene)) return;
  const fp = fpOf(doc), look = cellLook(fp);
  const w = change.width ?? doc.width, h = change.height ?? doc.height;
  if (!looksRight(w, h, change.texture?.scaleX ?? doc.texture?.scaleX, look)) return;
  const gs = scene.grid.size;
  const c = center({ x: change.x ?? doc.x, y: change.y ?? doc.y }, gs, w, h);
  const s = freeBlock(scene, c, c, fp, takenOnScene(scene, doc.id));
  if (!s) return;   // в зоне нет места: токен встаёт поверх, как обычно
  claim(scene, s);
  const p = topLeft(s, look, gs);
  change.x = p.x; change.y = p.y;
}

/** Ведущий: токены самолётов и целей на сцене привести к размеру в местах и разложить по своим зонам. */
export async function arrangeSceneTokens() {
  const scene = canvas?.scene;
  if (!game.user.isGM || !squareScene(scene)) return ui.notifications.warn("Нужна открытая сцена с квадратной сеткой.");
  const gs = scene.grid.size, taken = new Set(), updates = [];
  const area = t => { const [w, h] = fpOf(t); return w * h; };
  // сначала большие цели: им нужно больше мест подряд
  for (const t of scene.tokens.filter(ours).sort((a, b) => area(b) - area(a))) {
    const real = footprintOf(t.actor?.system), fp = real ?? ONE, look = cellLook(fp), c = center(t, gs);
    // все места зоны заняты: встать поверх, на ближайший блок
    const s = freeBlock(scene, c, c, fp, taken) ?? freeBlock(scene, c, c, fp, new Set());
    for (const k of cellKeys(s)) taken.add(k);
    const p = topLeft(s, look, gs), want = lookUpdate(t, real ?? ONE, look);
    const tex = want.texture;
    const differs = t.width !== look.width || t.height !== look.height || t.x !== p.x || t.y !== p.y
      || !same(t.texture.scaleX, look.scale) || !same(t.texture.scaleY, look.scale)
      || (tex.src && tex.src !== t.texture.src) || (tex.fit && tex.fit !== t.texture.fit);
    if (!differs) continue;
    const u = { _id: t.id, width: look.width, height: look.height, ...p, "texture.scaleX": look.scale, "texture.scaleY": look.scale };
    if (tex.src) u["texture.src"] = tex.src;
    if (tex.fit) u["texture.fit"] = tex.fit;
    updates.push(u);
  }
  if (updates.length) await scene.updateEmbeddedDocuments("Token", updates, { tbKeep: true, animate: false });
  ui.notifications.info(updates.length ? `Токенов разложено по зонам: ${updates.length}.` : "Все токены уже на местах.");
}
