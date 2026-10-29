// Боевые триггеры: состояние кнопок, Поединок «Кодекса», бонусы и запреты в атаке, защита, Break!, «Трёп в эфире»,
// «Прикрываю», «Один на миллион», «Отличная работа!», «Счёт к оплате», «Пощада», «Рядом с тобой», «Задействовать», сброс к вылету.
import { fileURLToPath as __f } from "node:url";
process.argv[2] ??= __f(new URL("..", import.meta.url)).replace(/\/$/, "");
const R = process.argv[2];
const F = class { constructor(...a) { this.a = a; } };
const log = [];
const setp = (o, p, v) => { const ks = p.split("."); let x = o; for (const k of ks.slice(0, -1)) x = (x[k] ??= {}); x[ks.at(-1)] = v; };
let nextPick = null;
const combatFlags = {};
const combatants = [];
const combat = { id: "C1", started: true, round: 2, turn: 0, combatants, getFlag: (s, k) => combatFlags[k], async setFlag(s, k, v) { combatFlags[k] = structuredClone(v); } };
Object.assign(globalThis, {
  foundry: { utils: { deepClone: x => structuredClone(x), mergeObject: Object.assign, getProperty: () => undefined, hasProperty: () => false, setProperty: setp, randomID: () => "r" }, abstract: { TypeDataModel: class {} },
    data: { fields: { NumberField: F, StringField: F, BooleanField: F, SchemaField: F, ArrayField: F, HTMLField: F, ObjectField: F } } },
  CONST: { DOCUMENT_OWNERSHIP_LEVELS: { LIMITED: 1 }, GRID_TYPES: { GRIDLESS: 0 } },
  Hooks: { on() {}, once() {}, callAll() {} }, CONFIG: { sounds: {}, specialStatusEffects: { DEFEATED: "dead" } },
  game: { user: { id: "gm", isGM: true }, users: Object.assign([], { activeGM: { isSelf: true, id: "gm", isGM: true } }), combat, messages: { contents: [] },
    settings: { register() {}, get: () => null, set: async () => {} } },
  ui: { notifications: { warn: m => log.push("WARN " + m), info: m => log.push("INFO " + m) } },
  ChatMessage: { create: async d => { log.push(`CHAT ${d.speaker?.alias ?? "?"}: ${d.content.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()}`); return d; }, getSpeaker: ({ actor }) => ({ alias: actor?.name }) },
  Dialog: class { constructor(o) { this.o = o; } close() { this.o.close?.(); }
    render() {
      const ans = nextPick; nextPick = null;
      const form = { elements: [], addEventListener() {} };
      const btn = { dataset: { pick: ans?.pick }, disabled: false, addEventListener: (e, f) => { btn.f = f; } };
      this.o.render({ querySelector: s => (s === "form" ? form : null), querySelectorAll: s => (s === "[data-pick]" ? [btn] : []) });
      setTimeout(() => (ans ? btn.f({ preventDefault() {} }) : this.close()), 0);
      log.push(`DIALOG ${this.o.title}${ans ? ` → ${ans.pick}` : " → закрыто"}`);
      return this;
    }
    static confirm() { return Promise.resolve(true); } },
  Application: class {}, FormApplication: class {}, Actor: class {}, Item: class {}, Combat: class {}, ActorSheet: class {}
});
globalThis.canvas = { ready: true, grid: { type: 1, size: 100, getOffset: p => ({ i: Math.floor(p.y / 100), j: Math.floor(p.x / 100) }), measurePath: ([a, b]) => ({ spaces: Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) / 100 }) }, scene: null, tokens: { placeables: [] } };

const actors = {};
globalThis.fromUuidSync = u => actors[u.replace("Actor.", "")] ?? null;
const scene = { id: "S", tokens: [] };
canvas.scene = scene;
const mkTrig = (key, name, types = ["General"]) => ({ id: key, type: "trigger", name, system: { key, types, used: false, active: false, stack: 0, text: "" },
  async update(u) { for (const [k, v] of Object.entries(u)) setp(this, k, v); } });
const mk = (id, d, col = 0) => {
  const a = { id, uuid: "Actor." + id, flags: {}, statuses: new Set(), items: [], isOwner: true, ...d,
    getFlag(s, k) { return this.flags[k]; }, async setFlag(s, k, v) { this.flags[k] = structuredClone(v); }, async unsetFlag(s, k) { delete this.flags[k]; },
    async update(u) { for (const [k, v] of Object.entries(u)) { const m = /^flags\.[^.]+\.-=(.+)$/.exec(k); if (m) delete this.flags[m[1]]; else if (k.startsWith("flags.")) this.flags[k.split(".").at(-1)] = v; else setp(this, k, v); } },
    async toggleStatusEffect(st, { active }) { active ? this.statuses.add(st) : this.statuses.delete(st); log.push(`STATUS ${this.name}: ${st} ${active}`); },
    async markDoom(reason, o) { log.push(`DOOM ${this.name} (${reason}) от ${o?.sourceUuid ?? "—"}`); },
    async applyDamage(n, o) { log.push(`DMG ${this.name} ${n}${o?.guard ? " (принял за товарища)" : ""}`); },
    testUserPermission: () => false };
  const t = { name: d.name, actor: a, hidden: false, document: { parent: scene, width: 1, height: 1 }, center: { x: col * 100 + 50, y: 50 } };
  a.getActiveTokens = () => [t];
  a.items.get = i => a.items.find(x => x.id === i);
  actors[id] = a;
  scene.tokens.push(t);
  return a;
};
const sys = (o = {}) => ({ callsign: o.call, skills: { aim: 1, deploy: 1, dodge: 1, lead: 0, push: 1, strafe: 1, ...(o.skills ?? {}) }, twist: false, alt: "med", fee: 0, goals: [],
  markers: { grit: false, structure: false, sys: "", doom: false }, lockUuid: "", ...o.extra });
const pilot = (id, call, triggers, col = 0, o = {}) => mk(id, { type: "pilot", name: call, hasPlayerOwner: true, system: sys({ call, ...o }), items: triggers }, col);
const npc = (id, name, tier, col, extra = {}) => mk(id, { type: "npc", name, system: { kind: "air", tier, side: "enemy", lockUuid: "", markerCount: 0, hp: { value: 3 }, props: [], rules: [], ...extra } }, col);

const knight = pilot("knight", "Рыцарь", [mkTrig("code", "Кодекс", ["Core", "Passive"]), mkTrig("oldschool", "Старая школа", ["Passive"]), mkTrig("gauntlet", "Перчатка брошена", ["Twist"]), mkTrig("wreath", "Венок над морем", ["Death"])], 0);
const merc = pilot("merc", "Наёмник", [mkTrig("finish", "Добить", ["Passive"]), mkTrig("bill", "Счёт к оплате", ["Death"]), mkTrig("mercy", "Пощада"), mkTrig("oldfriends", "Старые знакомые")], 0, { extra: { fee: 1 } });
const techno = pilot("techno", "Техно", [mkTrig("overcharge", "Форсированный выстрел"), mkTrig("bypass", "Обходная цепь"), mkTrig("weakspot", "Уязвимость", ["Twist"]), mkTrig("limiter", "Снять ограничитель")], 1);
const hot = pilot("hot", "Сорвиголова", [mkTrig("fakeout", "Обманный манёвр"), mkTrig("guns", "Огонь из всех стволов", ["Passive"])], 1);
const soldier = pilot("soldier", "Солдат", [mkTrig("rearguard", "Арьергард", ["Twist"]), mkTrig("gotsix", "Прикрываю"), mkTrig("byside", "Рядом с тобой", ["Core", "Passive"]), mkTrig("advevasion", "Продвинутое уклонение", ["Passive"]), mkTrig("divebomb", "Удар с пикирования", ["Passive"])], 1, { skills: { dodge: 3 } });
const border = pilot("border", "Без флага", [mkTrig("nomarks", "Без опознавательных знаков", ["Passive"]), mkTrig("sharedfreq", "Общая частота", ["Passive"]), mkTrig("noborders", "Без границ", ["Core", "Passive"]), mkTrig("notatthis", "Не такой ценой", ["Twist"])], 3);
const chat = pilot("chat", "Болтун", [mkTrig("trash", "Трёп в эфире"), mkTrig("nicejob", "Отличная работа!", ["Passive"]), mkTrig("cutchatter", "Отставить болтовню", ["Twist"])], 3, { skills: { lead: 2 } });
const rookie = pilot("rookie", "Новичок", [mkTrig("million", "Один на миллион"), mkTrig("tellme", "Скажи, что делать", ["Twist"])], 3);
const ace = npc("ace", "Ас Стрикс", "ace", 0, { markerCount: 1 });
const consc = npc("consc", "Конскрипт", "conscript", 0);
const duel = npc("duel", "Дуэлянт", "duelist", 1);
const ship = mk("ship", { type: "npc", name: "Эсминец", system: { kind: "ship", tier: "conscript", side: "enemy", systems: [{ name: "Мостик", occ: 6, value: 3 }, { name: "ЗАК", occ: 5, value: 2 }], props: [], rules: [] } }, 2);
for (const a of [knight, merc, techno, hot, soldier, border, chat, rookie, ace, consc, duel]) combatants.push({ actor: a, id: a.id, actorId: a.id, name: a.name, parent: combat, initiative: 2, f: {}, getFlag(s, k) { return this.f[k]; }, async setFlag(s, k, v) { this.f[k] = structuredClone(v); }, async update(u) { for (const [k, v] of Object.entries(u)) setp(this, k, v); } });
combatFlags.ready = 2;
const turnOf = a => (combat.combatant = combatants.find(x => x.actor === a));
game.actors = Object.values(actors);
const C = await import(R + "/module/combat-triggers.mjs");
const flush = () => new Promise(r => setTimeout(r, 5));
const show = () => { if (log.length) console.log(log.splice(0).join("\n")); };
const parts = r => r.parts.map(p => `${p[0]} ${p[1] > 0 ? "+" : ""}${p[1]}`).join(", ") || "—";

// состояние кнопок
const states = a => a.items.map(t => `${t.name}=${C.ctState(a, t)}`).join(", ");
for (const a of [knight, merc, techno, hot, soldier, border, chat, rookie]) console.log(`${a.name}:`, states(a));
console.log("Обходная цепь без Structure:", C.waitReason(techno, techno.items[1]));

// Поединок «Кодекса»
const duelTxt = (p, f) => JSON.stringify(C.duelBonus(p, f));
console.log("Поединок, раунд чистый:", duelTxt(knight, ace));
combatFlags.ctAtk = [{ by: knight.uuid, t: consc.uuid, r: 2 }];
console.log("уже бил другого в этом раунде:", duelTxt(knight, ace));
combatFlags.ctAtk = [{ by: knight.uuid, t: ace.uuid, r: 2 }, { by: merc.uuid, t: ace.uuid, r: 2 }];
console.log("союзник бьёт ту же цель:", duelTxt(knight, ace));
combatFlags.ctAtk = [{ by: knight.uuid, t: ace.uuid, r: 2 }];
merc.system.lockUuid = ace.uuid;
console.log("союзник держит её в захвате:", duelTxt(knight, ace));
merc.system.lockUuid = "";
console.log("соперник по Поединку:", C.duelFoe(knight)?.name, "· защита Рыцаря от аса:", C.triggerDefense(ace, knight), "· от конскрипта:", C.triggerDefense(consc, knight));
const kg = C.triggerAttack(knight, ace, { rolled: true, skill: "strafe", guns: true });
console.log("Guns Рыцаря по асу:", parts(kg), "· урон +", kg.dmg, "·", kg.notes.join(" "));
knight.items[2].system.active = true;
console.log("Перчатка брошена:", duelTxt(knight, ace));
knight.items[2].system.active = false;
await C.useCombatTrigger(knight, knight.items[0]);
console.log("кодекс нарушен:", duelTxt(knight, ace), "· состояние", C.ctState(knight, knight.items[0]));
knight.items[0].system.used = false;

// бонусы атаки
await merc.setFlag("x", "ctBill", { uuid: ace.uuid, name: "Ас Стрикс" });
console.log("Наёмник по асу с меткой:", parts(C.triggerAttack(merc, ace, { rolled: true, skill: "aim" })), "· по конскрипту:", parts(C.triggerAttack(merc, consc, { rolled: true })));
await soldier.setFlag("x", "ctGuard", { uuid: rookie.uuid, name: "Новичок" });
consc.system.lockUuid = rookie.uuid;
await soldier.setFlag("x", "ctDove", { combat: "C1", round: 2, turn: 0 });
console.log("Солдат по конскрипту, что держит Новичка (Deploy):", parts(C.triggerAttack(soldier, consc, { rolled: true, skill: "deploy" })), "· без броска:", parts(C.triggerAttack(soldier, consc)));
consc.system.lockUuid = "";

// запреты врагам
console.log("конскрипт по Без флага:", C.triggerAttack(consc, border).problems.join(" ") || "можно");
await border.setFlag("x", "ctFired", true);
console.log("после его первой атаки:", C.triggerAttack(consc, border).problems.join(" ") || "можно");
soldier.system.twist = true;
await C.useCombatTrigger(soldier, soldier.items[0]);
console.log("Арьергард: дуэлянт по Новичку:", C.triggerAttack(duel, rookie).problems.join(" ") || "можно", "· ас по Новичку:", C.triggerAttack(ace, rookie).problems.join(" ") || "можно", "· дуэлянт по Солдату:", C.triggerAttack(duel, soldier).problems.join(" ") || "можно");
show();

// «Один на миллион»
await C.useCombatTrigger(rookie, rookie.items[0]);
const mil = C.triggerAttack(rookie, consc, { rolled: true });
console.log("Новичок: попадёт", mil.forceHit, "·", mil.notes.join(" "));
await mil.take();
console.log("после выстрела флаг:", rookie.flags.ctSure ?? "снят", "· кнопка на промахе:", C.millionFor({ attack: true, dc: 7, actorUuid: rookie.uuid })?.name ?? "нет (использован)");
show();

// «Уязвимость»: защита −2 для эскадрильи, у корабля — названная система
techno.system.twist = true;
nextPick = { pick: "1" };
const origPick = C.useCombatTrigger;
await ace.setFlag("x", "ctWeak", { all: true, by: "Техно" });
await ship.setFlag("x", "ctWeak", { sys: 1, name: "ЗАК", by: "Техно" });
nextPick = null;
console.log("Уязвимость: защита аса для Рыцаря", C.triggerDefense(knight, ace), "· для конскрипта", C.triggerDefense(consc, ace), "· ЗАК эсминца", C.weakOf(knight, ship, 1), "· мостик", C.weakOf(knight, ship, 0));

// Break!: «Продвинутое уклонение», «Общая частота», «Скажи, что делать»
game.messages.contents = [{ getFlag: () => ({ delayed: true, combatKey: "C1:2", targetUuid: soldier.uuid }) }];
await soldier.setFlag("x", "ctAdvEv", { combat: "C1", round: 2, turn: 0 });
const br = C.triggerBreak(soldier);
console.log("Break! Солдата под ракетой:", parts(br));
await br.take();
console.log("частота в этом раунде:", JSON.stringify(combatFlags.ctFreq), "· второй Break!:", parts(C.triggerBreak(soldier)));
rookie.system.twist = true;
console.log("Скажи, что делать:", JSON.stringify(C.tellMe(rookie, [{ label: "Lead Болтун", value: 2 }])), "· без Lead:", JSON.stringify(C.tellMe(rookie, [{ label: "Perk от Грозы", value: 1 }])));

// «Трёп в эфире»
console.log("Complication 1–2 у конскрипта до трёпа:", C.trashComp(consc));
turnOf(chat);
await C.useCombatTrigger(chat, chat.items[0]);
console.log("после трёпа:", C.trashComp(consc), "· у союзника:", C.trashComp(rookie), "· чип:", C.ctView(chat, chat.items[0]).chip);
combat.round = 4;
console.log("через раунд без трёпа:", C.trashComp(consc));
combat.round = 2;
show();

// «Прикрываю»: навык союзника, пока в одной зоне
await hot.setFlag("x", "ctCover", { uuid: soldier.uuid, skill: "dodge", label: "Прикрываю" });
console.log("Сорвиголова Dodge рядом с Солдатом:", JSON.stringify(C.coverPart(hot, "dodge")), "· Aim:", JSON.stringify(C.coverPart(hot, "aim")));

// «Обходная цепь»
techno.system.markers = { grit: false, structure: true, sys: "ms", doom: false };
turnOf(techno);
await C.useCombatTrigger(techno, techno.items[1]);
console.log("Обходная цепь:", techno.flags.ctBypass, "· снова:", C.ctState(techno, techno.items[1]));
show();

// «Отличная работа!» и «Счёт к оплате»
await C.afterKill(consc, knight);
console.log("бонус Рыцарю:", JSON.stringify(knight.flags.next));
await C.billPaid(ace);
console.log("Гонорар Наёмника:", merc.system.fee, "· виновный:", merc.flags.ctBill ?? "снят");
show();

// «Пощада» и «Рядом с тобой»
nextPick = { pick: "spare" };
console.log("Пощада для аса:", await C.offerMercy(ace, merc.uuid), "· снова:", await C.offerMercy(duel, merc.uuid));
show();
nextPick = { pick: "take" };
console.log("Новичку 5 урона, Солдат рядом?", C.guardOf(rookie)?.name ?? "нет");
soldier.getActiveTokens()[0].center = { x: 350, y: 50 };
console.log("Солдат в зоне Новичка:", C.guardOf(rookie)?.name, "· принял:", await C.offerGuard(rookie, 5, { source: "Ас" }));
await flush();
show();
console.log("Обманный манёвр готов:", C.fakeoutReady(hot)?.name, "· при принятом ударе:", C.fakeoutReady(hot, { guard: true }) ?? "нет");

// сброс к вылету
await C.resetCombatTriggers(soldier);
console.log("после сброса у Солдата (выбор «Рядом с тобой» остаётся):", Object.keys(soldier.flags).join(", "));
