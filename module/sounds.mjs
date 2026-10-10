/* Сигналы кабины у пилота: свой захват, его взяли на захват, ракета на подлёте, сваливание, малая высота (в бою).
   Звук слышит владелец пилота (игрок), ведущий — только если включил «Ведущий слышит сигналы пилотов».
   Файлы задаются в настройках системы (по умолчанию тоны из assets/sounds, их делает tools/make-sounds.py);
   пустое поле — этот сигнал молчит. Громкость у каждого своя. */
import { SYSTEM_ID } from "./config.mjs";
import { resolveActor } from "./utils.mjs";

export const COCKPIT_SOUNDS = {
  lock: { label: "Свой захват", hint: "Пилот взял цель на захват (Lock On!)." },
  locked: { label: "Облучение", hint: "Пилота взяли на захват." },
  missile: { label: "Ракета на подлёте", hint: "По пилоту пустили ракету." },
  stall: { label: "Сваливание", hint: "Speed упала до 0 или ниже." },
  lowAlt: { label: "Малая высота", hint: "Пилот опустился на Низкую." }
};
const SRC = k => `systems/${SYSTEM_ID}/assets/sounds/${k}.wav`;
/** Ключ настройки файла: soundLock, soundLowAlt и т. д. */
export const soundKey = k => `sound${k[0].toUpperCase()}${k.slice(1)}`;
const last = new Map();

export function registerSounds() {
  for (const [k, s] of Object.entries(COCKPIT_SOUNDS))
    game.settings.register(SYSTEM_ID, soundKey(k), {
      name: `Сигнал: ${s.label.toLowerCase()}`, hint: `${s.hint} Свой звуковой файл или пусто, чтобы молчал.`,
      scope: "world", config: true, type: String, default: SRC(k), filePicker: "audio"
    });
  game.settings.register(SYSTEM_ID, "soundVolume", {
    name: "Громкость сигналов кабины", hint: "У каждого игрока своя. 0 — без сигналов.",
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
  });
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

/** Сыграть сигнал, если клиент его слышит; один и тот же сигнал того же пилота не чаще раза в полторы секунды. */
export function cue(key, actor) {
  if (!hears(actor)) return false;
  const src = String(setting(soundKey(key), SRC(key)) ?? "").trim(), volume = Number(setting("soundVolume", 70)) / 100;
  if (!src || volume <= 0) return false;
  const id = `${key}:${actor.uuid}`, now = Date.now();
  if (last.has(id) && now - last.get(id) < 1500) return false;
  last.set(id, now);
  foundry.audio.AudioHelper.play({ src, volume, autoplay: true, loop: false, channel: "interface" }, false);
  return true;
}
