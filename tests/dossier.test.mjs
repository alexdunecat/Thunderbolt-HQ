// Запуск: node tests/run.mjs (сверяет вывод со снимком в tests/snapshots)
import { fileURLToPath as __f } from "node:url";
import { tmpdir as __tmp } from "node:os";
process.argv[2] ??= __f(new URL("..", import.meta.url)).replace(/\/$/, "");
process.argv[3] ??= __tmp() + "/tb-test-out";
const root = process.argv[2];
import fs from "node:fs";
const cat = JSON.parse(fs.readFileSync(`${root}/data/catalog.json`, "utf8"));
const set = (o, path, v) => { const ks = path.split("."); let a = o; for (let i = 0; i < ks.length - 1; i++) a = a[ks[i]] ??= {}; a[ks.at(-1)] = v; };
const get = (o, path) => path.split(".").reduce((a, k) => a?.[k], o);
globalThis.foundry = { utils: { setProperty: set, getProperty: get, randomID: () => "r" + Math.random().toString(36).slice(2, 8) } };
globalThis.fromUuidSync = u => null;
const { TB, SYSTEM_ID } = await import(`${root}/module/config.mjs`);
const { planeItem, weaponItem, triggerItem } = await import(`${root}/module/data/catalog-docs.mjs`);
const docs = { planes: cat.planes.concat(cat.book).map(planeItem), weapons: cat.weapons.map(weaponItem), triggers: cat.triggers.map(triggerItem) };
let nid = 0;
class Item { constructor(d, actor) { Object.assign(this, structuredClone(d)); this.id = "i" + (++nid); this.actor = actor; this.flags ??= {}; }
  getFlag(s, k) { return this.flags?.[s]?.[k]; } }
class FakeActor {
  constructor(d) { this.id = "a" + (++nid) + "xxxx"; this.name = d.name; this.type = "pilot"; this.flags = {}; this.items = [];
    this.prototypeToken = { texture: { src: "icons/svg/mystery-man.svg" } };
    this.system = { callsign: "", lastName: "", firstName: "", patronymic: "", rank: "", flight: "", squadron: "", base: "", birth: "", archetype: "",
      questions: {}, dossier: [], service: { log: [] }, bonusPoints: 0, skills: {}, twist: false, wso: "", hp: { value: 0, max: 0 }, strain: { value: 0, max: 0 },
      speed: 1, alt: "med", markers: {}, nerves: 0, onEdge: "", resolve: 0, downtime: { actions: 2, resolveGot: false }, edges: [], bonds: [], goals: [], debts: [] };
    this.isOwner = true; }
  get plane() { return this.items.find(i => i.type === "plane"); }
  derive() { const s = this.system; s.plane = this.plane; const ps = s.plane?.system.stats ?? { hp: 1, str: 0, spd: 1 };
    const armor = this.items.some(i => i.system.key === "armor") ? 1 : 0;
    s.hp.max = ps.hp + armor; s.strain.max = ps.str; s.maxSpeed = ps.spd; s.ammoBonus = {};
    for (const t of this.items.filter(i => i.type === "trigger" && i.system.key === "blessing")) if (t.system.weapon) s.ammoBonus[t.system.weapon] = 2; }
  getFlag(s, k) { return this.flags?.[s]?.[k]; }
  async update(u) { for (const [k, v] of Object.entries(u)) k.startsWith("system.") || k.startsWith("flags.") || k.startsWith("prototypeToken.") ? set(this, k, v) : (this[k] = v); this.derive(); }
  async withoutPoolSync(fn) { return fn(); }
  poolsFlag() { return {}; }
  async createEmbeddedDocuments(t, list) { const made = list.map(d => new Item(d, this)); this.items.push(...made); this.derive(); return made; }
  async deleteEmbeddedDocuments(t, ids) { this.items = this.items.filter(i => !ids.includes(i.id)); this.derive(); }
  async updateEmbeddedDocuments(t, ups) { for (const u of ups) { const it = this.items.find(i => i.id === u._id); for (const [k, v] of Object.entries(u)) if (k !== "_id") set(it, k, v); } this.derive(); }
}
globalThis.Actor = { create: async d => new FakeActor(d) };
globalThis.game = { actors: [], user: { can: () => false }, packs: { get: id => { const name = id.split(".")[1]; const list = docs[name];
  return { getIndex: async () => list.map((d, i) => ({ _id: String(i), system: { key: d.system.key } })), getDocument: async i => ({ toObject: () => structuredClone(list[Number(i)]) }) }; } } };
const { importDossier, exportDossier, parseCode } = await import(`${root}/module/dossier-sync.mjs`);
const plane = cat.planes.find(p => p.key === "mig29") ?? cat.planes[5];
const raw = { id: "pabc123", caseNo: "Л-4242", created: 1, callsign: "Гроза", lastName: "Иванов", firstName: "Пётр", archetype: "oldguard", rank: "капитан",
  qCallsign: "за грозу", dossier: [{ text: "Сбил аса", struck: false, at: 5 }, { text: "старое", struck: true }],
  service: { sorties: 3, ops: 1, air: 4, ground: 2, eject: 0, awards: "Орден", status: "active" }, startPoints: 6, bonusPoints: 1,
  skills: { aim: 2, deploy: 1, dodge: 2, lead: 0, push: 1, strafe: 0 },
  triggers: [{ key: "practiced", used: true, note: "", auto: true }, { key: "blessing", slot: "1", note: "от мамы" }, { key: "armor" }, { key: "custom", name: "Мой", text: "Текст" }],
  plane: { model: plane.key, name: "Ласточка", wso: "", props: "", stats: { spd: 4, eva: 3, aa: 2, ag: 1, hp: 3, str: 4, gun: 2, hpts: 2 } },
  weapons: [{ code: cat.weapons[0].key, ammo: 1 }, { code: cat.weapons[1].key, ammo: null }],
  sortie: { speed: 2, hp: 2, strain: null, alt: "low", grit: false, gritSkill: "", structure: false, sys: "", doom: false, twist: false },
  ground: { nerves: 3, onEdge: "", resolve: 1, actions: 1, resolveGot: true, edges: [{ kind: "ammo", slot: "1", text: "", comp: false, used: false }, { kind: "tune", stat: "ev", minus: "gun", text: "", comp: true, used: false }, { kind: "fatigue", text: "", comp: false, used: false }],
    bonds: [{ name: "Ершов", value: 2, was: [], npc: true, dead: false }], goals: [{ name: "Брат", size: 6, value: 3 }], debts: [{ text: "Кравцу", struck: false }] } };
console.log("parse:", parseCode(JSON.stringify({ kind: "yukto-dossier", pilot: raw }))?.length, parseCode(JSON.stringify({ kind: "yukto-dossiers", pilots: [raw, raw] }))?.length, parseCode("{}"));
const a = await importDossier(raw);
console.log("actor:", a.name, a.system.callsign, a.system.archetype, a.system.service.air, a.system.skills, a.system.hp, a.system.strain, a.system.speed, a.system.alt);
console.log("items:", a.items.map(i => `${i.type}:${i.system.key}:${i.name}${i.system.weapon ? "→" + a.items.find(w => w.id === i.system.weapon)?.system.key : ""}${i.type === "weapon" ? " ammo " + i.system.ammo.value + "/" + i.system.ammo.max : ""}`));
const back = exportDossier(a);
const keys = ["callsign", "caseNo", "id", "archetype", "bonusPoints", "startPoints"];
for (const k of keys) if (JSON.stringify(back[k]) !== JSON.stringify(raw[k])) console.log("DIFF", k, back[k], raw[k]);
for (const k of ["skills", "service", "plane", "weapons", "sortie", "ground"]) {
  const r = JSON.stringify(raw[k]), b = JSON.stringify(k === "service" ? { ...back[k], log: undefined } : back[k]);
  if (r !== b) console.log("DIFF", k, "\n  raw ", r, "\n  back", b);
}
console.log("triggers back:", JSON.stringify(back.triggers));
console.log("dossier back:", JSON.stringify(back.dossier));
const { codeFor } = await import(`${root}/module/dossier-sync.mjs`);
a.flags[SYSTEM_ID].shtab.id = "pfA1b2c3"; a.flags[SYSTEM_ID].shtab.caseNo = "";
fs.writeFileSync(process.argv[3], codeFor([a]));
