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
  game: { scenes: { viewed: null }, user: users[0], users, messages: { get contents() { return msgs; } }, settings: { get: () => null }, combat: null },
  ui: { notifications: { info: m => log.push("info " + m), warn: m => log.push("warn " + m) } },
  CONFIG: { sounds: {}, specialStatusEffects: { DEFEATED: "dead" } },
});
const { TBCombat, registerCombat, PASS } = await import(R + "/module/documents/combat.mjs");
registerCombat();
const actors = {};
const mkA = (id, type, sys, player) => (actors[id] = { id, uuid: "Actor." + id, name: id, type, hasPlayerOwner: player, system: { speed: 3, breakEv: null, evasion: 3, ...sys },
  testUserPermission: (u) => player && u.id === "pl", async update(u, o) { for (const [k, v] of Object.entries(u)) setp(this, k, v); log.push(`ACTOR ${id} ${JSON.stringify(u)} stallBy=${o?.tbStallBy}`); } });
globalThis.fromUuidSync = u => actors[u.replace("Actor.", "")];
globalThis.canvas = undefined;
const cb = new TBCombat(); game.combat = cb;
const add = (a) => { if (hooks.preCreateCombatant.some(f => f({ actor: a, name: a.name }) === false)) return log.push("refused " + a.name); cb.combatants.set("c" + a.id, { id: "c" + a.id, name: a.name, actor: a, initiative: null, isOwner: true, defeated: false, parent: cb, flags: {}, getFlag(sc, k) { return this.flags[sc]?.[k]; }, async setFlag(sc, k, v) { setp(this.flags, sc + '.' + k, v); for (const f of hooks.updateCombatant) f(this, { flags: {} }); }, async update(u) { Object.assign(this, u); for (const f of hooks.updateCombatant) f(this, u); } }); };
add(mkA("Гроза", "pilot", {}, true)); add(mkA("Ворон", "pilot", { broken: "ma" }, true)); add(mkA("МиГ", "npc", { kind: "air", grp: "fighter" }, false)); add(mkA("Ангар", "npc", { kind: "ground", grp: "obj" }, false));
const wait = ms => new Promise(r => setTimeout(r, ms));
answers.cМиГ = 2; answers.cГроза = 1; answers.cВорон = PASS;
await cb.startCombat(); await wait(400);
// GM client: npcDone flag fires player dialog only on non-GM, so emulate player answering via tracker:
await cb.rollInitiative(["cГроза", "cВорон"]); await wait(400);
log.push("ORDER " + cb.turns.map(c => `${c.name}:${c.initiative}`).join(" ") + " turn=" + cb.turn + " ready=" + cb.flags["thunderbolt-shtab"]?.ready);
// missile at Ворон (broken MAWS) and at МиГ; Break by МиГ
msgs.push({ flags: { "thunderbolt-shtab": { card: { type: "attack", attack: true, delayed: true, atTurn: true, combatKey: "C1:1", targetUuid: "Actor.Ворон", targetName: "Ворон", parts: [["G-A", 6]], dmg: 5, actorName: "МиГ", actorUuid: "Actor.МиГ" } } }, getFlag(s, k) { return this.flags[s]?.[k]; }, async update(u) { for (const [k, v] of Object.entries(u)) if (k.startsWith("flags.")) setp(this, k, v); } });
msgs.push({ flags: { "thunderbolt-shtab": { card: { type: "break", combatKey: "C1:1", speedDrop: 2, actorUuid: "Actor.МиГ", actorName: "МиГ", parts: [], d10: 5 } } }, getFlag(s, k) { return this.flags[s]?.[k]; }, async update(u) { for (const [k, v] of Object.entries(u)) if (k.startsWith("flags.")) setp(this, k, v); } });
actors.МиГ.system.breakEv = 5;
await cb.nextTurn(); await wait(50); log.push("turn now " + cb.combatant?.name);
await cb.nextTurn(); await wait(50); log.push("turn now " + cb.combatant?.name);
await cb.nextTurn(); await wait(600);
log.push("ROUND " + cb.round + " inits " + cb.turns.map(c => `${c.name}:${c.initiative}`).join(" "));
await cb.rollInitiative(["cГроза", "cВорон"]); await wait(400);
log.push("ORDER2 " + cb.turns.map(c => `${c.name}:${c.initiative}`).join(" ") + " turn=" + cb.combatant?.name);
globalThis.CONST = { GRID_TYPES: { GRIDLESS: 0 } };
const A = await import(R + "/module/actions.mjs");
A.registerActions();
const g = actors.Гроза;
globalThis.KeyboardManager = { MODIFIER_KEYS: { SHIFT: "Shift" } }; game.keyboard = { isModifierActive: () => false };
cb.combatants.get("cГроза").tokenId = "T1";
const tokDoc = { id: "T1", uuid: "Scene.S.Token.T1", x: 0, y: 0, width: 0.5, height: 0.5, elevation: 2, name: "Гроза", actor: g, parent: { id: "S", grid: { size: 300, type: 1 } } };
const pre = hooks.preUpdateToken.at(-1), post = () => {};
const move = async ch => { const opts = {}; const ok = pre(tokDoc, ch, opts, "gm"); log.push("pre " + JSON.stringify(ch) + " -> " + ok); if (ok === false) return; Object.assign(tokDoc, ch); post(tokDoc, ch, {}, "gm"); await wait(10); log.push("  " + A.actsSummary(g).label + " | " + A.actsSummary(g).list); };
await move({ x: 100 });         // same zone
await move({ x: 350 });         // next zone
await move({ x: 950 });         // 2 zones -> also out of actions
console.log(log.join("\n"));
log.length = 0;
await move({ elevation: 3 });   // climb
await move({ x: 650 });         // move after all spent
console.log("---\n" + log.join("\n"));
// speed: first change counts, second consecutive is the same action
log.length = 0;
const cG = cb.combatants.get("cГроза");
await cG.setFlag("thunderbolt-shtab", "acts", { round: cb.round, used: 0, rolled: false, freeSpeed: false, list: [] });
cG.initiative = 2;
const preA = hooks.preUpdateActor[0];
for (const v of [4, 5]) { const r = preA(g, { system: { speed: v } }, {}); await wait(10); log.push(`speed ${v} -> ${r} | ${A.actsSummary(g).label} | ${A.actsSummary(g).list}`); g.system.speed = v; }
log.push("free: " + preA(g, { system: { speed: 1 } }, { tbFree: true }));
// altitude from sheet: M->H counted once, token sync skipped; token at elevation 0 compares with sheet alt
const altHook = hooks.preUpdateActor[1];
await cG.setFlag("thunderbolt-shtab", "acts", { round: cb.round, used: 0, rolled: false, freeSpeed: false, list: [] });
g.system.alt = "med";
log.push("sheet M->H: " + altHook(g, { system: { alt: "high" } }, {})); await wait(10);
log.push("  " + A.actsSummary(g).label + " | " + A.actsSummary(g).list);
g.system.alt = "high"; tokDoc.elevation = 0;
log.push("sync token 0->3: " + pre(tokDoc, { elevation: 3 }, { tbSync: true })); await wait(10);
log.push("  " + A.actsSummary(g).label);
await cG.setFlag("thunderbolt-shtab", "acts", { round: cb.round, used: 0, rolled: false, freeSpeed: false, list: [] });
tokDoc.elevation = 0;
log.push("HUD down from elevation 0 (sheet H) to 2: " + pre(tokDoc, { elevation: 2 }, {})); await wait(10);
log.push("  " + A.actsSummary(g).label);
log.push("sheet H->L: " + altHook(g, { system: { alt: "low" } }, {}));
log.push("stall drop tbFree: " + altHook(g, { system: { alt: "med" } }, { tbFree: true }));
// out of fight
g.statuses = new Set(["dead"]);
log.push("dead lock: " + A.actionProblem(g, "lock"));
console.log("--- speed\n" + log.join("\n"));
