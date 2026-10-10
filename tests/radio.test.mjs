// Запуск: node tests/run.mjs (сверяет вывод со снимком в tests/snapshots)
import { fileURLToPath as __f } from "node:url";
import { tmpdir as __tmp } from "node:os";
process.argv[2] ??= __f(new URL("..", import.meta.url)).replace(/\/$/, "");
process.argv[3] ??= __tmp() + "/tb-test-out";
const root = process.argv[2];
const hooks = {}; const said = [];
const els = {};
globalThis.document = { getElementById: id => els[id], createElement: () => ({ classList: { add(){}, remove(){} }, setAttribute(){}, set innerHTML(v){ said.push(v.replace(/<[^>]+>/g, "").replace(/\s+/g," ").trim()); } }), body: { append(e){ els[e.id] = e; } } };
const timers = []; globalThis.setTimeout = f => timers.push(f);
const pilot = { type: "pilot", name: "Гроза", isOwner: true, system: { callsign: "Гроза" }, uuid: "Actor.p" };
globalThis.game = { settings: { register(){}, get: () => true }, user: { isGM: false, id: "u1" }, actors: [pilot], combat: null, scenes: {} };
globalThis.Application = class {}; const ls = {}; globalThis.localStorage = { getItem: k => ls[k] ?? null, setItem: (k, v) => { ls[k] = v; } };
globalThis.Hooks = { on: (n, f) => (hooks[n] ??= []).push(f), once() {} };
globalThis.fromUuidSync = u => u === "Actor.p" ? pilot : { isOwner: false, name: "МиГ" };
globalThis.foundry = { utils: { getProperty: () => null } };
const R = await import(`${root}/module/radio.mjs`);
R.registerRadio();
const msg = flags => ({ flags: { "thunderbolt-shtab": flags } });
hooks.createChatMessage[0](msg({ rwr: { target: "Actor.p", from: "МиГ-29" } }));
hooks.createChatMessage[0](msg({ card: { maws: true, targetUuid: "Actor.p" } }));
hooks.createChatMessage[0](msg({ card: { type: "volley", targets: [
  { uuid: "Actor.p", name: "Гроза", hit: true, dmg: 4, shooters: "МиГ" },
  { uuid: "Actor.m", name: "МиГ", hit: false, shooters: "Гроза" } ] } }));
hooks.createChatMessage[0](msg({ radio: { to: "Actor.m", text: "не мне" } }));
hooks.createChatMessage[0](msg({ radio: { text: "Всем бортам" } }));
while (timers.length) timers.shift()(); console.log(said); R.caution({ sub: "Strigon" }); console.log(JSON.parse(Object.values(ls)[0]).map(e => (e.banner ? "BANNER " + e.banner.sub : e.speaker + ": " + e.text)));
