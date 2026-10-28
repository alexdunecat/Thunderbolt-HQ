/* Кисть клеток для ведущего: погода в отдельных клетках и линия возврата прямо на сцене.
   Щелчок или протяжка по клеткам ставит или снимает (что именно — решает первая клетка мазка),
   правая кнопка или Esc заканчивают. Мазок виден подсветкой и записывается, когда кнопку отпустили. */
import { SYSTEM_ID, TB } from "./config.mjs";
import { redrawWeatherCell, redrawReturnLine, sceneCells, mapProblems } from "./apps/mission-import.mjs";
import { lineOf } from "./return-line.mjs";
import { retNorm } from "./return-rules.mjs";
import { showModeBar } from "./mode-bar.mjs";
import { esc } from "./utils.mjs";

let active = null;

/** Кисть: { kind: "wx", id } — погода id; { kind: "ret" } — клетки за линией возврата. */
export function openBrush(brush) {
  const scene = canvas?.scene;
  if (!game.user.isGM || !scene) return ui.notifications.warn("Кисть клеток: нужна сцена и права ведущего.");
  const off = mapProblems(scene);
  if (off.length) return ui.notifications.warn(`На этой сцене кисть не работает: ${off.join(", ")}.`);
  if (brush.kind === "wx") {
    if (!TB.weather[brush.id]) return;
    if ((scene.getFlag(SYSTEM_ID, "weather") ?? []).includes(brush.id))
      return ui.notifications.warn(`${TB.weather[brush.id].name} уже над всей сценой: снимите её в «Погоде над всей сценой», тогда рисуйте по клеткам.`);
  }
  active?.finish();
  const view = canvas.app.view, prevCursor = view.style.cursor;
  const { cols, rows } = sceneCells(scene);
  const gfx = canvas.interface.addChild(new PIXI.Graphics());
  gfx.eventMode = "none";
  let stroke = null;   // { add, cells: Set }
  view.style.cursor = "cell";
  const what = brush.kind === "ret" ? "линия возврата" : `${TB.weather[brush.id].ico} ${TB.weather[brush.id].name}`;
  const mb = showModeBar({ title: `Кисть: ${what}`, text: "Щёлкайте или ведите по клеткам: поставить или снять.",
    buttons: [
      ...(brush.kind === "wx" ? [{ label: "Другая погода", icon: "fa-cloud", onClick: () => { finish(); pickWeatherBrush(); } }] : []),
      { label: "Готово", icon: "fa-check", primary: true, onClick: () => finish() }
    ] });

  const cellAt = ev => {
    const r = view.getBoundingClientRect();
    const p = canvas.canvasCoordinatesFromClient?.({ x: ev.clientX, y: ev.clientY })
      ?? canvas.stage.worldTransform.applyInverse({ x: ev.clientX - r.left, y: ev.clientY - r.top });
    const gs = canvas.grid.size, c = Math.floor(p.x / gs), rr = Math.floor(p.y / gs);
    return c >= 0 && rr >= 0 && c < cols && rr < rows ? `${c},${rr}` : null;
  };
  const has = k => brush.kind === "ret"
    ? (lineOf(scene)?.cells ?? []).includes(k)
    : (scene.getFlag(SYSTEM_ID, "weatherCells")?.[k] ?? []).includes(brush.id);
  const paint = k => {
    if (!k || stroke.cells.has(k)) return;
    stroke.cells.add(k);
    const [c, r] = k.split(",").map(Number), gs = canvas.grid.size;
    gfx.beginFill(stroke.add ? 0xf2c14e : 0xd0302a, 0.28).lineStyle(3, stroke.add ? 0xf2c14e : 0xd0302a, 0.9)
      .drawRect(c * gs + 3, r * gs + 3, gs - 6, gs - 6).endFill();
  };
  const onDown = ev => {
    if (ev.target !== view) return;
    ev.stopImmediatePropagation(); ev.preventDefault();
    if (ev.button === 2) return finish();
    if (ev.button !== 0) return;
    const k = cellAt(ev);
    if (!k) return;
    stroke = { add: !has(k), cells: new Set() };
    paint(k);
  };
  const onMove = ev => { if (stroke && ev.buttons & 1) paint(cellAt(ev)); };
  const onUp = ev => {
    if (!stroke || ev.button !== 0) return;
    const s = stroke;
    stroke = null;
    commit(scene, brush, s).catch(err => { console.error(`${SYSTEM_ID} | кисть клеток`, err); ui.notifications.error(`Кисть: ${err.message}`); })
      .finally(() => gfx.clear());
  };
  const onContext = ev => { if (ev.target === view) { ev.stopImmediatePropagation(); ev.preventDefault(); } };
  const onKey = ev => { if (ev.key === "Escape") { ev.stopPropagation(); ev.preventDefault(); finish(); } };
  const finish = () => {
    window.removeEventListener("pointerdown", onDown, true);
    window.removeEventListener("pointermove", onMove, true);
    window.removeEventListener("pointerup", onUp, true);
    window.removeEventListener("contextmenu", onContext, true);
    window.removeEventListener("keydown", onKey, true);
    view.style.cursor = prevCursor;
    gfx.destroy();
    mb.close();
    active = null;
  };
  window.addEventListener("pointerdown", onDown, true);
  window.addEventListener("pointermove", onMove, true);
  window.addEventListener("pointerup", onUp, true);
  window.addEventListener("contextmenu", onContext, true);
  window.addEventListener("keydown", onKey, true);
  active = { finish };
  Hooks.once("canvasTearDown", () => active?.finish());
}

/** Кисть погоды без панели AWACS: окно с видами погоды, щелчок — кисть этой погоды. */
export function pickWeatherBrush() {
  const scene = canvas?.scene;
  if (!game.user.isGM || !scene) return ui.notifications.warn("Кисть погоды: нужна сцена и права ведущего.");
  const whole = new Set(scene.getFlag(SYSTEM_ID, "weather") ?? []);
  const cells = scene.getFlag(SYSTEM_ID, "weatherCells") ?? {};
  const count = id => Object.values(cells).filter(l => l.includes(id)).length;
  const list = Object.entries(TB.weather).map(([id, d]) => whole.has(id)
    ? `<button type="button" disabled title="Уже над всей сценой: снимите в AWACS «Миссия» → «Погода над всей сценой»"><span>${d.ico}</span>${esc(d.name)}<small>вся сцена</small></button>`
    : `<button type="button" data-wx="${id}"><span>${d.ico}</span>${esc(d.name)}${count(id) ? `<small>${count(id)} кл.</small>` : ""}</button>`).join("");
  const dlg = new Dialog({
    title: "Кисть погоды",
    content: `<div class="tb-dialog tb-wxpick">${list}</div><p class="tb-hint">Погода ложится на клетки сцены; над всей сценой её включают в AWACS.</p>`,
    buttons: { close: { label: "Закрыть" } },
    render: html => html.find("[data-wx]").on("click", ev => { dlg.close(); openBrush({ kind: "wx", id: ev.currentTarget.dataset.wx }); })
  }, { width: 420 });
  dlg.render(true);
  return dlg;
}

/** Записать мазок: флаг сцены и рисунки клеток. */
async function commit(scene, brush, { add, cells }) {
  if (brush.kind === "ret") {
    const l = lineOf(scene), set = new Set(l?.cells ?? []);
    for (const k of cells) add ? set.add(k) : set.delete(k);
    // настройки линии остаются; у новой линии — умолчания (retNorm)
    const { cells: _, ...opts } = l ?? {};
    await scene.update(set.size
      ? { [`flags.${SYSTEM_ID}.returnLine`]: { cells: [...set], ...retNorm(opts) } }
      : { [`flags.${SYSTEM_ID}.-=returnLine`]: null });
    return redrawReturnLine(scene);
  }
  const all = foundry.utils.deepClone(scene.getFlag(SYSTEM_ID, "weatherCells") ?? {});
  for (const k of cells) {
    const list = new Set(all[k] ?? []);
    add ? list.add(brush.id) : list.delete(brush.id);
    if (list.size) all[k] = [...list]; else delete all[k];
  }
  // флаг клеток целиком: объекты флагов при update сливаются, снятая клетка иначе осталась бы
  await scene.update({ [`flags.${SYSTEM_ID}.-=weatherCells`]: null });
  await scene.update({ [`flags.${SYSTEM_ID}.weatherCells`]: all });
  for (const k of cells) { const [c, r] = k.split(",").map(Number); await redrawWeatherCell(scene, c, r); }
  for (const a of game.actors) if (a.sheet?.rendered) a.sheet.render(false);
}

/** Стереть линию возврата сцены. */
export async function clearReturnLine(scene = canvas?.scene) {
  if (!scene) return;
  await scene.update({ [`flags.${SYSTEM_ID}.-=returnLine`]: null });
  return redrawReturnLine(scene);
}
