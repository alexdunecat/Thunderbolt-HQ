/* Осадки в клетках погоды: косой дождь (на Севере снег), бурые струи пыльной бури, белые полосы ветра,
   спираль торнадо, ливень урагана и вспышки молний с ломаной стрелой. Рисует каждый клиент сам по флагам сцены
   weather (вся карта) и weatherCells (клетки из импорта и кисти погоды), только клетки в окне карты. Частицы считаются
   от времени, а не хранятся, поэтому слой ничего не копит. Вспышку молнии слышит модуль фонового звука (гром).
   Выключается у себя в настройках («Осадки и молнии»). */
import { SYSTEM_ID, TB } from "./config.mjs";

/** Детерминированный шум 0..1 по целым числам: у каждой клетки и частицы свой узор. */
export function hash(a, b = 0, c = 0) {
  let h = (a * 374761393 + b * 668265263 + c * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const mod = (a, n) => ((a % n) + n) % n;

/** Что рисовать по набору погоды клетки: rain, snow, storm, dust, wind, tornado, bolt. Облачность и глаз урагана — ничего:
    облака уже штрихует плитка погоды, а тени облаков ведущий не выбрал. */
export function kindsOf(ids, place = "none") {
  const s = new Set(ids), out = new Set();
  const wet = place === "cold" ? "snow" : "rain";
  if (s.has("hurrW") || s.has("hurrA")) out.add(place === "cold" ? "snow" : "storm");
  if (s.has("rain") || s.has("lightning")) out.add(wet);
  if (s.has("lightning")) out.add("bolt");
  if (s.has("dust")) out.add("dust");
  if (s.has("wind") || s.has("hurrW") || s.has("hurrA")) out.add("wind");
  if (s.has("tornado")) out.add("tornado");
  if (out.has("storm")) out.delete("rain");
  return [...out];
}

/** Клетки с погодой: ключ «c,r» → id погоды. Погода на всю карту ложится на каждую клетку. */
export function weatherCellsOf(scene, cols = 0, rows = 0) {
  const all = (scene?.getFlag?.(SYSTEM_ID, "weather") ?? []).filter(id => TB.weather[id]);
  const cells = new Map();
  if (all.length) for (let c = 0; c < cols; c++) for (let r = 0; r < rows; r++) cells.set(`${c},${r}`, [...all]);
  for (const [k, ids] of Object.entries(scene?.getFlag?.(SYSTEM_ID, "weatherCells") ?? {})) {
    const list = (ids ?? []).filter(id => TB.weather[id]);
    if (list.length) cells.set(k, [...new Set([...(cells.get(k) ?? []), ...list])]);
  }
  return cells;
}

/* Вид частиц: цвет, прозрачность, толщина в долях клетки. */
export const LOOK = {
  rain: { color: 0xb4cce6, alpha: 0.38, w: 0.006 },
  storm: { color: 0xa6c0dc, alpha: 0.45, w: 0.007 },
  snow: { color: 0xf4f8ff, alpha: 0.6, w: 0 },
  dust: { color: 0xd2a462, alpha: 0.42, w: 0.009 },
  wind: { color: 0xf0f4fa, alpha: 0.22, w: 0.004 },
  tornado: { color: 0x5e5850, alpha: 0.7, w: 0 },
  bolt: { color: 0xeef4ff, alpha: 0.9, w: 0.012 }
};

/** Период молнии в клетке (мс) и сдвиг фазы: у соседних клеток вспышки не совпадают. */
export const boltClock = (c, r) => ({ period: 6000 + hash(c, r, 7) * 5000, off: hash(c, r, 11) * 11000 });
export const BOLT_MS = 650;

/** Вспышка молнии в момент t: { n (номер вспышки), k (0..1 от начала) } или null. */
export function boltAt(c, r, t) {
  const { period, off } = boltClock(c, r), x = t + off, local = mod(x, period);
  return local < BOLT_MS ? { n: Math.floor(x / period), k: local / BOLT_MS } : null;
}

/** Ломаная стрела молнии в клетке размером S: от верхнего края вниз, с отростком. */
export function boltPath(c, r, n, S) {
  const pts = [], steps = 6;
  let x = S * (0.25 + hash(c, r, n) * 0.5), y = S * 0.04;
  pts.push([x, y]);
  for (let i = 1; i <= steps; i++) {
    x = Math.min(S * 0.92, Math.max(S * 0.08, x + (hash(c, n, i) - 0.5) * S * 0.22));
    y = S * (0.04 + 0.8 * i / steps);
    pts.push([x, y]);
  }
  const at = 2 + Math.floor(hash(n, r, c) * 3), [bx, by] = pts[at], dir = hash(r, n, 3) < 0.5 ? -1 : 1;
  return { main: pts, fork: [[bx, by], [bx + dir * S * 0.12, by + S * 0.1], [bx + dir * S * 0.18, by + S * 0.22]] };
}

/**
 * Частицы одного вида в клетке (локальные координаты 0..S) в момент t (мс).
 * Отрезки { x1, y1, x2, y2, a } и точки { x, y, r, a }; a — множитель прозрачности.
 */
export function particles(kind, c, r, t, S, density = 1) {
  const out = [], s = t / 1000, n = k => Math.max(1, Math.round(k * density));
  if (kind === "rain" || kind === "storm") {
    const storm = kind === "storm", count = n(storm ? 34 : 22), len = S * (storm ? 0.1 : 0.07), slant = storm ? 0.7 : 0.22;
    for (let i = 0; i < count; i++) {
      const v = S * (storm ? 1.7 : 1.15) * (0.85 + hash(c, r, i * 3) * 0.3);
      const y = mod(hash(c, r, i * 3 + 1) * S + s * v, S - len);
      const x = mod(hash(c, r, i * 3 + 2) * S + y * slant, S - len * slant);
      out.push({ x1: x, y1: y, x2: x + len * slant, y2: y + len, a: 0.6 + hash(r, c, i) * 0.4 });
    }
  } else if (kind === "snow") {
    const count = n(26);
    for (let i = 0; i < count; i++) {
      const v = S * 0.13 * (0.7 + hash(c, r, i * 3) * 0.6), rr = S * (0.006 + hash(r, c, i) * 0.006);
      const y = mod(hash(c, r, i * 3 + 1) * S + s * v, S - rr * 2) + rr;
      const x = mod(hash(c, r, i * 3 + 2) * S + Math.sin(s * 1.3 + i) * S * 0.03, S - rr * 2) + rr;
      out.push({ x, y, r: rr, a: 0.55 + hash(c, i, r) * 0.45 });
    }
  } else if (kind === "dust") {
    const count = n(28), len = S * 0.06;
    for (let i = 0; i < count; i++) {
      const v = S * 0.55 * (0.8 + hash(c, r, i * 3) * 0.4);
      const x = mod(hash(c, r, i * 3 + 1) * S + s * v, S - len);
      const y = mod(hash(c, r, i * 3 + 2) * S + Math.sin(s * 2 + i) * S * 0.04, S * 0.96) + S * 0.02;
      out.push({ x1: x, y1: y, x2: x + len, y2: y + len * 0.12, a: Math.sin(Math.PI * x / S) * (0.6 + hash(r, c, i) * 0.4) });
    }
  } else if (kind === "wind") {
    const count = n(5), len = S * 0.24;
    for (let i = 0; i < count; i++) {
      const v = S * 0.8 * (0.8 + hash(c, r, i * 3) * 0.4);
      const x = mod(hash(c, r, i * 3 + 1) * S + s * v, S - len);
      const y = S * (0.1 + hash(c, r, i * 3 + 2) * 0.8);
      out.push({ x1: x, y1: y, x2: x + len, y2: y - len * 0.04, a: Math.sin(Math.PI * (x + len / 2) / S) });
    }
  } else if (kind === "tornado") {
    const count = n(26);
    for (let i = 0; i < count; i++) {
      const k = (i + 0.5) / count, rad = S * (0.03 + k * 0.34), ang = s * (5.5 - k * 3.5) + i * 2.4;
      out.push({ x: S / 2 + Math.cos(ang) * rad, y: S / 2 + Math.sin(ang) * rad * 0.55 - (1 - k) * S * 0.12, r: S * (0.01 + hash(c, r, i) * 0.012), a: 1 - k * 0.45 });
    }
  }
  return out;
}

/* ---------- рисование: свой слой под схемой боя, перерисовка ~30 раз в секунду ---------- */

const FRAME_MS = 33;
const flashHooks = new Set();
let gfx = null, ticking = false, acc = 0, cells = new Map(), place = "none", seenBolt = new Map();
const isOn = () => { try { return game.settings.get(SYSTEM_ID, "fxWeather") !== false; } catch { return true; } };

/** Подписка на вспышки молнии в окне карты: f({ c, r, near }) — near 0..1, насколько близко к центру экрана. */
export const onFlash = f => { flashHooks.add(f); return () => flashHooks.delete(f); };

function layer() {
  if (!canvas?.ready || !canvas.interface) return null;
  if (!gfx || gfx.destroyed) { gfx = canvas.interface.addChildAt(new PIXI.Graphics(), 0); gfx.eventMode = "none"; gfx.name = "tbWeatherFx"; }
  return gfx;
}

/** Клетки в окне карты (с запасом в клетку) и центр окна. */
function viewCells(S) {
  const sc = canvas.stage.scale.x || 1, p = canvas.stage.pivot, w = window.innerWidth / sc, h = window.innerHeight / sc;
  const d = canvas.dimensions, ox = d.sceneX ?? 0, oy = d.sceneY ?? 0;
  return { c0: Math.floor((p.x - w / 2 - ox) / S) - 1, c1: Math.floor((p.x + w / 2 - ox) / S) + 1, r0: Math.floor((p.y - h / 2 - oy) / S) - 1, r1: Math.floor((p.y + h / 2 - oy) / S) + 1, cx: (p.x - ox) / S, cy: (p.y - oy) / S, span: Math.max(w, h) / S / 2 };
}

function draw() {
  const g = layer();
  if (!g) return;
  g.clear();
  if (!cells.size || !isOn()) return;
  const S = canvas.grid?.size ?? 200, t = performance.now(), v = viewCells(S), d = canvas.dimensions, ox = d.sceneX ?? 0, oy = d.sceneY ?? 0;
  const vis = [...cells].map(([k, ids]) => { const [c, r] = k.split(",").map(Number); return { c, r, ids }; })
    .filter(x => x.c >= v.c0 && x.c <= v.c1 && x.r >= v.r0 && x.r <= v.r1);
  // мелко на карте и много клеток: частиц меньше, чтобы не тормозить
  const density = Math.min(1, 60 / Math.max(1, vis.length)) * (canvas.stage.scale.x < 0.35 ? 0.5 : 1);
  for (const { c, r, ids } of vis) {
    const x0 = ox + c * S, y0 = oy + r * S;
    for (const kind of kindsOf(ids, place)) {
      const L = LOOK[kind];
      if (kind === "bolt") {
        const b = boltAt(c, r, t), key = `${c},${r}`;
        if (!b) continue;
        if (seenBolt.get(key) !== b.n) {
          seenBolt.set(key, b.n);
          const near = Math.max(0, 1 - Math.hypot(c + 0.5 - v.cx, r + 0.5 - v.cy) / Math.max(1, v.span * 1.5));
          for (const f of flashHooks) try { f({ c, r, near }); } catch (err) { console.warn(`${SYSTEM_ID} | гром`, err); }
        }
        // двойное мерцание: вспышка, провал, вспышка слабее
        const a = b.k < 0.15 ? 1 : b.k < 0.3 ? 0.25 : (1 - b.k) * 0.9;
        g.beginFill(0xdfe8ff, 0.14 * a); g.drawRect(x0, y0, S, S); g.endFill();
        const p = boltPath(c, r, b.n, S);
        for (const [line, wk] of [[p.main, 1], [p.fork, 0.6]]) {
          g.lineStyle(Math.max(1, S * L.w * wk), L.color, L.alpha * a);
          g.moveTo(x0 + line[0][0], y0 + line[0][1]);
          for (const [px, py] of line.slice(1)) g.lineTo(x0 + px, y0 + py);
        }
        g.lineStyle(0);
        continue;
      }
      const list = particles(kind, c, r, t, S, density);
      if (L.w) {
        for (const q of list) {
          g.lineStyle(Math.max(1, S * L.w), L.color, L.alpha * q.a);
          g.moveTo(x0 + q.x1, y0 + q.y1); g.lineTo(x0 + q.x2, y0 + q.y2);
        }
        g.lineStyle(0);
      } else for (const q of list) { g.beginFill(L.color, L.alpha * q.a); g.drawCircle(x0 + q.x, y0 + q.y, q.r); g.endFill(); }
    }
  }
}

function tick() {
  acc += canvas?.app?.ticker?.deltaMS ?? FRAME_MS;
  if (acc < FRAME_MS) return;
  acc = 0;
  if (document.hidden) return;
  try { draw(); } catch (err) { console.warn(`${SYSTEM_ID} | осадки`, err); stopTick(); }
}
function startTick() { const tk = canvas?.app?.ticker; if (ticking || !tk) return; tk.add(tick); ticking = true; }
function stopTick() { canvas?.app?.ticker?.remove(tick); ticking = false; }

/** Перечитать погоду сцены: есть что рисовать — включить отрисовку, нет — убрать слой. */
export function refreshWeatherFx() {
  const scene = canvas?.ready ? canvas.scene : null, S = canvas?.grid?.size ?? 200;
  cells = scene && isOn() ? weatherCellsOf(scene, Math.floor((scene.width ?? 0) / S), Math.floor((scene.height ?? 0) / S)) : new Map();
  place = scene?.getFlag?.(SYSTEM_ID, "place") ?? "none";
  seenBolt = new Map();
  if (cells.size) startTick();
  else { stopTick(); gfx?.clear?.(); }
}

export function registerWeatherFx() {
  game.settings.register(SYSTEM_ID, "fxWeather", {
    name: "Осадки и молнии", hint: "В клетках погоды идёт дождь (на Севере снег), метёт пыль и ветер, крутится торнадо, бьют молнии. Только у себя.",
    scope: "client", config: true, type: Boolean, default: true, onChange: () => refreshWeatherFx()
  });
  Hooks.on("canvasReady", () => { gfx = null; refreshWeatherFx(); });
  Hooks.on("canvasTearDown", () => { stopTick(); gfx = null; cells = new Map(); });
  Hooks.on("updateScene", (scene, change) => {
    if (scene.id === canvas?.scene?.id && ["weather", "weatherCells", "-=weatherCells", "place"].some(k => foundry.utils.hasProperty(change, `flags.${SYSTEM_ID}.${k}`))) refreshWeatherFx();
  });
}
