// Наведение на системы кораблей: пушки кораблей (по кому, дальность, спаренные), схема, запреты, урон по системе с переносом лишнего, залп по системам.
import { fileURLToPath as __f } from "node:url";
import fs from "node:fs";
process.argv[2] ??= __f(new URL("..", import.meta.url)).replace(/\/$/, "");
const R = process.argv[2];
const F = class { constructor(...a) { this.a = a; } };
const log = [];
const msgs = [];
let pickQueue = [];
const dialogs = [];
const setp = (o, p, v) => { const ks = p.split("."); let x = o; for (const k of ks.slice(0, -1)) x = (x[k] ??= {}); x[ks.at(-1)] = v; };
Object.assign(globalThis, {
  foundry: { utils: { deepClone: x => structuredClone(x), mergeObject: Object.assign, getProperty: () => undefined, hasProperty: () => false }, abstract: { TypeDataModel: class {} },
    data: { fields: { NumberField: F, StringField: F, BooleanField: F, SchemaField: F, ArrayField: F, HTMLField: F, ObjectField: F } } },
  CONST: { DOCUMENT_OWNERSHIP_LEVELS: { LIMITED: 1 }, GRID_TYPES: { GRIDLESS: 0 } },
  Hooks: { on() {}, once() {}, callAll() {} }, CONFIG: { sounds: {}, specialStatusEffects: { DEFEATED: "dead" } },
  game: { user: { id: "gm", isGM: true }, users: [], macros: [], folders: [], messages: { contents: msgs }, combat: null, settings: { get: () => null }, actors: [] },
  ui: { notifications: { warn: m => log.push("warn " + m), info() {} } },
  ChatMessage: { updateDocuments: async list => { for (const { _id, ...u } of list) await msgs.find(m => m.id === _id)?.update(u); }, create: async d => { msgs.push({ ...d, id: "m" + msgs.length, getFlag: (s, k) => d.flags?.[s]?.[k], async update(u) { for (const [k, v] of Object.entries(u)) if (k.startsWith("flags.")) setp(d, k, v); } }); log.push("CHAT " + d.content.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 200)); return msgs.at(-1); }, getSpeaker: () => ({}) },
  // окно выбора системы: отвечает следующим номером из очереди
  Dialog: class { constructor(o) { this.o = o; } close() { this.o.close?.(); } render() { if (!this.o.buttons.ok) { dialogs.push(this.o); setTimeout(() => this.close(), 0); return this; }
    const i = pickQueue.shift(); log.push(`DIALOG ${this.o.title} → ${i}`);
    const form = { elements: [{ name: "sys", type: "hidden", value: String(i) }] };
    setTimeout(() => this.o.buttons.ok.callback([{ querySelector: () => form }]), 0); return this; } },
  Actor: class { constructor(d) { Object.assign(this, structuredClone(d)); this.flags ??= {}; this.statuses = new Set(); }
    get isOwner() { return true; } getFlag(s, k) { return this.flags[s]?.[k]; }
    async update(u) { for (const [k, v] of Object.entries(u)) setp(this, k, v); return this; }
    async toggleStatusEffect(id) { this.statuses.add(id); log.push("DEFEATED " + this.name); } getActiveTokens() { return []; } },
  Item: class {}, Combat: class {}, Application: class {}, FormApplication: class {}, ActorSheet: class {}, fromUuidSync: () => null
});
globalThis.canvas = undefined;
const packs = JSON.parse(fs.readFileSync(R + "/tests/fixtures/npcs.json", "utf8"));
const { TBActor } = await import(R + "/module/documents/actor.mjs");
const Sc = await import(R + "/module/scene.mjs");
const A = await import(R + "/module/aim.mjs");
const Rm = await import(R + "/module/dice/rolls.mjs");
const mk = key => { const d = structuredClone(packs[key]); return new TBActor({ ...d, uuid: "Actor." + key, id: key, items: [] }); };
const sys = (a, re) => a.system.systems.find(y => re.test(y.name));
const actors = {};
globalThis.fromUuidSync = u => actors[u.replace("Actor.", "")];

// пушки кораблей: по кому бьют, дальность, спаренные
const sov = mk("sovremenny"), nim = mk("nimitz"), roos = mk("roosevelt"), lit = mk("littoria"), iowa = mk("iowa"), tarpan = mk("tarpan");
console.log("по кому:", [[sov, /артустановки №1/], [nim, /CIWS №1/], [lit, /Носовой ЗАК/], [iowa, /калибр.*№1/], [tarpan, /Универсальные башни №1/], [tarpan, /ближней обороны №1/]]
  .map(([a, re]) => `${sys(a, re).name}=${Sc.gunVs(a, sys(a, re))}`).join(" · "));
console.log("корабль целиком:", ["sovremenny", "nimitz", "littoria"].map(k => `${k}=${Sc.gunVs(mk(k))}`).join(" "));
console.log("дальность:", [[roos, /Зенитные батареи №1/], [lit, /Носовой ЗАК/], [tarpan, /Универсальные башни №1/], [sov, /артустановки №1/]].map(([a, re]) => `${sys(a, re).name}=${Sc.sysGunReach(sys(a, re))}`).join(" · "));
const s1 = sys(sov, /№1/);
console.log("Strafe спаренных: обе целы", Sc.sysStrafe(sov, s1));
sys(sov, /№2/).value = 0;
console.log("Strafe спаренных: одна", Sc.sysStrafe(sov, s1), "· ЗАК Литтории", Sc.sysStrafe(lit, sys(lit, /Носовой/)), "· CIWS Нимица", Sc.sysStrafe(nim, sys(nim, /CIWS №1/)));

console.log("воздушные цели для ракет:", ["littoria", "arkbird", "solg", "nimitz", "kirov"].map(k => `${k}=${Sc.isAirTarget({ kind: "ship", actor: mk(k) }) ? "Air-Air/Aim" : "Air-Gnd/Deploy"}`).join(" "));
// схема: раскладка по ролям и запреты
const p205 = mk("roosevelt");
console.log("точки Рузвельта:", JSON.stringify(A.spotsOf(p205)));
const solg = mk("solg");
console.log("SOLG ядро 2:", A.sysBlock(solg, 5) || "открыто");
sys(solg, /ускорители №2/).value = 0;
console.log("SOLG ядро 2 без ускорителя:", A.sysBlock(solg, 5) || "открыто", "· ствол:", A.sysBlock(solg, 8));
const reac = roos.system.systems.findIndex(y => /Реактор/.test(y.name));
console.log("реактор:", A.sysBlock(roos, reac) || "открыт");
roos.system.systems.filter(y => /сопла №[12]/.test(y.name)).forEach(y => { y.value = 0; });
console.log("реактор без 2 сопел:", A.sysBlock(roos, reac) || "открыт");
console.log("по умолчанию у Нимица:", nim.system.systems[A.defaultSys(nim)].name);
const html = A.schematicHtml({ actor: nim, name: "Нимиц", token: null });
console.log("схема:", (html.match(/data-aim-sys="\d+"/g) ?? []).length / 2, "точек,", /class="tb-aim-spot weapon sel"/.test(html) ? "оружие выбрано" : "без выбора");
if (process.env.AIM_HTML) fs.writeFileSync(process.env.AIM_HTML, A.schematicHtml({ actor: mk("roosevelt"), name: "Рузвельт", token: null }, { selected: 4 }));

// урон по системе: лишнее уходит на систему из окна
const kirov = mk("kirov"); actors.kirov = kirov;
pickQueue = [2];
await kirov.applyDamage(7, { system: 0, sourceUuid: "Actor.x" });
console.log("Киров:", kirov.system.systems.map(y => `${y.name} ${y.value}`).join(", "));
pickQueue = [1];
await kirov.applyDamage(4, { system: 0 });
console.log("Киров по мёртвой системе:", kirov.system.systems.map(y => `${y.name} ${y.value}`).join(", "));
pickQueue = [2];
await kirov.applyDamage(30, { system: 1 });
console.log("Киров добит:", kirov.system.systems.map(y => y.value).join(","), [...kirov.statuses].join(","));

// залп: ракеты по одной системе складываются, по разным — отдельно; урон уходит с номером системы
const nimitz = mk("nimitz"); actors.nimitz = nimitz;
const dmgLog = [];
nimitz.applyDamage = async (n, o) => dmgLog.push(`${n} → система ${o.system}`);
const missile = (total, sysI, dmg = 5) => msgs.push({ flags: { "thunderbolt-shtab": { card: { type: "attack", attack: true, rolled: true, d10: total, delayed: true, combatKey: "C1:1",
  targetUuid: "Actor.nimitz", targetName: "Нимиц", parts: [], dmg, sys: sysI, sysName: nimitz.system.systems[sysI].name, actorName: "Гроза", actorUuid: "Actor.g" } } },
  getFlag(s, k) { return this.flags[s]?.[k]; }, async update(u) { for (const [k, v] of Object.entries(u)) if (k.startsWith("flags.")) setp(this, k, v); } });
missile(4, 1); missile(3, 1); missile(2, 3);
const m = await Rm.resolveVolley({ id: "C1", round: 1 }, { round: 1 });
console.log("залп:", m.flags["thunderbolt-shtab"].card.targets.map(t => `${t.name} лучшая ${t.best} против ${t.defense} → ${t.hit ? "попал " + t.dmg : "мимо"}`).join(" | "));
console.log("урон:", dmgLog.join(", "));

// пульт Fox Two!: станции, две кнопки, схема у корабля
const items = [
  { id: "w1", type: "weapon", name: "XLAA · ракеты большой дальности", system: { key: "XLAA", target: "air", ammo: { value: 4, max: 4 }, dmg: "6", reach: 2, aa: 1, aim: 1 } },
  { id: "w2", type: "weapon", name: "LAGM · ракеты по земле", system: { key: "LAGM", target: "ground", ammo: { value: 0, max: 4 }, dmg: "6", reach: 1, ag: 1, dep: 1 } }];
items.get = id => items.find(i => i.id === id);
const pilot = { type: "pilot", name: "Гроза", uuid: "Actor.g", items, getFlag: () => null, system: { aa: 4, ag: 3, speed: 2, skillTotal: { aim: 2, deploy: 1 }, broken: "" } };
const draw = async (t, tk) => { await Rm.foxPanel(pilot, t, tk); const c = dialogs.at(-1).content; return c; };
let c = await draw(null, null);
console.log("Fox Two без цели:", (c.match(/st-name">([^<]*)/g) ?? []).map(x => x.slice(9)).join(", "), "·", /name="tkind" value="ground"/.test(c) ? "вид цели на выбор" : "вид задан", "·", (c.match(/data-pick="(\w+)"/g) ?? []).join(" "));
c = await draw({ actor: nimitz, name: "Нимиц", kind: "ship", defense: null, uuid: "Actor.nimitz", token: null }, "ground");
console.log("Fox Two по кораблю:", (c.match(/st-name">([^<]*)/g) ?? []).map(x => x.slice(9)).join(", "), "·", /tb-aim-scope/.test(c) ? "схема есть" : "без схемы", "·", /EMPTY/.test(c) ? "пустая станция погашена" : "");
if (process.env.FOX_HTML) fs.writeFileSync(process.env.FOX_HTML, c);
if (process.env.FOX_HTML) fs.writeFileSync(process.env.FOX_HTML + ".air", await draw({ actor: mk("f15c"), name: "Игл", kind: "air", defense: 5, uuid: "Actor.f", token: null }, "air"));
console.log(log.filter(l => /^(warn|DIALOG|CHAT)/.test(l)).join("\n"));
