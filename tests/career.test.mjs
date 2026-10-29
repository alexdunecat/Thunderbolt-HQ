// Небоевые триггеры: гибель пилота, «Я продолжу твоё дело», «Наследие проекта», «Голос в эфире», «Наставник»,
// «Без лишних вопросов», «Пересмотр условий» и «За мной!» (бросок ведущего манёвра союзникам).
import { fileURLToPath as __f } from "node:url";
process.argv[2] ??= __f(new URL("..", import.meta.url)).replace(/\/$/, "");
const R = process.argv[2];
const F = class { constructor(...a) { this.a = a; } };
const log = [];
const setp = (o, p, v) => { const ks = p.split("."); let x = o; for (const k of ks.slice(0, -1)) x = (x[k] ??= {}); x[ks.at(-1)] = v; };
let nextPick = null;
const combatFlags = {};
const combatants = [];
const combat = { id: "C1", started: true, round: 2, turn: 0, combatants, getFlag: (s, k) => combatFlags[k], async setFlag(s, k, v) { combatFlags[k] = structuredClone(v); } };
Object.assign(globalThis, {
  foundry: { utils: { deepClone: x => structuredClone(x), mergeObject: Object.assign, getProperty: () => undefined, hasProperty: () => false, setProperty: setp, randomID: () => "r" }, abstract: { TypeDataModel: class {} },
    data: { fields: { NumberField: F, StringField: F, BooleanField: F, SchemaField: F, ArrayField: F, HTMLField: F, ObjectField: F } } },
  CONST: { DOCUMENT_OWNERSHIP_LEVELS: { LIMITED: 1 }, GRID_TYPES: { GRIDLESS: 0 } },
  Hooks: { on() {}, once() {}, callAll() {} }, CONFIG: { sounds: {}, specialStatusEffects: { DEFEATED: "dead" } },
  game: { user: { id: "gm", isGM: true }, users: Object.assign([], { activeGM: { isSelf: true, id: "gm", isGM: true } }), combat, messages: { contents: [] },
    settings: { register() {}, get: () => null, set: async () => {} } },
  ui: { notifications: { warn: m => log.push("WARN " + m), info: m => log.push("INFO " + m) } },
  ChatMessage: { create: async d => { log.push(`CHAT ${d.speaker?.alias ?? "?"}: ${d.content.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()}`); return d; }, getSpeaker: ({ actor }) => ({ alias: actor?.name }) },
  Dialog: class { constructor(o) { this.o = o; } close() { this.o.close?.(); }
    render() {
      const ans = nextPick; nextPick = null;
      const form = { elements: [], addEventListener() {} };
      const btn = { dataset: { pick: ans?.pick }, disabled: false, addEventListener: (e, f) => { btn.f = f; } };
      this.o.render({ querySelector: s => (s === "form" ? form : null), querySelectorAll: s => (s === "[data-pick]" ? [btn] : []) });
      setTimeout(() => (ans ? btn.f({ preventDefault() {} }) : this.close()), 0);
      log.push(`DIALOG ${this.o.title}${ans ? ` → ${ans.pick}` : " → закрыто"}`);
      return this;
    }
    static confirm() { return Promise.resolve(true); } },
  Application: class {}, FormApplication: class {}, Actor: class {}, Item: class {}, Combat: class {}, ActorSheet: class {}
});
globalThis.canvas = { ready: true, grid: { type: 1, size: 100, getOffset: p => ({ i: Math.floor(p.y / 100), j: Math.floor(p.x / 100) }), measurePath: ([a, b]) => ({ spaces: Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) / 100 }) }, scene: null, tokens: { placeables: [] } };

const actors = {};
globalThis.fromUuidSync = u => actors[u.replace("Actor.", "")] ?? null;
const scene = { id: "S", tokens: [] };
canvas.scene = scene;
const mkTrig = (key, name, types = ["General"]) => ({ id: key, type: "trigger", name, system: { key, types, used: false, active: false, stack: 0, text: "" },
  async update(u) { for (const [k, v] of Object.entries(u)) setp(this, k, v); } });
const mk = (id, d, col = 0) => {
  const a = { id, uuid: "Actor." + id, flags: {}, statuses: new Set(), items: [], isOwner: true, ...d,
    getFlag(s, k) { return this.flags[k]; }, async setFlag(s, k, v) { this.flags[k] = structuredClone(v); }, async unsetFlag(s, k) { delete this.flags[k]; },
    async update(u) { for (const [k, v] of Object.entries(u)) { const m = /^flags\.[^.]+\.-=(.+)$/.exec(k); if (m) delete this.flags[m[1]]; else if (k.startsWith("flags.")) this.flags[k.split(".").at(-1)] = v; else setp(this, k, v); } },
    async toggleStatusEffect(st, { active }) { active ? this.statuses.add(st) : this.statuses.delete(st); log.push(`STATUS ${this.name}: ${st} ${active}`); },
    async markDoom(reason, o) { log.push(`DOOM ${this.name} (${reason}) от ${o?.sourceUuid ?? "—"}`); },
    async applyDamage(n, o) { log.push(`DMG ${this.name} ${n}${o?.guard ? " (принял за товарища)" : ""}`); },
    testUserPermission: () => false };
  const t = { name: d.name, actor: a, hidden: false, document: { parent: scene, width: 1, height: 1 }, center: { x: col * 100 + 50, y: 50 } };
  a.getActiveTokens = () => [t];
  a.items.get = i => a.items.find(x => x.id === i);
  actors[id] = a;
  scene.tokens.push(t);
  return a;
};
const sys = (o = {}) => ({ callsign: o.call, skills: { aim: 1, deploy: 1, dodge: 1, lead: 0, push: 1, strafe: 1, ...(o.skills ?? {}) }, twist: false, alt: "med", fee: 0, goals: [],
  markers: { grit: false, structure: false, sys: "", doom: false }, lockUuid: "", ...o.extra });
const pilot = (id, call, triggers, col = 0, o = {}) => mk(id, { type: "pilot", name: call, hasPlayerOwner: true, system: sys({ call, ...o }), items: triggers }, col);
const npc = (id, name, tier, col, extra = {}) => mk(id, { type: "npc", name, system: { kind: "air", tier, side: "enemy", lockUuid: "", markerCount: 0, hp: { value: 3 }, props: [], rules: [], ...extra } }, col);

const settings = { voiceDebt: [] };
game.settings.get = (s, k) => settings[k] ?? null;
game.settings.set = async (s, k, v) => { settings[k] = v; };
const lead = pilot("lead", "Ведущий", [mkTrig("everything", "Всё, чему я научился", ["Death"]), mkTrig("projlegacy", "Наследие проекта", ["Death"]), mkTrig("voice", "Голос в эфире", ["Death"]), mkTrig("follow", "За мной!")], 0, { skills: { push: 3, dodge: 2 } });
const heir = pilot("heir", "Наследник", [mkTrig("legacy", "Я продолжу твоё дело", ["Death"]), mkTrig("noquestions", "Без лишних вопросов", ["Passive"])], 0, { skills: { push: 1, dodge: 4 } });
const pupil = pilot("pupil", "Ученик", [mkTrig("mentor", "Наставник", ["Core", "Passive"]), mkTrig("renegotiate", "Пересмотр условий", ["Twist"])], 1, { extra: { fee: 2 } });
const ace = npc("ace", "Ас Стрикс", "ace", 2);
for (const p of [lead, heir, pupil]) p.system.service = { status: "active" };
for (const a of [lead, heir, pupil, ace]) combatants.push({ actor: a, id: a.id, actorId: a.id, name: a.name, parent: combat, initiative: 2, f: {}, getFlag(s, k) { return this.f[k]; }, async setFlag(s, k, v) { this.f[k] = structuredClone(v); } });
game.actors = Object.assign(Object.values(actors), { contents: Object.values(actors) });
globalThis.TBpack = [{ system: { key: "everything" }, toObject: () => ({ _id: "x", name: "Всё, чему я научился", type: "trigger", system: { key: "everything", types: ["Death"] } }) }];
game.packs = { get: () => ({ getDocuments: async () => TBpack }) };
for (const p of [lead, heir, pupil]) {
  p.createEmbeddedDocuments = async (t, list) => { for (const d of list) p.items.push(mkTrig(d.system.key, d.name, d.system.types)); log.push(`+ ${p.name}: ${list.map(d => d.name).join(", ")}`); };
  p.deleteEmbeddedDocuments = async (t, ids) => { for (const id of ids) p.items.splice(p.items.findIndex(i => i.id === id), 1); log.push(`− ${p.name}: ${ids.join(", ")}`); };
}
globalThis.Actor = { create: async d => { log.push(`НОВЫЙ ПИЛОТ ${d.name} (${d.type})`); return null; } };
const C = await import(R + "/module/combat-triggers.mjs");
const L = await import(R + "/module/career-triggers.mjs");
const show = () => { if (log.length) console.log(log.splice(0).join("\n")); };
const cards = [];
ChatMessage.create = async d => { const txt = d.content.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(); cards.push(d); log.push(`CHAT ${d.speaker?.alias ?? "?"}: ${txt}`); return d; };

// состояния на листе
const st = a => a.items.map(t => `${t.name}=${C.ctState(a, t)}`).join(", ");
for (const a of [lead, heir, pupil]) console.log(`${a.name}:`, st(a));

// «Наставник»: наставник и урок
nextPick = { pick: "ok" };
const D = globalThis.Dialog;
globalThis.Dialog = class extends D { render() { const ans = nextPick; nextPick = null; const form = { elements: Object.entries(ans?.form ?? {}).map(([name, v]) => ({ name, type: typeof v === "boolean" ? "checkbox" : "text", value: v, checked: v })), addEventListener() {} };
  const btn = { dataset: { pick: ans?.pick }, disabled: false, addEventListener: (e, f) => { btn.f = f; } };
  this.o.render([{ querySelector: s => (s === "form" ? form : null), querySelectorAll: s => (s === "[data-pick]" ? [btn] : []), closest: () => null }]);
  setTimeout(() => (ans ? btn.f({ preventDefault() {} }) : this.close()), 0); log.push(`DIALOG ${this.o.title}${ans ? ` → ${ans.pick}` : " → закрыто"}`); return this; }
  static confirm() { return Promise.resolve(true); } };
nextPick = { pick: "ok", form: { uuid: lead.uuid, lesson: "держать строй", done: true } };
await C.useCombatTrigger(pupil, pupil.items[0]);
console.log("наставник:", JSON.stringify(pupil.flags.mentor), "· чип:", C.ctView(pupil, pupil.items[0]).chip, "· галочка урока:", L.lessonDone(pupil));
await L.lessonReset(pupil);
console.log("после итогов:", JSON.stringify(pupil.flags.mentor));
nextPick = { pick: "ok", form: { name: "Птенец" } };
await C.useCombatTrigger(lead, lead.items[0]);
console.log("ученик:", lead.flags.student, "· чип:", C.ctView(lead, lead.items[0]).chip);
show();

// «Без лишних вопросов»
heir.system.goals = [];
await C.useCombatTrigger(heir, heir.items[1]);
console.log("Репутация:", JSON.stringify(heir.system.goals));
show();

// «Пересмотр условий»: только после Поворота
await C.useCombatTrigger(pupil, pupil.items[1]);
pupil.system.twist = true;
nextPick = { pick: "pay" };
await C.useCombatTrigger(pupil, pupil.items[1]);
console.log("Гонорар:", pupil.system.fee, "· триггер:", C.ctState(pupil, pupil.items[1]));
show();

// «За мной!»: удачный бросок ведущего
const ok = { rolled: true, success: true, skill: "dodge", d10: 8, d4: 3, actorUuid: lead.uuid };
console.log("кнопка на удаче:", C.followFor(ok)?.name ?? "нет", "· на провале:", C.followFor({ ...ok, success: false })?.name ?? "нет");
await C.offerFollow(lead, ok);
console.log("Наследнику на Dodge:", JSON.stringify(C.followOffer(heir, "dodge")), "· на Push:", JSON.stringify(C.followOffer(heir, "push")), "· самому ведущему:", JSON.stringify(C.followOffer(lead, "dodge")));
C.takeFollow(heir);
console.log("после броска Наследника:", JSON.stringify(C.followOffer(heir, "dodge")), "· Ученику:", JSON.stringify(C.followOffer(pupil, "dodge")));
combat.round = 3;
console.log("в следующем раунде:", JSON.stringify(C.followOffer(pupil, "dodge")));
combat.round = 2;
show();

// гибель Ведущего
await L.onDeath(lead);
show();
console.log("кнопки:", cards.flatMap(c => [...c.content.matchAll(/data-tb-life="([^"]+)"/g)].map(m => m[1])).join(", "), "· долг Голоса:", JSON.stringify(settings.voiceDebt));
console.log("у Ученика:", pupil.items.map(i => i.name).join(", "), "· наставник:", JSON.stringify(pupil.flags.mentor ?? null));
await L.takeLegacy(heir, lead);
console.log("навыки Наследника:", JSON.stringify(heir.system.skills), "· триггер:", heir.items[0].system.used);
show();
