// Запуск: node tests/run.mjs (сверяет вывод со снимком в tests/snapshots)
// Макросы действий: строка /tb …, разбор, раскладка на панели игроков (пустые слоты, один раз, без дублей).
import { fileURLToPath as __f } from "node:url";
process.argv[2] ??= __f(new URL("..", import.meta.url)).replace(/\/$/, "");
const R = process.argv[2];
const log = [];
const F = class { constructor(...a) { this.a = a; } };
let nid = 0;
class Doc {
  constructor(d) { Object.assign(this, structuredClone(d)); this.id ??= "m" + (++nid); }
  getFlag(s, k) { return this.flags?.[s]?.[k]; }
}
const macros = [];
macros.get = id => macros.find(m => m.id === id);
const folders = [];
const mkUser = (id, isGM, hotbar = {}) => ({ id, isGM, isSelf: isGM, hotbar, flags: {}, getFlag(s, k) { return this.flags?.[s]?.[k]; },
  async update(u) { log.push(`UPD ${id} ${JSON.stringify(u)}`); for (const [k, v] of Object.entries(u)) { const [a, b, c] = k.split("."); if (a === "hotbar") this.hotbar[b] = v; else (this.flags[b] ??= {})[c] = v; } } });
const gm = mkUser("gm", true);
const users = [gm, mkUser("p1", false, { 3: "own" }), mkUser("p2", false)];
macros.push(new Doc({ id: "own", name: "Свой", flags: {} }));
macros.push(new Doc({ id: "oldstall", name: "Сваливание", flags: { "thunderbolt-shtab": { bar: "stall" } } }));   // из прошлой версии: должен удалиться
Object.assign(globalThis, {
  foundry: { utils: { deepClone: x => structuredClone(x) }, abstract: { TypeDataModel: class {} }, data: { fields: { NumberField: F, StringField: F, BooleanField: F, SchemaField: F, ArrayField: F, HTMLField: F, ObjectField: F } } },
  CONST: { DOCUMENT_OWNERSHIP_LEVELS: { NONE: 0, LIMITED: 1 } },
  Hooks: { on() {}, once() {} }, CONFIG: { sounds: {}, specialStatusEffects: { DEFEATED: "dead" } },
  game: { user: gm, users, macros, folders, settings: { get: () => true } },
  ui: { notifications: { warn: m => log.push("WARN " + m) } },
  Folder: { create: async d => { const f = new Doc(d); folders.push(f); log.push("FOLDER " + d.name); return f; } },
  Macro: {
    createDocuments: async list => list.map(d => { const m = new Doc(d); macros.push(m); return m; }),
    updateDocuments: async list => { log.push("MACRO UPD " + list.length); return list; },
    deleteDocuments: async ids => { log.push("MACRO DEL " + ids.join(",")); for (const id of ids) macros.splice(macros.findIndex(m => m.id === id), 1); return ids; }
  },
  Actor: class {}, Item: class {}, Combat: class {}, Application: class {}, FormApplication: class {}, ActorSheet: class {}, Dialog: class {}, fromUuidSync: () => null
});
const M = await import(R + "/module/macros.mjs");
log.push(M.PILOT_BAR.map(a => M.chatCommand(a)).join(" | "));
log.push(M.chatCommand("skill", { skill: "aim", actor: "Actor.abc" }));
for (const t of ["/tb lock", "/TB skill Aim Actor.x", "/tb missile Actor.y", "/r 1d10", "привет /tb lock"]) log.push(`${t} → ${JSON.stringify(M.parseCommand(t))}`);
log.push("заложено: " + await M.fillHotbars());
log.push(`макросов ${macros.length - 1}: ` + macros.slice(1).map(m => `${m.name}[${m.type}] ${m.command} ${m.img.replace(/^.*\//, "")}`).join("; "));
log.push(`p1 ${JSON.stringify(users[1].hotbar)} · p2 ${JSON.stringify(users[2].hotbar)} · gm ${JSON.stringify(gm.hotbar)}`);
log.push("повторный вход: " + await M.fillHotbars());
log.push("force: " + await M.fillHotbars({ force: true }) + ` p1 слот 3 ${users[1].hotbar[3]}`);
// кнопки ведущего: свои слоты 1–9 ведущего, макросы закрыты от игроков, команда /tb … только у ведущего
gm.hotbar[2] = "own";
log.push("ведущий: " + await M.fillGmHotbar(gm) + ` · gm ${JSON.stringify(gm.hotbar)}`);
const gmMacros = macros.filter(m => m.flags?.["thunderbolt-shtab"]?.gmbar);
log.push(gmMacros.map(m => `${m.name} ${m.command} ${m.img.replace(/^.*\//, "")} доступ ${m.ownership.default}`).join("; "));
log.push("ведущий повторно: " + await M.fillGmHotbar(gm) + " · игроку: " + await M.fillGmHotbar(users[1]));
log.push(`/tb briefing → ${JSON.stringify(M.parseCommand("/tb briefing"))}`);
const opened = [];
game.thunderbolt = { briefing: { open: () => opened.push("брифинг") }, hangar: { admin: () => opened.push("ангар") }, radio: { aces: () => opened.push("асы") },
  brush: { weather: () => opened.push("кисть погоды"), returnLine: () => opened.push("линия возврата") } };
for (const a of M.GM_BAR) M.gmFromMacro(a);
game.user = users[1]; M.gmFromMacro("briefing"); game.user = gm;
log.push("открыто: " + opened.join(", "));
console.log(log.filter(l => !l.startsWith("UPD")).join("\n"));
