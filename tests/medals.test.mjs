// Награды: стандартный набор, счёт условий по личному делу, вручение (флаг, строка в «Награды», приказ в чат), повтор, отмена, свой список.
import { fileURLToPath as __f } from "node:url";
process.argv[2] ??= __f(new URL("..", import.meta.url)).replace(/\/$/, "");
const R = process.argv[2];
const log = [], settings = {};
const setp = (o, p, v) => { const ks = p.split("."); let x = o; for (const k of ks.slice(0, -1)) x = (x[k] ??= {}); x[ks.at(-1)] = v; };
Object.assign(globalThis, {
  foundry: { utils: { deepClone: x => structuredClone(x), mergeObject: Object.assign, randomID: (() => { let n = 0; return () => `k${++n}`; })() } },
  Hooks: { on() {}, once() {} }, Application: class {},
  game: { user: { isGM: true }, settings: { register() {}, get: (s, k) => settings[k] ?? (k === "campaignDate" ? "12.05.2010" : null), set: async (s, k, v) => { settings[k] = v; } } },
  ui: { notifications: { warn: m => log.push("WARN " + m) } },
  ChatMessage: { create: async d => { log.push(`CHAT ${d.speaker.alias}: ${d.content.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()}`); return d; } }
});
const M = await import(R + "/module/medals.mjs");
const pilot = { type: "pilot", id: "g", name: "Сергей Волков", flags: {}, system: { callsign: "Гроза", rank: "ст. лейтенант", service: { sorties: 4, ops: 1, air: 5, ground: 2, eject: 0, awards: "Грамота командира полка", log: [{ op: "Белый шквал" }] } },
  getFlag(s, k) { return this.flags[k]; }, async update(u) { for (const [k, v] of Object.entries(u)) setp(this, k.replace(/^flags\.[^.]+\./, "flags."), v); } };
game.actors = [pilot];
console.log("набор:", M.medalList().map(m => m.name).join(" · "));
console.log("счёт:", M.medalList().map(m => [m.id, M.progress(pilot, m)]).filter(([, p]) => p).map(([id, p]) => `${id} ${p.met ? "✔" : "○"} ${p.text}`).join(" | "));
await M.award(pilot, "ace", { op: "Белый шквал", note: "пять побед над Северной Осеей" });
await M.award(pilot, "ace");
await M.award(pilot, "valor", { date: "14.05.2010", note: "атаковал под ракетой" });
await M.award(pilot, "valor", { date: "20.05.2010" });
console.log(log.splice(0).join("\n"));
console.log("флаг:", JSON.stringify(M.awardsOf(pilot).map(a => [a.id, a.date, a.op, a.note])));
console.log("Награды в личном деле:\n" + pilot.system.service.awards);
console.log("колодки:", M.rack(pilot).map(r => r.title).join(" | "), "·", /<rect[^>]+fill="#c9a227"/.test(M.rack(pilot)[0].svg) ? "полосы аса есть" : "без полос");
await M.revoke(pilot, M.awardsOf(pilot)[1].key);
console.log("после отмены:", M.awardsOf(pilot).length, "·", JSON.stringify(pilot.system.service.awards));
const html = M.panelHtml(pilot);
console.log("панель:", (html.match(/data-medal-give="(\w+)" disabled/g) ?? []).map(x => x.match(/"(\w+)"/)[1]).join(",") || "все доступны", "закрыты ·",
  (html.match(/tb-medal-row ready/g) ?? []).length, "с выполненным условием ·", /data-medal-revoke/.test(html) ? "есть отмена" : "");
// свой список
await game.settings.set("x", "medalList", [{ id: "own", name: "Знак «Штурман года»", cond: "За точный выход на цель.", ribbon: M.DEFAULT_MEDALS[0].ribbon, need: { sorties: 3 }, repeat: false }]);
console.log("свой список:", M.medalList().map(m => `${m.name} ${M.progress(pilot, m).text}`).join(", "), "· старая награда видна:", M.rack(pilot)[0].title);
console.log("звезда:", /polygon/.test(M.ribbonSvg(M.DEFAULT_MEDALS.find(m => m.id === "hero"))) ? "есть" : "нет");
