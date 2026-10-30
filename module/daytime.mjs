/* Время суток миссии: рассвет, день, закат или ночь. Карта (фон, рисунки, плитки погоды) тонируется полупрозрачной заливкой
   под токенами, поэтому машины, подписи и анимация боя остаются яркими, а ночью трассеры и взрывы видны ещё лучше.
   Задаётся в Планшете (импорт кладёт флаг сцены daytime) или кнопкой «Время суток» в панели AWACS. */
import { SYSTEM_ID } from "./config.mjs";
import { esc } from "./utils.mjs";

export const DAYTIME = {
  day: { name: "День" },
  dawn: { name: "Рассвет", color: 0xff96aa, alpha: 0.14 },
  dusk: { name: "Закат", color: 0xff6e3c, alpha: 0.22 },
  night: { name: "Ночь", color: 0x040a22, alpha: 0.5 }
};

/** Тонировка сцены: { color, alpha } или null (день или не задано). */
export const tintOf = scene => {
  const d = DAYTIME[scene?.getFlag?.(SYSTEM_ID, "daytime")];
  return d?.color !== undefined ? { color: d.color, alpha: d.alpha } : null;
};

let overlay = null;
const SpriteClass = () => foundry.canvas?.primary?.PrimarySpriteMesh ?? (typeof PrimarySpriteMesh === "function" ? PrimarySpriteMesh : null);
const tokenLayer = () => (foundry.canvas?.groups?.PrimaryCanvasGroup ?? globalThis.PrimaryCanvasGroup)?.SORT_LAYERS?.TOKENS ?? 700;

function drop() {
  try { if (overlay && !overlay.destroyed) overlay.destroy(); } catch { /* слой снят вместе со сценой */ }
  overlay = null;
}

/** Нарисовать или убрать заливку текущей сцены: на высоте 0 под всеми токенами и их тенями, над фоном и рисунками. */
export function drawDaytime() {
  const tint = canvas?.ready ? tintOf(canvas.scene) : null;
  const PSM = SpriteClass();
  if (!tint || !PSM || !canvas.primary) return drop();
  if (!overlay || overlay.destroyed) {
    overlay = canvas.primary.addChild(new PSM({ texture: PIXI.Texture.WHITE, name: "tbDaytime" }));
    overlay.eventMode = "none";
  }
  const r = canvas.dimensions.sceneRect;
  overlay.anchor?.set(0, 0);
  overlay.position.set(r.x, r.y);
  overlay.width = r.width;
  overlay.height = r.height;
  overlay.tint = tint.color;
  overlay.alpha = tint.alpha;
  overlay.elevation = 0;
  overlay.sortLayer = tokenLayer();
  overlay.sort = -1e7;
}

/** Окно ведущего: время суток текущей сцены. */
export async function daytimeDialog(scene = game.scenes?.viewed) {
  if (!game.user.isGM || !scene) return;
  const cur = scene.getFlag(SYSTEM_ID, "daytime") || "day";
  const { formDialog } = await import("./dice/rolls.mjs");
  const data = await formDialog("Время суток", `<p class="tb-hint">Карта тонируется у всех: рассвет розовым, закат рыжим, ночь тёмно-синим. Токены и анимация боя не темнеют.</p>
    <div class="form-group"><label>Сейчас</label><select name="t">${Object.entries(DAYTIME).map(([k, d]) => `<option value="${k}" ${k === cur ? "selected" : ""}>${esc(d.name)}</option>`).join("")}</select></div>`, { ok: "Поставить", width: 380 });
  if (!data) return;
  await scene.setFlag(SYSTEM_ID, "daytime", DAYTIME[data.t] ? data.t : "day");
}

export function registerDaytime() {
  Hooks.on("canvasReady", () => drawDaytime());
  Hooks.on("canvasTearDown", () => { overlay = null; });
  Hooks.on("updateScene", (scene, change) => {
    if (scene.id === canvas?.scene?.id && foundry.utils.hasProperty(change, `flags.${SYSTEM_ID}.daytime`)) drawDaytime();
  });
}
