/* Боевой экран: пока идёт бой на открытой сцене, у игрока прячутся окна Foundry, которые в бою почти не нужны:
   чат сворачивается (новые сообщения всплывают ненадолго у правого края), список сцен, игроки, инструменты слева и
   панель макросов убираются. Клавиши макросов 1–0 работают как прежде. Клавиша (по умолчанию `, «Ё») прячет или показывает
   окна до конца боя, у ведущего тоже (ему по умолчанию окна не прячутся). После боя всё возвращается как было. Настройка у каждого своя. */
import { SYSTEM_ID } from "./config.mjs";

export const SCREEN_MODES = { auto: "В бою, кроме ведущего", all: "В бою, и у ведущего тоже", off: "Не прятать" };

/** Прятать ли окна сейчас: режим настройки, ведущий ли это, идёт ли бой на открытой сцене и что выбрали клавишей в этом бою
    (override: true — спрятать, false — показать, null — как в настройке). Клавиша работает и у ведущего. */
export function screenWanted({ mode = "auto", isGM = false, inCombat = false, override = null } = {}) {
  if (!inCombat) return false;
  if (override !== null) return override;
  if (mode === "off") return false;
  return mode === "all" || !isGM;
}

let active = false, override = null, sidebarWas = null, combatId = null;
const modeNow = () => { try { const m = game.settings.get(SYSTEM_ID, "combatScreen"); return SCREEN_MODES[m] ? m : "auto"; } catch { return "auto"; } };
const inCombat = () => {
  const c = game.combat;
  return !!(c?.started && canvas?.ready && (!c.scene || c.scene.id === canvas.scene?.id));
};

/** Привести экран в соответствие бою и настройке. */
export function refreshCombatScreen() {
  if (game.combat?.id !== combatId) { combatId = game.combat?.id ?? null; override = null; }
  const want = screenWanted({ mode: modeNow(), isGM: game.user?.isGM, inCombat: inCombat(), override });
  if (want === active) return;
  active = want;
  document.body.classList.toggle("tb-combat-screen", want);
  const sb = ui.sidebar;
  try {
    if (want) {
      sidebarWas = sb?._collapsed ?? null;
      if (sb && !sb._collapsed) sb.collapse();
    } else if (sidebarWas === false && sb?._collapsed) sb.expand();
  } catch (err) { console.warn(`${SYSTEM_ID} | боевой экран`, err); }
  if (!want) sidebarWas = null;
  Hooks.callAll(`${SYSTEM_ID}.combatScreen`, want);
}

/** Клавиша: спрятать или показать окна до конца этого боя (у ведущего тоже). */
function toggle() {
  if (!inCombat()) return false;
  override = !active;
  refreshCombatScreen();
  ui.notifications.info(active ? "Боевой экран: окна Foundry спрятаны до конца боя. Та же клавиша вернёт их." : "Окна Foundry показаны до конца боя. Та же клавиша спрячет их снова.");
  return true;
}

export function registerCombatScreen() {
  game.settings.register(SYSTEM_ID, "combatScreen", {
    name: "Боевой экран", hint: "Пока идёт бой, прятать чат (сообщения всплывают у края), список сцен, игроков, инструменты слева и панель макросов. Клавиши макросов работают. Клавиша «Ё» (`) прячет или показывает окна до конца боя, у ведущего тоже.",
    scope: "client", config: true, type: String, default: "auto", choices: SCREEN_MODES, onChange: () => refreshCombatScreen()
  });
  game.keybindings.register(SYSTEM_ID, "combatScreen", {
    name: "Боевой экран: показать или спрятать окна Foundry", editable: [{ key: "Backquote" }],
    onDown: () => toggle()
  });
  for (const ev of ["canvasReady", "createCombat", "updateCombat", "deleteCombat", "combatStart"]) Hooks.on(ev, () => refreshCombatScreen());
  Hooks.once("ready", () => refreshCombatScreen());
}
