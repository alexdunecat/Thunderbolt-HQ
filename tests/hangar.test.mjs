// Ангар: допуск AWACS, узлы подвески с триггерами, подвеска по умолчанию, проверка выбора, постановка на лист (машина, спецоружие, привязки триггеров).
import { fileURLToPath as __f } from "node:url";
import fs from "node:fs";
process.argv[2] ??= __f(new URL("..", import.meta.url)).replace(/\/$/, "");
const R = process.argv[2];
const log = [], settings = {};
Object.assign(globalThis, {
  foundry: { utils: { mergeObject: Object.assign } }, Hooks: { on() {}, once() {} }, Application: class {},
  game: { user: { isGM: false }, combat: null, settings: { register() {}, get: (s, k) => settings[k], set: async (s, k, v) => { settings[k] = v; } } },
  ui: { notifications: { warn: m => log.push("WARN " + m), info: m => log.push("INFO " + m) } },
  ChatMessage: { create: async d => { log.push("CHAT " + d.content.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()); return d; } }
});
const cat = JSON.parse(fs.readFileSync(R + "/data/catalog.json", "utf8"));
const H = await import(R + "/module/hangar.mjs");
H.setHangarCatalog(cat);
const { TB } = await import(R + "/module/config.mjs");

let nid = 0;
const items = [];
const mk = d => ({ id: `i${++nid}`, ...structuredClone(d), getFlag() { return null; } });
const pilot = {
  id: "p1", name: "Гроза", isOwner: true, items: Object.assign(items, { get: id => items.find(i => i.id === id) }),
  system: { edges: [{ id: "e1", kind: "ammo", weapon: "" }], ammoBonus: {},
    get plane() { return items.find(i => i.type === "plane") ?? null; },
    get hardpoints() { return (this.plane?.system.stats.hard ?? 0) + 1; } },   // триггер даёт +1 узел
  async swapPlane(d) { items.splice(0, items.length, ...items.filter(i => i.type !== "plane")); items.push(mk(d)); log.push("PLANE " + d.name); },
  async createEmbeddedDocuments(t, list) { const out = list.map(mk); items.push(...out); log.push("CREATE " + out.map(i => i.system.key).join(",")); return out; },
  async deleteEmbeddedDocuments(t, ids) { for (const id of ids) items.splice(items.findIndex(i => i.id === id), 1); log.push("DELETE " + ids.length); },
  async updateEmbeddedDocuments(t, list) { for (const u of list) { const i = items.find(x => x.id === u._id); for (const [k, v] of Object.entries(u)) if (k !== "_id") k.split(".").reduce((o, p, n, a) => (n === a.length - 1 ? (o[p] = v) : o[p]), i); } log.push("UPDATE " + list.length); },
  async update(u) { if (u["system.edges"]) this.system.edges = u["system.edges"]; log.push("EDGES " + JSON.stringify(this.system.edges.map(e => e.weapon))); }
};
// сейчас на листе: МиГ-21бис, RCL и своё спецоружие ведущего; триггер «Лишний боекомплект» на RCL
const planeOf = k => cat.planes.find(p => p.key === k);
const { planeItem, weaponItem } = await import(R + "/module/data/catalog-docs.mjs");
items.push(mk(planeItem(planeOf("mig21bis"))));
const rcl = mk(weaponItem(cat.weapons.find(w => w.key === "RCL"))); items.push(rcl);
items.push(mk({ name: "Особый контейнер", type: "weapon", system: { key: "SPEC", ammo: { value: 1, max: 1 } } }));
items.push(mk({ name: "Лишний боекомплект", type: "trigger", system: { weapon: rcl.id } }));
pilot.system.edges[0].weapon = rcl.id;

console.log("закрыт:", H.lockReason(pilot));
const upTo2 = H.quickPick(cat, { open: true, planes: [], weapons: [] }, "tier", 2), own = H.quickPick(cat, upTo2, "own");
console.log("авиапарк:", cat.planes.length, "машин, из сводок", cat.planes.filter(p => p.fleet).length, "· до уровня 2:", upTo2.planes.length, "· своих всего:", own.planes.length);
// дальше только свои машины до уровня 2
await H.setHangarState({ ...upTo2, planes: upTo2.planes.filter(k => own.planes.includes(k)) });
let st = H.hangarState();
st = H.quickPick(cat, st, "sig");
await H.setHangarState(st);
console.log("допуск:", st.planes.length, "машин:", st.planes.join(","), "· спецоружие:", st.weapons.join(","));
console.log("открыт:", H.lockReason(pilot) ?? "можно");
const su25 = planeOf("su25");
console.log("Су-25: узлов", H.slotCount(pilot, su25, cat), "(2 машины + 1 триггер − 1 своё) · по умолчанию", JSON.stringify(H.defaultLoadout(pilot, su25, cat, st.weapons)));
console.log("проверки:", [["su47", ["SAAM"]], ["su25", ["LACM"]], ["su25", ["RCL", "UGB", "RCL"]], ["su25", ["UGB", "RCL"]]].map(([p, w]) => H.checkChoice(pilot, p, w, cat) ?? "ок").join(" | "));
game.combat = { started: true, combatants: [{ actor: { id: "p1" } }] };
console.log("в бою:", H.lockReason(pilot));
game.combat = null;
await H.applyLoadout(pilot, "su25", ["UGB", "RCL"], { cat });
console.log(log.splice(0).join("\n"));
console.log("на листе:", items.map(i => `${i.type}:${i.system.key ?? i.name}${i.system.ammo?.value != null ? `(${i.system.ammo.value})` : ""}`).join(" "));
await H.applyLoadout(pilot, "su25", ["UGB", "UGB"], { cat });
console.log(log.splice(0).join("\n"));
const trig = items.find(i => i.type === "trigger");
console.log("триггер теперь на:", items.find(i => i.id === trig.system.weapon)?.system.key ?? "ничего", "· Задел на:", items.find(i => i.id === pilot.system.edges[0].weapon)?.system.key ?? "ничего");
const html = H.pilotHtml(cat, { actor: pilot, pilots: [pilot], planeKey: "su25", slots: ["UGB", ""], user: game.user });
console.log("ангар игрока:", ["АНГАР ОТКРЫТ", "data-hg-slot=\"1\"", "★ штатное", "Своё спецоружие", "data-hg-apply", "вне допуска"].map(k => `${k} ${html.includes(k) ? "✔" : "✘"}`).join(", "),
  "· машин в списке", (html.match(/data-hg-pick=/g) ?? []).length);
const admin = H.adminHtml(cat);
console.log("допуск ведущего:", (admin.match(/data-hg-plane="[^"]+" checked/g) ?? []).length, "отмечено из", (admin.match(/data-hg-plane=/g) ?? []).length, "·", ["data-hg-open", "data-hg-announce", "до уровня 4", "Только из книги"].map(k => `${k} ${admin.includes(k) ? "✔" : "✘"}`).join(", "));
game.user.isGM = true;
console.log("ведущий вне допуска:", H.checkChoice(pilot, "falken", ["PLSL", "HPAA"], cat) ?? "ок");
await H.setHangarState({ open: false });
game.user.isGM = false;
console.log("закрыли:", H.lockReason(pilot), "·", H.pilotHtml(cat, { actor: pilot, pilots: [pilot], planeKey: "su25", slots: ["UGB"] }).includes("АНГАР ЗАКРЫТ") ? "лампа ЗАКРЫТ" : "");
