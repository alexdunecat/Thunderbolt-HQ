// Запуск: node tests/run.mjs (сверяет вывод со снимком в tests/snapshots)
import { fileURLToPath as __f } from "node:url";
import { tmpdir as __tmp } from "node:os";
process.argv[2] ??= __f(new URL("..", import.meta.url)).replace(/\/$/, "");
process.argv[3] ??= __tmp() + "/tb-test-out";
const hooks = {}, calls = [];
globalThis.Hooks = { on: (e, f) => (hooks[e] ??= []).push(f), callAll: (e, ...a) => (hooks[e] ?? []).forEach(f => f(...a)) };
await import(process.argv[2] + "/module/delta-bridge.mjs");
Hooks.on("updateActor", (a, c, o) => calls.push(a.uuid + (o.tbBridged ? " bridged" : " native")));
const actor = { uuid: "Scene.x.Token.t.Actor.a" }, delta = { parent: { actor } };
Hooks.callAll("updateActorDelta", delta, { system: { side: "ally" } }, {}, "u");             // only delta
Hooks.callAll("updateActorDelta", delta, { system: { side: "neutral" } }, {}, "u");          // delta + native
Hooks.callAll("updateActor", actor, { system: { side: "neutral" } }, {}, "u");
await new Promise(r => setTimeout(r, 20));
console.log(calls);
