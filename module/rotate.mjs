/* Курс токена: поворот на любой угол. Q / E — на 15° против и по часовой (с Shift — на 5°),
   кнопка «Курс» в меню токена — щёлкнуть по карте, куда смотреть носом (Esc — отмена). Работает для всех выделенных токенов. */
import { SYSTEM_ID } from "./config.mjs";

export function registerRotate() {
  game.keybindings.register(SYSTEM_ID, "rotLeft", {
    name: "Курс: повернуть против часовой (15°, с Shift 5°)", editable: [{ key: "KeyQ" }],
    onDown: ctx => { turnSelected(ctx.isShift ? -5 : -15); return true; }
  });
  game.keybindings.register(SYSTEM_ID, "rotRight", {
    name: "Курс: повернуть по часовой (15°, с Shift 5°)", editable: [{ key: "KeyE" }],
    onDown: ctx => { turnSelected(ctx.isShift ? 5 : 15); return true; }
  });
  Hooks.on("renderTokenHUD", addHudButton);
}

const mine = () => (canvas?.tokens?.controlled ?? []).filter(t => t.document.isOwner);
const norm = a => ((Math.round(a) % 360) + 360) % 360;

function turnSelected(delta) {
  const list = mine();
  if (!list.length) return;
  canvas.scene.updateEmbeddedDocuments("Token", list.map(t => ({ _id: t.id, rotation: norm(t.document.rotation + delta) })));
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
