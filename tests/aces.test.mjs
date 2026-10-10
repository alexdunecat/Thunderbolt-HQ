// Запуск: node tests/run.mjs (сверяет вывод со снимком в tests/snapshots)
import { fileURLToPath as __f } from "node:url";
process.argv[2] ??= __f(new URL("..", import.meta.url)).replace(/\/$/, "");
const root = process.argv[2];
globalThis.foundry = { utils: { deepClone: o => structuredClone(o) } };
const A = await import(`${root}/module/aces.mjs`);
const form = { name: "  LUX LUNAE ", unit: "55TH UNIT", wing: "1st Special Operations Wing, 11th Tactical Squadron", motto: "Lux Lunae — Fiat Lux!", emblem: "worlds/w/lux.webp", side: "чужая", line: "", id: "" };
const s = A.squadFromForm(k => form[k]);
console.log("из формы:", JSON.stringify(s));
console.log("баннер:", JSON.stringify(A.introCaution(s)));
console.log("реплика противника:", A.defaultLine(s));
console.log("реплика союзников:", A.defaultLine({ ...s, side: "ally" }), "|", A.introCaution({ ...s, side: "ally" }).level);
const flat = h => h.replace(/\s+/g, " ").trim();
console.log("разметка:", flat(A.introHtml(s)));
console.log("без эмблемы и девиза, с кавычками:", flat(A.introHtml({ name: "<Гроза>", unit: "", wing: "", motto: "", emblem: "", side: "ally" })));
