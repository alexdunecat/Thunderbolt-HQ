// Немезида: появление (заставка асов, реплика AWACS, триггеры открыты), «Задействовать», эффекты в атаке и защите, «Салют», монолог и ответы.
import { fileURLToPath as __f } from "node:url";
process.argv[2] ??= __f(new URL("..", import.meta.url)).replace(/\/$/, "");
const R = process.argv[2];
const F = class { constructor(...a) { this.a = a; } };
const log = [];
const settings = {};
const setp = (o, p, v) => { const ks = p.split("."); let x = o; for (const k of ks.slice(0, -1)) x = (x[k] ??= {}); x[ks.at(-1)] = v; };
let nextPick = null;
const combatFlags = {};
const combat = { id: "C1", started: true, round: 1, getFlag: (s, k) => combatFlags[k], async setFlag(s, k, v) { combatFlags[k] = structuredClone(v); } };
Object.assign(globalThis, {
  foundry: { utils: { deepClone: x => structuredClone(x), mergeObject: Object.assign, getProperty: () => undefined, hasProperty: () => false, randomID: () => "r" }, abstract: { TypeDataModel: class {} },
    data: { fields: { NumberField: F, StringField: F, BooleanField: F, SchemaField: F, ArrayField: F, HTMLField: F, ObjectField: F } } },
  CONST: { DOCUMENT_OWNERSHIP_LEVELS: { LIMITED: 1 }, GRID_TYPES: { GRIDLESS: 0 } },
  Hooks: { on() {}, once() {}, callAll() {} }, CONFIG: { sounds: {}, specialStatusEffects: { DEFEATED: "dead" } },
  game: { user: { id: "gm", isGM: true }, users: { activeGM: { isSelf: true } }, combat, messages: { contents: [] },
    settings: { register() {}, get: (s, k) => settings[k] ?? null, set: async (s, k, v) => { settings[k] = v; } } },
  ui: { notifications: { warn: m => log.push("WARN " + m), info: m => log.push("INFO " + m) } },
  ChatMessage: { create: async d => { log.push(`CHAT ${d.speaker?.alias ?? "?"}: ${d.content.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()}${d.flags?.["thunderbolt-shtab"]?.radio?.caution?.intro ? " [заставка " + JSON.stringify(d.flags["thunderbolt-shtab"].radio.caution.intro) + "]" : ""}`); return d; }, getSpeaker: ({ actor }) => ({ alias: actor?.name }) },
  // окно в стиле HUD: отвечает выбором из nextPick
  Dialog: class { constructor(o) { this.o = o; } close() { this.o.close?.(); }
    render() {
      const ans = nextPick; nextPick = null;
      const form = { elements: Object.entries(ans?.fields ?? {}).map(([name, value]) => ({ name, type: "text", value })), addEventListener() {} };
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
const mkTrig = (key, name) => ({ id: key, type: "trigger", name, system: { key, types: ["Nemesis"], used: false, active: false },
  async update(u) { for (const [k, v] of Object.entries(u)) setp(this, k, v); } });
const mk = (id, d, col = 0) => {
  const a = { id, uuid: "Actor." + id, flags: {}, statuses: new Set(), items: [], ...d,
    getFlag(s, k) { return this.flags[k]; }, async setFlag(s, k, v) { this.flags[k] = structuredClone(v); }, async unsetFlag(s, k) { delete this.flags[k]; },
    async update(u) { for (const [k, v] of Object.entries(u)) { const m = /^flags\.[^.]+\.-=(.+)$/.exec(k); if (m) delete this.flags[m[1]]; else setp(this, k, v); } } };
  const t = { name: d.name, actor: a, hidden: false, document: { parent: scene, width: 1, height: 1 }, center: { x: col * 100 + 50, y: 50 } };
  a.getActiveTokens = () => [t];
  a.items.get = i => a.items.find(x => x.id === i);
  actors[id] = a;
  scene.tokens.push(t);
  return a;
};
const pilot = (id, call, triggers = [], lead = 0) => mk(id, { type: "pilot", name: call, hasPlayerOwner: true, isOwner: true, system: { callsign: call, skills: { lead } }, items: triggers });
const grom = pilot("grom", "Гром", [mkTrig("notyou", "Опять ты!"), mkTrig("handle", "Я с ним справлюсь!"), mkTrig("expartner", "Бывший напарник"), mkTrig("enough", "Хватит болтать"), mkTrig("salute", "Салют"), mkTrig("knowmachine", "Знаю эту машину")], 0);
const vega = pilot("vega", "Вега", [mkTrig("drawattn", "Отвлечь на себя"), mkTrig("philosophy", "Я тоже читал философов"), mkTrig("ibelieved", "Я тоже в это верил")], 2);
const wolf = mk("wolf", { type: "npc", name: "Мобиус", system: { nemesis: true, nemesisOf: "grom", side: "enemy", insignia: "emblems/wolf.webp", lockUuid: "" } }, 2);
const wing = mk("wing", { type: "npc", name: "Ведомый", system: { side: "enemy" } }, 3);
game.actors = Object.values(actors).filter(a => a.type === "pilot");
const N = await import(R + "/module/nemesis.mjs");
const flush = () => new Promise(r => setTimeout(r, 5));
const show = () => { console.log(log.splice(0).join("\n")); };

console.log("Немезида для:", ["grom", "vega"].map(k => `${k}=${N.isNemesisFor(wolf, actors[k])}`).join(" "), "· пилоты:", N.pilotsOf(wolf).map(p => p.name).join(", "));
console.log("до появления:", grom.items.map(t => `${t.name}=${N.trigState(grom, t)}`).join(", "));
game.user.isGM = false; await N.useTrigger(grom, grom.items[0]); game.user.isGM = true;
show();

// появление: заставка асов, реплика AWACS, триггеры открыты
await N.appear(wolf);
await N.appear(wolf, { auto: true });
show();
console.log("после появления:", grom.items.map(t => `${t.name}=${N.trigState(grom, t)}`).join(", "), "· отметка:", JSON.stringify(N.metOf(grom)));

// эффекты в атаке и защите
for (const t of grom.items.slice(0, 3)) await N.useTrigger(grom, t);
show();
const parts = r => r.parts.map(p => `${p[0]} ${p[1] > 0 ? "+" : ""}${p[1]}`).join(", ") || "—";
console.log("Гром по Мобиусу, бросок:", parts(N.nemesisAttack(grom, wolf, { rolled: true, skill: "aim" })), "· без броска:", parts(N.nemesisAttack(grom, wolf)));
console.log("Гром по ведомому:", parts(N.nemesisAttack(grom, wing, { rolled: true })));
console.log("защита Грома: от Мобиуса +", N.nemesisDefense(wolf, grom), "· от ведомого +", N.nemesisDefense(wing, grom));
// союзник вмешался: «Я с ним справлюсь!» пропадает
await N.trackAttack({ getFlag: () => ({ attack: true, actorUuid: vega.uuid, targetUuid: wolf.uuid }) });
const r2 = N.nemesisAttack(grom, wolf, { rolled: true });
console.log("после вмешательства Веги:", parts(r2), "·", r2.notes.join(" "));
// «Отвлечь на себя»: Мобиус держит Вегу? Нет — Вега не его пилот; держит Грома с «Отвлечь» у Веги — тоже нет
await N.useTrigger(vega, vega.items[0]);
show();
wolf.system.nemesisOf = "";   // теперь Немезида всех пилотов
wolf.system.lockUuid = vega.uuid;
console.log("Гром по Мобиусу, Aim (Мобиус держит Вегу):", parts(N.nemesisAttack(grom, wolf, { rolled: true, skill: "aim" })));
console.log("то же, Strafe:", parts(N.nemesisAttack(grom, wolf, { rolled: true, skill: "strafe" })));
wolf.system.nemesisOf = "grom"; wolf.system.lockUuid = "";

// «Знаю эту машину» и «Салют»
nextPick = { pick: "ev" }; await N.useTrigger(grom, grom.items[5]); await flush();
await N.useTrigger(grom, grom.items[4]); await flush();
show();
console.log("отметки Мобиуса:", JSON.stringify(N.fxOf(wolf)));
console.log("Мобиус по Веге:", N.nemesisAttack(wolf, vega).problems.join(" "));
console.log("ведомый по Грому:", N.nemesisAttack(wing, grom).problems.join(" "));
await N.trackAttack({ getFlag: () => ({ attack: true, actorUuid: wing.uuid, targetUuid: grom.uuid }) });
show();
const gr = N.nemesisAttack(grom, wing, { rolled: true });
console.log("следующая атака Грома:", parts(gr)); await gr.take();
console.log("и после неё:", parts(N.nemesisAttack(grom, wing, { rolled: true })));
await N.trackAttack({ getFlag: () => ({ attack: true, actorUuid: vega.uuid, targetUuid: wolf.uuid }) });
show();
const wr = N.nemesisAttack(wolf, grom);
console.log("Мобиус по Грому после вмешательства Веги:", parts(wr), "· запреты:", wr.problems.join(" ") || "нет"); await wr.take(); await flush();
console.log("отметки Мобиуса:", JSON.stringify(N.fxOf(wolf)));

// монолог: кнопки ответа, «Хватит болтать» обрывает его и гарантирует попадание
nextPick = { pick: "go", fields: { text: "Небо не помнит имён." } };
await N.startMonologue(wolf); await flush();
show();
console.log("монолог:", JSON.stringify({ ...N.monologue(), at: undefined }));
console.log("кнопки Грома:", N.replyButtons(grom, wolf).map(b => b.label).join(", "), "· Веги:", N.replyButtons(vega, wolf).map(b => b.label).join(", ") || "нет (не её Немезида)");
console.log("панель:", N.monologueHtml().replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
console.log("Хватит болтать на листе:", N.trigState(grom, grom.items[3]));
await N.respond(grom, "enough"); await flush();
show();
console.log("монолог после:", JSON.stringify(N.monologue()), "· атака Грома:", JSON.stringify((({ forceHit, notes }) => ({ forceHit, notes }))(N.nemesisAttack(grom, wolf))));
// «Я тоже в это верил»: Вега против общей Немезиды, стол согласен
wolf.system.nemesisOf = "";
settings.monologue = { uuid: wolf.uuid, name: "Мобиус", side: "enemy" };
nextPick = { pick: "yes" };
await N.respond(vega, "ibelieved"); await flush(); await flush();
show();
console.log("отметки Мобиуса:", JSON.stringify(N.fxOf(wolf)));
// к вылету: всё снято
await N.resetSortie(grom);
console.log("после подготовки к вылету:", JSON.stringify(N.metOf(grom)), JSON.stringify(N.fxOf(wolf)));

// недостаток и Complication в данных NPC
const { NpcData } = await import(R + "/module/data/models.mjs");
const npcData = (fx) => {
  const d = Object.create(NpcData.prototype);
  Object.assign(d, { tier: "ace", skills: { aim: 2, deploy: 0, dodge: 1, strafe: 1, lead: 0, push: 1 }, markers: {}, kind: "air", nemesis: true,
    stats: { spd: 5, ev: 4, aa: 6, ag: 4, gun: 2, str: 3 }, alt: "med", props: [], strain: { value: 0, max: 0 }, speed: 3, breakEv: null, hp: { value: 3, max: 3 } });
  Object.defineProperty(d, "parent", { value: { getFlag: (s, k) => (k === "nemFx" ? fx : null) } });
  d.prepareDerivedData();
  return `EV ${d.evasion} DEF ${d.defense} MAXSPD ${d.maxSpeed} A-A ${d.aa} comp ${d.compOn.aim}`;
};
console.log("NPC без отметок:", npcData({}), "· EV −1:", npcData({ flaw: "ev" }), "· SPD −1:", npcData({ flaw: "spd" }), "· A-A −1 и Complication:", npcData({ flaw: "aa", comp2: true }));
