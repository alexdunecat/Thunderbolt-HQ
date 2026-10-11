// Запуск: node tests/run.mjs (сверяет вывод со снимком в tests/snapshots)
// Персонаж на земле, личное дело NPC (три картинки, Немезида) и портреты по умолчанию вместо серого силуэта.
import { fileURLToPath as __f } from "node:url";
process.argv[2] ??= __f(new URL("..", import.meta.url)).replace(/\/$/, "");
const R = process.argv[2];
const log = [];
const F = class { constructor(...a) { this.a = a; } };
const isObj = x => x && typeof x === "object" && !Array.isArray(x);
const merge = (a, b) => { for (const [k, v] of Object.entries(b ?? {})) a[k] = isObj(v) && isObj(a[k]) ? merge(a[k], v) : v; return a; };
const setProperty = (o, path, v) => { const ks = path.split("."); let x = o; for (const k of ks.slice(0, -1)) x = x[k] ??= {}; x[ks.at(-1)] = v; };
const updates = [];
Object.assign(globalThis, {
  foundry: { utils: { deepClone: x => structuredClone(x), mergeObject: merge, setProperty, getProperty: () => undefined },
    abstract: { TypeDataModel: class {} }, data: { fields: { NumberField: F, StringField: F, BooleanField: F, SchemaField: F, ArrayField: F, HTMLField: F, ObjectField: F } } },
  CONST: { TOKEN_DISPOSITIONS: { FRIENDLY: 1, HOSTILE: -1 }, TOKEN_DISPLAY_MODES: { NONE: 0, HOVER: 30, OWNER_HOVER: 20 } },
  Hooks: { on() {}, once() {} }, CONFIG: { sounds: {}, specialStatusEffects: { DEFEATED: "dead" } },
  game: { actors: [], settings: { get: () => [] }, user: { isGM: true } },
  ui: { notifications: { warn: m => log.push("WARN " + m) } },
  Actor: class {
    constructor(d) { Object.assign(this, structuredClone(d)); this._source = structuredClone(d); }
    async _preCreate() {} async _preUpdate() {}
    updateSource(u) { this.src = u; }
    static async updateDocuments(list) { updates.push(...list); return list; }
  },
  Item: class {}, Combat: class {}, Application: class {}, FormApplication: class {}, ActorSheet: class {}, ItemSheet: class {}, JournalSheet: class {}, Dialog: { confirm: async () => true }, fromUuidSync: () => null
});
const { TB } = await import(R + "/module/config.mjs");
const { TBActor, defaultPortrait, migratePortraits } = await import(R + "/module/documents/actor.mjs");
const { StaffData } = await import(R + "/module/data/models.mjs");
const { personView } = await import(R + "/module/sheets/actor-sheets.mjs");
const short = p => p ? p.replace(/^.*\/assets\//, "") : String(p);

// портреты по умолчанию
log.push("pilot " + short(defaultPortrait("pilot")));
log.push("npc " + short(defaultPortrait("npc", { side: "enemy" })) + " · ally " + short(defaultPortrait("npc", { side: "ally" })));
for (const role of Object.keys(TB.staffRoles)) log.push(`staff ${role} ${short(defaultPortrait("staff", { role }))}`);

// создание: серый силуэт меняется на портрет, своя картинка остаётся, токен персонажа на земле без полос
const create = async (type, data) => { const a = new TBActor({ type, ...data }); await a._preCreate(data, {}, "u"); return a.src; };
let s = await create("staff", { img: "icons/svg/mystery-man.svg", system: { role: "kin" } });
log.push(`create staff: img ${short(s.img)} token ${short(s.prototypeToken.texture.src)} link ${s.prototypeToken.actorLink} disp ${s.prototypeToken.disposition} bars ${s.prototypeToken.displayBars} bar1 ${s.prototypeToken.bar1.attribute}`);
s = await create("npc", {});
log.push(`create npc (без картинки): img ${short(s.img)} token ${short(s.prototypeToken.texture.src)} link ${s.prototypeToken.actorLink} disp ${s.prototypeToken.disposition}`);
s = await create("pilot", { img: "worlds/w/faces/sova.webp" });
log.push(`create pilot (своё фото): img ${s.img ?? "не тронуто"} token ${s.prototypeToken.texture.src}`);
s = await create("npc", { img: "systems/x/assets/targets/sam.svg", prototypeToken: { actorLink: true, texture: { src: "planes/su-37.webp" } } });
log.push(`create npc (картинки из компендиума): img ${s.img ?? "не тронуто"} token ${s.prototypeToken.texture.src} link ${s.prototypeToken.actorLink}`);

// смена роли: портрет по умолчанию меняется следом, своя картинка нет
const staff = new TBActor({ type: "staff", img: defaultPortrait("staff", { role: "staff" }), system: { role: "staff" } });
staff.prototypeToken = { texture: { src: staff.img } };
let ch = { system: { role: "civil" } };
await staff._preUpdate(ch, {}, "u");
log.push(`role → civil: img ${short(ch.img)} token ${short(ch.prototypeToken?.texture?.src)}`);
const own = new TBActor({ type: "staff", img: "worlds/w/faces/ershov.webp", system: { role: "staff" } });
own.prototypeToken = { texture: { src: own.img } };
ch = { system: { role: "tech" } };
await own._preUpdate(ch, {}, "u");
log.push(`role → tech при своей картинке: img ${ch.img ?? "не тронуто"}`);

// навыки персонажа на земле: конскрипт — общий бонус, ас и дуэлянт — свои значения
const skills = Object.fromEntries(Object.keys(TB.skills).map((k, i) => [k, i]));
for (const tier of ["conscript", "duelist", "ace"]) {
  const d = Object.assign(new StaffData(), { tier, bonus: 1, skills });
  d.prepareDerivedData();
  log.push(`staff ${tier}: ${Object.values(d.skillTotal).join(",")} blocked ${Object.values(d.skillBlocked).some(Boolean)}`);
}

// личное дело NPC: три картинки, Связи и Немезида
game.actors = [{ id: "p1", type: "pilot", name: "Сергей Волков", system: { callsign: "Сова" } }, { id: "p2", type: "pilot", name: "Ира", system: { callsign: "" } }];
const ace = { type: "npc", img: "worlds/w/faces/ace.webp", isToken: false, prototypeToken: { texture: { src: "planes/su-47.webp" } },
  system: { artwork: "worlds/w/art/ace.webp", nemesis: true, nemesisOf: "p1", bonds: [{ name: "Ведомый", npc: true, value: 3, was: [2] }], goals: [{ name: "Сбить Сову", size: 6, value: 2 }], debts: [{ text: "Жизнь командиру", struck: false }] } };
const v = personView(ace);
log.push("images " + v.images.map(m => `${m.key}:${m.label}:${short(m.src)}${m.show ? ":показать" : ""}`).join(" | "));
log.push(`pilots ${JSON.stringify(v.pilotOptions)} nemesis ${v.nemesisName}`);
log.push(`bond pips ${v.bonds[0].pips.map(p => p.on ? "●" : "○").join("")} was ${v.bonds[0].was} · goal ${v.goals[0].pips.length} · debts ${v.debts.length}`);

// миграция при входе ведущего: только серые силуэты
game.actors = [
  { id: "a", type: "npc", _source: { img: "icons/svg/mystery-man.svg", system: { side: "enemy" } }, prototypeToken: { texture: { src: "icons/svg/mystery-man.svg" } } },
  { id: "b", type: "staff", _source: { img: "icons/svg/mystery-man.svg", system: { role: "civil" } }, prototypeToken: { texture: { src: "planes/x.webp" } } },
  { id: "c", type: "pilot", _source: { img: "worlds/w/faces/sova.webp", system: {} }, prototypeToken: { texture: { src: "icons/svg/mystery-man.svg" } } }
];
log.push("migrate " + await migratePortraits() + " " + JSON.stringify(updates.map(u => Object.fromEntries(Object.entries(u).map(([k, x]) => [k, k === "_id" ? x : short(x)])))));

console.log(log.join("\n"));
