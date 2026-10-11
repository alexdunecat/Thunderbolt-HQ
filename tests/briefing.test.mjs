// Брифинг: открытая часть миссии (без поворота и заметок), виды сил, этапы из миссии, камера, чистка этапов из флага.
import fs from "node:fs";
import { fileURLToPath as __f } from "node:url";
process.argv[2] ??= __f(new URL("..", import.meta.url)).replace(/\/$/, "");
const R = process.argv[2];
globalThis.Hooks = { on() {}, once() {} };
const B = await import(R + "/module/briefing.mjs");
const cat = JSON.parse(fs.readFileSync(R + "/data/catalog.json", "utf8"));

const kesh = {
  name: "Оазис Кеш-Тала", type: "Наземный штурм", cols: 8, rows: 5, base: "desert",
  hexes: { "0,2": { t: "steppe", label: "Граница" }, "3,2": { t: "canyon", label: "Ущелье Сарам" }, "4,2": { t: "city", label: "Оазис Кеш-Тала" },
    "4,3": { fx: ["dust"] }, "5,3": { fx: ["dust", "tunnel"] }, "9,9": { t: "sea" }, "7,2": { t: "base", label: "Авиабаза Сотоа" } },
  units: [
    { id: "ex1", ref: "entry", c: 0, r: 2, count: 4, side: "player", name: "Звено «Гроза»", notes: "секрет-1" },
    { id: "ex2", ref: "protect", c: 1, r: 2, count: 1, side: "ally", name: "Колонна мотострелков" },
    { id: "ex3", ref: "goal", c: 5, r: 2, count: 1, side: "neutral", name: "Задача 1: ПВО оазиса" },
    { id: "ex4", ref: "sam", c: 5, r: 2, count: 1, side: "enemy", name: "ЗРК у оазиса" },
    { id: "ex5", ref: "aa", c: 5, r: 1, count: 2, side: "enemy", name: "Зенитки на холме" },
    { id: "ex6", ref: "jam", c: 5, r: 3, count: 1, side: "enemy", name: "Станция РЭБ" },
    { id: "ex7", ref: "obj", c: 4, r: 3, count: 1, side: "enemy", name: "Топливный склад" },
    { id: "ex8", ref: "mig29a", c: 6, r: 1, count: 2, side: "enemy", alt: "M", name: "Сотоанский патруль" },
    { id: "ex9", ref: "fa", c: 6, r: 3, count: 5, side: "enemy", alt: "H", name: "Перехватчики с авиабазы" },
    { id: "ex10", ref: "reinf", c: 7, r: 2, count: 1, side: "enemy", name: "Поворот: дуэлянты" },
    { id: "ex11", ref: "note", c: 2, r: 2, side: "neutral", name: "Заметка: засада" },
    { id: "ex4", ref: "s300", c: 9, r: 1, side: "enemy", name: "Вне карты" }
  ],
  objectives: ["Уничтожить ПВО у оазиса Кеш-Тала: ЗРК, две зенитки и станцию РЭБ", "Уничтожить топливный склад, не задев жилые кварталы оазиса"],
  briefing: "«Гроза», говорит КП «Тайга». Колонна мотострелков встала у границы: дорогу через оазис Кеш-Тала закрывает зенитный комплекс. Снимите ПВО и сожгите топливный склад. Над оазисом пыльная буря, внизу почти ничего не видно. Ущелье Сарам проходится только на малой высоте.",
  twist: "секрет-2", fail: "секрет-3", notes: "секрет-4", twistType: "Прибывают подкрепления"
};
const pm = B.publicMission(kesh, cat);
const js = JSON.stringify(pm);
console.log("скрытое не уходит:", !/секрет|Поворот|Заметка|Вне карты/.test(js), "· ключи:", Object.keys(pm).join(","));
console.log("клетки:", Object.keys(pm.hexes).join(" "), "· погода:", JSON.stringify(pm.wx));
for (const u of pm.units) console.log(`  ${u.id} ${u.k} ${u.side} ${B.cellName(u.c, u.r)} ×${u.count}${u.alt ? " " + u.alt : ""}${u.rng ? " r" + u.rng : ""} ${u.name}`);
const steps = B.buildSteps(pm);
const show = list => list.forEach((s, i) => console.log(`${String(i + 1).padStart(2, "0")} ${s.title} · ${typeof s.focus === "string" ? s.focus : JSON.stringify(s.focus)}${s.targets ? " · цели " + s.targets.join(",") : ""}${s.threat ? " · ПВО" : ""}${s.wx ? " · погода" : ""}${s.route ? " · маршрут " + JSON.stringify(s.route) : ""}${s.final ? " · финал" : ""}\n   ${s.text}`));
show(steps);
console.log("известны к этапу 2:", B.knownUpTo(steps, 1).join(","));

// виды сил по каталогу
for (const ref of ["s300", "osa", "shilka", "radar", "jammer", "t80u", "msta", "krivak", "hangar", "f16c", "tarpan", "nope"]) {
  const e = [...cat.npcs, ...cat.planeNpcs].find(n => n.key === (cat.alias[ref] ?? ref));
  process.stdout.write(`${ref}=${B.unitKind(cat.alias[ref] ?? ref, {}, e ?? null)} `);
}
console.log();

// морская миссия без задач и без входа звена, текст без точки в конце
const sea = B.publicMission({ name: "Конвой", cols: 6, rows: 3, base: "sea", objectives: [], briefing: "Транспорты идут вдоль берега", units: [
  { ref: "krivak", c: 2, r: 1, side: "enemy", name: "Сторожевик" }, { ref: "cargo", c: 4, r: 1, side: "neutral", count: 3 }, { ref: "f16c", c: 1, r: 0, side: "ally", alt: "H", count: 21 }] }, cat);
show(B.buildSteps(sea));
console.log("ид без id:", sea.units.map(u => u.id).join(","));

// камера
const r1 = o => JSON.stringify(Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Math.round(v)])));
console.log("весь район 8×5:", r1(B.fitCam("all", 8, 5)), "· 16×3:", r1(B.fitCam("all", 16, 3)), "· клетка:", r1(B.fitCam({ c0: 5, c1: 5, r0: 2, r1: 2 }, 8, 5)), "· вид:", r1(B.fitCam({ cam: { x: 1, y: 2, w: 300, h: 168 } }, 8, 5)));

// этапы из флага: мусор отброшен, фокус проверен
console.log(JSON.stringify(B.cleanSteps([null, 5, { title: 7, text: null, focus: { cam: { x: "a" } }, show: "x", route: [[1, 2]] },
  { title: "Т", text: "т", focus: { c0: 1, c1: "2", r0: 0, r1: 0 }, show: ["a", 1], targets: ["a"], final: 1, route: [[0, 0], [2, "3"]] }])));
const scene = flags => ({ getFlag: (s, k) => flags[k] });
console.log("сцена без миссии:", JSON.stringify(B.briefingOf(scene({}))), "· с миссией без этапов:", B.briefingOf(scene({ briefing: { mission: pm } })).steps.length);

// файл из конструктора брифингов: фон этапа, кольца ПВО по списку, пометки, фото, неизвестный контакт
const ed = B.readBriefingJson({ format: "tb-briefing", v: 2, op: " Буря ", mission: { ...pm, units: [...pm.units, { id: "x1", k: "unk", side: "enemy", name: "Контакт", c: 2, r: 4 }, { id: "bad", c: 99, r: 0 }] },
  steps: [{ title: "Т1", text: "а", focus: "all", show: ["ex4"], dim: ["ex1", 5], threat: ["ex4"], marks: ["5,2", "5,2", "x"], lines: [[1, 2, 3, 4], [1, 2]], img: { src: "data:image/png;base64,AAAA", cap: "ЗРК" } },
    { title: "Т2", text: "б", threat: [], img: { src: "javascript:alert(1)" } }, { title: "Т3", img: { src: "worlds/w/brief/zrk.jpg", cap: "путь" } }] }, cat);
console.log("конструктор:", ed.from, ed.op, "· сил", ed.mission.units.length, "· последняя", JSON.stringify(ed.mission.units.at(-1)));
console.log(JSON.stringify(ed.steps));
console.log("миссия из Планшета:", B.readBriefingJson(kesh, cat).from, B.readBriefingJson(kesh, cat).steps.length);
for (const bad of [{}, { format: "tb-briefing", mission: { cols: 0 }, steps: [{}] }, { format: "tb-briefing", mission: pm, steps: [] }]) {
  try { B.readBriefingJson(bad, cat); console.log("не упало"); } catch (e) { console.log("ошибка:", e.message); }
}
console.log("флаг из конструктора:", JSON.stringify(B.briefingOf(scene({ briefing: { mission: pm, steps: [{ title: "x" }], op: "Буря", from: "editor" } })).from));
