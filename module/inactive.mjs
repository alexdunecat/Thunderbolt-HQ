/* «Неактивен»: игрок пилота сейчас не играет. Пилот остаётся на сцене и в бою, но не ходит и не заявляет действий
   (combat.mjs isOut), враги его не выбирают (npc-advice.mjs), с поля в конце раунда он не уходит и в потери не пишется.
   Токен, портрет на листе, в трекере и в панели AWACS темнеют. Статус ставится в меню токена или в панели AWACS. */
import { esc } from "./utils.mjs";

export const INACTIVE = "inactive";
export const isInactive = actor => !!actor?.statuses?.has?.(INACTIVE);

/** Включить или снять статус. */
export async function setInactive(actor, on = !isInactive(actor)) {
  if (!actor) return;
  await actor.toggleStatusEffect(INACTIVE, { active: on });
  ChatMessage.create({ speaker: { alias: "AWACS" }, content: `<div class="tb-card tb-card-round"><div class="tb-note">${esc(actor.name)}: ${on ? "неактивен, игрока сейчас нет. Пилот не ходит, но остаётся в строю." : "снова в строю."}</div></div>` });
}

const DARK = 0x4c4c4c;
function shade(token) {
  const mesh = token?.mesh;
  if (!mesh || mesh.destroyed) return;
  const off = isInactive(token.actor);
  if (off) { mesh.tint = DARK; token._tbDark = true; }
  else if (token._tbDark) { mesh.tint = 0xffffff; token._tbDark = false; }
}

const isStatusEffect = e => e?.statuses?.has?.(INACTIVE);
function redraw(effect) {
  const a = effect?.parent;
  if (!a) return;
  for (const t of a.getActiveTokens?.() ?? []) { t.renderFlags?.set({ refreshMesh: true }); shade(t); }
  for (const app of Object.values(a.apps ?? {})) markSheet(app);
  ui.combat?.render();
}

function markSheet(app) {
  const el = app?.element?.[0] ?? app?.element;
  el?.classList?.toggle("tb-inactive", isInactive(app.actor));
}

export function registerInactive() {
  Hooks.on("refreshToken", t => shade(t));
  Hooks.on("createActiveEffect", e => { if (isStatusEffect(e)) redraw(e); });
  Hooks.on("deleteActiveEffect", e => { if (isStatusEffect(e)) redraw(e); });
  Hooks.on("renderActorSheet", app => markSheet(app));
  Hooks.on("renderCombatTracker", (app, html) => {
    const root = html?.[0] ?? html, combat = app.viewed;
    if (!combat || !root?.querySelectorAll) return;
    for (const li of root.querySelectorAll("li.combatant")) {
      const c = combat.combatants.get(li.dataset.combatantId);
      li.classList.toggle("tb-inactive", isInactive(c?.actor));
      if (isInactive(c?.actor)) li.dataset.tooltip = "Неактивен: игрока сейчас нет";
    }
  });
}
