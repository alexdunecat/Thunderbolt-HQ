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
  priority: { label: "Удар по своей приоритетной цели", hint: "У всех: приоритетную цель союзников или гражданских подбили или уничтожили.", all: true }
};
const CHANNEL = `system.${SYSTEM_ID}`;
export const SRC = k => `systems/${SYSTEM_ID}/assets/sounds/${k}.ogg`;
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
    if (pre) for (const k of Object.keys(COCKPIT_SOUNDS)) Promise.resolve().then(() => pre.call(foundry.audio.AudioHelper, SRC(k))).catch(() => null);
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

function play(key, id) {
  const src = SRC(key), volume = Number(setting("soundVolume", 70)) / 100;
  if (volume <= 0) return false;
  const now = Date.now();
  if (last.has(id) && now - last.get(id) < 1500) return false;
  last.set(id, now);
  // тот же сигнал ещё звучит (длинные тоны захвата и ракеты): прежний обрывается, чтобы не наслаивались
  try { playing.get(key)?.stop?.(); } catch {}
  try {
    const res = foundry.audio.AudioHelper.play({ src, volume, autoplay: true, loop: false, channel: "interface" }, false);
    Promise.resolve(res).then(sound => { if (sound) playing.set(key, sound); })
      .catch(err => console.warn(`${SYSTEM_ID} | звук ${key}`, err));
  } catch (err) {
    console.warn(`${SYSTEM_ID} | звук ${key}`, err);
    return false;
  }
  return true;
}

/** Приоритетная цель своих: NPC с отметкой «Приоритетная цель» на стороне союзников, нейтральный или гражданский. */
export const friendlyPriority = actor => actor?.type === "npc" && !!actor.system?.priority && (sideOf(actor) !== "enemy" || hasRule(actor, "civilian"));

/** Тревога у всех: по своей приоритетной цели попали или её уничтожили (вызывает actor.mjs). */
export function priorityAlarm(actor) {
  if (!friendlyPriority(actor)) return false;
  game.socket?.emit(CHANNEL, { type: "sound", key: "priority" });
  return cueAll("priority");
}
