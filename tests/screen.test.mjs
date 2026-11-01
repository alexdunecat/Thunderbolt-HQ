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
  ["подлодка под водой", actor("npc", { kind: "ship" }, { unit: { sub: true } })], ["ЗРК", actor("npc", { kind: "ground", grp: "ad" })], ["танк", actor("npc", { kind: "ground", grp: "armor" })], ["штаб", actor("staff", {})]];
console.log("огни:", list.map(([n, a]) => `${n}=${N.lightsOf(a) ?? "—"}`).join(", "));
for (const rot of [0, 90, 180]) { const p = N.navPoints(100, 100, rot, 100); console.log(`курс ${rot}°: левый ${r1(p.left.x)},${r1(p.left.y)} правый ${r1(p.right.x)},${r1(p.right.y)} хвост ${r1(p.tail.x)},${r1(p.tail.y)}`); }
let on = 0; for (let t = 0; t < 1400; t += 10) if (N.strobeOn(t)) on++;
console.log("проблесковый: горит", on * 10, "мс из 1400 · сдвиг меняет:", N.strobeOn(0, 0) !== N.strobeOn(0, 300));
const angs = Array.from({ length: 40 }, (_, i) => N.beamAngle(i * 500));
console.log("прожектор: от", r1(Math.min(...angs) * 180 / Math.PI), "до", r1(Math.max(...angs) * 180 / Math.PI), "градусов (−90 — вверх)");

const Fx = await import(R + "/module/fx.mjs");
console.log("след по земле:", list.map(([n, a]) => `${n}=${Fx.groundTrailOf(a) ?? "—"}`).join(", "), "· объект", Fx.groundTrailOf(actor("npc", { kind: "ground", grp: "obj" })) ?? "—");
const pts = Fx.surfPoints({ x: 0, y: 0 }, { x: 100, y: 0 }, 100);
console.log("точки кильватера на восток:", pts.length, "· первая", r1(pts[0].x), "· последняя", r1(pts.at(-1).x), "· направление", pts[0].ux, pts[0].uy, "· на месте:", Fx.surfPoints({ x: 0, y: 0 }, { x: 1, y: 0 }, 100).length);

const S = await import(R + "/module/sounds.mjs");
console.log("щелчок рации:", [[70, 1, false], [100, 0.5, false], [0, 1, false], [70, 1, true]].map(([o, c, m]) => `${o}×${c}${m ? " выкл" : ""}=${r1(S.squelchVolume(o, c, m))}`).join(" "), "· без файла:", !!S.COCKPIT_SOUNDS.squelch.synth);

const W = await import(R + "/module/weather-fx.mjs");
console.log("штриховка под анимацией:", ["systems/x/map/weather/rain.svg", "systems/x/map/weather/rain-badge.svg", "systems/x/map/weather/clouds.svg", "systems/x/map/weather/eye.svg", "systems/x/map/weather/tornado.svg", "systems/x/map/terrain/city.svg", null]
  .map(s => `${s?.split("/").slice(-2).join("/") ?? "—"}=${W.hatchOf(s) ?? "остаётся"}`).join(", "));
