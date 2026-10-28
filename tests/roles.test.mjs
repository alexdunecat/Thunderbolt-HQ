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
// роли машин, фирменные приёмы и свойства (Стрэйнджриал 8.4–8.6)
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
    async update(u) { log.push(`UPDATE ${name} ${JSON.stringify(u)}`); for (const [k, v] of Object.entries(u)) if (k.startsWith("system.")) setp(this, k, v); },
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

// роли и приёмы: у пилота по машине, у NPC только у аса
const su35 = pilot("Гроза", "su35", 2, 2, "low");
const ace = mk("Феникс-1", 6, 6, "high", { key: "f14a", tier: "ace" });
const consc = mk("Конскрипт", 7, 7, "high", { key: "f14a", tier: "conscript" });
console.log("роли:", roleOf(su35), moveOf(su35), "·", roleOf(ace), moveOf(ace), "·", roleOf(consc) || "—", moveOf(consc) || "—", "· книга fa:", TB.roleOf.fa, "gs:", TB.roleOf.gs ?? "—");
console.log("приёмов:", Object.keys(TB.planeMoves).length, "машин с приёмом:", Object.keys(TB.moveOf).length, "· ролей у машин:", Object.keys(TB.roleOf).length);

// High Speed и сверхзвук: Move на 2 зоны, скорость заодно
const hs = pilot("Ястреб", "mig31", 0, 0, "med", { propKeys: ["highspeed"], speed: 3, maxSpeed: 5 });
const sc = pilot("Тайфун", "typhoon", 0, 1, "med", { propKeys: ["supercruise"], speed: 4, maxSpeed: 4 });
const slow = pilot("Медленный", "mig31", 0, 2, "med", { propKeys: ["highspeed"], speed: 3, maxSpeed: 4 });
console.log("2 зоны:", JSON.stringify(A.twoZones(hs)), JSON.stringify(A.twoZones(sc)), JSON.stringify(A.twoZones(slow)));

// «Универсал»: Improved с большим из Aim и Deploy; «Штурмовой заход»
const multi = pilot("Многоцелевой", "su30", 1, 1, "low", { skillTotal: { aim: 1, deploy: 3 }, skillBlocked: {} });
const plain = pilot("Простой", "su27", 1, 1, "low", { skillTotal: { aim: 1, deploy: 3 }, skillBlocked: {} });
console.log("Improved по воздуху:", Rm.foxSkill(multi, true), Rm.foxSkill(plain, true));
const su25 = pilot("Грач", "su25", 3, 3, "low");
const tank = mk("Танк", 3, 3, "ground", { kind: "ground", grp: "armor", defense: 5 });
const samFar = mk("ЗРК", 4, 3, "ground", { kind: "ground", grp: "ad", defense: 5 });
const tD = a => Rm.describeTarget(a, a.name);
console.log("Штурмовой заход:", Rm.casRun(su25, tD(tank)), Rm.casRun(su25, tD(samFar)), Rm.casRun(plain, tD(tank)));
const f4g = pilot("Ласка", "f4g", 3, 3, "low", { propKeys: ["sead"] });
console.log("Подавление ПВО:", JSON.stringify(Rm.seadPart(f4g, tD(samFar))), JSON.stringify(Rm.seadPart(f4g, tD(tank))));

// «Прицельный комплекс»: с Высокой по земле ракетами можно, пушкой нельзя
const su24 = pilot("Бомбер", "su24", 3, 2, "high");
console.log("бомбер с Высокой:", S.reachProblems(su24, tD(tank), 2, { strike: true }).problems.join(" ") || "можно", "· пушкой:", S.reachProblems(su24, tD(tank), 0).problems.join(" "));

// Малозаметность и РЭБ: захват только из той же зоны; РЭБ +1 к защите
const f22 = mk("Раптор", 5, 5, "med", { props: [{ key: "stealth" }] });
const growler = mk("Гроулер", 6, 5, "med", { props: [{ key: "ecm" }] });
const wing = mk("Ведомый", 6, 5, "med");
console.log("стелс:", S.sameZoneLock(f22) ? "только своя зона" : "можно", "· под РЭБ:", S.sameZoneLock(wing) ? "только своя зона" : "можно",
  "· защита под РЭБ:", S.defenseWithWeather(wing, { ev: 0 }), "без:", S.defenseWithWeather(consc, { ev: 0 }));

// залп конца раунда: кобра, вираж, 104:0
game.combat = { id: "C1", round: 1, started: true };
const cobra = mk("Кобра", 8, 0, "med", { key: "su35", tier: "ace" }, "npc", { cobra: "C1:1" });
const lightP = pilot("Вираж", "mig29a", 2, 5, "med");
const shooter = mk("МиГ", 3, 5, "med");
const f15 = pilot("Игл", "f15c", 0, 5, "med");
const bandit = mk("Бандит", 1, 5, "med", { speed: 2, evasion: 3 });  // защита 5
const missile = (tgt, total, who) => msgs.push({ flags: { "thunderbolt-shtab": { card: { type: "attack", attack: true, rolled: true, d10: total, strain: 0, delayed: true, combatKey: "C1:1", targetUuid: tgt.uuid, targetName: tgt.name, parts: [], dmg: 5, actorName: who.name, actorUuid: who.uuid, tkind: "air" } } },
  getFlag(s, k) { return this.flags[s]?.[k]; }, async update(u) { for (const [k, v] of Object.entries(u)) if (k.startsWith("flags.")) setp(this, k, v); } });
missile(cobra, 9, su35); missile(lightP, 1, shooter); missile(bandit, 3, f15);
const m = await Rm.resolveVolley({ id: "C1" }, { round: 1 });
const card = m.flags["thunderbolt-shtab"].card;
console.log("залп:", JSON.stringify(card.targets.map(t => [t.name, t.hit, t.cobra ?? false, t.ace?.name ?? null])), "· вираж:", JSON.stringify(card.turns));
console.log(log.filter(l => /UPDATE Вираж|DAMAGE/.test(l)).join("\n"));
