/* Звуки: сигналы кабины у пилота (свой захват, его взяли на захват, ракета на подлёте, сваливание, малая высота в бою,
   свой пуск, очередь из пушки, кончилось спецоружие) и общие для всех (итог миссии, тревога по приоритетной цели
   союзников или гражданских). Сигнал пилота слышит его владелец (игрок), ведущий — только если включил
   «Ведущий слышит сигналы пилотов». Файлы встроены в систему (assets/sounds/*.ogg) и в настройках не меняются;
   у каждого своя громкость. Звуки подгружаются заранее, новый сигнал того же вида обрывает прежний. */
import { SYSTEM_ID } from "./config.mjs";
import { resolveActor } from "./utils.mjs";
import { sideOf, hasRule } from "./scene.mjs";

export const COCKPIT_SOUNDS = {
  lock: { label: "Свой захват", hint: "Пилот взял цель на захват (Lock On!)." },
  locked: { label: "Облучение", hint: "Пилота взяли на захват." },
  missile: { label: "Ракета на подлёте", hint: "По пилоту пустили ракету." },
  stall: { label: "Сваливание", hint: "Speed упала до 0 или ниже." },
  lowAlt: { label: "Малая высота", hint: "Пилот опустился на Низкую." },
  fire: { label: "Свой пуск", hint: "Пилот выпустил ракету или бомбы (Fox Two!)." },
  guns: { label: "Своя пушка", hint: "Пилот открыл огонь из пушки (Guns)." },
  ammoOut: { label: "Кончилось спецоружие", hint: "Боезапас спецоружия пилота дошёл до нуля." },
  missionWin: { label: "Миссия выполнена или завершена", hint: "Звучит у всех с баннером итога.", all: true },
  missionFail: { label: "Миссия провалена или отменена", hint: "Звучит у всех с баннером итога.", all: true },
  priority: { label: "Удар по своей приоритетной цели", hint: "У всех: приоритетную цель союзников или гражданских подбили или уничтожили.", all: true },
  turn: { label: "Ваш ход", hint: "Очередь дошла до пилота игрока." },
  flares: { label: "ИК-ловушки", hint: "Пилот делает Break!." },
  sysHit: { label: "Урон по системам", hint: "Попадание: пилот выбирает метку урона (Grit, Structure, Doom)." },
  boom: { label: "Взрыв вдали", hint: "У всех: ракеты попали в противника (один из трёх взрывов).", all: true, files: ["boom1", "boom2", "boom3"] },
  bomb: { label: "Взрыв бомбы", hint: "У всех: бомба попала в наземную или морскую цель противника.", all: true },
  laser: { label: "Выстрел лазера", hint: "У всех: лазер супероружия.", all: true },
  railgun: { label: "Выстрел рейлгана", hint: "У всех: рельсотрон супероружия.", all: true },
  awacs: { label: "Радиосообщение AWACS", hint: "У всех: перед репликой AWACS от ведущего (кроме итога миссии).", all: true },
  radioOn: { label: "Включение гражданского радио", hint: "У всех: радио заиграло после тишины.", all: true },
  siren: { label: "Сирена", hint: "У всех, пока ведущий её не выключит (кнопка в разделе «Радио»).", all: true },
  click: { label: "Нажатие кнопки", hint: "Кнопки системы: листы, окна, карточки, HUD.", ui: true },
  tab: { label: "Вкладки и большие кнопки", hint: "Переключение вкладок и большие кнопки окон.", ui: true },
  toggle: { label: "Тумблер оружия", hint: "Станции оружия в HUD.", ui: true }
};
const CHANNEL = `system.${SYSTEM_ID}`;
/** Ogg там, где браузер его играет (Chrome, Firefox), иначе mp3 (Safari, iPad, часть Edge). */
let EXT = null;
const ext = () => EXT ??= (() => { try { return new Audio().canPlayType('audio/ogg; codecs="vorbis"') ? "ogg" : "mp3"; } catch { return "ogg"; } })();
export const SRC = k => `systems/${SYSTEM_ID}/assets/sounds/${k}.${ext()}`;
/** Файл звука: у «взрыва вдали» один из трёх наугад. */
const fileOf = k => { const f = COCKPIT_SOUNDS[k]?.files; return f ? f[Math.floor(Math.random() * f.length)] : k; };
const muted = k => { try { return !!game.settings.get(SYSTEM_ID, "soundMute")?.[k]; } catch { return false; } };
let siren = null;
const last = new Map(), playing = new Map();

export function registerSounds() {
  game.settings.register(SYSTEM_ID, "soundVolume", {
    name: "Громкость звуков", hint: "Сигналы кабины, итог миссии и тревога. У каждого игрока своя. 0 — без звуков. Звуки идут через канал «Интерфейс» Foundry: его ползунок во вкладке плейлистов тоже влияет.",
    scope: "client", config: true, type: Number, range: { min: 0, max: 100, step: 10 }, default: 70
  });
  game.settings.register(SYSTEM_ID, "soundGM", {
    name: "Ведущий слышит сигналы пилотов", hint: "Для ведущего: слышать захват, ракету, сваливание и малую высоту всех пилотов.",
    scope: "client", config: true, type: Boolean, default: false
  });
  game.settings.register(SYSTEM_ID, "soundMute", { scope: "client", config: false, type: Object, default: {} });
  if (globalThis.FormApplication) game.settings.registerMenu(SYSTEM_ID, "soundMenu", {
    name: "Звуки по отдельности", label: "Выбрать звуки", hint: "Включить или выключить каждый звук у себя: сигналы кабины, взрывы, AWACS, сирену, кнопки.",
    icon: "fas fa-volume-high", type: soundMenu(), restricted: false
  });
  game.settings.register(SYSTEM_ID, "siren", { scope: "world", config: false, type: Boolean, default: false, onChange: () => syncSiren() });
  Hooks.once("ready", () => syncSiren());
  // очередь дошла до пилота: «ваш ход» у его владельца
  Hooks.on("updateCombat", (combat, change) => {
    if (!combat.started || !("turn" in change || "round" in change || foundry.utils.hasProperty(change, `flags.${SYSTEM_ID}.ready`))) return;
    if (combat.getFlag(SYSTEM_ID, "ready") !== combat.round) return;
    const a = combat.combatant?.actor;
    if (a?.type === "pilot") cue("turn", a);
  });
  Hooks.on("createChatMessage", message => {
    const card = message.getFlag(SYSTEM_ID, "card");
    try { battleSounds(card); } catch (err) { console.warn(`${SYSTEM_ID} | звук`, err); }
  });
  globalThis.document?.addEventListener?.("click", uiClick, true);
  Hooks.on("createChatMessage", message => {
    const rwr = message.getFlag(SYSTEM_ID, "rwr"), card = message.getFlag(SYSTEM_ID, "card");
    if (rwr) { cue("lock", resolveActor(rwr.fromUuid)); cue("locked", resolveActor(rwr.target)); }
    if (card?.maws && card.targetUuid) cue("missile", resolveActor(card.targetUuid));
    if (card?.attack && card.actorUuid) cue(card.instant ? "guns" : "fire", resolveActor(card.actorUuid));
  });
  Hooks.once("ready", () => {
    game.socket.on(CHANNEL, msg => { if (msg?.type === "sound" && COCKPIT_SOUNDS[msg.key]?.all) cueAll(msg.key); });
    // заранее в кэш: первый сигнал не ждёт загрузки файла
    const pre = foundry.audio?.AudioHelper?.preloadSound;
    if (pre) for (const k of Object.keys(COCKPIT_SOUNDS).flatMap(k => COCKPIT_SOUNDS[k].files ?? [k])) Promise.resolve().then(() => pre.call(foundry.audio.AudioHelper, SRC(k))).catch(() => null);
  });
  Hooks.on("createActiveEffect", effect => { if (effect.statuses?.has("stall")) cue("stall", effect.parent); });
  // малая высота — только в бою, чтобы не пищало при расстановке токенов
  Hooks.on("updateActor", (actor, change) => { if (game.combat?.started && foundry.utils.getProperty(change, "system.alt") === "low") cue("lowAlt", actor); });
  // последний заряд спецоружия ушёл
  Hooks.on("updateItem", (item, change) => {
    if (item.type === "weapon" && foundry.utils.getProperty(change, "system.ammo.value") === 0) cue("ammoOut", item.parent);
  });
}

const setting = (k, d) => { try { return game.settings.get(SYSTEM_ID, k); } catch { return d; } };

/** Слышит ли этот клиент сигналы этого пилота. */
export function hears(actor) {
  if (actor?.type !== "pilot" || !actor.isOwner) return false;
  return !game.user.isGM || !!setting("soundGM", false);
}

/** Сыграть сигнал пилота, если клиент его слышит; один и тот же сигнал того же пилота не чаще раза в полторы секунды. */
export function cue(key, actor) {
  if (!hears(actor)) return false;
  return play(key, `${key}:${actor.uuid}`);
}

/** Общий звук у этого клиента (итог миссии, тревога). */
export function cueAll(key) {
  return play(key, key);
}

function play(key, id, { loop = false, throttle = 1500 } = {}) {
  const src = SRC(fileOf(key)), volume = Number(setting("soundVolume", 70)) / 100;
  if (volume <= 0 || muted(key)) return false;
  const now = Date.now();
  if (throttle && last.has(id) && now - last.get(id) < throttle) return false;
  last.set(id, now);
  // тот же сигнал ещё звучит (длинные тоны захвата и ракеты): прежний обрывается, чтобы не наслаивались
  try { playing.get(key)?.stop?.(); } catch {}
  try {
    const res = foundry.audio.AudioHelper.play({ src, volume, autoplay: true, loop, channel: "interface" }, false);
    Promise.resolve(res).then(sound => { if (sound) playing.set(key, sound); })
      .catch(err => failed(key, src, err));
  } catch (err) {
    console.warn(`${SYSTEM_ID} | звук ${key}`, err);
    return false;
  }
  return true;
}

/** Звук не сыграл: один раз сказать игроку, почему (обычно файл не грузится или браузер не даёт играть). */
let warned = false;
function failed(key, src, err) {
  console.warn(`${SYSTEM_ID} | звук ${key} (${src})`, err);
  if (warned) return;
  warned = true;
  globalThis.ui?.notifications?.warn(`Звук «${COCKPIT_SOUNDS[key]?.label ?? key}» не сыграл: ${err?.message ?? err}. Подробности в консоли (F12).`);
}

/** Приоритетная цель своих: NPC с отметкой «Приоритетная цель» на стороне союзников, нейтральный или гражданский. */
export const friendlyPriority = actor => actor?.type === "npc" && !!actor.system?.priority && (sideOf(actor) !== "enemy" || hasRule(actor, "civilian"));

/** Тревога у всех: по своей приоритетной цели попали или её уничтожили (вызывает actor.mjs). */
export function priorityAlarm(actor) {
  if (!friendlyPriority(actor)) return false;
  game.socket?.emit(CHANNEL, { type: "sound", key: "priority" });
  return cueAll("priority");
}

/** Звук у этого клиента без ограничения повтора (кнопки, выбор метки урона). */
export function playLocal(key) {
  return play(key, `${key}:${Date.now()}`, { throttle: 0 });
}

/** Взрывы и выстрелы супероружия по карточкам в чате: у всех клиентов, раз на карточку. */
const LASER = /лазер|laser/i, RAIL = /рельс|рейлган|railgun/i;
export function battleSounds(card) {
  if (!card) return null;
  if (card.type === "break" && card.actorUuid) return cue("flares", resolveActor(card.actorUuid));
  if (card.type === "volley") {
    const hits = (card.targets ?? []).filter(r => r.hit && enemy(r.uuid));
    if (hits.some(r => r.bomb)) cueAll("bomb");
    if (hits.some(r => !r.bomb)) cueAll("boom");
    return hits.length > 0;
  }
  if (card.type === "strike") return cueAll(RAIL.test(card.label) ? "railgun" : LASER.test(card.label) ? "laser" : "bomb");
  // выстрел систем супероружия по названию системы (лазерная турель, рельсотроны)
  if (card.attack && card.label) {
    const a = resolveActor(card.actorUuid);
    if (a?.type === "npc" && (RAIL.test(card.label) || LASER.test(card.label))) return cueAll(RAIL.test(card.label) ? "railgun" : "laser");
  }
  return null;
}
const enemy = uuid => { const a = resolveActor(uuid); return !!a && a.type === "npc" && !["ally", "player"].includes(sideOf(a)); };

/* ---------- кнопки ---------- */

const UI_ROOT = ".thunderbolt, .tb-dialog, .tb-card, #tb-pilot-hud, .tb-hud, #tb-civil-radio-panel";
const BTN = "button, a.tb-btn, a[data-action], a[data-tb-action], [data-hud-act], [data-hud-spw], [data-hud-speed], [data-hud-alt], [data-hud-alt-to], .tb-ck-big, .tabs .item, nav.tabs a, [data-tab]";
/** Какой звук у нажатия: тумблер у станций оружия HUD, вкладки и большие кнопки, остальное — кнопка. */
export function uiSoundFor(el) {
  if (!el?.closest) return null;
  const b = el.closest(BTN);
  if (!b || !b.closest(UI_ROOT) || b.disabled) return null;
  if (b.closest("#tb-pilot-hud") && (b.closest(".tb-hud-wpns") || b.matches("[data-hud-spw], .tb-hud-pt, .tb-hud-arm [data-hud-act]"))) return "toggle";
  if (b.matches(".tabs .item, nav.tabs a, [data-tab], .tb-ck-big")) return "tab";
  return "click";
}
function uiClick(ev) {
  if (ev.button !== 0) return;
  const k = uiSoundFor(ev.target);
  if (k) playLocal(k);
}

/* ---------- сирена ---------- */

/** Ведущий включает и выключает сирену у всех. */
export function setSiren(on) {
  if (!game.user.isGM) return null;
  return game.settings.set(SYSTEM_ID, "siren", !!on);
}
export const sirenOn = () => !!setting("siren", false);
function syncSiren() {
  if (sirenOn()) {
    if (siren) return;
    siren = "pending";
    const volume = Number(setting("soundVolume", 70)) / 100;
    const AH = foundry.audio?.AudioHelper;
    if (volume <= 0 || muted("siren") || !AH) { siren = null; return; }
    Promise.resolve().then(() => AH.play({ src: SRC("siren"), volume, autoplay: true, loop: true, channel: "interface" }, false))
      .then(s => { if (!sirenOn()) s?.stop?.(); else siren = s; }).catch(() => { siren = null; });
  } else {
    try { siren?.stop?.(); } catch {}
    siren = null;
  }
}

/** Окно настроек: каждый звук включается и выключается у себя (класс создаётся при регистрации, когда Foundry уже есть). */
const soundMenu = () => class SoundMenu extends FormApplication {
  render() {
    const mute = setting("soundMute", {}) ?? {};
    const rows = Object.entries(COCKPIT_SOUNDS).map(([k, d]) => `<div class="form-group"><label><input type="checkbox" name="${k}" ${mute[k] ? "" : "checked"}> ${d.label}</label><p class="notes">${d.hint}</p></div>`).join("");
    new Dialog({
      title: "Звуки по отдельности",
      content: `<form class="tb-dialog"><p><button type="button" data-tb-sound-test><i class="fas fa-volume-high"></i> Проверить звук</button></p>${rows}</form>`,
      render: html => (html[0] ?? html).querySelector("[data-tb-sound-test]")?.addEventListener("click", ev => {
        ev.preventDefault();
        const vol = Number(setting("soundVolume", 70));
        let iface = null; try { iface = Math.round(Number(game.settings.get("core", "globalInterfaceVolume")) * 100); } catch {}
        const ok = play("tab", `test:${Date.now()}`, { throttle: 0 });
        ui.notifications.info(ok ? `Проверка: должен прозвучать щелчок. Громкость системы ${vol}%, ползунок «Интерфейс» в плейлистах ${iface ?? "?"}%, файлы .${ext()}.` : `Звук не запущен: громкость системы ${vol}% или звук вкладок выключен ниже.`);
      }),
      buttons: { ok: { label: "Сохранить", callback: html => {
        const root = html[0] ?? html, out = {};
        for (const el of root.querySelectorAll("input[type=checkbox]")) if (!el.checked) out[el.name] = true;
        game.settings.set(SYSTEM_ID, "soundMute", out);
        syncSiren();
      } } }, default: "ok"
    }, { width: 460, height: 640, resizable: true, classes: ["dialog", "thunderbolt"] }).render(true);
    return this;
  }
};
