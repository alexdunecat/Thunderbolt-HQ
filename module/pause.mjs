/* Пауза в стиле Брифинга вместо шестерёнки Foundry: рамка HUD с надписью «ПАУЗА», подпись AWACS и бегущая полоса радара.
   Настройка мира pauseScreen выключает её и возвращает стандартную. */
import { SYSTEM_ID } from "./config.mjs";

export function registerPause() {
  game.settings.register(SYSTEM_ID, "pauseScreen", {
    name: "Пауза в стиле Брифинга", hint: "Вместо шестерёнки Foundry «Game Paused» — рамка HUD с надписью ПАУЗА.",
    scope: "world", config: true, type: Boolean, default: true, onChange: () => ui.pause?.render()
  });
  Hooks.on("renderPause", (app, html) => {
    const el = html?.[0] ?? html;
    if (!el?.classList) return;
    let on = true;
    try { on = game.settings.get(SYSTEM_ID, "pauseScreen"); } catch {}
    el.classList.toggle("tb-pause", on);
    if (on && game.paused) el.innerHTML = pauseHtml();
  });
}

export function pauseHtml() {
  return `<div class="tb-pause-frame">
    <div class="tb-pause-tag">AWACS</div>
    <div class="tb-pause-title">ПАУЗА</div>
    <div class="tb-pause-sub">ЭФИР ПРИОСТАНОВЛЕН · ОЖИДАЙТЕ КОМАНДЫ<span class="tb-pause-caret">_</span></div>
    <div class="tb-pause-sweep"></div>
  </div>`;
}
