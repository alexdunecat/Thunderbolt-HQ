// Запуск: node tests/run.mjs (сверяет вывод со снимком в tests/snapshots)
import { fileURLToPath as __f } from "node:url";
import { tmpdir as __tmp } from "node:os";
process.argv[2] ??= __f(new URL("..", import.meta.url)).replace(/\/$/, "");
process.argv[3] ??= __tmp() + "/tb-test-out";
const R = process.argv[2];
const log = [], msgs = [], answers = {}, hooks = {};
const get = (o, p) => p.split(".").reduce((x, k) => x?.[k], o);
const setp = (o, p, v) => { const ks = p.split("."); let x = o; for (const k of ks.slice(0, -1)) x = (x[k] ??= {}); x[ks.at(-1)] = v; };
const F = class {};
const users = [{ id: "gm", isGM: true, active: true, targets: { first: () => null } }, { id: "pl", isGM: false, active: true, targets: { first: () => null } }];
users.find = Array.prototype.find; users.get = id => users.find(u => u.id === id); users.activeGM = users[0];
const sent = [];
Object.assign(globalThis, {
  foundry: { data: { fields: { NumberField: F, StringField: F, BooleanField: F, SchemaField: F, ArrayField: F, HTMLField: F, ObjectField: F } }, abstract: { TypeDataModel: class {} },
    utils: { hasProperty: (o, p) => get(o, p) !== undefined, getProperty: get, deepClone: x => structuredClone(x) }, audio: { AudioHelper: { play: () => log.push("SOUND") } } },
  Actor: class {}, Item: class {}, Combat: class {},
  Dialog: class { constructor(o) { this.o = o; } render() { const names = [...this.o.content.matchAll(/name="([^"]+)"/g)].map(m => m[1]);
    const opts = [...this.o.content.matchAll(/<option value="(\d+)"[^>]*>([^<]*)/g)].map(m => m[2]);
    log.push("DIALOG " + this.o.title + " fields=" + names.join(",") + (opts.length ? " options=" + opts.join(" | ") : "") + " hint=" + (this.o.content.match(/tb-hint">([^\n]*?)<\/p>/)?.[1] ?? "").replace(/<[^>]+>/g, ""));
    const form = { elements: names.map(n => ({ name: n, type: n === "mod" ? "number" : "select", value: String(answers[n] ?? (n === "mod" ? 0 : "")) })) };
    setTimeout(() => this.o.buttons.ok.callback([{ querySelector: () => form }]), 0); return this; } },
  Hooks: { on: (n, f) => (hooks[n] ??= []).push(f), once() {}, callAll() {} },
  Roll: class { constructor(f) { this.f = f; } async evaluate() { this.total = this.f === "1d10" ? globalThis.D10 : 2; return this; } },
  ChatMessage: { create: async d => { const m = { ...d, id: "m" + msgs.length, getFlag: (s, k) => d.flags?.[s]?.[k], canUserModify: () => true, async update(u) { for (const [k, v] of Object.entries(u)) if (k.startsWith("flags.")) setp(d, k, v); else d[k] = v; } }; msgs.push(m); return m; }, getSpeaker: () => ({}) },
  game: { user: users[0], users, messages: { get contents() { return msgs; } }, settings: { get: () => null }, combat: null, socket: { on() {}, emit: (c, m) => sent.push(m) }, scenes: { viewed: null } },
  ui: { notifications: { info: m => log.push("info " + m), warn: m => log.push("WARN " + m), error: m => log.push("ERROR " + m) }, windows: {} },
  CONFIG: { sounds: { dice: "d", notification: "n" }, specialStatusEffects: { DEFEATED: "dead" } },
  CONST: { GRID_TYPES: { GRIDLESS: 0, SQUARE: 1 } },
});
const gs = 300;
const scene = { getFlag: () => null };
const toks = [];
const actors = {};
const mkTok = (id, type, sys, zone, disp, player, elev = 2) => {
  const a = actors[id] = { id, uuid: "Actor." + id, name: id, type, isToken: false, hasPlayerOwner: player, statuses: new Set(), items: Object.assign([], { get: () => null }),
    system: { speed: 2, breakEv: null, evasion: 3, stats: { ev: 3 }, kind: "air", alt: "med", skillTotal: { strafe: 2 }, gun: 3, ...sys },
    get isOwner() { return game.user.isGM || (player && game.user.id === "pl"); },
    testUserPermission: u => player && u.id === "pl", getFlag: () => null, async update(u) { log.push(`UPDATE ${id} ${JSON.stringify(u)}`); },
    async applyDamage(n, o) { log.push(`DAMAGE ${id} ${n} on ${game.user.id} src=${o.source}`); } };
  const t = { name: id, actor: a, visible: true, document: { hidden: false, disposition: disp, elevation: elev, width: 0.5, height: 0.5, parent: scene }, center: { x: zone[0] * gs + 150, y: zone[1] * gs + 150 } , setTarget() { log.push("TARGET " + id); } };
  a.getActiveTokens = () => [t];
  toks.push(t); return t;
};
globalThis.canvas = { ready: true, grid: { type: 1, size: gs, getOffset: p => ({ i: Math.floor(p.y / gs), j: Math.floor(p.x / gs) }),
  measurePath: ([p, q]) => ({ spaces: Math.max(Math.abs(Math.floor(p.x / gs) - Math.floor(q.x / gs)), Math.abs(Math.floor(p.y / gs) - Math.floor(q.y / gs))) }) },
  tokens: { placeables: toks }, scene };
globalThis.fromUuidSync = u => actors[u.replace("Actor.", "")];
mkTok("Гроза", "pilot", {}, [0, 0], 1, true);
mkTok("МиГ", "npc", { grp: "fighter" }, [0, 0], -1, false);
mkTok("Су", "npc", { grp: "fighter", breakEv: 6 }, [0, 0], -1, false);
mkTok("Далёкий", "npc", { grp: "fighter" }, [2, 0], -1, false);
mkTok("Ведомый", "pilot", {}, [0, 0], 1, true);
mkTok("Союзный", "npc", { grp: "fighter", side: "ally" }, [0, 0], -1, false);
mkTok("Нейтрал", "npc", { grp: "fighter", side: "neutral", priority: true }, [0, 0], 1, false);
mkTok("Выше", "npc", { grp: "fighter" }, [0, 0], -1, false, 3);
const Rm = await import(R + "/module/dice/rolls.mjs");
const wait = ms => new Promise(r => setTimeout(r, ms));
const card = m => m?.flags?.["thunderbolt-shtab"]?.card;
// 1) пилот (игрок) стреляет: две цели в зоне, выбирает вторую (Су с Break 6 → защита 8); d10 8 + strafe 2 − speed 2 = 8 → попадание
game.user = users[1]; globalThis.D10 = 8; answers.target = "2";
let m = await Rm.fireGuns(actors.Гроза); await wait(10);
log.push("CARD1 " + JSON.stringify({ t: card(m)?.targetName, dc: card(m)?.dc, applied: card(m)?.dmgApplied }) + " sent=" + JSON.stringify(sent));
// 2) промах, потом Strain
answers.target = "0"; globalThis.D10 = 4; actors.Гроза.system.strain = { value: 2 };
m = await Rm.fireGuns(actors.Гроза); await wait(10);
log.push("CARD2 " + JSON.stringify({ t: card(m)?.targetName, dc: card(m)?.dc, applied: !!card(m)?.dmgApplied }));
actors.Гроза.update = async u => { Object.assign(actors.Гроза.system.strain, { value: u["system.strain.value"] }); };
await Rm.onCardAction(m, "strain"); await wait(10);
log.push("CARD2+strain " + JSON.stringify({ strain: card(m)?.strain, applied: !!card(m)?.dmgApplied }) + " sent=" + sent.length);
// 3) NPC (GM) стреляет по пилоту: урон отправляется игроку
game.user = users[0]; globalThis.D10 = 9; delete answers.target;
m = await Rm.fireGuns(actors.МиГ); await wait(10);
log.push("CARD3 " + JSON.stringify({ t: card(m)?.targetName, applied: card(m)?.dmgApplied }) + " sent=" + JSON.stringify(sent.at(-1)));
// 4) никого в зоне
toks.splice(1, 2); toks.splice(2, 1); toks.splice(3, 2); log.push("LEFT " + toks.map(t => t.name).join(","));
game.user = users[1];
m = await Rm.fireGuns(actors.Гроза);
log.push("CARD4 " + (m ? "fired" : "none"));
console.log(log.join("\n"));
