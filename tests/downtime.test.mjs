// Запуск: node tests/run.mjs (сверяет вывод со снимком в tests/snapshots)
import { fileURLToPath as __f } from "node:url";
import { tmpdir as __tmp } from "node:os";
process.argv[2] ??= __f(new URL("..", import.meta.url)).replace(/\/$/, "");
process.argv[3] ??= __tmp() + "/tb-test-out";
const R = process.argv[2];
const log = [];
const F = class { constructor(...a) { this.a = a; } };
const users = [{ id: "gm", isGM: true, active: true, isSelf: true }];
users.activeGM = users[0];
let rolls = [];
Object.assign(globalThis, {
  foundry: { utils: { deepClone: x => structuredClone(x), randomID: () => "id" + Math.random().toString(36).slice(2, 8), hasProperty: () => false, getProperty: () => undefined, mergeObject: (a, b) => ({ ...a, ...b }) },
    abstract: { TypeDataModel: class {} }, data: { fields: { NumberField: F, StringField: F, BooleanField: F, SchemaField: F, ArrayField: F, HTMLField: F, ObjectField: F } } },
  Hooks: { on() {}, once() {} }, CONFIG: { sounds: {}, specialStatusEffects: { DEFEATED: "dead" } },
  ChatMessage: { create: async d => { log.push("CHAT " + d.content.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()); return d; }, getSpeaker: () => ({}) },
  game: { users, user: users[0], actors: [], settings: { get: () => [], set: async () => {} }, combat: null, socket: { emit() {} } },
  ui: { notifications: { warn: m => log.push("WARN " + m), info: m => log.push("INFO " + m) } },
  Roll: class { constructor(f) { this.f = f; } async evaluate() { this.total = rolls.shift() ?? 1; return this; } },
  fromUuidSync: () => null, Dialog: { confirm: async () => true }, Combat: class {}, Actor: class {}, Item: class {}, Application: class {}, ActorSheet: class {}
});
const { DT, TB } = await import(R + "/module/config.mjs");
const D = await import(R + "/module/downtime.mjs");
const { PilotData } = await import(R + "/module/data/models.mjs");
const assert = (c, m) => { if (!c) { console.error("FAIL " + m); process.exitCode = 1; } else log.push("ok " + m); };

// производные: доводка, травма, усталость, на пределе
const skills = { aim: 2, deploy: 1, dodge: 0, lead: 1, push: 0, strafe: 0 };
function sys(extra = {}) {
  const s = Object.assign(Object.create(PilotData.prototype), {
    skills: { ...skills }, archetype: "", bonusPoints: 0, twist: false, speed: 1, alt: "med", breakEv: null,
    markers: { grit: false, gritSkill: "", structure: false, sys: "", doom: false }, hp: { value: 3, max: 3 }, strain: { value: 0, max: 0 },
    nerves: 0, onEdge: "", breakdown: "", resolve: 0, downtime: { actions: 2, resolveGot: false, nervesDown: false },
    edges: [], bonds: [], goals: [], debts: [], service: { status: "active" }, questions: {}, dossier: []
  }, extra);
  const plane = { type: "plane", system: { stats: { spd: 5, ev: 4, aa: 6, ag: 5, hp: 4, str: 8, gun: 3, hard: 2 }, props: [] } };
  s.parent = { items: Object.assign([plane], { filter: Array.prototype.filter, find: Array.prototype.find }), getFlag: () => [] };
  Object.defineProperty(s, "plane", { get: () => plane });
  s.prepareDerivedData();
  return s;
}
let s = sys({ edges: [{ id: "a", kind: "tune", stat: "ev", minus: "gun" }, { id: "b", kind: "fatigue" }, { id: "c", kind: "trauma", skill: "aim" }, { id: "d", kind: "tune", stat: "hp", minus2: "aa" }] });
assert(s.evasion === 5 && s.gun === 2 && s.strain.max === 6 && s.skillTotal.aim === 1 && s.hp.max === 5 && s.aa === 5, `derived ev ${s.evasion} gun ${s.gun} str ${s.strain.max} aim ${s.skillTotal.aim} hp ${s.hp.max} aa ${s.aa}`);
assert(s.edgeCount === 2, "edgeCount ignores costs " + s.edgeCount);
s = sys({ nerves: 5, onEdge: "fly" });
assert(s.edgeFly && s.compOn.aim === 2, "on edge comp 1-2");

// стартовый Strain
const actor = (sx) => ({ type: "pilot", name: "Сова", uuid: "Actor.s", id: "s", isOwner: true, system: sx, items: { get: () => null },
  getFlag: () => null, async update(u) { log.push("UPD " + JSON.stringify(u)); for (const [k, v] of Object.entries(u)) { const ks = k.split("."); if (ks[0] !== "system") continue; let o = this.system; for (const x of ks.slice(1, -1)) o = o[x]; o[ks.at(-1)] = v; } } });
let a = actor(sys({ nerves: 3, edges: [{ id: "f", kind: "fresh" }] }));
let st = D.startStrain(a);
assert(st.value === a.system.strain.max && st.notes.length === 2, "start strain nerves3 + fresh = max " + st.value);
a = actor(sys({ nerves: 1, markers: { grit: true, structure: true, doom: false } }));
assert(D.nervesHint(a).up === 1, "nerves hint two markers");
const aft = D.afterSortieUpdate(actor(sys({ nerves: 4, edges: [{ id: "x", kind: "fresh" }], service: { status: "hospital" } })), 2);
assert(aft.upd["system.nerves"] === 5 && aft.upd["system.downtime"].actions === 1 && aft.upd["system.edges"].length === 0, "after sortie " + JSON.stringify(aft.notes));
const aft2 = D.afterSortieUpdate(actor(sys({ nerves: 5, onEdge: "fly" })), 2);
assert(aft2.upd["system.nerves"] === 5 && aft2.upd["system.onEdge"] === "", "on edge nerves do not grow");

// карточка: 7 чистый, 4 с ценой, 3 провал; встречная
const card = (d10, extra = {}) => ({ type: "ground", rolled: true, d10, d4: 2, parts: [["Сброс", 2]], dc: 7, perkOn: 4, compOn: 1, actorUuid: "Actor.s", actorName: "Сова", label: "В ангаре", costs: [], ...extra });
const txt = h => h.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
assert(/Чистый успех/.test(txt(D.renderGround(card(5)))), "7 clean (tie to pilot)");
assert(/Успех с ценой/.test(txt(D.renderGround(card(2)))), "4 cost");
assert(/Не вышло/.test(txt(D.renderGround(card(1)))), "3 fail");
assert(/Успех с ценой/.test(txt(D.renderGround(card(3, { dc: 8, opposed: { d10: 5, skill: 3 } })))), "opposed -3 cost");
const h = D.renderGround(card(2, { edge: { kind: "tune", stat: "aa" }, action: "hangar" }));
assert(/dt-edge/.test(h) && /dt-cost/.test(h) && !/data-cost="trauma"/.test(h), "cost card: edge button, costs without trauma");
assert(/data-cost="trauma"/.test(D.renderGround(card(1, { action: "hangar" }))), "fail allows trauma");

// кнопки: Задел, Решимость, цель
globalThis.fromUuidSync = () => a;
a = actor(sys({ resolve: 1 }));
let c = card(5, { d4: 4, perkOn: 4, edge: { kind: "tune", stat: "ev", minus: "gun" }, action: "hangar" });
await D.groundAction(null, c, "dt-edge", null, a, async () => {});
assert(a.system.edges.length === 1 && a.system.edges[0].minus === "", "perk clean: evasion without counter-cost");
c = card(5, { edge: { kind: "tune", stat: "ev", minus: "gun" }, action: "hangar" });
await D.groundAction(null, c, "dt-edge", null, a, async () => {});
assert(/доводка/i.test(log.at(-1)) && a.system.edges.length === 1, "duplicate tune refused");
c = card(2, { d4: 1 });
await D.groundAction(null, c, "dt-resolve", null, a, async () => {});
assert(c.d4 === 4 && a.system.resolve === 0, "resolve makes d4 = 4");
a.system.goals = [{ name: "Брат", size: 4, value: 3 }];
c = card(5, { action: "personal", goal: 0 });
await D.groundAction(null, c, "dt-goal", null, a, async () => {});
assert(a.system.goals[0].value === 4 && a.system.resolve === 1 && a.system.downtime.resolveGot, "goal filled -> resolve " + c.goalDone);
c = card(5, { action: "leave", d4: 4, edge: { kind: "fresh" } });
a.system.nerves = 3; a.system.edgeCount = 1;
await D.groundAction(null, c, "dt-edge", null, a, async () => {});
assert(a.system.nerves === 1, "leave clean+perk: nerves -2 " + a.system.nerves);
// разрыв Связи
const bl = D.dropBond([{ name: "Гордеев", value: 2, was: [] }], 0);
assert(bl[0].value === 1 && bl[0].was[0] === 2, "bond drop keeps old value struck");
console.log(log.filter(l => !l.startsWith("UPD")).join("\n"));
