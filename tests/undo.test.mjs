// Отмена и возврат ведущего: обратные изменения, шаги по игроку и времени, откат карточки с уроном и обратно.
import { fileURLToPath as __f } from "node:url";
process.argv[2] ??= __f(new URL("..", import.meta.url)).replace(/\/$/, "");
const R = process.argv[2];
const hooks = {}, log = [], keys = {};
const setp = (o, p, v) => { const ks = p.split("."); let x = o; for (const k of ks.slice(0, -1)) x = (x[k] ??= {}); x[ks.at(-1)] = v; };
const delp = (o, p) => { const ks = p.split("."); let x = o; for (const k of ks.slice(0, -1)) x = x?.[k]; if (x) delete x[ks.at(-1)]; };
Object.assign(globalThis, {
  foundry: { utils: { mergeObject: Object.assign } },
  Hooks: { on: (n, f) => (hooks[n] ??= []).push(f), once: (n, f) => (hooks[n] ??= []).push(f), callAll() {} },
  Application: class {}, ui: { notifications: { info: m => log.push("INFO " + m) } },
  game: { user: { isGM: true }, keybindings: { register: (s, k, o) => { keys[k] = o.editable[0]; } }, actors: [], combats: [], messages: { contents: [] }, collections: new Map() },
  canvas: { scene: null }
});
const fire = (n, ...a) => (hooks[n] ?? []).forEach(f => f(...a));
// документы-заглушки: правка меняет данные и зовёт хук update…, как сервер
class Doc {
  constructor(name, data, coll) { this.documentName = name; this.data = data; this.id = data._id; this.uuid = `${name}.${data._id}`; this.coll = coll; coll.set(this.id, this); }
  get name() { return this.data.name; }
  toObject() { return structuredClone(this.data); }
  async update(ch, opt = {}, user = "gm") {
    for (const [k, v] of Object.entries(ch)) { if (k.split(".").at(-1).startsWith("-=")) delp(this.data, k.replace(/-=/g, "")); else setp(this.data, k, structuredClone(v)); }
    const nested = {}; for (const [k, v] of Object.entries(ch)) setp(nested, k, v);
    fire(`update${this.documentName}`, this, nested, opt, user);
  }
  async delete(opt = {}, user = "gm") { this.coll.delete(this.id); fire(`delete${this.documentName}`, this, opt, user); }
}
const actors = new Map(), messages = new Map();
game.collections.set("Actor", actors); game.collections.set("ChatMessage", messages);
globalThis.getDocumentClass = name => ({ create: async (data, opt) => { const d = new Doc(name, data, name === "Actor" ? actors : messages); fire(`create${name}`, d, opt, "gm"); return d; } });
let n = 0;
globalThis.ChatMessage = { create: async (data, opt, user = "gm") => { log.push("CHAT " + data.content.replace(/<[^>]+>/g, "").trim()); const d = new Doc("ChatMessage", { _id: "m" + ++n, ...data }, messages); fire("createChatMessage", d, opt ?? {}, user); return d; } };

const U = await import(R + "/module/undo.mjs");
console.log("обратное:", JSON.stringify(U.inverseOf({ system: { hp: { value: 3 }, markers: { grit: false } }, flags: { tb: { lock: "x" } } },
  { system: { hp: { value: 1 }, markers: { grit: true, gritSkill: "aim" } }, flags: { tb: { "-=lock": null, aimed: "w1" } } })));
U.registerUndo();
console.log("клавиши:", JSON.stringify(keys));
const gr = new Doc("Actor", { _id: "a1", name: "Гроза", system: { hp: { value: 3 }, speed: 2, markers: { grit: false } }, flags: {} }, actors);
const mig = new Doc("Actor", { _id: "a2", name: "МиГ-29 противника", system: { hp: { value: 4 }, speed: 3 }, flags: {} }, actors);
game.actors = [gr, mig];
gr.items = mig.items = gr.effects = mig.effects = [];
fire("ready");
// ход игрока: Speed, затем Fox Two! — карточка, захват; клиент цели ставит урон следом
const now = Date.now;
let t = 1000; Date.now = () => t;
await gr.update({ "system.speed": 3 }, {}, "pl");
t += 4000;
await ChatMessage.create({ speaker: { alias: "Гроза" }, content: "<p>карточка</p>", flags: { "thunderbolt-shtab": { card: { label: "Fox Two!" } } } }, {}, "pl");
t += 200; await gr.update({ [`flags.thunderbolt-shtab.lock`]: "a2" }, {}, "pl");
t += 900; await mig.update({ "system.hp.value": 0 }, {}, "gm");
console.log("журнал:", JSON.stringify(U.history().done.map(s => [s.label, s.n])));
await U.undo();
console.log("после отмены:", gr.data.system.speed, JSON.stringify(gr.data.flags), mig.data.system.hp.value, "карточек", messages.size);
await U.redo();
console.log("после возврата:", JSON.stringify(gr.data.flags), mig.data.system.hp.value, "карточка", [...messages.values()].filter(m => m.data.speaker?.alias === "Гроза").length);
await U.undo(2);
console.log("две отмены:", gr.data.system.speed, mig.data.system.hp.value, "· отменено", U.history().undone.length);
t += 5000; await gr.update({ "system.hp.value": 2 }, {}, "pl");
console.log("новое действие стирает «Отменено»:", U.history().undone.length, "· сделано", JSON.stringify(U.history().done.map(s => s.label)));
console.log(log.join("\n"));
const html = U.historyHtml();
console.log("журнал html:", ["data-undo", "data-redo", "data-undo-to", "Alt+Z"].map(k => `${k} ${html.includes(k) ? "✔" : "✘"}`).join(", "));
Date.now = now;
