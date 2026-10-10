// Запуск: node tests/run.mjs (сверяет вывод со снимком в tests/snapshots)
import { fileURLToPath as __f } from "node:url";
import { tmpdir as __tmp } from "node:os";
process.argv[2] ??= __f(new URL("..", import.meta.url)).replace(/\/$/, "");
process.argv[3] ??= __tmp() + "/tb-test-out";
const root = process.argv[2];
const hooks = {}, sent = [], said = [];
const timers = []; globalThis.setTimeout = f => { timers.push(f); return timers.length; }; globalThis.clearTimeout = () => {};
const run = () => { while (timers.length) timers.shift()(); };
const els = {};
globalThis.document = { getElementById: id => els[id], createElement: () => ({ classList: { add(){}, remove(){} }, setAttribute(){}, set innerHTML(v){ said.push(v.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim()); } }), body: { append(e){ els[e.id] = e; } } };
const settings = { npcChatter: true, chatterChance: 100, chatterBank: {}, chatterMuted: {}, radioSubtitles: true };
globalThis.CONFIG = { specialStatusEffects: { DEFEATED: "dead" } };
globalThis.Application = class {}; globalThis.FormApplication = class {};
const ls = {}; globalThis.localStorage = { getItem: k => ls[k] ?? null, setItem: (k, v) => { ls[k] = v; } };
globalThis.Hooks = { on: (n, f) => (hooks[n] ??= []).push(f), once: (n, f) => (hooks[n] ??= []).push(f) };
globalThis.foundry = { utils: { getProperty: () => null, mergeObject: (a, b) => ({ ...a, ...b }), deepClone: o => JSON.parse(JSON.stringify(o)) } };

// сцена: два вражеских МиГа, союзный корабль, гражданский лайнер, скрытый ЗРК, беспилотник и пилот игрока
const flagsOf = o => (scope, k) => k.split(".").reduce((x, p) => x?.[p], o.flags);
const scene = { id: "S", name: "Каньон", tokens: [], flags: {} }; scene.getFlag = flagsOf(scene);
// фразы по типам и «Говорит в эфире» — флаги сцены (вложенные: chatterBank.air.enemy.fire)
const bank = (flat, sc = scene) => { sc.flags.chatterBank = {}; for (const [k, v] of Object.entries(flat)) { const [t, sd, e] = k.split("."); ((sc.flags.chatterBank[t] ??= {})[sd] ??= {})[e] = v; } };
const mute = (m, sc = scene) => { sc.flags.chatterMuted = m; };
const actors = {};
function npc(id, name, sys, { hidden = false, dead = false, x = 0 } = {}) {
  const a = { type: "npc", name, uuid: `Scene.S.Token.${id}.Actor.${id}`, isToken: true, system: { side: "enemy", kind: "air", grp: "fighter", props: [], rules: [], markers: {}, ...sys },
    statuses: new Set(dead ? ["dead"] : []), flags: {}, getFlag(scope, k) { return k.split(".").reduce((x, p) => x?.[p], this.flags); } };
  const t = { id, name, hidden, x, y: 0, parent: scene, actor: a };
  a.token = t;
  scene.tokens.push(t);
  actors[a.uuid] = a;
  return a;
}
const mig1 = npc("m1", "Беркут-1", {}, { x: 0 });
const mig2 = npc("m2", "Беркут-2", {}, { x: 100 });
const ship = npc("sh", "Адмирал", { side: "ally", kind: "ship", grp: "sea" }, { x: 900 });
const liner = npc("cv", "Рейс 707", { side: "neutral", grp: "civil", rules: [{ key: "civilian" }] }, { x: 300 });
const sam = npc("sa", "ЗРК", { kind: "ground", grp: "ad" }, { hidden: true, x: 50 });
const uav = npc("uv", "БПЛА", { grp: "heli", rules: [{ key: "drone" }] }, { x: 20 });
const pilot = { type: "pilot", name: "Гроза", uuid: "Actor.p", system: { callsign: "Гроза-1", markers: {} }, statuses: new Set(), getActiveTokens: () => [] };
actors[pilot.uuid] = pilot;

globalThis.fromUuidSync = u => { const m = /^(Scene\.S\.Token\.(\w+))$/.exec(u); if (m) return scene.tokens.find(t => t.id === m[2]); return actors[u] ?? null; };
globalThis.game = {
  settings: { register(){}, registerMenu(){}, get: (s, k) => settings[k], set: async (s, k, v) => { settings[k] = v; } },
  user: { isGM: true, id: "gm", isSelf: true }, users: { activeGM: { isSelf: true } }, actors: [], combat: { started: true, scene, round: 2 }, scenes: { viewed: scene },
  socket: { emit: (ch, msg) => sent.push(msg), on(){} }
};
let rnd = 0; Math.random = () => (rnd = (rnd + 0.37) % 1);

const C = await import(`${root}/module/chatter.mjs`);
const B = await import(`${root}/module/data/chatter-bank.mjs`);
C.registerChatter();
const msg = flags => ({ flags: { "thunderbolt-shtab": flags } });
const fire = m => hooks.createChatMessage.forEach(f => f(m));
const step = label => { run(); console.log(`— ${label}`); for (const s of sent.splice(0)) console.log(`  [${s.line.side}] ${s.line.speaker}: ${s.line.text}`); };

// банк: у каждого типа и стороны есть фразы на каждое событие, в каждой 2–3 фразы
let holes = 0;
for (const [type, t] of Object.entries(B.CHATTER_TYPES))
  for (const side of t.civil ? ["civil"] : ["ally", "enemy"])
    for (const ev of B.eventsFor(type, side)) {
      const n = (B.CHATTER_BANK[type]?.[side]?.[ev] ?? []).length;
      if (n < 2 || n > 3) { holes++; console.log("дыра в банке:", type, side, ev, n); }
    }
console.log("банк:", Object.keys(C.fullBank()).length, "полей, дыр", holes);
console.log("типы:", [mig1, ship, liner, sam, uav, pilot].map(a => `${a.name}=${C.chatterType(a)}`).join(", "));

fire(msg({ rwr: { target: pilot.uuid, from: "Беркут-1", fromUuid: mig1.uuid } }));
step("МиГ взял захват на игрока");
fire(msg({ rwr: { target: mig2.uuid, from: "Гроза", fromUuid: pilot.uuid } }));
step("игрок захватил МиГ-2");
fire(msg({ card: { attack: true, delayed: true, actorUuid: mig1.uuid, targetUuid: pilot.uuid, targetName: "Гроза-1", parts: [] } }));
step("пуск МиГа по игроку");
fire(msg({ card: { attack: true, instant: true, actorUuid: ship.uuid, targetUuid: mig1.uuid, targetName: "Беркут-1", rolled: true, d10: 2, parts: [["Strafe", 1]], dc: 7 } }));
step("корабль бьёт пушкой по МиГу и промахивается");
fire(msg({ card: { type: "volley", targets: [
  { uuid: pilot.uuid, name: "Гроза-1", hit: true, sourceUuid: mig1.uuid, shooterUuids: [mig1.uuid] },
  { uuid: mig2.uuid, name: "Беркут-2", hit: false, sourceUuid: pilot.uuid, shooterUuids: [pilot.uuid] } ] } }));
step("залп: МиГ попал в игрока, игрок промахнулся по МиГу-2");
C.chatter({ event: "damaged", speaker: mig2.uuid });
C.chatter({ event: "down", victim: mig2.uuid, killer: pilot.uuid });
mig2.statuses.add("dead");
step("игрок сбил МиГ-2 (подбит и сбит в одном окне: остаётся только сбит)");
C.chatter({ event: "down", victim: pilot.uuid, killer: mig1.uuid });
step("МиГ сбил игрока: союзный корабль сообщает о потере");
fire(msg({ card: { attack: true, delayed: true, actorUuid: pilot.uuid, targetUuid: liner.uuid, targetName: "Рейс 707", parts: [] } }));
step("ракета по гражданскому лайнеру");
fire(msg({ card: { attack: true, delayed: true, actorUuid: sam.uuid, targetUuid: pilot.uuid, targetName: "Гроза-1", parts: [] } }));
step("скрытый ЗРК молчит");
bank({ "air.enemy.fire": ["Получай, {target}!"] });
fire(msg({ card: { attack: true, delayed: true, actorUuid: mig1.uuid, targetUuid: ship.uuid, targetName: "Адмирал", parts: [] } }));
step("правка ведущего: своя фраза пуска");
// у каждой сцены свои фразы: новая сцена начинает со стандартных
const scene2 = { id: "S2", name: "Пустыня", tokens: [], flags: {} }; scene2.getFlag = flagsOf(scene2);
console.log("сцена с правкой:", C.linesFor("air", "enemy", "fire", scene).join(" / "), "| новая сцена:", C.linesFor("air", "enemy", "fire", scene2).length, "стандартных:", C.linesFor("air", "enemy", "fire", scene2)[0]);
mig1.token.parent = scene2;
fire(msg({ card: { attack: true, delayed: true, actorUuid: mig1.uuid, targetUuid: ship.uuid, targetName: "Адмирал", parts: [] } }));
step("тот же МиГ на другой сцене: стандартная фраза");
mute({ air: true }, scene2);
fire(msg({ card: { attack: true, delayed: true, actorUuid: mig1.uuid, parts: [] } }));
step("на другой сцене самолёты молчат, а на первой говорят");
mig1.token.parent = scene;
fire(msg({ card: { attack: true, delayed: true, actorUuid: mig1.uuid, targetUuid: ship.uuid, targetName: "Адмирал", parts: [] } }));
step("снова на первой сцене: своя фраза");
mute({}, scene2);
bank({ "air.enemy.fire": [] });
fire(msg({ card: { attack: true, delayed: true, actorUuid: mig1.uuid, parts: [] } }));
step("пустое поле: МиГ молчит при пуске");
settings.chatterChance = 0;
fire(msg({ rwr: { target: ship.uuid, from: "Беркут-1", fromUuid: mig1.uuid } }));
step("частота мелочей 0%: захват без реплик");
settings.chatterChance = 100; bank({});

fire(msg({ card: { attack: true, delayed: true, tkind: "ground", actorUuid: mig1.uuid, targetUuid: ship.uuid, targetName: "Адмирал", parts: [] } }));
step("МиГ бьёт по кораблю: удар по земле");
fire(msg({ card: { attack: true, delayed: true, tkind: "ground", actorUuid: ship.uuid, targetUuid: mig1.uuid, targetName: "Беркут-1", parts: [] } }));
step("у корабля нет «удара по земле»: звучит обычный пуск");
ship.flags.quiet = true;
fire(msg({ card: { attack: true, delayed: true, actorUuid: mig1.uuid, targetUuid: ship.uuid, targetName: "Адмирал", parts: [] } }));
step("корабль с выключенной галочкой «Говорит в эфире» молчит");
delete ship.flags.quiet;

// ас со своими репликами; тип «Самолёт» выключен — обычный МиГ молчит, ас говорит своими
mig1.system.tier = "ace";
mig1.flags.replies = { fire: ["Это Беркут-1. {target}, ты мой!"], lock: [] };
mute({ air: true });
fire(msg({ card: { attack: true, delayed: true, actorUuid: mig1.uuid, targetUuid: ship.uuid, targetName: "Адмирал", parts: [] } }));
step("ас со своей фразой пуска при выключенном типе «Самолёт»");
fire(msg({ rwr: { target: ship.uuid, from: "Беркут-1", fromUuid: mig1.uuid } }));
step("пустое личное поле аса и выключенный тип: молчит");
mute({});
fire(msg({ rwr: { target: ship.uuid, from: "Беркут-1", fromUuid: mig1.uuid } }));
step("пустое личное поле аса: общими фразами типа");
const boss = npc("bo", "Хримфакси", { kind: "ship", grp: "boss" }, { x: 2000 });
mute({ boss: true });
fire(msg({ card: { attack: true, delayed: true, actorUuid: boss.uuid, targetUuid: ship.uuid, targetName: "Адмирал", parts: [] } }));
step("супероружие выключено: молчит, говорит только цель");
mute({});
mig1.system.tier = "conscript";

// много событий сразу: не больше трёх реплик, сначала важные
const extra = [npc("e1", "Ворон-1", {}, { x: 10 }), npc("e2", "Ворон-2", {}, { x: 20 }), npc("e3", "Ворон-3", {}, { x: 30 }), npc("e4", "Ворон-4", {}, { x: 40 })];
for (const a of extra) C.chatter({ event: "damaged", speaker: a.uuid });
C.chatter({ event: "down", victim: extra[0].uuid, killer: "" });
extra[0].statuses.add("dead");
step("пять событий сразу");

// имя в эфире: копию переименовали на листе токена, потом дали «Позывной в эфире»
mig1.token.baseActor = { name: "Беркут-1" }; mig1.name = "Юстициар-1";
fire(msg({ card: { attack: true, delayed: true, actorUuid: mig1.uuid, targetUuid: ship.uuid, targetName: "Адмирал", parts: [] } }));
step("копия переименована на листе: говорит под новым именем");
mig1.flags.callsign = "Страж";
ship.flags.callsign = "Ковчег";
fire(msg({ card: { attack: true, delayed: true, actorUuid: mig1.uuid, targetUuid: ship.uuid, targetName: "Адмирал", parts: [] } }));
step("позывной в эфире у стрелка и у цели");
console.log("имя без позывного:", C.nameOf(mig1, { own: false }), "| токен без переименования:", C.nameOf(mig2));
delete mig1.flags.callsign; delete ship.flags.callsign; mig1.name = "Беркут-1";

// файл: только отличия от стандартных
const file = C.fullBank(); file["ship.ally.kill"] = ["Цель потоплена!"]; file["нет.такого.ключа"] = ["x"];
const { ov, n } = C.bankFromFile(file);
console.log("из файла:", n, "полей, правки:", JSON.stringify(ov));
console.log("подстановка без цели:", C.fill("Захват! {target}.", {}), "|", C.fill("Захват! {target}.", { target: "Гроза" }));
console.log("субтитры у ведущего:", said.length, "журнал:", JSON.parse(Object.values(ls)[0]).length);
