// Запуск: node tests/run.mjs (сверяет вывод со снимком в tests/snapshots)
// Неопознанные контакты (9.6): что под «?», строки AWACS, визуальное опознание, стрельба по «?», нарушения
import { fileURLToPath as __f } from "node:url";
process.argv[2] ??= __f(new URL("..", import.meta.url)).replace(/\/$/, "");
const R = process.argv[2];
const F = class { constructor(...a) { this.a = a; } };
Object.assign(globalThis, {
  foundry: { data: { fields: { NumberField: F, StringField: F, BooleanField: F, SchemaField: F, ArrayField: F, HTMLField: F, ObjectField: F } },
    abstract: { TypeDataModel: class {} }, utils: { getProperty: (o, p) => p.split(".").reduce((x, k) => x?.[k], o) } },
  Actor: class {}, Item: class {}, Hooks: { on() {}, once() {} },
  game: { settings: { get: () => true, register() {} }, keybindings: { register() {} } },
  CONFIG: { specialStatusEffects: { DEFEATED: "dead" } }, CONST: { TOKEN_DISPLAY_MODES: { OWNER: 30 } }
});
const I = await import(R + "/module/ident.mjs");
const S = await import(R + "/module/scene.mjs");
const npc = (side, extra = {}) => ({ type: "npc", system: { side, kind: "air", grp: "fighter", rules: [], ...extra }, getActiveTokens: () => [] });
const kinds = [["враг", npc("enemy")], ["лайнер", npc("neutral", { grp: "civil", rules: ["civilian"] })], ["нейтрал", npc("neutral")],
  ["свой", npc("ally")], ["ложная", npc("enemy", { key: "decoy", grp: "heli" })]];
console.log("что под «?»:", kinds.map(([n, a]) => `${n}=${I.identKind(a)}`).join(" "));
for (const k of ["enemy", "civil", "own", "decoy"]) console.log(`AWACS ${k}:`, I.identLine(3, k, k === "own" ? "Сокол-1" : k === "enemy" ? "Су-27 «Стрикс-2»" : ""));
console.log("глазами:", [[0, "low", "low"], [0, "low", "med"], [0, "low", "high"], [1, "med", "med"], [0, "strat", "high"], [null, "med", "med"]]
  .map(([d, a, b]) => `${d}/${a}/${b}=${I.seesVisually(d, a, b) ? 1 : 0}`).join(" "));
console.log("нарушение:", ["enemy", "civil", "own", "decoy"].map(k => `${k}=${I.violationOf(k) ?? "—"}`).join(" "));
// стрельба по «?»: игрок может по своему под «?», NPC союзник — нет
const unk = a => ({ ...a, isToken: true, token: { getFlag: (ns, k) => (k === "unknown" ? { n: 1 } : null) } });
const pilot = { type: "pilot", system: {} }, allyNpc = npc("ally");
console.log("огонь:", [["пилот→свой", pilot, npc("ally")], ["пилот→свой «?»", pilot, unk(npc("ally"))], ["союзник NPC→свой «?»", allyNpc, unk(npc("ally"))], ["враг→пилот", npc("enemy"), pilot]]
  .map(([n, a, b]) => `${n}=${S.canFireAt(a, b) ? "да" : "нет"}`).join(" · "));
// данные токена «Контакт N» для импорта
const d = I.contactData({ name: "Су-27 1", texture: { src: "systems/x/su27.svg", scaleX: 0.6 }, displayBars: 40, actorLink: false, flags: { "thunderbolt-shtab": { unitId: "u1" } } }, 4);
console.log("импорт:", JSON.stringify(d));
