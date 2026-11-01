/* Огни ночью: на ночной карте у самолётов горят бортовые огни (красный на левом крыле, зелёный на правом),
   на хвосте мигает белый проблесковый, у кораблей горит топовый огонь, а зенитки и ЗРК водят по небу прожекторами.
   Рисует каждый клиент сам, только ночью и только видимые ему машины. Выключается у себя («Огни ночью»). */
import { SYSTEM_ID } from "./config.mjs";
import { isFlying } from "./scene.mjs";

/** Какие огни у машины: plane, ship, light (прожектор ПВО) или null. */
export function lightsOf(actor) {
  if (!actor || actor.type === "staff") return null;
  if (isFlying(actor)) return "plane";
  const s = actor.system ?? {};
  if (actor.type === "npc" && s.kind === "ship") return actor.getFlag?.(SYSTEM_ID, "unit")?.sub ? null : "ship";
  if (actor.type === "npc" && s.kind === "ground" && s.grp === "ad") return "light";
  return null;
}

/** Точки огней самолёта: rotation — курс токена в градусах (0 — носом вверх), size — сторона токена. */
export function navPoints(cx, cy, rotation, size) {
  const a = (rotation ?? 0) * Math.PI / 180, nx = Math.sin(a), ny = -Math.cos(a), lx = -Math.cos(a), ly = -Math.sin(a);
  const w = size * 0.4, back = size * 0.08, tail = size * 0.42;
  return {
    left: { x: cx + lx * w - nx * back, y: cy + ly * w - ny * back },
    right: { x: cx - lx * w - nx * back, y: cy - ly * w - ny * back },
    tail: { x: cx - nx * tail, y: cy - ny * tail }
  };
}

/** Проблесковый огонь: двойная вспышка раз в 1.4 с (phase — сдвиг, чтобы машины мигали вразнобой). */
export const strobeOn = (t, phase = 0) => { const k = (t + phase) % 1400; return k < 70 || (k > 180 && k < 250); };

/** Луч прожектора: угол (рад) в момент t — медленно ходит по сектору, у каждой установки своя фаза. */
export const beamAngle = (t, phase = 0) => -Math.PI / 2 + Math.sin(t / 2600 + phase) * 0.9;

let gfx = null, ticking = false, acc = 0;
const isOn = () => { try { return game.settings.get(SYSTEM_ID, "fxNight") !== false; } catch { return true; } };
const night = () => canvas?.ready && canvas.scene?.getFlag?.(SYSTEM_ID, "daytime") === "night";
const seen = t => game.user.isGM ? true : !t.document.hidden && t.visible !== false;
const phaseOf = id => [...String(id)].reduce((s, c) => (s * 31 + c.charCodeAt(0)) % 9973, 7);

function layer() {
  if (!canvas?.ready || !canvas.interface) return null;
  if (!gfx || gfx.destroyed) { gfx = canvas.interface.addChildAt(new PIXI.Graphics(), 0); gfx.eventMode = "none"; gfx.name = "tbNightLights"; }
  return gfx;
}

function glow(g, p, color, r, alpha) {
  g.beginFill(color, alpha * 0.18); g.drawCircle(p.x, p.y, r * 3.2); g.endFill();
  g.beginFill(color, alpha * 0.45); g.drawCircle(p.x, p.y, r * 1.7); g.endFill();
  g.beginFill(0xffffff, alpha * 0.9); g.drawCircle(p.x, p.y, r * 0.7); g.endFill();
}

function draw() {
  const g = layer();
  if (!g) return;
  g.clear();
  if (!night() || !isOn()) return;
  const t = performance.now(), gs = canvas.grid?.size ?? 100, r = Math.max(1.5, gs * 0.018);
  for (const tok of canvas.tokens?.placeables ?? []) {
    if (!seen(tok)) continue;
    const kind = lightsOf(tok.actor);
    if (!kind) continue;
    // приглушённые чужие высоты и скрытые ведущему — огни тусклее вместе с машиной
    const a = Math.min(1, tok.mesh?.alpha ?? tok.alpha ?? 1) * (tok.document.hidden ? 0.5 : 1), c = tok.center, size = tok.w ?? gs, ph = phaseOf(tok.id);
    if (kind === "plane") {
      const p = navPoints(c.x, c.y, tok.document.rotation, size);
      glow(g, p.left, 0xff3b30, r, a);
      glow(g, p.right, 0x34e07a, r, a);
      if (strobeOn(t, ph)) glow(g, p.tail, 0xffffff, r * 1.3, a);
    } else if (kind === "ship") {
      glow(g, { x: c.x, y: c.y - size * 0.1 }, 0xfff4d8, r, a);
      if (strobeOn(t, ph)) glow(g, { x: c.x, y: c.y + size * 0.3 }, 0xff3b30, r * 0.8, a * 0.8);
    } else {
      const ang = beamAngle(t, ph % 7), len = gs * 1.6, half = 0.09, o = { x: c.x, y: c.y };
      const tip = k => ({ x: o.x + Math.cos(ang + k) * len, y: o.y + Math.sin(ang + k) * len });
      g.beginFill(0xeef4ff, 0.07 * a); g.moveTo(o.x, o.y); const p1 = tip(-half), p2 = tip(half); g.lineTo(p1.x, p1.y); g.lineTo(p2.x, p2.y); g.closePath(); g.endFill();
      g.beginFill(0xeef4ff, 0.06 * a); g.moveTo(o.x, o.y); const q1 = tip(-half * 0.45), q2 = tip(half * 0.45); g.lineTo(q1.x, q1.y); g.lineTo(q2.x, q2.y); g.closePath(); g.endFill();
      glow(g, o, 0xeef4ff, r * 0.9, a);
    }
  }
}

function tick() {
  acc += canvas?.app?.ticker?.deltaMS ?? 50;
  if (acc < 50) return;
  acc = 0;
  if (document.hidden) return;
  try { draw(); } catch (err) { console.warn(`${SYSTEM_ID} | огни`, err); stopTick(); }
}
function startTick() { const tk = canvas?.app?.ticker; if (ticking || !tk) return; tk.add(tick); ticking = true; }
function stopTick() { canvas?.app?.ticker?.remove(tick); ticking = false; }

/** Ночь и огни включены — рисовать, иначе убрать. */
export function refreshNightLights() {
  if (night() && isOn()) startTick();
  else { stopTick(); gfx?.clear?.(); }
}

export function registerNightLights() {
  game.settings.register(SYSTEM_ID, "fxNight", {
    name: "Огни ночью", hint: "На ночной карте у самолётов горят бортовые огни и мигает проблесковый, у кораблей топовый огонь, у зениток ходят прожекторы. Только у себя.",
    scope: "client", config: true, type: Boolean, default: true, onChange: () => refreshNightLights()
  });
  Hooks.on("canvasReady", () => { gfx = null; refreshNightLights(); });
  Hooks.on("canvasTearDown", () => { stopTick(); gfx = null; });
  Hooks.on("updateScene", (scene, change) => {
    if (scene.id === canvas?.scene?.id && foundry.utils.hasProperty(change, `flags.${SYSTEM_ID}.daytime`)) refreshNightLights();
  });
}
