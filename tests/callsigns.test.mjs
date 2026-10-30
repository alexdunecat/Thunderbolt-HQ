// Запуск: node tests/run.mjs (сверяет вывод со снимком в tests/snapshots)
// Позывные по нациям: тип по листу, редкие позывные, звенья, номера полков, занятые на сцене
import { fileURLToPath as __f } from "node:url";
process.argv[2] ??= __f(new URL("..", import.meta.url)).replace(/\/$/, "");
const R = process.argv[2];
Object.assign(globalThis, {
  foundry: { utils: { deepClone: x => structuredClone(x) }, abstract: { TypeDataModel: class {} }, data: { fields: {} } },
  Hooks: { on() {}, once() {} }, CONFIG: {}, game: { settings: { get: () => ({}) } }
});
const C = await import(R + "/module/callsigns.mjs");
// предсказуемый «случай»
const seq = (...v) => { let i = 0; return () => v[i++ % v.length]; };
const kinds = [["F-16C", { kind: "air", grp: "fighter" }], ["F/A-18E", { kind: "air", grp: "multi" }], ["Су-27 (каталог пилотов)", { kind: "air", grp: "player" }],
  ["A-10A", { kind: "air", grp: "attack" }], ["Ту-160", { kind: "air", grp: "heavy" }], ["А-50", { kind: "air", grp: "support", key: "a50" }],
  ["Ил-76", { kind: "air", grp: "support", key: "il76" }], ["Ми-24", { kind: "air", grp: "heli" }], ["авиалайнер", { kind: "air", grp: "civil" }],
  ["С-300", { kind: "ground", grp: "ad" }], ["Т-80У", { kind: "ground", grp: "armor" }], ["гаубица", { kind: "ground", grp: "art" }],
  ["завод", { kind: "ground", grp: "obj" }], ["эсминец", { kind: "ship", grp: "sea" }], ["Аркбёрд", { kind: "ship", grp: "boss" }], ["ас на F-22", { kind: "air", grp: "fighter", tier: "ace" }]];
console.log("тип позывного:", kinds.map(([n, s]) => `${n} ${C.callKind(s) ?? "—"}`).join(", "));
console.log("строка:", JSON.stringify(C.parseEntry("Кумыс | 100")), JSON.stringify(C.parseEntry("Оазис")));

// редкий позывной: примерно раз из 100
const tank = C.bankOf("sotoa", {}).tanker;
let rnd = 1, kumis = 0;
const lcg = () => (rnd = (rnd * 1103515245 + 12345) % 2147483648) / 2147483648;
for (let i = 0; i < 20000; i++) if (C.pickName(tank, new Set(), lcg) === "Кумыс") kumis++;
console.log(`Кумыс за 20000 раздач: ${kumis} (ждём около 200)`);
console.log("занятые пропускаются:", C.pickName(tank, new Set(["Оазис", "Уэлспринг"]), seq(0.5, 0)), "· все заняты:", C.pickName(tank, new Set(["Оазис", "Уэлспринг", "Ривер"]), seq(0.5, 0)));

const used = new Set();
console.log("Сотоа, звено истребителей словом:", C.flightCalls({ nation: "sotoa", kind: "fighter", count: 4, used, rnd: seq(0.9, 0.1) }).join(", "));
console.log("Белка, звено словом:", C.flightCalls({ nation: "belka", kind: "fighter", count: 2, used, rnd: seq(0.9, 0.1) }).join(", "));
console.log("Юктобания, рядовой полк номерами:", C.flightCalls({ nation: "yuk", kind: "fighter", count: 3, used, rnd: seq(0.2, 0.05) }).join(", "));
console.log("Осея, номера своей сотни:", C.flightCalls({ nation: "osea", kind: "heavy", count: 2, used, rnd: seq(0.2, 0.5) }).join(", "));
console.log("Сотоа, дуэлянты — элита кланов:", C.flightCalls({ nation: "sotoa", kind: "fighter", tier: "duelist", count: 2, used, rnd: seq(0.9, 0) }).join(", "));
console.log("Осея, дуэлянты без элиты — обычное слово:", C.flightCalls({ nation: "osea", kind: "attack", tier: "duelist", count: 2, used, rnd: seq(0.9, 0) }).join(", "));
console.log("Белка, транспорт берёт и заправщиков:", C.flightCalls({ nation: "belka", kind: "transport", count: 1, used, rnd: seq(0.9, 0.99) }).join(", "));
console.log("Осея, гражданские рейсы:", C.flightCalls({ nation: "osea", kind: "civil", count: 2, used, rnd: seq(0.21, 0.5) }).join(", "));
console.log("ПВО всегда словом:", C.flightCalls({ nation: "yuk", kind: "ad", count: 2, used, rnd: seq(0.1, 0.3) }).join(", "));
console.log("занято:", [...used].join(", "));
const tok = c => ({ flags: { "thunderbolt-shtab": { radioCall: c } } });
console.log("занятые на сцене:", [...C.usedCalls([tok("Шункар-2"), tok("Адлер 1"), tok("305-й"), tok("Осеан 2210"), tok("Хэппи Ауэр-1"), tok("")])].join(", "));
console.log("правка ведущего:", C.bankOf("yuk", { yuk: { tanker: ["Пивозавр | 2", "Самовар"] } }).tanker.map(e => e.rare ? `${e.name}/${e.rare}` : e.name).join(", "));
console.log("безымянный:", C.unnamed({ type: "npc", name: "F-16C Fighting Falcon", getFlag: () => undefined }, "F-16C Fighting Falcon"),
  C.unnamed({ type: "npc", name: "Кара-Буран", getFlag: () => undefined }, "Су-47"), C.unnamed({ type: "npc", name: "Су-47", getFlag: () => "Ханзаде" }, "Су-47"));
