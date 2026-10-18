// Гибель крупных целей по правилам: сразу (Аркбёрд, SOLG), через раунд с ударом в зоне (падение, реактор), в конце раунда (Тарпан), отмена.
import { fileURLToPath as __f } from "node:url";
import fs from "node:fs";
process.argv[2] ??= __f(new URL("..", import.meta.url)).replace(/\/$/, "");
const R = process.argv[2];
const F = class { constructor(...a) { this.a = a; } };
const log = [];
const combat = { id: "C1", started: true, round: 2, combatants: [], scene: null, getFlag: () => null };
Object.assign(globalThis, {
  foundry: { utils: { deepClone: x => structuredClone(x), mergeObject: Object.assign, getProperty: () => undefined, hasProperty: () => false, randomID: () => "S1" }, abstract: { TypeDataModel: class {} },
    data: { fields: { NumberField: F, StringField: F, BooleanField: F, SchemaField: F, ArrayField: F, HTMLField: F, ObjectField: F } } },
  CONST: { DOCUMENT_OWNERSHIP_LEVELS: { LIMITED: 1 }, GRID_TYPES: { GRIDLESS: 0 } },
  Hooks: { on() {}, once() {} }, CONFIG: { sounds: {}, specialStatusEffects: { DEFEATED: "dead" } },
  game: { user: { id: "gm", isGM: true }, users: Object.assign([], { activeGM: { isSelf: true } }), macros: [], folders: [], messages: { contents: [] }, combat, settings: { get: () => 0 }, actors: [], socket: { emit() {} } },
  ui: { notifications: { warn() {}, info() {} } }, ChatMessage: { create: async d => log.push("CHAT " + d.content.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()) },
  Actor: class {}, Item: class {}, Combat: class {}, Application: class {}, FormApplication: class {}, ActorSheet: class {}, Dialog: class {}, fromUuidSync: () => null
});
globalThis.canvas = { ready: false };
const packs = JSON.parse(fs.readFileSync(R + "/tests/fixtures/npcs.json", "utf8"));
const mk = key => {
  const d = structuredClone(packs[key]), s = d.system, flags = {};
  s.markers = { grit: false, structure: false, doom: false };
  const a = { name: d.name, type: "npc", uuid: "Actor." + key, system: s, statuses: new Set(), getActiveTokens: () => [],
    getFlag: (sc, k) => flags[k], async setFlag(sc, k, v) { const p = k.split("."); let o = flags; while (p.length > 1) o = o[p.shift()] ??= {}; o[p[0]] = v; },
    async unsetFlag(sc, k) { const p = k.split("."); let o = flags; while (p.length > 1) o = o[p.shift()] ?? {}; delete o[p[0]]; },
    async markDoom(why) { this.system.markers.doom = true; log.push(`DOOM ${this.name}: ${why}`); } };
  combat.combatants.push({ actor: a });
  return a;
};
const kill = (a, re) => a.system.systems.forEach(y => { if (re.test(y.name)) y.value = 0; });
const B = await import(R + "/module/boss-fate.mjs");
const show = (label, a) => console.log(`${label}: правило ${B.fateOf(a) ?? "—"} · Doom ${a.system.markers.doom} · отложено ${JSON.stringify(a.getFlag(0, "unit")?.fate ?? null)}`);
// Аркбёрд: четыре двигателя мало, пять — сбит сразу
const ark = mk("arkbird"); kill(ark, /ускорители №|комбинированного/); await B.checkFate(ark); show("Аркбёрд, 4 двигателя", ark);
kill(ark, /вспомогательный/i); await B.checkFate(ark); show("Аркбёрд, все двигатели", ark);
// SOLG: все ядра; отдельно ядро в стволе
const solg = mk("solg"); kill(solg, /^Ядра/); await B.checkFate(solg); show("SOLG, все ядра", solg);
const solg2 = mk("solg"); kill(solg2, /ствол/); await B.checkFate(solg2); show("SOLG, ядро в стволе", solg2);
// Литтория: без двигателей падает в конце следующего раунда (без сцены удар не ставится, гибель всё равно отложена)
const lit = mk("littoria"); kill(lit, /двигател/i); await B.checkFate(lit); show("Литтория без двигателей", lit);
await B.resolveFates(combat, 2); show("  конец раунда 2", lit);
await B.resolveFates(combat, 3); show("  конец раунда 3", lit);
// Рузвельт: реактор; HP вернули до срока — отмена
const roos = mk("roosevelt"); kill(roos, /реактор/i); await B.checkFate(roos); show("Рузвельт без реактора", roos);
roos.system.systems.find(y => /реактор/i.test(y.name)).value = 2; await B.checkFate(roos); show("  реактор починили", roos);
// Тарпан: гусеницы — в конце этого раунда
const tar = mk("tarpan"); kill(tar, /гусениц/i); await B.checkFate(tar); show("Тарпан без гусениц", tar);
await B.resolveFates(combat, 2); show("  конец раунда 2", tar);
// ручной «Взрыв реактора» из панели AWACS уничтожает свой корабль
const roos2 = mk("roosevelt"); await B.strikeDone({ kind: "reactor", sourceUuid: roos2.uuid }); show("Рузвельт после взрыва реактора", roos2);
globalThis.fromUuidSync = u => combat.combatants.map(c => c.actor).find(a => a.uuid === u) ?? null;
await B.strikeDone({ kind: "reactor", sourceUuid: roos2.uuid }); show("  (повторно)", roos2);
// вне боя — сразу
game.combat = null; const lit2 = mk("littoria"); kill(lit2, /двигател/i); await B.checkFate(lit2); show("Литтория вне боя", lit2);
console.log(log.join("\n"));
