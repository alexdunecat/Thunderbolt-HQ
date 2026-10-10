// Запуск: node tests/run.mjs (сверяет вывод со снимком в tests/snapshots)
import { fileURLToPath as __f } from "node:url";
import { tmpdir as __tmp } from "node:os";
process.argv[2] ??= __f(new URL("..", import.meta.url)).replace(/\/$/, "");
process.argv[3] ??= __tmp() + "/tb-test-out";
const R = process.argv[2];
const log = [];
const users = [{ id: "gm", isGM: true, active: true, isSelf: true }, { id: "pl", isGM: false, active: true }];
users.activeGM = users[0];
const store = { threats: [] }, messages = [];
const gs = 100;
const strip = h => h.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
Object.assign(globalThis, {
  foundry: { utils: { deepClone: x => structuredClone(x), randomID: () => "id1", hasProperty: () => false, getProperty: () => undefined } },
  Hooks: { on() {}, once() {} }, CONFIG: { sounds: {}, specialStatusEffects: { DEFEATED: "dead" } },
  CONST: { GRID_TYPES: { GRIDLESS: 0 } },
  ChatMessage: { create: async d => { messages.push(d); log.push("CHAT " + strip(d.content)); return d; }, getSpeaker: () => ({}) },
  game: { users, user: users[0], actors: [], settings: { get: (_s, k) => store[k], set: async (_s, k, v) => { store[k] = v; }, register() {} },
    combat: null, socket: { emit() {} }, messages: { contents: [] } },
  ui: { notifications: { warn: m => log.push("WARN " + m), info: m => log.push("INFO " + m) } },
  canvas: { ready: true, grid: { type: 1, size: gs, getOffset: p => ({ i: Math.floor(p.y / gs), j: Math.floor(p.x / gs) }) } },
  Roll: class { constructor(f) { this.f = f; } async evaluate() { this.total = 3; return this; } },
  fromUuidSync: () => null, Dialog: { confirm: async () => true }, Application: class {}, Combat: class {}, Actor: class {}, Item: class {}, ActorSheet: class {}
});
const { TB } = await import(R + "/module/config.mjs");
const S = await import(R + "/module/stealth.mjs");
const { renderCard } = await import(R + "/module/dice/rolls.mjs");
// сцена: РЛС в (2,2), самолёт ДРЛО в (6,1), ЗРК в (4,4), ПЗРК в (0,4), сбитая РЛС в (8,4), союзная РЛС
const scene = { tokens: [] };
function npc(name, col, row, sys, extra = {}) {
  const actor = { name, type: "npc", uuid: "Actor." + name, statuses: new Set(extra.dead ? ["dead"] : []),
    system: { side: "enemy", kind: "ground", props: [], rules: [], markers: {}, ground: { ga: null }, ...sys } };
  const doc = { name, x: col * gs, y: row * gs, width: 1, height: 1, hidden: !!extra.hidden, actor, parent: scene, elevation: 0 };
  doc.object = { center: { x: col * gs + 50, y: row * gs + 50 }, document: doc, actor };
  scene.tokens.push(doc);
  return doc;
}
npc("РЛС", 2, 2, { key: "radar", rules: [{ key: "radar" }] });
npc("А-50", 6, 1, { key: "a50", kind: "air", props: [{ key: "awacs" }] });
npc("С-300", 4, 4, { key: "s300", ground: { ga: 7 } });
npc("ПЗРК", 0, 4, { key: "manpads", ground: { ga: 5 } });
npc("Сбитая РЛС", 8, 4, { key: "radar" }, { dead: true });
npc("Своя РЛС", 9, 0, { key: "radar", side: "ally" });
npc("Скрытая РЛС", 9, 9, { key: "radar" }, { hidden: true });
const src = S.radarSources(scene);
console.log("sources:", src.map(s => `${s.doc.name}@${s.cell.col},${s.cell.row} r${s.reach}${s.station ? " РЛС" : ""}`).join("; "));
console.log("visible to players:", S.radarSources(scene, { hidden: false }).length);
const cells = S.radarCells(src);
const map = [];
for (let r = 0; r < 6; r++) { let line = ""; for (let c = 0; c < 10; c++) line += cells.has(`${c},${r}`) ? (cells.get(`${c},${r}`).length > 1 ? "2" : "#") : "."; map.push(line); }
console.log("field:\n" + map.join("\n"));
// пилоты
let acts = [];
function pilot(name, col, row, alt, extra = {}) {
  const actor = { name, type: "pilot", uuid: "Actor." + name, system: { side: "player", alt, speed: extra.speed ?? 2, planeProps: new Set(extra.props ?? []) },
    testUserPermission: (u) => u.id === "pl", isOwner: true };
  const doc = { name, x: col * gs, y: row * gs, width: 1, height: 1, elevation: TB.altElevation[alt], actor, parent: scene };
  doc.object = { center: { x: col * gs + 50, y: row * gs + 50 }, document: doc, actor };
  scene.tokens.push(doc);
  return { actor, token: doc, getFlag: () => ({ round: 2, list: acts }) };
}
const look = (p) => { const r = S.radarOn(p.token.object, p.actor, src); return `${p.actor.name}: seen ${r.seen}, РЛС рядом ${r.station}, ${r.by.join(", ") || "—"}`; };
const cases = [pilot("Med в поле", 3, 3, "med"), pilot("Low в поле", 3, 3, "low"), pilot("Low у РЛС", 2, 2, "low"), pilot("High вне поля", 0, 0, "high"),
  pilot("Стелс Med", 7, 2, "med", { props: ["stealth"] }), pilot("Low быстрый", 0, 1, "low", { speed: 4 })];
for (const p of cases) console.log(look(p));
// нет шкалы Тревоги: проверок нет
console.log("no alarm:", S.alarmActive(), await S.alarmCheck(cases[0], 2));
store.threats = [{ id: "a1", kind: "boss", alarm: true, open: true, name: "Тревога", size: 6, value: 2, created: 1000, lines: {} }];
console.log("alarm:", S.alarmActive(), S.alarmClock().name);
const check = async (p, list) => { acts = list; const m = await S.alarmCheck(p, 2); return m ? strip(m.content) + (m.author ? ` [author ${m.author}]` : "") : "—"; };
console.log(await check(cases[0], ["Fox Two!", "Move"]));
console.log(await check(cases[1], ["Move"]));
console.log(await check(cases[2], ["Leadership"]));
console.log(await check(cases[4], []));
console.log(await check(cases[5], []));
// внезапность: первая атака своих по врагу, пока Тревоги нет
const enemy = { uuid: "Actor.РЛС", actor: scene.tokens[0].actor };
console.log("surprise first:", JSON.stringify(S.surprise(cases[0].actor, enemy)));
game.messages.contents = [{ timestamp: 2000, getFlag: () => ({ attack: true, targetUuid: "Actor.РЛС" }) }];
console.log("surprise second:", S.surprise(cases[0].actor, enemy));
game.messages.contents = [{ timestamp: 500, getFlag: () => ({ attack: true, targetUuid: "Actor.РЛС" }) }];
console.log("attack before alarm clock:", JSON.stringify(S.surprise(cases[0].actor, enemy)));
console.log("enemy attacks pilot:", S.surprise(enemy.actor, { uuid: cases[0].actor.uuid, actor: cases[0].actor }));
console.log("quiet AA:", ["С-300", "ПЗРК", "РЛС", "А-50"].map(n => `${n}=${S.quietAA(scene.tokens.find(t => t.name === n).actor) ?? "—"}`).join(" | "));
// карточки
console.log("side fail:", strip(renderCard({ type: "side", label: "Тревога: Dodge против 7", rolled: true, d10: 3, d4: 2, parts: [["Уклонение", 1]], dc: 7, onFail: "alarm", notes: [], actorName: "Пилот" })));
console.log("side dmg:", strip(renderCard({ type: "side", label: "Пролёт", rolled: true, d10: 2, d4: 2, parts: [], dc: 6, failDmg: 3, notes: [], actorName: "Пилот" })));
store.threats[0].value = 6;
console.log("full:", S.alarmActive(), S.surprise(cases[0].actor, enemy), S.quietAA(scene.tokens[2].actor));
for (const l of log) console.log(l);
