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
  ChatMessage: { updateDocuments: async list => { for (const { _id, ...u } of list) await msgs.find(m => m.id === _id)?.update(u); }, create: async d => { const m = { ...d, id: "m" + msgs.length, getFlag: (s, k) => d.flags?.[s]?.[k], async update(u) { for (const [k, v] of Object.entries(u)) if (k.startsWith("flags.")) setp(d, k, v); } }; msgs.push(m); log.push("CHAT " + (d.content.match(/tb-card-what">([^<]*)/)?.[1] ?? "") + " | " + d.content.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 160)); return m; }, getSpeaker: () => ({}) },
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
const _old = (tgt, total, dmg, who, strain = 0) => msgs.push({ flags: { "thunderbolt-shtab": { card: { type: "attack", attack: true, rolled: true, d10: total, strain, delayed: true, combatKey: "C1:1", targetUuid: "Actor." + tgt, targetName: tgt, parts: [], dmg, actorName: who, actorUuid: "Actor." + who } } }, getFlag(s, k) { return this.flags[s]?.[k]; }, async update(u) { for (const [k, v] of Object.entries(u)) if (k.startsWith("flags.")) setp(this, k, v); } });
let ts = 0;
const card = (tgt, total, dmg, who, extra = {}, key = "C1:3") => { const m = { timestamp: ++ts, flags: { "thunderbolt-shtab": { card: { type: "attack", attack: true, rolled: true, d10: total, strain: 0, delayed: true, combatKey: key, targetUuid: "Actor." + tgt, targetName: tgt, parts: [], dmg, actorName: who, actorUuid: "Actor." + who, ...extra } } }, getFlag(s, k) { return this.flags[s]?.[k]; }, async update(u) { for (const [k, v] of Object.entries(u)) if (k.startsWith("flags.")) setp(this, k, v); } }; m.id = "x" + ts; msgs.push(m); return m; };
const show = m => { const c = m.flags["thunderbolt-shtab"].card; console.log(JSON.stringify(c.targets.map(t => [t.name, t.hit, t.best, t.defense, t.dmg, t.prox || t.again || t.splash || ""])), "lost:", JSON.stringify(c.lost)); };

mkA("Гроза", "pilot", { speed: 4, breakEv: 7 }, true);
mkA("Ангар", "npc", { kind: "ground", defense: 6 }, false);
// защита против черт: обычная 7 + 4 = 11; QAAM в своей зоне без Break! 3 + 4; HVAA Speed вполовину 7 + 2; GPB по Occlusion 6 − 2
console.log("защита:", [Rm.missileDef(null, actors.Гроза, {}), Rm.missileDef(null, actors.Гроза, { wkey: "QAAM", close: true }), Rm.missileDef(null, actors.Гроза, { wkey: "QAAM", close: false }),
  Rm.missileDef(null, actors.Гроза, { wkey: "HVAA" }), Rm.missileDef(null, actors.Ангар, { wkey: "GPB" }), Rm.missileDef(null, actors.Ангар, {})].join(" "));
// HPAA: промах на 1–2 — неконтактный взрыв
for (const t of [8, 6, 5]) { const c = Rm.computeCard({ rolled: true, d10: t, parts: [], dc: 8, wkey: "HPAA", dmg: 8 }); console.log(`HPAA ${t} против 8: успех ${!!c.success}, рядом ${!!c.proxHit}`); }

// раунд 3: SAAM держит захват и мажет, SAAM без захвата, HPAA рядом, залп 4AAM на три цели, UGB ×2, QAAM в упор против Break!
actors.Гроза.system.speed = 1; actors.Гроза.system.breakEv = null;
mkA("МиГ", "npc", { grp: "fighter" }, false); mkA("Су", "npc", { grp: "fighter", lockUuid: "Actor.Ангар" }, false);
mkA("Мираж", "npc", { grp: "fighter" }, false); mkA("Торнадо", "npc", { grp: "fighter", breakEv: 9 }, false); mkA("Ястреб", "npc", { grp: "fighter" }, false);
actors.Гроза.system.lockUuid = "Actor.МиГ";
card("МиГ", 2, 6, "Гроза", { wkey: "SAAM" });
card("Гроза", 9, 6, "Су", { wkey: "SAAM" });
card("Мираж", 3, 8, "Гроза", { wkey: "HPAA" });
card("Ястреб", 5, 3, "Гроза", { wkey: "4AAM", salvo: [{ uuid: "Actor.Торнадо", name: "Торнадо", dc: 10 }, { uuid: "Actor.Мираж", name: "Мираж", dc: 4 }] });
card("Ангар", 6, 6, "Гроза", { wkey: "UGB", ugbPerk: "double", bomb: true });
card("Торнадо", 5, 4, "Гроза", { wkey: "QAAM", close: true });
const combat = { id: "C1", round: 3 };
show(await Rm.resolveVolley(combat, { round: 3 }));
const saam = msgs.find(m => m.flags["thunderbolt-shtab"].card.wkey === "SAAM" && m.flags["thunderbolt-shtab"].card.targetName === "МиГ").flags["thunderbolt-shtab"].card;
console.log("SAAM после промаха:", saam.combatKey, saam.reattack, !!saam.resolved);
console.log(log.filter(l => l.startsWith("DAMAGE")).join("\n")); log.length = 0;

// раунд 4: повторный заход SAAM с тем же итогом; МиГ сбросил скорость — защита 3, итог 2 всё равно мимо, второго захода нет
actors.МиГ.system.speed = 0;
show(await Rm.resolveVolley(combat, { round: 4 }));
console.log("SAAM после второго промаха:", saam.combatKey, !!saam.resolved);
// SAAM: стрелок сделал Break! после пуска — ракета потеряна
const s2 = card("МиГ", 9, 6, "Гроза", { wkey: "SAAM" }, "C1:5");
msgs.push({ timestamp: ++ts, id: "b1", flags: { "thunderbolt-shtab": { card: { type: "break", actorUuid: "Actor.Гроза" } } }, getFlag(s, k) { return this.flags[s]?.[k]; } });
show(await Rm.resolveVolley(combat, { round: 5 }));
console.log("карточка:", s2.flags["thunderbolt-shtab"].card.lost);
// UGB: на Perk кнопки вместо +1 к следующей, после выбора — строка
const ugb = { type: "attack", attack: true, rolled: true, d10: 7, d4: 4, perkOn: 4, compOn: 1, parts: [], dc: 6, wkey: "UGB", targetUuid: "Actor.Ангар", targetName: "Ангар", dmg: 6, actorUuid: "Actor.Гроза", actorName: "Гроза", notes: [] };
const strip = h => h.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
console.log("UGB Perk:", strip(Rm.renderCard(ugb)));
console.log("UGB Perk ×2:", strip(Rm.renderCard({ ...ugb, ugbPerk: "double" })));
console.log("HPAA рядом:", strip(Rm.renderCard({ ...ugb, wkey: "HPAA", d4: 2, d10: 4, dc: 6, dmg: 8, targetName: "Мираж" })));
// EMRG: итог по воздуху Aim, по земле Deploy (сдвиг), каждая строка против своей защиты
const rail = { type: "rail", attack: true, label: "EMRG: линия →", rolled: true, d10: 6, d4: 3, perkOn: 4, compOn: 1, parts: [["Прицел", 2], ["Speed", -1]], strain: 0, dc: null, dmg: 12, depShift: -1,
  line: [{ uuid: "Actor.МиГ", name: "МиГ", vs: 7, gnd: false }, { uuid: "Actor.Ангар", name: "Ангар", vs: 6, gnd: true }, { uuid: "Actor.Мираж", name: "Мираж", vs: 8, gnd: false, applied: false }], notes: [], actorName: "Гроза" };
console.log("EMRG:", strip(Rm.renderCard(rail)));
console.log("EMRG пусто:", strip(Rm.renderCard({ ...rail, line: [] })));
