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
  Combat, Actor: class {}, Item: class {}, Application: class {}, FormApplication: class {},
  Dialog: class { constructor(o) { this.o = o; } render() { dialogs++; const names = [...this.o.content.matchAll(/name="([^"]+)"/g)].map(m => m[1]);
    const form = { elements: names.map(n => ({ name: n, type: "select", value: String(answers[n] ?? 2) })) };
    log.push("DIALOG " + this.o.title + " for " + names.join(","));
    setTimeout(() => this.o.buttons.ok.callback([{ querySelector: () => form }]), 0); return this; } },
  Hooks: { on: (n, f) => (hooks[n] ??= []).push(f), once() {}, callAll() {} },
  ChatMessage: { updateDocuments: async list => { for (const { _id, ...u } of list) await msgs.find(m => m.id === _id)?.update(u); }, create: async d => { const m = { ...d, id: "m" + msgs.length, getFlag: (s, k) => d.flags?.[s]?.[k], async update(u) { for (const [k, v] of Object.entries(u)) if (k.startsWith("flags.")) setp(d, k, v); } }; msgs.push(m); log.push("CHAT " + (d.content.match(/tb-card-what">([^<]*)/)?.[1] ?? "") + " | " + d.content.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 160)); return m; }, getSpeaker: () => ({}) },
  game: { user: users[0], users, messages: { get contents() { return msgs; } }, settings: { get: () => null }, combat: null },
  ui: { notifications: { info: m => log.push("info " + m), warn: m => log.push("warn " + m) } },
  CONFIG: { sounds: {} },
});
// асы в полную силу (Стрэйнджриал 9.5): лист, чутьё, триггеры
globalThis.CONST = { GRID_TYPES: { GRIDLESS: 0 } };
CONFIG.specialStatusEffects = { DEFEATED: "dead" };
const { TB, roleOf, moveOf, moveReady, hasProp } = await import(R + "/module/config.mjs");
const elev = TB.altElevation;
const docs = [], actors = {};
const scene = { grid: { size: 100 }, tokens: docs, getFlag: () => null };
const mk = (name, col, row, alt, sys = {}, type = "npc", flags = {}) => {
  const a = { name, uuid: "Actor." + name, type, isToken: false, isOwner: true, statuses: new Set(), items: [], flags: { "thunderbolt-shtab": flags },
    system: { kind: "air", side: "enemy", speed: 2, maxSpeed: 4, evasion: 3, breakEv: null, stats: { ev: 3 }, hp: { value: 3, max: 3 }, props: [], ...sys },
    getFlag(s, k) { return this.flags[s]?.[k]; }, async setFlag(s, k, v) { this.flags[s][k] = v; log.push(`FLAG ${name} ${k}=${JSON.stringify(v)}`); },
    async update(u) { log.push(`UPDATE ${name} ${JSON.stringify(u)}`); for (const [k, v] of Object.entries(u)) if (k.startsWith("system.") || k.startsWith("flags.")) setp(this, k, v); },
    testUserPermission: () => false, async applyDamage(n, o) { log.push(`DAMAGE ${name} ${n} src=${o.source}`); } };
  const doc = { name, actor: a, x: col * 100, y: row * 100, width: 1, height: 1, elevation: alt === "ground" ? 0 : elev[alt], parent: scene, hidden: false };
  const tok = { name, actor: a, document: doc, center: { x: col * 100 + 50, y: row * 100 + 50 } };
  doc.object = tok; a.getActiveTokens = () => [tok];
  docs.push(doc); actors[a.uuid] = a; return a;
};
const pilot = (name, key, col, row, alt, sys = {}, flags = {}) => mk(name, col, row, alt, { side: "player", plane: { system: { key } }, planeProps: new Set(sys.propKeys ?? []), ...sys }, "pilot", flags);
globalThis.fromUuidSync = u => actors[u];
globalThis.fromUuid = async u => actors[u];
globalThis.canvas = { ready: true, scene, grid: { type: 1, size: 100, getOffset: p => ({ i: Math.floor(p.y / 100), j: Math.floor(p.x / 100) }) },
  get tokens() { return { placeables: docs.map(d => d.object) }; } };
game.scenes = { viewed: scene };
const Rm = await import(R + "/module/dice/rolls.mjs");
const A = await import(R + "/module/actions.mjs");
const S = await import(R + "/module/scene.mjs");
const K = await import(R + "/module/ace-kit.mjs");
const CT = await import(R + "/module/combat-triggers.mjs");
const SQ = await import(R + "/module/squad.mjs");
const P = await import(R + "/module/ace-play.mjs");
game.thunderbolt = { radio: { send: d => log.push(`RADIO ${d.speaker}: ${d.text}`) } };
game.settings.get = (s, k) => k === "operationsDone" ? 1 : null;

// лист: бюджет навыков (сильнейший пилот + 2), Strain машины + 5, слоты триггеров
const p1 = pilot("Гроза", "su27", 0, 0, "med", { skills: { aim: 3, deploy: 1, dodge: 2, push: 1, lead: 0, strafe: 1 } });
const p2 = pilot("Сокол", "mig29a", 1, 0, "med", { skills: { aim: 2, deploy: 2, dodge: 1, push: 1, lead: 1, strafe: 0 } });
K.setPlaneStrains([{ key: "su27", stats: { str: 12 } }]);
const ace = mk("Кара-Буран", 2, 2, "med", { key: "su27", tier: "ace", stats: { ev: 3, str: null }, aceTriggers: ["again", "back", "prey", "remember"], squad: "Буран", skillTotal: { push: 3, dodge: 2 } });
console.log("бюджет:", K.aceBudget([p1, p2]), "· Strain машины:", K.acePlaneStrain(ace.system), K.acePlaneStrain({ key: "b52h", stats: {} }), K.acePlaneStrain({ key: "su27", stats: { str: 9 } }),
  "· слотов:", K.aceSlots(ace), "Немезиде:", K.aceSlots({ system: { nemesis: true } }));
console.log("триггеры:", K.aceTriggersOf(ace).map(t => `${t.name}${t.used ? "(было)" : ""}`).join(", "));

// «Удар в спину» и «Я тебя помню» в атаке аса
game.combat = { id: "C1", round: 1, started: true };
const other = mk("Союзник-цель", 3, 3, "med", { side: "enemy" });
p1.system.lockUuid = other.uuid;
let ta = CT.triggerAttack(ace, p1, { rolled: true, skill: "aim" });
console.log("по Грозе (держит захват на другом):", JSON.stringify(ta.parts));
await ta.take();
console.log("после пуска:", JSON.stringify(CT.triggerAttack(ace, p1, { rolled: true }).parts), "· отметка:", JSON.stringify(ace.flags["thunderbolt-shtab"].sortie ?? null));
ace.flags["thunderbolt-shtab"].aceFx = { remember: { uuid: p2.uuid, name: "Сокол" } };
console.log("по Соколу (помню):", JSON.stringify(CT.triggerAttack(ace, p2, { rolled: true }).parts));

// «Добыча»: Lead пилоту не помогает, пока ас держит его на захвате
ace.flags["thunderbolt-shtab"].aceFx.prey = { uuid: p2.uuid, name: "Сокол" };
p2.flags["thunderbolt-shtab"].next = [{ label: "Lead Гроза", value: 2 }, { label: "Perk", value: 1 }];
p2.unsetFlag = async (s, k) => { delete p2.flags[s][k]; };
console.log("добыча без захвата:", K.preyedBy(p2)?.name ?? "нет");
ace.system.lockUuid = p2.uuid;
console.log("добыча на захвате:", K.preyedBy(p2)?.name ?? "нет", "· бонусы:", JSON.stringify(await SQ.takeNext(p2)));

// «Чутьё аса»: раз в раунд, при рабочем MAWS
console.log("чутьё:", K.instinctProblem(ace) || "можно");
ace.flags["thunderbolt-shtab"].instinct = "C1:1";
console.log("чутьё повторно:", K.instinctProblem(ace));
const broken = mk("Без MAWS", 4, 4, "med", { tier: "ace", off: new Set(["ma"]) });
console.log("без MAWS:", K.instinctProblem(broken));

// «Не уйдёшь»: промах ракеты аса заходит ещё раз в конце следующего раунда, пока захват держится
ace.system.lockUuid = p1.uuid;
const card = { type: "attack", attack: true, rolled: true, d10: 1, strain: 0, delayed: true, combatKey: "C1:1", targetUuid: p1.uuid, targetName: "Гроза", parts: [], dmg: 5, actorName: ace.name, actorUuid: ace.uuid, tkind: "air" };
msgs.push({ id: "mm", flags: { "thunderbolt-shtab": { card } }, getFlag(s, k) { return this.flags[s]?.[k]; }, async update(u) { for (const [k, v] of Object.entries(u)) if (k.startsWith("flags.")) setp(this, k, v); } });
const v = await Rm.resolveVolley({ id: "C1" }, { round: 1 });
const row = v.flags["thunderbolt-shtab"].card.targets[0];
console.log("залп:", row.hit ? "попал" : "мимо", "· повтор в раунде", row.again, row.keen ? "(Не уйдёшь)" : "");

// HUD ведущего: строка АС
console.log("HUD:", P.aceRowHtml(ace).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
console.log(log.filter(l => /^RADIO|^warn|^info/.test(l)).join("\n"));
