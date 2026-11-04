/* Масштаб интерфейса системы от разрешения и размера шрифта Foundry.
   В Foundry 12 размер интерфейса задаёт настройка ядра «Размер шрифта» (Core → Font Size): она меняет базовый размер
   шрифта страницы, и окна Foundry растут вместе с ним. Наши окна (HUD, стекло заявки и метки, канал эскадрильи,
   задачи, радио) рисуются в пикселях и этого не видели. Теперь у них общий множитель --tb-ui:
   «Авто» — высота окна браузера к 1080 (0,8…1,35) × базовый шрифт Foundry к 14 px; или постоянный процент.
   Пересчитывается при смене размера окна, настройки и шрифта Foundry. */
import { SYSTEM_ID } from "./config.mjs";

export const UI_MODES = { auto: "Авто: по разрешению и размеру шрифта Foundry", "0.8": "80%", "0.9": "90%", "1": "100%", "1.1": "110%", "1.25": "125%", "1.4": "140%" };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/** Множитель: mode — "auto" или число; height — высота окна; rootPx — базовый шрифт страницы (у Foundry по умолчанию 14). */
export function uiScaleOf({ mode = "auto", height = 1080, rootPx = 14 } = {}) {
  const fixed = Number(mode);
  if (mode !== "auto" && fixed > 0) return fixed;
  const res = clamp((Number(height) || 1080) / 1080, 0.8, 1.35), font = clamp((Number(rootPx) || 14) / 14, 0.7, 1.6);
  return Math.round(clamp(res * font, 0.7, 1.8) * 20) / 20;
}

let current = 1;
/** Текущий множитель (для HUD и окон, считающих место в JS). */
export const uiScale = () => current;

function apply() {
  if (typeof document === "undefined" || !document.documentElement) return;
  let mode = "auto";
  try { mode = game.settings.get(SYSTEM_ID, "uiScale") ?? "auto"; } catch { mode = "auto"; }
  const rootPx = parseFloat(getComputedStyle(document.documentElement).fontSize) || 14;
  const s = uiScaleOf({ mode, height: window.innerHeight, rootPx });
  if (s === current && document.documentElement.style.getPropertyValue("--tb-ui")) return;
  current = s;
  document.documentElement.style.setProperty("--tb-ui", String(s));
  Hooks.callAll(`${SYSTEM_ID}.uiScale`, s);
}

export function registerUiScale() {
  game.settings.register(SYSTEM_ID, "uiScale", {
    name: "Масштаб окон системы", hint: "Размер HUD, стёкол заявки и метки, канала эскадрильи, задач и радио. «Авто» подстраивает их под высоту окна браузера и под настройку ядра «Размер шрифта» (её меняют в Настройках ядра — окна Foundry и окна системы растут вместе). Размер HUD поверх этого — «Размер HUD по углам».",
    scope: "client", config: true, type: String, default: "auto", choices: UI_MODES, onChange: () => apply()
  });
  let t = null;
  const soon = () => { clearTimeout(t); t = setTimeout(apply, 150); };
  Hooks.once("ready", () => {
    apply();
    globalThis.window?.addEventListener?.("resize", soon);
    // «Размер шрифта» Foundry меняет стиль корня страницы: следим за ним, без привязки к имени настройки ядра
    try { new MutationObserver(soon).observe(globalThis.document.documentElement, { attributes: true, attributeFilter: ["style", "class"] }); } catch { /* без наблюдателя — по resize */ }
  });
}
