/* Совместимость с модулем PopOut!: вынесенное в отдельное окно приложение получает скин системы и тёмные окна,
   а смена скина или тёмных окон доходит и до уже вынесенных окон. PopOut! копирует атрибуты body только в момент выноса. */

/** Документы окон, вынесенных PopOut! (пусто, если модуля нет). */
function popoutDocs() {
  try {
    // PopoutModule объявлен классом в обычном скрипте модуля: виден по имени, но не как window.PopoutModule
    // eslint-disable-next-line no-undef
    const mod = typeof PopoutModule !== "undefined" ? PopoutModule.singleton : null;
    return [...(mod?.poppedOut?.values() ?? [])].map(s => s.window?.document).filter(d => d?.body);
  } catch { return []; }
}

/** Скопировать скин и тёмные окна с главного окна на body другого документа. */
export function mirrorBody(doc) {
  const from = document.body, to = doc?.body;
  if (!to || to === from) return;
  if (from.dataset.tbSkin) to.dataset.tbSkin = from.dataset.tbSkin;
  to.classList?.toggle("tb-dark-ui", !!from.classList?.contains("tb-dark-ui"));
}

/** Обновить все вынесенные окна (после смены скина или тёмных окон). */
export function mirrorPopouts() {
  for (const doc of popoutDocs()) mirrorBody(doc);
}

export function registerPopout() {
  Hooks.on("PopOut:loaded", (_app, node) => mirrorBody(node?.ownerDocument));
}
