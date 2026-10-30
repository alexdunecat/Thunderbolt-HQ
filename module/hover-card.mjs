/* Карточка NPC при наведении для ведущего: позывной, ранг, HP, Strain, метки и выбитая система, высота и скорость,
   спецоружие с остатком боезапаса, захват и задание автопилота. Чтобы не открывать лист ради одной цифры.
   Видна только ведущему; появляется через долю секунды наведения и прячется, когда курсор уходит или карта сдвигается.
   Выключается у себя в настройках («Карточка NPC при наведении»). */
import { SYSTEM_ID, TB } from "./config.mjs";
import { esc } from "./utils.mjs";
import { altOf } from "./scene.mjs";
import { radioCallOf } from "./callsigns.mjs";
import { orderOf, orderLine } from "./autopilot.mjs";

const SHOW_MS = 350;

/** Что показать о NPC на токене (чистая часть, тесты). */
export function hoverData(actor, token = null) {
  if (actor?.type !== "npc") return null;
  const s = actor.system, m = s.markers ?? {};
  const markers = [];
  if (m.grit) markers.push(`Grit${m.gritSkill && TB.skills[m.gritSkill] ? `: ${TB.skills[m.gritSkill].label}` : ""}`);
  if (m.structure) markers.push(`Structure${m.sys && TB.systems[m.sys] ? `: ${TB.systems[m.sys].label}` : ""}`);
  if (m.doom) markers.push("Doom");
  const weapons = (actor.items?.filter?.(i => i.type === "weapon") ?? []).map(i => ({
    name: i.name, ammo: i.system?.ammo?.max === null || i.system?.ammo?.max === undefined ? null : `${i.system.ammo.value ?? 0}/${i.system.ammo.max}`,
    off: !!i.system?.offline, empty: i.system?.ammo?.max !== null && i.system?.ammo?.max !== undefined && (i.system.ammo.value ?? 0) <= 0
  }));
  const air = s.kind === "air", order = orderOf(actor);
  return {
    name: token?.name ?? actor.name, call: radioCallOf(token?.document ?? token), tier: TB.tiers[s.tier] ?? "",
    side: s.side ?? "enemy",
    hp: `${s.hp?.value ?? 0}/${s.hp?.max ?? 0}`, strain: (s.strain?.max ?? 0) > 0 ? `${s.strain.value}/${s.strain.max}` : "",
    markers, alt: air && token ? TB.altitudes[altOf(token, actor)] ?? "" : "", speed: air ? `${s.speed ?? 0}/${s.maxSpeed ?? 0}` : "",
    weapons, lock: s.lock || "", order: order ? orderLine(order) : ""
  };
}

/** Разметка карточки. */
export function hoverHtml(d) {
  const row = (k, v, cls = "") => v ? `<div class="tb-hc-row ${cls}"><span>${esc(k)}</span><b>${esc(v)}</b></div>` : "";
  const call = d.call && d.call !== d.name ? `<small>${esc(d.call)}</small>` : "";
  const weap = d.weapons.map(w => `<div class="tb-hc-row${w.off || w.empty ? " off" : ""}"><span>${esc(w.name)}</span><b>${w.off ? "выведено" : esc(w.ammo ?? "∞")}</b></div>`).join("");
  return `<div class="tb-hc-head ${esc(d.side)}"><span>${esc(d.name)}</span>${call}<em>${esc(d.tier)}</em></div>
    ${row("HP", d.hp)}${row("Strain", d.strain)}${row("Высота", d.alt)}${row("Speed", d.speed)}
    ${d.markers.length ? row("Метки", d.markers.join(", "), "bad") : ""}
    ${weap}${row("Захват", d.lock, "warn")}${d.order ? `<div class="tb-hc-order">Автопилот: ${esc(d.order)}</div>` : ""}`;
}

let el = null, timer = null, shown = null;
const isOn = () => { try { return game.settings.get(SYSTEM_ID, "hoverCard") !== false; } catch { return true; } };

function hide() {
  clearTimeout(timer); timer = null; shown = null;
  el?.remove(); el = null;
}

/** Экранная точка правого верхнего угла токена. */
function screenOf(token) {
  if (typeof canvas.clientCoordinatesFromCanvas === "function") return canvas.clientCoordinatesFromCanvas({ x: token.x + token.w, y: token.y });
  const wt = canvas.stage.worldTransform, p = wt.apply({ x: token.x + token.w, y: token.y }), b = canvas.app.view.getBoundingClientRect?.() ?? { left: 0, top: 0 };
  return { x: b.left + p.x, y: b.top + p.y };
}

function show(token) {
  const d = hoverData(token.actor, token);
  if (!d) return;
  el?.remove();
  el = document.createElement("div");
  el.id = "tb-hovercard";
  el.innerHTML = hoverHtml(d);
  document.body.appendChild(el);
  const p = screenOf(token), r = el.getBoundingClientRect();
  const x = p.x + 8 + r.width > window.innerWidth ? p.x - token.w * canvas.stage.scale.x - r.width - 8 : p.x + 8;
  el.style.left = `${Math.max(4, x)}px`;
  el.style.top = `${Math.max(4, Math.min(window.innerHeight - r.height - 4, p.y))}px`;
  shown = token.id;
}

export function registerHoverCard() {
  game.settings.register(SYSTEM_ID, "hoverCard", {
    name: "Карточка NPC при наведении", hint: "Для ведущего: наведите курсор на NPC, рядом появится HP, Strain, метки, спецоружие с боезапасом, захват и задание автопилота.",
    scope: "client", config: true, type: Boolean, default: true, onChange: v => { if (!v) hide(); }
  });
  Hooks.on("hoverToken", (token, hovered) => {
    if (!game.user.isGM || !isOn()) return;
    if (!hovered) { if (shown === token.id || timer) hide(); return; }
    if (token.actor?.type !== "npc") return;
    hide();
    timer = setTimeout(() => { timer = null; if (token.hover && !token.destroyed) show(token); }, SHOW_MS);
  });
  // сдвиг карты, ход токена, правка NPC: прячем, чтобы карточка не висела не там и не врала
  for (const ev of ["canvasPan", "canvasTearDown", "updateToken", "deleteToken", "updateActor", "updateItem", "controlToken"]) Hooks.on(ev, () => { if (el || timer) hide(); });
}
