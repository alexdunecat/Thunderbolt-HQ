/* Клавиатура: перебор целей (Tab — следующая цель в досягаемости ракеты от ближней к дальней, Shift+Tab — назад; ставит прицел T)
   и шпаргалка по клавишам (F1): все клавиши системы с их текущими назначениями, клавиши Foundry для боя и панель макросов. */
import { SYSTEM_ID, TB } from "./config.mjs";
import { esc } from "./utils.mjs";

/** Следующая цель по кругу: list — id по порядку, current — id текущей цели (или null), dir — 1 вперёд, −1 назад. */
export function nextTarget(list, current, dir = 1) {
  if (!list.length) return null;
  const i = list.indexOf(current);
  if (i < 0) return dir > 0 ? list[0] : list[list.length - 1];
  return list[(i + dir + list.length) % list.length];
}

/** Досягаемость для перебора: выбранное прицелом спецоружие (вся зона операции — без предела) или стандартная ракета. */
export function reachFor(weapon) {
  const r = Number(weapon?.system?.reach);
  if (weapon && r >= TB.range.operation) return Infinity;
  return weapon && r > 0 ? r : TB.range.missile;
}

/** Своя машина для перебора: выделенный свой токен, иначе машина пилота игрока на сцене. */
function myToken() {
  const own = canvas.tokens?.controlled?.find(t => t.actor?.isOwner);
  if (own) return own;
  const c = game.user.character;
  return c ? c.getActiveTokens?.()[0] ?? null : null;
}

async function cycleTarget(dir) {
  if (!canvas?.ready) return false;
  const me = myToken();
  if (!me?.actor) { ui.notifications.warn("Перебор целей: выделите свой самолёт."); return true; }
  const S = await import("./scene.mjs"), { aimedWeapon } = await import("./range.mjs");
  const reach = reachFor(aimedWeapon(me.actor));
  const DEAD = CONFIG.specialStatusEffects?.DEFEATED ?? "dead";
  const list = canvas.tokens.placeables
    .filter(t => t !== me && t.actor && !t.document.hidden && t.visible !== false && !t.actor.statuses?.has?.(DEAD) && t.actor.type !== "staff" && S.canFireAt(me.actor, t.actor))
    .map(t => ({ t, d: S.zoneDistance(me, t) }))
    .filter(x => x.d !== null && x.d <= reach)
    .sort((a, b) => a.d - b.d || a.t.name.localeCompare(b.t.name, "ru", { numeric: true }));
  if (!list.length) { ui.notifications.info(reach === Infinity ? "Перебор целей: целей не видно." : "Перебор целей: в досягаемости никого."); return true; }
  const cur = [...game.user.targets].find(t => list.some(x => x.t === t))?.id ?? null;
  const id = nextTarget(list.map(x => x.t.id), cur, dir);
  canvas.tokens.get(id)?.setTarget(true, { releaseOthers: true });
  return true;
}

/** Строка клавиш действия: «Shift + Tab, Q». */
function bindingText(ns, action) {
  const KM = foundry.helpers?.interaction?.KeyboardManager ?? globalThis.KeyboardManager;
  const show = k => (KM?.getKeycodeDisplayString?.(k) ?? k.replace(/^Key|^Digit/, ""));
  const list = game.keybindings.get(ns, action) ?? [];
  return list.map(b => [...(b.modifiers ?? []), show(b.key)].join(" + ")).join(", ") || "не назначена";
}

/** Шпаргалка: системные клавиши (как назначены сейчас), клавиши Foundry для боя, панель макросов пилота. */
export async function openCheatSheet() {
  const mine = [...game.keybindings.actions.entries()].filter(([k, a]) => k.startsWith(`${SYSTEM_ID}.`) && (!a.restricted || game.user.isGM))
    .map(([k, a]) => [game.i18n.localize(a.name), bindingText(SYSTEM_ID, k.slice(SYSTEM_ID.length + 1))]);
  const core = [["target", "Прицел на токен под курсором (цель для ракет)"], ["dismiss", "Снять выделение, закрыть окно"], ["pan", "Сдвиг карты"], ["sendToBack", "Токен под другие"]]
    .filter(([k]) => game.keybindings.actions.has(`core.${k}`)).map(([k, label]) => [label, bindingText("core", k)]);
  const { PILOT_BAR, ACTIONS } = await import("./macros.mjs");
  const bar = PILOT_BAR.map((act, i) => [act === "end" ? "Конец хода" : ACTIONS[act] ?? act, String(i + 1)]);
  const rows = list => list.map(([l, k]) => `<tr><td>${esc(l)}</td><td class="tb-keys-k"><kbd>${esc(k)}</kbd></td></tr>`).join("");
  new Dialog({
    title: "Клавиши",
    content: `<div class="tb-keys"><h3>Система</h3><table>${rows(mine)}</table>
      ${core.length ? `<h3>Foundry</h3><table>${rows(core)}</table>` : ""}
      <h3>Панель макросов пилота</h3><table>${rows(bar)}</table>
      <p class="tb-hint">Клавиши меняются в «Настройках» → «Управление» (раздел системы). F1 открывает и закрывает эту шпаргалку.</p></div>`,
    buttons: { ok: { icon: '<i class="fas fa-check"></i>', label: "Понятно" } }, default: "ok"
  }, { width: 440, id: "tb-keys" }).render(true);
}

export function registerKeys() {
  game.keybindings.register(SYSTEM_ID, "nextTarget", {
    name: "Цель: следующая в досягаемости (с Shift — предыдущая)", editable: [{ key: "Tab" }, { key: "Tab", modifiers: ["Shift"] }],
    onDown: ctx => { cycleTarget(ctx.isShift ? -1 : 1).catch(err => console.warn(`${SYSTEM_ID} | перебор целей`, err)); return true; }
  });
  game.keybindings.register(SYSTEM_ID, "cheatSheet", {
    name: "Шпаргалка по клавишам", editable: [{ key: "F1" }],
    onDown: () => { const open = ui.windows && Object.values(ui.windows).find(w => w.id === "tb-keys"); if (open) open.close(); else openCheatSheet(); return true; }
  });
}
