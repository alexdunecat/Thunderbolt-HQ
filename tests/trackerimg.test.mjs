// Запуск: node tests/run.mjs (сверяет вывод со снимком в tests/snapshots)
// Картинка в трекере боя: конскрипт и пилот — токен, ас — лицо, дуэлянт — лицо или шильдик.
import { fileURLToPath as __f } from "node:url";
process.argv[2] ??= __f(new URL("..", import.meta.url)).replace(/\/$/, "");
const R = process.argv[2];
const F = class { constructor(...a) { this.a = a; } };
Object.assign(globalThis, {
  foundry: { utils: { deepClone: x => structuredClone(x) }, abstract: { TypeDataModel: class {} }, data: { fields: { NumberField: F, StringField: F, BooleanField: F, SchemaField: F, ArrayField: F, HTMLField: F, ObjectField: F } } },
  Hooks: { on() {}, once() {} }, CONFIG: { sounds: {}, specialStatusEffects: { DEFEATED: "dead" } }, game: { settings: { get: () => [] } },
  Combat: class {}, Actor: class {}, Item: class {}, Application: class {}, FormApplication: class {}, Dialog: class {}, fromUuidSync: () => null
});
const { trackerImage } = await import(R + "/module/documents/combat.mjs");
const c = (type, system, img = "faces/x.webp") => ({ actor: { type, img, system } });
const rows = [
  ["пилот", c("pilot", { tier: "ace" })],
  ["конскрипт", c("npc", { tier: "conscript", insignia: "badges/a.webp" })],
  ["ас", c("npc", { tier: "ace", trackerImg: "insignia", insignia: "badges/a.webp" })],
  ["дуэлянт, лицо", c("npc", { tier: "duelist", trackerImg: "face", insignia: "badges/a.webp" })],
  ["дуэлянт, шильдик", c("npc", { tier: "duelist", trackerImg: "insignia", insignia: "badges/a.webp" })],
  ["дуэлянт, шильдик не выбран", c("npc", { tier: "duelist", trackerImg: "insignia", insignia: "" })],
  ["без актёра", { actor: null }]
];
for (const [k, v] of rows) console.log(`${k}: ${trackerImage(v) ?? "токен"}`);
