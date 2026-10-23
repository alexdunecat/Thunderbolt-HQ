/* Настройки линии возврата: что значит пересечь её врагу, союзникам и пилотам. Чистые функции без Foundry:
   их зовут брифинг, импорт миссии, панель AWACS и слежение за линией (return-line.mjs).
   Те же правила лежат в Планшете AWACS и конструкторе брифинга (Штаб), менять вместе. */

/** Что бывает с врагом за линией. */
export const RET_ENEMY = { leave: "уходит с поля", later: "уходит и вернётся подкреплением", stay: "остаётся (прорыв)" };
/** Союзники за линией: сопровождение. */
export const RET_ESCORT = { off: "не считаются", one: "дошла одна союзная цель — задание выполнено", all: "дошли все союзные цели — задание выполнено" };
/** Пилот за линией. */
export const RET_PILOTS = { choice: "выбирает сам: выйти, перевооружиться или остаться", leave: "выходит из боя", rearm: "перевооружается и возвращается", stay: "ничего, летает свободно" };

const BASE = { enemy: "leave", failEnemies: 0, failPriority: 1, escort: "off", pilots: "choice", rearmRounds: 1, rearmStrain: false };
// линии 0.5.85: три режима вместо настроек
const LEGACY = {
  fail: {},
  later: { enemy: "later", failPriority: 0 },
  border: { enemy: "stay", failEnemies: 1, failPriority: 0, pilots: "stay" }
};

/** Настройки линии с умолчаниями (старый режим mode переводится в настройки). */
export function retNorm(r) {
  r = r && typeof r === "object" ? r : {};
  const d = { ...BASE, ...(LEGACY[r.mode] ?? {}) };
  const int = (v, lo, hi, def) => { const n = Number(v); return v !== "" && v !== null && v !== undefined && Number.isInteger(n) && n >= lo && n <= hi ? n : def; };
  return {
    enemy: RET_ENEMY[r.enemy] ? r.enemy : d.enemy,
    failEnemies: int(r.failEnemies, 0, 99, d.failEnemies),
    failPriority: int(r.failPriority, 0, 99, d.failPriority),
    escort: RET_ESCORT[r.escort] ? r.escort : d.escort,
    pilots: RET_PILOTS[r.pilots] ? r.pilots : d.pilots,
    rearmRounds: int(r.rearmRounds, 0, 9, d.rearmRounds),
    rearmStrain: typeof r.rearmStrain === "boolean" ? r.rearmStrain : d.rearmStrain
  };
}

/** Подпись линии на карте. */
export const retLabel = s => (s.escort !== "off" ? "ESCORT LINE" : s.enemy === "stay" ? "DEFENSE LINE" : "RETURN LINE");
/** Название этапа брифинга. */
export const retTitle = s => (s.escort !== "off" ? "ЛИНИЯ СОПРОВОЖДЕНИЯ" : s.enemy === "stay" ? "РУБЕЖ ОБОРОНЫ" : "ЛИНИЯ ВОЗВРАТА");

const plural = (n, one, few, many) => (n % 10 === 1 && n % 100 !== 11 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? few : many);
export const roundsText = n => `${n} ${plural(n, "раунд", "раунда", "раундов")}`;

/** Текст этапа брифинга: что значит линия для врага, союзников и звена. */
export function retText(s) {
  const out = [`За пунктиром — ${s.escort !== "off" ? "линия сопровождения" : s.enemy === "stay" ? "рубеж обороны" : "линия возврата"}.`];
  if (s.escort === "one") out.push("Доведите союзную цель за линию: как только она там, задание выполнено.");
  if (s.escort === "all") out.push("Доведите за линию все союзные цели: тогда задание выполнено.");
  if (s.enemy === "leave") out.push("Противник, ушедший за неё, выходит из боя.");
  if (s.enemy === "later") out.push("Противник, ушедший за неё, вернётся позже с подкреплением.");
  if (s.failPriority) out.push(`${s.failPriority === 1 ? "Уйдёт за линию приоритетная цель" : `Уйдут за линию ${s.failPriority} ${plural(s.failPriority, "приоритетная цель", "приоритетные цели", "приоритетных целей")}`} — задание провалено.`);
  if (s.failEnemies) out.push(`${s.failEnemies === 1 ? "Прорвётся хоть один враг" : `Прорвутся ${s.failEnemies} ${plural(s.failEnemies, "враг", "врага", "врагов")}`} — задание провалено.`);
  if (s.pilots === "choice") out.push("Сами за ней можете выйти из боя или перевооружиться и вернуться.");
  if (s.pilots === "leave") out.push("Кто из звена уйдёт за неё, выходит из боя.");
  if (s.pilots === "rearm") out.push(`Кто из звена уйдёт за неё, перевооружается и возвращается${s.rearmRounds ? ` через ${roundsText(s.rearmRounds)}` : " в следующем раунде"}.`);
  return out.join(" ");
}

/** Что даёт перевооружение, одной фразой (карточка пилота, панель). */
export const rearmText = s => `${s.rearmRounds ? `пропускает ${roundsText(s.rearmRounds)} и ` : ""}возвращается с полным HP и боезапасом, исправными системами и без Structure; ${s.rearmStrain ? "Strain тоже восстанавливается" : "Strain и Grit не восстанавливаются"}`;
