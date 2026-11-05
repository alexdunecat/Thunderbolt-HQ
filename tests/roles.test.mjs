// Запуск: node tests/run.mjs (сверяет вывод со снимком в tests/snapshots)
import { fileURLToPath as __f } from "node:url";
import { tmpdir as __tmp } from "node:os";
process.argv[2] ??= __f(new URL("..", import.meta.url)).replace(/\/$/, "");
process.argv[3] ??= __tmp() + "/tb-test-out";
const R = process.argv[2];
const F = class { constructor(...a) { this.a = a; } };
const hooks = {};
const log = [];
const msgs = [];
const answers = {};
let dialogs = 0;
const get = (o, p) => p.split(".").reduce((x, k) => x?.[k], o);
const setp = (o, p, v) => { const ks = p.split("."); let x = o; for (const k of ks.slice(0, -1)) x = (x[k] ??= {}); x[ks.at(-1)] = v; };
const expand = ch => { const o = {}; for (const [k, v] of Object.entries(ch)) setp(o, k, v); return o; };
const merge = (a, b) => { for (const [k, v] of Object.entries(b)) { if (v && typeof v === "object" && !Array.isArray(v)) merge(a[k] ??= {}, v); else a[k] = v; } return a; };
class Coll extends Map { [Symbol.iterator]() { return this.values(); } get size() { return super.size; } }
class Combat {
  constructor() { this.id = "C1"; this.round = 0; this.turn = 0; this.flags = {}; this.combatants = new Coll(); }
  get started() { return this.round > 0; }
  get turns() { return [...this.combatants.values()].sort((a, b) => this._sortCombatants(a, b)); }
  get combatant() { return this.turns[this.turn]; }
  getFlag(s, k) { return this.flags[s]?.[k]; }
  async setFlag(s, k, v) { return this.update({ [`flags.${s}.${k}`]: v }); }
  async update(ch, opts = {}) { const e = expand(ch); merge(this, e); for (const f of hooks.updateCombat ?? []) await f(this, e, opts); return this; }
  async updateEmbeddedDocuments(t, ups) { for (const u of ups) { const c = this.combatants.get(u._id); const { _id, ...rest } = u; Object.assign(c, rest); for (const f of hooks.updateCombatant ?? []) f(c, rest); } }
  async startCombat() { return this.update({ round: 1, turn: 0 }); }
  async nextRound() { return this.update({ round: this.round + 1, turn: 0 }, { direction: 1 }); }
  async nextTurn() { if (this.turn + 1 >= this.combatants.size) return this.nextRound(); return this.update({ turn: this.turn + 1 }, { direction: 1 }); }
  async _preDelete() {}
}
Map.prototype.filter = function (f) { return [...this.values()].filter(f); };
Map.prototype.map = function (f) { return [...this.values()].map(f); };
Map.prototype.some = function (f) { return [...this.values()].some(f); };
Map.prototype.find = function (f) { return [...this.values()].find(f); };
Object.assign(Number, { isNumeric: v => typeof v === "number" && !Number.isNaN(v) });
const users = [{ id: "gm", isGM: true, active: true }, { id: "pl", isGM: false, active: true }];
users.find = Array.prototype.find; users.activeGM = users[0];
Object.assign(globalThis, {
  foundry: { data: { fields: { NumberField: F, StringField: F, BooleanField: F, SchemaField: F, ArrayField: F, HTMLField: F, ObjectField: F } },
    abstract: { TypeDataModel: class {} }, utils: { mergeObject: merge, hasProperty: (o, p) => get(o, p) !== undefined, getProperty: get, deepClone: x => structuredClone(x) } },
  Combat, Actor: class {}, Item: class {},
  Dialog: class { constructor(o) { this.o = o; } render() { dialogs++; const names = [...this.o.content.matchAll(/name="([^"]+)"/g)].map(m => m[1]);
    const form = { elements: names.map(n => ({ name: n, type: "select", value: String(answers[n] ?? 2) })) };
    log.push("DIALOG " + this.o.title + " for " + names.join(","));
    setTimeout(() => this.o.buttons.ok.callback([{ querySelector: () => form }]), 0); return this; } },
  Hooks: { on: (n, f) => (hooks[n] ??= []).push(f), once() {}, callAll() {} },
  ChatMessage: { updateDocuments: async list => { for (const { _id, ...u } of list) await msgs.find(m => m.id === _id)?.update(u); }, create: async d => { const m = { ...d, id: "m" + msgs.length, getFlag: (s, k) => d.flags?.[s]?.[k], async update(u) { for (const [k, v] of Object.entries(u)) if (k.startsWith("flags.")) setp(d, k, v); } }; msgs.push(m); log.push("CHAT " + (d.content.match(/tb-card-what">([^<]*)/)?.[1] ?? "") + " | " + d.content.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 160)); return m; }, getSpeaker: () => ({}) },
  game: { user: users[0], users, messages: { get contents() { return msgs; } }, settings: { get: () => null }, combat: null },
  ui: { notifications: { info: m => log.push("info " + m), warn: m => log.push("warn " + m) } },
  CONFIG: { sounds: {} },
});
// роли машин, фирменные приёмы и свойства (Стрэйнджриал 8.4–8.6)
globalThis.CONST = { GRID_TYPES: { GRIDLESS: 0 } };
CONFIG.specialStatusEffects = { DEFEATED: "dead" };
const { TB, roleOf, moveOf, moveReady, hasProp } = await import(R + "/module/config.mjs");
const elev = TB.altElevation;
const docs = [], actors = {};
const scene = { grid: { size: 100 }, tokens: docs, getFlag: () => null };
const mk = (name, col, row, alt, sys = {}, type = "npc", flags = {}) => {
  const a = { name, uuid: "Actor." + name, type, isToken: false, isOwner: true, statuses: new Set(), items: [], flags: { "thunderbolt-shtab": flags },
    system: { kind: "air", side: "enemy", speed: 2, maxSpeed: 4, evasion: 3, breakEv: null, stats: { ev: 3 }, hp: { value: 3, max: 3 }, props: [], ...sys },
    getFlag(s, k) { return this.flags[s]?.[k]; }, async setFlag(s, k, v) { this.flags[s][k] = v; log.push(`FLAG ${name} ${k}=${JSON.stringify(v)}`); },
    async update(u) { log.push(`UPDATE ${name} ${JSON.stringify(u)}`); for (const [k, v] of Object.entries(u)) if (k.startsWith("system.")) setp(this, k, v); },
    testUserPermission: () => false, async applyDamage(n, o) { log.push(`DAMAGE ${name} ${n} src=${o.source}`); } };
  const doc = { name, actor: a, x: col * 100, y: row * 100, width: 1, height: 1, elevation: alt === "ground" ? 0 : elev[alt], parent: scene, hidden: false };
  const tok = { name, actor: a, document: doc, center: { x: col * 100 + 50, y: row * 100 + 50 } };
  doc.object = tok; a.getActiveTokens = () => [tok];
  docs.push(doc); actors[a.uuid] = a; return a;
};
const pilot = (name, key, col, row, alt, sys = {}, flags = {}) => mk(name, col, row, alt, { side: "player", plane: { system: { key } }, planeProps: new Set(sys.propKeys ?? []), ...sys }, "pilot", flags);
globalThis.fromUuidSync = u => actors[u];
globalThis.fromUuid = async u => actors[u];
globalThis.canvas = { ready: true, scene, grid: { type: 1, size: 100, getOffset: p => ({ i: Math.floor(p.y / 100), j: Math.floor(p.x / 100) }) },
  get tokens() { return { placeables: docs.map(d => d.object) }; } };
game.scenes = { viewed: scene };
const Rm = await import(R + "/module/dice/rolls.mjs");
const A = await import(R + "/module/actions.mjs");
const S = await import(R + "/module/scene.mjs");

// роли и приёмы: у пилота по машине, у NPC только у аса
const su35 = pilot("Гроза", "su35", 2, 2, "low");
const ace = mk("Феникс-1", 6, 6, "high", { key: "f14a", tier: "ace" });
const consc = mk("Конскрипт", 7, 7, "high", { key: "f14a", tier: "conscript" });
console.log("роли:", roleOf(su35), moveOf(su35), "·", roleOf(ace), moveOf(ace), "·", roleOf(consc) || "—", moveOf(consc) || "—", "· книга fa:", TB.roleOf.fa, "gs:", TB.roleOf.gs ?? "—");
console.log("приёмов:", Object.keys(TB.planeMoves).length, "машин с приёмом:", Object.keys(TB.moveOf).length, "· ролей у машин:", Object.keys(TB.roleOf).length);

// High Speed и сверхзвук: Move на 2 зоны, скорость заодно
const hs = pilot("Ястреб", "mig31", 0, 0, "med", { propKeys: ["highspeed"], speed: 3, maxSpeed: 5 });
const sc = pilot("Тайфун", "typhoon", 0, 1, "med", { propKeys: ["supercruise"], speed: 4, maxSpeed: 4 });
const slow = pilot("Медленный", "mig31", 0, 2, "med", { propKeys: ["highspeed"], speed: 3, maxSpeed: 4 });
console.log("2 зоны:", JSON.stringify(A.twoZones(hs)), JSON.stringify(A.twoZones(sc)), JSON.stringify(A.twoZones(slow)));

// «Универсал»: Improved с большим из Aim и Deploy; «Штурмовой заход»
const multi = pilot("Многоцелевой", "su30", 1, 1, "low", { skillTotal: { aim: 1, deploy: 3 }, skillBlocked: {} });
const plain = pilot("Простой", "su27", 1, 1, "low", { skillTotal: { aim: 1, deploy: 3 }, skillBlocked: {} });
console.log("Improved по воздуху:", Rm.foxSkill(multi, true), Rm.foxSkill(plain, true));
const su25 = pilot("Грач", "su25", 3, 3, "low");
const tank = mk("Танк", 3, 3, "ground", { kind: "ground", grp: "armor", defense: 5 });
const samFar = mk("ЗРК", 4, 3, "ground", { kind: "ground", grp: "ad", defense: 5 });
const tD = a => Rm.describeTarget(a, a.name);
console.log("Штурмовой заход:", Rm.casRun(su25, tD(tank)), Rm.casRun(su25, tD(samFar)), Rm.casRun(plain, tD(tank)));
const f4g = pilot("Ласка", "f4g", 3, 3, "low", { propKeys: ["sead"] });
console.log("Подавление ПВО:", JSON.stringify(Rm.seadPart(f4g, tD(samFar))), JSON.stringify(Rm.seadPart(f4g, tD(tank))));

// «Прицельный комплекс»: с Высокой по земле ракетами можно, пушкой нельзя
const su24 = pilot("Бомбер", "su24", 3, 2, "high");
console.log("бомбер с Высокой:", S.reachProblems(su24, tD(tank), 2, { strike: true }).problems.join(" ") || "можно", "· пушкой:", S.reachProblems(su24, tD(tank), 0).problems.join(" "));

// Малозаметность и РЭБ: захват только из той же зоны; РЭБ +1 к защите
const f22 = mk("Раптор", 5, 5, "med", { props: [{ key: "stealth" }] });
const growler = mk("Гроулер", 6, 5, "med", { props: [{ key: "ecm" }] });
const wing = mk("Ведомый", 6, 5, "med");
console.log("стелс:", S.sameZoneLock(f22) ? "только своя зона" : "можно", "· под РЭБ:", S.sameZoneLock(wing) ? "только своя зона" : "можно",
  "· защита под РЭБ:", S.defenseWithWeather(wing, { ev: 0 }), "без:", S.defenseWithWeather(consc, { ev: 0 }));

// залп конца раунда: кобра, вираж, 104:0
game.combat = { id: "C1", round: 1, started: true };
const cobra = mk("Кобра", 8, 0, "med", { key: "su35", tier: "ace" }, "npc", { cobra: "C1:1" });
const lightP = pilot("Вираж", "mig29a", 2, 5, "med");
const shooter = mk("МиГ", 3, 5, "med");
const f15 = pilot("Игл", "f15c", 0, 5, "med");
const bandit = mk("Бандит", 1, 5, "med", { speed: 2, evasion: 3 });  // защита 5
const missile = (tgt, total, who) => msgs.push({ flags: { "thunderbolt-shtab": { card: { type: "attack", attack: true, rolled: true, d10: total, strain: 0, delayed: true, combatKey: "C1:1", targetUuid: tgt.uuid, targetName: tgt.name, parts: [], dmg: 5, actorName: who.name, actorUuid: who.uuid, tkind: "air" } } },
  getFlag(s, k) { return this.flags[s]?.[k]; }, async update(u) { for (const [k, v] of Object.entries(u)) if (k.startsWith("flags.")) setp(this, k, v); } });
missile(cobra, 9, su35); missile(lightP, 1, shooter); missile(bandit, 3, f15);
const m = await Rm.resolveVolley({ id: "C1" }, { round: 1 });
const card = m.flags["thunderbolt-shtab"].card;
console.log("залп:", JSON.stringify(card.targets.map(t => [t.name, t.hit, t.cobra ?? false, t.ace?.name ?? null])), "· вираж:", JSON.stringify(card.turns));
console.log(log.filter(l => /UPDATE Вираж|DAMAGE/.test(l)).join("\n"));

// сверка с книгой (0.6.3): с Низкой по воздуху только по Низкой; станция помех; палуба; атаки бомбардировщиков NPC
const lowP = pilot("Низкий", "su27", 10, 0, "low");
const medB = mk("Средний", 10, 0, "med");
const lowB = mk("Низкий-враг", 10, 0, "low");
console.log("с Низкой:", S.reachProblems(lowP, tD(medB), 1).problems.join(" ") || "можно", "· по Низкой:", S.reachProblems(lowP, tD(lowB), 1).problems.join(" ") || "можно");
const jam = mk("Помехи", 12, 0, "ground", { kind: "ground", props: [{ key: "jammer" }] });
const under = mk("Под помехами", 12, 0, "med");
const over = mk("Над помехами", 12, 0, "high");
console.log("помехи:", S.jammerCover(under) || "нет", "/", S.jammerCover(over) || "нет", "· защита:", S.defenseWithWeather(under, { ev: 0 }), "против", S.defenseWithWeather(over, { ev: 0 }), "· захват:", S.sameZoneLock(under) ? "только своя зона" : "можно");
const PR = await import(R + "/module/plane-roles.mjs");
game.combat = { id: "C1", round: 1, started: true, combatants: [], getFlag: () => null };
const cv = mk("Авианосец", 14, 0, "ground", { kind: "ship", side: "ally", props: [{ key: "carrierdeck" }], systems: [{ name: "Палуба", value: 5, hp: 5 }] });
const navy = pilot("Палубник", "f18", 14, 0, "low", { plane: { system: { key: "f18", carrier: true } } });
const navyHigh = pilot("Высокий палубник", "f18", 14, 0, "high", { plane: { system: { key: "f18", carrier: true } } });
const land = pilot("Сухопутный", "su27", 14, 0, "low");
console.log("палуба:", JSON.stringify(PR.deckState(navy)), "· высоко:", PR.deckState(navyHigh)?.near, "· не палубный:", PR.deckState(land));
const b52 = mk("Бомбардировщик", 16, 0, "med", { side: "enemy", ag: 10, speed: 2, props: [{ key: "carpet" }, { key: "tailgun" }] });
const g1 = mk("Склад", 16, 0, "ground", { kind: "ground", side: "ally", defense: 4 });
const g2 = mk("Бункер", 16, 0, "ground", { kind: "ground", side: "ally", defense: 9 });
const g3 = mk("Далёкий", 17, 0, "ground", { kind: "ground", side: "ally", defense: 4 });
console.log("бомбардировщик в HUD:", JSON.stringify(PR.hudPlane(b52)?.attacks.map(x => x.act)), JSON.stringify(PR.hudPlane(b52)?.lamps.map(x => x.text)));
const create0 = ChatMessage.create;
ChatMessage.create = async d => Object.assign(await create0(d), { canUserModify: () => true });
const cm = await Rm.fireCarpet(b52);
const cc = cm?.flags?.["thunderbolt-shtab"]?.card;
console.log("ковёр:", cc?.dmg, JSON.stringify(cc?.line.map(r => [r.name, r.vs, r.applied ?? false])));

// FFR-31MR/D Super Sylph: «Z.O.E.» (заявка 3 действия с местом 1, проверка как 10, Strain экипажа до 0) и «Тактический разведчик»
{
  const Sy = await import(R + "/module/sylph.mjs");
  const DP = await import(R + "/module/declare-pick.mjs");
  const sy = pilot("Сильф", "sylph", 20, 0, "med", { propKeys: ["wso", "supercruise", "recon"], wso: "Штурман", strain: { value: 6, max: 10 } });
  const nav = pilot("Штурман", "sylph", 30, 9, "med", { strain: { value: 4, max: 10 } });
  for (const a of [sy, nav]) {
    a.unsetFlag = async (s, k) => { delete a.flags[s][k]; log.push(`UNSET ${a.name} ${k}`); };
    const up = a.update; a.update = async u => { for (const [k, v] of Object.entries(u)) if (k.startsWith("flags.")) setp(a, k, v); return up.call(a, u); };
  }
  game.actors = [sy, nav];
  const cS = { id: "cS", name: "Сильф", actor: sy, initiative: 1, tokenId: null, getFlag: () => null };
  const zc = { id: "C9", round: 2, started: true, combatants: [cS], getFlag: () => 2, combatant: cS };
  cS.parent = zc; game.combat = zc;
  console.log("Сильф:", roleOf(sy), moveOf(sy), "· плитка Z.O.E.:", Sy.zoeOffer(cS), "· заявлено до:", A.declaredOf(cS));
  const html = DP.declarePickHtml({ round: 2, rows: [{ id: "cS", name: "Сильф", plane: "Super Sylph", wso: true, zoe: true }], foes: [{ name: "Бандит", v: 1 }], mates: [] });
  console.log("стекло:", (html.match(/data-n="\d+"/g) ?? []).join(" "), "·", html.includes("Z.O.E.") ? "плитка есть" : "плитки нет");
  log.length = 0;
  await Sy.declareZoe(cS);
  console.log("после заявки:", A.declaredOf(cS), "действий · приём потрачен:", !moveReady(sy), "·", log.filter(l => l.startsWith("CHAT")).join(" "));
  log.length = 0;
  await Sy.finishZoe(sy);
  console.log("конец хода:", sy.system.strain.value, nav.system.strain.value, "·", log.filter(l => /^CHAT|^UNSET/.test(l)).join(" | "));
  const aceS = mk("Сильф-ас", 21, 0, "med", { key: "sylph", tier: "ace", hp: { value: 3, max: 3 } });
  console.log("ас включает:", Sy.zoeWanted(aceS), Sy.zoeWanted(aceS, { locked: true }), Sy.zoeWanted(mk("Сильф-ас-2", 21, 0, "med", { key: "sylph", tier: "ace", hp: { value: 1, max: 3 } })));
  // разведчик: контакты «?» не дальше 2 зон, в начале своего хода
  const unk = (name, col) => { const a = mk(name, col, 0, "med"); const d = docs.at(-1); d.flags = { "thunderbolt-shtab": { unknown: { n: col } } }; d.getFlag = (s, k) => d.flags[s]?.[k]; return a; };
  unk("Контакт 22", 22); unk("Контакт 25", 25);
  const near = Sy.reconTargets(sy).map(t => t.name);
  cS.getFlag = () => ({ round: 2, used: 0, list: [] });
  console.log("разведчик:", JSON.stringify(near), JSON.stringify(Sy.reconState(sy, near.length)), "· без контактов:", Sy.reconState(sy, 0).why, "· у другой машины:", Sy.reconState(su35, 1));
}

// XFA-27: «Перекладка крыла» (Speed любая без действия, Evasion +1 до конца раунда), ас на автопилоте
{
  const M = await import(R + "/module/config.mjs");
  const zc = { id: "C10", round: 4, started: true, combatants: [], getFlag: () => null };
  game.combat = zc;
  const xf = pilot("Феникс", "xfa27", 40, 0, "med", { speed: 2, maxSpeed: 5 });
  const up = xf.update; xf.update = async (u, o) => { for (const [k, v] of Object.entries(u)) if (k.startsWith("flags.")) setp(xf, k, v); return up.call(xf, u, o); };
  console.log("XFA-27:", roleOf(xf), moveOf(xf), "· кнопка:", JSON.stringify(PR.moveState(xf)), "· лампа до:", JSON.stringify(PR.hudPlane(xf)?.lamps.find(l => l.text === "КРЫЛО +1")?.on ?? null));
  log.length = 0;
  await PR.sweepTo(xf, 1);
  console.log("перекладка:", xf.system.speed, "· раунд:", M.sweepActive(xf), "· приём потрачен:", !moveReady(xf), "· лампа:", PR.hudPlane(xf)?.lamps.find(l => l.text === "КРЫЛО +1")?.on, "·", log.filter(l => l.startsWith("CHAT")).join(" "));
  zc.round = 5;
  console.log("следующий раунд:", M.sweepActive(xf));
  const ax = mk("XFA-ас", 42, 0, "med", { key: "xfa27", tier: "ace", speed: 2, maxSpeed: 5 });
  ax.flags["thunderbolt-shtab"] = {};
  const hunter = mk("Охотник", 42, 1, "med", { lockUuid: ax.uuid });
  const axTok = docs.find(d => d.actor === ax).object;
  console.log("ас на захвате:", await PR.autoSweep(ax, axTok), "· второй раз:", await PR.autoSweep(ax, axTok));
}

// вторая партия: «Мысленное наведение» («Файрфокс»), «Свечка» (Mave), «Фоторазведка» (U-2S, SR-71), потолки
{
  const M = await import(R + "/module/config.mjs");
  const Sc = await import(R + "/module/scout.mjs");
  const zc = { id: "C11", round: 2, started: true, combatants: [], getFlag: () => null };
  game.combat = zc;
  const ff = pilot("Ганц", "firefox", 50, 0, "med");
  const mv = pilot("Сова", "mave", 52, 0, "high", { speed: 1 });
  mv.flags["thunderbolt-shtab"] = {};
  const up = mv.update; mv.update = async (u, o) => { for (const [k, v] of Object.entries(u)) if (k.startsWith("flags.")) setp(mv, k, v); return up.call(mv, u, o); };
  const near = mk("Близкий", 51, 0, "med"), far = mk("Дальний", 53, 0, "med"), tankX = mk("Танк-X", 50, 0, "ground", { kind: "ground", grp: "armor" });
  const tk = a => docs.find(d => d.actor === a).object;
  console.log("Файрфокс:", roleOf(ff), moveOf(ff), "· Mave:", roleOf(mv), moveOf(mv));
  console.log("мысленное наведение:", JSON.stringify([near, far, tankX].map(a => PR.mindProblem(ff, tk(a)) || "можно")));
  log.length = 0;
  await PR.zoomClimb(mv, "strat");
  console.log("свечка:", mv.system.alt ?? "—", "· не захватить:", M.zoomActive(mv), "· приём потрачен:", !moveReady(mv), "·", log.filter(l => l.startsWith("CHAT")).join(" "));
  zc.round = 3;
  console.log("следующий раунд:", M.zoomActive(mv));
  console.log("потолки:", ["sylph", "xfa27", "pakda", "firefox", "mave", "vva14", "u2", "sr71"].map(k => `${k}=${TB.maxAlt[k]}`).join(" "));
  const u2 = mk("U-2S", 60, 3, "strat", { props: [{ key: "scout" }] }), sr = mk("SR-71", 61, 3, "high", { props: [{ key: "scout" }, { key: "highspeed" }] });
  const shot = mk("Сбитый разведчик", 62, 3, "high", { props: [{ key: "scout" }] }); shot.statuses.add("dead");
  const aloft = Sc.scoutsAloft([u2, sr, shot, near].map(tk), a => a.system.kind === "air");
  console.log("фоторазведка:", aloft.map(t => t.name).join(", "), "·", Sc.scoutLine(aloft.map(t => t.name)).replace(/<[^>]+>/g, ""));
  console.log("к краю:", JSON.stringify(Sc.edgeCell([3, 5], { c0: 0, r0: 0, c1: 9, r1: 7 })), JSON.stringify(Sc.edgeCell([8, 3], { c0: 0, r0: 0, c1: 9, r1: 7 })));
}
