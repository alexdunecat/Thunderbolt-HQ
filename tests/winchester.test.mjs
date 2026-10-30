// Запуск: node tests/run.mjs (сверяет вывод со снимком в tests/snapshots)
// «Винчестер»: кончился боезапас спецоружия — AWACS пилоту, союзный NPC сам, противник молчит; мигание станции в HUD
import { fileURLToPath as __f } from "node:url";
process.argv[2] ??= __f(new URL("..", import.meta.url)).replace(/\/$/, "");
const R = process.argv[2];
const log = [], hooks = {};
const users = [{ id: "gm", isGM: true, isSelf: true }];
users.activeGM = users[0];
Object.assign(globalThis, {
  foundry: { utils: { getProperty: (o, p) => p.split(".").reduce((x, k) => x?.[k], o), deepClone: x => structuredClone(x), hasProperty: () => false },
    abstract: { TypeDataModel: class {} }, data: { fields: {} } },
  Hooks: { on: (e, f) => (hooks[e] ??= []).push(f), once() {} }, CONFIG: {},
  ChatMessage: { create: async d => { const r = d.flags?.["thunderbolt-shtab"]?.radio; log.push(`RADIO ${r.speaker}: ${r.text}`); return d; } },
  game: { users, user: users[0], combat: { started: true, round: 3 }, settings: { get: () => true, register() {} }, socket: { on() {}, emit() {} } },
  Application: class {}, Dialog: class {}, ui: { notifications: { warn() {}, info() {} } }
});
const W = await import(R + "/module/winchester.mjs");
const pilot = { type: "pilot", callsign: "Цой", name: "Виктор" };
console.log("пилот, ещё есть:", JSON.stringify(W.winchesterCall(pilot, "QAAM · всеракурсная", ["4AAM · залп"], "a")));
console.log("пилот, последнее:", JSON.stringify(W.winchesterCall(pilot, "QAAM · всеракурсная", [], "b")));
console.log("союзный ведомый:", JSON.stringify(W.winchesterCall({ type: "npc", side: "ally", name: "Гром-2" }, "LAGM", [], "c")));
console.log("противник:", W.winchesterCall({ type: "npc", side: "enemy", name: "Хандзаде" }, "QAAM", []));

W.registerWinchester();
const weapon = (id, value, extra = {}) => ({ id, uuid: "A." + id, type: "weapon", name: id, system: { ammo: { value, max: 4 }, unlimited: false }, ...extra });
const qaam = weapon("QAAM", 0), lagm = weapon("LAGM", 2), gun = { id: "GUN", uuid: "A.GUN", type: "weapon", name: "GUN", system: { ammo: { value: 0, max: null }, unlimited: true } };
const actor = { uuid: "A", type: "pilot", system: { callsign: "Цой" }, name: "Виктор", items: [qaam, lagm, gun] };
for (const i of actor.items) i.parent = actor;
const fire = async (item, change, options = {}) => { for (const f of hooks.updateItem) f(item, change, options); await new Promise(r => setTimeout(r, 30)); };
await fire(qaam, { system: { ammo: { value: 0 } } });
console.log("мигает только что опустевшая:", W.justEmptied(qaam), W.justEmptied(lagm), "· через 5 с:", W.justEmptied(qaam, Date.now() + 5000));
await fire(lagm, { system: { ammo: { value: 1 } } });
lagm.system.ammo.value = 0;
await fire(lagm, { system: { ammo: { value: 0 } } });
await fire(gun, { system: { ammo: { value: 0 } } });
await fire(qaam, { system: { ammo: { value: 0 } } }, { tbUndo: true });
game.combat = null;
await fire(lagm, { system: { ammo: { value: 0 } } });
console.log(log.join("\n"));
