/* Схема боя на карте: ракеты, трассеры, лучи, бомбы, ловушки и взрывы. Рисует каждый клиент сам по карточкам чата,
   поэтому сокет не нужен: пуск Fox Two! или ЗРК — ракета уходит к цели и висит в воздухе меткой с пунктиром до залпа;
   залп конца раунда — ракеты доходят: попадание взрывается, промах проходит мимо (с ловушками, если цель делала Break!).
   Пушка, НУР и лазер бьют сразу; линия EMRG и рельсотрон — луч; ковровая бомбардировка — бомбы; удар по площади — взрывы в зонах;
   сбитая машина — большой взрыв с дымом. Выключается у себя в настройках («Анимация ракет и попаданий»).
   Невидимое для игрока (скрытый токен, вне обзора) не рисуется: схема не выдаёт засаду. */
import { SYSTEM_ID } from "./config.mjs";
import { resolveActor } from "./utils.mjs";

/* ---------- план: что показать по карточке (чистая часть, тесты) ---------- */

const RAIL_TOTAL = (c, r) => c.total + (r.gnd ? c.depShift ?? 0 : 0);

/**
 * Что нарисовать по карточке. compute — computeCard из rolls.mjs (итог и успех броска).
 * Возвращает список шагов: { kind, from, to, hit, ... } (from, to — UUID актёров) или [].
 */
export function planOf(card, compute = c => c) {
  if (!card) return [];
  if (card.type === "break" && card.actorUuid) return [{ kind: "flares", at: card.actorUuid }];
  if (card.type === "strike") return card.zones?.length ? [{ kind: "blast", zones: card.zones }] : [];
  if (card.type === "volley") {
    const out = [];
    for (const r of card.targets ?? []) {
      if (r.missing || !r.uuid) continue;
      out.push({ kind: "impact", to: r.uuid, from: r.shooterUuids ?? (r.sourceUuid ? [r.sourceUuid] : []), count: r.count ?? 1,
        hit: !!r.hit && !r.cobra, ship: !!r.ship, bomb: !!r.bomb, broke: !!r.broke || !!r.cobra, prox: !!r.prox });
    }
    for (const l of card.lost ?? []) out.push({ kind: "lost", name: l.name });
    return out;
  }
  if (card.type === "rail" && card.actorUuid) {
    const c = compute(card), rows = (card.line ?? []).map(r => ({ to: r.uuid, hit: RAIL_TOTAL(c, r) >= r.vs }));
    const kind = card.label === "Ковровая бомбардировка" ? "carpet" : card.label === "Бортовые орудия" ? "guns" : "beam";
    if (kind === "guns") return rows.map(r => ({ kind, from: card.actorUuid, ...r, n: 4 }));
    return rows.length ? [{ kind, from: card.actorUuid, rows }] : [];
  }
  if (!card.attack || !card.actorUuid || !card.targetUuid) return [];
  const all = [card.targetUuid, ...(card.salvo ?? []).map(s => s.uuid)];
  if (card.instant) {
    const c = compute(card), known = card.dc !== null && card.dc !== undefined;
    const kind = /лазер|луч/i.test(card.label ?? "") ? "beam" : /НУР/.test(card.label ?? "") ? "rockets" : "guns";
    const hit = known ? !!c.success : null;
    if (kind === "beam") return [{ kind, from: card.actorUuid, rows: [{ to: card.targetUuid, hit }] }];
    return [{ kind, from: card.actorUuid, to: card.targetUuid, hit, n: kind === "rockets" ? 4 : 6 }];
  }
  // ракета (Fox Two!, ЗРК, корабль): в бою висит до залпа, вне боя долетает и рвётся
  return all.map(to => ({ kind: "launch", from: card.actorUuid, to, bomb: !!card.bomb, wait: !!card.combatKey }));
}

/** Ракета ещё в воздухе: карточка пуска, которую залп не посчитал. */
export const inAir = c => !!(c?.delayed && c.combatKey && c.targetUuid && !c.resolved && !c.dmgApplied && !c.lost);

/* ---------- настройки и хуки ---------- */

const on = () => { try { return game.settings.get(SYSTEM_ID, "fxOn") !== false; } catch { return true; } };

export function registerFx() {
  game.settings.register(SYSTEM_ID, "fxOn", {
    name: "Анимация ракет и попаданий", hint: "Схема боя на карте: ракеты с дымным следом, трассеры, лучи, ловушки, взрывы и сбитые машины. Только у себя.",
    scope: "client", config: true, type: Boolean, default: true, onChange: v => { if (!v) clearAll(); else syncAir(); }
  });
  Hooks.on("createChatMessage", (m, options) => { if (!options?.tbUndo) onCard(m).catch(err => console.warn(`${SYSTEM_ID} | анимация`, err)); });
  for (const ev of ["updateChatMessage", "deleteChatMessage"]) Hooks.on(ev, () => syncSoon());
  Hooks.on("updateCombat", () => syncSoon());
  Hooks.on("deleteCombat", () => syncSoon());
  Hooks.on("canvasReady", () => { clearAll(); syncSoon(); });
  Hooks.on("canvasTearDown", () => clearAll());
  Hooks.on("createActiveEffect", (effect, options) => {
    if (options?.tbUndo || !effect.statuses?.has?.(CONFIG.specialStatusEffects.DEFEATED)) return;
    const a = effect.parent;
    for (const t of a?.isToken ? [a.token?.object] : a?.getActiveTokens?.() ?? []) if (t && seen(t)) downed(t);
  });
}

async function onCard(message) {
  const card = message.getFlag?.(SYSTEM_ID, "card");
  if (!card) return;
  // свой выстрел: машина разворачивается на цель (автокурс), ракета уходит чуть позже
  if (card.attack && card.actorUuid && message.isAuthor) {
    const first = card.targetUuid ?? card.line?.[0]?.uuid;
    const me = tokenFor(card.actorUuid), t = first ? tokenFor(first) : null;
    if (me && t) { const { faceToken } = await import("./rotate.mjs"); faceToken(me, t).catch(() => null); }
  }
  if (!on() || !canvas?.ready) return;
  const { computeCard } = await import("./dice/rolls.mjs");
  const plan = planOf(card, computeCard);
  if (!plan.length) return;
  playPlan(plan, message, card.type === "volley");
}

/** Показать план (planOf) на карте: залп сначала снимает висящие ракеты, чтобы они долетели от своих меток. */
export function playPlan(plan, message = null, volley = false) {
  if (!on() || !canvas?.ready) return;
  if (volley) syncAir();
  plan.forEach((step, i) => run(step, message, i));
}

/* ---------- токены и точки ---------- */

function tokenFor(uuid) {
  const a = resolveActor(uuid);
  if (!a || !canvas?.ready) return null;
  const t = a.isToken ? a.token?.object : a.getActiveTokens?.()[0];
  return t && !t.destroyed && t.document?.parent === canvas.scene ? t : null;
}
/** Игрок видит токен: не скрыт и в обзоре. */
const seen = t => game.user.isGM || (!t.document.hidden && t.visible !== false);
const P = t => () => (t.destroyed ? null : { x: t.center.x, y: t.center.y });
const gs = () => canvas.grid?.size ?? 100;
const lerp = (a, b, k) => ({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k });
const dist = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
const rnd = (a, b) => a + Math.random() * (b - a);
/** Откуда летит: невидимый стрелок — точка рядом с целью со случайной стороны. */
function origin(from, to) {
  if (from && seen(from)) return P(from)();
  const p = P(to)(), a = rnd(0, Math.PI * 2);
  return { x: p.x + Math.cos(a) * gs() * 0.9, y: p.y + Math.sin(a) * gs() * 0.9 };
}
const ours = uuid => { const a = resolveActor(uuid); return a?.type === "pilot" || ["ally", "player"].includes(a?.system?.side); };

/* ---------- шаги ---------- */

function run(step, message, i) {
  const k = step.kind;
  if (k === "flares") { const t = tokenFor(step.at); if (t && seen(t)) flares(P(t)(), t.document.rotation); return; }
  if (k === "blast") return blastZones(step.zones);
  if (k === "lost") return null;
  if (k === "impact") return impact(step);
  const from = tokenFor(step.from);
  if (k === "carpet" || k === "beam") {
    if (!from) return;
    const a = P(from)();
    step.rows.forEach((r, j) => {
      const t = tokenFor(r.to);
      if (!t || !seen(t)) return;
      if (k === "carpet") return bomb(a, P(t), { hit: r.hit, delay: 120 + j * 160 });
      beam(seen(from) ? a : origin(null, t), P(t)(), { color: 0x9fe8ff, delay: 250 + j * 40 });
      if (r.hit) later(320 + j * 40, () => boom(P(t)(), 0.11));
      else if (r.hit === null) later(320, () => sparks(P(t)()));
    });
    return;
  }
  const to = tokenFor(step.to);
  if (!to || !seen(to)) return;
  const a = origin(from, to);
  if (k === "guns" || k === "rockets") return guns(a, P(to), { hit: step.hit, n: step.n, rockets: k === "rockets", delay: 250 });
  if (k === "launch") {
    const ally = ours(step.from);
    // пуск в бою: ракета уходит на 70 % пути и висит до залпа; вне боя долетает и рвётся
    const stop = step.wait ? AIR_AT : 1;
    missile(() => a, P(to), {
      delay: 250 + i * 120, stop, color: ally ? 0xbfefff : 0xffd8c8,
      done: p => { if (step.wait && message) { launched.set(message.id, a); syncAir(); } else boom(p, 0.1); }
    });
  }
}

/** Залп: ракеты каждой карточки по цели доходят от своей висящей метки или от стрелка. */
function impact(step) {
  const to = tokenFor(step.to);
  if (!to || !seen(to)) return;
  const tp = P(to);
  const starts = takeLanding(step.to);
  while (starts.length < Math.min(step.count, 6)) {
    const sh = tokenFor(step.from[starts.length % Math.max(1, step.from.length)]);
    const o = origin(sh, to), p = tp();
    starts.push(p ? lerp(o, p, AIR_AT) : o);
  }
  if (step.broke) later(200, () => { const p = tp(); if (p) flares(p, to.document.rotation); });
  starts.forEach((s, j) => {
    const opts = { delay: j * 160, color: 0xffe6c8 };
    if (step.bomb) return bomb(s, tp, { hit: step.hit || step.ship, delay: j * 160 });
    if (step.hit || step.ship) missile(() => s, tp, { ...opts, done: p => boom(step.prox ? { x: p.x + gs() * 0.08, y: p.y - gs() * 0.06 } : p, j ? 0.09 : 0.13) });
    else missile(() => s, tp, { ...opts, miss: true });
  });
}

/* ---------- ракеты в воздухе ---------- */

const AIR_AT = 0.7;
const launched = new Map();   // id карточки → точка пуска (до перезагрузки)
const air = new Map();        // id карточки → { from: точка, to: токен, ally, msg }
const landing = [];           // сошли с неба: { to (uuid), at (точка), t } — залп заберёт их точки
let syncTimer = null;
function syncSoon() { clearTimeout(syncTimer); syncTimer = setTimeout(() => syncAir(), 60); }

/** Метки ракет в воздухе по карточкам текущего боя этой сцены. */
function syncAir() {
  if (!canvas?.ready) return;
  const want = new Map();
  if (on()) for (const m of game.messages?.contents ?? []) {
    const c = m.getFlag?.(SYSTEM_ID, "card");
    if (!inAir(c) || !game.combat || !String(c.combatKey).startsWith(`${game.combat.id}:`)) continue;
    const to = tokenFor(c.targetUuid), sh = tokenFor(c.actorUuid);
    if (!to || !seen(to)) continue;
    // ракета ещё летит от стрелка (анимация пуска): метку ставит она сама
    if (!launched.has(m.id) && sh && Date.now() - (m.timestamp ?? 0) < 2500) continue;
    want.set(m.id, { from: launched.get(m.id) ?? (sh ? origin(sh, to) : origin(null, to)), to, uuid: c.targetUuid, ally: ours(c.actorUuid) });
  }
  for (const [id, e] of air) if (!want.has(id)) {
    air.delete(id);
    const p = e.to.destroyed ? null : lerp(e.from, P(e.to)(), AIR_AT);
    if (p) landing.push({ to: e.uuid, at: p, t: Date.now() });
  }
  for (const [id, e] of want) if (!air.has(id)) air.set(id, e);
  // сошедшие без залпа (захват сорван, карточка удалена): гаснут на месте
  later(900, () => {
    for (let i = landing.length - 1; i >= 0; i--) if (Date.now() - landing[i].t > 800) { puffs(landing[i].at, 4); landing.splice(i, 1); }
  });
  if (air.size) start();
}
function takeLanding(uuid) {
  const out = [];
  for (let i = landing.length - 1; i >= 0; i--) if (landing[i].to === uuid) { out.unshift(landing[i].at); landing.splice(i, 1); }
  return out;
}

function drawAir(g, now) {
  for (const [id, e] of air) {
    if (e.to.destroyed) { air.delete(id); continue; }
    const b = P(e.to)(), p = lerp(e.from, b, AIR_AT), col = e.ally ? 0x7fd8ff : 0xff7a5a;
    // пунктир от пуска до цели и мигающая метка ракеты
    const n = Math.max(2, Math.floor(dist(e.from, b) / (gs() * 0.06)));
    g.lineStyle(Math.max(1, gs() * 0.008), col, 0.35);
    for (let i = 0; i < n; i += 2) { const q1 = lerp(e.from, b, i / n), q2 = lerp(e.from, b, Math.min(1, (i + 1) / n)); g.moveTo(q1.x, q1.y); g.lineTo(q2.x, q2.y); }
    g.lineStyle(0);
    const pulse = 0.6 + 0.4 * Math.sin(now / 180);
    dart(g, p, Math.atan2(b.y - p.y, b.x - p.x), gs() * 0.07, col, pulse);
  }
}

/* ---------- движок: один слой, всё перерисовывается каждый кадр ---------- */

const items = [];
let gfx = null, ticking = false, clock = 0;
function layer() {
  if (!canvas?.ready || !canvas.interface) return null;
  if (!gfx || gfx.destroyed) { gfx = canvas.interface.addChild(new PIXI.Graphics()); gfx.eventMode = "none"; }
  return gfx;
}
function add(draw, delay = 0) { items.push({ at: clock + delay, draw }); start(); }
function later(ms, f) { add(t => { if (t < ms) return true; f(); return false; }); }
function start() {
  const tk = canvas?.app?.ticker;
  if (ticking || !tk) return;
  tk.add(tick);
  ticking = true;
}
function stop() { canvas?.app?.ticker?.remove(tick); ticking = false; }
function clearAll() {
  items.length = 0; air.clear(); landing.length = 0;
  if (gfx && !gfx.destroyed) gfx.destroy();
  gfx = null;
  stop();
}
function tick() {
  clock += canvas.app.ticker.deltaMS;
  const g = layer();
  if (!g) return stop();
  g.clear();
  const keep = [];
  for (const it of items.splice(0)) {
    const t = clock - it.at;
    if (t < 0) { keep.push(it); continue; }
    let alive = false;
    try { alive = it.draw(t, g) !== false; } catch (err) { console.warn(`${SYSTEM_ID} | анимация`, err); }
    if (alive) keep.push(it);
  }
  items.unshift(...keep);
  drawAir(g, clock);
  if (!items.length && !air.size) { g.clear(); stop(); }
}

/* ---------- примитивы ---------- */

/** Треугольник-ракета носом по углу ang. */
function dart(g, p, ang, len, color, alpha = 1) {
  const c = Math.cos(ang), s = Math.sin(ang), w = len * 0.35;
  g.beginFill(color, alpha);
  g.drawPolygon([p.x + c * len * 0.6, p.y + s * len * 0.6, p.x - c * len * 0.4 - s * w, p.y - s * len * 0.4 + c * w, p.x - c * len * 0.4 + s * w, p.y - s * len * 0.4 - c * w]);
  g.endFill();
}
function puff(p, { r = 0.025, life = 700, color = 0xd8d8d8, alpha = 0.5, grow = 1.6, vx = 0, vy = 0, delay = 0 } = {}) {
  const R = gs() * r;
  add((t, g) => {
    const k = t / life;
    if (k >= 1) return false;
    g.beginFill(color, alpha * (1 - k));
    g.drawCircle(p.x + vx * t / 1000, p.y + vy * t / 1000, R * (1 + grow * k));
    g.endFill();
  }, delay);
}
function puffs(p, n) { for (let i = 0; i < n; i++) puff({ x: p.x + rnd(-6, 6), y: p.y + rnd(-6, 6) }, { r: 0.02, life: 900, color: 0x9a9a9a, delay: i * 60 }); }

/**
 * Ракета от a к b (функции точек: цель может уходить Break!). stop — доля пути (0.7 — повиснуть до залпа),
 * miss — пролетает мимо и гаснет, done(p) — по прибытии.
 */
function missile(a, b, { delay = 0, stop = 1, miss = false, color = 0xffffff, done = null, curve = 0.2 } = {}) {
  const A0 = a(), B0 = b();
  if (!A0 || !B0) return;
  const len = dist(A0, B0), dur = Math.min(1500, 380 + (len / gs()) * 260) * stop;
  const side = Math.random() < 0.5 ? -1 : 1, bend = rnd(0.6, 1.25) * curve * side;
  const off = miss ? { x: rnd(-1, 1) * gs() * 0.12, y: rnd(-1, 1) * gs() * 0.12 } : { x: 0, y: 0 };
  let last = null, ang = 0, fin = null;
  add((t, g) => {
    const A = a() ?? A0, B0b = b() ?? B0, B = { x: B0b.x + off.x, y: B0b.y + off.y };
    if (fin === null) {
      const u = Math.min(1, t / dur) * stop;
      // кривая Безье: стартует вбок, к концу ложится на цель
      const m = lerp(A, B, 0.5), nx = -(B.y - A.y), ny = B.x - A.x, ctl = { x: m.x + nx * bend, y: m.y + ny * bend };
      const e = u * u * (3 - 2 * u) * 0.35 + u * 0.65;
      const p = { x: (1 - e) ** 2 * A.x + 2 * (1 - e) * e * ctl.x + e * e * B.x, y: (1 - e) ** 2 * A.y + 2 * (1 - e) * e * ctl.y + e * e * B.y };
      if (last) ang = Math.atan2(p.y - last.y, p.x - last.x);
      if (!last || dist(last, p) > gs() * 0.012) { puff(p, { r: 0.012, life: 650 }); last = p; }
      dart(g, p, ang, gs() * 0.07, color);
      if (t < dur) return true;
      if (!miss) { done?.(p); return false; }
      fin = { p, t };
    }
    // промах: дальше по прямой и гаснет
    const k = (t - fin.t) / 450;
    if (k >= 1) return false;
    const q = { x: fin.p.x + Math.cos(ang) * gs() * 0.45 * k, y: fin.p.y + Math.sin(ang) * gs() * 0.45 * k };
    if (dist(last, q) > gs() * 0.015) { puff(q, { r: 0.01, life: 500 }); last = q; }
    dart(g, q, ang, gs() * 0.07, color, 1 - k);
    return true;
  }, delay);
}

function boom(p, size = 0.12) {
  if (!p) return;
  const R = gs() * size;
  add((t, g) => {
    if (t > 520) return false;
    const k = t / 520;
    if (t < 140) { g.beginFill(0xffffff, 0.9 * (1 - t / 140)); g.drawCircle(p.x, p.y, R * (0.4 + t / 140 * 0.5)); g.endFill(); }
    g.beginFill(0xff8a2a, 0.75 * (1 - k)); g.drawCircle(p.x, p.y, R * (0.45 + 0.6 * k)); g.endFill();
    g.beginFill(0xffd27a, 0.8 * (1 - k)); g.drawCircle(p.x, p.y, R * (0.25 + 0.3 * k)); g.endFill();
    g.lineStyle(Math.max(1, R * 0.08), 0xffe0a0, 0.7 * (1 - k)); g.drawCircle(p.x, p.y, R * (0.6 + 1.1 * k)); g.lineStyle(0);
  });
  sparks(p, 9, size);
  for (let i = 0; i < 5; i++) puff({ x: p.x + rnd(-R, R) * 0.4, y: p.y + rnd(-R, R) * 0.4 }, { r: size * 0.35, life: 1500, color: 0x555555, alpha: 0.45, grow: 1.8, vy: -gs() * 0.05, delay: 140 + i * 50 });
}
function sparks(p, n = 6, size = 0.06) {
  const R = gs() * size;
  for (let i = 0; i < n; i++) {
    const a = rnd(0, Math.PI * 2), v = R * rnd(1.4, 2.6), life = rnd(260, 420);
    add((t, g) => {
      const k = t / life;
      if (k >= 1) return false;
      const r1 = v * k, r2 = v * Math.max(0, k - 0.18);
      g.lineStyle(Math.max(1, R * 0.07), 0xffe7a0, 1 - k);
      g.moveTo(p.x + Math.cos(a) * r2, p.y + Math.sin(a) * r2); g.lineTo(p.x + Math.cos(a) * r1, p.y + Math.sin(a) * r1);
      g.lineStyle(0);
    });
  }
}

/** Ловушки Break!: горящие точки веером назад от носа. */
function flares(p, rot = 0) {
  const back = (rot + 90) * Math.PI / 180;   // нос вверх: хвост — по направлению +90° от «вправо»
  for (let i = 0; i < 8; i++) {
    const a = back + rnd(-0.9, 0.9), v = gs() * rnd(0.25, 0.45), life = rnd(700, 1000);
    let last = null;
    add((t, g) => {
      const k = t / life;
      if (k >= 1) return false;
      const q = { x: p.x + Math.cos(a) * v * k, y: p.y + Math.sin(a) * v * k + gs() * 0.12 * k * k };
      if (!last || dist(last, q) > gs() * 0.02) { puff(q, { r: 0.008, life: 500, color: 0xeeeeee, alpha: 0.35 }); last = q; }
      g.beginFill(0xfff2c0, 1 - k * 0.7); g.drawCircle(q.x, q.y, gs() * 0.012); g.endFill();
    }, i * 50);
  }
}

/** Очереди: короткие трассеры; промах уходит мимо, попадание — искры. */
function guns(a, b, { hit = null, n = 6, rockets = false, delay = 0 } = {}) {
  for (let i = 0; i < n; i++) {
    const off = hit === false ? { x: rnd(-1, 1) * gs() * 0.14, y: rnd(-1, 1) * gs() * 0.14 } : { x: rnd(-1, 1) * gs() * 0.02, y: rnd(-1, 1) * gs() * 0.02 };
    if (rockets) {
      missile(() => a, () => { const p = b(); return p && { x: p.x + off.x, y: p.y + off.y }; }, { delay: delay + i * 110, miss: hit === false, color: 0xffffff, curve: 0.04, done: p => boom(p, 0.06) });
      continue;
    }
    const life = Math.max(140, Math.min(320, dist(a, b() ?? a) / gs() * 160));
    add((t, g) => {
      const B0 = b();
      if (!B0) return false;
      const B = { x: B0.x + off.x, y: B0.y + off.y }, k = t / life, L = 0.12;
      if (k >= 1 + (hit === false ? 0.35 : 0)) { if (hit !== false && i % 2 === 0) sparks(B, 4, 0.04); return false; }
      const p1 = lerp(a, B, k), p2 = lerp(a, B, Math.max(0, k - L));
      g.lineStyle(Math.max(1, gs() * 0.01), 0xffe36a, 0.95); g.moveTo(p2.x, p2.y); g.lineTo(p1.x, p1.y); g.lineStyle(0);
    }, delay + i * 55);
  }
  if (hit) later(delay + n * 55 + 260, () => { const p = b(); if (p) boom(p, 0.07); });
}

function beam(a, b, { color = 0x9fe8ff, delay = 0 } = {}) {
  if (!a || !b) return;
  add((t, g) => {
    const k = t / 480;
    if (k >= 1) return false;
    g.lineStyle(gs() * 0.05 * (1 - k), color, 0.25 * (1 - k)); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y);
    g.lineStyle(Math.max(1, gs() * 0.015 * (1 - k)), 0xffffff, 0.9 * (1 - k)); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y);
    g.lineStyle(0);
  }, delay);
}

/** Бомба: тёмная точка уменьшается к земле, внизу взрыв (промах — рядом). */
function bomb(a, b, { hit = true, delay = 0 } = {}) {
  const off = hit ? { x: 0, y: 0 } : { x: rnd(-1, 1) * gs() * 0.15, y: rnd(-1, 1) * gs() * 0.15 };
  add((t, g) => {
    const B0 = b();
    if (!B0) return false;
    const B = { x: B0.x + off.x, y: B0.y + off.y }, k = t / 650;
    if (k >= 1) { boom(B, hit ? 0.12 : 0.08); return false; }
    const p = lerp(a, B, k);
    g.beginFill(0x202020, 0.9); g.drawCircle(p.x, p.y, gs() * (0.025 - 0.012 * k)); g.endFill();
  }, delay);
}

/** Удар по площади: несколько взрывов в каждой отмеченной зоне. */
function blastZones(zones) {
  const size = gs(), cells = [...new Set(zones.map(z => String(z).split("|")[0]))];
  cells.forEach((z, i) => {
    const [j, r] = z.split(",").map(Number);
    if (!Number.isFinite(j) || !Number.isFinite(r)) return;
    const tl = canvas.grid.getTopLeftPoint?.({ i: r, j }) ?? { x: j * size, y: r * size };
    for (let n = 0; n < 4; n++) later(i * 120 + n * 140, () => boom({ x: tl.x + size * rnd(0.2, 0.8), y: tl.y + size * rnd(0.2, 0.8) }, rnd(0.12, 0.2)));
  });
}

/** Сбитая машина: большой взрыв, потом дым. */
function downed(t) {
  const p = P(t)();
  if (!p) return;
  boom(p, 0.2);
  later(180, () => boom({ x: p.x + rnd(-1, 1) * gs() * 0.06, y: p.y + rnd(-1, 1) * gs() * 0.06 }, 0.12));
  for (let i = 0; i < 10; i++) puff({ x: p.x + rnd(-4, 4), y: p.y }, { r: 0.04, life: 2200, color: 0x333333, alpha: 0.5, grow: 2.2, vx: rnd(-6, 6), vy: -gs() * 0.08, delay: 300 + i * 120 });
}
