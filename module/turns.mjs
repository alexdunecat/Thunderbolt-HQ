/* Конец хода участника боя для автоматики «в конце хода» (Тревога, туннели). */

/**
 * Чей ход только что закончился этим обновлением боя, или null.
 * Только у ведущего и только при движении вперёд (nextTurn / nextRound передают direction 1):
 * откат хода, пересортировка по инициативе и пропуск сбитых не считаются концом хода.
 */
export function endedTurn(combat, change, options) {
  if (!game.users.activeGM?.isSelf || !combat?.started || options?.direction !== 1 || !("turn" in change || "round" in change)) return null;
  const prev = combat.previous?.combatantId ? combat.combatants.get(combat.previous.combatantId) : null;
  if (!prev) return null;
  // единственный участник: после смены раунда снова его ход, но прежний всё равно закончился
  const wrapped = "round" in change && (combat.previous.round ?? 0) < combat.round;
  if (prev.id === combat.combatant?.id && !wrapped) return null;
  if (prev.defeated || prev.actor?.statuses?.has?.(CONFIG.specialStatusEffects.DEFEATED)) return null;
  return prev;
}
