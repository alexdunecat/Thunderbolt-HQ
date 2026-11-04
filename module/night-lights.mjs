/* Огни ночью. На ночной карте всё светится так, как светилось бы в темноте, и по форме самой машины:
   - самолёт: красный огонь на кончике левого крыла, зелёный на правом, белые двойные вспышки стробов на законцовках,
     белый хвостовой и красный проблесковый маяк на фюзеляже; вертолёт ещё светит прожектором перед собой;
   - корабль: топовые огни на мачтах, красный и зелёный бортовые у носа, кормовой, огни надстройки вдоль бортов и тёплый
     отсвет палубы; у авианосца горят огни по краям полётной палубы и осевая линия;
   - колонна и техника: фары вперёд, габариты сзади; здания: окна и красный заградительный огонь на высоких;
   - ЗРК и зенитки водят по небу прожекторами;
   - клетки с городом, деревней, промзоной, портом и аэродромом: окна домов, фонари вдоль улиц, огни причалов и кранов,
     огни полосы аэродрома с бегущим огнём подхода, зарево над городом.
   Где у машины крылья, нос и корма, система узнаёт по самой картинке токена (по непрозрачным точкам), поэтому огни сидят
   на законцовках при любом масштабе и повороте. Свет мягкий, с ореолом, складывается как настоящий (смешение ADD).
   Рисует каждый клиент сам, только ночью и только видимые ему машины. Выключается у себя («Огни ночью»). */
import { SYSTEM_ID } from "./config.mjs";
import { isFlying, hasRule } from "./scene.mjs";

/* ---------- чистая часть ---------- */

/** Какие огни у машины: plane, heli, ship, light (прожектор ПВО), vehicle, building или null. */
export function lightsOf(actor) {
  if (!actor || actor.type === "staff") return null;
  const s = actor.system ?? {};
  if (isFlying(actor)) return actor.type === "npc" && s.grp === "heli" ? "heli" : "plane";
  if (actor.type !== "npc") return null;
  if (s.kind === "ship") return actor.getFlag?.(SYSTEM_ID, "unit")?.sub ? null : "ship";
  if (s.kind === "ground") {
    if (s.grp === "ad") return "light";
    if (["armor", "art"].includes(s.grp) || hasRule(actor, "mobile")) return "vehicle";
    return "building";
  }
  return null;
}

/** Проблесковый огонь: двойная вспышка раз в 1.4 с (phase — сдвиг, чтобы машины мигали вразнобой). */
export const strobeOn = (t, phase = 0) => { const k = (t + phase) % 1400; return k < 70 || (k > 180 && k < 250); };

/** Маяк: плавная красная пульсация раз в секунду, 0…1. */
export const beaconLevel = (t, phase = 0) => Math.pow(Math.max(0, Math.sin((t + phase) / 1000 * Math.PI * 2)), 6);

/** Луч прожектора: угол (рад) в момент t — медленно ходит по сектору, у каждой установки своя фаза. */
export const beamAngle = (t, phase = 0) => -Math.PI / 2 + Math.sin(t / 2600 + phase) * 0.9;

const hash = (n, k = 0) => { const x = Math.sin(n * 127.1 + k * 311.7) * 43758.5453; return x - Math.floor(x); };

/**
 * Форма картинки по прозрачности: px — RGBA (как ImageData.data), w×h. Всё в долях картинки (u вправо, v вниз, нос вверх):
 * rows — [левый, правый] край непрозрачного в каждой строке (или null), top/bottom — первая и последняя строка,
 * left/right — самые крайние точки (законцовки крыльев), cx/cy — центр масс. null — картинка пустая.
 */
export function shapeFromAlpha(px, w, h, th = 40) {
  const rows = [];
  let n = 0, sx = 0, sy = 0, top = -1, bottom = -1, lx = w, rx = -1;
  for (let y = 0; y < h; y++) {
    let a = -1, b = -1;
    for (let x = 0; x < w; x++) if (px[(y * w + x) * 4 + 3] > th) { if (a < 0) a = x; b = x; sx += x; sy += y; n++; }
    rows.push(a < 0 ? null : [a, b]);
    if (a >= 0) { if (top < 0) top = y; bottom = y; lx = Math.min(lx, a); rx = Math.max(rx, b); }
  }
  if (!n) return null;
  const at = (pick, edge) => { let s = 0, k = 0; rows.forEach((r, y) => { if (r && Math.abs(r[pick] - edge) <= 1) { s += y; k++; } }); return k ? s / k : (top + bottom) / 2; };
  return {
    rows: rows.map(r => r && [(r[0] + 0.5) / w, (r[1] + 0.5) / w]),
    top: (top + 0.5) / h, bottom: (bottom + 0.5) / h,
    left: { u: (lx + 0.5) / w, v: (at(0, lx) + 0.5) / h }, right: { u: (rx + 0.5) / w, v: (at(1, rx) + 0.5) / h },
    cx: sx / n / w, cy: sy / n / h
  };
}
/** Запасная форма, если картинку не прочитать: машина во весь токен. */
export const FALLBACK_SHAPE = { rows: Array.from({ length: 20 }, () => [0.3, 0.7]), top: 0.05, bottom: 0.95, left: { u: 0.1, v: 0.55 }, right: { u: 0.9, v: 0.55 }, cx: 0.5, cy: 0.5 };

/** Края строки у v (ближайшая непустая). */
function rowAt(g, v) {
  const n = g.rows.length, i0 = Math.min(n - 1, Math.max(0, Math.round(v * n - 0.5)));
  for (let d = 0; d < n; d++) { const r = g.rows[i0 - d] ?? g.rows[i0 + d]; if (r) return r; }
  return [0.4, 0.6];
}

/**
 * Огни машины в долях её картинки: [{ u, v, c, s, k, ph? }], c — цвет из COLORS, s — размер, k — steady, strobe, beacon,
 * flicker, blink, или лучи { k: "beam", u, v, ang (0 — вперёд по носу), len и wid в долях длины машины }, или отсвет
 * { k: "spill", u, v, len, wid }. opts.carrier — авианосец, opts.tall — высокое здание, opts.seed — разброс окон.
 */
export function layoutFor(kind, g, opts = {}) {
  g = g ?? FALLBACK_SHAPE;
  const L = [], T = g.top, B = g.bottom, Lv = Math.max(0.05, B - T), seed = opts.seed ?? 1;
  const at = f => { const v = T + Lv * f, r = rowAt(g, v); return { v, a: r[0], b: r[1], m: (r[0] + r[1]) / 2 }; };
  if (kind === "plane" || kind === "heli") {
    // у вертолёта самое широкое место — диск винта: огни на бортах фюзеляжа
    const inset = 0.012, mid0 = rowAt(g, g.cy), mc = (mid0[0] + mid0[1]) / 2;
    const left = kind === "heli" ? { u: mc - 0.09, v: g.cy } : { u: g.left.u + inset, v: g.left.v };
    const right = kind === "heli" ? { u: mc + 0.09, v: g.cy } : { u: g.right.u - inset, v: g.right.v };
    L.push({ ...left, c: "red", s: 1, k: "steady" }, { ...right, c: "green", s: 1, k: "steady" });
    if (kind === "plane") L.push({ ...left, c: "white", s: 1.25, k: "strobe" }, { ...right, c: "white", s: 1.25, k: "strobe" });
    const tail = at(0.985);
    L.push({ u: tail.m, v: tail.v, c: "white", s: 0.75, k: "steady" });
    const mid = rowAt(g, g.cy);
    L.push({ u: (mid[0] + mid[1]) / 2, v: g.cy, c: "red", s: 1.1, k: "beacon" });
    if (kind === "heli") {
      const nose = at(0.02);
      L.push({ k: "beam", u: nose.m, v: nose.v, ang: 0, len: 1.25, wid: 0.55, c: "white", a: 0.32 });
    }
    return L;
  }
  if (kind === "ship") {
    const half = r => (r.b - r.a) / 2;
    L.push({ k: "spill", u: at(0.5).m, v: T + Lv / 2, len: Lv * 0.95, wid: Math.max(0.04, half(at(0.5)) * 2), c: "warm", a: 0.2 });
    const m1 = at(0.3), m2 = at(0.56), side = at(0.22), stern = at(0.985);
    L.push({ u: m1.m, v: m1.v, c: "white", s: 1, k: "steady" }, { u: m2.m, v: m2.v, c: "white", s: 0.9, k: "steady" });
    L.push({ u: side.a + 0.01, v: side.v, c: "red", s: 0.95, k: "steady" }, { u: side.b - 0.01, v: side.v, c: "green", s: 0.95, k: "steady" });
    L.push({ u: stern.m, v: stern.v, c: "white", s: 0.8, k: "steady" });
    if (opts.carrier) {
      const n = 22;
      for (let i = 0; i <= n; i++) {
        const r = at(0.04 + i * 0.92 / n), inset = Math.max(0.006, half(r) * 0.1);
        L.push({ u: r.a + inset, v: r.v, c: i % 4 ? "white" : "amber", s: 0.38, k: "steady" }, { u: r.b - inset, v: r.v, c: i % 4 ? "white" : "amber", s: 0.38, k: "steady" });
        if (i > 3 && i < n - 1 && i % 2 === 0) L.push({ u: r.m, v: r.v, c: "amber", s: 0.32, k: "steady" });
      }
      const drop = at(0.97);
      L.push({ u: drop.m - 0.015, v: drop.v, c: "red", s: 0.5, k: "steady" }, { u: drop.m + 0.015, v: drop.v, c: "red", s: 0.5, k: "steady" });
    } else {
      const n = 12;
      for (let i = 0; i < n; i++) {
        if (hash(seed + i, 3) < 0.3) continue;
        const r = at(0.12 + i * 0.72 / n), inset = half(r) * 0.32;
        L.push({ u: (hash(seed + i, 5) < 0.5 ? r.a + inset : r.b - inset), v: r.v, c: "warm", s: 0.42, k: hash(seed + i, 7) < 0.2 ? "flicker" : "steady", ph: hash(seed + i, 9) * 9000 });
      }
    }
    return L;
  }
  if (kind === "vehicle") {
    const f = at(0.04), w = f.b - f.a, r = at(0.97), rw = r.b - r.a;
    for (const k of [0.25, 0.75]) {
      L.push({ k: "beam", u: f.a + w * k, v: f.v, ang: 0, len: 1.15, wid: 0.35, c: "warm", a: 0.3 });
      L.push({ u: f.a + w * k, v: f.v, c: "white", s: 0.55, k: "steady" });
      L.push({ u: r.a + rw * k, v: r.v, c: "red", s: 0.45, k: "steady" });
    }
    return L;
  }
  if (kind === "building") {
    const n = 11;
    for (let i = 0; i < n; i++) {
      const r = at(0.12 + 0.76 * hash(seed + i, 1)), u = r.a + (r.b - r.a) * (0.15 + 0.7 * hash(seed + i, 2));
      if (hash(seed + i, 4) < 0.18) continue;
      L.push({ u, v: r.v, c: hash(seed + i, 6) < 0.2 ? "white" : "warm", s: 0.4, k: hash(seed + i, 8) < 0.15 ? "flicker" : "steady", ph: hash(seed + i, 10) * 12000 });
    }
    if (opts.tall) { const t = at(0.03); L.push({ u: t.m, v: t.v, c: "red", s: 0.8, k: "blink", ph: seed * 137 }); }
    return L;
  }
  if (kind === "light") {
    L.push({ k: "sky", u: g.cx, v: g.cy, c: "sky", s: 0.9 });
    return L;
  }
  return L;
}

/* ---------- огни поселений: координаты в рисунке клетки 200×200 ---------- */

// дома города — те же прямоугольники, что в assets/map/terrain/city.svg
const CITY = [[6,6,15,23],[36,6,25,26],[6,36,24,22],[6,74,17,18],[36,74,25,18],[6,104,18,25],[6,142,15,24],[36,142,21,18],[6,172,21,24],[74,6,20,20],[104,6,26,15],[74,36,18,17],[74,74,19,19],[104,74,26,18],[74,104,19,26],[74,142,24,24],[104,142,22,16],[74,172,16,22],[142,6,24,24],[172,6,18,16],[142,36,14,24],[142,74,15,15],[172,74,23,19],[142,104,14,15],[142,142,18,17],[172,142,20,20],[142,172,23,21]];
const VILLAGE = [[40, 91], [66, 87], [122, 91], [150, 79], [60, 145], [130, 145], [96, 65]];
const rot = (p, deg) => { if (!deg) return p; const a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a), x = p.x - 100, y = p.y - 100; return { ...p, x: 100 + x * c - y * s, y: 100 + x * s + y * c }; };

/** Огни клетки местности: [{ x, y, c, s, k, ph?, i? }] в координатах 0…200; k: steady, flicker, blink, rabbit (i — номер в цепочке), haze. */
export function settlementLights(ter, deg = 0, seed = 1) {
  const L = [], win = (x, y, i) => {
    if (hash(seed + i, 21) < 0.22) return;
    L.push({ x, y, c: hash(seed + i, 22) < 0.18 ? "white" : "warm", s: 0.45, k: hash(seed + i, 23) < 0.12 ? "flicker" : "steady", ph: hash(seed + i, 24) * 15000 });
  };
  if (ter === "city") {
    L.push({ x: 100, y: 100, c: "sodium", s: 9, k: "haze" });
    CITY.forEach(([x, y, w, h], i) => { const n = 1 + Math.floor(w * h / 220); for (let j = 0; j < n; j++) win(x + 3 + (w - 6) * hash(i * 7 + j, 31), y + 3 + (h - 6) * hash(i * 7 + j, 32), i * 7 + j); });
    for (const p of [66, 134]) for (let t = 10; t < 200; t += 20) { if (Math.abs(t - 66) < 6 || Math.abs(t - 134) < 6) continue; L.push({ x: t, y: p, c: "sodium", s: 0.55, k: "steady" }, { x: p, y: t, c: "sodium", s: 0.55, k: "steady" }); }
    [[66, 66], [134, 66], [66, 134], [134, 134]].forEach(([x, y], i) => L.push({ x, y, c: i % 2 ? "green" : "red", s: 0.45, k: "steady" }));
  } else if (ter === "village") {
    L.push({ x: 100, y: 105, c: "warm", s: 6, k: "haze" });
    VILLAGE.forEach(([x, y], i) => { win(x - 3, y, i * 2); win(x + 3, y, i * 2 + 1); });
    // фонари вдоль дороги M0 120 Q60 100 100 110 T200 92
    const q = (t, a, b, c) => (1 - t) * (1 - t) * a + 2 * (1 - t) * t * b + t * t * c;
    for (const t of [0.25, 0.75]) L.push({ x: q(t, 0, 60, 100), y: q(t, 120, 100, 110), c: "sodium", s: 0.6, k: "steady" }, { x: q(t, 100, 140, 200), y: q(t, 110, 120, 92), c: "sodium", s: 0.6, k: "steady" });
  } else if (ter === "industry") {
    L.push({ x: 100, y: 100, c: "sodium", s: 7, k: "haze" });
    for (const [x0, y0] of [[20, 46], [110, 126]]) for (let i = 0; i < 6; i++) win(x0 + 5 + i * 9.5, y0 + 17, x0 + i);
    L.push({ x: 82, y: 26, c: "red", s: 0.8, k: "blink", ph: 0 }, { x: 172, y: 106, c: "red", s: 0.8, k: "blink", ph: 700 });
    for (const [cx, cy, r] of [[150, 70, 20], [50, 160, 16]]) for (const a of [0.6, 2.4, 4.2]) L.push({ x: cx + Math.cos(a) * (r + 3), y: cy + Math.sin(a) * (r + 3), c: "sodium", s: 0.7, k: "steady" });
  } else if (ter === "port") {
    L.push({ x: 100, y: 90, c: "sodium", s: 6, k: "haze" });
    for (let x = 12; x < 200; x += 24) L.push({ x, y: 112, c: "sodium", s: 0.6, k: "steady" });
    L.push({ x: 40, y: 176, c: "green", s: 0.7, k: "steady" }, { x: 100, y: 166, c: "red", s: 0.7, k: "steady" }, { x: 160, y: 176, c: "green", s: 0.7, k: "steady" });
    L.push({ x: 120, y: 44, c: "red", s: 0.8, k: "blink", ph: 300 }, { x: 170, y: 44, c: "red", s: 0.7, k: "blink", ph: 900 }, { x: 150, y: 62, c: "white", s: 0.6, k: "steady" });
    for (const [x0, y0] of [[22, 76], [58, 76]]) for (let i = 0; i < 3; i++) win(x0 + 6 + i * 9, y0 + 9, x0 + i);
  } else if (ter === "base") {
    // полоса повёрнута на −20° вокруг центра клетки, как в рисунке
    const R = p => rot(p, -20);
    for (let x = 22; x <= 178; x += 13) L.push(R({ x, y: 86, c: "white", s: 0.42, k: "steady" }), R({ x, y: 114, c: "white", s: 0.42, k: "steady" }));
    for (const y of [90, 97, 103, 110]) L.push(R({ x: 18, y, c: "green", s: 0.5, k: "steady" }), R({ x: 182, y, c: "red", s: 0.5, k: "steady" }));
    for (let i = 0; i < 6; i++) L.push(R({ x: 74 - i * 9, y: 100, c: "white", s: 0.7, k: "rabbit", i }));
    L.push({ x: 58, y: 168, c: "warm", s: 0.6, k: "steady" }, { x: 134, y: 48, c: "warm", s: 0.6, k: "steady" });
    L.push({ x: 176, y: 166, c: "green", s: 0.8, k: "blink", ph: 0 }, { x: 176, y: 166, c: "white", s: 0.8, k: "blink", ph: 1000 });
  }
  return deg ? L.map(p => rot(p, deg)) : L;
}

/** Яркость огня в момент t (0…1) по его виду. */
export function lightLevel(l, t) {
  const ph = l.ph ?? 0;
  if (l.k === "strobe") return strobeOn(t, ph) ? 1 : 0;
  if (l.k === "beacon") return 0.12 + 0.88 * beaconLevel(t, ph);
  if (l.k === "blink") return ((t + ph) % 2000) < 900 ? 1 : 0.06;
  if (l.k === "flicker") { const k = Math.floor((t + ph) / 4000); return hash(k, ph) < 0.35 ? 0.08 : 1; }
  if (l.k === "rabbit") { const k = ((t / 90) % 14) | 0; return k === l.i ? 1 : 0; }
  return 1;
}

/* ---------- рисование ---------- */

export const COLORS = { red: 0xff2a1f, green: 0x2bff8a, white: 0xf2f6ff, warm: 0xffc46b, sodium: 0xff9838, amber: 0xffb02e, sky: 0xdfeaff };
const isOn = () => { try { return game.settings.get(SYSTEM_ID, "fxNight") !== false; } catch { return true; } };
const night = () => canvas?.ready && canvas.scene?.getFlag?.(SYSTEM_ID, "daytime") === "night";
const seen = t => game.user.isGM ? true : !t.document.hidden && t.visible !== false;
const phaseOf = id => [...String(id)].reduce((s, c) => (s * 31 + c.charCodeAt(0)) % 9973, 7);
const silhouette = src => /\/([\w-]+)\.(?:svg|webp|png)(?:\?.*)?$/i.exec(String(src ?? ""))?.[1] ?? "";
const CARRIERS = ["nimitz", "kuznetsov"], TALL = ["radar", "comms", "powerplant", "refinery", "factory", "atc", "hq", "silo", "solgrelay", "hitech"];

let tex = null;
/** Текстуры света: мягкое пятно и конус луча (вершина слева, луч вправо). */
function textures() {
  if (tex) return tex;
  const glowC = document.createElement("canvas"); glowC.width = glowC.height = 64;
  const g = glowC.getContext("2d"), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  [[0, 1], [0.08, 0.95], [0.2, 0.55], [0.4, 0.2], [0.7, 0.05], [1, 0]].forEach(([o, a]) => gr.addColorStop(o, `rgba(255,255,255,${a})`));
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  const coneC = document.createElement("canvas"); coneC.width = 128; coneC.height = 64;
  const c = coneC.getContext("2d");
  try { c.filter = "blur(3px)"; } catch { /* без размытия */ }
  const lg = c.createLinearGradient(0, 0, 128, 0);
  lg.addColorStop(0, "rgba(255,255,255,0.9)"); lg.addColorStop(0.35, "rgba(255,255,255,0.45)"); lg.addColorStop(1, "rgba(255,255,255,0)");
  c.fillStyle = lg; c.beginPath(); c.moveTo(4, 32); c.lineTo(124, 6); c.lineTo(124, 58); c.closePath(); c.fill();
  tex = { glow: PIXI.Texture.from(glowC), cone: PIXI.Texture.from(coneC) };
  return tex;
}

/** Пул спрайтов: каждый кадр раздаёт их заново, лишние прячет. */
class Pool {
  constructor(parent) { this.parent = parent; this.list = []; this.n = 0; }
  begin() { this.n = 0; }
  take(t, anchorX = 0.5) {
    let s = this.list[this.n];
    if (!s || s.destroyed) { s = new PIXI.Sprite(t); s.blendMode = PIXI.BLEND_MODES.ADD; s.eventMode = "none"; this.parent.addChild(s); this.list[this.n] = s; }
    if (s.texture !== t) s.texture = t;
    s.anchor.set(anchorX, 0.5); s.visible = true; s.rotation = 0; this.n++;
    return s;
  }
  end() { for (let i = this.n; i < this.list.length; i++) if (this.list[i] && !this.list[i].destroyed) this.list[i].visible = false; }
}
function glow(pool, x, y, color, r, alpha) {
  if (alpha <= 0.01) return;
  const T = textures();
  const h = pool.take(T.glow); h.position.set(x, y); h.width = h.height = r * 2; h.tint = color; h.alpha = alpha * 0.85;
  const c = pool.take(T.glow); c.position.set(x, y); c.width = c.height = r * 0.55; c.tint = 0xffffff; c.alpha = Math.min(1, alpha * 1.1);
}
function cone(pool, x, y, ang, len, wid, color, alpha) {
  const s = pool.take(textures().cone, 0); s.position.set(x, y); s.rotation = ang; s.width = len; s.height = wid; s.tint = color; s.alpha = alpha;
}

/** Отсвет на карте: мягкое пятно без белой серёдки. */
function wash(pool, x, y, color, r, alpha) {
  if (alpha <= 0.01) return;
  const h = pool.take(textures().glow); h.position.set(x, y); h.width = h.height = r * 3.2; h.tint = color; h.alpha = Math.min(1, alpha);
}

/* ---------- вспышки ночью: взрывы, выстрелы, трассеры, ракеты, ловушки, пожары и молнии подсвечивают карту ---------- */

export const FLASH = { boom: 0xff9a3c, muzzle: 0xffd27a, tracer: 0xffcf5a, missile: 0xffe2b0, beam: 0x9fe8ff, flare: 0xfff0c8, fire: 0xff7a1a, bolt: 0xcfdcff };
/**
 * Яркость вспышки (0..1) на доле жизни k: boom — резкий подъём и спад, steady — ровный свет (трассер, ракета),
 * fire — мерцание с медленным угасанием (горящие обломки, ловушки), bolt — двойное мерцание молнии.
 */
export function flashLevel(k, kind = "boom", t = 0, seed = 0) {
  if (!(k >= 0) || k >= 1) return 0;
  if (kind === "bolt") return k < 0.15 ? 1 : k < 0.3 ? 0.25 : (1 - k) * 0.9;
  if (kind === "steady") return Math.min(1, k / 0.05) * (k > 0.85 ? (1 - k) / 0.15 : 1);
  if (kind === "fire") return (0.72 + 0.28 * Math.sin(t / 83 + seed) * Math.sin(t / 31 + seed * 2.3)) * Math.min(1, k / 0.01) * Math.sqrt(1 - k);
  return k < 0.06 ? k / 0.06 : (1 - (k - 0.06) / 0.94) ** 2;
}
/** Затемнение машин в свете молнии: силуэты на фоне вспышки. */
export function mixColor(a, b, k) {
  const ch = (c, sh) => (c >> sh) & 255, m = sh => Math.round(ch(a, sh) + (ch(b, sh) - ch(a, sh)) * k);
  return (m(16) << 16) | (m(8) << 8) | m(0);
}

const flashes = [], MAX_FLASHES = 200;
/**
 * Вспышка на ночной карте. at — точка или функция точки (движется с трассером или ракетой; null — погасла).
 * r — радиус отсвета в клетках, over — доля света поверх машин (их тоже освещает).
 */
export function nightFlash(at, { r = 1, life = 700, a = 0.8, color = FLASH.boom, kind = "boom", over = 0.3, near = 1 } = {}) {
  if (!at || !night() || !isOn()) return;
  if (flashes.length >= MAX_FLASHES) flashes.splice(0, flashes.findIndex(f => f.kind !== "fire") + 1 || 1);
  flashes.push({ at, r, life, a, color, kind, over, near, t0: performance.now(), seed: Math.random() * 10 });
  startTick();
}

const tinted = new Map();   // токен → его цвет до молнии
function silhouettes(dark) {
  if (dark > 0.02) {
    const shade = mixColor(0xffffff, 0x10141f, Math.min(0.85, dark));
    for (const tok of canvas.tokens?.placeables ?? []) {
      const m = tok.mesh;
      if (!m || m.destroyed) continue;
      if (!tinted.has(tok)) tinted.set(tok, Number(m.tint ?? 0xffffff));
      m.tint = mixColor(tinted.get(tok), 0x10141f, Math.min(0.85, dark)) || shade;
    }
    return;
  }
  for (const [tok, c] of tinted) {
    try { if (tok.mesh && !tok.mesh.destroyed) { tok.mesh.tint = c; tok.renderFlags?.set?.({ refreshMesh: true }); } } catch { /* токен снят */ }
  }
  tinted.clear();
}

/** Отсветы вспышек: на карте (под машинами) и поверх машин; возвращает силу затемнения машин от молний. */
function drawFlashes(t, gs, under) {
  let dark = 0;
  for (let i = flashes.length - 1; i >= 0; i--) {
    const f = flashes[i], k = (t - f.t0) / f.life, p = typeof f.at === "function" ? f.at() : f.at;
    if (k >= 1 || !p) { if (under) flashes.splice(i, 1); continue; }
    const lv = flashLevel(k, f.kind, t, f.seed) * f.a;
    if (f.kind === "bolt") {
      if (under) {
        // вся карта на миг светлеет, у самой молнии — ярче
        const R = canvas.dimensions.sceneRect, s = gpool.take(PIXI.Texture.WHITE);
        s.position.set(R.x + R.width / 2, R.y + R.height / 2); s.width = R.width; s.height = R.height; s.tint = f.color; s.alpha = lv * (0.12 + 0.16 * f.near);
        wash(gpool, p.x, p.y, f.color, gs * f.r, lv * 0.7);
      } else dark = Math.max(dark, lv * (0.45 + 0.4 * f.near));
      continue;
    }
    if (under) wash(gpool, p.x, p.y, f.color, gs * f.r, lv);
    else wash(pool, p.x, p.y, f.color, gs * f.r * 0.55, lv * f.over);
  }
  return dark;
}
export const flashCount = () => flashes.length;

/* форма машины по картинке: считается один раз на картинку */
const shapes = new Map();
function shapeOf(mesh) {
  const t = mesh?.texture, src = t?.baseTexture?.resource?.src ?? t?.baseTexture?.cacheId ?? t?.baseTexture?.uid;
  if (!t || src == null) return FALLBACK_SHAPE;
  if (shapes.has(src)) return shapes.get(src) ?? FALLBACK_SHAPE;
  let g = null;
  try {
    const img = t.baseTexture.resource?.source;
    const tw = t.width || 1, th = t.height || 1, W = 96, H = Math.max(8, Math.round(96 * th / tw));
    const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
    const cx = cv.getContext("2d", { willReadFrequently: true });
    cx.drawImage(img, 0, 0, W, H);
    g = shapeFromAlpha(cx.getImageData(0, 0, W, H).data, W, H);
  } catch (err) { g = null; }
  shapes.set(src, g);
  return g ?? FALLBACK_SHAPE;
}
/** Точка картинки (доли u, v) в координатах сцены с учётом масштаба, зеркала и поворота токена. */
function toWorld(mesh, u, v) {
  const t = mesh.texture, ax = mesh.anchor?.x ?? 0.5, ay = mesh.anchor?.y ?? 0.5;
  const lx = (u - ax) * t.width * mesh.scale.x, ly = (v - ay) * t.height * mesh.scale.y, r = mesh.rotation ?? 0, c = Math.cos(r), s = Math.sin(r);
  return { x: mesh.position.x + lx * c - ly * s, y: mesh.position.y + lx * s + ly * c };
}

let root = null, pool = null, ground = null, gpool = null, glights = [], ticking = false, acc = 0;
function layers() {
  if (!canvas?.ready || !canvas.interface) return false;
  if (!root || root.destroyed) { root = canvas.interface.addChildAt(new PIXI.Container(), 0); root.eventMode = "none"; root.name = "tbNightLights"; pool = new Pool(root); }
  if (!ground || ground.destroyed) {
    // огни поселений и отсветы вспышек — под токенами, над картой
    const PG = foundry.canvas?.primary?.PrimaryGraphics ?? (typeof PrimaryGraphics === "function" ? PrimaryGraphics : null);
    if (PG && canvas.primary) {
      ground = canvas.primary.addChild(new PG({ name: "tbNightGround" }));
      const L = foundry.canvas?.groups?.PrimaryCanvasGroup?.SORT_LAYERS ?? (typeof PrimaryCanvasGroup === "function" ? PrimaryCanvasGroup.SORT_LAYERS : null);
      // над ночной заливкой (daytime.mjs), но под тенями и токенами: свет ложится на карту, а не тонет в темноте
      ground.elevation = 0; ground.sortLayer = L?.TOKENS ?? 700; ground.sort = -1e7 + 50;
    } else ground = canvas.interface.addChildAt(new PIXI.Container(), 0);
    ground.eventMode = "none"; gpool = new Pool(ground);
    buildGround();
  }
  return true;
}

/* поворот рисунка порта: причалы к соседней воде (как при импорте миссии) */
const WET = ["sea", "lake", "port"], DIRS = [[1, 0, 0], [0, 1, 90], [-1, 0, 180], [0, -1, 270]];
function portRot(cells, c, r) {
  const ter = (dc, dr) => cells[`${c + dc},${r + dr}`] ?? null;
  const pick = DIRS.find(([dc, dr]) => WET.includes(ter(dc, dr))) ?? DIRS.find(([dc, dr]) => ter(dc, dr) === null) ?? DIRS[0];
  return (pick[2] + 270) % 360;
}
function buildGround() {
  glights = [];
  const cells = canvas.scene?.getFlag?.(SYSTEM_ID, "terrainCells"), gs = canvas.grid?.size;
  if (!cells || !gs) return;
  for (const [k, ter] of Object.entries(cells)) {
    if (!["city", "village", "industry", "port", "base"].includes(ter)) continue;
    const [c, r] = k.split(",").map(Number), deg = ter === "port" ? portRot(cells, c, r) : 0;
    for (const l of settlementLights(ter, deg, c * 31 + r * 17 + 1)) glights.push({ ...l, x: c * gs + l.x / 200 * gs, y: r * gs + l.y / 200 * gs });
  }
}

function draw() {
  if (!layers()) return;
  const show = night() && isOn();
  root.visible = ground.visible = show;
  if (!show) { flashes.length = 0; silhouettes(0); return; }
  const t = performance.now(), gs = canvas.grid?.size ?? 100, u = gs / 200;
  // поселения
  gpool.begin();
  for (const l of glights) {
    const lv = lightLevel(l, t);
    if (l.k === "haze") { glow(gpool, l.x, l.y, COLORS[l.c], l.s * 22 * u, 0.16); continue; }
    glow(gpool, l.x, l.y, COLORS[l.c] ?? COLORS.warm, l.s * 9 * u, lv * 0.95);
  }
  // горящие машины (метка Doom) освещают всё вокруг, отсвет дрожит
  for (const tok of canvas.tokens?.placeables ?? []) {
    if (!tok.actor?.system?.markers?.doom || !seen(tok) || tok.document.hidden && !game.user.isGM) continue;
    const c = tok.center, ph = phaseOf(tok.id), fl = 0.7 + 0.3 * Math.sin(t / 77 + ph) * Math.sin(t / 29 + ph * 1.7);
    wash(gpool, c.x, c.y, FLASH.fire, Math.max(tok.w, tok.h) * 0.9, 0.75 * fl);
  }
  drawFlashes(t, gs, true);
  gpool.end();
  // машины
  pool.begin();
  for (const tok of canvas.tokens?.placeables ?? []) {
    if (!seen(tok) || !tok.mesh || tok.mesh.destroyed || !tok.mesh.texture?.valid) continue;
    let kind = lightsOf(tok.actor);
    if (!kind) continue;
    const unknown = !game.user.isGM && tok.document.getFlag?.(SYSTEM_ID, "unknown");
    if (unknown) kind = kind === "light" ? "light" : "plane";
    // приглушённые чужие высоты и скрытые ведущему — огни тусклее вместе с машиной
    const a = Math.min(1, tok.mesh.alpha ?? 1) * (tok.document.hidden ? 0.5 : 1), mesh = tok.mesh, ph = phaseOf(tok.id);
    const len = Math.abs(mesh.texture.height * mesh.scale.y), wid = Math.abs(mesh.texture.width * mesh.scale.x), size = Math.max(len, wid);
    const b = Math.max(1.6, size * 0.024), fwd = (mesh.rotation ?? 0) - Math.PI / 2 * Math.sign(mesh.scale.y || 1);
    const key = tok.actor?.system?.key ?? "", sil = silhouette(tok.document.texture?.src);
    // раскладка огней зависит только от вида, формы картинки и машины: считается раз, а не 30 раз в секунду
    const shape = kind === "light" ? null : shapeOf(mesh), lk = `${kind}|${sil}|${key}|${ph}`;
    let lay = tok._tbLights?.k === lk && tok._tbLights.shape === shape ? tok._tbLights.lay : null;
    if (!lay) {
      lay = layoutFor(kind, shape, { carrier: /carrier/.test(sil) || CARRIERS.includes(key) || /carrier/.test(key), tall: TALL.includes(key), seed: ph });
      tok._tbLights = { k: lk, shape, lay };
    }
    for (const l of lay) {
      if (l.k === "sky") {
        const ang = beamAngle(t, ph % 7), o = tok.center, L = gs * 1.7;
        cone(pool, o.x, o.y, ang, L, gs * 0.42, COLORS.sky, 0.16 * a);
        glow(pool, o.x + Math.cos(ang) * L * 0.92, o.y + Math.sin(ang) * L * 0.92, COLORS.sky, gs * 0.16, 0.18 * a);
        glow(pool, o.x, o.y, COLORS.sky, b * 4, 0.9 * a);
        continue;
      }
      const p = toWorld(mesh, l.u, l.v);
      if (l.k === "beam") { cone(pool, p.x, p.y, fwd + (l.ang ?? 0), len * l.len, len * l.wid, COLORS[l.c], (l.a ?? 0.3) * a); continue; }
      if (l.k === "spill") {
        const s = pool.take(textures().glow); s.position.set(p.x, p.y); s.rotation = fwd + Math.PI / 2; s.width = wid * l.wid * 3.2; s.height = len * l.len * 1.15; s.tint = COLORS[l.c]; s.alpha = l.a * a;
        continue;
      }
      const lv = lightLevel({ ...l, ph: (l.ph ?? 0) + ph }, t);
      if (l.k === "strobe") { if (lv) glow(pool, p.x, p.y, COLORS.white, b * 9 * l.s, a); continue; }
      glow(pool, p.x, p.y, COLORS[l.c], b * 5 * l.s, lv * a);
    }
  }
  silhouettes(drawFlashes(t, gs, false));
  pool.end();
}

function tick() {
  acc += canvas?.app?.ticker?.deltaMS ?? 33;
  if (acc < 33) return;
  acc = 0;
  if (document.hidden) return;
  try { draw(); } catch (err) { console.warn(`${SYSTEM_ID} | огни`, err); stopTick(); }
}
function startTick() { const tk = canvas?.app?.ticker; if (ticking || !tk) return; tk.add(tick); ticking = true; }
function stopTick() { canvas?.app?.ticker?.remove(tick); ticking = false; }
function hide() { if (root && !root.destroyed) root.visible = false; if (ground && !ground.destroyed) ground.visible = false; }

/** Ночь и огни включены — рисовать, иначе убрать. */
export function refreshNightLights() {
  if (night() && isOn()) startTick();
  else { stopTick(); hide(); }
}

export function registerNightLights() {
  game.settings.register(SYSTEM_ID, "fxNight", {
    name: "Огни ночью", hint: "На ночной карте у самолётов горят бортовые огни, стробы и маяк, у кораблей топовые и бортовые огни, у техники фары, у зениток ходят прожекторы, в городах, портах и на аэродромах горят окна, фонари и огни полосы. Взрывы, выстрелы, трассеры, ракеты, ловушки и пожары подсвечивают карту вокруг, молния на миг заливает её светом. Только у себя.",
    scope: "client", config: true, type: Boolean, default: true, onChange: () => refreshNightLights()
  });
  Hooks.on("canvasReady", () => { root = ground = null; refreshNightLights(); });
  Hooks.on("canvasTearDown", () => { stopTick(); root = ground = null; flashes.length = 0; tinted.clear(); });
  // молния в грозу: ночью заливает карту светом, машины на миг становятся силуэтами
  import("./weather-fx.mjs").then(W => W.onFlash(({ c, r, near }) => {
    const gs = canvas?.grid?.size, d = canvas?.dimensions;
    if (!gs || !d) return;
    nightFlash({ x: (d.sceneX ?? 0) + (c + 0.5) * gs, y: (d.sceneY ?? 0) + (r + 0.5) * gs }, { kind: "bolt", r: 4, life: W.BOLT_MS, a: 1, color: FLASH.bolt, near });
  })).catch(() => { /* без погоды */ });
  Hooks.on("updateScene", (scene, change) => {
    if (scene.id !== canvas?.scene?.id) return;
    if (foundry.utils.hasProperty(change, `flags.${SYSTEM_ID}.terrainCells`)) buildGround();
    if (foundry.utils.hasProperty(change, `flags.${SYSTEM_ID}.daytime`)) refreshNightLights();
  });
}
