// Запуск: node tests/run.mjs (сверяет вывод со снимком в tests/snapshots)
// Движущийся погодный фронт: сдвиг погоды по клеткам, уход за край карты, раунды сдвига
import { fileURLToPath as __f } from "node:url";
process.argv[2] ??= __f(new URL("..", import.meta.url)).replace(/\/$/, "");
const R = process.argv[2];
const F = class { constructor(...a) { this.a = a; } };
Object.assign(globalThis, {
  foundry: { utils: { deepClone: x => structuredClone(x) }, abstract: { TypeDataModel: class {} }, data: { fields: { NumberField: F, StringField: F, BooleanField: F, SchemaField: F, ArrayField: F, HTMLField: F, ObjectField: F } } },
  CONST: { DOCUMENT_OWNERSHIP_LEVELS: { LIMITED: 1 } }, Hooks: { on() {}, once() {} }, CONFIG: {}
});
const W = await import(R + "/module/weather-front.mjs");
const cells = { "1,1": ["storm"], "2,1": ["storm", "fog"], "3,3": ["fog"], "4,0": ["storm"] };
console.log("на северо-восток:", JSON.stringify(W.shiftWeather(cells, "storm", W.DIRS.ne.d, 5, 5)));
console.log("туман на юг:", JSON.stringify(W.shiftWeather(cells, "fog", W.DIRS.s.d, 5, 5)));
console.log("туман на юг у края (4 строки):", JSON.stringify(W.shiftWeather(cells, "fog", W.DIRS.s.d, 5, 4)));
const drift = { storm: { dir: "e", every: 2 }, fog: { dir: "s", every: 1 }, snow: { dir: "x", every: 1 } };
console.log("сдвиг по раундам:", [1, 2, 3, 4, 5].map(r => `${r}: ${W.driftDue(drift, r).join("+") || "—"}`).join(", "));
