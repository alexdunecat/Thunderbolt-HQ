// Запуск: node tests/run.mjs (сверяет вывод со снимком в tests/snapshots)
import { fileURLToPath as __f } from "node:url";
import { tmpdir as __tmp } from "node:os";
process.argv[2] ??= __f(new URL("..", import.meta.url)).replace(/\/$/, "");
process.argv[3] ??= __tmp() + "/tb-test-out";
// Шкалы боя: отметки 50/75/90 %, реплики AWACS, тик в конце раунда
const R = process.argv[2];
const log = [], hooks = {}, store = { threats: [] };
const users = [{ id: "gm", isGM: true, active: true, isSelf: true }];
users.activeGM = users[0];
let n = 0;
Object.assign(globalThis, {
  foundry: { utils: { deepClone: x => structuredClone(x), randomID: () => "t" + ++n, hasProperty: () => false, getProperty: () => undefined },
    abstract: { TypeDataModel: class {} }, data: { fields: {} } },
  Hooks: { on: (e, f) => (hooks[e] ??= []).push(f), once() {}, callAll() {} }, CONFIG: { sounds: {} },
  ChatMessage: { create: async d => { const r = d.flags?.["thunderbolt-shtab"]?.radio;
    log.push(r ? `RADIO ${r.caution ? `[${r.caution.title} · ${r.caution.sub}] ` : ""}${r.text}` : "CHAT " + d.content.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()); return d; }, getSpeaker: () => ({}) },
  game: { users, user: users[0], actors: [], settings: { get: (s, k) => store[k], set: async (s, k, v) => { store[k] = v; }, register() {} }, socket: { emit() {}, on() {} } },
  ui: { notifications: { warn: m => log.push("WARN " + m), info() {} } },
  Application: class {}, Dialog: class {}, Combat: class {}, Actor: class {}, Item: class {}, ActorSheet: class {}, localStorage: { getItem: () => null, setItem() {} }
});
const { DT } = await import(R + "/module/config.mjs");
const D = await import(R + "/module/downtime.mjs");
D.registerDowntime();
const marks = size => DT.bossMarks.map(([k]) => `${k}→${D.bossMarkAt(k, size)}`).join(" ");
for (const size of [4, 5, 6, 10]) console.log(`size ${size}: ${marks(size)}`);

// Аркбёрд: шесть делений, тикает в конце раунда
const tpl = DT.bossClocks.arkbird;
store.threats = [{ id: "ark", kind: "boss", value: 0, name: tpl.name, size: tpl.size, tick: true, note: tpl.note, lines: { ...tpl.lines } },
  { id: "base", name: "Особый отдел", size: 4, value: 0, note: "допрос" }];
const endRound = round => Promise.all((hooks.updateCombat ?? []).map(f => f({}, { round }, { direction: 1 })));
for (let r = 2; r <= 8; r++) { log.push(`— конец раунда ${r - 1}`); await endRound(r); }
log.push(`ark ${store.threats[0].value}/6, base ${store.threats[1].value}/4 (обычная шкала не тикает)`);
store.threats[0].value = 1;
await Promise.all((hooks.updateCombat ?? []).map(f => f({}, { round: 3 }, { direction: -1 })));
log.push("раунд назад не тикает: " + store.threats[0].value);
// перескок через две отметки: звучит старшая с репликой
store.threats[0] = { ...store.threats[0], value: 2, lines: { ...tpl.lines, 90: "" } };
await D.stepThreat("ark", 3);
// своя шкала без реплик: только карточка при заполнении
store.threats.push({ id: "own", kind: "boss", value: 3, name: "Мост", size: 4, tick: false, note: "мост взорван", lines: { 50: "", 75: "", 90: "", full: "" } });
await D.stepThreat("own", 1);
console.log(log.join("\n"));
