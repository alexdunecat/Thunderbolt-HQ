// HUD пилота: что видно на полосе (HP, Strain, Speed, высота, действия хода, захват, оружие, предупреждения) и кнопки.
import { fileURLToPath as __f } from "node:url";
process.argv[2] ??= __f(new URL("..", import.meta.url)).replace(/\/$/, "");
const R = process.argv[2];
const F = class { constructor(...a) { this.a = a; } };
const flags = o => ({ getFlag(s, k) { return o.flags?.[s]?.[k]; } });
const msgs = [];
const combat = { id: "C1", started: true, round: 2, combatant: null, flags: { "thunderbolt-shtab": { ready: 2 } }, getFlag(s, k) { return this.flags[s]?.[k]; }, combatants: [] };
Object.assign(globalThis, {
  foundry: { utils: { deepClone: x => structuredClone(x), mergeObject: Object.assign, getProperty: () => undefined, hasProperty: () => false }, abstract: { TypeDataModel: class {} },
    data: { fields: { NumberField: F, StringField: F, BooleanField: F, SchemaField: F, ArrayField: F, HTMLField: F, ObjectField: F } } },
  CONST: { DOCUMENT_OWNERSHIP_LEVELS: { LIMITED: 1 }, GRID_TYPES: { GRIDLESS: 0 } },
  Hooks: { on() {}, once() {} }, CONFIG: { sounds: {}, specialStatusEffects: { DEFEATED: "dead" } },
  game: { user: { id: "p1", isGM: false, character: null }, users: [], macros: [], folders: [], messages: { contents: msgs }, combat, settings: { get: () => true } },
  ui: { notifications: { warn() {}, info() {} } },
  Actor: class {}, Item: class {}, Combat: class {}, Application: class {}, FormApplication: class {}, ActorSheet: class {}, Dialog: class {}, fromUuidSync: () => null
});
const scene = { id: "S", getFlag: () => null };
const mkTok = (id, actor, x, elevation) => ({ id, name: actor.name, actor, center: { x, y: 50 }, document: { parent: scene, elevation, width: 1, height: 1, x: x - 50, y: 0, texture: { src: process.env.HUD_IMG ?? "systems/thunderbolt-shtab/assets/planes/mig29.svg" } } });
const mkActor = (name, type, system, items = []) => {
  const a = { name, type, uuid: "Actor." + name, isOwner: true, isToken: false, system, items, ...flags({}) };
  a.getActiveTokens = () => (a.tok ? [a.tok] : []);
  return a;
};
const gun = (name, value, max) => ({ id: name, type: "weapon", name, system: { ammo: { value, max } } });
const me = mkActor("Гроза", "pilot", { callsign: "Гроза", plane: { name: "МиГ-29", system: { key: "mig29a" } }, broken: "ms", markers: { structure: true, sys: "ms", grit: true, gritSkill: "aim" }, service: { status: "active" }, hp: { value: 1, max: 6 }, strain: { value: 2, max: 4 }, speed: 0, maxSpeed: 5, evasion: 3, alt: "low",
  lockUuid: "Actor.Стрикс-2", lock: "", ammoBonus: { QAAM: 1 } }, [gun("QAAM", 0, 1), gun("UGB", 3, null)]);
const foe = mkActor("Стрикс-2", "npc", { kind: "air", hp: { value: 3, max: 3 }, speed: 3, alt: "low", lockUuid: "Actor.Гроза", stats: { spd: 4, ev: 3 } });
me.tok = mkTok("T1", me, 50, 1); foe.tok = mkTok("T2", foe, 250, 1);
const byUuid = { "Actor.Гроза": me, "Actor.Стрикс-2": foe };
globalThis.fromUuidSync = u => byUuid[u] ?? null;
globalThis.canvas = { ready: true, scene, grid: { type: 1, size: 100, getOffset: p => ({ i: Math.floor(p.y / 100), j: Math.floor(p.x / 100) }), measurePath: ([a, b]) => ({ spaces: Math.abs(a.x - b.x) / 100 }) }, tokens: { placeables: [me.tok, foe.tok], controlled: [] } };
const c = { id: "c1", name: "Гроза", tokenId: "T1", actor: me, actorId: "Гроза", initiative: 3, isOwner: true, parent: combat,
  flags: { "thunderbolt-shtab": { acts: { round: 2, used: 1, rolled: true, freeSpeed: true, list: ["Move"] } } }, getFlag(s, k) { return this.flags[s]?.[k]; } };
combat.combatants = [c]; combat.combatant = c;
msgs.push({ getFlag: () => ({ type: "attack", delayed: true, targetUuid: "Actor.Гроза", combatKey: "C1:2" }) });
game.actors = [me, foe];
const H = await import(R + "/module/hud.mjs");
const d = H.hudData(me);
if (process.env.HUD_HTML) (await import("node:fs")).writeFileSync(process.env.HUD_HTML, H.hudHtml(me));
console.log("кнопки:", [...H.hudHtml(me).matchAll(/data-hud-act="(\w+)"[^>]*>(?:<b>(\d)<\/b> )?([^<]+)/g)].map(m => `${m[2] ?? "-"}:${m[1]}`).join(" "));
console.log(JSON.stringify(d, null, 1).replace(/\n\s*/g, " "));
foe.system.lockUuid = ""; msgs.length = 0; me.system.speed = 3; me.system.alt = "high"; me.tok.document.elevation = 3; me.system.hp.value = 5; c.flags["thunderbolt-shtab"].acts = { round: 1, used: 2, list: [] };
if (process.env.HUD_HTML) (await import("node:fs")).writeFileSync(process.env.HUD_HTML.replace(".html", "2.html"), H.hudHtml(me));
me.system.markers.doom = true;
console.log("Doom:", JSON.stringify(H.hudData(me).warn.map(w => w.key)), "катапульта:", H.hudData(me).canEject, H.hudHtml(me).includes("data-hud-eject") ? "кнопка есть" : "кнопки нет");
me.system.service.status = "ejected";
console.log("после катапульты:", H.hudData(me).canEject);
me.system.markers.doom = false; me.system.service.status = "active";
console.log("спокойно:", JSON.stringify(H.hudData(me).warn), JSON.stringify(H.hudData(me).acts), H.hudData(me).alt, H.hudData(me).lock.dist);
console.log("у игрока:", H.hudActor()?.name ?? "нет");
game.user.isGM = true;
console.log("у ведущего без выделения:", H.hudActor()?.name ?? "нет");
canvas.tokens.controlled = [foe.tok];
console.log("у ведущего с выделенным:", H.hudActor()?.name ?? "нет", "·", H.hudData(foe).plane, H.hudData(foe).maxSpeed, JSON.stringify(H.hudData(foe).warn));
console.log("свёрнут:", H.hudHtml(foe, true).includes("tb-hud-grid") ? "приборы видны" : "только шапка");
