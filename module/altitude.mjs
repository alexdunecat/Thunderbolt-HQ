/* Высота на карте: тень под самолётом (чем выше, тем дальше и бледнее), значок L / M / H,
   кнопки ▲▼ в меню токена и клавиши PageUp / PageDown, приглушение всего, что летит на другой высоте. */
import { SYSTEM_ID, TB } from "./config.mjs";
import { altOf, tokenOf } from "./scene.mjs";

const ORDER = ["low", "med", "high"];
const LETTER = { low: "L", med: "M", high: "H" };
const BADGE = { low: [0xd0302a, 0xffffff], med: [0x2f9e44, 0xffffff], high: [0xf4f4f4, 0x1e2822] };
const SHADOW = { low: { off: 0.05, alpha: 0.45 }, med: { off: 0.14, alpha: 0.32 }, high: { off: 0.26, alpha: 0.2 } };
const DIM = 0.4;

const isAir = a => a?.type === "pilot" || (a?.type === "npc" && a.system.kind === "air");
/** Летающие крейсеры не привязаны к уровню высоты: их не приглушаем. */
const floats = a => a?.type === "npc" && (a.system.key === "arkbird" || [...(a.system.props ?? []), ...(a.system.rules ?? [])].some(p => (p?.key ?? p) === "aerialship"));

export function registerAltitude() {
  game.settings.register(SYSTEM_ID, "altitudeDim", {
    name: "TB.AltDimName", hint: "TB.AltDimHint", scope: "client", config: true, type: Boolean, default: true,
    onChange: () => refreshAll()
  });
  game.keybindings.register(SYSTEM_ID, "altUp", {
    name: "Высота: на уровень выше", editable: [{ key: "PageUp" }], onDown: () => { stepSelected(1); return true; }
  });
  game.keybindings.register(SYSTEM_ID, "altDown", {
    name: "Высота: на уровень ниже", editable: [{ key: "PageDown" }], onDown: () => { stepSelected(-1); return true; }
  });
  Hooks.on("refreshToken", t => decorate(t));
  Hooks.on("destroyToken", t => { if (t.tbShadow && !t.tbShadow.destroyed) t.tbShadow.destroy(); t.tbShadow = null; });
  for (const ev of ["controlToken", "updateToken", "updateActor", "createToken", "deleteToken", "canvasReady"]) Hooks.on(ev, refreshSoon);
  Hooks.on("renderTokenHUD", addHudButtons);
}

let timer = null;
function refreshSoon() {
  clearTimeout(timer);
  timer = setTimeout(refreshAll, 50);
}
function refreshAll() {
  if (canvas?.ready) for (const t of canvas.tokens.placeables) decorate(t);
}

/* ---------- чья высота считается своей ---------- */

/** Свой токен: выделенный свой самолёт, иначе токен назначенного пилота. У ведущего без выделения — никакой. */
function viewerToken() {
  const mine = canvas.tokens.controlled.filter(t => isAir(t.actor) && t.actor.isOwner);
  if (mine.length) return mine[0];
  if (game.user.isGM) return null;
  return game.user.character ? tokenOf(game.user.character) : null;
}

/** Приглушить ли токен для этого игрока. */
export function dimmed(token, viewer = viewerToken()) {
  if (!viewer || token === viewer || !token.actor || floats(token.actor)) return false;
  let on = true;
  try { on = game.settings.get(SYSTEM_ID, "altitudeDim"); } catch { /* до регистрации настройки */ }
  return on && altOf(token) !== altOf(viewer);
}

/* ---------- отрисовка ---------- */

function decorate(t) {
  const dim = dimmed(t);
  applyDim(t, dim);
  const air = isAir(t.actor);
  const alt = air ? altOf(t) : null;
  drawBadge(t, alt, dim);
  try { drawShadow(t, alt, dim); } catch (err) { console.warn(`${SYSTEM_ID} | тень токена`, err); }
}

/** Прозрачность картинки токена. Foundry сам выставляет её при перерисовке, поэтому запоминаем исходную. */
function applyDim(t, dim) {
  const m = t.mesh;
  if (!m) return;
  const base = m._tbSet !== undefined && Math.abs(m.alpha - m._tbSet) < 1e-6 ? m._tbBase : m.alpha;
  m._tbBase = base;
  m._tbSet = m.alpha = dim ? base * DIM : base;
}

/** Значок высоты в правом нижнем углу: L красный, M зелёный, H белый. */
function drawBadge(t, alt, dim) {
  let g = t.tbAltBadge;
  if (!alt) {
    if (g && !g.destroyed) g.destroy({ children: true });
    t.tbAltBadge = null;
    return;
  }
  if (!g || g.destroyed) {
    g = t.tbAltBadge = t.addChild(new PIXI.Graphics());
    g.eventMode = "none";
    g.tbText = g.addChild(new PIXI.Text("", { fontFamily: "monospace", fontWeight: "bold", fontSize: 16, fill: 0xffffff }));
    g.tbText.anchor.set(0.5);
  }
  const s = Math.max(12, Math.min(t.w, t.h) * 0.3), [bg, fg] = BADGE[alt];
  g.clear().lineStyle(Math.max(1, s * 0.08), 0x1e2822, 1).beginFill(bg, 1).drawRoundedRect(-s / 2, -s / 2, s, s, s * 0.22).endFill();
  g.tbText.text = LETTER[alt];
  g.tbText.style.fill = fg;
  g.tbText.style.fontSize = Math.round(s * 0.72);
  g.position.set(t.w - s * 0.45, t.h - s * 0.45);
  g.alpha = dim ? DIM + 0.2 : 1;
}

const SpriteClass = () => foundry.canvas?.primary?.PrimarySpriteMesh ?? globalThis.PrimarySpriteMesh;

/** Тень: силуэт токена чёрным на высоте 0 (под всеми летящими), смещён вправо вниз по высоте. */
function drawShadow(t, alt, dim) {
  const PSM = SpriteClass(), m = t.mesh;
  let s = t.tbShadow;
  if (!alt || !PSM || !m?.texture || !canvas.primary) {
    if (s && !s.destroyed) s.destroy();
    t.tbShadow = null;
    return;
  }
  if (!s || s.destroyed) {
    s = t.tbShadow = canvas.primary.addChild(new PSM({ texture: m.texture, name: `tbShadow.${t.id}` }));
    s.eventMode = "none";
    s.tint = 0x000000;
  }
  if (s.texture !== m.texture) s.texture = m.texture;
  s.anchor.set(0.5, 0.5);
  s.width = m.width;
  s.height = m.height;
  s.rotation = m.rotation;
  s.elevation = 0;
  s.sortLayer = m.sortLayer;
  s.sort = -1e6;
  const k = SHADOW[alt], off = Math.min(t.w, t.h) * k.off;
  s.position.set(m.x + off, m.y + off);
  s.alpha = k.alpha * (dim ? DIM : 1);
  s.visible = t.visible && m.visible !== false;
}

/* ---------- смена высоты ---------- */

/** Сменить высоту токена на шаг: через elevation, лист подтянется сам. */
export async function stepAltitude(token, delta) {
  const doc = token?.document ?? token;
  if (!doc?.isOwner || !isAir(doc.actor)) return;
  const cur = ORDER.indexOf(altOf(doc.object ?? token));
  const next = ORDER[Math.max(0, Math.min(ORDER.length - 1, cur + delta))];
  if (next === ORDER[cur]) return ui.notifications.info(delta > 0 ? "Выше High подниматься некуда." : "Ниже Low только земля.");
  return doc.update({ elevation: TB.altElevation[next] });
}

function stepSelected(delta) {
  const list = (canvas?.tokens?.controlled ?? []).filter(t => t.document.isOwner && isAir(t.actor));
  for (const t of list) stepAltitude(t, delta);
}

/** Кнопки ▲▼ и текущая высота в левой колонке меню токена. */
function addHudButtons(hud, html) {
  const token = hud.object;
  if (!isAir(token?.actor) || !token.document.isOwner) return;
  const root = html[0] ?? html;
  const col = root.querySelector(".col.left");
  if (!col) return;
  const alt = altOf(token);
  const box = document.createElement("div");
  box.className = "tb-alt-hud";
  box.innerHTML = `<div class="control-icon" data-tb-alt="1" title="Выше (PageUp)"><i class="fas fa-angle-up"></i></div>
    <div class="tb-alt-now ${alt}" title="Высота: ${TB.altitudes[alt]}">${LETTER[alt]}</div>
    <div class="control-icon" data-tb-alt="-1" title="Ниже (PageDown)"><i class="fas fa-angle-down"></i></div>`;
  box.querySelectorAll("[data-tb-alt]").forEach(b => b.addEventListener("click", async ev => {
    ev.preventDefault(); ev.stopPropagation();
    await stepAltitude(token, Number(b.dataset.tbAlt));
    hud.render();
  }));
  col.prepend(box);
}
