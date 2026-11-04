/* Решение стола после героической гибели (книга, стр. 24): «Победа любой ценой» или «Достойное отступление», большинством.
   У каждого игрока открывается открытый канал эскадрильи: портрет погибшего, два исхода, лампы голосов.
   Пока голосуют, видно только, кто уже выбрал; когда набралось большинство, выбор раскрывается и AWACS объявляет исход.
   Голоса хранит карточка в чате (её правит главный ведущий), игроки шлют голос через сокет. Ничью решает ведущий. */
import { SYSTEM_ID } from "./config.mjs";
import { esc } from "./utils.mjs";

const CHANNEL = `system.${SYSTEM_ID}`;
export const OUTCOMES = {
  win: { title: "Победа любой ценой", en: "WIN AT GREAT COST", text: "Задача будет выполнена. Цена — ещё одна драматичная жертва." },
  retreat: { title: "Достойное отступление", en: "RETREAT GRACEFULLY", text: "Остальные уходят без потерь. Задача остаётся невыполненной." }
};
const isLead = () => game.users?.activeGM?.isSelf ?? game.user?.isGM;

/** Подсчёт: голоса { userId: "win" | "retreat" }, voters — кто голосует. Большинство — больше половины. */
export function tally(votes = {}, voters = []) {
  const ids = [...new Set([...voters, ...Object.keys(votes)])];
  const count = { win: 0, retreat: 0 };
  for (const id of ids) if (count[votes[id]] !== undefined) count[votes[id]]++;
  const need = Math.floor(ids.length / 2) + 1, cast = count.win + count.retreat;
  const decided = !ids.length ? null : count.win >= need ? "win" : count.retreat >= need ? "retreat" : null;
  return { ...count, need, total: ids.length, cast, decided, tie: !decided && ids.length > 0 && cast === ids.length };
}

/** Карточка в чате: запись о решении (окно — у каждого своё). */
export function verdictCard(v) {
  const t = tally(v.votes, v.voters.map(x => x.id));
  const res = v.result ? `<div class="tb-verdict-res ${v.result}"><b>${esc(OUTCOMES[v.result].title)}</b><small>${esc(OUTCOMES[v.result].text)}</small></div>` : "";
  return `<div class="tb-card tb-card-life tb-card-verdict"><header class="tb-card-head"><span class="tb-card-who">${esc(v.name)}</span><span class="tb-card-what"><i class="fas fa-skull"></i> Героическая гибель</span></header>
    <div class="tb-note">Стол решает большинством: «${OUTCOMES.win.title}» или «${OUTCOMES.retreat.title}». ${v.result ? "" : `Голосов: ${t.cast} из ${t.total}.`}</div>
    ${res}${v.result ? "" : `<div class="tb-actions"><button type="button" data-tb-verdict-open>Открыть канал эскадрильи</button></div>`}</div>`;
}

/** Окно голосования (разметка; для тестов отдельно). me — id этого пользователя, gm — показать голоса и кнопки ведущего. */
export function verdictHtml(v, { me = "", gm = false } = {}) {
  const t = tally(v.votes, v.voters.map(x => x.id)), mine = v.votes?.[me], shown = !!v.result || gm;
  const chips = which => v.voters.filter(x => !which || v.votes?.[x.id] === which).map(x =>
    `<span class="tb-vd-chip${v.votes?.[x.id] ? " cast" : ""}${x.id === me ? " me" : ""}" title="${v.votes?.[x.id] ? "голос отдан" : "думает"}"><i></i>${esc(x.name)}</span>`).join("");
  const opt = k => `<button type="button" class="tb-vd-opt ${k}${mine === k ? " picked" : ""}${v.result === k ? " won" : v.result ? " lost" : ""}" data-vd-pick="${k}" ${v.result || !(v.voters.some(x => x.id === me) || (gm && !v.voters.length)) ? "disabled" : ""}>
      <small>${OUTCOMES[k].en}</small><b>${esc(OUTCOMES[k].title)}</b><span>${esc(OUTCOMES[k].text)}</span>
      ${shown ? `<div class="tb-vd-chips">${chips(k)}</div><em>${t[k]}</em>` : ""}</button>`;
  const status = v.result ? `<div class="tb-vd-stamp ${v.result}">${esc(OUTCOMES[v.result].title)}</div>`
    : t.tie ? `<div class="tb-vd-status">Голоса разделились поровну: решает ведущий.</div>`
    : `<div class="tb-vd-status">${v.voters.length ? `Нужно ${t.need} из ${t.total}. Голос можно поменять, пока решение не принято.` : "Игроков в сети нет: решает ведущий."}</div>`;
  return `<div class="tb-vd-glass">
    <div class="tb-vd-top"><span class="tb-vd-ch"><i class="fas fa-tower-broadcast"></i> ОТКРЫТЫЙ КАНАЛ · ЭСКАДРИЛЬЯ</span><button type="button" class="tb-vd-min" data-vd-min title="Свернуть"><i class="fas fa-minus"></i></button></div>
    <div class="tb-vd-fallen">${v.img ? `<img src="${esc(v.img)}" alt="">` : `<div class="tb-vd-noimg"><i class="fas fa-user-astronaut"></i></div>`}
      <div><small>ПОТЕРЯН</small><b>${esc(v.call || v.name)}</b>${v.call && v.call !== v.name ? `<span>${esc(v.name)}</span>` : ""}<em>Последние слова остались в эфире. Кубики в этом вылете больше не бросают.</em></div></div>
    <div class="tb-vd-q">Что дальше?</div>
    <div class="tb-vd-opts">${opt("win")}${opt("retreat")}</div>
    ${shown ? "" : `<div class="tb-vd-chips all">${chips()}</div>`}
    ${status}
    ${gm && !v.result ? `<div class="tb-vd-gm"><span>Ведущий:</span><button type="button" data-vd-force="win">Решить: победа</button><button type="button" data-vd-force="retreat">Решить: отступление</button></div>` : ""}
  </div>`;
}

/* ---------- окно ---------- */

let el = null, pill = null, current = null, closeTimer = null;
const msgOf = id => game.messages?.get(id);
const stateOf = m => m?.getFlag?.(SYSTEM_ID, "verdict") ?? null;

function render(id, { reopen = false } = {}) {
  const m = msgOf(id), v = stateOf(m);
  if (!v) return;
  current = id;
  if (pill && !reopen && !v.result) { pill.querySelector("span").textContent = pillText(v); return; }
  pill?.remove(); pill = null;
  if (!el) {
    el = document.createElement("div");
    el.id = "tb-verdict"; el.className = "thunderbolt";
    el.addEventListener("click", onClick);
    document.body.append(el);
  }
  el.innerHTML = verdictHtml(v, { me: game.user.id, gm: game.user.isGM });
  el.classList.toggle("done", !!v.result);
  clearTimeout(closeTimer);
  if (v.result) closeTimer = setTimeout(close, 9000);
}
const pillText = v => { const t = tally(v.votes, v.voters.map(x => x.id)); return v.result ? OUTCOMES[v.result].title : `Канал эскадрильи: голосов ${t.cast} из ${t.total}`; };
function minimize() {
  const v = stateOf(msgOf(current));
  el?.remove(); el = null;
  if (!v || v.result) return;
  pill = document.createElement("button");
  pill.type = "button"; pill.id = "tb-verdict-pill"; pill.className = "thunderbolt";
  pill.innerHTML = `<i class="fas fa-tower-broadcast"></i> <span>${esc(pillText(v))}</span>`;
  pill.addEventListener("click", () => render(current, { reopen: true }));
  document.body.append(pill);
}
function close() { el?.remove(); el = null; pill?.remove(); pill = null; current = null; }

function onClick(ev) {
  const b = ev.target.closest("[data-vd-pick], [data-vd-force], [data-vd-min]");
  if (!b || b.disabled) return;
  if (b.dataset.vdMin !== undefined) return minimize();
  if (b.dataset.vdForce) return decide(current, b.dataset.vdForce);
  // ведущий без игроков в сети решает сам; у игрока — голос
  const v = stateOf(msgOf(current));
  if (game.user.isGM && !v?.voters.some(x => x.id === game.user.id)) return decide(current, b.dataset.vdPick);
  return vote(current, b.dataset.vdPick);
}

/* ---------- голоса и решение ---------- */

function vote(id, choice) {
  if (!OUTCOMES[choice]) return;
  if (isLead()) return record(id, game.user.id, choice);
  game.socket?.emit(CHANNEL, { type: "verdictVote", id, user: game.user.id, choice });
}
/* голоса пишутся строго по очереди: два голоса в одну секунду читали бы одну и ту же карточку, и второй стёр бы первый */
let queue = Promise.resolve();
function record(id, user, choice) {
  const run = () => recordNow(id, user, choice);
  queue = queue.then(run, run);
  return queue;
}
async function recordNow(id, user, choice) {
  const m = msgOf(id), v = foundry.utils.deepClone(stateOf(m));
  if (!v || v.result || !OUTCOMES[choice]) return;
  if (!v.voters.some(x => x.id === user)) {
    const u = game.users.get(user);
    if (!u || u.isGM) return;
    v.voters.push({ id: u.id, name: u.character?.name ? `${u.name} (${u.character.name})` : u.name });
  }
  v.votes[user] = choice;
  const t = tally(v.votes, v.voters.map(x => x.id));
  if (t.decided) return finish(m, v, t.decided);
  await m.update({ content: verdictCard(v), [`flags.${SYSTEM_ID}.verdict`]: v });
}
function decide(id, choice) {
  if (!game.user.isGM || !OUTCOMES[choice]) return;
  if (isLead()) return (queue = queue.then(() => finish(msgOf(id), foundry.utils.deepClone(stateOf(msgOf(id))), choice, true)));
  game.socket?.emit(CHANNEL, { type: "verdictForce", id, choice, user: game.user.id });
}
async function finish(m, v, choice, forced = false) {
  if (!m || !v || v.result) return;
  v.result = choice; v.forced = forced;
  await m.update({ content: verdictCard(v), [`flags.${SYSTEM_ID}.verdict`]: v });
  await game.combat?.setFlag?.(SYSTEM_ID, "verdict", choice).catch(() => null);
  const { sendRadio } = await import("./radio.mjs");
  const who = v.call || v.name;
  await sendRadio(choice === "win"
    ? { text: `Всем бортам. ${who} отдал всё, чтобы мы дошли. Продолжаем. Задача будет выполнена любой ценой.`, caution: { level: "warning", title: "MISSION CONTINUES", sub: OUTCOMES.win.title } }
    : { text: `Всем бортам, выход из района. ${who} прикрыл нас до конца. Возвращаемся домой, все.`, caution: { title: "RTB", sub: OUTCOMES.retreat.title } });
}

/** Начать голосование (главный ведущий): карточка в чате и окно у всех. */
export async function startVerdict(dead) {
  if (!isLead() || !dead) return null;
  const tok = dead.getActiveTokens?.(false, true)?.[0];
  const voters = game.users.filter(u => u.active && !u.isGM).map(u => ({ id: u.id, name: u.character?.name ? `${u.name} (${u.character.name})` : u.name }));
  const v = { dead: dead.uuid, name: dead.name, call: dead.system?.callsign || "", img: dead.img || tok?.texture?.src || "", voters, votes: {}, result: null };
  const m = await ChatMessage.create({ speaker: { alias: "AWACS" }, content: verdictCard(v), flags: { [SYSTEM_ID]: { verdict: v } } });
  game.socket?.emit(CHANNEL, { type: "verdictOpen", id: m.id });
  render(m.id, { reopen: true });
  return m;
}

export function registerVerdict() {
  Hooks.once("ready", () => {
    game.socket?.on(CHANNEL, msg => {
      if (msg?.type === "verdictOpen") return setTimeout(() => render(msg.id, { reopen: true }), 150);
      if (msg?.type === "verdictVote" && isLead()) return record(msg.id, msg.user, msg.choice);
      if (msg?.type === "verdictForce" && isLead() && game.users.get(msg.user ?? "")?.isGM) return (queue = queue.then(() => finish(msgOf(msg.id), foundry.utils.deepClone(stateOf(msgOf(msg.id))), msg.choice, true)));
    });
    // перезагрузился посреди голосования — окно снова открыто
    const open = game.messages?.contents.slice(-40).reverse().find(m => { const v = stateOf(m); return v && !v.result; });
    if (open) render(open.id, { reopen: true });
  });
  Hooks.on("updateChatMessage", m => { if (stateOf(m) && (m.id === current || (el || pill) === null)) render(m.id); });
  Hooks.on("renderChatMessage", (m, html) => {
    const root = html?.[0] ?? html;
    root?.querySelector?.("[data-tb-verdict-open]")?.addEventListener("click", () => render(m.id, { reopen: true }));
  });
}
