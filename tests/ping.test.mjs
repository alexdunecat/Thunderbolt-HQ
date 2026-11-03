// Запуск: node tests/run.mjs (сверяет вывод со снимком в tests/snapshots)
// Метка в эфир: подпись квадрата, стороны, реплика
import { fileURLToPath as __f } from "node:url";
process.argv[2] ??= __f(new URL("..", import.meta.url)).replace(/\/$/, "");
const R = process.argv[2];
const F = class { constructor(...a) { this.a = a; } };
Object.assign(globalThis, {
  foundry: { data: { fields: { NumberField: F, StringField: F, BooleanField: F, SchemaField: F, ArrayField: F, HTMLField: F, ObjectField: F } },
    abstract: { TypeDataModel: class {} }, utils: { getProperty: (o, p) => p.split(".").reduce((x, k) => x?.[k], o) } },
  Actor: class {}, Item: class {}, Hooks: { on() {}, once() {} },
  game: { settings: { get: () => true, register() {} }, keybindings: { register() {} } },
  CONFIG: { specialStatusEffects: { DEFEATED: "dead" } }
});
const P = await import(R + "/module/ping.mjs");
console.log("квадраты:", [[0, 0], [3, 3], [9, 0], [2, 7]].map(([c, r]) => P.zoneLabel(c, r)).join(" "), "· сцена с полями:", P.zoneLabel(5, 4, { c0: 2, r0: 1 }));
const S = ["player", "ally", "enemy", "neutral"];
console.log("враждебны:", S.flatMap(a => S.map(b => `${a}/${b}=${P.hostile(a, b) ? 1 : 0}`)).join(" "));
for (const n of [0, 1, 2, 3, 7]) console.log(`противников ${n}:`, [0, 1, 2, 3].map(k => P.pingLine("Б4", n, () => k)).join(" | "));
