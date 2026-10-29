// Запуск: node tests/run.mjs (сверяет вывод со снимком в tests/snapshots)
// Импорт миссии: приказы автопилота и подкрепления из строк Планшета AWACS
import { fileURLToPath as __f } from "node:url";
process.argv[2] ??= __f(new URL("..", import.meta.url)).replace(/\/$/, "");
const R = process.argv[2];
const F = class { constructor(...a) { this.a = a; } };
Object.assign(globalThis, {
  foundry: { utils: {}, abstract: { TypeDataModel: class {} }, data: { fields: { NumberField: F, StringField: F, BooleanField: F, SchemaField: F, ArrayField: F, HTMLField: F, ObjectField: F } } },
  CONST: { TOKEN_DISPOSITIONS: { HOSTILE: -1, FRIENDLY: 1, NEUTRAL: 0 }, GRID_TYPES: { SQUARE: 1 } },
  Hooks: { on() {}, once() {}, callAll() {} }, CONFIG: { specialStatusEffects: { DEFEATED: "dead" } },
  Actor: class {}, Item: class {}, Combat: class {}, Application: class {}, FormApplication: class {}, ActorSheet: class {}, Dialog: class {},
  game: { settings: { get: () => null, register() {} } }
});
const MI = await import(R + "/module/apps/mission-import.mjs");
const AP = await import(R + "/module/autopilot.mjs");
const units = [
  { id: "u1", name: "Патруль", ref: "mig29a", ap: { task: "patrol", manner: "careful", acts: 2, route: ["2,2", "4,2"] } },
  { id: "u2", name: "Звено", ref: "su27", ap: { task: "advance", route: ["7,3"] } },
  { id: "u3", name: "Эскорт", ref: "f15c", ap: { task: "escort", target: "u4" } },
  { id: "u4", name: "Колонна", ref: "t80u" },
  { id: "u5", name: "Резерв", ref: "mig29a", arrive: { after: "u4" }, ap: { task: "attack", target: "u9" } },
  { id: "u6", name: "Волна", ref: "mig29a", arrive: { round: 3 }, ap: { task: "route", route: [] } },
  { id: "u7", name: "Без машины", ref: "x", arrive: { after: "u0" } }
];
const tok = (id, n, cell) => ({ uuid: `Scene.S.Token.${id}${n}.Actor.x`, name: `${id}-${n}`, cell });
const byUnit = new Map([
  ["u1", [tok("u1", 1, [2, 2])]], ["u2", [tok("u2", 1, [1, 3]), tok("u2", 2, [1, 4])]], ["u3", [tok("u3", 1, [3, 3])]],
  ["u4", [tok("u4", 1, [4, 4])]], ["u5", [tok("u5", 1, [6, 1])]], ["u6", [tok("u6", 1, [7, 5])]], ["u7", [tok("u7", 1, [0, 0])]]
]);
const plan = MI.unitPlans(units, byUnit, (cells, route) => AP.formationRoutes(cells, route, { c0: 0, r0: 0, c1: 9, r1: 9 }));
for (const [uuid, o] of plan.orders) console.log("приказ", uuid.split(".")[3], o.task, o.manner, o.acts, o.targetName || "-", JSON.stringify(o.route));
for (const [uuid, a] of plan.arrive) console.log("выход", uuid.split(".")[3], JSON.stringify(a));
for (const p of plan.problems) console.log("замечание:", p);
// события по ходу боя
const ev = MI.missionEvents([
  { round: 2, speaker: "AWACS", side: "ally", text: "Внимание, с севера подходят бомбардировщики." },
  { after: "u4", speaker: "Стрикс-1", side: "enemy", text: "Колонна потеряна! Всем бортам на перехват!", caution: true },
  { after: "u0", text: "Нет такой машины" }, { round: 3, text: "   " }, { speaker: "", side: "x", text: "Без раунда" }
], byUnit);
for (const e of ev.events) console.log("событие", JSON.stringify(e));
for (const p of ev.problems) console.log("замечание:", p);
const ME = await import(R + "/module/mission-events.mjs");
const gone = new Set();
for (const [round, fired] of [[1, []], [2, []], [2, [0, 2]], [3, [0, 2]]]) {
  if (round === 3) gone.add("Scene.S.Token.u41.Actor.x");
  console.log(`пора в раунде ${round} (уже ${JSON.stringify(fired)}):`, JSON.stringify(ME.dueEvents(ev.events, round, fired, u => gone.has(u))));
}
