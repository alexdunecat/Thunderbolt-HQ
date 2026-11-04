// Репутация пилота (Стрэйнджриал 10): уровни, подсказки разбора, кто стреляет по куполу, атаки, катапульта Чудовища, реплики.
// Запуск: node tests/run.mjs (сверяет вывод со снимком в tests/snapshots)
import { fileURLToPath as __f } from "node:url";
process.argv[2] ??= __f(new URL("..", import.meta.url)).replace(/\/$/, "");
const R = process.argv[2];
const log = [];
const F = class { constructor(...a) { this.a = a; } };
const users = [{ id: "gm", isGM: true, active: true, isSelf: true }];
users.activeGM = users[0];
Object.assign(globalThis, {
  foundry: { utils: { deepClone: x => structuredClone(x), randomID: () => "id", getProperty: () => undefined, setProperty() {}, mergeObject: (a, b) => ({ ...a, ...b }) },
    abstract: { TypeDataModel: class {} }, data: { fields: { NumberField: F, StringField: F, BooleanField: F, SchemaField: F, ArrayField: F, HTMLField: F, ObjectField: F } } },
  Hooks: { on() {}, once() {} }, CONFIG: { sounds: {}, specialStatusEffects: { DEFEATED: "dead" } },
  ChatMessage: { create: async d => d, getSpeaker: () => ({}) },
  game: { users, user: users[0], actors: [], settings: { get: () => "" }, combat: { started: true, id: "c1", round: 3 }, socket: { emit() {} } },
  ui: { notifications: { warn() {}, info() {} } },
  fromUuidSync: u => byUuid[u] ?? null, Dialog: { confirm: async () => true }, Combat: class {}, Actor: class {}, Item: class {}, Application: class {}, FormApplication: class {}, ActorSheet: class {}
});
const byUuid = {};
const Rep = await import(R + "/module/reputation.mjs");
const assert = (c, m) => { if (!c) { console.error("FAIL " + m); process.exitCode = 1; } else log.push("ok " + m); };

// уровни
const lv = p => Rep.repLevel(p).key;
console.log("уровни:", [-10, -8, -7, -4, -3, 0, 3, 4, 7, 8, 10, 15, -15].map(p => `${p}=${lv(p)}`).join(" "));
assert(lv(-8) === "monster" && lv(-7) === "punisher" && lv(-3) === "soldier" && lv(4) === "knight" && lv(8) === "white", "границы уровней");
const fx = k => { const e = Rep.repEffects(k); return `${e.bonus.map(x => x.title).join(", ")} | ${e.minus.map(x => x.title).join(", ")}`; };
for (const k of ["white", "knight", "soldier", "punisher", "monster"]) console.log(`эффекты ${k}: ${fx(k)}`);

// разбор: вверх не больше +2
const ev = [{ kind: "mercy", delta: 1, why: "a" }, { kind: "rescue", delta: 1, why: "b" }, { kind: "shield", delta: 1, why: "c" }, { kind: "chute", delta: -2, why: "d" }];
const sug = Rep.repSuggest(ev);
console.log("подсказки:", sug.map(s => `${s.kind}${s.delta > 0 ? "+" : ""}${s.delta}${s.on ? "✓" : "☐"}`).join(" "));
console.log("итог всех:", Rep.repTotal(sug), "итог отмеченных:", Rep.repTotal(sug.filter(s => s.on)), "отказ от приказа:", Rep.repTotal([{ delta: 2 }, { delta: 1 }]));
assert(Rep.repTotal(sug) === 0, "лимит вверх +2 и −2 вниз");
console.log("сдвиги:", Object.entries(Rep.REP_SHIFTS).map(([k, v]) => `${k} ${v.delta}`).join(", "));

// актёры
const flags = {};
const mk = (uuid, type, system, f = {}) => {
  const a = { uuid, id: uuid, type, name: uuid, system, isOwner: true, statuses: new Set(), items: [], getFlag: (s, k) => (flags[uuid] ?? {})[k], hasPlayerOwner: type === "pilot" };
  flags[uuid] = f; byUuid[uuid] = a; return a;
};
const pilot = (uuid, points, f) => mk(uuid, "pilot", { reputation: { points, log: [] }, callsign: uuid }, f);
const npc = (uuid, tier, kind = "air", extra = {}) => mk(uuid, "npc", { tier, kind, side: "enemy", grp: extra.grp ?? "fighter", nemesis: !!extra.nemesis, markers: {} });
const white = pilot("Белый", 9), knight = pilot("Рыцарь", 5), soldier = pilot("Солдат", 0), punisher = pilot("Каратель", -5), monster = pilot("Чудовище", -9);
const feud = pilot("Мститель", 0, { feud: { combat: "c1" } });
const broken = pilot("Нарушил", 9, { repBroken: { combat: "c1" } });
const ace = npc("Ас", "ace"), duel = npc("Дуэлянт", "duelist"), cons = npc("Рядовой", "conscript"), nem = npc("Немезида", "ace", "air", { nemesis: true });
const sam = npc("ЗРК", "conscript", "ground", { grp: "ad" }), tank = npc("Танк", "conscript", "ground", { grp: "armor" });
const chute = p => ({ pilot: true, uuid: p.uuid });
const rows = [];
for (const v of [soldier, knight, white, broken, punisher, feud, monster])
  rows.push(`${v.name}: ${[ace, duel, nem, cons, sam, tank].filter(s => Rep.chuteShooterOk(s, chute(v))).map(s => s.name).join(", ") || "никто"}`);
console.log("по куполу стреляют:\n  " + rows.join("\n  "));

// атаки NPC по пилоту и страх конскриптов
game.actors = [white, knight, soldier, punisher, monster];
const z0 = () => 0;
const parts = (a, t, list = game.actors) => Rep.repAttack(a, t, { zoneFn: z0, list }).parts.map(([l, v]) => `${l} ${v > 0 ? "+" : ""}${v}`).join("; ") || "—";
console.log("ас по Белому рыцарю:", parts(ace, white, []));
console.log("ас по Чудовищу:", parts(ace, monster, []));
console.log("дуэлянт по мстителю:", parts(duel, feud, []));
console.log("рядовой рядом с Карателем:", parts(cons, soldier, [punisher]));
console.log("рядовой рядом с Чудовищем и Карателем:", parts(cons, soldier, [punisher, monster]));
console.log("ас рядом с Чудовищем (страх только у рядовых):", parts(ace, soldier, [monster]));

// кодекс Белого рыцаря
const civ = mk("Лайнер", "npc", { tier: "conscript", kind: "air", side: "neutral", grp: "civil", markers: {} });
const runner = npc("Беглец", "conscript"); runner.statuses.add("retreat");
const doomed = npc("Обречённый", "conscript"); doomed.system.markers.doom = true;
for (const t of [cons, civ, runner, doomed]) {
  const r = Rep.repAttack(white, t, { zoneFn: z0, list: [] });
  console.log(`Белый рыцарь по «${t.name}»: ${r.problems.length ? "предупреждение" : "без вопросов"}${r.problems[0] ? ` (${r.problems[0].split(".")[0]})` : ""}`);
}
console.log("нарушивший кодекс по беглецу:", Rep.repAttack(broken, runner, { zoneFn: z0, list: [] }).problems.length ? "предупреждение" : "без вопросов");

// Слово чести и цели автопилота
console.log("Слово чести:", [[knight, cons], [knight, duel], [white, duel], [broken, cons], [soldier, cons]].map(([p, t]) => `${p.name}→${t.name} ${Rep.honorWordOf(p, t)?.dc ?? "нет"}`).join(", "));
console.log("притяжение цели для аса:", [white, knight, soldier, feud].map(p => `${p.name} ${Rep.targetPull(ace, p, z0)}`).join(", "));
console.log("приказы ведомым:", [monster, punisher].map(p => `${p.name}: ${Rep.ordersRefused(p) || "слушают"}`).join("; "));

// катапульта: «Пленных не берут» у Чудовища
const Rr = await import(R + "/module/dice/rolls.mjs");
const base = (d4, noPrison) => ({ type: "eject", rolled: true, d10: 2, d4, parts: [["Push", 1]], strain: 0, dc: 7, strainable: true, skill: "push", perkOn: 4, compOn: 1, actorUuid: "Actor.s", actorName: "С", label: "Катапульта", noPrison });
console.log("катапульта d4 3:", Rr.ejectFate(Rr.computeCard(base(3, false))).status, "у Чудовища:", Rr.ejectFate(Rr.computeCard(base(3, true))).status,
  "d4 4 у Чудовища:", Rr.ejectFate(Rr.computeCard(base(4, true))).status);

// след и банк реплик
const { trailLook } = await import(R + "/module/contrails.mjs");
console.log("след:", ["soldier", "knight", "white", "punisher", "monster"].map(k => `${k}=${JSON.stringify(trailLook(k))}`).join(" "));
const B = await import(R + "/module/data/rep-chatter-bank.mjs");
let holes = 0;
for (const [type, sides] of Object.entries(B.REP_BANK)) for (const [side, evs] of Object.entries(B.REP_EVENTS))
  if (sides[side]) for (const e of Object.keys(evs)) { const n = sides[side][e]?.length ?? 0; if (n < 2) { holes++; console.log("мало реплик:", type, side, e, n); } }
console.log("банк Репутации:", Object.entries(B.REP_BANK).map(([t, s]) => `${t} ${Object.keys(s).join("/")}`).join(", "), "дыр", holes);
console.log("тип по уровню:", ["monster", "punisher", "soldier", "knight", "white"].map(k => `${k}=${B.repType(k)}`).join(" "));

// разбор: подсказки с галочками и сдвиг ведущего без лимита
{
  const upd = [];
  const p = pilot("Разбор", 2, { repEvents: [{ kind: "mercy", delta: 1, why: "отпустил «Кобру»" }, { kind: "rescue", delta: 1, why: "координаты спасателям" }, { kind: "shield", delta: 1, why: "заслонил лайнер" }] });
  p.unsetFlag = async () => { flags[p.uuid] = {}; };
  p.update = async u => { upd.push(u); p.system.reputation = { points: u["system.reputation.points"], log: u["system.reputation.log"] }; };
  p.items = [];
  const html = Rep.debriefFields([p]);
  console.log("в форме разбора:", (html.match(/name="rep_[^"]+"/g) ?? []).join(" "));
  const r = await Rep.applyDebrief(p, { rep_Разбор_0: true, rep_Разбор_1: true, rep_Разбор_2: true, rep_Разбор_gm: "3", rep_Разбор_gmwhy: "вывел колонну беженцев" }, "12.05.2010");
  console.log("итог разбора:", r.notes.join("; "), "| журнал:", JSON.stringify(p.system.reputation.log));
}

// «Ловушка»: сам позвал спасателей к куполу и расстрелял его — −5, +1 за вызов снимается; чужой купол — обычные −2
{
  const mkP = (id, f) => { const p = pilot(id, 0, f); p.setFlag = async (sc, k, v) => { flags[p.uuid][k] = v; }; p.testUserPermission = () => true; return p; };
  const radio = [];
  globalThis.canvas = { ready: false, tokens: { placeables: [] } };
  const trapper = mkP("Ловец", { repEvents: [{ kind: "rescue", delta: 1, why: "координаты", combat: "c1" }] });
  const other = mkP("Другой", { repEvents: [] });
  try {
    await Rep.chuteShotByPilot(trapper, { trap: true, name: "Кобра" });
    await Rep.chuteShotByPilot(trapper, { trap: true, name: "Кобра" });
    await Rep.chuteShotByPilot(other, { trap: false, name: "Гюрза" });
    console.log("ловушка:", JSON.stringify(trapper.getFlag("", "repEvents").map(e => [e.kind, e.delta])), "| чужой купол:", JSON.stringify(other.getFlag("", "repEvents").map(e => [e.kind, e.delta])));
  } catch (err) { console.log("ловушка: ошибка", err.message); }
}

console.log(process.exitCode ? "FAILED" : "all ok (" + log.filter(l => l.startsWith("ok")).length + ")");
