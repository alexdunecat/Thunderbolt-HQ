/* Шильдик на токене: эмблема авиакрыла или страны из листа пилота или NPC, в правом нижнем углу картинки токена.
   Высоту показывают тень и приглушение, поэтому отдельного значка высоты нет. */
import { SYSTEM_ID } from "./config.mjs";
import { dimmed } from "./altitude.mjs";

const DIM = 0.6;

export function registerInsignia() {
  Hooks.on("refreshToken", t => draw(t));
  for (const ev of ["updateActor", "updateToken", "canvasReady"]) Hooks.on(ev, refreshSoon);
}

let timer = null;
function refreshSoon() {
  clearTimeout(timer);
  timer = setTimeout(() => { if (canvas?.ready) for (const t of canvas.tokens.placeables) draw(t); }, 60);
}

const cache = new Map();
/** Текстура шильдика: загружается один раз, до загрузки — null. */
function textureOf(src) {
  if (cache.has(src)) return cache.get(src);
  cache.set(src, null);
  const load = foundry.canvas?.loadTexture ?? globalThis.loadTexture;
  Promise.resolve(load?.(src)).then(tex => { cache.set(src, tex ?? null); if (tex) refreshSoon(); })
    .catch(err => console.warn(`${SYSTEM_ID} | шильдик ${src}`, err));
  return null;
}

function clear(t) {
  if (t.tbInsignia && !t.tbInsignia.destroyed) t.tbInsignia.destroy({ children: true });
  t.tbInsignia = null;
}

function draw(t) {
  const src = t.actor?.system?.insignia, tex = src ? textureOf(src) : null, m = t.mesh;
  if (!tex || !m) return clear(t);
  let box = t.tbInsignia;
  if (!box || box.destroyed) {
    box = t.tbInsignia = t.addChild(new PIXI.Container());
    box.eventMode = "none";
    box.tbSprite = box.addChild(new PIXI.Sprite());
    box.tbSprite.anchor.set(0.5);
  }
  const sp = box.tbSprite;
  if (sp.texture !== tex) sp.texture = tex;
  // размер от видимой картинки токена, а не от документа (он у маленьких токенов больше картинки)
  const mw = Math.abs(m.width) || t.w, mh = Math.abs(m.height) || t.h;
  const s = Math.max(14, Math.min(mw, mh) * 0.42), k = s / Math.max(tex.width, tex.height);
  sp.scale.set(k);
  box.position.set(t.w / 2 + mw / 2 - s * 0.4, t.h / 2 + mh / 2 - s * 0.4);
  box.alpha = dimmed(t) ? DIM : 1;
}
