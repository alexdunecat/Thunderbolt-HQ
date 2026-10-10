// Запуск: node tests/run.mjs (сверяет вывод со снимком в tests/snapshots)
import { fileURLToPath as __f } from "node:url";
import { tmpdir as __tmp } from "node:os";
process.argv[2] ??= __f(new URL("..", import.meta.url)).replace(/\/$/, "");
process.argv[3] ??= __tmp() + "/tb-test-out";
const root = process.argv[2];
const hooks = {}, timers = [];
globalThis.setTimeout = f => timers.push(f); globalThis.clearTimeout = () => {};
globalThis.Hooks = { on: (n, f) => (hooks[n] ??= []).push(f) };
globalThis.CONST = { GRID_TYPES: { GRIDLESS: 0 } };
const cells = [];
const gs = 100;
const tok = (o) => ({ center: { x: o.x + 50, y: o.y + 50 }, document: { x: o.x, y: o.y, width: o.w ?? 1, height: o.h ?? 1, hidden: false, parent: null }, actor: o.actor });
const W = (id, target, reach) => ({ id, type: "weapon", system: { target, reach } });
const wl = [W("laam", "air", 99), W("emrg", "line", 99), W("aam4", "air", 1), W("rcl", "ground", 0)];
const pilot = { uuid: "Actor.p", type: "pilot", system: { alt: "med", lockUuid: "x" }, items: Object.assign([...wl], { get: id => wl.find(w => w.id === id) }) };
globalThis.game = { settings: { register(){}, get: () => true }, user: { isGM: false, targets: { first: () => globalThis.tgt } }, scenes: { viewed: { getFlag: () => [] } } };
globalThis.canvas = { ready: true, dimensions: { width: 1000, height: 800 },
  grid: { type: 1, size: gs, isHexagonal: false, getOffset: p => ({ i: Math.floor(p.y / gs), j: Math.floor(p.x / gs) }), getTopLeftPoint: o => ({ x: o.j * gs, y: o.i * gs }) },
  interface: { grid: { addHighlightLayer: () => ({}), clearHighlightLayer: () => { cells.length = 0; }, highlightPosition: (n, o) => cells.push(o) } },
  tokens: { controlled: [] } };
const { TB } = await import(`${root}/module/config.mjs`);
const { registerRange, toggleAim } = await import(`${root}/module/range.mjs`);
registerRange();
const run = () => { hooks.controlToken[0](); while (timers.length) timers.shift()(); };
const hist = () => { const h = {}; for (const c of cells) h[c.color.toString(16)] = (h[c.color.toString(16)] ?? 0) + 1; return h; };
canvas.tokens.controlled = [tok({ x: 400, y: 400, actor: pilot })];
canvas.tokens.placeables = canvas.tokens.controlled;
run(); console.log("standard:", cells.length, hist());
for (const id of ["laam", "aam4", "rcl", "emrg"]) { toggleAim(pilot, id); run(); console.log(id, cells.length, hist()); toggleAim(pilot, id); }
globalThis.tgt = tok({ x: 700, y: 100, actor: {} }); toggleAim(pilot, "emrg"); run(); console.log("emrg+target", cells.length, cells.map(c => "").length && hist()); toggleAim(pilot, "emrg"); run(); console.log("back to std", cells.length);
