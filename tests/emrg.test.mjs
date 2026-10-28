// EMRG и ESM: какие клетки и машины на линии от самолёта (своя высота, с Низкой — и земля), кого глушит РЭБ.
const root = process.argv[2];
globalThis.Hooks = { on() {}, once() {} };
globalThis.Application = class {};
globalThis.foundry = { utils: { mergeObject: Object.assign, deepClone: o => JSON.parse(JSON.stringify(o)) } };
globalThis.game = { settings: { get: () => true }, user: { isGM: true }, users: { activeGM: { isSelf: true } } };
globalThis.CONFIG = { specialStatusEffects: { DEFEATED: "dead" } };
globalThis.CONST = { GRID_TYPES: { GRIDLESS: 0 } };
const { TB } = await import(`${root}/module/config.mjs`);
const elev = TB.altElevation;
const docs = [], actors = {};
const scene = { grid: { size: 100 }, tokens: docs };
const mk = (name, col, row, alt, sys = {}, type = "npc") => {
  const a = { name, uuid: "Actor." + name, type, isToken: false, statuses: new Set(), items: [], system: { kind: "air", side: "enemy", defense: 6, hp: { value: 3 }, ...sys }, getFlag: () => null };
  const doc = { name, actor: a, x: col * 100, y: row * 100, width: 1, height: 1, elevation: alt === "ground" ? 0 : elev[alt], parent: scene, hidden: false };
  const tok = { name, actor: a, document: doc, center: { x: col * 100 + 50, y: row * 100 + 50 } };
  doc.object = tok; a.getActiveTokens = () => [tok];
  docs.push(doc); actors[a.uuid] = a; return a;
};
globalThis.fromUuidSync = u => actors[u];
globalThis.canvas = { ready: true, scene, dimensions: { sceneRect: { x: 0, y: 0, width: 800, height: 600 } },
  grid: { type: 1, size: 100, getOffset: p => ({ i: Math.floor(p.y / 100), j: Math.floor(p.x / 100) }) },
  get tokens() { return { placeables: docs.map(d => d.object) }; } };
const SW = await import(`${root}/module/special-weapons.mjs`);
const me = mk("Гроза", 2, 2, "low", { side: "player", speed: 2 }, "pilot");
mk("МиГ", 4, 2, "low", { defense: 7 });           // справа на Низкой
mk("Су", 5, 2, "med");                             // справа, но на Средней
mk("Ангар", 6, 2, "ground", { kind: "ground", defense: 5 });
mk("Сокол", 3, 3, "low", { side: "ally", defense: 4 }); // своя на диагонали: тоже на линии
mk("Эсминец", 2, 0, "ground", { kind: "ship", defense: null, systems: [{ name: "ЗРК", occ: 6, value: 2 }, { name: "Мостик", occ: 4, value: 0 }, { name: "Пушка", occ: 5, value: 2 }] });
const lines = SW.railLines(me);
for (const [k, l] of Object.entries(lines)) console.log(k, l.where, l.cells.length, l.units.map(u => `${u.name} ${u.gnd ? "земля" : "воздух"} ${u.vs}${u.ship ? ` «${u.sysName}»` : ""}`).join(", ") || "—");
// ESM: враги-самолёты и вертолёты в своей и соседних зонах (соседняя высота тоже), без земли и своих
mk("Ми-24", 1, 1, "med", { kind: "air" });
mk("Хокай", 2, 2, "high", { kind: "air" });
console.log("ESM:", SW.esmVictims(me, me.getActiveTokens()[0]).map(t => t.name).join(", "));
