// Совет ведущему на ход NPC: выбор цели, шаги (Break!, высота, Lock On!, Fox Two!, Guns, сближение), запреты триггеров, Немезида, заявка.
import { fileURLToPath as __f } from "node:url";
import fs from "node:fs";
process.argv[2] ??= __f(new URL("..", import.meta.url)).replace(/\/$/, "");
const R = process.argv[2];
const F = class { constructor(...a) { this.a = a; } };
const combat = { id: "C1", started: true, round: 2, turn: 0, combatant: null, combatants: [], getFlag: () => null, setFlag: async () => {} };
const messages = [];
Object.assign(globalThis, {
  foundry: { utils: { deepClone: x => structuredClone(x), mergeObject: Object.assign, getProperty: () => undefined, hasProperty: () => false, setProperty() {} }, abstract: { TypeDataModel: class {} },
    data: { fields: { NumberField: F, StringField: F, BooleanField: F, SchemaField: F, ArrayField: F, HTMLField: F, ObjectField: F } } },
  CONST: { DOCUMENT_OWNERSHIP_LEVELS: { LIMITED: 1 }, GRID_TYPES: { GRIDLESS: 0 } },
  Hooks: { on() {}, once() {}, callAll() {} }, CONFIG: { sounds: {}, specialStatusEffects: { DEFEATED: "dead" } },
  game: { user: { id: "gm", isGM: true }, users: Object.assign([], { activeGM: { isSelf: true } }), macros: [], folders: [], messages: { contents: messages }, combat,
    settings: { get: () => true, register() {} }, actors: [] },
  ui: { notifications: { warn() {}, info() {} } }, ChatMessage: { create: async () => null },
  Actor: class {}, Item: class {}, Combat: class {}, Application: class {}, FormApplication: class {}, ActorSheet: class {}, Dialog: class {}, fromUuidSync: u => byUuid[u] ?? null
});
const scene = { id: "S", getFlag: () => null, tokens: [] };
globalThis.canvas = { ready: true, scene, grid: { type: 1, size: 100, getOffset: p => ({ i: Math.floor(p.y / 100), j: Math.floor(p.x / 100) }), measurePath: ([a, b]) => ({ spaces: Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) / 100 }) },
  tokens: { placeables: [], controlled: [], get: id => canvas.tokens.placeables.find(t => t.id === id) } };
const byUuid = {};
const packs = JSON.parse(fs.readFileSync(R + "/tests/fixtures/npcs.json", "utf8"));
const place = (a, col, alt = "med") => {
  const t = { id: "T" + a.uuid, name: a.name, actor: a, document: { parent: scene, width: 1, height: 1, hidden: false, elevation: 0, getFlag: () => null }, center: { x: col * 100 + 50, y: 50 } };
  a.system.alt = alt;
  a.getActiveTokens = () => [t];
  canvas.tokens.placeables.push(t); scene.tokens.push(t);
  byUuid[a.uuid] = a;
  return t;
};
const base = (d, extra = {}) => ({ statuses: new Set(), items: [], flags: {}, isOwner: true, getFlag(s, k) { return this.flags[k]; }, async update() {}, ...d, ...extra });
const npc = (key, name, col, o = {}) => {
  const d = structuredClone(packs[key]), s = d.system;
  Object.assign(s, { side: "enemy", tier: "conscript", lockUuid: "", markers: {}, skills: { aim: 1, deploy: 1, dodge: 1, strafe: 1, lead: 0, push: 0 }, ...o.sys });
  s.aa = s.stats?.aa ?? null; s.ag = s.stats?.ag ?? null; s.evasion = s.stats?.ev ?? 0; s.speed ??= 1;
  const a = base({ type: "npc", name, uuid: "Actor." + name, system: s, hasPlayerOwner: false });
  place(a, col, o.alt);
  return a;
};
const pilot = (name, col, o = {}) => {
  const a = base({ type: "pilot", id: name, name, uuid: "Actor." + name, hasPlayerOwner: true,
    system: { callsign: name, evasion: o.ev ?? 3, speed: o.speed ?? 2, hp: { value: o.hp ?? 6, max: 6 }, lockUuid: "", markers: {}, skills: { aim: 1, deploy: 1, dodge: 1, strafe: 1, lead: 0, push: 0 }, twist: false, alt: "med" } });
  place(a, col, o.alt);
  return a;
};
const A = await import(R + "/module/npc-advice.mjs");
const show = (label, a) => {
  const r = A.adviseNpc(a);
  if (!r) return console.log(`${label}: совета нет`);
  const t = r.target;
  console.log(`${label}: ${t ? `цель ${t.name} (${t.dist} зон, DEF ${t.defense}${t.why.length ? "; " + t.why.join(", ") : ""})` : "цели нет"} · заявка ${r.declare}`);
  for (const s of r.steps) console.log(`   ${s.label}: ${s.hint}`);
  for (const n of r.notes) console.log(`   ! ${n}`);
  if (r.others.length) console.log(`   ещё: ${r.others.join(", ")}`);
};

const rookie = pilot("Новичок", 1);
const ace = pilot("Гроза", 3, { ev: 5, speed: 3 });
const f15 = npc("f15c", "Орёл-1", 0);
show("Истребитель рядом с Новичком", f15);
f15.system.lockUuid = rookie.uuid;
show("уже держит Новичка", f15);
f15.system.lockUuid = "";
ace.system.lockUuid = f15.uuid;
show("Гроза держит его на захвате", f15);
ace.system.lockUuid = "";
// пушка в своей зоне
const f15b = npc("f15c", "Орёл-2", 1);
show("в одной зоне с Новичком", f15b);
// далеко: сблизиться
const far = npc("f15c", "Орёл-3", 7);
show("далеко от всех", far);
// разная высота: цель на Низкой
const low = pilot("Низкий", 9, { alt: "low" });
const hi = npc("f15c", "Орёл-4", 9, { alt: "high" });
show("цель на Низкой, сам на Высокой", hi);
// быстрый: без броска не попадает, можно сбросить Speed
f15.system.speed = 3;
show("Орёл-1 на Speed 3", f15);
f15.system.speed = 1;
// ракета летит в него
messages.push({ getFlag: () => ({ delayed: true, targetUuid: f15.uuid, combatKey: "C1:2" }) });
show("под ракетой", f15);
messages.length = 0;
// запрет «Без опознавательных знаков»: конскрипт не выбирает такого пилота целью
const mkTrig = (key, name, types = ["Passive"]) => ({ id: key, type: "trigger", name, system: { key, types, used: false, active: false } });
rookie.items.push(mkTrig("nomarks", "Без опознавательных знаков"));
show("Новичок без флага", f15);
rookie.items.length = 0;
// Немезида выбирает своего пилота
game.actors = [rookie, ace, low];
const nem = npc("f15c", "Немезида", 2, { sys: { tier: "ace", nemesis: true, nemesisOf: "Гроза" } });
show("Немезида", nem);
// ЗРК на земле
const sam = npc("s300", "С-300", 2);
show("ЗРК", sam);
// корабль: только цель
const kirov = npc("kirov", "Киров", 4);
show("Крейсер", kirov);
// союзный NPC бьёт врагов
const ally = npc("f15c", "Союзник", 0, { sys: { side: "ally" } });
show("союзный истребитель", ally);
console.log("заявка Орла-1:", A.adviseDeclare(f15), "· здание:", A.advisable({ type: "npc", system: { grp: "obj" }, statuses: new Set() }));
// строка в HUD у ведущего на его ход
combat.combatants = [{ id: "c1", actor: f15, actorId: f15.uuid, tokenId: "T" + f15.uuid, parent: combat, initiative: 2, getFlag: () => null }];
combat.combatant = combat.combatants[0];
const row = A.adviceRow(f15);
console.log("строка HUD:", row.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
