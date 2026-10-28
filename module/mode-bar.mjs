/* Полоса режима над сценой: пока идёт выбор целей щелчками или работает кисть клеток, сверху видно,
   что сейчас происходит, и есть кнопка, которая этот режим заканчивает (раньше это знал только Esc). */
import { esc } from "./utils.mjs";

let bar = null;

/**
 * Показать полосу. title — что за режим, text — подсказка, buttons — [{ label, icon, primary, onClick }].
 * Возвращает { set(title, text), close() }. Новая полоса заменяет старую.
 */
export function showModeBar({ title = "", text = "", buttons = [] } = {}) {
  bar?.close();
  const el = document.createElement("div");
  el.className = "tb-modebar";
  const paint = (t, x) => {
    el.innerHTML = `<div class="tb-modebar-txt"><b>${esc(t)}</b>${x ? `<span>${x}</span>` : ""}</div>
      <div class="tb-modebar-btns">${buttons.map((b, i) => `<button type="button" data-mb="${i}" class="${b.primary ? "primary" : ""}">${b.icon ? `<i class="fas ${b.icon}"></i> ` : ""}${esc(b.label)}</button>`).join("")}</div>`;
  };
  paint(title, text);
  el.addEventListener("click", ev => {
    const i = ev.target.closest("[data-mb]")?.dataset.mb;
    if (i !== undefined) { ev.preventDefault(); ev.stopPropagation(); buttons[i]?.onClick?.(); }
  });
  document.body.append(el);
  const me = {
    set: (t, x) => { title = t ?? title; text = x ?? text; paint(title, text); },
    close: () => { el.remove(); if (bar === me) bar = null; }
  };
  bar = me;
  return me;
}
