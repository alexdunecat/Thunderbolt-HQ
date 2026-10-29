// Запуск: node tests/run.mjs (сверяет вывод со снимком в tests/snapshots)
// Автокурс токенов и план анимации боя по карточкам чата
import { fileURLToPath as __f } from "node:url";
process.argv[2] ??= __f(new URL("..", import.meta.url)).replace(/\/$/, "");
const R = process.argv[2];
const F = class { constructor(...a) { this.a = a; } };
let autoFace = true;
Object.assign(globalThis, {
  foundry: { data: { fields: { NumberField: F, StringField: F, BooleanField: F, SchemaField: F, ArrayField: F, HTMLField: F, ObjectField: F } },
    abstract: { TypeDataModel: class {} }, utils: { getProperty: (o, p) => p.split(".").reduce((x, k) => x?.[k], o) } },
  Actor: class {}, Item: class {}, Hooks: { on() {}, once() {} },
  game: { settings: { get: (ns, k) => (k === "autoFace" ? autoFace : true), register() {} }, keybindings: { register() {} } },
  CONFIG: { specialStatusEffects: { DEFEATED: "dead" } }
});
const Rt = await import(R + "/module/rotate.mjs");
const Fx = await import(R + "/module/fx.mjs");

// курс: 0 — нос вверх, по часовой
const o = { x: 0, y: 0 };
console.log("курс:", [[0, -100], [100, 0], [0, 100], [-100, 0], [100, -100], [1, 0]].map(([x, y]) => Rt.headingOf(o, { x, y })).join(" "));
const npc = (kind, grp = "", key = "") => ({ type: "npc", system: { kind, grp, key } });
console.log("поворачиваются:", [["пилот", { type: "pilot" }], ["самолёт", npc("air")], ["корабль", npc("ship")], ["танк", npc("ground", "armor", "t80u")],
  ["ЗРК", npc("ground", "ad", "s300")], ["штаб", npc("ground", "obj", "hq")], ["госпиталь", npc("ground", "civil", "hospital")], ["колонна", npc("ground", "civil", "civconvoy")]]
  .map(([n, a]) => `${n}=${Rt.turns(a)}`).join(" "));

// перемещение: курс в изменение, кроме раскладки, отмены, запрета поворота и явного поворота
const doc = (extra = {}) => ({ x: 100, y: 100, actor: { type: "pilot" }, lockRotation: false, ...extra });
const mv = (d, ch, opt) => { const c = { ...ch }; Rt.faceMove(d, c, opt); return c.rotation ?? "—"; };
console.log("ход вправо:", mv(doc(), { x: 300 }), "· вниз-влево:", mv(doc(), { x: 0, y: 200 }), "· раскладка:", mv(doc(), { x: 300 }, { tbKeep: true }),
  "· отмена:", mv(doc(), { x: 300 }, { tbUndo: true }), "· запрет поворота:", mv(doc({ lockRotation: true }), { x: 300 }), "· свой поворот:", mv(doc(), { x: 300, rotation: 45 }),
  "· высота:", mv(doc(), { elevation: 20 }), "· здание:", mv(doc({ actor: npc("ground", "obj") }), { x: 300 }));
autoFace = false;
console.log("автокурс выключен:", mv(doc(), { x: 300 }));
autoFace = true;

// план по карточкам
const sum = c => ({ ...c, total: (c.d10 ?? 0) + c.parts.reduce((s, p) => s + p[1], 0), success: c.dc != null ? (c.d10 ?? 0) + c.parts.reduce((s, p) => s + p[1], 0) >= c.dc : undefined });
const show = (n, card) => console.log(n + ":", JSON.stringify(Fx.planOf(card, sum)));
show("Fox Two! в бою", { type: "attack", attack: true, actorUuid: "A", targetUuid: "T", delayed: true, combatKey: "C:1", salvo: [{ uuid: "T2" }], parts: [] });
show("Fox Two! вне боя", { type: "attack", attack: true, actorUuid: "A", targetUuid: "T", delayed: true, combatKey: "", parts: [], bomb: true });
show("пушка попала", { type: "attack", attack: true, instant: true, label: "Guns", actorUuid: "A", targetUuid: "T", d10: 6, parts: [["Strafe", 3]], dc: 8 });
show("пушка мимо", { type: "attack", attack: true, instant: true, label: "Guns", actorUuid: "A", targetUuid: "T", d10: 2, parts: [["Strafe", 3]], dc: 8 });
show("пушка по кораблю", { type: "attack", attack: true, instant: true, label: "Guns", actorUuid: "A", targetUuid: "S", d10: 2, parts: [], dc: null });
show("НУР", { type: "attack", attack: true, instant: true, label: "Залп НУР (RCL)", actorUuid: "A", targetUuid: "T", d10: 9, parts: [], dc: 5 });
show("лазер", { type: "attack", attack: true, instant: true, label: "Импульсный лазер", actorUuid: "A", targetUuid: "T", d10: 9, parts: [], dc: 5 });
const line = [{ uuid: "G1", vs: 5, gnd: true }, { uuid: "G2", vs: 9, gnd: true }];
show("ковровая", { type: "rail", label: "Ковровая бомбардировка", actorUuid: "B", parts: [["Air-Gnd", 6]], line });
show("бортовые орудия", { type: "rail", label: "Бортовые орудия", actorUuid: "B", d10: 3, parts: [["Бортовые орудия", 1]], line });
show("EMRG", { type: "rail", label: "EMRG: линия →", actorUuid: "B", d10: 3, parts: [["Aim", 4]], depShift: 2, line });
show("EMRG по пустой линии", { type: "rail", label: "EMRG · Electromagnetic Rail Gun: линия ←", actorUuid: "B", d10: 3, parts: [], line: [], end: "0,4" });
show("Break!", { type: "break", actorUuid: "P" });
show("удар по площади", { type: "strike", zones: ["3,4|low", "3,4|med", "5,5"] });
show("залп", { type: "volley", targets: [{ uuid: "T", hit: true, count: 2, shooterUuids: ["A", "B"] }, { uuid: "U", hit: false, broke: true, count: 1, shooterUuids: ["A"] },
  { uuid: "V", cobra: true, count: 1, shooterUuids: ["A"] }, { uuid: "W", missing: true }, { uuid: "S", ship: true, count: 1, shooterUuids: ["A"] }], lost: [{ name: "X" }] });
show("проверка", { type: "check", actorUuid: "A", parts: [] });
console.log("в воздухе:", [{ delayed: true, combatKey: "C:1", targetUuid: "T" }, { delayed: true, combatKey: "C:1", targetUuid: "T", resolved: true },
  { delayed: true, combatKey: "", targetUuid: "T" }, { delayed: true, combatKey: "C:1", targetUuid: "T", lost: "захват сорван" }].map(Fx.inAir).join(" "));
// рисунок выстрела по стрелку
const W = { TANK: { type: "npc", kind: "ground", grp: "armor" }, ZSU: { type: "npc", kind: "ground", grp: "ad" }, SHIP: { type: "npc", kind: "ship", grp: "sea" }, JET: { type: "npc", kind: "air", grp: "fighter" } };
const showW = (n, card) => console.log(n + ":", JSON.stringify(Fx.planOf(card, sum, u => W[u] ?? null)));
showW("танк: пушка", { type: "attack", attack: true, instant: true, label: "Guns, Guns, Guns!", actorUuid: "TANK", targetUuid: "T", d10: 9, parts: [], dc: 5 });
showW("зенитка: очередь", { type: "attack", attack: true, instant: true, label: "Guns, Guns, Guns!", actorUuid: "ZSU", targetUuid: "T", d10: 2, parts: [], dc: 5 });
showW("корабль: артустановка", { type: "attack", attack: true, instant: true, label: "Огонь: Артустановка АК-130", actorUuid: "SHIP", targetUuid: "T", d10: 9, parts: [], dc: 5 });
showW("корабль: ЗАК", { type: "attack", attack: true, instant: true, label: "Огонь: Носовой ЗАК", actorUuid: "SHIP", targetUuid: "T", d10: 9, parts: [], dc: 5 });
showW("босс: рельсотрон", { type: "attack", attack: true, instant: true, label: "Огонь: Рельсотроны №1", actorUuid: "SHIP", targetUuid: "T", d10: 9, parts: [], dc: 5 });
showW("самолёт: пушка", { type: "attack", attack: true, instant: true, label: "Guns, Guns, Guns!", actorUuid: "JET", targetUuid: "T", d10: 9, parts: [], dc: 5 });
showW("танк: G-G в бою", { type: "attack", attack: true, label: "Пуск G-G", fx: "shell", actorUuid: "TANK", targetUuid: "T", delayed: true, combatKey: "C:1", parts: [] });
showW("залп: снаряд и ракета", { type: "volley", targets: [{ uuid: "T", hit: true, count: 2, shooterUuids: ["TANK", "JET"], fx: { TANK: "shell" } }] });
