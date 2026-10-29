// Запуск: node tests/run.mjs (сверяет вывод со снимком в tests/snapshots)
// Ход автопилота на заглушках сцены: прорыв танка к штабу, истребитель на охоте, ЗРК держит позицию, маршрут
import { fileURLToPath as __f } from "node:url";
import fs from "node:fs";
process.argv[2] ??= __f(new URL("..", import.meta.url)).replace(/\/$/, "");
const R = process.argv[2];
const F = class { constructor(...a) { this.a = a; } };
const combat = { id: "C1", started: true, round: 2, turn: 0, combatant: null, combatants: [], getFlag: () => null, setFlag: async () => {} };
const messages = [], log = [];
const getp = (o, p) => p.split(".").reduce((x, k) => x?.[k], o);
const setp = (o, p, v) => { const ks = p.split("."); let x = o; for (const k of ks.slice(0, -1)) x = (x[k] ??= {}); x[ks.at(-1)] = v; };
let seq = 0;
Object.assign(globalThis, {
  foundry: { utils: { deepClone: x => structuredClone(x), mergeObject: Object.assign, getProperty: getp, hasProperty: (o, p) => getp(o, p) !== undefined, setProperty: setp }, abstract: { TypeDataModel: class {} },
    data: { fields: { NumberField: F, StringField: F, BooleanField: F, SchemaField: F, ArrayField: F, HTMLField: F, ObjectField: F } } },
  CONST: { DOCUMENT_OWNERSHIP_LEVELS: { LIMITED: 1 }, GRID_TYPES: { GRIDLESS: 0, SQUARE: 1 } },
  Hooks: { on() {}, once() {}, callAll() {} }, CONFIG: { sounds: {}, specialStatusEffects: { DEFEATED: "dead" } },
  game: { user: { id: "gm", isGM: true }, users: Object.assign([{ id: "gm", isGM: true, active: true }], { activeGM: { isSelf: true, id: "gm" } }), macros: [], folders: [], messages: { contents: messages }, combat,
    settings: { get: (ns, k) => ({ threats: [], squadrons: {}, squadSortie: {} })[k] ?? null, register() {} }, actors: [], socket: { emit() {} } },
  ui: { notifications: { warn: m => log.push("warn " + m), error: m => log.push("error " + m), info() {} } },
  ChatMessage: { create: async d => { const c = d.flags?.["thunderbolt-shtab"]?.card; const m = { id: "m" + (++seq), ...d, getFlag: (s, k) => d.flags?.[s]?.[k], canUserModify: () => true,
    async update(u) { for (const [k, v] of Object.entries(u)) if (k === "content") this.content = v; else setp(this, k, v);
      const rows = u["flags.thunderbolt-shtab.apSummary.rows"]; if (rows) log.push(`  сводка раунда +${rows.length}: ${rows.at(-1).name} · ${rows.at(-1).order}: ${rows.at(-1).log.join("; ")}`); return this; } };
    messages.push(m); log.push("  чат: " + (c ? `${c.label ?? c.type} → ${c.targetName ?? ""}${c.combatKey ? ` [${c.combatKey}]` : ""}${c.instant ? ` итог ${c.d10 + c.parts.reduce((s, p) => s + p[1], 0)} против ${c.dc}` : ""}` : d.content.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 140))); return m; },
    getSpeaker: () => ({}), getWhisperRecipients: () => [] },
  Roll: class { constructor(f) { this.f = f; } async evaluate() { this.total = this.f === "1d10" ? 7 : 3; return this; } },
  Actor: class {}, Item: class {}, Combat: class {}, Application: class {}, FormApplication: class {}, ActorSheet: class {}, Dialog: class {}, fromUuidSync: u => byUuid[u] ?? null
});
Number.isNumeric = n => typeof n === "number" && Number.isFinite(n);
const scene = { id: "S", getFlag: () => null, tokens: [], grid: { size: 100, type: 1 } };
globalThis.canvas = { ready: true, scene, dimensions: { sceneRect: { x: 0, y: 0, width: 1000, height: 1000 } },
  grid: { type: 1, size: 100, getTopLeftPoint: p => ({ x: Math.floor(p.x / 100) * 100, y: Math.floor(p.y / 100) * 100 }), getOffset: p => ({ i: Math.floor(p.y / 100), j: Math.floor(p.x / 100) }), measurePath: ([a, b]) => ({ spaces: Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) / 100 }) },
  tokens: { placeables: [], controlled: [], get: id => canvas.tokens.placeables.find(t => t.id === id) } };
const byUuid = {};
const packs = JSON.parse(fs.readFileSync(R + "/tests/fixtures/npcs.json", "utf8"));
const ELEV = { low: 1, med: 2, high: 3, strat: 4 };
const place = (a, col, row, alt = "med") => {
  const t = { id: "T" + a.uuid, name: a.name, actor: a, center: { x: col * 100 + 50, y: row * 100 + 50 } };
  t.document = { parent: scene, x: col * 100 + 30, y: row * 100 + 30, width: 0.5, height: 0.5, hidden: false, elevation: ELEV[alt] ?? 0, rotation: 0, object: t, actor: a, getFlag: () => null,
    async update(ch, o = {}) { if ("x" in ch && o.tbAuto && Math.floor((ch.x + 25) / 100) === Math.floor(t.center.x / 100) && Math.floor((ch.y + 25) / 100) === Math.floor(t.center.y / 100)) log.push(`  манёвр в зоне: ${this.x},${this.y} → ${ch.x},${ch.y}`);
      if ("x" in ch) { const dx = ch.x - this.x, dy = ch.y - this.y; this.x = ch.x; this.y = ch.y; t.center = { x: t.center.x + dx, y: t.center.y + dy }; }
      if ("elevation" in ch) { this.elevation = ch.elevation; a.system.alt = Object.keys(ELEV).find(k => ELEV[k] === ch.elevation); } return this; } };
  a.system.alt = alt;
  a.getActiveTokens = () => [t];
  canvas.tokens.placeables.push(t); scene.tokens.push(t.document);
  byUuid[a.uuid] = a;
  return t;
};
const base = (d, extra = {}) => ({ statuses: new Set(), items: [], flags: {}, isOwner: true, getFlag(s, k) { return this.flags[k]; }, async setFlag(s, k, v) { this.flags[k] = v; },
  async update(ch) { for (const [k, v] of Object.entries(ch)) if (k.startsWith("system.")) setp(this, k, v); return this; }, testUserPermission: () => false, async applyDamage(n) { log.push(`  урон ${this.name}: ${n}`); }, ...d, ...extra });
const npc = (key, name, col, row, o = {}) => {
  const d = structuredClone(packs[key]), s = d.system;
  Object.assign(s, { side: "enemy", tier: "conscript", lockUuid: "", markers: {}, skills: { aim: 1, deploy: 1, dodge: 1, strafe: 1, lead: 0, push: 0 }, skillTotal: { aim: 1, deploy: 1, dodge: 1, strafe: 1, lead: 0, push: 0 }, ...o.sys });
  s.aa = s.stats?.aa ?? null; s.ag = s.stats?.ag ?? null; s.evasion = s.stats?.ev ?? 0; s.speed ??= 1; s.gun = s.stats?.gun ?? 0;
  if (s.kind === "ground") s.defense = s.ground?.occ ?? 4;
  const a = base({ type: "npc", name, uuid: "Actor." + name, system: s, hasPlayerOwner: false });
  place(a, col, row, o.alt ?? (s.kind === "air" ? "med" : "ground"));
  return a;
};
const pilot = (name, col, row, o = {}) => {
  const a = base({ type: "pilot", id: name, name, uuid: "Actor." + name, hasPlayerOwner: true,
    system: { callsign: name, evasion: o.ev ?? 3, speed: o.speed ?? 2, hp: { value: 6, max: 6 }, lockUuid: "", markers: {}, skills: { aim: 1, deploy: 1, dodge: 1, strafe: 1, lead: 0, push: 0 }, twist: false, alt: "med" } });
  place(a, col, row, o.alt);
  return a;
};
// самолёт союзников под ведущим (не игрок): обычная цель автопилота
const ally = (name, col, row, o = {}) => npc("f15c", name, col, row, { ...o, sys: { side: "ally", ...o.sys } });
const AP = await import(R + "/module/autopilot.mjs");
AP.pace.k = 0;
const run = async (title, a) => {
  log.push(`${title}:`);
  const lines = await AP.runAutopilot(a);
  log.push(`  ход: ${lines.join("; ") || "—"}`);
  const t = a.getActiveTokens()[0];
  log.push(`  стоит: ${Math.floor(t.center.x / 100)},${Math.floor(t.center.y / 100)} ${a.system.alt}${a.system.lockUuid ? `, захват ${byUuid[a.system.lockUuid]?.name}` : ""}`);
};

// игроки и цели
const grom = pilot("Гроза", 2, 2);
const hq = npc("hq", "Штаб", 8, 2, { sys: { side: "ally" } });
const allyTank = npc("t80u", "Свой танк", 6, 2, { sys: { side: "ally" } });
// вражеский танк прорывается к штабу: по пути бьёт свой танк союзников на соседней клетке маршрута, а не пилота
const tank = npc("t80u", "Абрамс", 4, 2);
tank.flags.autopilot = { on: true, task: "attack", manner: "push", target: hq.uuid, targetName: "Штаб", acts: 3, after: "hold", route: [], step: 0 };
await run("танк, прорыв к штабу", tank);
// истребитель на охоте: сближение, захват, пуск (ракета в залп следующего раунда)
const f15 = npc("f15c", "Орёл-1", 5, 5);
f15.flags.autopilot = { on: true, task: "hunt", manner: "push", acts: 3, after: "hold", route: [], step: 0 };
await run("истребитель, охота", f15);
// ЗРК держит позицию: рядом только пилот игрока — выцелил его, автопилот снят, ход за ведущим
const sam = npc("s300", "С-300", 2, 4);
sam.flags.autopilot = { on: true, task: "hold", manner: "careful", acts: 2, after: "hold", route: [], step: 0 };
await run("ЗРК, держать позицию", sam);
log.push(`  автопилот: ${AP.autopilotOn(sam) ? "включён" : "снят"}`);
// охотник: пилот игрока ближе, самолёт союзников дальше — бьёт самолёт, игрок последний
const hunter = npc("f15c", "Охотник", 2, 3);
const wingman = ally("Ведомый союзников", 4, 3);
hunter.flags.autopilot = { on: true, task: "hunt", manner: "careful", acts: 2, after: "hold", route: [], step: 0 };
await run("охотник, игрок рядом", hunter);
// колонна по маршруту
const truck = npc("t80u", "Колонна", 0, 8, { sys: { side: "ally" } });
truck.flags.autopilot = { on: true, task: "route", manner: "rush", acts: 2, after: "hold", route: ["1,8", "3,8"], step: 0 };
await run("колонна, маршрут напролом", truck);
await run("колонна, второй раунд", truck);

// дальше каждая сцена с чистого листа
const clear = () => { canvas.tokens.placeables.length = 0; scene.tokens.length = 0; };
const at = a => { const d = a.getActiveTokens()[0].document; return `${d.x},${d.y}`; };
const weapon = (key, o = {}) => ({ id: "W" + key, type: "weapon", name: key, flags: {}, getFlag: () => null,
  system: { key, target: "air", ammo: { value: 2, max: 2 }, reach: 1, dmg: "4", aa: 2, ...o }, async update(ch) { for (const [k, v] of Object.entries(ch)) setp(this, k, v); } });
// ас с QAAM в собачьей свалке: захват уже есть, перед пуском — заход сбоку по своей зоне; второй пуск с другой стороны
clear();
const raven = ally("Ворон", 4, 3);
const ace = npc("f15c", "Ас", 3, 3, { sys: { tier: "ace" } });
const kit = (...ws) => Object.assign(ws, { get: id => ws.find(w => w.id === id) });
ace.items = kit(weapon("QAAM", { ammo: { value: 4, max: 4 } }));
ace.system.lockUuid = raven.uuid;
ace.flags.autopilot = { on: true, task: "hunt", manner: "careful", acts: 2, after: "hold", route: [], step: 0 };
log.push("ас до хода: место " + at(ace));
await run("ас, спецоружие", ace);
log.push("  место " + at(ace) + ", QAAM осталось " + ace.items[0].system.ammo.value);
// крейсер держит позицию: пилот над ним — ЗРК, потом артустановка (ракетная система уже стреляла)
clear();
const kirov = npc("kirov", "Киров", 6, 6);
kirov.system.systems = kirov.system.systems.map(y => ({ ...y, value: y.value ?? y.hp }));
const viper = ally("Гадюка", 6, 6);
kirov.flags.autopilot = { on: true, task: "hold", manner: "careful", acts: 2, after: "hold", route: [], step: 0 };
await run("крейсер, ракета и пушка", kirov);
// бомбардировщик с ковровой бомбардировкой над колонной союзников
clear();
const col1 = npc("t80u", "Колонна-1", 2, 7, { sys: { side: "ally" } }), col2 = npc("t80u", "Колонна-2", 2, 7, { sys: { side: "ally" } });
const bomber = npc("f15c", "Бомбардировщик", 2, 7, { alt: "low", sys: { props: [{ key: "carpet", name: "Ковровая бомбардировка" }] } });
bomber.flags.autopilot = { on: true, task: "hunt", manner: "push", acts: 1, after: "hold", route: [], step: 0 };
await run("бомбардировщик, ковёр", bomber);
// AC-130: бортовые орудия по танку в соседней зоне
clear();
const tank2 = npc("t80u", "Танк союзников", 5, 8, { sys: { side: "ally" } });
const spectre = npc("f15c", "AC-130", 4, 8, { alt: "low", sys: { props: [{ key: "gunship", name: "Бортовые орудия" }], aa: null, ag: null, stats: {} } });
spectre.flags.autopilot = { on: true, task: "hunt", manner: "push", acts: 1, after: "hold", route: [], step: 0 };
await run("AC-130, бортовые орудия", spectre);
// EMRG: линия по двум самолётам союзников, своих на ней нет
clear();
const a1 = ally("Альфа", 5, 1), a2 = ally("Браво", 7, 1);
const rail = npc("f15c", "Рельсотрон", 2, 1, { sys: { tier: "ace" } });
rail.items = kit(weapon("EMRG", { target: "line", dmg: "12", ammo: { value: 4, max: 4 } }));
rail.flags.autopilot = { on: true, task: "hunt", manner: "careful", acts: 1, after: "hold", route: [], step: 0 };
await run("EMRG по линии", rail);
// наступление строем, действия по совету: звено идёт на восток, по пути бьёт, последним действием держит темп
clear();
const foe = ally("Цель", 4, 5);
const lead = npc("f15c", "Звено-1", 1, 4), wing = npc("f15c", "Звено-2", 1, 6);
const routes = AP.formationRoutes([[1, 4], [1, 6]], ["8,5"]);
for (const [n, a] of [lead, wing].entries()) a.flags.autopilot = { on: true, task: "advance", manner: "push", acts: 0, after: "hold", route: routes[n], step: 0 };
log.push("пути строя: " + JSON.stringify(routes));
await run("наступление, ведущий", lead);
await run("наступление, ведомый", wing);
await run("наступление, ведущий, второй раунд", lead);
// штурмовик по типу машины: цели на земле первыми, пушкарь — сближается и бьёт пушкой, а не ракетой по истребителю рядом
clear();
const jet = ally("Истребитель", 3, 2), armor = npc("t80u", "Танк", 5, 2, { sys: { side: "ally" } });
const hog = npc("f15c", "Штурмовик", 4, 2, { alt: "low", sys: { grp: "attack" } });
hog.flags.autopilot = { on: true, task: "hunt", manner: "careful", acts: 2, after: "hold", route: [], step: 0 };
await run("штурмовик, по типу машины", hog);
// охрана: эскорт держится у колонны, бьёт того, кто взял её на захват, а не ближнего
clear();
const convoy = npc("t80u", "Колонна", 5, 5);
const raider = ally("Налётчик", 7, 5), bystander = ally("Мимо", 2, 4);
raider.system.lockUuid = convoy.uuid;
const escort = npc("f15c", "Эскорт", 2, 5);
escort.flags.autopilot = { on: true, task: "escort", manner: "push", acts: 3, after: "hold", route: [], step: 0, target: convoy.uuid, targetName: "Колонна" };
await run("эскорт колонны", escort);
await run("эскорт колонны, второй раунд", escort);
// спецоружие слабее стандартной ракеты (урон 3, мод −2): боезапас бережёт, пускает стандартную
clear();
const prey = ally("Добыча", 4, 4);
const saver = npc("f15c", "Бережливый", 3, 4);
saver.items = kit(weapon("XLAA", { dmg: "3", aa: -2, reach: 3 }));
saver.system.lockUuid = prey.uuid;
saver.flags.autopilot = { on: true, task: "hunt", manner: "careful", acts: 1, after: "hold", route: [], step: 0 };
await run("слабое спецоружие", saver);
log.push("  XLAA осталось " + saver.items[0].system.ammo.value);
// танк держит позицию: G-G без захвата бьёт только свою и соседнюю зону — цель через одну не достать
clear();
const far = npc("t80u", "Дальний", 7, 7, { sys: { side: "ally" } });
const holder = npc("t80u", "Заслон", 5, 7);
holder.flags.autopilot = { on: true, task: "hold", manner: "careful", acts: 1, after: "hold", route: [], step: 0 };
await run("танк, цель через зону", holder);
far.getActiveTokens()[0].center = { x: 650, y: 750 };
await run("танк, цель в соседней зоне", holder);
// сваливание после Break!: исход применяется сам, кнопку жать некому
const Rr = await import(R + "/module/dice/rolls.mjs");
saver.system.speed = -1;
log.push("сваливание на автопилоте:");
await Rr.rollStall(saver);
const stall = messages.at(-1).getFlag("thunderbolt-shtab", "card");
log.push(`  карточка разобрана: ${stall.applied}, Speed ${saver.system.speed}, высота ${saver.system.alt}`);
console.log(log.join("\n"));
