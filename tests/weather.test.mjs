// Запуск: node tests/run.mjs (сверяет вывод со снимком в tests/snapshots)
// Осадки в клетках погоды, фоновый звук места и гром, карточка NPC при наведении
import { fileURLToPath as __f } from "node:url";
process.argv[2] ??= __f(new URL("..", import.meta.url)).replace(/\/$/, "");
const R = process.argv[2];
Object.assign(globalThis, {
  foundry: { utils: { deepClone: x => structuredClone(x), hasProperty: () => false }, abstract: { TypeDataModel: class {} }, data: { fields: {} } },
  Hooks: { on() {}, once() {} }, CONFIG: {}, game: { settings: { get: () => { throw new Error("нет"); } } }
});
const W = await import(R + "/module/weather-fx.mjs");
const r2 = x => Math.round(x * 100) / 100;
console.log("виды:", [["rain"], ["rain"], ["lightning"], ["hurrW"], ["hurrA", "rain"], ["dust", "wind"], ["clouds"], ["tornado"], ["eye"], []]
  .map((ids, i) => `${ids.join("+") || "—"}${i === 1 ? "@cold" : ""}=${W.kindsOf(ids, i === 1 ? "cold" : "none").join(",") || "—"}`).join(" "));
console.log("холод: ураган", W.kindsOf(["hurrW"], "cold").join(","), "· молния", W.kindsOf(["lightning"], "cold").join(","));
const scene = f => ({ getFlag: (ns, k) => f[k] });
const cells = W.weatherCellsOf(scene({ weather: ["wind"], weatherCells: { "0,0": ["rain", "bogus"], "5,5": ["dust"], "1,0": ["bogus"] } }), 2, 1);
console.log("клетки:", JSON.stringify([...cells]));
console.log("без общей:", JSON.stringify([...W.weatherCellsOf(scene({ weatherCells: { "2,3": ["lightning"] } }))]));
const S = 200;
for (const kind of ["rain", "storm", "snow", "dust", "wind", "tornado"]) {
  const a = W.particles(kind, 3, 4, 1234, S), b = W.particles(kind, 3, 4, 1234, S), c = W.particles(kind, 3, 4, 1500, S);
  const inside = a.every(q => [q.x1, q.x2, q.y1, q.y2, q.x, q.y].filter(v => v !== undefined).every(v => v >= -S * 0.05 && v <= S * 1.05));
  console.log(`${kind}: ${a.length} шт., повтор ${JSON.stringify(a) === JSON.stringify(b) ? "тот же" : "другой"}, через 266 мс ${JSON.stringify(a) === JSON.stringify(c) ? "стоит" : "сдвинулось"}, в клетке ${inside ? "да" : "нет"}, половина плотности ${W.particles(kind, 3, 4, 1234, S, 0.5).length}`);
}
const ck = W.boltClock(2, 3);
console.log("молния: период", Math.round(ck.period), "мс, сдвиг", Math.round(ck.off));
let flashes = 0, last = null;
for (let t = 0; t < 60000; t += 20) { const b = W.boltAt(2, 3, t); if (b && b.n !== last) { flashes++; last = b.n; } }
console.log("вспышек за минуту:", flashes, "· соседи не совпадают:", Math.round(W.boltClock(2, 4).period) !== Math.round(ck.period));
const p = W.boltPath(2, 3, 7, S);
console.log("стрела:", p.main.length, "точек, сверху вниз:", p.main.every((q, i) => !i || q[1] > p.main[i - 1][1]), "· в клетке:", [...p.main, ...p.fork].every(([x, y]) => x >= 0 && x <= S && y >= 0 && y <= S * 1.05), "· та же:", JSON.stringify(W.boltPath(2, 3, 7, S)) === JSON.stringify(p));

const A = await import(R + "/module/ambient.mjs");
console.log("места со звуком:", Object.keys(A.BEDS).join(", "), "· тропики с птицами:", !!A.BEDS.jungle.chirps);
const fix = () => 0.5;
for (const near of [1, 0.5, 0]) { const t = A.thunderPlan(near, fix); console.log(`гром near ${near}: задержка ${r2(t.delay)} с, громкость ${r2(t.gain)}, длина ${r2(t.dur)} с, срез ${Math.round(t.cut)} Гц`); }
console.log("громкость:", [[40, 1], [100, 0.5], [0, 1], [70, undefined], [200, 1]].map(([o, c]) => `${o}×${c}=${r2(A.ambientVolume(o, c))}`).join(" "));

globalThis.game = { settings: { get: () => { throw new Error("нет"); } }, user: { isGM: true } };
const H = await import(R + "/module/hover-card.mjs");
const item = (name, value, max, off = false) => ({ type: "weapon", name, system: { ammo: { value, max }, offline: off } });
const actor = (sys, items = [], flags = {}) => ({ type: "npc", name: "МиГ-29А", system: { kind: "air", tier: "duelist", side: "enemy", hp: { value: 2, max: 4 }, strain: { value: 1, max: 3 }, speed: 3, maxSpeed: 4, lock: "", markers: {}, ...sys }, items, getFlag: (ns, k) => flags[k] });
const tok = (call, alt = 3) => ({ name: "МиГ-29А", document: { getFlag: (ns, k) => k === "radioCall" ? call : undefined, elevation: alt }, actor: null });
const a1 = actor({ markers: { structure: true, sys: "en", grit: true, gritSkill: "aim" }, lock: "Тень" }, [item("R-77", 0, 2), item("ПРР", 1, 2, true), item("Пушка", null, null)],
  { autopilot: { on: true, task: "hunt", manner: "push", style: "auto", prefer: "auto", acts: 0, route: [] } });
const d1 = H.hoverData(a1, tok("Хан-2"));
console.log("карточка:", JSON.stringify(d1));
console.log(H.hoverHtml(d1).replace(/\s+\n/g, "\n"));
const d2 = H.hoverData(actor({ kind: "ship", tier: "conscript", side: "ally", strain: { value: 0, max: 0 } }), null);
console.log("корабль:", JSON.stringify(d2));
console.log("пилот:", H.hoverData({ type: "pilot", system: {} }), "· пусто:", H.hoverData(null));
console.log("экранирование:", H.hoverHtml({ ...d2, name: "<b>x</b>", weapons: [] }).includes("&lt;b&gt;"));
