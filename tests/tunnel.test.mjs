// Запуск: node tests/run.mjs (сверяет вывод со снимком в tests/snapshots)
import { fileURLToPath as __f } from "node:url";
import { tmpdir as __tmp } from "node:os";
process.argv[2] ??= __f(new URL("..", import.meta.url)).replace(/\/$/, "");
process.argv[3] ??= __tmp() + "/tb-test-out";
const R = process.argv[2];
const log = [];
const users = [{ id: "gm", isGM: true, active: true, isSelf: true }, { id: "pl", isGM: false, active: true }];
users.activeGM = users[0];
const gs = 100;
const strip = h => h.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
Object.assign(globalThis, {
  foundry: { utils: { deepClone: x => structuredClone(x), randomID: () => "id1", hasProperty: () => false, getProperty: () => undefined, setProperty: (o, k, v) => { o[k] = v; } } },
  Hooks: { on() {}, once() {} }, CONFIG: { sounds: {}, specialStatusEffects: { DEFEATED: "dead" } },
  CONST: { GRID_TYPES: { GRIDLESS: 0 } },
  ChatMessage: { create: async d => { log.push("CHAT " + strip(d.content)); return d; }, getSpeaker: () => ({}) },
  game: { users, user: users[0], actors: [], settings: { get: () => [], set: async () => {}, register() {} }, combat: null, socket: { emit() {} }, messages: { contents: [] }, scenes: { viewed: null } },
  ui: { notifications: { warn: m => log.push("WARN " + m), info: m => log.push("INFO " + m) } },
  canvas: { ready: true, grid: { type: 1, size: gs, getOffset: p => ({ i: Math.floor(p.y / gs), j: Math.floor(p.x / gs) }) } },
  Roll: class { constructor(f) { this.f = f; } async evaluate() { this.total = 3; return this; } },
  fromUuidSync: () => null, Dialog: { confirm: async () => true }, Application: class {}, Combat: class {}, Actor: class {}, Item: class {}, ActorSheet: class {}
});
const { TB } = await import(R + "/module/config.mjs");
const S = await import(R + "/module/scene.mjs");
const T = await import(R + "/module/tunnel.mjs");
const { renderCard } = await import(R + "/module/dice/rolls.mjs");
// туннель: 1 Прямая → 2 Узость → 3 Изгиб ↓ 4 Зал → 5 Развилка → 6 Прямая → 7 Ворота (выход); с Развилки вниз 6 Препятствие
const cells = { "0,1": { type: "straight", n: 1 }, "1,1": { type: "narrow", n: 2 }, "2,1": { type: "bend", n: 3 }, "2,2": { type: "hall", n: 4 },
  "3,2": { type: "fork", n: 5 }, "4,2": { type: "straight", n: 6 }, "5,2": { type: "gate", n: 7 }, "3,3": { type: "obstacle", n: 6 }, "0,4": { type: "shaft", n: 1 } };
const scene = { width: 8 * gs, height: 6 * gs, grid: { size: gs }, getFlag: (_s, k) => (k === "tunnelCells" ? cells : null) };
const map = [];
for (let r = 0; r < 6; r++) { let l = ""; for (let c = 0; c < 8; c++) l += cells[`${c},${r}`] ? String(cells[`${c},${r}`].n) : "."; map.push(l); }
console.log("map:\n" + map.join("\n"));
function unit(name, col, row, alt, sys = {}, extra = {}) {
  const actor = { name, type: extra.type ?? "pilot", uuid: "Actor." + name, items: extra.items ?? [],
    system: { side: extra.type === "npc" ? "enemy" : "player", alt, speed: 2, kind: "air", props: [], rules: [], markers: {}, planeProps: new Set(), ...sys },
    testUserPermission: u => u.id === "pl", getFlag: () => null };
  const flags = { ...(extra.flags ?? {}) };
  const doc = { name, x: col * gs, y: row * gs, width: 1, height: 1, elevation: TB.altElevation[alt], actor, parent: scene,
    getFlag: (_s, k) => flags[k], async update(ch) { log.push(`MOVE ${name} → ${ch.x / gs},${ch.y / gs}`); Object.assign(this, ch); this.object.center = { x: this.x + 50, y: this.y + 50 }; } };
  doc.object = { name, center: { x: col * gs + 50, y: row * gs + 50 }, document: doc, actor };
  actor.isToken = true; actor.token = doc;
  return { actor, token: doc.object, doc, kind: "air" };
}
// где токен в туннеле
const at = (u) => { const s = S.tunnelAt(u.token, u.actor); return `${u.actor.name}: ${s ? `Т${s.n} ${s.type}` : "снаружи"}${S.inNarrowTunnel(u.token, u.actor) ? ", узко" : ""}, стены +${S.wallBonus(u.token, u.actor)}`; };
const inNarrow = unit("В Узости", 1, 1, "low"), overNarrow = unit("Над Узостью", 1, 1, "med"), inHall = unit("В Зале Med", 2, 2, "med"), outside = unit("Снаружи", 6, 4, "low");
for (const u of [inNarrow, overNarrow, inHall, outside]) console.log(at(u));
// next / drift
const sec = (c, r) => S.sectionAt(scene, c, r);
const fmt = d => `path [${d.path.map(s => s.n + s.type[0]).join(" ")}] exit ${d.exit ? d.exit.col + "," + d.exit.row : "—"} fork ${d.fork}`;
console.log("next from 5:", S.nextSections(scene, sec(3, 2), 1).map(s => `${s.col},${s.row}`).join(" "), "| back from 5:", S.nextSections(scene, sec(3, 2), -1).map(s => s.n).join(" "));
console.log("drift 1→2 steps:", fmt(T.drift(scene, sec(0, 1), 2)));
console.log("drift 3→hall:", fmt(T.drift(scene, sec(2, 1), 2)));
console.log("drift 4→fork:", fmt(T.drift(scene, sec(2, 2), 2)));
console.log("drift 6→exit:", fmt(T.drift(scene, sec(4, 2), 2)));
console.log("drift 7 exit:", fmt(T.drift(scene, sec(5, 2), 1)));
console.log("drift back from 2:", fmt(T.drift(scene, sec(1, 1), 1, -1)));
console.log("passDc:", T.passDc(2, [sec(0, 1)]), T.passDc(4, [sec(0, 1), sec(1, 1)]), T.passDc(0, [sec(3, 3)]));
// высота и Move
const lowStraight = unit("Т1", 0, 1, "low");
console.log("climb in tunnel:", S.tunnelClimbProblem(lowStraight.token, "med"));
console.log("dive onto narrow:", S.tunnelClimbProblem(overNarrow.token, "low"));
console.log("dive onto shaft:", S.tunnelClimbProblem(unit("Над Шахтой", 0, 4, "med").token, "low"));
console.log("climb in hall:", S.tunnelClimbProblem(unit("Зал Low", 2, 2, "low").token, "med"));
const mv = (u, c, r) => `${u.actor.name} → ${c},${r}: ${S.tunnelMoveProblem(u.doc, { x: c * gs, y: r * gs }) ?? "ok"}`;
console.log(mv(lowStraight, 1, 1));
console.log(mv(lowStraight, 0, 0));
console.log(mv(inNarrow, 0, 1));
console.log(mv(unit("Т7", 5, 2, "low"), 6, 2));
console.log(mv(unit("Вход снаружи", 0, 0, "low"), 0, 1));
console.log(mv(unit("Вход сбоку", 1, 0, "low"), 1, 1));
console.log(mv(unit("Над туннелем", 1, 0, "med"), 1, 1));
console.log(mv(unit("Зал", 2, 2, "low"), 2, 1));
const back = unit("После разворота", 2, 1, "low", {}, { flags: { tunnelDir: -1 } });
console.log(mv(back, 1, 1), "|", mv(back, 2, 2));
// досягаемость в туннеле
const reach = (a, t) => { const x = S.reachProblems(a.actor, t, 2); return `${a.actor.name} → ${t.actor.name}: ${x.problems.join(" ") || "ok"}`; };
const foe = (n, c, r, alt = "low") => unit(n, c, r, alt, {}, { type: "npc" });
console.log(reach(lowStraight, foe("враг Т2", 1, 1)));
console.log(reach(lowStraight, foe("враг Т1", 0, 1)));
console.log(reach(inNarrow, foe("враг Т1 сзади", 0, 1)));
console.log(reach(unit("Изгиб", 2, 1, "low"), foe("враг Зал", 2, 2)));
console.log(reach(lowStraight, foe("враг снаружи", 0, 0)));
console.log(reach(unit("снаружи Low", 0, 0, "low"), foe("враг в туннеле", 0, 1)));
console.log(reach(unit("Зал", 2, 2, "low"), foe("враг Т5", 3, 2)));
// конец хода
const turn = async (u) => { const m = await T.tunnelTurnEnd({ actor: u.actor, token: { object: u.token } }); return m ? strip(m.content) + (m.author ? ` [author ${m.author}]` : "") : "—"; };
console.log(await turn(unit("Пилот S2", 0, 1, "low")));
console.log(await turn(unit("Пилот S4", 0, 1, "low", { speed: 4 })));
console.log(await turn(unit("Перед Развилкой", 3, 2, "low", { speed: 3 })));
console.log(await turn(unit("У выхода", 5, 2, "low", { speed: 2 })));
console.log(await turn(unit("Никогда", 0, 1, "low", {}, { items: [{ type: "trigger", system: { key: "nevercome" } }] })));
console.log(await turn(unit("Сваливание", 0, 1, "low", { speed: 0 })));
console.log(await turn(unit("В Зале", 2, 2, "low")));
console.log(await turn(unit("Над туннелем", 0, 1, "med")));
console.log("card rolled:", strip(renderCard({ type: "tunnel", label: "Туннель: конец хода", actorName: "Пилот", notes: [], check: true, dc: 7, speed: 3, hard: true, rolledPass: true })));
console.log("names:", T.secName({ type: "narrow" }), T.secName({ type: "weird" }));
for (const l of log) console.log(l);
