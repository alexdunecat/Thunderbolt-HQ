/* Полоска очереди ходов: боевой экран прячет трекер, поэтому вверху по центру тонкой строкой видно, кто ходит сейчас
   и кто следующие двое в этом раунде, цветом стороны. Выбывшие, здания и (у игроков) скрытые машины в ней не показываются.
   Настройка у каждого своя («Очередь ходов вверху»). */
import { SYSTEM_ID } from "./config.mjs";
import { esc } from "./utils.mjs";
import { sideOf } from "./scene.mjs";

const NEXT = 2;

/**
 * Кто ходит и кто следующие: rows — [{ id, name, side, out, hidden, passive }] в порядке трекера, turn — индекс текущего.
 * Возвращает { now, next: [...], end } (end — после них раунд кончается) или null.
 */
export function stripOf(rows, turn, { isGM = false } = {}) {
  const ok = r => r && !r.out && !r.passive && (isGM || !r.hidden);
  const now = rows[turn];
  if (!now) return null;
  const next = [];
  for (let i = turn + 1; i < rows.length && next.length < NEXT; i++) if (ok(rows[i])) next.push(rows[i]);
  const more = rows.slice(turn + 1).filter(ok).length > next.length;
  return { now: ok(now) || (now.hidden && isGM) ? now : { ...now, name: "…" }, next, end: !more };
}

const isOn = () => { try { return game.settings.get(SYSTEM_ID, "turnStrip") !== false; } catch { return true; } };
let el = null, timer = null;

function rowsOf(combat) {
  return combat.turns.map(c => ({
    id: c.id, name: c.token?.name ?? c.name, side: sideOf(c.actor), hidden: !!c.hidden || !!c.token?.hidden,
    out: !!c.defeated || !!c.actor?.statuses?.has(CONFIG.specialStatusEffects.DEFEATED) || c.actor?.getFlag?.(SYSTEM_ID, "down")?.combat === combat.id,
    passive: c.actor?.type === "npc" && c.actor.system?.grp === "obj"
  }));
}

function render() {
  const c = game.combat;
  const show = isOn() && c?.started && canvas?.ready && (!c.scene || c.scene.id === canvas.scene?.id);
  const s = show ? stripOf(rowsOf(c), c.turn ?? 0, { isGM: game.user.isGM }) : null;
  if (!s) { el?.remove(); el = null; return; }
  if (!el) { el = document.createElement("div"); el.id = "tb-turn-strip"; document.body.append(el); }
  const chip = (r, cls) => `<span class="ts ${cls} ${esc(r.side)}">${esc(r.name)}</span>`;
  el.innerHTML = `<small>R${c.round}</small>${chip(s.now, "now")}${s.next.map(r => `<i>›</i>${chip(r, "next")}`).join("")}${s.end ? `<i>›</i><span class="ts end">конец раунда</span>` : ""}`;
}
export const refreshTurnStrip = () => { clearTimeout(timer); timer = setTimeout(render, 40); };

export function registerTurnStrip() {
  game.settings.register(SYSTEM_ID, "turnStrip", {
    name: "Очередь ходов вверху", hint: "Пока идёт бой, вверху по центру тонкой строкой видно, кто ходит сейчас и кто следующие двое в этом раунде. Удобно, когда боевой экран прячет трекер.",
    scope: "client", config: true, type: Boolean, default: true, onChange: () => refreshTurnStrip()
  });
  for (const ev of ["canvasReady", "createCombat", "updateCombat", "deleteCombat", "createCombatant", "updateCombatant", "deleteCombatant", "updateToken", "createActiveEffect", "deleteActiveEffect", "updateActor"])
    Hooks.on(ev, () => refreshTurnStrip());
  Hooks.once("ready", () => refreshTurnStrip());
}
