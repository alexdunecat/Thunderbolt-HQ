// Запуск: node tests/run.mjs (сверяет вывод со снимком в tests/snapshots)
import { fileURLToPath as __f } from "node:url";
import { tmpdir as __tmp } from "node:os";
process.argv[2] ??= __f(new URL("..", import.meta.url)).replace(/\/$/, "");
process.argv[3] ??= __tmp() + "/tb-test-out";
const root = process.argv[2];
const gs = 100;
globalThis.CONST = { GRID_TYPES: { GRIDLESS: 0 } };
globalThis.CONFIG = { specialStatusEffects: {} };
globalThis.game = { scenes: { viewed: null }, combat: null };
globalThis.canvas = { ready: true, grid: { type: 1, size: gs, getOffset: p => ({ i: Math.floor(p.y / gs), j: Math.floor(p.x / gs) }) } };
const { TB } = await import(`${root}/module/config.mjs`);
const S = await import(`${root}/module/scene.mjs`);
const scene = { getFlag: (_s, k) => (k === "weather" ? ["clouds", "dust", "wind"] : null) };
// токен в клетке (col,row) на высоте alt; актёр — пилот, воздушный NPC, наземка или босс
function unit(name, col, alt, sys = {}, type = "pilot") {
  const actor = { name, type, isToken: true, system: { alt, speed: 3, props: [], rules: [], kind: "air", ...sys }, getFlag: () => null };
  const token = { center: { x: col * gs + 50, y: 50 }, document: { elevation: TB.altElevation[alt] ?? 0, parent: scene, width: 1, height: 1 }, actor };
  actor.token = { object: token };
  return { actor, token, kind: actor.system.kind === "air" || S.flyingBoss(actor) ? "air" : "ground" };
}
const P = (n, c, a, s) => unit(n, c, a, s);
const N = (n, c, a, s) => unit(n, c, a, s, "npc");
console.log("altitudes:", Object.entries(TB.altitudes).map(([k, v]) => `${k}=${v}/${TB.altElevation[k]}`).join(" "));
const reach = (a, t, r = 1) => { const x = S.reachProblems(a.actor, t, r); return `${a.actor.name} → ${t.actor.name}: dist ${x.dist}${x.problems.length ? " | " + x.problems.join(" ") : " | ok"}`; };
const st = P("Страт", 0, "strat"), hi = P("High", 0, "high"), md = P("Medium", 0, "med"), lo = P("Low", 0, "low");
const tank = N("Танк", 0, "low", { kind: "ground" });
const sam = N("ЗРК", 0, "low", { kind: "ground", rules: [{ key: "aafire" }] });
const ark = N("Аркбёрд", 0, "strat", { kind: "ship", key: "arkbird", rules: [{ key: "strato" }] });
const icbm = N("МБР", 1, "high", { key: "icbm", props: [{ key: "ballistic" }] });
for (const [a, t] of [[st, st], [st, hi], [st, md], [st, lo], [st, tank], [hi, st], [md, st], [lo, st], [sam, st], [hi, md], [hi, lo], [hi, tank], [ark, md], [ark, tank], [st, icbm], [hi, icbm]])
  console.log(reach(a, t, 2));
console.log("lift high→strat:", JSON.stringify(S.stratLift(hi.actor, st)), "strat→strat:", S.stratLift(st.actor, st), "med→strat:", S.stratLift(md.actor, st), "high→ground:", S.stratLift(hi.actor, tank));
for (const sp of [2, 3]) { const p = P(`Speed ${sp}`, 0, "high", { speed: sp }); console.log(`climb strat, speed ${sp}:`, S.climbProblem(p.actor, "strat"), "| high:", S.climbProblem(p.actor, "high")); }
console.log("climb boss:", S.climbProblem(icbm.actor, "strat"));
console.log("bosses:", ["arkbird", "icbm"].map(k => k + "=" + (k === "arkbird" ? S.flyingBoss(ark.actor) : S.flyingBoss(icbm.actor)).join("/")).join(" "));
console.log("alt of ark (sheet med):", S.altOf(ark.token, ark.actor), "| icbm (elev high):", S.altOf(icbm.token, icbm.actor));
const wx = u => { const w = S.weatherAt(u.actor, u.token); return `${u.actor.name}: ${w.list.map(d => d.id).join(",") || "—"} ev ${w.ev}`; };
console.log("weather:", [st, hi, lo].map(wx).join(" | "));
const arkMed = N("Аркбёрд на Medium", 0, "med", { kind: "ship", key: "arkbird", rules: [{ key: "strato" }] });
console.log(reach(arkMed, tank, 2));
