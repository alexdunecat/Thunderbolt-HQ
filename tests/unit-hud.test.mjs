// Панели крупных целей: кому какая панель, механики правил по системам, шкалы в конце раунда, разметка.
import { fileURLToPath as __f } from "node:url";
import fs from "node:fs";
process.argv[2] ??= __f(new URL("..", import.meta.url)).replace(/\/$/, "");
const R = process.argv[2];
const F = class { constructor(...a) { this.a = a; } };
const chat = [];
const combat = { id: "C1", started: true, round: 4, combatant: null, combatants: [], getFlag: () => null };
Object.assign(globalThis, {
  foundry: { utils: { deepClone: x => structuredClone(x), mergeObject: Object.assign, getProperty: () => undefined, hasProperty: () => false }, abstract: { TypeDataModel: class {} },
    data: { fields: { NumberField: F, StringField: F, BooleanField: F, SchemaField: F, ArrayField: F, HTMLField: F, ObjectField: F } } },
  CONST: { DOCUMENT_OWNERSHIP_LEVELS: { LIMITED: 1 }, GRID_TYPES: { GRIDLESS: 0 } },
  Hooks: { on() {}, once() {} }, CONFIG: { sounds: {}, specialStatusEffects: { DEFEATED: "dead" } },
  game: { user: { id: "gm", isGM: true }, users: [], macros: [], folders: [], messages: { contents: [] }, combat, settings: { get: () => true }, actors: [] },
  ui: { notifications: { warn() {}, info() {} } }, ChatMessage: { create: d => chat.push(d.content) },
  Actor: class {}, Item: class {}, Combat: class {}, Application: class {}, FormApplication: class {}, ActorSheet: class {}, Dialog: class {}, fromUuidSync: () => null
});
const scene = { id: "S", getFlag: () => null };
globalThis.canvas = { ready: true, scene, grid: { type: 1, size: 100, getOffset: p => ({ i: Math.floor(p.y / 100), j: Math.floor(p.x / 100) }), measurePath: ([a, b]) => ({ spaces: Math.abs(a.x - b.x) / 100 }) }, tokens: { placeables: [], controlled: [] } };
// выдержка из компендиума NPC (packs-src в репозиторий не входит)
const packs = JSON.parse(fs.readFileSync(R + "/tests/fixtures/npcs.json", "utf8"));
const mk = key => {
  const d = structuredClone(packs[key]), s = d.system, flags = {};
  if (s.kind === "ship") s.hp = { max: s.systems.reduce((t, y) => t + y.hp, 0), value: s.systems.reduce((t, y) => t + Math.max(0, y.value), 0) };
  const a = { name: d.name, type: "npc", uuid: "Actor." + key, isOwner: true, system: s, items: [], getActiveTokens: () => [],
    markDoom: async why => chat.push(`DOOM ${d.name}: ${why}`), fireGuns: async o => (chat.push(`ЛУЧ ${d.name} #${o?.system}`), { id: "m" }),
    getFlag: (sc, k) => flags[k], update: async upd => { for (const [k, v] of Object.entries(upd)) { const path = k.replace(/^flags\.[^.]+\./, "").split("."); let o = flags; while (path.length > 1) o = o[path.shift()] ??= {}; o[path[0]] = v; } } };
  return a;
};
const kill = (a, re) => a.system.systems.forEach(y => { if (re.test(y.name)) y.value = 0; });
const U = await import(R + "/module/unit-hud.mjs");
const S = await import(R + "/module/scales.mjs");
const H = await import(R + "/module/hud.mjs");
const show = a => { const d = U.unitData(a); console.log(`${a.name}: ${d.kind}${d.scales.length ? " · шкалы " + d.scales.map(x => `${x.label} ${x.value}`).join(", ") : ""}${d.strikes.length ? " · удары " + d.strikes.map(x => x.label).join(", ") : ""}`);
  for (const m of d.mech) console.log(`   [${m.tone}] ${m.text}${m.btn ? ` {${m.btn.label}}` : ""}`); if (d.alerts.length) console.log("   ТРЕВОГА:", d.alerts.join(" | ")); };
console.log("панели:", ["roosevelt", "solg", "arkbird", "icbm", "kirov", "nimitz", "sub", "t80u", "s300", "howitzer", "housing", "hq", "airliner", "f15c"].map(k => `${k}=${U.unitKind(mk(k)) ?? (H.hudFits(mk(k)) ? "истребитель" : "нет")}`).join(" "));
// кнопки на плитках систем: ЛУЧ (как пушка, d10 + 2, урон 4), УДАР (удар по площади этой системы)
const wpn = k => { const d = U.unitData(mk(k)); console.log(`${k} плитки: ${d.systems.filter(y => y.beam || y.strike).map(y => `${y.name}=${y.beam ? "ЛУЧ" : `УДАР ${y.strike}`}`).join(", ") || "нет"}`); };
for (const k of ["roosevelt", "arkbird", "tarpan", "scinfaxi", "littoria", "solg", "arcion"]) wpn(k);
{ const Sc = await import(R + "/module/scene.mjs"), r = mk("roosevelt"), ys = r.system.systems;
  const beam = Sc.gunSys(r, ys.find(y => /HPBC/.test(y.name))), aa = ys.find(y => /Зенитные батареи/.test(y.name));
  console.log(`луч как пушка: Gun ${beam.gun}, Strafe +${Sc.sysStrafe(r, beam)}, дальность ${Sc.sysGunReach(beam)}, по ${Sc.gunVs(r, beam)} · зенитные батареи по ${Sc.gunVs(r, aa)}, дальность ${Sc.sysGunReach(aa)}`); }
// ЛУЧ: раз в раунд на каждый блок, вне хода (заявка и бросок хода не нужны)
{ const r = mk("roosevelt"), i = r.system.systems.findIndex(y => /HPBC/.test(y.name)), warns = [];
  ui.notifications.warn = m => warns.push(m);
  await U.onUnitClick({ dataset: { uGun: String(i) } }, r); await U.onUnitClick({ dataset: { uGun: String(i) } }, r);
  console.log("лучи:", chat.filter(x => x.startsWith("ЛУЧ")).length, "выстрел;", warns.join(" | "), "·", U.unitData(r).mech.find(m => /Лучи/.test(m.text))?.text);
  ui.notifications.warn = () => {}; }
const roos = mk("roosevelt"); kill(roos, /сопла №[12]/); show(roos);
kill(roos, /сопл/); show(roos);
const tarpan = mk("tarpan"); kill(tarpan, /решётк/); kill(tarpan, /главного калибра №1/); show(tarpan);
const ark = mk("arkbird"); kill(ark, /ускорители №|комбинированного цикла №1/); show(ark);
const solg = mk("solg"); kill(solg, /ускорители №2/); combat.round = 2; show(solg); combat.round = 4;
const lit = mk("littoria"); kill(lit, /ЗАК/); await U.onUnitClick({ dataset: { uFlag: "qrf" } }, lit); show(lit);
const scin = mk("scinfaxi"); await U.onUnitClick({ dataset: { uLaunch: "vtol" } }, scin); show(scin); await U.onUnitClick({ dataset: { uFlag: "sub" } }, scin); show(scin);
const nim = mk("nimitz"); await U.onUnitClick({ dataset: { uCount: "deck:1" } }, nim); await U.onUnitClick({ dataset: { uCount: "deck:1" } }, nim); show(nim);
const iowa = mk("iowa"); kill(iowa, /калибр.*№2/); show(iowa);
show(mk("sovremenny")); show(mk("sub"));
const tel = mk("tel"); show(tel); const how = mk("howitzer"); await U.onUnitClick({ dataset: { uCount: "guns:-1" } }, how); show(how);
const pz = mk("manpads"); show(pz); await U.onUnitClick({ dataset: { uLaunch: "ambush" } }, pz); show(pz);
// шкалы в конце раунда: растут, у перегрева — только когда решёток нет, отсчёт идёт вниз
combat.combatants = [roos, tarpan, ark, solg, tel, mk("tarpan")].map(a => ({ actor: a, name: a.name }));
await S.advanceScales(combat, 4);
console.log("после раунда:", combat.combatants.map(c => `${c.name}: ${S.scalesOf(c.actor).map(k => `${k}=${S.scaleValue(c.actor, k)}`).join(",")}`).join(" | "));
for (let r = 5; r < 11; r++) await S.advanceScales(combat, r);
console.log("ещё 6 раундов:", combat.combatants.map(c => `${c.name}: ${S.scalesOf(c.actor).map(k => `${k}=${S.scaleValue(c.actor, k)}${S.scaleFull(k, S.scaleValue(c.actor, k)) ? "!" : ""}`).join(",")}`).join(" | "));
console.log("чат:", chat.length, "сообщений;", chat.at(-1)?.match(/<b>[^<]+<\/b>/g)?.slice(0, 2).join(" ") ?? "");
combat.combatants = [];
const html = U.unitHtml(roos);
console.log("разметка Рузвельта:", (html.match(/tb-sys-tile/g) ?? []).length, "плиток,", (html.match(/data-u-sam/g) ?? []).length, "пусков,", (html.match(/data-u-strike/g) ?? []).length, "ударов");
if (process.env.UNIT_HTML) {
  fs.writeFileSync(process.env.UNIT_HTML, [U.unitHtml(mk("roosevelt")), U.unitHtml(tarpan), U.unitHtml(nim), U.unitHtml(tel)].join("\n<!--split-->\n"));
}
