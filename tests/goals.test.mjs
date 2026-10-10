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
