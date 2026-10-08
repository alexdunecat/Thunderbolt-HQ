/* Подсказка карты: при наведении на клетку внизу клетки появляется её местность и погода —
   мятным текстом «Брифинга» без плашки. Работает на сценах из импорта миссии (флаги terrainCells, weatherCells). */
import { SYSTEM_ID, TB } from "./config.mjs";
import { catalog } from "./apps/mission-import.mjs";

let names = null, text = null, shown = "";

export function registerMapInfo() {
  Hooks.on("canvasReady", setup);
  Hooks.on("updateScene", (scene, change) => { if (scene === canvas?.scene && change.flags) shown = ""; });
}

async function setup() {
  text?.destroy();
  text = null; shown = "";
  if (!canvas.scene?.getFlag(SYSTEM_ID, "terrainCells")) return;
  names ??= Object.fromEntries((await catalog()).terrain.map(t => [t.id, t.name + (t.note ? ` · ${t.note}` : "")]));
  const style = PreciseText.getTextStyle({ fontFamily: "Jura", fontSize: 20, fill: "#d7eee6", stroke: "#07141a", strokeThickness: 5, align: "center",
    wordWrap: true, wordWrapWidth: (canvas.grid.size ?? 200) - 12 });
  text = canvas.interface.addChild(new PreciseText("", style));
  text.anchor.set(0.5, 1);
  text.eventMode = "none";
  text.visible = false;
  canvas.stage.on("pointermove", hover);
}

function hover(event) {
  if (!text || text.destroyed) return;
  const scene = canvas.scene, gs = canvas.grid.size;
  const p = event.getLocalPosition(canvas.stage);
  const c = Math.floor(p.x / gs), r = Math.floor(p.y / gs), k = `${c},${r}`;
  const ter = scene.getFlag(SYSTEM_ID, "terrainCells")?.[k];
  if (!ter) { text.visible = false; shown = ""; return; }
  if (k === shown && text.visible) return;
  shown = k;
  const fx = (scene.getFlag(SYSTEM_ID, "weatherCells")?.[k] ?? []).map(id => TB.weather[id] ? `${TB.weather[id].ico} ${TB.weather[id].name}` : "").filter(Boolean);
  text.text = [names?.[ter] ?? ter, ...fx].join("\n");
  text.position.set(c * gs + gs / 2, (r + 1) * gs - 6);
  text.visible = true;
}
