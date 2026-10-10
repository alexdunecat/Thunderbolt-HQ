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
const { TB } = await import(R + "/module/config.mjs");
const Rr = await import(R + "/module/dice/rolls.mjs");
const assert = (c, m) => { if (!c) { console.error("FAIL " + m); process.exitCode = 1; } else log.push("ok " + m); };
const txt = h => h.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const base = (d10, d4, strain = 0) => ({ type: "eject", rolled: true, d10, d4, parts: [["Форсаж", 2]], strain, dc: 7, strainable: true, skill: "push", perkOn: 4, compOn: 1, actorUuid: "Actor.s", actorName: "Сова", label: "Бросок на катапультирование" });
const fate = c => Rr.ejectFate(Rr.computeCard(c)).status;
assert(fate(base(5, 1)) === "ejected", "tie 7 = ejected");
assert(fate(base(4, 4)) === "hospital", "fail d4 4 hospital");
assert(fate(base(4, 3)) === "mia" && fate(base(4, 2)) === "mia", "fail d4 2-3 mia");
assert(fate(base(4, 1)) === "kia", "fail d4 1 kia");
assert(fate(base(4, 1, 1)) === "ejected", "strain turns fail to success");
let h = txt(Rr.renderCard(base(4, 1)));
assert(/гибель/.test(h) && /Записать в личное дело/.test(h) && /\+1 Strain/.test(h) && !/Complication/.test(h), "eject card render " + h.slice(0, 200));
h = txt(Rr.renderCard({ ...base(4, 1), applied: "kia" }));
assert(/записано: Погиб/.test(h) && !/\+1 Strain/.test(h), "applied hides strain " + h.slice(-120));
h = txt(Rr.renderCard({ type: "doomfate", reason: "Сваливание на Low", actorName: "Сова", actorUuid: "Actor.s" }));
assert(/Бросок на катапультирование/.test(h) && /Героическая гибель/.test(h), "doomfate render");
// кнопки: записать исход
const act = { type: "pilot", name: "Сова", uuid: "Actor.s", isOwner: true, system: { service: { status: "active" }, resolve: 0, strain: { value: 2, max: 8 } }, async update(u) { log.push("UPD " + JSON.stringify(u)); this.upd = u; } };
globalThis.fromUuidSync = () => act;
const msg = c => ({ card: c, getFlag() { return this.card; }, canUserModify: () => true, async update(u) { this.card = u["flags.thunderbolt-shtab.card"]; } });
let m = msg(base(4, 3));
await Rr.onCardAction(m, "eject-apply");
assert(act.upd?.["system.service.status"] === "mia" && m.card.applied === "mia", "apply mia " + JSON.stringify(act.upd));
m = msg({ type: "doomfate", actorUuid: "Actor.s", actorName: "Сова" });
await Rr.onCardAction(m, "doom-hero");
assert(act.upd?.["system.service.status"] === "kia" && m.card.chosen === "hero", "heroic death");
console.log(log.filter(l => !l.startsWith("ok")).slice(0, 5).join("\n"));
console.log(process.exitCode ? "FAILED" : "all ok (" + log.filter(l => l.startsWith("ok")).length + ")");
