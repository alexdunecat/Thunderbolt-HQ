// Запуск: node tests/run.mjs (сверяет вывод со снимком в tests/snapshots)
import { fileURLToPath as __f } from "node:url";
import { tmpdir as __tmp } from "node:os";
process.argv[2] ??= __f(new URL("..", import.meta.url)).replace(/\/$/, "");
process.argv[3] ??= __tmp() + "/tb-test-out";
const root = process.argv[2];
globalThis.Hooks = { on(){}, once(){} }; globalThis.CONFIG = { specialStatusEffects: { DEFEATED: "dead" } };
globalThis.foundry = { utils: { getProperty: () => null } }; globalThis.game = { settings: { get(){} } };
const { targetGoals } = await import(root + "/module/losses.mjs");
const tok = (name, task, down) => ({ name, actor: { type: "npc", system: { priority: true, task, markers: { doom: down } }, statuses: new Set() } });
const scene = { tokens: [tok("Ту-22М3", "destroy", false), tok("Танкер", "protect", false), tok("Радар", "mark", false)] };
console.log(targetGoals(scene, [{ name: "МиГ", task: "intercept", how: "down" }, { name: "Конвой", task: "escort", how: "down" }, { name: "Ан-12", task: "destroy", how: "retreat" }]).join("\n"));
// по ходу боя: реплика AWACS о выбывшей приоритетной цели
globalThis.TB_DUMMY = 1;
const G = await import(root + "/module/goal-calls.mjs");
const gt = (name, task, st = {}) => ({ name, hidden: !!st.hidden, actor: { type: "npc", uuid: "A." + name, system: { priority: true, task, markers: { doom: !!st.doom } },
  statuses: new Set(st.retreat ? ["retreat"] : []), getFlag: (s, k) => (k === "down" && st.down ? { combat: "C" } : null) } });
const ts = [gt("Ту-22М3 №1", "destroy", { down: true }), gt("Ту-22М3 №2", "destroy"), gt("Ту-22М3 №3", "destroy"), gt("Танкер", "protect"), gt("Резерв", "destroy", { hidden: true }), gt("Радар", "mark", { down: true })];
const goals = G.liveGoals(ts, "C");
console.log("цели боя:", goals.map(g => `${g.name} ${g.out ?? "в бою"}`).join(", "));
for (const g of goals.filter(g => g.out)) console.log("  →", JSON.stringify(G.goalCall(g, goals)));
ts[1] = gt("Ту-22М3 №2", "destroy", { doom: true }); ts[2] = gt("Ту-22М3 №3", "destroy", { retreat: true });
const g2 = G.liveGoals(ts, "C");
for (const n of ["Ту-22М3 №2", "Ту-22М3 №3"]) console.log("  →", JSON.stringify(G.goalCall(g2.find(g => g.name === n), g2)));
ts[2] = gt("Ту-22М3 №3", "destroy", { down: true }); ts[3] = gt("Танкер", "protect", { down: true });
const g3 = G.liveGoals(ts, "C");
for (const n of ["Ту-22М3 №3", "Танкер"]) console.log("  →", JSON.stringify(G.goalCall(g3.find(g => g.name === n), g3)));
const noRes = ts.filter(t => t.name !== "Резерв");
const g4 = G.liveGoals(noRes, "C");
console.log("без подкрепления:", JSON.stringify(G.goalCall(g4.find(g => g.name === "Ту-22М3 №3"), g4)));
noRes[2] = gt("Ту-22М3 №3", "destroy", { retreat: true });
const g5 = G.liveGoals(noRes, "C");
console.log("одна ушла:", JSON.stringify(G.goalCall(g5.find(g => g.name === "Ту-22М3 №2"), g5)));
