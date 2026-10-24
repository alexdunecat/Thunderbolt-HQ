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
// «Итоги вылета»: что предложить после вылета (личное дело уже с ним)
const svBefore = { ...pilot.system.service };
pilot.system.service.sorties = 10; pilot.system.service.eject = 1;
const kills = [{ name: "Пиксис-1", kind: "air", ace: true }, { name: "Скинфакси", kind: "ground", boss: true }, { name: "Су-27", kind: "air" }];
console.log("предложить:", M.suggestAwards(pilot, { kills, goalsDone: true, flightIntact: true }).map(x => `${x.id}${x.on ? "✔" : "○"} (${x.why})`).join(" | "));
console.log("без побед и задач:", M.suggestAwards(pilot).map(x => x.id).join(", "));
Object.assign(pilot.system.service, svBefore);
const html = M.panelHtml(pilot);
console.log("панель:", (html.match(/data-medal-give="(\w+)" disabled/g) ?? []).map(x => x.match(/"(\w+)"/)[1]).join(",") || "все доступны", "закрыты ·",
  (html.match(/tb-medal-row ready/g) ?? []).length, "с выполненным условием ·", /data-medal-revoke/.test(html) ? "есть отмена" : "");
// свой список
await game.settings.set("x", "medalList", [{ id: "own", name: "Знак «Штурман года»", cond: "За точный выход на цель.", ribbon: M.DEFAULT_MEDALS[0].ribbon, need: { sorties: 3 }, repeat: false }]);
console.log("свой список:", M.medalList().map(m => `${m.name} ${M.progress(pilot, m).text}`).join(", "), "· старая награда видна:", M.rack(pilot)[0].title);
console.log("звезда:", /polygon/.test(M.ribbonSvg(M.DEFAULT_MEDALS.find(m => m.id === "hero"))) ? "есть" : "нет");
// конструктор: черновик, полосы с симметрией, образцы, счёт, порядок
await game.settings.set("x", "medalList", []);
const st = M.startEdit(), rib = () => st.draft[st.sel].ribbon.map(([c, n]) => `${c.slice(1, 4)}:${n}`).join(" ");
M.builderAct(st, "select", st.draft.findIndex(m => m.id === "ace"));
console.log("конструктор: выбрана", st.draft[st.sel].name, "· симметрия", st.sym, "·", rib());
M.builderAct(st, "stripe", 1); M.builderAct(st, "paint", "#b22222"); console.log("покраска 2-й с отражением:", rib());
M.builderAct(st, "wide"); console.log("шире:", rib());
M.builderAct(st, "add"); console.log("добавить полосу (парой):", rib(), "· выбрана", st.stripe + 1);
M.builderAct(st, "del"); console.log("убрать (парой):", rib());
M.builderAct(st, "stripe", 2); M.builderAct(st, "add"); console.log("добавить у середины:", rib());
M.builderAct(st, "sym", false); M.builderAct(st, "stripe", 0); M.builderAct(st, "paint", "#2b4a8b"); console.log("без симметрии:", rib(), "· симметрична", M.isSymmetric(st.draft[st.sel].ribbon));
M.builderAct(st, "sym", true); console.log("снова симметрично (левая половина отражена):", rib());
M.builderAct(st, "pattern", 1); console.log("образец «Кайма»:", rib());
M.builderAct(st, "addneed", "sorties"); M.builderAct(st, "need", { k: "air", v: "7" }); M.builderAct(st, "unneed", "sorties"); console.log("счёт:", JSON.stringify(st.draft[st.sel].need));
M.builderAct(st, "field", { k: "name", v: "Знак «Ас Юктобании»" }); M.builderAct(st, "field", { k: "star", v: true });
M.builderAct(st, "copy"); M.builderAct(st, "up"); M.builderAct(st, "up");
console.log("копия и порядок:", st.draft.slice(4, 9).map(m => m.name).join(" · "), "· правки", st.dirty);
console.log("в списке мира до сохранения:", M.medalList().find(m => m.id === "ace").name);
const ehtml = M.panelHtml(null, { edit: true });
console.log("разметка конструктора:", ["data-mk-stripe", "data-mk-paint", "data-mk-pattern", "data-mk-addneed", "tb-ribbon-big", "Сохранить *"].map(k => `${k} ${ehtml.includes(k) ? "✔" : "✘"}`).join(", "));
M.stopEdit();
