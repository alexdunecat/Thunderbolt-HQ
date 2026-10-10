// Запуск: node tests/run.mjs (сверяет вывод со снимком в tests/snapshots)
import { fileURLToPath as __f } from "node:url";
import { tmpdir as __tmp } from "node:os";
process.argv[2] ??= __f(new URL("..", import.meta.url)).replace(/\/$/, "");
process.argv[3] ??= __tmp() + "/tb-test-out";
const R = process.argv[2];
const F = class { constructor(...a) { this.a = a; } };
const hooks = {};
const log = [];
const msgs = [];
const answers = {};
let dialogs = 0;
const get = (o, p) => p.split(".").reduce((x, k) => x?.[k], o);
const setp = (o, p, v) => { const ks = p.split("."); let x = o; for (const k of ks.slice(0, -1)) x = (x[k] ??= {}); x[ks.at(-1)] = v; };
const expand = ch => { const o = {}; for (const [k, v] of Object.entries(ch)) setp(o, k, v); return o; };
const merge = (a, b) => { for (const [k, v] of Object.entries(b)) { if (v && typeof v === "object" && !Array.isArray(v)) merge(a[k] ??= {}, v); else a[k] = v; } return a; };
class Coll extends Map { [Symbol.iterator]() { return this.values(); } get size() { return super.size; } }
class Combat {
  constructor() { this.id = "C1"; this.round = 0; this.turn = 0; this.flags = {}; this.combatants = new Coll(); }
  get started() { return this.round > 0; }
  get turns() { return [...this.combatants.values()].sort((a, b) => this._sortCombatants(a, b)); }
  get combatant() { return this.turns[this.turn]; }
  getFlag(s, k) { return this.flags[s]?.[k]; }
  async setFlag(s, k, v) { return this.update({ [`flags.${s}.${k}`]: v }); }
  async update(ch, opts = {}) { const e = expand(ch); merge(this, e); for (const f of hooks.updateCombat ?? []) await f(this, e, opts); return this; }
  async updateEmbeddedDocuments(t, ups) { for (const u of ups) { const c = this.combatants.get(u._id); const { _id, ...rest } = u; Object.assign(c, rest); for (const f of hooks.updateCombatant ?? []) f(c, rest); } }
  async startCombat() { return this.update({ round: 1, turn: 0 }); }
  async nextRound() { return this.update({ round: this.round + 1, turn: 0 }, { direction: 1 }); }
  async nextTurn() { if (this.turn + 1 >= this.combatants.size) return this.nextRound(); return this.update({ turn: this.turn + 1 }, { direction: 1 }); }
  async _preDelete() {}
}
Map.prototype.filter = function (f) { return [...this.values()].filter(f); };
Map.prototype.map = function (f) { return [...this.values()].map(f); };
Map.prototype.some = function (f) { return [...this.values()].some(f); };
Map.prototype.find = function (f) { return [...this.values()].find(f); };
Object.assign(Number, { isNumeric: v => typeof v === "number" && !Number.isNaN(v) });
const users = [{ id: "gm", isGM: true, active: true }, { id: "pl", isGM: false, active: true }];
users.find = Array.prototype.find; users.activeGM = users[0];
Object.assign(globalThis, {
  foundry: { data: { fields: { NumberField: F, StringField: F, BooleanField: F, SchemaField: F, ArrayField: F, HTMLField: F, ObjectField: F } },
    abstract: { TypeDataModel: class {} }, utils: { mergeObject: merge, hasProperty: (o, p) => get(o, p) !== undefined, getProperty: get, deepClone: x => structuredClone(x) } },
  Combat, Actor: class {}, Item: class {},
  Dialog: class { constructor(o) { this.o = o; } render() { dialogs++; const names = [...this.o.content.matchAll(/name="([^"]+)"/g)].map(m => m[1]);
    const form = { elements: names.map(n => ({ name: n, type: "select", value: String(answers[n] ?? 2) })) };
    log.push("DIALOG " + this.o.title + " for " + names.join(","));
    setTimeout(() => this.o.buttons.ok.callback([{ querySelector: () => form }]), 0); return this; } },
  Hooks: { on: (n, f) => (hooks[n] ??= []).push(f), once() {}, callAll() {} },
  ChatMessage: { create: async d => { const m = { ...d, getFlag: (s, k) => d.flags?.[s]?.[k], async update(u) { for (const [k, v] of Object.entries(u)) if (k.startsWith("flags.")) setp(d, k, v); } }; msgs.push(m); log.push("CHAT " + (d.content.match(/tb-card-what">([^<]*)/)?.[1] ?? "") + " | " + d.content.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 160)); return m; }, getSpeaker: () => ({}) },
  game: { user: users[0], users, messages: { get contents() { return msgs; } }, settings: { get: () => null }, combat: null },
  ui: { notifications: { info: m => log.push("info " + m), warn: m => log.push("warn " + m) } },
  CONFIG: { sounds: {} },
});
const Rm = await import(R + "/module/dice/rolls.mjs");
const actors = {};
const mkA = (id, type, sys, player) => (actors[id] = { id, uuid: "Actor." + id, name: id, type, hasPlayerOwner: player, system: { speed: 1, breakEv: null, evasion: 3, stats: { ev: 3 }, kind: "air", ...sys },
  testUserPermission: (u) => player && u.id === "pl", async applyDamage(n, o) { log.push(`DAMAGE ${id} ${n} by ${game.user.id} src=${o.source} key=${o.roundKey}`); } });
globalThis.fromUuidSync = u => actors[u.replace("Actor.", "")];
globalThis.fromUuid = async u => actors[u.replace("Actor.", "")];
globalThis.canvas = undefined;
ui.notifications.error = m => log.push("ERROR " + m);
foundry.audio = { AudioHelper: { play: () => log.push("SOUND") } };
CONFIG.sounds.notification = "x.ogg";
const missile = (tgt, total, dmg, who, strain = 0) => msgs.push({ flags: { "thunderbolt-shtab": { card: { type: "attack", attack: true, rolled: true, d10: total, strain, delayed: true, combatKey: "C1:1", targetUuid: "Actor." + tgt, targetName: tgt, parts: [], dmg, actorName: who, actorUuid: "Actor." + who } } }, getFlag(s, k) { return this.flags[s]?.[k]; }, async update(u) { for (const [k, v] of Object.entries(u)) if (k.startsWith("flags.")) setp(this, k, v); } });
mkA("Гроза", "pilot", {}, true); mkA("МиГ", "npc", { grp: "fighter" }, false); mkA("Су", "npc", { grp: "fighter" }, false);
// Гроза: def 3+1=4; Break 6 -> def 7. Missile 6 + strain 1 = 7 -> hit
actors.Гроза.system.breakEv = 6;
missile("Гроза", 6, 4, "МиГ", 1);
// МиГ: def 4, missile 3 -> miss
missile("МиГ", 3, 4, "Гроза");
// Су: def 4, missiles 3 and 2 -> best 3 +1 boost = hit, dmg 4
missile("Су", 3, 4, "Гроза"); missile("Су", 2, 4, "Гроза");
const combat = { id: "C1", round: 1 };
const m = await Rm.resolveVolley(combat, { round: 1 });
const card = m.flags["thunderbolt-shtab"].card;
log.push("CARD " + JSON.stringify(card.targets.map(t => [t.name, t.hit, t.defense, t.best, t.broke, t.by])));
// player client receives the message
game.user = users[1];
Rm.onVolleyCreated(m);
await new Promise(r => setTimeout(r, 20));
console.log(log.join("\n"));
