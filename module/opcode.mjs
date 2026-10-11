/* Служебный код в левом верхнем углу вместо наковальни Foundry, как строка данных на брифинге Ace Combat:
   USR.CONF, SAT INFO, OP INFO (имя сцены), ключ шифрования, связь AWACS (игроки в сети) и местное время.
   Коды детерминированные: из id пользователя, сцены и мира, поэтому у одного игрока они не прыгают.
   Показывается вместе с интерфейсом «Брифинга» (класс tb-brief-ui на body). */
import { esc } from "./utils.mjs";

/** Число из строки: простая хеш-функция, одинаковая на всех клиентах. */
export function hashOf(s) {
  let h = 2166136261;
  for (const ch of String(s ?? "")) h = Math.imul(h ^ ch.codePointAt(0), 16777619) >>> 0;
  return h;
}
const pad = (n, w) => String(n).padStart(w, "0");

/** Строки кода: [подпись, значение]. */
export function opLines({ userId = "", sceneId = "", sceneName = "", worldId = "", online = 0, total = 0, now = new Date() } = {}) {
  const u = hashOf(userId), s = hashOf(sceneId), w = hashOf(worldId);
  return [
    ["USR.CONF", `${pad(u % 1000, 3)}.${pad((u >>> 10) % 1000, 3)}`],
    ["SAT INFO", `MAP${pad(s % 100, 2)}-${(s >>> 8) % 9 + 1}`],
    ["OP INFO", sceneName ? sceneName.toUpperCase() : "STANDBY"],
    ["ENCRYPTION SV TAG", `${(w % 9) + 1}-${((w >>> 6) % 9) + 1}`],
    ["AWACS LINK", `${online}/${total}`],
    ["LOCAL", `${pad(now.getHours(), 2)}:${pad(now.getMinutes(), 2)}:${pad(now.getSeconds(), 2)}`]
  ];
}

export function opHtml(lines) {
  return lines.map(([k, v], i) => `<div class="tb-op-line${i === 2 ? " op" : ""}"><span class="k">${esc(k)}${k === "USR.CONF" ? "" : ":"}</span><span class="v">${esc(v)}</span></div>`).join("");
}

let box = null, timer = null;

function state() {
  const scene = game.scenes?.viewed;
  const users = (game.users?.contents ?? [...(game.users ?? [])]);
  return { userId: game.user?.id, sceneId: scene?.id, sceneName: scene?.navName || scene?.name || "", worldId: game.world?.id,
    online: users.filter(u => u.active).length, total: users.length, now: new Date() };
}

/** Встать на место логотипа: тот же угол и высота, шрифт под высоту. */
function place() {
  const logo = document.getElementById("logo");
  if (!box || !logo) return;
  const r = logo.getBoundingClientRect();
  // до навигации сцен: строкам нужно место, логотип узкий
  const nav = document.getElementById("navigation")?.getBoundingClientRect();
  const room = nav?.left > r.left ? nav.left - r.left - 10 : 190;
  const h = r.height || 80, w = Math.max(r.width || 100, Math.min(room, 230));
  Object.assign(box.style, { top: `${r.top}px`, left: `${r.left}px`, width: `${w}px`, height: `${h}px`,
    fontSize: `${Math.max(7, Math.min(11, h / 6 / 1.4)).toFixed(1)}px` });
}

function draw() {
  if (!box) return;
  const on = document.body.classList.contains("tb-brief-ui");
  box.hidden = !on;
  if (on) box.innerHTML = opHtml(opLines(state()));
}

export function registerOpCode() {
  Hooks.once("ready", () => {
    if (typeof document?.createElement !== "function") return;
    box = document.createElement("div");
    box.id = "tb-opcode";
    box.setAttribute("aria-hidden", "true");
    document.body.append(box);
    document.getElementById("logo")?.addEventListener("load", place);
    window.addEventListener("resize", place);
    place();
    draw();
    clearInterval(timer);
    timer = setInterval(draw, 1000);
  });
  for (const ev of ["canvasReady", "updateScene", "userConnected", "updateUser"]) Hooks.on(ev, () => draw());
}
