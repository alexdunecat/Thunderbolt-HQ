/* Тихие подсказки в бою: пока идёт бой на открытой сцене, информационные окошки Foundry (синие, «засчитан Move»,
   «автопилот включён», «окна показаны» и прочие, свои и системные) не выезжают плашкой во всю ширину, а коротко
   светятся строкой вверху по центру, под субтитрами радио, и гаснут сами. Предупреждения и ошибки остаются как были.
   Настройка у каждого своя («Информационные окошки в бою»): строкой, как обычно или не показывать. */
import { SYSTEM_ID } from "./config.mjs";

export const NOTE_MODES = { quiet: "Тихой строкой вверху", foundry: "Окошками Foundry, как обычно", off: "Не показывать" };
const SHOW_MS = 3800, MAX = 3;

/** Куда деть информационное окошко: "foundry" (как обычно), "quiet" (строкой) или "off". Только info и только в бою. */
export function noteRoute({ mode = "quiet", type = "info", inCombat = false, permanent = false } = {}) {
  if (type !== "info" || !inCombat || permanent || !NOTE_MODES[mode]) return "foundry";
  return mode;
}

const modeNow = () => { try { return game.settings.get(SYSTEM_ID, "infoNotes"); } catch { return "quiet"; } };
const inCombat = () => {
  const c = game.combat;
  return !!(c?.started && canvas?.ready && (!c.scene || c.scene.id === canvas.scene?.id));
};

let box = null;
/** Показать строку: повтор той же строки не множится, а продлевает её. */
export function quietNote(text) {
  if (!text) return;
  if (!box || !box.isConnected) {
    box = document.createElement("div");
    box.id = "tb-quiet-notes";
    document.body.append(box);
  }
  const same = [...box.children].find(n => n.textContent === text);
  const line = same ?? document.createElement("div");
  if (!same) {
    line.className = "tb-qn";
    line.textContent = text;
    box.append(line);
    while (box.children.length > MAX) box.firstElementChild.remove();
  }
  line.classList.remove("out");
  clearTimeout(line.tbTimer);
  line.tbTimer = setTimeout(() => { line.classList.add("out"); line.tbTimer = setTimeout(() => line.remove(), 600); }, SHOW_MS);
}

export function registerQuietNotes() {
  game.settings.register(SYSTEM_ID, "infoNotes", {
    name: "Информационные окошки в бою", hint: "Пока идёт бой, синие окошки Foundry («Move засчитан», автопилот, окна показаны и прочие) не выезжают плашкой, а коротко светятся строкой вверху и гаснут сами. Предупреждения и ошибки показываются как обычно.",
    scope: "client", config: true, type: String, default: "quiet", choices: NOTE_MODES
  });
  Hooks.once("ready", () => {
    const n = ui.notifications;
    if (!n || n.tbQuiet) return;
    const notify = n.notify.bind(n);
    n.tbQuiet = true;
    n.notify = (message, type = "info", options = {}) => {
      let route = "foundry";
      try { route = noteRoute({ mode: modeNow(), type, inCombat: inCombat(), permanent: !!options?.permanent }); } catch { route = "foundry"; }
      if (route === "foundry") return notify(message, type, options);
      if (route === "quiet") {
        const text = options?.localize ? game.i18n.localize(message) : message;
        // разметку не показываем: строка — только текст
        quietNote(new DOMParser().parseFromString(String(text ?? ""), "text/html").body.textContent.trim());
      }
      return null;
    };
  });
}
