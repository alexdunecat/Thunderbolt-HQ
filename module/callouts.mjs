/* Надписи исхода над целью, как в Ace Combat: HIT, MISS и DESTROYED на секунду вспыхивают над токеном цели,
   когда до неё доходит выстрел или ракета залпа, и всплывают вверх, растворяясь. Исход видно на карте, в чат смотреть не нужно.
   Рисует каждый клиент сам по тем же карточкам, что и схема боя (fx.mjs); невидимую игроку цель не подписывает.
   Выключается у себя («Надписи HIT / MISS / DESTROYED»). */
import { SYSTEM_ID } from "./config.mjs";
import { resolveActor } from "./utils.mjs";

export const CALLOUT = { HIT: { color: 0xffd27a, size: 0.2 }, MISS: { color: 0xc9d4d8, size: 0.17 }, DESTROYED: { color: 0xff5a4a, size: 0.24 },
  // ложная цель (9.6): вместо DESTROYED
  "ЛОЖНАЯ ЦЕЛЬ": { color: 0xc9d4d8, size: 0.2 } };
const LIFE = 1300, HOLD_DESTROYED = 2200;

/**
 * Какие надписи дать по плану схемы боя (fx.mjs planOf): [{ to (uuid), text, delay (мс) }].
 * Задержка — примерно когда выстрел долетает: очередь и снаряд сразу, ракеты залпа — после пролёта.
 */
export function calloutsOf(plan = []) {
  const out = [], word = hit => (hit ? "HIT" : "MISS");
  for (const s of plan) {
    if (["guns", "rockets", "cannon", "gunship"].includes(s.kind) && s.to && s.hit !== null && s.hit !== undefined)
      out.push({ to: s.to, text: word(s.hit), delay: s.kind === "cannon" ? 650 : 750 });
    else if (s.kind === "beam" || s.kind === "carpet")
      (s.rows ?? []).forEach((r, j) => { if (r.to && r.hit !== null && r.hit !== undefined) out.push({ to: r.to, text: word(r.hit), delay: s.kind === "carpet" ? 1000 + j * 160 : 600 + j * 40 }); });
    else if (s.kind === "impact" && s.to)
      out.push({ to: s.to, text: word(s.hit || s.ship), delay: 900 + 160 * (Math.max(1, Math.min(s.count ?? 1, 6)) - 1) });
  }
  return out;
}

const isOn = () => { try { return game.settings.get(SYSTEM_ID, "fxOn") !== false && game.settings.get(SYSTEM_ID, "fxCallouts") !== false; } catch { return true; } };
const seen = t => game.user.isGM || (!t.document.hidden && (t.visible !== false || !canvas.visibility?.tokenVision));
function tokenFor(uuid) {
  const a = resolveActor(uuid);
  if (!a || !canvas?.ready) return null;
  const t = a.isToken ? a.token?.object : a.getActiveTokens?.()[0];
  return t && !t.destroyed && t.document?.parent === canvas.scene ? t : null;
}

const live = new Map();   // id токена → { text, until } — DESTROYED не перебивается HIT от того же залпа
let layer = null;
function container() {
  if (!canvas?.ready || !canvas.interface) return null;
  if (!layer || layer.destroyed) { layer = canvas.interface.addChild(new PIXI.Container()); layer.eventMode = "none"; layer.name = "tbCallouts"; }
  return layer;
}

/** Подписать токен: через delay мс над ним вспыхивает text. */
export function callout(token, text, delay = 0) {
  if (!token || !isOn() || !CALLOUT[text]) return;
  setTimeout(() => {
    if (token.destroyed || !seen(token)) return;
    const prev = live.get(token.id), now = performance.now();
    const final = text === "DESTROYED" || text === "ЛОЖНАЯ ЦЕЛЬ";
    if (prev && prev.final && prev.until > now && !final) return;
    if (final) live.set(token.id, { text, final, until: now + HOLD_DESTROYED });
    const box = container();
    if (!box) return;
    // прежняя надпись этого токена уступает место новой
    for (const c of [...box.children]) if (c.tbFor === token.id) c.destroy();
    const gs = canvas.grid?.size ?? 100, st = CALLOUT[text];
    const label = new PIXI.Text(text, { fontFamily: "Jura, 'Exo 2', monospace", fontSize: Math.round(gs * st.size), fontWeight: "700", letterSpacing: Math.round(gs * 0.02),
      fill: st.color, stroke: 0x050a08, strokeThickness: Math.max(3, Math.round(gs * 0.03)), dropShadow: true, dropShadowColor: st.color, dropShadowBlur: Math.round(gs * 0.06), dropShadowDistance: 0, dropShadowAlpha: 0.6 });
    label.anchor.set(0.5, 1);
    label.tbFor = token.id;
    const x = token.center.x, y0 = token.y - gs * 0.04;
    label.position.set(x, y0);
    box.addChild(label);
    const tk = canvas.app.ticker;
    let t = 0;
    const step = () => {
      if (label.destroyed) return tk.remove(step);
      t += tk.deltaMS;
      const k = t / LIFE;
      // вспышка: чуть крупнее в первый миг, потом всплывает и гаснет
      label.scale.set(k < 0.12 ? 1.25 - k * 2 : 1);
      label.position.set(x, y0 - gs * 0.25 * Math.min(1, k));
      label.alpha = k < 0.6 ? 1 : Math.max(0, 1 - (k - 0.6) / 0.4);
      if (k >= 1) { tk.remove(step); label.destroy(); }
    };
    tk.add(step);
  }, delay);
}

/** Показать надписи по плану схемы боя. */
export function playCallouts(plan) {
  if (!isOn() || !canvas?.ready) return;
  for (const c of calloutsOf(plan)) { const t = tokenFor(c.to); if (t && seen(t)) callout(t, c.text, c.delay); }
}

export function registerCallouts() {
  game.settings.register(SYSTEM_ID, "fxCallouts", {
    name: "Надписи HIT / MISS / DESTROYED", hint: "Над целью на секунду вспыхивает исход выстрела или ракеты залпа: HIT, MISS, у сбитой — DESTROYED. Только у себя, вместе с анимацией.",
    scope: "client", config: true, type: Boolean, default: true
  });
  Hooks.on("canvasTearDown", () => { layer = null; live.clear(); });
}
