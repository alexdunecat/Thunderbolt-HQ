// Запуск: node tests/run.mjs (сверяет вывод со снимком в tests/snapshots)
// Ход автопилота на заглушках сцены: прорыв танка к штабу, истребитель на охоте, ЗРК держит позицию, маршрут
import { fileURLToPath as __f } from "node:url";
import fs from "node:fs";
process.argv[2] ??= __f(new URL("..", import.meta.url)).replace(/\/$/, "");
const R = process.argv[2];
const F = class { constructor(...a) { this.a = a; } };
const combat = { id: "C1", started: true, round: 2, turn: 0, combatant: null, combatants: [], getFlag: () => null, setFlag: async () => {} };
const messages = [], log = [];
const getp = (o, p) => p.split(".").reduce((x, k) => x?.[k], o);
const setp = (o, p, v) => { const ks = p.split("."); let x = o; for (const k of ks.slice(0, -1)) x = (x[k] ??= {}); x[ks.at(-1)] = v; };
let seq = 0;
Object.assign(globalThis, {
  foundry: { utils: { deepClone: x => structuredClone(x), mergeObject: Object.assign, getProperty: getp, hasProperty: (o, p) => getp(o, p) !== undefined, setProperty: setp }, abstract: { TypeDataModel: class {} },
    data: { fields: { NumberField: F, StringField: F, BooleanField: F, SchemaField: F, ArrayField: F, HTMLField: F, ObjectField: F } } },
  CONST: { DOCUMENT_OWNERSHIP_LEVELS: { LIMITED: 1 }, GRID_TYPES: { GRIDLESS: 0 } },
  Hooks: { on() {}, once() {}, callAll() {} }, CONFIG: { sounds: {}, specialStatusEffects: { DEFEATED: "dead" } },
  game: { user: { id: "gm", isGM: true }, users: Object.assign([{ id: "gm", isGM: true, active: true }], { activeGM: { isSelf: true, id: "gm" } }), macros: [], folders: [], messages: { contents: messages }, combat,
    settings: { get: (ns, k) => ({ threats: [], squadrons: {}, squadSortie: {} })[k] ?? null, register() {} }, actors: [], socket: { emit() {} } },
  ui: { notifications: { warn: m => log.push("warn " + m), info() {} } },
  ChatMessage: { create: async d => { const c = d.flags?.["thunderbolt-shtab"]?.card; const m = { id: "m" + (++seq), ...d, getFlag: (s, k) => d.flags?.[s]?.[k], canUserModify: () => true, update: async () => {} };
    messages.push(m); log.push("  чат: " + (c ? `${c.label ?? c.type} → ${c.targetName ?? ""}${c.combatKey ? ` [${c.combatKey}]` : ""}${c.instant ? ` итог ${c.d10 + c.parts.reduce((s, p) => s + p[1], 0)} против ${c.dc}` : ""}` : d.content.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 140))); return m; },
    getSpeaker: () => ({}), getWhisperRecipients: () => [] },
  Roll: class { constructor(f) { this.f = f; } async evaluate() { this.total = this.f === "1d10" ? 7 : 3; return this; } },
  Actor: class {}, Item: class {}, Combat: class {}, Application: class {}, FormApplication: class {}, ActorSheet: class {}, Dialog: class {}, fromUuidSync: u => byUuid[u] ?? null
});
Number.isNumeric = n => typeof n === "number" && Number.isFinite(n);
const scene = { id: "S", getFlag: () => null, tokens: [] };
globalThis.canvas = { ready: true, scene, dimensions: { sceneRect: { x: 0, y: 0, width: 1000, height: 1000 } },
  grid: { type: 1, size: 100, getOffset: p => ({ i: Math.floor(p.y / 100), j: Math.floor(p.x / 100) }), measurePath: ([a, b]) => ({ spaces: Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) / 100 }) },
  tokens: { placeables: [], controlled: [], get: id => canvas.tokens.placeables.find(t => t.id === id) } };
const byUuid = {};
const packs = JSON.parse(fs.readFileSync(R + "/tests/fixtures/npcs.json", "utf8"));
const ELEV = { low: 1, med: 2, high: 3, strat: 4 };
const place = (a, col, row, alt = "med") => {
  const t = { id: "T" + a.uuid, name: a.name, actor: a, center: { x: col * 100 + 50, y: row * 100 + 50 } };
  t.document = { parent: scene, x: col * 100 + 30, y: row * 100 + 30, width: 0.5, height: 0.5, hidden: false, elevation: ELEV[alt] ?? 0, rotation: 0, object: t, actor: a, getFlag: () => null,
    async update(ch) { if ("x" in ch) { const dx = ch.x - this.x, dy = ch.y - this.y; this.x = ch.x; this.y = ch.y; t.center = { x: t.center.x + dx, y: t.center.y + dy }; }
      if ("elevation" in ch) { this.elevation = ch.elevation; a.system.alt = Object.keys(ELEV).find(k => ELEV[k] === ch.elevation); } return this; } };
  a.system.alt = alt;
  a.getActiveTokens = () => [t];
  canvas.tokens.placeables.push(t); scene.tokens.push(t);
  byUuid[a.uuid] = a;
  return t;
};
const base = (d, extra = {}) => ({ statuses: new Set(), items: [], flags: {}, isOwner: true, getFlag(s, k) { return this.flags[k]; }, async setFlag(s, k, v) { this.flags[k] = v; },
  async update(ch) { for (const [k, v] of Object.entries(ch)) if (k.startsWith("system.")) setp(this, k, v); return this; }, testUserPermission: () => false, ...d, ...extra });
const npc = (key, name, col, row, o = {}) => {
  const d = structuredClone(packs[key]), s = d.system;
  Object.assign(s, { side: "enemy", tier: "conscript", lockUuid: "", markers: {}, skills: { aim: 1, deploy: 1, dodge: 1, strafe: 1, lead: 0, push: 0 }, skillTotal: { aim: 1, deploy: 1, dodge: 1, strafe: 1, lead: 0, push: 0 }, ...o.sys });
  s.aa = s.stats?.aa ?? null; s.ag = s.stats?.ag ?? null; s.evasion = s.stats?.ev ?? 0; s.speed ??= 1; s.gun = s.stats?.gun ?? 0;
  if (s.kind === "ground") s.defense = s.ground?.occ ?? 4;
  const a = base({ type: "npc", name, uuid: "Actor." + name, system: s, hasPlayerOwner: false });
  place(a, col, row, o.alt ?? (s.kind === "air" ? "med" : "ground"));
  return a;
};
const pilot = (name, col, row, o = {}) => {
  const a = base({ type: "pilot", id: name, name, uuid: "Actor." + name, hasPlayerOwner: true,
    system: { callsign: name, evasion: o.ev ?? 3, speed: o.speed ?? 2, hp: { value: 6, max: 6 }, lockUuid: "", markers: {}, skills: { aim: 1, deploy: 1, dodge: 1, strafe: 1, lead: 0, push: 0 }, twist: false, alt: "med" } });
  place(a, col, row, o.alt);
  return a;
};
const AP = await import(R + "/module/autopilot.mjs");
AP.pace.k = 0;
const run = async (title, a) => {
  log.push(`${title}:`);
  const lines = await AP.runAutopilot(a);
  log.push(`  ход: ${lines.join("; ") || "—"}`);
  const t = a.getActiveTokens()[0];
  log.push(`  стоит: ${Math.floor(t.center.x / 100)},${Math.floor(t.center.y / 100)} ${a.system.alt}${a.system.lockUuid ? `, захват ${byUuid[a.system.lockUuid]?.name}` : ""}`);
};

// игроки и цели
const grom = pilot("Гроза", 2, 2);
const hq = npc("hq", "Штаб", 8, 2, { sys: { side: "ally" } });
const allyTank = npc("t80u", "Свой танк", 6, 2, { sys: { side: "ally" } });
// вражеский танк прорывается к штабу: по пути бьёт свой танк союзников на соседней клетке маршрута, а не пилота
const tank = npc("t80u", "Абрамс", 4, 2);
tank.flags.autopilot = { on: true, task: "attack", manner: "push", target: hq.uuid, targetName: "Штаб", acts: 3, after: "hold", route: [], step: 0 };
await run("танк, прорыв к штабу", tank);
// истребитель на охоте: сближение, захват, пуск (ракета в залп следующего раунда)
const f15 = npc("f15c", "Орёл-1", 5, 5);
f15.flags.autopilot = { on: true, task: "hunt", manner: "push", acts: 3, after: "hold", route: [], step: 0 };
await run("истребитель, охота", f15);
// ЗРК держит позицию: захват и пуск по пилоту в двух зонах
const sam = npc("s300", "С-300", 2, 4);
sam.flags.autopilot = { on: true, task: "hold", manner: "careful", acts: 2, after: "hold", route: [], step: 0 };
await run("ЗРК, держать позицию", sam);
// колонна по маршруту
const truck = npc("t80u", "Колонна", 0, 8, { sys: { side: "ally" } });
truck.flags.autopilot = { on: true, task: "route", manner: "rush", acts: 2, after: "hold", route: ["1,8", "3,8"], step: 0 };
await run("колонна, маршрут напролом", truck);
await run("колонна, второй раунд", truck);
console.log(log.join("\n"));
