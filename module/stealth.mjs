/* Стелс-миссии: шкала Тревоги (шкала боя с отметкой «Тревога»), радарное поле на карте, проверки в конце хода пилота,
   внезапность +2 к первой атаке по цели, пока Тревоги нет, и молчащие ЗРК и зенитки. */
import { SYSTEM_ID, DT } from "./config.mjs";
import { esc } from "./utils.mjs";
import { altOf, cellOf, sideOf, isFlying, hasRule, gunVs } from "./scene.mjs";
import { threats, stepThreat } from "./downtime.mjs";
import { endedTurn } from "./turns.mjs";

const LAYER = "tb-radar";
const FIELD = { color: 0xd0453a, alpha: 0.1, border: 0xd0453a };
const STATION = { color: 0xd0453a, alpha: 0.2, border: 0xd0453a };

/** Шкала Тревоги (первая шкала боя с отметкой alarm) или null. */
export const alarmClock = () => threats().find(t => t.kind === "boss" && t.alarm) ?? null;
/** Идёт стелс-часть: шкала Тревоги есть и ещё не заполнена. */
export const alarmActive = () => { const a = alarmClock(); return !!a && a.value < a.size; };

export function registerStealth() {
  game.settings.register(SYSTEM_ID, "radarField", {
    name: "Радарное поле", hint: "Пока идёт стелс-миссия (есть шкала Тревоги), зоны, которые видит радар врага, подсвечены красным.",
    scope: "client", config: true, type: Boolean, default: true, onChange: () => refreshSoon()
  });
  for (const ev of ["createToken", "updateToken", "deleteToken", "updateActor", "canvasReady", "updateSetting", "createActiveEffect", "deleteActiveEffect"])
    Hooks.on(ev, refreshSoon);
  // конец хода пилота: что могло поднять Тревогу
  Hooks.on("updateCombat", (combat, change, options) => {
    const prev = endedTurn(combat, change, options);
    if (prev) alarmCheck(prev, combat.previous.round).catch(err => console.error(`${SYSTEM_ID} | Тревога`, err));
  });
}

/* ---------- радарное поле ---------- */

/** Сколько зон вокруг видит радар машины: РЛС 1, самолёт ДРЛО 2, ЗРК со своим радаром 0; иначе null. */
export function radarReach(actor) {
  const s = actor?.system;
  if (actor?.type !== "npc" || !s) return null;
  if (s.key === "radar" || hasRule(actor, "radar")) return 1;
  if (hasRule(actor, "awacs") && isFlying(actor)) return 2;
  if (s.kind === "ground" && s.ground?.ga !== null && s.ground?.ga !== undefined && s.key !== "manpads") return 0;
  return null;
}

const isStation = a => a.system.key === "radar" || hasRule(a, "radar");

/** Клетка документа токена: { col, row } по центру токена. */
function docCell(doc) {
  const t = doc.object;
  if (t) return cellOf(t);
  const gs = canvas.grid.size;
  const o = canvas.grid.getOffset({ x: doc.x + (doc.width ?? 1) * gs / 2, y: doc.y + (doc.height ?? 1) * gs / 2 });
  return { col: o.j, row: o.i };
}

/** Радары врага на сцене: [{ doc, cell, reach, station }]. Скрытые токены видит только ведущий (и проверки Тревоги). */
export function radarSources(scene = canvas?.scene, { hidden = true } = {}) {
  const dead = CONFIG.specialStatusEffects?.DEFEATED;
  const out = [];
  for (const doc of scene?.tokens ?? []) {
    const a = doc.actor;
    if (!a || sideOf(a) !== "enemy" || (!hidden && doc.hidden)) continue;
    if (a.statuses?.has(dead) || a.system.markers?.doom) continue;
    const reach = radarReach(a);
    if (reach === null) continue;
    const cell = docCell(doc);
    if (cell) out.push({ doc, cell, reach, station: isStation(a) });
  }
  return out;
}

/** Клетки под полем: Map "col,row" → [источники]. Зоны квадратной сетки: соседняя и по диагонали. */
export function radarCells(sources) {
  const cells = new Map();
  for (const s of sources) for (let dc = -s.reach; dc <= s.reach; dc++) for (let dr = -s.reach; dr <= s.reach; dr++) {
    const k = `${s.cell.col + dc},${s.cell.row + dr}`;
    if (!cells.has(k)) cells.set(k, []);
    cells.get(k).push(s);
  }
  return cells;
}

/** Видит ли радар пилота: { seen (Средняя и Высокая в поле), station (Низкая в зоне РЛС), by: [имена] }. */
export function radarOn(token, actor = token?.actor, sources = radarSources(token?.document?.parent ?? canvas?.scene)) {
  const cell = token ? cellOf(token) : null;
  if (!cell) return { seen: false, station: false, by: [] };
  const here = radarCells(sources).get(`${cell.col},${cell.row}`) ?? [];
  const alt = altOf(token, actor);
  if (alt === "low") {
    const st = here.filter(s => s.station && s.cell.col === cell.col && s.cell.row === cell.row);
    return { seen: false, station: st.length > 0, by: st.map(s => s.doc.name) };
  }
  return { seen: here.length > 0, station: false, by: [...new Set(here.map(s => s.doc.name))] };
}

let timer = null;
function refreshSoon() {
  clearTimeout(timer);
  timer = setTimeout(draw, 60);
}

function draw() {
  const grid = canvas?.ready ? canvas.interface?.grid : null;
  if (!grid) return;
  const layer = grid.addHighlightLayer(LAYER);
  grid.clearHighlightLayer(LAYER);
  let on = true;
  try { on = game.settings.get(SYSTEM_ID, "radarField"); } catch { /* до регистрации */ }
  if (!on || !alarmActive() || canvas.grid.type === CONST.GRID_TYPES.GRIDLESS || canvas.grid.isHexagonal) return;
  const sources = radarSources(canvas.scene, { hidden: game.user.isGM });
  const bounds = canvas.grid.getOffset({ x: canvas.dimensions.width - 1, y: canvas.dimensions.height - 1 });
  for (const [k, list] of radarCells(sources)) {
    const [j, i] = k.split(",").map(Number);
    if (i < 0 || j < 0 || i > bounds.i || j > bounds.j) continue;
    const style = list.some(s => s.station && s.cell.col === j && s.cell.row === i) ? STATION : FIELD;
    const p = canvas.grid.getTopLeftPoint({ i, j });
    grid.highlightPosition(LAYER, { x: p.x, y: p.y, ...style });
  }
  layer.visible = true;
}

/* ---------- Тревога ---------- */

/** Шкала Тревоги для стелс-миссии из планшета: заводит новую или перезапускает имеющуюся с нуля. */
export async function setupAlarm(size) {
  const T = DT.bossClocks.alarm, list = foundry.utils.deepClone(threats());
  const old = list.find(t => t.kind === "boss" && t.alarm);
  const t = { kind: "boss", name: T.name, size, tick: false, open: true, alarm: true, note: T.note, lines: { ...T.lines }, value: 0, created: Date.now() };
  if (old) Object.assign(old, t);
  else list.push({ id: foundry.utils.randomID(), ...t });
  await game.settings.set(SYSTEM_ID, "threats", list);
  return old ?? list[list.length - 1];
}

/** Поднять Тревогу на n делений (ведущий; у игрока запрос уходит ведущему). */
export async function raiseAlarm(n = 1) {
  const a = alarmClock();
  if (!a) return ui.notifications.warn("Шкалы Тревоги нет: заведите её в панели AWACS («Шкала боя», шаблон «Тревога»).");
  return stepThreat(a.id, n);
}

/** Что пилот сделал за ход, по счётчику действий. */
function actsOf(c, round) {
  const s = c.getFlag(SYSTEM_ID, "acts");
  return s?.round === round ? s.list ?? [] : [];
}

/** Конец хода пилота во время стелс-части: карточка с тем, что поднимает Тревогу. */
export async function alarmCheck(c, round) {
  const actor = c.actor, token = c.token?.object;
  if (!alarmActive() || actor?.type !== "pilot" || !token) return null;
  // радарное поле считается по квадратной сетке, как и подсветка
  if (canvas.grid?.type === CONST.GRID_TYPES.GRIDLESS || canvas.grid?.isHexagonal) return null;
  const rows = [], dodge = [];
  let add = 0;
  const alt = altOf(token, actor);
  const radar = radarOn(token, actor);
  const stealth = actor.system.planeProps?.has?.("stealth");
  if (radar.seen) {
    if (stealth && alt === "med") dodge.push(`Малозаметность на Средней в радарном поле (${radar.by.join(", ")})`);
    else { add += 1; rows.push([`В радарном поле ${alt === "strat" ? "в стратосфере" : alt === "high" ? "на Высокой" : "на Средней"} (${radar.by.join(", ")})`, 1]); }
  }
  if (radar.station) dodge.push(`На Низкой в одной зоне с РЛС (${radar.by.join(", ")}): прижаться к рельефу`);
  const acts = actsOf(c, round);
  if (acts.some(x => x.startsWith("Fox Two!"))) { add += 1; rows.push(["Пуск ракеты или сброс бомбы", 1]); }
  if (alt === "low" && (actor.system.speed ?? 0) >= 4) { add += 1; rows.push([`Speed ${actor.system.speed} на Низкой: звуковой удар`, 1]); }
  if (acts.some(x => x.startsWith("Leadership"))) { add += 1; rows.push(["Leadership в эфире (не в счёт, если сосед рядом)", 1]); }
  if (!rows.length && !dodge.length) return null;
  const { postCard } = await import("./dice/rolls.mjs");
  const a = alarmClock();
  return postCard(actor, { type: "alarm", label: "Тревога: конец хода", rows, add, dodge, clock: `${a.name} ${a.value}/${a.size}` }, [],
    { author: game.users.find(u => u.active && !u.isGM && actor.testUserPermission(u, "OWNER"))?.id });
}

/**
 * Внезапность: пока Тревоги нет, первая атака своих по цели противника +2.
 * «Первая»: с момента, когда завели шкалу Тревоги, по этой цели ещё не было карточек атаки.
 */
export function surprise(attacker, t) {
  const a = alarmClock();
  if (!a || a.value >= a.size || !t?.uuid || !["player", "ally"].includes(sideOf(attacker)) || sideOf(t.actor) !== "enemy") return null;
  const since = a.created ?? 0;
  const before = game.messages?.contents.some(m => {
    const c = m.getFlag?.(SYSTEM_ID, "card");
    return c?.attack && c.targetUuid === t.uuid && (m.timestamp ?? 0) >= since;
  });
  return before ? null : ["внезапность", 2];
}

/** ЗРК и зенитки молчат, пока Тревоги нет. Строка для диалога «вне правил» или null. */
export function quietAA(actor) {
  if (!alarmActive() || actor?.type !== "npc" || sideOf(actor) !== "enemy") return null;
  const aa = actor.system.kind === "ground" ? gunVs(actor) === "air" || actor.system.ground?.ga != null : actor.system.kind === "ship";
  return aa ? "Тревоги ещё нет: ЗРК и зенитки молчат." : null;
}

/** Строки карточки Тревоги для renderCard. */
export function alarmRows(c) {
  return [
    ...(c.rows ?? []).map(([t, n]) => `<div class="tb-note">${esc(t)}: <b>+${n}</b></div>`),
    ...(c.dodge ?? []).map(t => `<div class="tb-note">${esc(t)}: <b>Dodge против 7</b>, провал +1</div>`),
    `<div class="tb-note tb-muted">${esc(c.clock ?? "")}. Пушка тихая. Патруль, который увидел пилота и дожил до конца раунда, даёт +2.</div>`
  ];
}
