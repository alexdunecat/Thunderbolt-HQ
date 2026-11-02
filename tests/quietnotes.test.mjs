// Тихие подсказки в бою: какие окошки уходят в строку, какие остаются окошками Foundry.
import { fileURLToPath as __f } from "node:url";
process.argv[2] ??= __f(new URL("..", import.meta.url)).replace(/\/$/, "");
const R = process.argv[2];
globalThis.Hooks = { on() {}, once() {} };
const Q = await import(R + "/module/quiet-notes.mjs");
const cases = [
  ["бой, info, тихо", { mode: "quiet", type: "info", inCombat: true }],
  ["бой, warning", { mode: "quiet", type: "warning", inCombat: true }],
  ["бой, error", { mode: "quiet", type: "error", inCombat: true }],
  ["вне боя, info", { mode: "quiet", type: "info", inCombat: false }],
  ["бой, info, постоянное", { mode: "quiet", type: "info", inCombat: true, permanent: true }],
  ["бой, info, не показывать", { mode: "off", type: "info", inCombat: true }],
  ["бой, info, как обычно", { mode: "foundry", type: "info", inCombat: true }],
  ["бой, info, неизвестный режим", { mode: "xxx", type: "info", inCombat: true }]
];
for (const [k, o] of cases) console.log(`${k}: ${Q.noteRoute(o)}`);
console.log("режимы:", Object.keys(Q.NOTE_MODES).join(", "));
