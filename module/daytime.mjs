/* Время суток и место миссии. Ночь заметно темнит карту; место (пустыня, холод, море, горы, тропики) лишь чуть сдвигает оттенок.
   Карта (фон, рисунки, плитки погоды) тонируется полупрозрачной заливкой под токенами, поэтому машины, подписи и анимация боя
   остаются яркими, а ночью трассеры и взрывы видны ещё лучше. Задаётся в Планшете (импорт кладёт флаги сцены daytime и place)
   или кнопкой «Время и место» в панели AWACS. Рассвет и закат были, но сбивали восприятие карты: старые флаги читаются как день. */
import { SYSTEM_ID } from "./config.mjs";
import { esc } from "./utils.mjs";

export const DAYTIME = {
  day: { name: "День" },
  night: { name: "Ночь", color: 0x040a22, alpha: 0.5 }
};
/** Места: едва заметный сдвиг оттенка карты. */
export const PLACES = {
  none: { name: "Обычное" },
  desert: { name: "Пустыня", color: 0xe6aa5a, alpha: 0.08 },
  cold: { name: "Север, снега", color: 0xc8e1ff, alpha: 0.08 },
  sea: { name: "Море, побережье", color: 0x288caa, alpha: 0.07 },
  mountain: { name: "Горы", color: 0x968caa, alpha: 0.07 },
  jungle: { name: "Тропики", color: 0x3caa5a, alpha: 0.06 }
};

/** Заливки сцены снизу вверх: место, потом ночь. Пусто — день без места (или старые рассвет и закат). */
export function tintsOf(scene) {
  const place = PLACES[scene?.getFlag?.(SYSTEM_ID, "place")], time = DAYTIME[scene?.getFlag?.(SYSTEM_ID, "daytime")];
  return [place, time].filter(d => d?.color !== undefined).map(d => ({ color: d.color, alpha: d.alpha }));
}

let overlays = [];
const SpriteClass = () => foundry.canvas?.primary?.PrimarySpriteMesh ?? (typeof PrimarySpriteMesh === "function" ? PrimarySpriteMesh : null);
const tokenLayer = () => (foundry.canvas?.groups?.PrimaryCanvasGroup ?? globalThis.PrimaryCanvasGroup)?.SORT_LAYERS?.TOKENS ?? 700;

function drop(from = 0) {
  for (const o of overlays.splice(from)) try { if (!o.destroyed) o.destroy(); } catch { /* слой снят вместе со сценой */ }
}

/** Нарисовать или убрать заливки текущей сцены: на высоте 0 под всеми токенами и их тенями, над фоном и рисунками. */
export function drawDaytime() {
  const tints = canvas?.ready ? tintsOf(canvas.scene) : [];
  const PSM = SpriteClass();
  if (!tints.length || !PSM || !canvas.primary) return drop();
  drop(tints.length);
  const r = canvas.dimensions.sceneRect;
  tints.forEach((tint, i) => {
    let o = overlays[i];
    if (!o || o.destroyed) {
      o = overlays[i] = canvas.primary.addChild(new PSM({ texture: PIXI.Texture.WHITE, name: `tbDaytime.${i}` }));
      o.eventMode = "none";
    }
    o.anchor?.set(0, 0);
    o.position.set(r.x, r.y);
    o.width = r.width;
    o.height = r.height;
    o.tint = tint.color;
    o.alpha = tint.alpha;
    o.elevation = 0;
    o.sortLayer = tokenLayer();
    o.sort = -1e7 + i;
  });
}

const options = (list, cur) => Object.entries(list).map(([k, d]) => `<option value="${k}" ${k === cur ? "selected" : ""}>${esc(d.name)}</option>`).join("");

/** Окно ведущего: время суток и место текущей сцены. */
export async function daytimeDialog(scene = game.scenes?.viewed) {
  if (!game.user.isGM || !scene) return;
  const t = DAYTIME[scene.getFlag(SYSTEM_ID, "daytime")] ? scene.getFlag(SYSTEM_ID, "daytime") : "day";
  const p = PLACES[scene.getFlag(SYSTEM_ID, "place")] ? scene.getFlag(SYSTEM_ID, "place") : "none";
  const { formDialog } = await import("./dice/rolls.mjs");
  const data = await formDialog("Время и место", `<p class="tb-hint">Карта тонируется у всех. Ночь заметно темнит, место лишь чуть сдвигает оттенок. Токены и анимация боя не меняются.</p>
    <div class="form-group"><label>Время суток</label><select name="t">${options(DAYTIME, t)}</select></div>
    <div class="form-group"><label>Место</label><select name="p">${options(PLACES, p)}</select></div>`, { ok: "Поставить", width: 380 });
  if (!data) return;
  await scene.update({ [`flags.${SYSTEM_ID}.daytime`]: DAYTIME[data.t] ? data.t : "day", [`flags.${SYSTEM_ID}.place`]: PLACES[data.p] ? data.p : "none" });
}

export function registerDaytime() {
  Hooks.on("canvasReady", () => drawDaytime());
  Hooks.on("canvasTearDown", () => { overlays = []; });
  Hooks.on("updateScene", (scene, change) => {
    if (scene.id === canvas?.scene?.id && ["daytime", "place"].some(k => foundry.utils.hasProperty(change, `flags.${SYSTEM_ID}.${k}`))) drawDaytime();
  });
}
