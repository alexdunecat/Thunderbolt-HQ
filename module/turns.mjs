import { SYSTEM_ID } from "./config.mjs";
/* Конец хода участника боя для автоматики «в конце хода» (Тревога, туннели). */

/**
 * Чей ход только что закончился этим обновлением боя, или null.
 * Только у ведущего и только при движении вперёд (nextTurn / nextRound передают direction 1):
 * откат хода, пересортировка по инициативе и пропуск сбитых не считаются концом хода.
 */
const warned = new Set();
export function endedTurn(combat, change, options) {
  if (!game.users.activeGM?.isSelf || !combat?.started || options?.direction !== 1 || !("turn" in change || "round" in change)) return null;
  const prev = combat.previous?.combatantId ? combat.combatants.get(combat.previous.combatantId) : null;
  if (!prev) return null;
  // единственный участник: после смены раунда снова его ход, но прежний всё равно закончился
  const wrapped = "round" in change && (combat.previous.round ?? 0) < combat.round;
  if (prev.id === combat.combatant?.id && !wrapped) return null;
  // выбывший (сбит, отступил, отмечен сбитым в этом бою) не ходил: его ход трекер просто пропустил
  const st = prev.actor?.statuses;
  if (prev.defeated || st?.has?.(CONFIG.specialStatusEffects.DEFEATED) || st?.has?.("retreat")
    || prev.actor?.getFlag?.(SYSTEM_ID, "down")?.combat === combat.id) return null;
  // Тревога, туннели и срыв захвата считаются по клеткам открытой сцены: ведущий смотрит другую — сказать один раз
  if (prev.token && !prev.token.object && !warned.has(combat.id)) {
    warned.add(combat.id);
    ui.notifications.warn("Бой идёт на другой сцене: Тревога, туннели и срыв захвата в конце хода считаются, только когда сцена боя открыта у ведущего.", { permanent: true });
  }
  return prev;
}
