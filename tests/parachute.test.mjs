// Запуск: node tests/run.mjs (сверяет вывод со снимком в tests/snapshots)
// Купол на карте: у кого есть катапульта, шанс NPC, купол живёт до конца следующего раунда, расстрел асом или дуэлянтом
import { fileURLToPath as __f } from "node:url";
process.argv[2] ??= __f(new URL("..", import.meta.url)).replace(/\/$/, "");
const R = process.argv[2];
const F = class { constructor(...a) { this.a = a; } };
const log = [], messages = [];
const getp = (o, p) => p.split(".").reduce((x, k) => x?.[k], o);
const setp = (o, p, v) => { const ks = p.split("."); let x = o; for (const k of ks.slice(0, -1)) x = (x[k] ??= {}); x[ks.at(-1)] = v; };
const dice = [];
const combat = { id: "C", started: true, round: 2, combatants: [], getFlag: () => null, setFlag: async () => {} };
Object.assign(globalThis, {
  foundry: { utils: { getProperty: getp, hasProperty: (o, p) => getp(o, p) !== undefined, setProperty: setp, deepClone: x => structuredClone(x), mergeObject: Object.assign },
    abstract: { TypeDataModel: class {} }, data: { fields: { NumberField: F, StringField: F, BooleanField: F, SchemaField: F, ArrayField: F, HTMLField: F, ObjectField: F } } },
  CONST: { DOCUMENT_OWNERSHIP_LEVELS: { LIMITED: 1 }, GRID_TYPES: { GRIDLESS: 0, SQUARE: 1 } },
  Hooks: { on() {}, once() {}, callAll() {} }, CONFIG: { specialStatusEffects: { DEFEATED: "dead" }, sounds: {} },
  Actor: class {}, Item: class {}, Combat: class {}, Application: class {}, FormApplication: class {}, ActorSheet: class {}, Dialog: class {},
  ChatMessage: { create: async d => { const m = { id: "m" + messages.length, ...d, getFlag: (s, k) => d.flags?.[s]?.[k] }; messages.push(m);
    log.push("  чат: " + d.content.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()); return m; }, getSpeaker: () => ({}) },
  Roll: class { constructor(f) { this.f = f; } async evaluate() { this.total = this.f === "1d10" ? dice.shift() ?? 5 : 3; return this; } },
  ui: { notifications: { info: m => log.push("  info " + m), warn: m => log.push("  warn " + m), error: m => log.push("  error " + m) } }
});
Number.isNumeric = n => typeof n === "number" && Number.isFinite(n);
const byUuid = {};
globalThis.fromUuidSync = u => byUuid[u] ?? null;
const tiles = [], tokens = [];
const coll = arr => Object.assign(arr, { get: id => arr.find(t => t.id === id), contents: arr });
const scene = { id: "S", grid: { size: 100, type: 1 }, tiles: coll(tiles), tokens: coll(tokens), getFlag: () => null,
  async createEmbeddedDocuments(type, rows) {
    return rows.map(r => { const t = { id: "Tile" + (tiles.length + 1), parent: scene, ...r, getFlag(s, k) { return this.flags[s]?.[k]; } }; tiles.push(t);
      log.push(`  купол ${t.flags["thunderbolt-shtab"].parachute.name}: ${t.x},${t.y} ${t.width}×${t.height}, раунд ${t.flags["thunderbolt-shtab"].parachute.round}`); return t; });
  },
  async deleteEmbeddedDocuments(type, ids) { for (const id of ids) { const i = tiles.findIndex(t => t.id === id); log.push(`  купол снят: ${tiles[i].flags["thunderbolt-shtab"].parachute.name}`); tiles.splice(i, 1); } } };
combat.scene = scene;
globalThis.game = { user: { id: "gm", isGM: true }, users: Object.assign([], { activeGM: { isSelf: true } }), combat, scenes: { get: () => scene }, messages: { contents: messages },
  settings: { get: () => null, register() {} }, socket: { emit() {} } };
globalThis.canvas = { ready: true, scene, tokens: { placeables: [] }, grid: { size: 100, type: 1 } };
const actor = (name, type, sys, extra = {}) => {
  const a = { uuid: "Actor." + name, id: name, name, type, system: { side: "enemy", tier: "conscript", kind: "air", grp: "fighter", markers: {}, skills: { strafe: 2 }, skillTotal: { strafe: 2 }, ...sys },
    flags: {}, statuses: new Set(), items: [], hasPlayerOwner: type === "pilot", isOwner: true, getFlag(s, k) { return this.flags[k]; },
    async update(ch) { for (const [k, v] of Object.entries(ch)) setp(this, k, v); log.push(`  ${name}: ${JSON.stringify(ch)}`); return this; }, getActiveTokens: () => [], ...extra };
  byUuid[a.uuid] = a; return a;
};
const token = (a, c, r) => { const d = { id: "T" + a.name, name: a.name, x: c * 100, y: r * 100, width: 1, height: 1, hidden: false, actor: a, actorId: a.id, parent: scene }; tokens.push(d); return d; };

const P = await import(R + "/module/parachute.mjs");
const kinds = [
  ["МиГ-29 конскрипт", { grp: "fighter" }], ["Су-25", { grp: "attack" }], ["Ту-160", { grp: "heavy" }], ["AC-130", { grp: "heavy", key: "ac130" }],
  ["Ил-76", { grp: "support" }], ["AWACS", { grp: "support" }], ["Ми-24", { grp: "heli" }], ["БПЛА", { grp: "heli", key: "uav" }], ["Боинг", { grp: "civil" }],
  ["Аркбёрд", { grp: "boss" }], ["Крейсер", { grp: "fighter", rules: ["aerialship"] }], ["МБР", { key: "icbm", grp: "fighter" }],
  ["Т-80", { kind: "ground", grp: "armor" }], ["Эсминец", { kind: "ship", grp: "sea" }]];
console.log("катапульта:", kinds.map(([n, s]) => `${n} ${P.canEject(actor(n, "npc", s)) ? "да" : "нет"}`).join(", "));
console.log("шанс из 10:", ["conscript", "duelist", "ace"].map(t => `${t} ${P.ejectChance({ system: { tier: t } })}`).join(", "));
const ace = actor("Ас", "npc", { tier: "ace" }), duel = actor("Дуэлянт", "npc", { tier: "duelist" }), cons = actor("Конскрипт", "npc", {});
const tankAce = actor("Танкист", "npc", { tier: "ace", kind: "ground" }), downAce = actor("Сбитый ас", "npc", { tier: "ace" });
downAce.flags.down = { combat: "C" };
console.log("стреляет по куполам:", [ace, duel, cons, tankAce, downAce].map(a => `${a.name} ${P.canShootChutes(a) ? "да" : "нет"}`).join(", "));
console.log("снять в раунде:", [2, 3, 4].map(r => `${r}: ${P.chuteExpired({ round: 2 }, r) ? "да" : "нет"}`).join(", "));
console.log("место в клетке:", [0, 1, 2].map(k => JSON.stringify(P.chutePlace([3, 1], 100, k))).join(" "));

// сбитый NPC катапультируется, пилот игрока — после удачного броска
const mig = actor("МиГ-1", "npc", {}), player = actor("Цой", "pilot", { side: "player" });
token(mig, 3, 1); token(player, 4, 1); token(ace, 4, 2); token(duel, 6, 6); const tAlly = token(actor("Свой ас", "npc", { tier: "ace", side: "ally" }), 3, 2);
log.push("раунд 2: МиГ-1 сбит, катапульта:");
await P.dropChute(mig);
await P.dropChute(mig);
log.push("раунд 2: игрок катапультировался:");
await P.dropChute(player);
const chuteOf = n => tiles.find(t => t.flags["thunderbolt-shtab"].parachute.name === n);
log.push("кто может стрелять по куполу МиГ-1: " + P.shootersFor(chuteOf("МиГ-1"), tokens, 100).map(t => t.name).join(", "));
log.push("кто может стрелять по куполу игрока: " + P.shootersFor(chuteOf("Цой"), tokens, 100).map(t => t.name).join(", "));
log.push("ас бьёт по куполу игрока, d10 = 2 (мимо):");
dice.push(2);
await P.shootChute(chuteOf("Цой"), tokens.find(t => t.name === "Ас"));
log.push("ас бьёт снова, d10 = 6 (попал):");
dice.push(6);
await P.shootChute(chuteOf("Цой"), tokens.find(t => t.name === "Ас"));
log.push(`статус игрока: ${player.system.service?.status}`);
for (const round of [3, 4]) { combat.round = round; log.push(`раунд ${round}:`); await P.clearChutes(combat); }
console.log(log.join("\n"));
