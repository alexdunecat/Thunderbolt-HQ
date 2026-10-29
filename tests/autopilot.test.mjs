// Запуск: node tests/run.mjs (сверяет вывод со снимком в tests/snapshots)
// Автопилот NPC: выбор шага по приказу и характеру, шаг к цели и прочь от врагов
import { fileURLToPath as __f } from "node:url";
process.argv[2] ??= __f(new URL("..", import.meta.url)).replace(/\/$/, "");
const R = process.argv[2];
const F = class { constructor(...a) { this.a = a; } };
Object.assign(globalThis, {
  foundry: { data: { fields: { NumberField: F, StringField: F, BooleanField: F, SchemaField: F, ArrayField: F, HTMLField: F, ObjectField: F } }, abstract: { TypeDataModel: class {} } },
  Actor: class {}, Item: class {}, Combat: class {}, Hooks: { on() {}, once() {} },
  game: { settings: { get: () => true, register() {} } }, CONFIG: { specialStatusEffects: { DEFEATED: "dead" } }
});
Number.isNumeric = n => typeof n === "number" && Number.isFinite(n);
const A = await import(R + "/module/autopilot.mjs");
const C = await import(R + "/module/documents/combat.mjs");

console.log("заявка:", [1, 3, C.PASS, C.PASS + 2, C.AUTO].map(C.declareLabel).join(" "));
// шаги по клеткам
console.log("к цели:", JSON.stringify(A.stepToward([0, 0], [3, 1])), JSON.stringify(A.stepToward([2, 2], [2, 2])), JSON.stringify(A.stepToward([0, 0], [3, 0], (c, r) => !(c === 1 && r === 0))));
console.log("прочь:", JSON.stringify(A.stepAway([2, 2], [[3, 2]])), JSON.stringify(A.stepAway([2, 2], [])));

const o = (task, manner, extra = {}) => ({ on: true, task, manner, acts: 2, after: "hold", route: [], step: 0, target: "", ...extra });
const cand = (uuid, dist, extra = {}) => ({ uuid, dist, canMissile: true, canGuns: dist === 0, lockRange: 1, fire: 2, needAlt: 0, blocked: false, noLock: false, locksMe: false, onPath: false, ...extra });
const base = (extra = {}) => ({ flying: true, systems: false, incoming: 0, broke: false, hurt: false, lock: null, nearest: null, cands: [], goal: null, next: null, away: null, ...extra });
const show = (n, order, v, failed) => console.log(n + ":", JSON.stringify(A.chooseStep(order, v, failed)));

show("ракета летит, прорыв", o("hunt", "push"), base({ incoming: 1 }));
show("ракета летит, напролом", o("attack", "rush", { target: "HQ" }), base({ incoming: 1, cands: [cand("HQ", 3)], goal: { kind: "target", uuid: "HQ", dist: 3, want: 1 }, next: [1, 0] }));
show("охота: захват", o("hunt", "push"), base({ cands: [cand("M", 1)], goal: { kind: "target", uuid: "M", dist: 1, want: 1 } }));
show("охота: пуск", o("hunt", "push"), base({ lock: "M", cands: [cand("M", 2)], goal: { kind: "target", uuid: "M", dist: 2, want: 1 } }));
show("охота: пушка без захвата", o("hunt", "push"), base({ cands: [cand("M", 0)] }));
show("охота: высота", o("hunt", "push"), base({ cands: [cand("M", 1, { needAlt: 1 })] }));
show("охота: сближение", o("hunt", "push"), base({ cands: [cand("M", 4)], goal: { kind: "target", uuid: "M", dist: 4, want: 1 }, next: [5, 5] }));
// прорыв к штабу: по пути бьёт мешающих, но не дальних
const v = base({ cands: [cand("FAR", 1), cand("HQ", 3), cand("BLOCK", 1, { onPath: true })], goal: { kind: "target", uuid: "HQ", dist: 3, want: 1 }, next: [1, 1] });
show("прорыв: мешающий на пути", o("attack", "push", { target: "HQ" }), v);
show("напролом: только к цели", o("attack", "rush", { target: "HQ" }), v);
show("осторожно: всё, что достаёт", o("attack", "careful", { target: "HQ" }), v);
show("прорыв: держит на захвате", o("attack", "push", { target: "HQ" }), base({ cands: [cand("FAR", 1, { locksMe: true }), cand("HQ", 3)], goal: { kind: "target", uuid: "HQ", dist: 3, want: 1 }, next: [1, 1] }));
show("прорыв: захват не вышел", o("attack", "push", { target: "HQ" }), base({ cands: [cand("BLOCK", 1, { onPath: true }), cand("HQ", 3)], goal: { kind: "target", uuid: "HQ", dist: 3, want: 1 }, next: [1, 1] }), new Set(["BLOCK"]));
show("осторожно: ранен, отход", o("hunt", "careful"), base({ hurt: true, nearest: 0, away: [0, 0], cands: [cand("M", 0)] }));
show("осторожно: дистанция", o("attack", "careful", { target: "T" }), base({ cands: [cand("T", 0, { canGuns: false, canMissile: false })], goal: { kind: "target", uuid: "T", dist: 0, want: 1 }, away: [3, 3] }));
show("маршрут", o("route", "push"), base({ flying: false, cands: [cand("FAR", 2)], goal: { kind: "cell", reached: false }, next: [2, 3] }));
show("маршрут пройден", o("route", "push"), base({ flying: false, goal: { kind: "cell", reached: true }, next: null }));
show("держать позицию", o("hold", "push"), base({ cands: [cand("M", 3)], next: [1, 1] }));
show("корабль: система без захвата", o("hunt", "push"), base({ flying: false, systems: true, incoming: 2, cands: [cand("P", 2, { noLock: true })] }));
console.log("задача после:", A.taskNow(o("attack", "push", { target: "HQ", after: "hunt" }), { targetGone: true }), A.taskNow(o("route", "push", { route: ["1,1"], step: 1 })), A.taskNow(o("route", "push", { route: ["1,1"], step: 0 })));
console.log("приказ:", A.orderLine(o("attack", "push", { targetName: "Штаб" })), "|", A.orderLine(o("hold", "careful", { acts: 1 })));
// спецоружие и системы
show("EMRG: на линии враг из пула", o("hunt", "careful"), base({ rail: { uuids: ["M"] }, cands: [cand("M", 3)] }));
show("EMRG напролом: цели задачи на линии нет", o("attack", "rush", { target: "HQ" }), base({ rail: { uuids: ["M"] }, cands: [cand("M", 1), cand("HQ", 3)], goal: { kind: "target", uuid: "HQ", dist: 3, want: 1 }, next: [1, 0] }));
show("ковёр по наземке внизу", o("hunt", "push"), base({ carpet: { uuids: ["T"] }, cands: [cand("T", 0, { canMissile: false, canGuns: false })] }));
show("корабль: пушка по соседней зоне", o("hold", "careful"), base({ flying: false, systems: true, cands: [cand("P", 1, { canMissile: false, canGuns: true, gunReach: 1 })] }));
show("корабль: пушка не достаёт", o("hold", "careful"), base({ flying: false, systems: true, cands: [cand("P", 1, { canMissile: false, canGuns: true, gunReach: 0 })] }));
show("AC-130: бортовые орудия", o("hunt", "push"), base({ cands: [cand("T", 1, { canMissile: false, canGuns: false, gunship: true })] }));
// наступление строем и темп
console.log("строй:", JSON.stringify(A.formationRoutes([[2, 5], [3, 5], [2, 6]], ["8,5", "9,2"], { c0: 0, r0: 0, c1: 9, r1: 9 })));
console.log("теснота:", JSON.stringify(A.stepToward([0, 0], [3, 0], () => true)), JSON.stringify(A.stepToward([0, 0], [3, 0], () => true, (c, r) => (c === 1 && r === 0 ? 2 : 0))));
console.log("строка:", A.orderLine({ task: "advance", manner: "push", acts: 0, route: [] }));
show("наступление: последний ход — шаг", o("advance", "push", { route: ["5,0"] }), base({ mustMove: true, next: [1, 0], lock: "M", cands: [cand("M", 1)], goal: { kind: "cell", reached: false } }));
show("наступление: стрельба, пока есть действия", o("advance", "push", { route: ["5,0"] }), base({ next: [1, 0], lock: "M", cands: [cand("M", 0)], goal: { kind: "cell", reached: false } }));
// стиль боя и предпочтение целей
const W = (kind, grp) => ({ kind, grp });
console.log("стиль:", ["fighter", "attack", "heli", "multi", "heavy"].map(g => A.styleOf({ style: "auto" }, W("air", g))).join(" "), A.styleOf({ style: "guns" }, W("air", "fighter")), A.styleOf({}, W("ground", "armor")));
console.log("цели:", ["fighter", "attack", "heavy", "multi"].map(g => A.preferOf({ prefer: "auto" }, W("air", g))).join(" "), ["ad", "armor", "art", "obj"].map(g => A.preferOf({}, W("ground", g))).join(" "), A.preferOf({}, W("ship", "sea")), A.preferOf({ prefer: "air" }, W("air", "attack")));
console.log("строка со стилем:", A.orderLine({ task: "hunt", manner: "careful", acts: 2, route: [], style: "guns", prefer: "ground" }));
show("пушкарь: сближается вместо ракеты", o("hunt", "push"), base({ style: "guns", lock: "M", cands: [cand("M", 1, { gunnable: true })], goal: { kind: "target", uuid: "M", dist: 1, want: 0 }, next: [1, 0] }));
show("пушкарь: по кораблю ракетой", o("hunt", "push"), base({ style: "guns", lock: "S", cands: [cand("S", 1, { gunnable: false })] }));
show("смешанный: вблизи пушка", o("hunt", "push"), base({ style: "mixed", lock: "M", cands: [cand("M", 0, { gunnable: true })] }));
show("ракетчик: вблизи всё равно ракета", o("hunt", "push"), base({ style: "missile", lock: "M", cands: [cand("M", 0, { gunnable: true })] }));
// охрана
const esc = (extra = {}) => base({ goal: { kind: "escort", far: false, icpt: null }, ...extra });
show("охрана: сначала угроза охраняемому", o("escort", "push", { target: "W" }), esc({ lock: "N", cands: [cand("N", 0, { canMissile: true }), cand("T", 1, { threat: true })] }));
show("охрана напролом: только угроза", o("escort", "rush", { target: "W" }), esc({ cands: [cand("N", 0)] }));
show("охрана: далеко — к охраняемому", o("escort", "push", { target: "W" }), base({ goal: { kind: "escort", far: true, icpt: null }, next: [2, 2], cands: [] }));
show("охрана: перехват", o("escort", "push", { target: "W" }), esc({ goal: { kind: "escort", far: false, icpt: [3, 3] }, cands: [cand("T", 3, { threat: true })] }));
console.log("строка охраны:", A.orderLine({ task: "escort", manner: "push", acts: 0, route: [], target: "W", targetName: "Колонна" }));
// машины игроков — самый низкий приоритет
show("игрок рядом, другой враг далеко — к врагу", o("hunt", "push"), base({ cands: [cand("P", 0, { player: true }), cand("M", 3)], goal: { kind: "target", uuid: "M", dist: 3, want: 1 }, next: [1, 0] }));
show("остались одни игроки — бьёт игрока", o("hunt", "push"), base({ lock: "P", cands: [cand("P", 1, { player: true })] }));
show("EMRG: на линии одни игроки — не стреляет", o("hunt", "careful"), base({ rail: { uuids: ["P"] }, cands: [cand("P", 3, { player: true }), cand("M", 3)], goal: { kind: "target", uuid: "M", dist: 3, want: 1 }, next: [1, 0] }));
