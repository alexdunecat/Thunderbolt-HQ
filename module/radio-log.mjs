/* Радиожурнал: всё, что этот игрок услышал от AWACS (субтитры и баннеры), по раундам боя.
   Реплики собирает каждый клиент сам и хранит у себя в браузере (по миру, последние 200).
   Клиент игрока отправляет каждую запись ведущему: у ведущего общий журнал с пометкой, кто что услышал
   и у кого выключены субтитры, и фильтр по игрокам. */
import { SYSTEM_ID } from "./config.mjs";
import { esc } from "./utils.mjs";

const MAX = 200, MAX_GM = 500;
const CHANNEL = `system.${SYSTEM_ID}`;
const MERGE_MS = 5000;
const key = () => `${SYSTEM_ID}.radioLog.${game.world?.id ?? "world"}`;
let entries = null;
let win = null;
let filter = "";

/** Ведущий принимает записи игроков. */
export function registerRadioLog() {
  Hooks.once("ready", () => game.socket.on(CHANNEL, msg => {
    if (msg?.type !== "radioHeard" || !game.user.isGM) return;
    store(msg.entry, msg.user);
  }));
}

function load() {
  if (entries) return entries;
  try { entries = JSON.parse(localStorage.getItem(key()) ?? "[]"); } catch { entries = []; }
  if (!Array.isArray(entries)) entries = [];
  return entries;
}
function save() {
  try { localStorage.setItem(key(), JSON.stringify(entries)); } catch { /* приватное окно: журнал живёт до перезагрузки */ }
}

/** Записать реплику или баннер, услышанные на этом клиенте. muted — субтитры у него выключены. */
export function record({ speaker, text, side = "ally", banner = null, muted = false }) {
  const c = game.combat?.started ? game.combat : null;
  const entry = { at: Date.now(), speaker, text, side, banner, round: c?.round ?? null, combat: c?.id ?? null, muted };
  store(entry, game.user.id);
  if (!game.user.isGM) game.socket?.emit(CHANNEL, { type: "radioHeard", user: game.user.id, entry });
}

/** В журнал: одна и та же реплика, услышанная несколькими игроками, — одна строка со списком слушателей. */
function store(entry, userId) {
  load();
  const who = { id: userId, muted: !!entry.muted };
  const same = entries.findLast(e => entry.at - e.at < MERGE_MS && e.speaker === entry.speaker && e.text === entry.text
    && (e.banner?.sub ?? null) === (entry.banner?.sub ?? null));
  if (same && game.user.isGM) {
    same.heard ??= [];
    if (!same.heard.some(h => h.id === userId)) same.heard.push(who);
  } else {
    if (same && !game.user.isGM) return;
    entries.push({ ...entry, heard: [who] });
  }
  const max = game.user.isGM ? MAX_GM : MAX;
  if (entries.length > max) entries.splice(0, entries.length - max);
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
    const gm = game.user.isGM;
    const name = id => game.users.get(id)?.name ?? "?";
    let html = "", last = "";
    for (const e of [...list].reverse()) {
      const heard = e.heard ?? [{ id: game.user.id, muted: e.muted }];
      if (filter && !heard.some(h => h.id === filter)) continue;
      const group = e.round ? `Раунд ${e.round}` : new Date(e.at).toLocaleDateString("ru-RU");
      const gk = `${e.combat ?? ""}:${group}`;
      if (gk !== last) { html += `<h4>${esc(group)}</h4>`; last = gk; }
      const time = new Date(e.at).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
      const line = e.banner
        ? `<b class="tb-log-${e.banner.level === "warning" ? "warning" : "caution"}">-- ${esc(e.banner.title)} --</b> ${esc(e.banner.sub ?? "")}`
        : `<b class="tb-radio-${esc(e.side)}">${esc(e.speaker)}:</b> «${esc(e.text)}»`;
      // ведущему: кто услышал; зачёркнутое имя — у игрока выключены субтитры (в журнал запись всё равно попала)
      const who = gm ? `<div class="tb-log-who">${heard.map(h => `<span class="${h.muted ? "muted" : ""}" title="${h.muted ? "субтитры выключены" : "показано на экране"}">${esc(name(h.id))}</span>`).join("")}</div>` : "";
      html += `<div class="tb-log-row${e.banner ? " tb-log-banner" : ""}"><span class="t">${time}</span>${line}${who}</div>`;
    }
    const empty = gm
      ? "Пока тихо. Здесь соберутся реплики AWACS со всех клиентов: под каждой видно, кто из игроков её услышал. Игроки должны быть в игре с версией системы не ниже этой."
      : "Пока тихо. Здесь соберутся реплики AWACS, которые слышали вы: захваты, пуски по вам, итоги залпов, погода, подкрепления и радио ведущего.";
    const users = gm ? game.users.filter(u => !u.isGM || u.isSelf) : [];
    const pick = gm ? `<select data-filter><option value="">Все слушатели</option>${users.map(u => `<option value="${u.id}" ${u.id === filter ? "selected" : ""}>${esc(u.name)}${u.active ? "" : " (не в игре)"}</option>`).join("")}</select>` : "";
    return $(`<div class="tb-radio-log-body">${pick ? `<header>${pick}</header>` : ""}<div class="tb-log-list">${html || `<p class="tb-hint">${empty}</p>`}</div>
      <footer><button type="button" data-clear><i class="fas fa-trash"></i> Очистить журнал</button></footer></div>`);
  }

  activateListeners(html) {
    super.activateListeners(html);
    html[0].querySelector("[data-filter]")?.addEventListener("change", ev => { filter = ev.target.value; this.render(false); });
    html[0].querySelector("[data-clear]")?.addEventListener("click", async () => {
      if (!(await Dialog.confirm({ title: "Радиожурнал", content: "<p>Очистить журнал в этом браузере?</p>" }))) return;
      entries = []; save(); this.render(false);
    });
  }
}
