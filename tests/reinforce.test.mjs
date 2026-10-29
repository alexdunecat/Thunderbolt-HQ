// Запуск: node tests/run.mjs (сверяет вывод со снимком в tests/snapshots)
// Подкрепления: выход по раунду и после выбытия машины, пропуск посреди раунда, объявление AWACS
import { fileURLToPath as __f } from "node:url";
process.argv[2] ??= __f(new URL("..", import.meta.url)).replace(/\/$/, "");
const R = process.argv[2];
const F = class { constructor(...a) { this.a = a; } };
const log = [];
const getp = (o, p) => p.split(".").reduce((x, k) => x?.[k], o);
const setp = (o, p, v) => { const ks = p.split("."); let x = o; for (const k of ks.slice(0, -1)) x = (x[k] ??= {}); x[ks.at(-1)] = v; };
Object.assign(globalThis, {
  foundry: { utils: { getProperty: getp, hasProperty: (o, p) => getp(o, p) !== undefined, setProperty: setp, deepClone: x => structuredClone(x), mergeObject: Object.assign },
    abstract: { TypeDataModel: class {} }, data: { fields: { NumberField: F, StringField: F, BooleanField: F, SchemaField: F, ArrayField: F, HTMLField: F, ObjectField: F } } },
  CONST: { DOCUMENT_OWNERSHIP_LEVELS: { LIMITED: 1 }, GRID_TYPES: { GRIDLESS: 0, SQUARE: 1 } },
  Hooks: { on() {}, once() {}, callAll() {} }, CONFIG: { specialStatusEffects: { DEFEATED: "dead" }, sounds: {} },
  Actor: class {}, Item: class {}, Combat: class {}, Application: class {}, FormApplication: class {}, ActorSheet: class {}, Dialog: class {},
  ChatMessage: { create: async d => { log.push("  чат: " + d.content.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()); return d; }, getSpeaker: () => ({}) },
  ui: { notifications: { info: m => log.push("  info " + m), warn: m => log.push("  warn " + m) } }
});
Number.isNumeric = n => typeof n === "number" && Number.isFinite(n);
const byUuid = {};
globalThis.fromUuidSync = u => byUuid[u] ?? null;
const tokens = [];
const scene = { id: "S", grid: { size: 100 }, tokens: Object.assign(tokens, { get: id => tokens.find(t => t.id === id), contents: tokens }),
  async updateEmbeddedDocuments(type, rows) {
    for (const r of rows) { const d = tokens.find(t => t.id === r._id); for (const [k, v] of Object.entries(r)) if (k === "_id") continue; else if (k.includes("-=")) delete d.flags["thunderbolt-shtab"].arrive; else setp(d, k, v);
      log.push(`  токен ${d.name}: ${d.hidden ? "скрыт" : "на сцене"}${d.flags["thunderbolt-shtab"]?.arrive ? `, ждёт ${JSON.stringify(d.flags["thunderbolt-shtab"].arrive)}` : ""}`); }
  } };
const actor = (name, side, extra = {}) => { const a = { uuid: "Actor." + name, name, type: "npc", system: { side }, flags: {}, statuses: new Set(), getFlag(s, k) { return this.flags[k]; }, ...extra }; byUuid[a.uuid] = a; return a; };
const token = (name, c, r, a, arrive = null) => {
  const d = { id: "T" + name, name, x: c * 100, y: r * 100, width: 1, height: 1, hidden: !!arrive, actor: a, actorId: a.uuid, parent: scene,
    flags: { "thunderbolt-shtab": arrive ? { arrive } : {} }, getFlag(s, k) { return this.flags[s]?.[k]; } };
  tokens.push(d); return d;
};
const combatants = [];
const combat = { id: "C", started: true, round: 1, scene, combatants: Object.assign(combatants, { get: id => combatants.find(c => c.id === id) }),
  async createEmbeddedDocuments(type, rows) { for (const r of rows) { combatants.push({ id: "c" + r.tokenId, ...r }); log.push(`  в трекер: ${r.tokenId}${r.initiative ? ` (пропуск ${r.initiative})` : ""}`); } },
  async updateEmbeddedDocuments(type, rows) { for (const r of rows) Object.assign(combatants.find(c => c.id === r._id), r); } };
globalThis.game = { user: { isGM: true }, users: { activeGM: { isSelf: true } }, combat, scenes: { get: () => scene } };
globalThis.canvas = { scene };

const RF = await import(R + "/module/reinforce.mjs");
const hq = actor("Штаб", "ally"), mig = actor("МиГ", "enemy"), su = actor("Су", "enemy"), friend = actor("Свои", "ally");
token("Штаб", 2, 2, hq);
token("МиГ-1", 5, 1, mig, { round: 3 });
token("Су-1", 6, 4, su, { after: hq.uuid, afterName: "Штаб" });
token("Свои-1", 0, 0, friend, { round: 2 });
console.log("тексты:", RF.arriveText({ round: 3 }), "|", RF.arriveText({ after: "x", afterName: "Штаб" }));
console.log("пора:", RF.arriveDue({ round: 3 }, 2), RF.arriveDue({ round: 3 }, 3), RF.arriveDue({ after: "A" }, 1, () => false), RF.arriveDue({ after: "A" }, 1, () => true));
for (const round of [1, 2, 3]) {
  combat.round = round;
  log.push(`раунд ${round}:`);
  const out = await RF.releaseArrivals(combat);
  log.push(`  вышли: ${out.map(d => d.name).join(", ") || "никто"}`);
}
log.push("штаб сбит посреди раунда:");
hq.flags.down = { combat: "C", round: 3 };
await RF.releaseArrivals(combat, { midRound: true });
console.log(log.join("\n"));
