/* Метка в эфир: Alt+щелчок по карте ставит в зоне метку цвета своей стороны, а в эфир уходит реплика:
   «Гроза: смотрю квадрат Б-4», а если в зоне виден противник — «Гроза: противник в квадрате Б-4, вижу двоих».
   Говорит выделенная своя машина, иначе свой пилот; ведущий без выделения говорит как AWACS.
   Метку и реплику видят все на этой сцене; метку противника (ведущий за машину противника) — только ведущие.
   Квадраты подписаны теми же буквами, что на карте миссии и в брифинге. */
import { SYSTEM_ID } from "./config.mjs";
import { sideOf } from "./scene.mjs";
import { COL_LETTERS } from "./briefing.mjs";
import { SIDE_TINT } from "./sidecolor.mjs";

const CHANNEL = `system.${SYSTEM_ID}`;
const LIFE = 4200, GAP_MS = 1500;
let lastPing = 0;

/* ---------- чистая часть (тесты) ---------- */

/** Квадрат по клетке сетки: буква столбца и номер строки от левого верхнего угла сцены. */
export function zoneLabel(col, row, b = { c0: 0, r0: 0 }) {
  return `${COL_LETTERS[col - b.c0] ?? "?"}${row - b.r0 + 1}`;
}
const friendly = side => side === "player" || side === "ally";
/** Враждебны ли стороны друг другу (нейтралы ни с кем). */
export const hostile = (a, b) => a !== "neutral" && b !== "neutral" && friendly(a) !== friendly(b);

const COUNT = ["", "одного", "двоих", "троих", "четверых", "пятерых", "шестерых"];
const LOOK = ["смотрю квадрат {q}", "внимание, квадрат {q}", "квадрат {q}, глянь туда", "проверь квадрат {q}"];
const ENEMY = ["противник в квадрате {q}", "цель в квадрате {q}", "вижу противника, квадрат {q}", "контакт, квадрат {q}"];
const MANY = ["противник в квадрате {q}, вижу {n}", "группа в квадрате {q}, вижу {n}", "контакты в квадрате {q}, вижу {n}"];
/** Реплика метки: n — сколько противников видно в зоне; pick(k) — номер варианта из k. */
export function pingLine(q, n = 0, pick = k => Math.floor(Math.random() * k)) {
  const list = n > 1 ? MANY : n > 0 ? ENEMY : LOOK;
  return list[pick(list.length) % list.length].replace("{q}", q).replace("{n}", COUNT[n] ?? `${n}`);
}

/* ---------- кто говорит и что в зоне ---------- */

const callsignOf = (a, t) => a?.system?.callsign || t?.name || a?.name || "";
/** Говорящий: выделенная своя машина, иначе свой пилот на сцене; ведущий без выделения — AWACS. */
function speaker() {
  const own = (canvas?.tokens?.controlled ?? []).find(t => t.actor?.isOwner && ["pilot", "npc"].includes(t.actor.type));
  if (own) return { name: callsignOf(own.actor, own.document), side: sideOf(own.actor) };
  if (game.user.isGM) return { name: "AWACS", side: "ally" };
  const ch = game.user.character?.type === "pilot" ? game.user.character : game.actors.find(a => a.type === "pilot" && a.isOwner);
  return ch ? { name: callsignOf(ch, ch.prototypeToken), side: "player" } : { name: game.user.name, side: "player" };
}

function bounds() {
  const r = canvas?.dimensions?.sceneRect, gs = canvas?.grid?.size;
  if (!r || !gs) return { c0: 0, r0: 0 };
  return { c0: Math.floor(r.x / gs), r0: Math.floor(r.y / gs) };
}

/** Видимые этому клиенту противники в клетке. */
function enemiesIn(cell, side) {
  return (canvas.tokens?.placeables ?? []).filter(t => {
    if (t.document.hidden || t.visible === false || !t.actor || !["pilot", "npc"].includes(t.actor.type)) return false;
    if (t.actor.statuses?.has?.(CONFIG.specialStatusEffects?.DEFEATED)) return false;
    const o = canvas.grid.getOffset(t.center);
    return o.i === cell.i && o.j === cell.j && hostile(side, sideOf(t.actor));
  }).length;
}

/* ---------- метка ---------- */

function place(point) {
  if (!canvas?.ready || canvas.grid.type === CONST.GRID_TYPES.GRIDLESS) return;
  const now = Date.now();
  if (now - lastPing < GAP_MS) return;
  lastPing = now;
  const cell = canvas.grid.getOffset(point), who = speaker(), q = zoneLabel(cell.j, cell.i, bounds());
  const msg = { type: "ping", scene: canvas.scene.id, i: cell.i, j: cell.j, x: point.x, y: point.y, q, speaker: who.name, side: who.side, text: pingLine(q, enemiesIn(cell, who.side)) };
  game.socket?.emit(CHANNEL, msg);
  hear(msg);
}

function hear(msg) {
  if (!canvas?.ready || msg.scene !== canvas.scene?.id) return;
  // метку и голос противника слышит только ведущий
  if (msg.side === "enemy" && !game.user.isGM) return;
  draw(msg);
  import("./radio.mjs").then(m => m.say(msg.speaker, msg.text, msg.side)).catch(err => console.warn(`${SYSTEM_ID} | метка в эфир`, err));
}

/** Рамка зоны мигает три раза, от точки расходятся кольца, над зоной подпись квадрата; всё цветом стороны. */
function draw(msg) {
  const gs = canvas.grid.size, tl = canvas.grid.getTopLeftPoint?.({ i: msg.i, j: msg.j }) ?? { x: msg.j * gs, y: msg.i * gs };
  const color = SIDE_TINT[msg.side] ?? SIDE_TINT.ally;
  const g = canvas.interface.addChild(new PIXI.Graphics());
  g.eventMode = "none";
  const label = new PIXI.Text(`КВ ${msg.q}`, { fontFamily: "monospace", fontSize: Math.max(14, gs * 0.16), fontWeight: "700", fill: color, stroke: 0x000000, strokeThickness: 3, letterSpacing: 2 });
  label.anchor.set(0, 1);
  label.position.set(tl.x + 4, tl.y - 4);
  label.eventMode = "none";
  canvas.interface.addChild(label);
  const t0 = performance.now(), ticker = canvas.app.ticker, L = gs * 0.18;
  const tick = () => {
    const ms = performance.now() - t0, k = ms / LIFE;
    if (k >= 1 || g.destroyed) { ticker.remove(tick); if (!g.destroyed) g.destroy(); if (!label.destroyed) label.destroy(); return; }
    const fade = k < 0.8 ? 1 : 1 - (k - 0.8) / 0.2, blink = ms < 2400 ? 0.55 + 0.45 * Math.cos(ms / 400 * Math.PI) : 1;
    g.clear();
    g.beginFill(color, 0.1 * fade); g.drawRect(tl.x, tl.y, gs, gs); g.endFill();
    // уголки рамки, как прицельная метка
    g.lineStyle(Math.max(2, gs * 0.03), color, fade * blink);
    for (const [x, y, dx, dy] of [[tl.x, tl.y, 1, 1], [tl.x + gs, tl.y, -1, 1], [tl.x, tl.y + gs, 1, -1], [tl.x + gs, tl.y + gs, -1, -1]]) {
      g.moveTo(x + dx * L, y); g.lineTo(x, y); g.lineTo(x, y + dy * L);
    }
    // кольца от точки щелчка: два подряд в начале
    for (const d of [0, 450]) {
      const r = (ms - d) / 1100;
      if (r <= 0 || r >= 1) continue;
      g.lineStyle(Math.max(1.5, gs * 0.02), color, (1 - r) * 0.9); g.drawCircle(msg.x, msg.y, gs * (0.08 + 0.5 * r));
    }
    g.lineStyle(0);
    g.beginFill(color, fade); g.drawCircle(msg.x, msg.y, Math.max(3, gs * 0.03)); g.endFill();
    label.alpha = fade;
  };
  ticker.add(tick);
}

/* ---------- Alt+щелчок ---------- */

function onPointer(ev) {
  if (ev.button !== 0 || !ev.altKey || ev.ctrlKey || ev.metaKey || ev.shiftKey) return;
  if (!canvas?.ready || ev.target !== canvas.app?.view) return;
  // щелчок забираем себе: Foundry не должен выделять токен под меткой
  ev.preventDefault(); ev.stopImmediatePropagation();
  const p = canvas.canvasCoordinatesFromClient?.({ x: ev.clientX, y: ev.clientY })
    ?? canvas.stage.worldTransform.applyInverse(new PIXI.Point(ev.clientX, ev.clientY));
  try { place({ x: p.x, y: p.y }); } catch (err) { console.warn(`${SYSTEM_ID} | метка в эфир`, err); }
}

export function registerPing() {
  Hooks.once("ready", () => game.socket?.on(CHANNEL, msg => { if (msg?.type === "ping") hear(msg); }));
  // окно в фазе перехвата раньше обработчиков холста Foundry
  globalThis.window?.addEventListener?.("pointerdown", onPointer, true);
}
