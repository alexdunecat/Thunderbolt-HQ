// Запуск: node tests/run.mjs (сверяет вывод со снимком в tests/snapshots)
import { fileURLToPath as __f } from "node:url";
process.argv[2] ??= __f(new URL("..", import.meta.url)).replace(/\/$/, "");
const root = process.argv[2];
const hooks = {}, played = [], settings = { soundVolume: 70, soundGM: false };
globalThis.Hooks = { on: (n, f) => (hooks[n] ??= []).push(f), once: (n, f) => (hooks[n] ??= []).push(f) };
let now = 0; Date.now = () => now;
globalThis.CONFIG = {};
globalThis.foundry = { utils: { getProperty: (o, p) => p.split(".").reduce((x, k) => x?.[k], o) }, audio: { AudioHelper: { play: d => played.push(`${d.src.split("/").pop()} @${d.volume}`) } } };
globalThis.game = { socket: { emit: (c, m) => emitted.push(m.key), on() {} }, combat: { started: true }, user: { isGM: false }, settings: { register: (s, k, o) => { if (!(k in settings)) settings[k] = o.default; }, get: (s, k) => settings[k] } };
const actors = {};
const mk = (uuid, type, isOwner) => (actors[uuid] = { uuid, type, isOwner });
const me = mk("Actor.me", "pilot", true), mate = mk("Actor.mate", "pilot", false), mig = mk("Actor.mig", "npc", true);
const npcSys = (side, priority, rules = []) => ({ side, priority, kind: "ground", props: [], rules: rules.map(key => ({ key })) });
const convoy = Object.assign(mk("Actor.convoy", "npc", false), { system: npcSys("ally", true) });
const liner = Object.assign(mk("Actor.liner", "npc", false), { system: npcSys("neutral", true, ["civilian"]) });
const plant = Object.assign(mk("Actor.plant", "npc", false), { system: npcSys("enemy", true) });
const truck = Object.assign(mk("Actor.truck", "npc", false), { system: npcSys("ally", false) });
const emitted = [];
globalThis.fromUuidSync = u => actors[u] ?? null;
const S = await import(`${root}/module/sounds.mjs`);
S.registerSounds();
const msg = f => ({ getFlag: (s, k) => f[k] });
const fire = (name, ...a) => { hooks[name].forEach(f => f(...a)); const out = played.splice(0); console.log(`${name}: ${out.join(", ") || "тишина"}`); now += 2000; };
console.log("сигналы:", Object.keys(S.COCKPIT_SOUNDS).map(k => `${k}=${S.SRC(k).split("/").pop()}`).join(" "));
fire("createChatMessage", msg({ rwr: { fromUuid: me.uuid, target: mig.uuid } }));      // свой захват
fire("createChatMessage", msg({ rwr: { fromUuid: mig.uuid, target: me.uuid } }));      // облучение
fire("createChatMessage", msg({ rwr: { fromUuid: mig.uuid, target: mate.uuid } }));    // захватили чужого пилота — не слышно
fire("createChatMessage", msg({ card: { maws: true, targetUuid: me.uuid } }));         // ракета
fire("createActiveEffect", { statuses: new Set(["stall"]), parent: me });
fire("createActiveEffect", { statuses: new Set(["stall"]), parent: mig });             // NPC — молчит
fire("updateActor", me, { system: { alt: "low" } });
fire("updateActor", me, { system: { alt: "med" } });
hooks.updateActor[0](me, { system: { alt: "low" } }); fire("updateActor", me, { system: { alt: "low" } }); // повтор сразу — один раз
game.combat = null; fire("updateActor", me, { system: { alt: "low" } }); game.combat = { started: true }; // вне боя — молчит
// кончилось спецоружие: последний заряд у своего пилота
fire("updateItem", { type: "weapon", parent: me }, { system: { ammo: { value: 0 } } });
fire("updateItem", { type: "weapon", parent: me }, { system: { ammo: { value: 2 } } });   // ещё есть — молчит
fire("updateItem", { type: "weapon", parent: mate }, { system: { ammo: { value: 0 } } }); // чужой пилот — не слышно
settings.soundVolume = 0;
fire("createChatMessage", msg({ card: { maws: true, targetUuid: me.uuid } }));         // громкость 0
settings.soundVolume = 50; game.user.isGM = true;
fire("createChatMessage", msg({ card: { maws: true, targetUuid: me.uuid } }));         // ведущий не слышит
settings.soundGM = true; mate.isOwner = true; // у ведущего все пилоты свои
fire("createChatMessage", msg({ card: { maws: true, targetUuid: mate.uuid } }));       // ведущий с галочкой слышит
// свой пуск и пушка: слышит стрелок
settings.soundGM = false; game.user.isGM = false; mate.isOwner = false;
fire("createChatMessage", msg({ card: { attack: true, actorUuid: me.uuid, targetUuid: mig.uuid } }));
fire("createChatMessage", msg({ card: { attack: true, instant: true, actorUuid: me.uuid, targetUuid: mig.uuid } }));
fire("createChatMessage", msg({ card: { attack: true, actorUuid: mate.uuid, targetUuid: mig.uuid } }));   // чужой пуск — не слышно
fire("createChatMessage", msg({ card: { attack: true, actorUuid: mig.uuid, targetUuid: mate.uuid } }));   // пуск NPC — не слышно
// тревога по приоритетной цели: у всех, плюс рассылка остальным
for (const a of [convoy, liner, plant, truck]) { const ok = S.priorityAlarm(a); console.log(`тревога ${a.uuid}: ${ok ? played.splice(0).join(", ") : "нет"} | разослано: ${emitted.splice(0).join(",") || "—"}`); now += 2000; }
// итог миссии: общий звук у всех, и у ведущего
game.user.isGM = true; S.cueAll("missionWin"); now += 2000; S.cueAll("missionFail");
console.log("итог миссии:", played.splice(0).join(", "));

// новые звуки: ход пилота, ловушки, взрывы залпа и бомбы, удары и выстрелы супероружия, кнопки
settings.soundVolume = 70; settings.soundMute = {}; game.user.isGM = false; Math.random = () => 0;
now += 5000;
const cmb = { started: true, round: 2, combatant: { actor: me }, getFlag: () => 2 };
fire("updateCombat", cmb, { turn: 1 });
cmb.combatant = { actor: mate }; fire("updateCombat", cmb, { turn: 2 });   // чужой пилот — не слышно
fire("createChatMessage", msg({ card: { type: "break", actorUuid: me.uuid } }));
fire("createChatMessage", msg({ card: { type: "volley", targets: [{ hit: true, uuid: plant.uuid }, { hit: true, uuid: plant.uuid, bomb: true }] } }));
fire("createChatMessage", msg({ card: { type: "volley", targets: [{ hit: true, uuid: convoy.uuid }, { hit: false, uuid: plant.uuid }] } }));   // по своим и мимо — тишина
fire("createChatMessage", msg({ card: { type: "strike", label: "Рельсотронный залп" } }));
fire("createChatMessage", msg({ card: { type: "strike", label: "Противоспутниковый лазер" } }));
fire("createChatMessage", msg({ card: { type: "strike", label: "Шрапнельные ракеты" } }));
// выстрел при пуске удара: рейлган, лазер или ничего (взрыв — в конце раунда)
console.log("выстрел при пуске:", ["Рельсотрон", "Рельсотронный залп", "Противоспутниковый лазер", "Рельсотроны №2", "Шрапнельные ракеты", "Удар SOLG с орбиты", "Взрыв реактора"].map(l => `${l}=${S.shotOf(l) ?? "—"}`).join(", "));
emitted.length = 0; S.cueEveryone("railgun"); console.log("пуск рельсотрона:", played.splice(0).join(", "), "| разослано:", emitted.splice(0).join(",")); now += 2000;
mig.system = npcSys("enemy", false);
fire("createChatMessage", msg({ card: { attack: true, actorUuid: mig.uuid, label: "Луч: Лазерная турель на спине" } }));
fire("createChatMessage", msg({ card: { attack: true, actorUuid: mig.uuid, label: "Луч: Энергетические орудия (HPBC) №1" } }));   // лучи «Рузвельта» — тоже лазер
settings.soundMute = { boom: true };
fire("createChatMessage", msg({ card: { type: "volley", targets: [{ hit: true, uuid: plant.uuid }] } }));   // выключен у себя — тишина
const el = (sel, inside) => ({ closest: s => (s.split(", ").some(x => sel.includes(x.replace(/^\./, "").replace(/^#/, ""))) || (inside && s.includes(inside)) ? el(sel, inside) : null), matches: s => s.split(", ").some(x => sel.includes(x.replace(/^\./, ""))), disabled: false });
console.log("кнопки:", S.uiSoundFor({ closest: s => s.startsWith("button") ? { closest: q => (q.includes(".thunderbolt") ? {} : null), matches: () => false } : null }),
  S.uiSoundFor({ closest: s => s.startsWith("button") ? { closest: q => (q.includes(".thunderbolt") || q.includes(".tb-hud-wpns") || q === "#tb-pilot-hud" ? {} : null), matches: () => false } : null }),
  S.uiSoundFor({ closest: s => s.startsWith("button") ? { closest: q => (q.includes(".thunderbolt") ? {} : null), matches: q => q.includes(".tabs .item") } : null }),
  S.uiSoundFor({ closest: s => s.startsWith("button") ? { closest: () => null, matches: () => false } : null }));
