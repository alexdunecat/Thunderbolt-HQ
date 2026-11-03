// Надписи HIT / MISS / DESTROYED: какие надписи и когда по плану схемы боя.
import { fileURLToPath as __f } from "node:url";
process.argv[2] ??= __f(new URL("..", import.meta.url)).replace(/\/$/, "");
const R = process.argv[2];
globalThis.Hooks = { on() {}, once() {} };
const C = await import(R + "/module/callouts.mjs");
const show = (k, plan) => console.log(`${k}:`, JSON.stringify(C.calloutsOf(plan)));
show("пушка попала", [{ kind: "guns", from: "A", to: "B", hit: true, n: 6 }]);
show("пушка мимо", [{ kind: "guns", from: "A", to: "B", hit: false, n: 6 }]);
show("пушка без сравнения (корабль)", [{ kind: "guns", from: "A", to: "B", hit: null }]);
show("снаряд танка", [{ kind: "cannon", from: "A", to: "B", hit: true, n: 1 }]);
show("луч EMRG по двоим", [{ kind: "beam", from: "A", rows: [{ to: "B", hit: true }, { to: "C", hit: false }] }]);
show("ковёр", [{ kind: "carpet", from: "A", rows: [{ to: "B", hit: true }, { to: "C", hit: true }] }]);
show("залп: 2 ракеты попали, одна мимо после Break!, корабль", [
  { kind: "impact", to: "B", from: ["A"], count: 2, hit: true }, { kind: "impact", to: "C", from: ["A"], count: 1, hit: false, broke: true },
  { kind: "impact", to: "S", from: ["A"], count: 9, hit: false, ship: true }, { kind: "lost", name: "X" }]);
show("пуск в бою (ракета висит до залпа)", [{ kind: "launch", from: "A", to: "B", wait: true }]);
show("ловушки Break!", [{ kind: "flares", at: "A" }]);
console.log("надписи:", Object.keys(C.CALLOUT).join(", "));
