/* Выбор цели щелчком по токену на сцене (как клавиша T): курсор-прицел, полоса режима сверху с кнопкой отмены
   (или «Готово» в залпе), Esc или правая кнопка — то же. */
import { esc } from "./utils.mjs";
import { showModeBar } from "./mode-bar.mjs";

let active = null;

/**
 * Попросить щёлкнуть по токену цели. Целью игрока токен становится, только когда вызвавший подтвердит выбор (selectTarget).
 * Возвращает токен или null при отмене. Свой токен (self) не выбирается.
 */
let preset = null;
/** Следующий выбор цели уже сделан (совет ведущему): pickTargetToken сразу вернёт этот токен. */
export function presetPick(token) { preset = token ?? null; }

/** done — выбор нескольких целей: подпись кнопки, которая заканчивает выбор (Enter, Esc и правая кнопка тоже); hint — строка под заголовком. */
export function pickTargetToken(self, { title = "Lock On!", done = "", hint = "" } = {}) {
  if (preset) { const t = preset; preset = null; return Promise.resolve(t); }
  if (!canvas?.ready) { ui.notifications.warn("Нет активной сцены."); return Promise.resolve(null); }
  active?.cancel();
  const view = canvas.app.view;
  const current = done ? null : game.user.targets.first();
  const sheets = Object.values(ui.windows).filter(w => w.rendered && !w._minimized && w.actor === self);
  for (const w of sheets) w.minimize();

  return new Promise(resolve => {
    const prevCursor = view.style.cursor;
    view.style.cursor = "crosshair";
    const mb = showModeBar({ title, text: hint || `Щёлкните по токену цели.${current ? ` Enter — оставить «${esc(current.name)}».` : ""}`,
      buttons: [
        ...(current ? [{ label: `Оставить «${current.name}»`, icon: "fa-crosshairs", onClick: () => finish(current) }] : []),
        done ? { label: done, icon: "fa-check", primary: true, onClick: () => finish(null) } : { label: "Отмена", icon: "fa-xmark", onClick: () => finish(null) }
      ] });

    const finish = token => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("contextmenu", onContext, true);
      window.removeEventListener("keydown", onKey, true);
      view.style.cursor = prevCursor;
      mb.close();
      for (const w of sheets) w.maximize();
      active = null;
      resolve(token ?? null);
    };
    const tokenAt = ev => {
      const r = view.getBoundingClientRect();
      const p = canvas.canvasCoordinatesFromClient?.({ x: ev.clientX, y: ev.clientY })
        ?? canvas.stage.worldTransform.applyInverse({ x: ev.clientX - r.left, y: ev.clientY - r.top });
      const hits = canvas.tokens.placeables.filter(t => t.visible && t.actor && t.bounds.contains(p.x, p.y)
        && (game.user.isGM || !t.document.hidden));
      return hits.sort((a, b) => (a.document.sort ?? 0) - (b.document.sort ?? 0)).at(-1) ?? null;
    };
    // слушаем на window в фазе захвата, чтобы щелчок не дошёл до обработчиков сцены
    const onDown = ev => {
      if (ev.target !== view) return;
      ev.stopImmediatePropagation(); ev.preventDefault();
      if (ev.button === 2) return finish(null);
      if (ev.button !== 0) return;
      const t = tokenAt(ev);
      if (!t) return ui.notifications.warn("Здесь нет токена: щёлкните по самолёту или цели.");
      if (self && t.actor === self) return ui.notifications.warn("Это ваш самолёт: выберите другую цель.");
      finish(t);
    };
    const onContext = ev => { if (ev.target === view) { ev.stopImmediatePropagation(); ev.preventDefault(); } };
    const onKey = ev => {
      if (ev.key === "Escape") { ev.stopPropagation(); ev.preventDefault(); finish(null); }
      else if (ev.key === "Enter" && done) { ev.stopPropagation(); ev.preventDefault(); finish(null); }
      else if (ev.key === "Enter" && current) { ev.stopPropagation(); ev.preventDefault(); finish(current); }
    };
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("contextmenu", onContext, true);
    window.addEventListener("keydown", onKey, true);
    active = { cancel: () => finish(null) };
  });
}

/** Сделать токен целью игрока (после того как действие подтверждено). */
export function selectTarget(token) {
  token?.setTarget?.(true, { releaseOthers: true });
}
