/* Высота на карте: тень под самолётом (чем выше, тем дальше и бледнее), кнопки ▲▼ в меню токена,
   клавиши PageUp / PageDown и приглушение всего, что летит на другой высоте. */
import { SYSTEM_ID, TB } from "./config.mjs";
import { altOf, tokenOf, isFlying, flyingBoss, ceilingOf, capAlt } from "./scene.mjs";

const ORDER = ["low", "med", "high", "strat"];
const LETTER = { low: "Н", med: "С", high: "В", strat: "Ст" };
const SHADOW = { low: { off: 0.05, alpha: 0.45 }, med: { off: 0.14, alpha: 0.32 }, high: { off: 0.26, alpha: 0.2 }, strat: { off: 0.38, alpha: 0.1 } };
const DIM = 0.4;

const isAir = isFlying;

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
  // потолок машины: выше него она не бывает — что бы её туда ни вынесло, она остаётся на потолке
  Hooks.on("preUpdateToken", (doc, change) => {
    if (!("elevation" in change)) return;
    const to = Object.keys(TB.altElevation).find(k => TB.altElevation[k] === change.elevation);
    const cap = to && capAlt(doc.actor, to);
    if (!cap || cap === to) return;
    change.elevation = TB.altElevation[cap];
    ui.notifications?.info(`«${doc.name}»: потолок машины — ${TB.altitudes[cap]}, выше не поднимается.`);
  });
  Hooks.on("preUpdateActor", (actor, change) => {
    const to = foundry.utils.getProperty(change, "system.alt");
    const cap = to && capAlt(actor, to);
    if (!cap || cap === to) return;
    foundry.utils.setProperty(change, "system.alt", cap);
    ui.notifications?.info(`${actor.name}: потолок машины — ${TB.altitudes[cap]}, выше не поднимается.`);
  });
  // воздушный босс встаёт на свою высоту: Аркбёрд, SOLG и баллистическая ракета в стратосфере, летающий крейсер на Средней или Высокой
  Hooks.on("preCreateToken", doc => {
    if (!flyingBoss(doc.actor)) return;
    const elevation = TB.altElevation[altOf({ document: doc }, doc.actor)];
    if (doc.elevation !== elevation) doc.updateSource({ elevation });
  });
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
  if (!viewer || token === viewer || !token.actor) return false;
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
  const ceil = ceilingOf(doc.actor);
  const allowed = flyingBoss(doc.actor) ?? (ceil ? ORDER.slice(0, ORDER.indexOf(ceil) + 1) : ORDER);
  const cur = allowed.indexOf(altOf(doc.object ?? { document: doc }, doc.actor));
  const next = allowed[Math.max(0, Math.min(allowed.length - 1, cur + delta))];
  if (next === allowed[cur]) {
    if (allowed.length === 1) return ui.notifications.info(`«${doc.name}» всегда ${TB.altOn[next]}.`);
    if (allowed !== ORDER && delta < 0) return ui.notifications.info(`«${doc.name}» не опускается ниже ${TB.altGen[allowed[0]]}.`);
    if (ceil && delta > 0 && ceil !== "strat") return ui.notifications.info(`«${doc.name}»: потолок машины — ${TB.altitudes[ceil]}, выше не подняться.`);
    return ui.notifications.info(delta > 0 ? "Выше стратосферы подниматься некуда." : "Ниже Низкой только земля.");
  }
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
