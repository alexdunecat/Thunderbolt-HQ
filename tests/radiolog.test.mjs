// Запуск: node tests/run.mjs (сверяет вывод со снимком в tests/snapshots)
import { fileURLToPath as __f } from "node:url";
import { tmpdir as __tmp } from "node:os";
process.argv[2] ??= __f(new URL("..", import.meta.url)).replace(/\/$/, "");
process.argv[3] ??= __tmp() + "/tb-test-out";
const root = process.argv[2];
const ls = {}; globalThis.localStorage = { getItem: k => ls[k] ?? null, setItem: (k, v) => { ls[k] = v; } };
globalThis.Application = class {}; const once = {}; const sock = [];
globalThis.Hooks = { on() {}, once: (n, f) => (once[n] = f) };
globalThis.foundry = { utils: { mergeObject: Object.assign } };
const users = { gm: { id: "gm", name: "Алекс", isGM: true }, p1: { id: "p1", name: "Игрок 1" }, p2: { id: "p2", name: "Игрок 2" } };
globalThis.game = { world: { id: "w" }, user: users.gm, users: { get: id => users[id] }, combat: { started: true, round: 2, id: "c" },
  socket: { on: (ch, f) => sock.push(f), emit() {} } };
const L = await import(`${root}/module/radio-log.mjs`);
L.registerRadioLog(); once.ready();
L.record({ speaker: "AWACS", text: "Всем бортам" });
for (const u of ["p1", "p2"]) sock[0]({ type: "radioHeard", user: u, entry: { at: Date.now(), speaker: "AWACS", text: "Всем бортам", side: "ally", muted: u === "p2" } });
sock[0]({ type: "radioHeard", user: "p1", entry: { at: Date.now(), speaker: "AWACS", text: "Гроза, ракета по тебе!", side: "ally" } });
console.log(JSON.parse(ls["thunderbolt-shtab.radioLog.w"]).map(e => `${e.text} ← ${e.heard.map(h => h.id + (h.muted ? "(muted)" : "")).join(",")}`));
