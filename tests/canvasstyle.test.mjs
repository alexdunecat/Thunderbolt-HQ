// Запуск: node tests/run.mjs (сверяет вывод со снимком в tests/snapshots)
// Холст «Брифинга»: шрифт подписей, цвета рамок, прицел; выключение возвращает значения Foundry.
import { fileURLToPath as __f } from "node:url";
process.argv[2] ??= __f(new URL("..", import.meta.url)).replace(/\/$/, "");
const R = process.argv[2];
const hex = n => "#" + n.toString(16).padStart(6, "0");
class Token { _drawTarget(o = {}) { return JSON.stringify(o); } }
globalThis.CONFIG = { canvasTextStyle: { fontFamily: "Signika" }, Canvas: { dispositionColors: { CONTROLLED: 0xff9829, PARTY: 0x33bc4e, FRIENDLY: 0x43dfdf, NEUTRAL: 0xf1d836, HOSTILE: 0xe72124, SECRET: 0xa612d4, INACTIVE: 0x555555 } }, Token: { objectClass: Token } };
const C = await import(R + "/module/canvas-style.mjs");
const show = () => `${JSON.stringify(CONFIG.canvasTextStyle.fontFamily)} ${Object.entries(CONFIG.Canvas.dispositionColors).map(([k, v]) => `${k}=${hex(v)}`).join(" ")}`;
console.log("patch", C.patchTargetReticle(), "повторно", C.patchTargetReticle());
console.log("Foundry:", show(), "| прицел", new Token()._drawTarget());
console.log("вкл", C.applyCanvasStyle(true), "ещё раз", C.applyCanvasStyle(true));
console.log("Брифинг:", show(), "| прицел", new Token()._drawTarget({ size: 0.1 }));
console.log("выкл", C.applyCanvasStyle(false));
console.log("снова Foundry:", show(), "| прицел", new Token()._drawTarget());
