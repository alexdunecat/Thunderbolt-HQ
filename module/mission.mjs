/* Итог миссии, как в Ace Combat: крупный баннер посреди экрана у всех и реплика AWACS.
   Провалена — красный, завершена и выполнена — синий, отменена — жёлтый.
   Выполнена: все цели достигнуты. Завершена и отменена: ход миссии по решению AWACS (ведущего).
   Провалена: пилоты отступили или сбиты, либо цели не выполнены (транспорт конвоя сбит, цели ушли, вышло время,
   МБР улетела, обнаружили на стелс-миссии и т. п.).
   Окно открывается кнопкой «Итог миссии» в панели AWACS, из «Радио» и само после конца боя с подсказкой по сводке. */
import { SYSTEM_ID } from "./config.mjs";
import { esc } from "./utils.mjs";

export const MISSION_RESULTS = {
  success: { title: "МИССИЯ ВЫПОЛНЕНА", color: "blue", hint: "все цели достигнуты",
    line: "Все цели поражены. Задание выполнено, отличная работа! Всем бортам, возвращайтесь на базу." },
  complete: { title: "МИССИЯ ЗАВЕРШЕНА", color: "blue", hint: "AWACS заканчивает миссию: главное сделано или дальше тянуть нельзя",
    line: "Задание завершено. Всем бортам, возвращайтесь на базу." },
  aborted: { title: "МИССИЯ ОТМЕНЕНА", color: "yellow", hint: "AWACS отменяет миссию по своему решению",
    line: "Задание отменено командованием. Всем бортам, немедленно возвращайтесь на базу." },
  failed: { title: "МИССИЯ ПРОВАЛЕНА", color: "red", hint: "пилоты отступили или сбиты, либо цели не выполнены",
    line: "Задание провалено. Всем бортам, возвращайтесь на базу." }
};

/** Причины провала: подпись под баннером. */
export const FAIL_REASONS = [
  "Все пилоты сбиты", "Эскадрилья отступила", "Цели миссии не выполнены", "Транспорт конвоя сбит", "Цели ушли из района",
  "Время вышло", "Баллистическая ракета ушла", "Нас обнаружили", "Защищаемый объект уничтожен"
];

export function registerMission() {
  game.settings.register(SYSTEM_ID, "missionPrompt", {
    name: "Спрашивать итог миссии после боя", hint: "После End combat ведущему откроется окно «Итог миссии» с подсказкой по сводке боя: баннер МИССИЯ ВЫПОЛНЕНА, ЗАВЕРШЕНА, ОТМЕНЕНА или ПРОВАЛЕНА у всех на экране.",
    scope: "world", config: true, type: Boolean, default: true
  });
}

/**
 * Подсказка по сводке боя: { result, reason } или null, если решать ведущему.
 * pilots — сколько пилотов игроков было в бою; losses — записи потерь (losses.mjs); goals — { done } по приоритетным целям.
 */
export function suggestResult({ pilots = 0, losses = [], goals = [] }) {
  const lost = losses.filter(r => r.pilot);
  if (pilots && lost.length >= pilots) {
    const down = lost.filter(r => r.how === "down").length;
    return { result: "failed", reason: down >= pilots || down > lost.length - down ? "Все пилоты сбиты" : "Эскадрилья отступила" };
  }
  const judged = goals.filter(g => g.done !== null);
  if (judged.some(g => !g.done)) {
    const fled = judged.find(g => !g.done && g.how === "retreat");
    const lostEscort = judged.find(g => !g.done && g.keep);
    return { result: "failed", reason: fled ? "Цели ушли из района" : lostEscort ? (lostEscort.task === "escort" ? "Транспорт конвоя сбит" : "Защищаемый объект уничтожен") : "Цели миссии не выполнены" };
  }
  if (judged.length && judged.every(g => g.done)) return { result: "success", reason: "" };
  return null;
}

/** Окно «Итог миссии» для ведущего. suggest — подсказка (suggestResult), op — название операции. */
export function openMissionDialog({ suggest = null, op = "" } = {}) {
  if (!game.user.isGM) return;
  const pick = suggest?.result ?? "";
  const radios = Object.entries(MISSION_RESULTS).map(([k, r]) => `<label class="tb-mission-pick tb-mission-${r.color}">
      <input type="radio" name="result" value="${k}" ${k === pick ? "checked" : ""}> <b>${esc(r.title)}</b> <small>${esc(r.hint)}</small></label>`).join("");
  const reasons = FAIL_REASONS.map(r => `<option value="${esc(r)}">`).join("");
  const content = `<form class="tb-dialog tb-mission-form">
    ${suggest ? `<p class="tb-hint">По сводке боя: <b>${esc(MISSION_RESULTS[suggest.result].title.toLowerCase())}</b>${suggest.reason ? ` (${esc(suggest.reason.toLowerCase())})` : ""}. Решает AWACS.</p>` : ""}
    ${radios}
    <div class="form-group"><label>Подпись под баннером</label><input type="text" name="sub" list="tb-fail-reasons" value="${esc(suggest?.reason ?? "")}" placeholder="${esc(op || "необязательно")}"><datalist id="tb-fail-reasons">${reasons}</datalist></div>
    <div class="form-group"><label><input type="checkbox" name="say" checked> Реплика AWACS</label></div>
    <div class="form-group stacked"><textarea name="line" rows="2">${esc(MISSION_RESULTS[pick]?.line ?? "")}</textarea></div>
    <p class="tb-hint">Баннер появится посреди экрана у всех игроков, реплика вверху, обе останутся в чате и радиожурнале.</p></form>`;
  new Dialog({
    title: "Итог миссии", content,
    buttons: {
      ok: { icon: '<i class="fas fa-flag-checkered"></i>', label: "На экран", callback: html => {
        const f = html[0].querySelector("form");
        const result = f.querySelector("[name=result]:checked")?.value;
        if (!result) return ui.notifications.warn("Итог миссии: выберите, чем она закончилась.");
        announceMission({ result, sub: f.sub.value.trim(), text: f.say.checked ? f.line.value.trim() : "" });
      } },
      cancel: { label: "Не показывать" }
    },
    default: "ok",
    render: html => {
      const f = html[0].querySelector("form");
      f.querySelectorAll("[name=result]").forEach(r => r.addEventListener("change", () => {
        const def = Object.values(MISSION_RESULTS).map(x => x.line);
        // реплику меняем на заготовку, только если её не правили
        if (!f.line.value.trim() || def.includes(f.line.value.trim())) f.line.value = MISSION_RESULTS[r.value].line;
        if (r.value !== "failed" && FAIL_REASONS.includes(f.sub.value)) f.sub.value = "";
      }));
    }
  }, { classes: ["dialog", "thunderbolt"], width: 460 }).render(true);
}

/** Баннер итога у всех (через сообщение чата с флагом radio) и реплика AWACS. */
export async function announceMission({ result, sub = "", text = "" }) {
  const r = MISSION_RESULTS[result];
  if (!r) return;
  const { sendRadio } = await import("./radio.mjs");
  return sendRadio({ text, caution: { title: r.title, sub, level: result, mission: true } });
}
