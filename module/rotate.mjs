/* Курс токена: поворот на любой угол. Q / E — на 15° против и по часовой (с Shift — на 5°),
   кнопка «Курс» в меню токена — щёлкнуть по карте, куда смотреть носом (Esc — отмена). Работает для всех выделенных токенов.
   Автокурс (настройка мира): при перемещении машина сама разворачивается носом по курсу, при Lock On! и выстреле — на цель.
   Здания и прочие неподвижные цели не поворачиваются; токен с «Запретом поворота» Foundry тоже. */
import { SYSTEM_ID } from "./config.mjs";
import { resolveActor } from "./utils.mjs";

export function registerRotate() {
  game.keybindings.register(SYSTEM_ID, "rotLeft", {
    name: "Курс: повернуть против часовой (15°, с Shift 5°)", editable: [{ key: "KeyQ" }],
    onDown: ctx => turnSelected(ctx.isShift ? -5 : -15)
  });
  game.keybindings.register(SYSTEM_ID, "rotRight", {
    name: "Курс: повернуть по часовой (15°, с Shift 5°)", editable: [{ key: "KeyE" }],
    onDown: ctx => turnSelected(ctx.isShift ? 5 : 15)
  });
  game.settings.register(SYSTEM_ID, "autoFace", {
    name: "Автокурс токенов", hint: "Машины сами поворачиваются носом по курсу перемещения, а при Lock On! и выстреле — на цель. Здания не поворачиваются.",
    scope: "world", config: true, type: Boolean, default: true
  });
  Hooks.on("preUpdateToken", faceMove);
  // захват: стрелок разворачивается на цель у того, кто его поставил
  Hooks.on("updateActor", (actor, change, options, userId) => {
    const uuid = foundry.utils.getProperty(change, "system.lockUuid");
    if (!uuid || options?.tbUndo || userId !== game.user.id) return;
    const me = actor.isToken ? actor.token?.object : actor.getActiveTokens?.()[0];
    const t = resolveActor(uuid);
    const tt = t?.isToken ? t.token?.object : t?.getActiveTokens?.()[0];
    if (me && tt) faceToken(me, tt).catch(err => console.warn(`${SYSTEM_ID} | автокурс`, err));
  });
  Hooks.on("renderTokenHUD", addHudButton);
  // смена сцены посреди выбора курса: прежние токены уже не на этой сцене
  Hooks.on("canvasTearDown", () => picking?.cancel());
}

/* ---------- автокурс ---------- */

/** Неподвижные наземные цели: здания и объекты (группа obj) и кварталы. */
const STILL = ["hospital", "housing"];
/** Поворачивается ли машина сама: пилоты, самолёты, корабли, техника; здания нет. */
export function turns(actor) {
  if (actor?.type === "pilot") return true;
  if (actor?.type !== "npc") return false;
  const s = actor.system ?? {};
  return s.kind !== "ground" || (s.grp !== "obj" && !STILL.includes(s.key));
}
const autoFace = () => { try { return game.settings.get(SYSTEM_ID, "autoFace") !== false; } catch { return true; } };

/** Курс от точки a к точке b в градусах токена (0 — нос вверх, по часовой) или null, если точки совпадают. */
export function headingOf(a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  if (Math.hypot(dx, dy) < 2) return null;
  return norm(Math.atan2(dx, -dy) * 180 / Math.PI);
}

/** Перемещение: нос по курсу. Раскладка, отмена и подтяжка высоты (tbKeep, tbUndo, tbSync) курс не трогают. */
export function faceMove(doc, change, options = {}) {
  if (!("x" in change || "y" in change) || "rotation" in change) return;
  if (options.tbKeep || options.tbUndo || options.tbSync || doc.lockRotation || !autoFace() || !turns(doc.actor)) return;
  const h = headingOf({ x: doc.x, y: doc.y }, { x: change.x ?? doc.x, y: change.y ?? doc.y });
  if (h !== null) change.rotation = h;
}

/** Развернуть свой токен носом на другой токен (Lock On!, выстрел). */
export async function faceToken(me, target) {
  const d = me?.document;
  if (!d || !target || me === target || !d.isOwner || d.lockRotation || !autoFace() || !turns(d.actor)) return;
  const h = headingOf(me.center, target.center);
  if (h === null || Math.abs(((h - d.rotation + 540) % 360) - 180) < 1) return;
  await d.update({ rotation: h });
}

const mine = () => (canvas?.tokens?.controlled ?? []).filter(t => t.document.isOwner);
const norm = a => ((Math.round(a) % 360) + 360) % 360;

/** Повернуть выделенные. Без своих выделенных клавиша не перехватывается: Q и E достаются другим. */
function turnSelected(delta) {
  const list = mine();
  if (!list.length) return false;
  canvas.scene.updateEmbeddedDocuments("Token", list.map(t => ({ _id: t.id, rotation: norm(t.document.rotation + delta) })));
  return true;
}

/** Повернуть токены носом к точке карты (нос рисунка смотрит вверх). */
function face(list, p) {
  const updates = list.map(t => {
    const c = t.center;
    return { _id: t.id, rotation: norm(Math.atan2(p.x - c.x, c.y - p.y) * 180 / Math.PI) };
  });
  return canvas.scene.updateEmbeddedDocuments("Token", updates);
}

let picking = null;
/** Режим «Курс»: следующий щелчок по карте задаёт направление, пока мышь двигается, токены поворачиваются вслед. */
function pickHeading(list) {
  picking?.cancel();
  const meshes = list.map(t => ({ t, was: t.mesh.angle }));
  const move = ev => {
    const p = ev.getLocalPosition(canvas.stage);
    for (const { t } of meshes) { const c = t.center; t.mesh.angle = Math.atan2(p.x - c.x, c.y - p.y) * 180 / Math.PI; }
  };
  const done = async ev => {
    ev.stopPropagation();
    const p = ev.getLocalPosition(canvas.stage);
    cleanup(false);
    await face(list, p);
  };
  const key = ev => { if (ev.key === "Escape") cleanup(true); };
  const cleanup = restore => {
    canvas.stage.off("pointermove", move);
    canvas.stage.off("pointerdown", done);
    window.removeEventListener("keydown", key, true);
    if (restore) for (const { t, was } of meshes) if (!t.destroyed) t.mesh.angle = was;
    picking = null;
  };
  canvas.stage.on("pointermove", move);
  canvas.stage.once("pointerdown", done);
  window.addEventListener("keydown", key, true);
  picking = { cancel: () => cleanup(true) };
  ui.notifications.info("Курс: щёлкните по карте, куда повернуть нос. Esc — отмена. Q / E — поворот на 15°.");
}

function addHudButton(hud, html) {
  const token = hud.object;
  if (!token?.document.isOwner) return;
  const col = (html[0] ?? html).querySelector(".col.right");
  if (!col) return;
  const b = document.createElement("div");
  b.className = "control-icon tb-heading";
  b.title = "Курс: щёлкнуть по карте, куда смотреть (Q / E — 15°)";
  b.innerHTML = `<i class="fas fa-location-arrow"></i>`;
  b.addEventListener("click", ev => {
    ev.preventDefault(); ev.stopPropagation();
    const list = token.controlled ? mine() : [token];
    hud.clear();
    pickHeading(list);
  });
  col.append(b);
}
