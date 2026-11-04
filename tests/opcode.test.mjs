// Запуск: node tests/run.mjs (сверяет вывод со снимком в tests/snapshots)
// Служебный код вместо логотипа Foundry: строки детерминированы id пользователя, сцены и мира.
import { fileURLToPath as __f } from "node:url";
process.argv[2] ??= __f(new URL("..", import.meta.url)).replace(/\/$/, "");
const R = process.argv[2];
globalThis.Hooks = { on() {}, once() {} };
const { opLines, opHtml, hashOf } = await import(R + "/module/opcode.mjs");
const now = new Date(2026, 9, 11, 9, 5, 7);
const a = opLines({ userId: "gm01", sceneId: "s1", sceneName: "Миссия 03: Тренировка", worldId: "w", online: 3, total: 5, now });
console.log(a.map(([k, v]) => `${k}: ${v}`).join("\n"));
const b = opLines({ userId: "gm01", sceneId: "s1", sceneName: "Миссия 03: Тренировка", worldId: "w", online: 3, total: 5, now });
console.log("стабильно", JSON.stringify(a) === JSON.stringify(b), "· другая сцена", opLines({ sceneId: "s2" })[1][1] !== a[1][1] || "совпало");
console.log("без сцены:", opLines({})[2][1]);
console.log(opHtml([["OP INFO", "<b>"]]));
console.log("hash", hashOf("abc"));
// низкий логотип: строки не обрезаются, а уходят по важности
const { fitLines, fitFont } = await import(R + "/module/opcode.mjs");
console.log("высота → строк, шрифт:", [100, 80, 60, 48, 34, 20].map(h => { const f = fitFont(h); return `${h}px→${f.max} ${f.size.toFixed(1)}`; }).join(" · "));
console.log("при 3 строках:", fitLines(a, 3).map(([k]) => k).join(", "), "| при 1:", fitLines(a, 1).map(([k]) => k).join(", "));
