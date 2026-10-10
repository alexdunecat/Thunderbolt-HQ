/* Звуки: сигналы кабины у пилота (свой захват, его взяли на захват, ракета на подлёте, сваливание, малая высота в бою,
   свой пуск и очередь из пушки) и общие для всех (итог миссии, тревога по приоритетной цели союзников или гражданских).
   Сигнал пилота слышит его владелец (игрок), ведущий — только если включил «Ведущий слышит сигналы пилотов».
   Файлы задаются в настройках системы (по умолчанию тоны из assets/sounds, их делает tools/make-sounds.py);
   пустое поле — этот сигнал молчит. Громкость у каждого своя. */
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
  missionWin: { label: "Миссия выполнена или завершена", hint: "Звучит у всех с баннером итога.", all: true },
  missionFail: { label: "Миссия провалена или отменена", hint: "Звучит у всех с баннером итога.", all: true },
  priority: { label: "Удар по своей приоритетной цели", hint: "У всех: приоритетную цель союзников или гражданских подбили или уничтожили.", all: true }
};
const CHANNEL = `system.${SYSTEM_ID}`;
const SRC = k => `systems/${SYSTEM_ID}/assets/sounds/${k}.wav`;
/** Ключ настройки файла: soundLock, soundLowAlt и т. д. */
export const soundKey = k => `sound${k[0].toUpperCase()}${k.slice(1)}`;
const last = new Map();

export function registerSounds() {
  for (const [k, s] of Object.entries(COCKPIT_SOUNDS))
    game.settings.register(SYSTEM_ID, soundKey(k), {
      name: `Звук: ${s.label.toLowerCase()}`, hint: `${s.hint} Свой звуковой файл или пусто, чтобы молчал.`,
      scope: "world", config: true, type: String, default: SRC(k), filePicker: "audio"
    });
  game.settings.register(SYSTEM_ID, "soundVolume", {
    name: "Громкость звуков", hint: "Сигналы кабины, итог миссии и тревога. У каждого игрока своя. 0 — без звуков.",
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
  Hooks.once("ready", () => game.socket.on(CHANNEL, msg => { if (msg?.type === "sound" && COCKPIT_SOUNDS[msg.key]?.all) cueAll(msg.key); }));
  Hooks.on("createActiveEffect", effect => { if (effect.statuses?.has("stall")) cue("stall", effect.parent); });
  // малая высота — только в бою, чтобы не пищало при расстановке токенов
  Hooks.on("updateActor", (actor, change) => { if (game.combat?.started && foundry.utils.getProperty(change, "system.alt") === "low") cue("lowAlt", actor); });
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
  const src = String(setting(soundKey(key), SRC(key)) ?? "").trim(), volume = Number(setting("soundVolume", 70)) / 100;
  if (!src || volume <= 0) return false;
  const now = Date.now();
  if (last.has(id) && now - last.get(id) < 1500) return false;
  last.set(id, now);
  foundry.audio.AudioHelper.play({ src, volume, autoplay: true, loop: false, channel: "interface" }, false);
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
