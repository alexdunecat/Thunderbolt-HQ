/* Радиожурнал: всё, что этот игрок услышал от AWACS (субтитры и баннеры), по раундам боя.
   Реплики собирает каждый клиент сам, поэтому журнал у каждого свой; хранится в браузере, по миру, последние 200. */
import { SYSTEM_ID } from "./config.mjs";
import { esc } from "./utils.mjs";

const MAX = 200;
const key = () => `${SYSTEM_ID}.radioLog.${game.world?.id ?? "world"}`;
let entries = null;
let win = null;

function load() {
  if (entries) return entries;
  try { entries = JSON.parse(localStorage.getItem(key()) ?? "[]"); } catch { entries = []; }
  if (!Array.isArray(entries)) entries = [];
  return entries;
}
function save() {
  try { localStorage.setItem(key(), JSON.stringify(entries.slice(-MAX))); } catch { /* приватное окно: журнал живёт до перезагрузки */ }
}

/** Записать реплику или баннер. */
export function record({ speaker, text, side = "ally", banner = null }) {
  load();
  const c = game.combat?.started ? game.combat : null;
  entries.push({ at: Date.now(), speaker, text, side, banner, round: c?.round ?? null, combat: c?.id ?? null });
  if (entries.length > MAX) entries.splice(0, entries.length - MAX);
  save();
  if (win?.rendered) win.render(false);
}

export function openRadioLog() {
  win ??= new RadioLog();
  win.render(true);
}

class RadioLog extends Application {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "tb-radio-log", title: "Радиожурнал AWACS", classes: ["thunderbolt", "tb-radio-log"],
      width: 440, height: 520, resizable: true
    });
  }

  async _renderInner() {
    const list = load();
    let html = "", last = "";
    for (const e of [...list].reverse()) {
      const group = e.round ? `Раунд ${e.round}` : new Date(e.at).toLocaleDateString("ru-RU");
      const gk = `${e.combat ?? ""}:${group}`;
      if (gk !== last) { html += `<h4>${esc(group)}</h4>`; last = gk; }
      const time = new Date(e.at).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
      html += e.banner
        ? `<div class="tb-log-row tb-log-banner tb-log-${e.banner.level === "warning" ? "warning" : "caution"}"><span class="t">${time}</span><b>-- ${esc(e.banner.title)} --</b> ${esc(e.banner.sub ?? "")}</div>`
        : `<div class="tb-log-row"><span class="t">${time}</span><b class="tb-radio-${esc(e.side)}">${esc(e.speaker)}:</b> «${esc(e.text)}»</div>`;
    }
    const body = html || `<p class="tb-hint">Пока тихо. Здесь соберутся реплики AWACS, которые слышали вы: захваты, пуски по вам, итоги залпов, погода, подкрепления и радио ведущего.</p>`;
    return $(`<div class="tb-radio-log-body"><div class="tb-log-list">${body}</div>
      <footer><button type="button" data-clear><i class="fas fa-trash"></i> Очистить журнал</button></footer></div>`);
  }

  activateListeners(html) {
    super.activateListeners(html);
    html[0].querySelector("[data-clear]")?.addEventListener("click", async () => {
      if (!(await Dialog.confirm({ title: "Радиожурнал", content: "<p>Очистить журнал в этом браузере?</p>" }))) return;
      entries = []; save(); this.render(false);
    });
  }
}
