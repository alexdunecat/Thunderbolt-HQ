// Запуск: node tests/run.mjs (сверяет вывод со снимком в tests/snapshots)
// Клавиши: перебор целей по кругу и досягаемость; время суток сцены
import { fileURLToPath as __f } from "node:url";
process.argv[2] ??= __f(new URL("..", import.meta.url)).replace(/\/$/, "");
const R = process.argv[2];
Object.assign(globalThis, {
  foundry: { utils: { deepClone: x => structuredClone(x) }, abstract: { TypeDataModel: class {} }, data: { fields: {} } },
  Hooks: { on() {}, once() {} }, CONFIG: {}
});
const K = await import(R + "/module/keys.mjs");
const ids = ["a", "b", "c"];
console.log("вперёд:", [null, "a", "b", "c", "x"].map(c => `${c ?? "—"}→${K.nextTarget(ids, c, 1)}`).join(" "));
console.log("назад:", [null, "a", "c"].map(c => `${c ?? "—"}→${K.nextTarget(ids, c, -1)}`).join(" "), "· пусто:", K.nextTarget([], null));
console.log("досягаемость: ракета", K.reachFor(null), "· спецоружие на 3 зоны", K.reachFor({ system: { reach: 3 } }), "· вся зона операции", K.reachFor({ system: { reach: 99 } }), "· без дальности", K.reachFor({ system: {} }));
const D = await import(R + "/module/daytime.mjs");
const scene = t => ({ getFlag: () => t });
console.log("время суток:", ["day", "dawn", "dusk", "night", undefined, "noon"].map(t => `${t ?? "—"} ${JSON.stringify(D.tintOf(scene(t)))}`).join(", "));
