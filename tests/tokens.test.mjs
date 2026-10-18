// Запуск: node tests/run.mjs (сверяет вывод со снимком в tests/snapshots)
// Размер больших целей в местах зоны и рост старых токенов в одно место (новый размер в версии системы)
import { fileURLToPath as __f } from "node:url";
process.argv[2] ??= __f(new URL("..", import.meta.url)).replace(/\/$/, "");
const root = process.argv[2];
globalThis.Hooks = { on() {}, once() {} };
globalThis.CONST = { GRID_TYPES: { SQUARE: 1 } };
globalThis.foundry = { utils: { mergeObject: Object.assign } };
globalThis.game = { release: { generation: 12 } };
globalThis.canvas = null;
const { footprintOf } = await import(`${root}/module/config.mjs`);
const T = await import(`${root}/module/tokens.mjs`);
const tarpan = { key: "tarpan", kind: "ship", grp: "boss", rules: ["landship", "railvolley", "capsize", "overheat", "boss"].map(key => ({ key })) };
const mig = { key: "mig29", kind: "air", rules: [] };
const scinfaxi = { key: "scinfaxi", kind: "ship", grp: "boss", rules: [{ key: "superdive" }] };
for (const [n, s] of [["Тарпан", tarpan], ["МиГ-29", mig], ["Скинфакси", scinfaxi]]) console.log(`${n}: ${JSON.stringify(footprintOf(s))}`);
const one = T.cellLook([1, 1]);
const tok = (id, sys, x, y, look = one, src = "systems/thunderbolt-shtab/assets/planes/x.svg") =>
  ({ id, x, y, width: look.width, height: look.height, texture: { scaleX: look.scale, src }, actor: { type: "npc", system: sys } });
let sent = null;
const scene = { id: "s1", grid: { size: 300, type: 1 }, tokens: [
  tok("tarp", tarpan, 1225, 175, one, "systems/thunderbolt-shtab/assets/targets/landship.svg"),   // старый «Тарпан» в одно место, зона (4, 0)
  tok("mig", mig, 1250, 50),                                                                     // самолёт в той же зоне — не растёт
  tok("big", tarpan, 600, 0, T.cellLook([1, 3]))                                                 // уже нужного размера — не трогать
], updateEmbeddedDocuments: async (type, u, o) => { sent = { type, u, o }; } };
game.scenes = [scene];
await T.growTokens();
console.log(JSON.stringify(sent));
