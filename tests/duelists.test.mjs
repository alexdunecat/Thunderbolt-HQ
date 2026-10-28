// Запуск: node tests/run.mjs (сверяет вывод со снимком в tests/snapshots)
// Именная эскадрилья дуэлянтов (Стрэйнджриал 9.1): бюджет от пилотов, запас Strain, тактики
import { fileURLToPath as __f } from "node:url";
process.argv[2] ??= __f(new URL("..", import.meta.url)).replace(/\/$/, "");
const R = process.argv[2];
const F = class { constructor(...a) { this.a = a; } };
const log = [];
const store = { "thunderbolt-shtab.operationsDone": 0, "thunderbolt-shtab.squadrons": {}, "thunderbolt-shtab.squadSortie": {} };
const get = (o, p) => p.split(".").reduce((x, k) => x?.[k], o);
const setp = (o, p, v) => { const ks = p.split("."); let x = o; for (const k of ks.slice(0, -1)) x = (x[k] ??= {}); x[ks.at(-1)] = v; };
const users = [{ id: "gm", isGM: true, active: true }];
users.activeGM = { isSelf: true };
Object.assign(globalThis, {
  foundry: { data: { fields: { NumberField: F, StringField: F, BooleanField: F, SchemaField: F, ArrayField: F, HTMLField: F, ObjectField: F } },
    abstract: { TypeDataModel: class {} }, utils: { hasProperty: (o, p) => get(o, p) !== undefined, getProperty: get, deepClone: x => structuredClone(x) } },
  Actor: class {}, Item: class {}, Dialog: class {}, Application: class {}, FormApplication: class {},
  Hooks: { on() {}, once() {}, callAll() {} },
  ChatMessage: { create: async d => { log.push("CHAT " + d.content.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()); return d; }, getSpeaker: () => ({}) },
  game: { user: users[0], users, messages: { contents: [] }, combat: null,
    settings: { get: (ns, k) => structuredClone(store[`${ns}.${k}`]), set: async (ns, k, v) => { store[`${ns}.${k}`] = structuredClone(v); }, register() {} } },
  ui: { notifications: { info: m => log.push("info " + m), warn: m => log.push("warn " + m) } },
  CONFIG: { sounds: {}, specialStatusEffects: { DEFEATED: "dead" } },
  CONST: { GRID_TYPES: { GRIDLESS: 0 } }
});
const { TB, airDuelist } = await import(R + "/module/config.mjs");
const elev = TB.altElevation;
const docs = [], actors = {};
const scene = { grid: { size: 100 }, tokens: docs, getFlag: () => null };
const mk = (name, col, row, alt, sys = {}, type = "npc") => {
  const a = { name, uuid: "Actor." + name, type, isToken: false, isOwner: true, statuses: new Set(), items: [], flags: {},
    system: { kind: "air", side: "enemy", tier: "duelist", speed: 2, maxSpeed: 4, evasion: 3, breakEv: null, stats: { ev: 3 }, hp: { value: 3, max: 3 }, props: [], rules: [], systems: [], markers: {}, ...sys },
    getFlag() { return null; }, async setFlag() {}, async update() {} };
  const doc = { id: name, name, actor: a, x: col * 100, y: row * 100, width: 1, height: 1, elevation: alt === "ground" ? 0 : elev[alt], parent: scene, hidden: false, getFlag: () => null };
  const tok = { id: name, name, actor: a, document: doc, center: { x: col * 100 + 50, y: row * 100 + 50 } };
  doc.object = tok; a.getActiveTokens = () => [tok];
  docs.push(doc); actors[a.uuid] = a; return a;
};
globalThis.fromUuidSync = u => actors[u];
globalThis.canvas = { ready: true, scene, grid: { type: 1, size: 100, getOffset: p => ({ i: Math.floor(p.y / 100), j: Math.floor(p.x / 100) }) },
  get tokens() { return { placeables: docs.map(d => d.object), controlled: [] }; } };
game.scenes = { viewed: scene };
const Q = await import(R + "/module/squadrons.mjs");
const D = await import(R + "/module/duelists.mjs");
const S = await import(R + "/module/scene.mjs");

// бюджет раскладки: самый опытный пилот −4, не меньше 4; корабли и крепости по-старому
const sk = n => ({ aim: n, deploy: 0, dodge: 0, push: 0, strafe: 0, lead: 0 });
const pilots = [{ type: "pilot", system: { skills: sk(9), service: {} } }, { type: "pilot", system: { skills: sk(6), service: {} } }, { type: "pilot", system: { skills: sk(20), service: { status: "retired" } } }];
game.actors = Object.assign([...pilots], { filter: Array.prototype.filter, find: Array.prototype.find });
const y1 = mk("Жёлтый-1", 0, 0, "med", { squad: "Жёлтые" }), y2 = mk("Жёлтый-2", 2, 0, "med", { squad: "Жёлтые" }), y3 = mk("Жёлтый-3", 2, 0, "med", { squad: "Жёлтые" });
const fort = mk("Крепость", 9, 9, "high", { squad: "Крепости", systems: [{ name: "Мостик", value: 3, hp: 3 }] });
const navy = mk("Эсминец", 8, 8, "ground", { squad: "", kind: "ship" });
console.log("бюджет:", Q.airSquadBudget(), "· слабые пилоты:", Q.airSquadBudget([{ system: { skills: sk(7) } }]), "· эскадрилья самолётов:", Q.budgetOf("Жёлтые"), Q.isAirSquad("Жёлтые"),
  "· крепости:", Q.budgetOf("Крепости"), Q.isAirSquad("Крепости"));
console.log("дуэлянт-самолёт:", [y1, fort, navy, mk("Конскрипт", 5, 5, "med", { tier: "conscript" })].map(a => `${a.name}=${airDuelist(a)}`).join(" "));

// тактики: одна, вторая с 2 пройденных операций
await Q.setSquadTactic("Жёлтые", 0, "pincer");
await Q.setSquadTactic("Жёлтые", 1, "wall");
console.log("тактики (0 операций):", Q.squadTactics("Жёлтые").join(","));
store["thunderbolt-shtab.operationsDone"] = 2;
console.log("тактики (2 операции):", Q.squadTactics("Жёлтые").join(","));

// запас Strain: вне боя нет, в бою 2 × машин эскадрильи на сцене
console.log("вне боя:", JSON.stringify(D.poolOf(y1)));
game.combat = { id: "C1", round: 1, started: true, scene };
console.log("в бою:", JSON.stringify(D.poolOf(y1)), "· потратить:", await D.spendPool(y1, 1), JSON.stringify(D.poolOf(y2)), "· крепость:", JSON.stringify(D.poolOf(fort)));
console.log("кнопки:", JSON.stringify(D.tacticsView("Жёлтые").map(t => [t.key, t.why])));

// «Клещи»: двое держат одну цель из разных зон
const pilot = mk("Гроза", 1, 0, "med", { side: "player", tier: "" }, "pilot");
y1.system.lockUuid = pilot.uuid; y2.system.lockUuid = pilot.uuid;
console.log("клещи можно:", D.tacticsView("Жёлтые").find(t => t.key === "pincer").why || "да");
await D.useTactic("Жёлтые", "pincer");
console.log("клещи:", JSON.stringify(D.tacticAttack(y1, pilot).parts), JSON.stringify(D.tacticAttack(y3, pilot).parts), "· повтор:", D.tacticsView("Жёлтые").find(t => t.key === "pincer").why);

// «Строй»: двое в одной зоне, Defense +1 и без перемещения
const def0 = S.defenseWithWeather(y2, { ev: 0 });
await D.useTactic("Жёлтые", "wall");
console.log("строй:", D.inWall(y2), D.inWall(y3), D.inWall(y1), "· защита:", def0, "→", S.defenseWithWeather(y2, { ev: 0 }));
game.combat.round = 2;
console.log("строй в следующем раунде:", D.inWall(y2), "· защита:", S.defenseWithWeather(y2, { ev: 0 }));

// «Приманка», «За ведомого», «Со стороны солнца», «Карусель»: тактики ставятся прямо в настройку
await Q.setSquadTactic("Жёлтые", 0, "bait");
await D.useTactic("Жёлтые", "bait", y2);
const near = mk("Рядом", 2, 0, "med", { side: "player", tier: "" }, "pilot");
console.log("приманка:", JSON.stringify(D.tacticAttack(near, y3).parts), JSON.stringify(D.tacticAttack(near, y2).parts), JSON.stringify(D.tacticAttack(pilot, y3).parts));
await Q.setSquadTactic("Жёлтые", 0, "revenge");
console.log("за ведомого до:", D.tacticsView("Жёлтые").find(t => t.key === "revenge").why);
await D.duelistDown(y3, pilot.uuid);
const rev = D.tacticAttack(y1, pilot);
console.log("за ведомого:", JSON.stringify(rev.parts), "· после атаки:", (await Promise.all(rev.later.map(f => f())), JSON.stringify(D.tacticAttack(y1, pilot).parts)), "· второй:", JSON.stringify(D.tacticAttack(y2, pilot).parts));
await Q.setSquadTactic("Жёлтые", 0, "sun");
await D.useTactic("Жёлтые", "sun");
console.log("солнце:", D.sunOn(y1), "· другая эскадрилья:", D.sunOn(fort));
await Q.setSquadTactic("Жёлтые", 0, "carousel");
await D.useTactic("Жёлтые", "carousel");
console.log("карусель:", D.carouselFree(y1), (await D.carouselMoved(y1), D.carouselFree(y1)), D.carouselFree(y2));
console.log(log.join("\n"));
