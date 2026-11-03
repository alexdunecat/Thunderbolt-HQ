// Запуск: node tests/run.mjs (сверяет вывод со снимком в tests/snapshots)
// Боевой экран, огни ночью, кильватер и пыль, щелчок рации, штриховка погоды под анимацией
import { fileURLToPath as __f } from "node:url";
process.argv[2] ??= __f(new URL("..", import.meta.url)).replace(/\/$/, "");
const R = process.argv[2];
Object.assign(globalThis, {
  foundry: { utils: { deepClone: x => structuredClone(x), hasProperty: () => false }, abstract: { TypeDataModel: class {} }, data: { fields: {} } },
  Hooks: { on() {}, once() {} }, CONFIG: {}, game: { settings: { get: () => { throw new Error("нет"); } } }
});
const r1 = x => Math.round(x * 10) / 10;
const C = await import(R + "/module/combat-screen.mjs");
const cases = [{ inCombat: true }, { inCombat: true, isGM: true }, { inCombat: true, isGM: true, mode: "all" }, { inCombat: true, override: false }, { inCombat: true, isGM: true, override: true }, { inCombat: false, override: true }, { inCombat: false }, { inCombat: true, mode: "off" }];
console.log("боевой экран:", cases.map(c => `${JSON.stringify(c)}=${C.screenWanted(c) ? "прячет" : "нет"}`).join("\n  "));

const actor = (type, system, flags = {}) => ({ type, system, getFlag: (ns, k) => flags[k] });
const N = await import(R + "/module/night-lights.mjs");
const list = [["пилот", actor("pilot", { alt: "high" })], ["истребитель NPC", actor("npc", { kind: "air", alt: "med" })], ["корабль", actor("npc", { kind: "ship" })],
  ["подлодка под водой", actor("npc", { kind: "ship" }, { unit: { sub: true } })], ["ЗРК", actor("npc", { kind: "ground", grp: "ad" })], ["танк", actor("npc", { kind: "ground", grp: "armor" })], ["завод", actor("npc", { kind: "ground", grp: "obj" })], ["вертолёт", actor("npc", { kind: "air", grp: "heli", alt: "low" })], ["штаб", actor("staff", {})]];
console.log("огни:", list.map(([n, a]) => `${n}=${N.lightsOf(a) ?? "—"}`).join(", "));
{ // форма по картинке: крестик-самолёт 20×20, крылья в строке 8, хвост внизу
  const w = 20, h = 20, px = new Uint8ClampedArray(w * h * 4), put = (x, y) => { px[(y * w + x) * 4 + 3] = 255; };
  for (let y = 2; y < 18; y++) put(10, y); for (let x = 3; x < 18; x++) put(x, 8); for (let x = 7; x < 14; x++) put(x, 16);
  const g = N.shapeFromAlpha(px, w, h);
  console.log("форма:", `левый ${r1(g.left.u * 20)},${r1(g.left.v * 20)} правый ${r1(g.right.u * 20)},${r1(g.right.v * 20)} нос ${r1(g.top * 20)} хвост ${r1(g.bottom * 20)}`);
  const cnt = l => Object.entries(l.reduce((m, x) => ({ ...m, [x.k + (x.c ? ":" + x.c : "")]: (m[x.k + (x.c ? ":" + x.c : "")] ?? 0) + 1 }), {})).map(([k, n]) => `${k}×${n}`).join(" ");
  for (const k of ["plane", "heli", "ship", "vehicle", "building"]) console.log(`огни ${k}:`, cnt(N.layoutFor(k, g, { seed: 3, tall: true })));
  console.log("огни авианосца:", N.layoutFor("ship", g, { carrier: true }).length, "· пустая картинка:", N.shapeFromAlpha(new Uint8ClampedArray(16), 2, 2));
  for (const t of ["city", "village", "industry", "port", "base", "sea"]) console.log(`клетка ${t}:`, N.settlementLights(t, 0, 5).length);
  const pr = N.settlementLights("port", 90, 5)[1], p0 = N.settlementLights("port", 0, 5)[1];
  console.log("порт повёрнут:", `${r1(p0.x)},${r1(p0.y)} → ${r1(pr.x)},${r1(pr.y)}`);
  const run = Array.from({ length: 14 }, (_, k) => N.settlementLights("base").filter(l => l.k === "rabbit").map(l => N.lightLevel(l, k * 90)).join("")).join(" ");
  console.log("бегущий огонь:", run);
}
let on = 0; for (let t = 0; t < 1400; t += 10) if (N.strobeOn(t)) on++;
console.log("проблесковый: горит", on * 10, "мс из 1400 · сдвиг меняет:", N.strobeOn(0, 0) !== N.strobeOn(0, 300));
const angs = Array.from({ length: 40 }, (_, i) => N.beamAngle(i * 500));
console.log("прожектор: от", r1(Math.min(...angs) * 180 / Math.PI), "до", r1(Math.max(...angs) * 180 / Math.PI), "градусов (−90 — вверх)");

const Fx = await import(R + "/module/fx.mjs");
console.log("след по земле:", list.map(([n, a]) => `${n}=${Fx.groundTrailOf(a) ?? "—"}`).join(", "), "· объект", Fx.groundTrailOf(actor("npc", { kind: "ground", grp: "obj" })) ?? "—");
{ const tarpan = actor("npc", { kind: "ship", grp: "boss", props: [{ key: "landship" }] });
  console.log("Тарпан:", ["plains", "coast", "sea", null].map(t => `${t ?? "без карты"}=${Fx.groundTrailOf(tarpan, t)}`).join(", "));
  const m = Fx.treadMarks({ x: 0, y: 0 }, { x: 100, y: 0 }, 100);
  console.log("колея: отпечатков", m.length, "· полосы по y", [...new Set(m.map(o => r1((o.y1 + o.y2) / 2)))].join(" "), "· длина отпечатка", r1(Math.hypot(m[0].x2 - m[0].x1, m[0].y2 - m[0].y1)), "· стоит на месте", Fx.treadMarks({ x: 5, y: 5 }, { x: 5, y: 6 }, 100).length); }
const pts = Fx.surfPoints({ x: 0, y: 0 }, { x: 100, y: 0 }, 100);
console.log("точки кильватера на восток:", pts.length, "· первая", r1(pts[0].x), "· последняя", r1(pts.at(-1).x), "· направление", pts[0].ux, pts[0].uy, "· на месте:", Fx.surfPoints({ x: 0, y: 0 }, { x: 1, y: 0 }, 100).length);

const S = await import(R + "/module/sounds.mjs");
console.log("щелчок рации:", [[70, 1, false], [100, 0.5, false], [0, 1, false], [70, 1, true]].map(([o, c, m]) => `${o}×${c}${m ? " выкл" : ""}=${r1(S.squelchVolume(o, c, m))}`).join(" "), "· файл:", S.SRC("squelch").split("/").pop());

const W = await import(R + "/module/weather-fx.mjs");
console.log("штриховка под анимацией:", ["systems/x/map/weather/rain.svg", "systems/x/map/weather/rain-badge.svg", "systems/x/map/weather/clouds.svg", "systems/x/map/weather/eye.svg", "systems/x/map/weather/tornado.svg", "systems/x/map/terrain/city.svg", null]
  .map(s => `${s?.split("/").slice(-2).join("/") ?? "—"}=${W.hatchOf(s) ?? "остаётся"}`).join(", "));
