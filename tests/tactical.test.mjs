// Подсветка хода: куда долетит машина и за сколько действий, «Полный газ», торнадо, суша для кораблей, угрозы по зонам, «отсюда достану».
import { fileURLToPath as __f } from "node:url";
import fs from "node:fs";
process.argv[2] ??= __f(new URL("..", import.meta.url)).replace(/\/$/, "");
const R = process.argv[2];
const F = class { constructor(...a) { this.a = a; } };
const sceneFlags = { weatherCells: { "4,2": ["tornado"], "6,6": ["lightning"], "1,6": ["dust"] }, terrainCells: { "2,2": "land", "3,2": "sea", "2,3": "sea", "3,3": "sea", "4,4": "sea" } };
const scene = { id: "S", grid: { size: 100, type: 1 }, getFlag: (s, k) => sceneFlags[k] ?? null };
let combatFlags = {};
const combat = { id: "C1", started: true, round: 2, combatant: null, combatants: [], getFlag: (s, k) => combatFlags[k] ?? null, scene };
Object.assign(globalThis, {
  foundry: { utils: { deepClone: x => structuredClone(x), mergeObject: Object.assign, getProperty: () => undefined, hasProperty: () => false }, abstract: { TypeDataModel: class {} },
    data: { fields: { NumberField: F, StringField: F, BooleanField: F, SchemaField: F, ArrayField: F, HTMLField: F, ObjectField: F } } },
  CONST: { DOCUMENT_OWNERSHIP_LEVELS: { LIMITED: 1 }, GRID_TYPES: { GRIDLESS: 0 } },
  Hooks: { on() {}, once() {} }, CONFIG: { sounds: {}, specialStatusEffects: { DEFEATED: "dead" } },
  game: { user: { id: "pl", isGM: false }, users: [], macros: [], folders: [], messages: { contents: [] }, combat, settings: { get: () => null }, actors: [], scenes: { viewed: scene } },
  ui: { notifications: { warn() {}, info() {} } }, ChatMessage: { create: () => null },
  Actor: class {}, Item: class {}, Combat: class {}, Application: class {}, FormApplication: class {}, ActorSheet: class {}, Dialog: class {}, fromUuidSync: () => null
});
globalThis.canvas = { ready: true, scene, grid: { type: 1, size: 100, getOffset: p => ({ i: Math.floor(p.y / 100), j: Math.floor(p.x / 100) }), measurePath: ([a, b]) => ({ spaces: Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) / 100 }) }, tokens: { placeables: [], controlled: [] } };
const packs = JSON.parse(fs.readFileSync(R + "/tests/fixtures/npcs.json", "utf8"));
const T = await import(R + "/module/tactical.mjs");
const C = await import(R + "/module/documents/combat.mjs");
const tok = (name, actor, col, row, elev = 2) => {
  const t = { name, actor, w: 33, h: 33, visible: true, document: { id: name, parent: scene, x: col * 100 + 33, y: row * 100 + 33, width: 0.33, height: 0.33, elevation: elev, hidden: false, getFlag: () => null } };
  t.center = { x: col * 100 + 50, y: row * 100 + 50 };
  t.document.object = t; t.document.actor = actor;
  return t;
};
const npc = key => { const d = structuredClone(packs[key]); return { name: d.name, type: "npc", uuid: "Actor." + key, system: { side: "enemy", ...d.system }, items: [], statuses: new Set(), getFlag: () => null }; };
const pilot = (items = []) => ({ name: "Гроза", type: "pilot", uuid: "Actor.g", system: { speed: 2, alt: "med" }, items, statuses: new Set(), getFlag: () => null });
const bounds = { cols: 8, rows: 8 };
const grid = (cells, at) => {
  const rows = [];
  for (let r = 0; r < 8; r++) {
    let line = "";
    for (let c = 0; c < 8; c++) { const x = cells.get(`${c},${r}`); line += c === at.col && r === at.row ? " @" : !x ? " ." : x.punch ? ` ${String(x.cost).replace("1", "*")}` : ` ${x.cost}`; }
    rows.push(line);
  }
  return rows.join("\n");
};

// пилот в (3,3), два действия: кольца 1 и 2; торнадо в (4,2): выход из него за 2
const g = tok("Гроза", pilot(), 3, 3);
console.log("пилот, 2 действия (торнадо в 4,2):\n" + grid(T.moveCells(g, { left: 2, bounds }), { col: 3, row: 3 }));
console.log("в торнадо (4,2), 1 действие:", [...T.moveCells(tok("Гроза", pilot(), 4, 2), { left: 1, bounds }).keys()].join(" "), "· 2 действия:", T.moveCells(tok("Гроза", pilot(), 4, 2), { left: 2, bounds }).size, "клеток");
// «Полный газ»: одним действием до 3 зон
const punch = { type: "trigger", name: "Полный газ", system: { key: "punch", used: false } };
const gp = tok("Гроза", pilot([punch]), 3, 3);
console.log("с «Полным газом», 1 действие (* — только с ним):\n" + grid(T.moveCells(gp, { left: 1, bounds }), { col: 3, row: 3 }));
punch.system.used = true;
console.log("«Полный газ» уже использован:", [...T.moveCells(gp, { left: 1, bounds }).values()].filter(c => c.punch).length, "клеток с ним");
// корабль не выходит на сушу (2,2 — суша; где карты нет, клетка считается водой... только описанные клетки)
const ship = tok("Современный", npc("sovremenny"), 3, 3, 1);
console.log("эсминец, 1 действие:", [...T.moveCells(ship, { left: 1, bounds }).keys()].sort().join(" "));

// сколько действий осталось: заявка и сделанное
const cmb = { id: "cb", tokenId: "Гроза", actor: g.actor, initiative: null, parent: combat, getFlag: (s, k) => k === "acts" ? { round: 2, used: 1, rolled: false, list: ["Move"] } : null };
combat.combatants = [cmb]; combat.combatants.find = Array.prototype.find;
console.log("без заявки:", JSON.stringify(T.movesLeft(g.actor, g)));
combat.combatant = cmb; combatFlags.ready = 2;
cmb.initiative = C.PASS + 3;
console.log("заявлено 3, сделано 1, свой ход:", JSON.stringify(T.movesLeft(g.actor, g)));
combat.combatant = null;
console.log("не свой ход:", JSON.stringify(T.movesLeft(g.actor, g)));

// угрозы: ЗРК С-300 в (5,5), «Нимиц» в (1,1), удар по площади, погода; свои и союзники — не угроза
const sam = tok("С-300", npc("s300"), 5, 5, 1), nimitz = tok("Нимиц", npc("nimitz"), 1, 1, 1), friend = tok("Свой ЗРК", { ...npc("s300"), system: { ...npc("s300").system, side: "ally" } }, 0, 7, 1);
const hiddenSam = tok("Тайный ЗРК", npc("s300"), 7, 0, 1); hiddenSam.document.hidden = true;
const mig = tok("МиГ", { ...npc("f15c"), name: "МиГ" }, 4, 4);
combatFlags.strikes = [{ kind: "burst", zones: ["2,5"], alts: ["ground", "low", "med"], round: 2 }];
const th = T.threatCells(g, { tokens: [g, sam, nimitz, friend, hiddenSam, mig], combat });
console.log("угрозы на Средней:", [...th].sort().map(([k, l]) => `${k}:${l.map(t => t.what + (t.quiet ? "·тихо" : "")).join("+")}`).join(" "));
const gs = tok("Гроза", pilot(), 3, 3, 4);
console.log("угрозы в стратосфере:", [...T.threatCells(gs, { tokens: [gs, sam, nimitz, mig], combat })].map(([k, l]) => `${k}:${l.map(t => t.what).join("+")}`).join(" ") || "нет");
// отсюда достану
const r1 = T.reachFrom(g, { col: 4, row: 4 }, { tokens: [g, sam, nimitz, mig] }), r2 = T.reachFrom(g, { col: 2, row: 2 }, { tokens: [g, sam, nimitz, mig] });
console.log("из 4,4: захват", r1.lock.join(", "), "· пушка", r1.gun.join(", ") || "—");
console.log("из 2,2: захват", r2.lock.join(", ") || "—", "· пушка", r2.gun.join(", ") || "—");
