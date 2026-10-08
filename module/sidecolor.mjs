/* Цвет стороны на токене: иконки системы нарисованы белыми линиями («Брифинг», стекло),
   Foundry тонирует их по стороне: пилоты зелёные, союзники синие, противник красный, нейтралы жёлтые.
   Приоритетную цель обводят уголки вокруг токена цветом её стороны. Свою картинку или свой оттенок токена не трогаем. */
import { dimmed } from "./altitude.mjs";

export const SIDE_TINT = { player: 0x8ee6a0, ally: 0x6cc4ff, enemy: 0xff6b4a, neutral: 0xf2c14e };
const OURS = /systems\/thunderbolt-shtab\/assets\/(planes|targets)\//;

export function registerSideColor() {
  Hooks.on("refreshToken", t => paint(t));
  for (const ev of ["updateActor", "updateActorDelta", "updateToken", "canvasReady"]) Hooks.on(ev, refreshSoon);
}

let timer = null;
function refreshSoon() {
  clearTimeout(timer);
  timer = setTimeout(() => { if (canvas?.ready) for (const t of canvas.tokens.placeables) paint(t); }, 60);
}

export function sideOf(actor) {
  if (!actor) return null;
  return actor.type === "pilot" ? "player" : actor.system?.side ?? "enemy";
}

function customTint(doc) {
  const c = doc.texture?.tint;
  const s = c == null ? "#ffffff" : String(c).toLowerCase();
  return s !== "#ffffff" && s !== "16777215";
}

function paint(t) {
  const m = t.mesh, doc = t.document;
  if (!m || m.destroyed) return;
  const tint = SIDE_TINT[sideOf(t.actor)];
  if (tint !== undefined && OURS.test(doc.texture?.src ?? "") && !customTint(doc)) m.tint = tint;
  brackets(t, !!t.actor?.system?.priority && t.actor.type !== "pilot", SIDE_TINT[sideOf(t.actor)] ?? SIDE_TINT.enemy);
}

function brackets(t, on, color) {
  if (!on) {
    if (t.tbPriority && !t.tbPriority.destroyed) t.tbPriority.destroy();
    t.tbPriority = null;
    return;
  }
  let g = t.tbPriority;
  if (!g || g.destroyed) { g = t.tbPriority = t.addChild(new PIXI.Graphics()); g.eventMode = "none"; }
  const m = t.mesh, mw = Math.abs(m.width) || t.w, mh = Math.abs(m.height) || t.h;
  const pad = Math.max(3, Math.min(mw, mh) * 0.06), w = Math.max(2.5, Math.min(mw, mh) * 0.035);
  const x0 = t.w / 2 - mw / 2 - pad, y0 = t.h / 2 - mh / 2 - pad, x1 = t.w / 2 + mw / 2 + pad, y1 = t.h / 2 + mh / 2 + pad;
  const L = Math.min(x1 - x0, y1 - y0) * 0.24;
  g.clear();
  for (const [lw, col, a] of [[w + 3, 0x07141a, 0.8], [w, color, 1]]) {
    g.lineStyle({ width: lw, color: col, alpha: a, cap: "square", join: "miter" });
    g.moveTo(x0, y0 + L).lineTo(x0, y0).lineTo(x0 + L, y0);
    g.moveTo(x1 - L, y0).lineTo(x1, y0).lineTo(x1, y0 + L);
    g.moveTo(x1, y1 - L).lineTo(x1, y1).lineTo(x1 - L, y1);
    g.moveTo(x0 + L, y1).lineTo(x0, y1).lineTo(x0, y1 - L);
  }
  g.alpha = dimmed(t) ? 0.6 : 1;
}
