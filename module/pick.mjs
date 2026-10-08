/* Выбор цели щелчком по токену на сцене (как клавиша T): курсор-прицел, Esc или правая кнопка — отмена. */

let active = null;

/**
 * Попросить щёлкнуть по токену цели. Целью игрока токен становится, только когда вызвавший подтвердит выбор (selectTarget).
 * Возвращает токен или null при отмене. Свой токен (self) не выбирается.
 */
export function pickTargetToken(self, { title = "Lock On!" } = {}) {
  if (!canvas?.ready) { ui.notifications.warn("Нет активной сцены."); return Promise.resolve(null); }
  active?.cancel();
  const view = canvas.app.view;
  const current = game.user.targets.first();
  const sheets = Object.values(ui.windows).filter(w => w.rendered && !w._minimized && w.actor === self);
  for (const w of sheets) w.minimize();

  return new Promise(resolve => {
    const prevCursor = view.style.cursor;
    view.style.cursor = "crosshair";
    ui.notifications.info(`${title}: щёлкните по токену цели.${current ? ` Enter — оставить «${current.name}».` : ""} Esc или правая кнопка — отмена.`);

    const finish = token => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("contextmenu", onContext, true);
      window.removeEventListener("keydown", onKey, true);
      view.style.cursor = prevCursor;
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
