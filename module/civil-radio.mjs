/* Гражданское радио: музыка с YouTube у всех за столом.
   Сам Foundry ролики YouTube не играет, поэтому у каждого клиента спрятан плеер YouTube (IFrame API) за краем экрана:
   видео не видно, слышен только звук. Управляют ведущий и игроки, у чьего пилота есть триггер «Внешний мир»
   (в кабине стоит гражданское радио). Команда меняет общее состояние (очередь, трек, играет ли и с какой секунды)
   и расходится по сокету; каждый клиент сам подстраивает свой плеер под это состояние по времени сервера.
   Ведущий хранит состояние в настройке мира, чтобы его получили и зашедшие позже.
   Громкость — ползунок «Музыка» во вкладке плейлистов Foundry, у каждого своя.
   Диджей (только ведущий): когда начинается новый трек, с заданной вероятностью вставляет в эфир реплику субтитрами,
   как переговоры NPC. Реплики и имя свои у сцены (флаг сцены dj) или общие для всех сцен (настройка мира dj). */
import { SYSTEM_ID } from "./config.mjs";
import { esc } from "./utils.mjs";
import { sendRadio } from "./radio.mjs";

const CHANNEL = `system.${SYSTEM_ID}`;
export const RADIO_TRIGGER = "outside";
// {track} — название трека, который сейчас начнётся
export const DJ_DEFAULT = {
  name: "Диджей",
  lines: [
    "С вами ночная смена. Не выключайте приёмник: дальше {track}.",
    "Для всех, кто сейчас за штурвалом, где бы вы ни были, звучит {track}.",
    "Сводку новостей прочитаем позже. А пока просто музыка.",
    "Нам дозвонились с аэродрома, просят погромче. Делаем погромче!",
    "Над побережьем ясно, видимость отличная. Самое время для {track}.",
    "Если вы слышите нас в кабине, держитесь там. Эта песня для вас.",
    "Говорят, на частоте опять помехи. Не верьте, это мы так звучим. В эфире {track}."
  ]
};
const DRIFT = 2;              // секунд расхождения, после которых плеер перематывается
const EMPTY = { rev: 0, queue: [], cur: -1, li: 0, playing: false, t0: 0, pos: 0 };
const YT_ERRORS = { 2: "неверная ссылка", 5: "плеер не смог его воспроизвести", 100: "ролик удалён или скрыт", 101: "автор запретил встраивание", 150: "автор запретил встраивание" };

let state = { ...EMPTY };
let player = null, playerReady = null, loaded = null, win = null, saveTimer = null, unlock = null, ticker = null, djLast = null;

/** Ролик или плейлист из ссылки YouTube (или голый id ролика): { v, list } либо null. */
export function parseYouTube(text) {
  const s = String(text ?? "").trim();
  if (/^[\w-]{11}$/.test(s)) return { v: s, list: null };
  let u;
  try { u = new URL(/^https?:/i.test(s) ? s : `https://${s}`); } catch { return null; }
  const host = u.hostname.replace(/^(www|m|music)\./, "");
  let v = null;
  if (host === "youtu.be") v = u.pathname.slice(1).split("/")[0];
  else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    v = u.searchParams.get("v") ?? u.pathname.match(/^\/(?:embed|shorts|live|v)\/([\w-]{11})/)?.[1] ?? null;
  } else return null;
  let list = u.searchParams.get("list");
  if (v && !/^[\w-]{11}$/.test(v)) v = null;
  if (list && !/^[\w-]+$/.test(list)) list = null;
  // микс YouTube (list=RD…) собирается под зрителя и во встроенном плеере не играет: беру сам ролик
  if (list?.startsWith("RD")) {
    v ??= list.match(/^RD([\w-]{11})$/)?.[1] ?? null;
    if (v) list = null;
  }
  if (!v && !list) return null;
  return { v, list };
}

/** С какой секунды трека сейчас должен звучать звук. */
export function expectedPos(s, now) {
  return s.playing ? Math.max(0, (now - s.t0) / 1000) : s.pos;
}

/** Новое состояние после команды. info — что знает о текущем плейлисте плеер этого клиента: { length, index, time }. */
export function applyCommand(s, cmd, now, info = {}) {
  const n = { ...s, queue: [...s.queue], rev: Math.max(now, s.rev + 1) };
  const startAt = (cur, li = 0) => Object.assign(n, { cur, li, playing: true, t0: now, pos: 0 });
  const stop = () => Object.assign(n, { cur: -1, li: 0, playing: false, t0: 0, pos: 0 });
  if (!n.queue.length && !["add", "stop", "clear"].includes(cmd.op)) return s;
  switch (cmd.op) {
    case "add": {
      n.queue.push(cmd.entry);
      if (cmd.now || s.cur < 0) startAt(n.queue.length - 1);
      break;
    }
    case "remove": {
      const i = n.queue.findIndex(e => e.id === cmd.id);
      if (i < 0) break;
      n.queue.splice(i, 1);
      if (i < s.cur) n.cur = s.cur - 1;
      else if (i === s.cur) n.queue.length ? startAt(Math.min(i, n.queue.length - 1)) : stop();
      if (!n.queue.length) stop();
      break;
    }
    case "jump": {
      const i = n.queue.findIndex(e => e.id === cmd.id);
      if (i >= 0) startAt(i);
      break;
    }
    case "pause":
      if (s.cur >= 0 && s.playing) Object.assign(n, { playing: false, pos: expectedPos(s, now) });
      break;
    case "play":
      if (s.cur >= 0 && !s.playing) Object.assign(n, { playing: true, t0: now - s.pos * 1000 });
      else if (s.cur < 0 && n.queue.length) startAt(0);
      break;
    case "next": {
      const e = s.queue[s.cur];
      if (e?.list && info.length && s.li < info.length - 1) startAt(s.cur, s.li + 1);
      else if (s.cur + 1 < n.queue.length) startAt(s.cur + 1);
      else stop();
      break;
    }
    case "prev": {
      const e = s.queue[s.cur];
      if (expectedPos(s, now) > 5) startAt(s.cur, s.li);
      else if (e?.list && s.li > 0) startAt(s.cur, s.li - 1);
      else startAt(Math.max(0, s.cur));
      break;
    }
    // плейлист YouTube сам перешёл на следующий ролик: запомнить, чтобы все были на нём же
    case "listIndex":
      if (s.cur >= 0) Object.assign(n, { li: info.index, playing: true, t0: now - (info.time ?? 0) * 1000, pos: 0 });
      break;
    case "stop": stop(); break;
    case "clear": n.queue = []; stop(); break;
  }
  return n;
}

/** Может ли пользователь управлять радио: ведущий или у его пилота триггер «Внешний мир». */
export function canControl(user = game.user) {
  if (!user) return false;
  if (user.isGM) return true;
  const owned = game.actors?.filter?.(a => a.type === "pilot" && a.testUserPermission?.(user, "OWNER")) ?? [];
  if (user.character && !owned.includes(user.character)) owned.push(user.character);
  return owned.some(a => a.items?.some?.(i => i.type === "trigger" && i.system?.key === RADIO_TRIGGER));
}

const now = () => game.time?.serverTime ?? Date.now();
const isGM = () => game.user?.isGM;
// кто доигрывает очередь (следующий трек, переход плейлиста): активный ведущий, без него — первый из тех, кто управляет
function isDriver() {
  const active = game.users?.filter?.(u => u.active) ?? [];
  const gm = active.filter(u => u.isGM).sort((a, b) => a.id.localeCompare(b.id))[0];
  if (gm) return gm.id === game.user.id;
  const lead = active.filter(u => canControl(u)).sort((a, b) => a.id.localeCompare(b.id))[0];
  return lead?.id === game.user.id;
}

export function registerCivilRadio() {
  game.settings.register(SYSTEM_ID, "civilRadio", { scope: "world", config: false, type: Object, default: EMPTY });
  game.settings.register(SYSTEM_ID, "djOn", { scope: "world", config: false, type: Boolean, default: true });
  game.settings.register(SYSTEM_ID, "djChance", { scope: "world", config: false, type: Number, default: 40 });
  game.settings.register(SYSTEM_ID, "dj", { scope: "world", config: false, type: Object, default: {} });
  Hooks.once("ready", () => {
    accept(game.settings.get(SYSTEM_ID, "civilRadio"), false, true);
    game.socket.on(CHANNEL, msg => {
      if (msg?.type === "civilRadio") {
        if (!canControl(game.users.get(msg.user))) return;
        accept(msg.state);
        if (isGM()) persist();
      } else if (msg?.type === "civilRadioAsk" && isDriver() && state.rev) {
        game.socket.emit(CHANNEL, { type: "civilRadio", user: game.user.id, state });
      }
    });
    if (!isGM()) game.socket.emit(CHANNEL, { type: "civilRadioAsk" });
  });
}

/** Команда пульта: меняет общее состояние у себя и рассылает всем. */
export function radioCommand(cmd) {
  if (!canControl()) return ui.notifications?.warn("Гражданским радио управляют ведущий и пилоты с триггером «Внешний мир».");
  const info = playlistInfo();
  accept(applyCommand(state, cmd, now(), info), true);
  game.socket?.emit(CHANNEL, { type: "civilRadio", user: game.user.id, state });
  if (isGM()) persist();
}

function accept(next, force = false, quiet = false) {
  if (!next || (!force && (next.rev ?? 0) <= state.rev)) return;
  const was = trackKey(state);
  state = { ...EMPTY, ...foundry.utils.deepClone(next) };
  if (!quiet && state.playing && trackKey(state) && trackKey(state) !== was) maybeDj();
  sync();
  if (win?.rendered) win.render(false);
}

function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => game.settings.set(SYSTEM_ID, "civilRadio", state), 500);
}

const trackKey = s => s.queue[s.cur] ? `${s.queue[s.cur].id}:${s.li}` : null;

/* ---------- диджей ---------- */

const djScene = () => game.scenes?.active ?? globalThis.canvas?.scene ?? null;
/** Имя и реплики диджея: своей сцены, если заданы, иначе общие, иначе стандартные. */
export function djConfig(scene = djScene()) {
  const own = scene?.getFlag?.(SYSTEM_ID, "dj");
  const all = game.settings.get(SYSTEM_ID, "dj") ?? {};
  const pick = c => c?.lines?.length ? c : null;
  const c = pick(own) ?? pick(all) ?? DJ_DEFAULT;
  return { name: own?.name || all?.name || c.name || DJ_DEFAULT.name, lines: c.lines, scope: pick(own) ? "scene" : pick(all) ? "all" : "default" };
}

/** Реплика диджея к треку: без {track}, если название неизвестно; не та же, что в прошлый раз. */
export function djLine(lines, title, last = null, rnd = Math.random) {
  let pool = title ? lines : lines.filter(l => !l.includes("{track}"));
  if (!pool.length) pool = lines;
  if (pool.length > 1) pool = pool.filter(l => l !== last);
  const line = pool[Math.floor(rnd() * pool.length)];
  return { raw: line, text: line.replaceAll("{track}", title ? `«${title}»` : "эта песня") };
}

// говорит только клиент активного ведущего, чтобы реплика прозвучала один раз
function maybeDj() {
  if (!game.user?.isGM || !game.users?.activeGM?.isSelf) return;
  if (!game.settings.get(SYSTEM_ID, "djOn")) return;
  if (Math.random() * 100 >= game.settings.get(SYSTEM_ID, "djChance")) return;
  const { name, lines } = djConfig();
  if (!lines?.length) return;
  const e = state.queue[state.cur];
  const title = e?.list ? null : e?.title;
  const { raw, text } = djLine(lines, title, djLast);
  djLast = raw;
  // пусть трек начнётся, потом голос
  setTimeout(() => sendRadio({ speaker: name, text, side: "neutral" }), 2500);
}

/* ---------- плеер YouTube ---------- */

function loadApi() {
  if (playerReady) return playerReady;
  playerReady = new Promise(resolve => {
    const host = document.createElement("div");
    host.id = "tb-civil-radio-player";
    host.setAttribute("aria-hidden", "true");
    host.innerHTML = `<div id="tb-civil-radio-frame"></div>`;
    document.body.append(host);
    const make = () => {
      player = new YT.Player("tb-civil-radio-frame", {
        width: 320, height: 180,
        playerVars: { autoplay: 0, controls: 0, disablekb: 1, fs: 0, rel: 0, playsinline: 1 },
        events: { onReady: () => { resolve(player); sync(); }, onStateChange: onState, onError }
      });
    };
    if (globalThis.YT?.Player) return make();
    const prev = globalThis.onYouTubeIframeAPIReady;
    globalThis.onYouTubeIframeAPIReady = () => { prev?.(); make(); };
    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    tag.onerror = () => ui.notifications?.error("Гражданское радио: не удалось загрузить плеер YouTube. Нет интернета или YouTube заблокирован.");
    document.head.append(tag);
  });
  return playerReady;
}

const ready = () => player && typeof player.getPlayerState === "function";

function playlistInfo() {
  if (!ready()) return {};
  const list = player.getPlaylist?.();
  return { length: list?.length ?? 0, index: player.getPlaylistIndex?.() ?? 0, time: player.getCurrentTime?.() ?? 0 };
}

/** Подогнать свой плеер под общее состояние. */
function sync() {
  const e = state.queue[state.cur];
  if (!e) {
    if (ready() && loaded) player.stopVideo();
    loaded = null;
    clearInterval(ticker); ticker = null;
    return hideUnlock();
  }
  // раз в секунду: громкость, расхождение, переход плейлиста; только пока в эфире что-то есть
  ticker ??= setInterval(tick, 1000);
  if (!ready()) return void loadApi();
  setVolume();
  const at = expectedPos(state, now());
  const key = e.id;
  if (loaded !== key) {
    loaded = key;
    const how = state.playing ? "load" : "cue";
    if (e.list) player[`${how}Playlist`]({ list: e.list, listType: "playlist", index: state.li, startSeconds: at });
    else player[`${how}VideoById`]({ videoId: e.v, startSeconds: at });
    return;
  }
  if (e.list && (player.getPlaylistIndex?.() ?? state.li) !== state.li) {
    player.playVideoAt(state.li);
    if (!state.playing) player.pauseVideo();
    return;
  }
  const ps = player.getPlayerState();
  const S = YT.PlayerState;
  if (state.playing) {
    if (ps !== S.PLAYING && ps !== S.BUFFERING) { player.seekTo(at, true); player.playVideo(); }
    else if (ps === S.PLAYING && Math.abs(player.getCurrentTime() - at) > DRIFT) player.seekTo(at, true);
  } else if (ps === S.PLAYING || ps === S.BUFFERING) {
    player.pauseVideo();
    player.seekTo(at, true);
  }
}

// громкость: ползунок «Музыка» Foundry (то же преобразование, что у плейлистов)
function setVolume() {
  const input = game.settings.get("core", "globalPlaylistVolume") ?? 0.5;
  const AH = foundry.audio?.AudioHelper ?? globalThis.AudioHelper;
  const vol = AH?.inputToVolume ? AH.inputToVolume(input) : input;
  player.setVolume(Math.round(Math.min(1, Math.max(0, vol)) * 100));
}

function onState(ev) {
  const S = YT.PlayerState, e = state.queue[state.cur];
  if (ev.data === S.PLAYING) hideUnlock();
  if (!e || !isDriver()) return;
  if (ev.data === S.ENDED) {
    // в плейлисте YouTube сам перейдёт к следующему ролику; очередь двигаем только после последнего
    const info = playlistInfo();
    if (e.list && info.length && info.index < info.length - 1) return;
    radioCommand({ op: "next" });
  }
}

function onError(ev) {
  const e = state.queue[state.cur];
  ui.notifications?.warn(`Гражданское радио: «${e?.title ?? "ролик"}» не играет: ${YT_ERRORS[ev.data] ?? `ошибка ${ev.data}`}.`);
  if (isDriver()) setTimeout(() => radioCommand({ op: "next" }), 1500);
}

function tick() {
  if (!ready() || !state.queue[state.cur]) return;
  setVolume();
  const e = state.queue[state.cur];
  // плейлист у ведущего перешёл на следующий ролик: всех на него же
  if (e.list && isDriver() && player.getPlayerState() === YT.PlayerState.PLAYING) {
    const info = playlistInfo();
    if (info.index !== state.li) return radioCommand({ op: "listIndex" });
  }
  sync();
  // браузер не дал включить звук без щелчка: кнопка «Включить радио»
  const ps = player.getPlayerState();
  if (state.playing && ps !== YT.PlayerState.PLAYING && ps !== YT.PlayerState.BUFFERING) {
    unlockMiss = (unlockMiss ?? 0) + 1;
    if (unlockMiss >= 3) showUnlock();
  } else unlockMiss = 0;
}
let unlockMiss = 0;

function showUnlock() {
  if (unlock) return;
  unlock = document.createElement("button");
  unlock.type = "button";
  unlock.className = "tb-civil-radio-unlock";
  unlock.innerHTML = `<i class="fas fa-radio"></i> Включить гражданское радио`;
  unlock.addEventListener("click", () => { player?.playVideo(); hideUnlock(); });
  document.body.append(unlock);
}
function hideUnlock() { unlock?.remove(); unlock = null; unlockMiss = 0; }

/* ---------- пульт ---------- */

export function openCivilRadio() {
  win ??= new CivilRadio();
  win.render(true);
}

async function titleOf(src) {
  try {
    const url = src.v ? `https://www.youtube.com/watch?v=${src.v}` : `https://www.youtube.com/playlist?list=${src.list}`;
    const r = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`);
    if (r.ok) return (await r.json()).title ?? null;
  } catch { /* без названия: покажу ссылку */ }
  return null;
}

class CivilRadio extends Application {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "tb-civil-radio", title: "Гражданское радио", classes: ["thunderbolt", "tb-civil-radio"],
      width: 420, height: "auto", resizable: true
    });
  }

  async _renderInner() {
    const can = canControl();
    const name = e => esc(e.title || (e.list ? `Плейлист ${e.list}` : `Ролик ${e.v}`));
    const rows = state.queue.map((e, i) => `<li class="${i === state.cur ? "cur" : ""}" data-id="${esc(e.id)}">
      <span class="n">${i === state.cur ? `<i class="fas fa-${state.playing ? "volume-high" : "pause"}"></i>` : i + 1}</span>
      <a data-jump title="Играть">${name(e)}${e.list ? ` <i class="fas fa-list" title="Плейлист YouTube"></i>` : ""}</a>
      ${can ? `<button type="button" data-remove title="Убрать из очереди"><i class="fas fa-xmark"></i></button>` : ""}</li>`).join("");
    const cur = state.queue[state.cur];
    const now = cur ? `${state.playing ? "В эфире" : "Пауза"}: <b>${name(cur)}</b>${cur.list ? ` · трек ${state.li + 1}` : ""}` : "Тишина в эфире.";
    const controls = can ? `<div class="tb-cr-controls">
        <button type="button" data-op="prev" title="Назад"><i class="fas fa-backward-step"></i></button>
        <button type="button" data-op="${state.playing ? "pause" : "play"}" title="${state.playing ? "Пауза" : "Играть"}"><i class="fas fa-${state.playing ? "pause" : "play"}"></i></button>
        <button type="button" data-op="next" title="Дальше"><i class="fas fa-forward-step"></i></button>
        <button type="button" data-op="stop" title="Выключить у всех"><i class="fas fa-stop"></i></button>
        <button type="button" data-op="clear" title="Очистить очередь"><i class="fas fa-trash"></i></button>
      </div>
      <form class="tb-cr-add"><input type="text" name="url" placeholder="Ссылка на ролик или плейлист YouTube" autocomplete="off">
        <button type="submit" title="В конец очереди"><i class="fas fa-plus"></i></button>
        <button type="button" data-now title="Играть сейчас"><i class="fas fa-play"></i></button></form>` : "";
    return $(`<div class="tb-cr-body"><div class="tb-cr-now">${now}</div>${controls}
      <ol class="tb-cr-queue">${rows || `<li class="empty">Очередь пуста.</li>`}</ol>${isGM() ? this.#djPanel() : ""}</div>`);
  }

  // только ведущему: диджей
  #djPanel() {
    const scene = djScene(), c = djConfig(scene);
    this.djScope ??= c.scope === "all" || !scene ? "all" : "scene";
    const scope = scene ? this.djScope : "all";
    const shown = scope === "scene" ? djConfig(scene) : djConfig(null);
    const chance = game.settings.get(SYSTEM_ID, "djChance");
    const where = { scene: "своя у этой сцены", all: "общая для всех сцен", default: "стандартная" }[c.scope];
    return `<details class="tb-cr-dj" ${this.djOpen ? "open" : ""}><summary>Диджей</summary>
      <label class="tb-cr-row"><input type="checkbox" data-dj-on ${game.settings.get(SYSTEM_ID, "djOn") ? "checked" : ""}> Вставляет реплики в эфир, когда начинается трек</label>
      <label class="tb-cr-row">Как часто <select data-dj-chance>${[10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map(n => `<option value="${n}" ${n === chance ? "selected" : ""}>${n}%</option>`).join("")}</select></label>
      <div class="tb-cr-row tb-scope">Реплики: ${scene ? `<button type="button" data-dj-scope="scene" class="${scope === "scene" ? "active" : ""}">Сцена «${esc(scene.name)}»</button>` : ""}<button type="button" data-dj-scope="all" class="${scope === "all" ? "active" : ""}">Все сцены</button></div>
      <p class="tb-hint">Сейчас звучит: ${where}.</p>
      <label class="tb-cr-row">Имя в эфире <input type="text" data-dj-name value="${esc(shown.name)}"></label>
      <textarea data-dj-lines rows="7" placeholder="По реплике на строку">${esc(shown.lines.join("\n"))}</textarea>
      <p class="tb-hint">По реплике на строку. {track} — название трека.</p>
      <div class="tb-cr-row"><button type="button" data-dj-save><i class="fas fa-floppy-disk"></i> Сохранить</button><button type="button" data-dj-reset><i class="fas fa-rotate-left"></i> ${scope === "scene" ? "Как у всех сцен" : "Стандартные"}</button></div>
    </details>`;
  }

  activateListeners(html) {
    super.activateListeners(html);
    const root = html[0];
    root.querySelectorAll("[data-op]").forEach(b => b.addEventListener("click", () => radioCommand({ op: b.dataset.op })));
    root.querySelectorAll("[data-jump]").forEach(a => a.addEventListener("click", () => canControl() && radioCommand({ op: "jump", id: a.closest("li").dataset.id })));
    root.querySelectorAll("[data-remove]").forEach(b => b.addEventListener("click", () => radioCommand({ op: "remove", id: b.closest("li").dataset.id })));
    const form = root.querySelector(".tb-cr-add");
    const add = async playNow => {
      const input = form.elements.url, src = parseYouTube(input.value);
      if (!src) return ui.notifications.warn("Это не похоже на ссылку YouTube.");
      input.value = "";
      const entry = { id: foundry.utils.randomID(), ...src, title: await titleOf(src) };
      radioCommand({ op: "add", entry, now: playNow });
    };
    form?.addEventListener("submit", ev => { ev.preventDefault(); add(false); });
    const dj = root.querySelector(".tb-cr-dj");
    if (!dj) return;
    dj.addEventListener("toggle", () => { this.djOpen = dj.open; });
    dj.querySelector("[data-dj-on]").addEventListener("change", ev => game.settings.set(SYSTEM_ID, "djOn", ev.target.checked));
    dj.querySelector("[data-dj-chance]").addEventListener("change", ev => game.settings.set(SYSTEM_ID, "djChance", Number(ev.target.value)));
    dj.querySelectorAll("[data-dj-scope]").forEach(b => b.addEventListener("click", () => { this.djScope = b.dataset.djScope; this.render(false); }));
    const scene = djScene(), toScene = this.djScope === "scene" && scene;
    dj.querySelector("[data-dj-save]").addEventListener("click", async () => {
      const name = dj.querySelector("[data-dj-name]").value.trim();
      const lines = dj.querySelector("[data-dj-lines]").value.split("\n").map(l => l.trim()).filter(Boolean);
      const val = { name: name || DJ_DEFAULT.name, lines };
      if (toScene) await scene.setFlag(SYSTEM_ID, "dj", val);
      else await game.settings.set(SYSTEM_ID, "dj", val);
      ui.notifications.info(`Диджей: реплики сохранены (${toScene ? `сцена «${scene.name}»` : "все сцены"}).`);
      this.render(false);
    });
    dj.querySelector("[data-dj-reset]").addEventListener("click", async () => {
      if (toScene) await scene.unsetFlag(SYSTEM_ID, "dj");
      else await game.settings.set(SYSTEM_ID, "dj", {});
      this.render(false);
    });
    root.querySelector("[data-now]")?.addEventListener("click", () => add(true));
  }
}
