// Запуск: node tests/run.mjs (сверяет вывод со снимком в tests/snapshots)
import { fileURLToPath as __f } from "node:url";
import { tmpdir as __tmp } from "node:os";
process.argv[2] ??= __f(new URL("..", import.meta.url)).replace(/\/$/, "");
process.argv[3] ??= __tmp() + "/tb-test-out";
const root = process.argv[2];
const store = {}, chat = [];
globalThis.game = { settings: { register: (_s, k, o) => { store[k] = o.default; }, get: (_s, k) => store[k], set: async (_s, k, v) => { store[k] = v; } },
  actors: [], user: { isGM: true } };
globalThis.ChatMessage = { create: async d => { chat.push(d.content.replace(/\s+/g, " ").replace(/<[^>]+>/g, "|").replace(/\|+/g, "|")); return d; } };
const G = await import(`${root}/module/glory.mjs`);
G.registerGlory();
for (const p of [0, 19, 20, 49, 50, 89, 90, 129, 130, 400]) { const l = G.gloryLevel(p); console.log(p, l.name, l.next || "—", l.nextAt ?? "—", l.effects.map(e => e.title).join(" ")); }
// сводка боя: рядовые воздух и земля, здание не в счёт, эскадрилья «Гробы» целиком, «Ястребы» нет, ас, корабль, Аркбёрд, свои и нейтралы не в счёт
const L = (name, o) => ({ name, side: "enemy", how: "down", kind: "air", tier: "conscript", squad: "", grp: "", boss: false, ...o });
const losses = [L("МиГ-21 1"), L("МиГ-21 2"), L("Т-80", { kind: "ground" }), L("Склад", { kind: "ground", grp: "obj" }),
  L("Гроб 1", { tier: "duelist", squad: "Гробы" }), L("Гроб 2", { tier: "duelist", squad: "Гробы", how: "retreat" }),
  L("Ястреб 1", { tier: "duelist", squad: "Ястребы" }), L("Ас", { tier: "ace" }), L("Эсминец", { kind: "ship", cls: "Эсминец" }), L("Катер", { kind: "ship", cls: "Катер" }), L("МБР", { tier: "conscript", missile: true }),
  L("Аркбёрд", { kind: "ship", boss: true }), L("Свой", { side: "ally" }), L("Нейтрал", { side: "neutral" }), L("Беглец", { how: "retreat" })];
const pre = G.gloryPrefill(losses, [{ name: "Ястреб 2", squad: "Ястребы" }]);
console.log("prefill:", JSON.stringify(pre));
const data = { g_main: true, g_second: 1, g_cons: 13, g_duel: pre.duel, g_ace: 0, g_nem: 1, g_ship: 1, g_boss: 1, g_adj: -1 };
console.log("count:", JSON.stringify(G.gloryCount(data, 4)));
await G.applyGlory(data, "Операция «Буря»");
console.log("after:", JSON.stringify({ ...store.glory, log: store.glory.log.length }));
await G.applyGlory({ g_main: true, g_second: 2, g_cons: 4 }, "Вылет 2");
await G.applyGlory({ g_boss: 6 }, "Вылет 3");
console.log("after 3:", store.glory.points, store.glory.conscripts);
for (const c of chat) console.log("chat:", c.slice(0, 400));
const v = G.gloryView();
console.log("view:", v.name, v.toNext, v.nickOpen, v.effects.length);
console.log("nothing:", await G.applyGlory({}, "пусто"));
