/* Туннели: в конце хода самолёт сам продвигается по секциям (1, при Speed 4+ на 2) и делает проверку пролёта
   Push против 3 + Speed (+2 в Узости и у Препятствия). В Зале обычные правила, на Развилке ветку выбирает пилот.
   Триггер «Это никогда не пригодится» освобождает от проверок пролёта. Направление после разворота в Зале — флаг токена.
   Ворота и Препятствие помнят состояние (поле state секции, меняет ведущий в панели AWACS): закрытые Ворота
   не пролететь, пока их не разобьют; уничтоженное Препятствие больше не усложняет пролёт. */
import { SYSTEM_ID, TB } from "./config.mjs";
import { esc } from "./utils.mjs";
import { sectionAt, tunnelAt, nextSections, cellOf, isFlying, sectionBlocked, sectionHard, GATE_STATES, OBSTACLE_STATES } from "./scene.mjs";
import { endedTurn } from "./turns.mjs";

const hasTrigger = (actor, key) => actor?.items?.some?.(i => i.type === "trigger" && i.system.key === key);

export function registerTunnel() {
  // внутри или снаружи и направление полёта: вход с последней секции летит к первой, разворот только в Зале
  Hooks.on("preUpdateToken", (doc, change) => {
    if (!("x" in change || "y" in change || "elevation" in change) || !doc.parent?.getFlag?.(SYSTEM_ID, "tunnelCells")) return;
    const scene = doc.parent, gs = scene.grid?.size ?? canvas.grid.size, w = (doc.width ?? 1) * gs / 2, h = (doc.height ?? 1) * gs / 2;
    const from = sectionAt(scene, Math.floor((doc.x + w) / gs), Math.floor((doc.y + h) / gs));
    const dest = sectionAt(scene, Math.floor(((change.x ?? doc.x) + w) / gs), Math.floor(((change.y ?? doc.y) + h) / gs));
    const low = (change.elevation ?? doc.elevation) === TB.altElevation.low;
    const wasIn = !!doc.getFlag?.(SYSTEM_ID, "tunnelIn") || (!!from && doc.elevation === TB.altElevation.low);
    const nowIn = !!dest && (low || (wasIn && dest.type === "hall"));
    if (nowIn !== !!doc.getFlag?.(SYSTEM_ID, "tunnelIn")) foundry.utils.setProperty(change, `flags.${SYSTEM_ID}.tunnelIn`, nowIn);
    const dir = doc.getFlag?.(SYSTEM_ID, "tunnelDir") ?? 1;
    let want = dir;
    if (!nowIn) want = 1;
    else if (!wasIn) want = nextSections(scene, dest, 1).length || !nextSections(scene, dest, -1).length ? 1 : -1;
    else if (from?.type === "hall" && dest.n !== from.n) want = dest.n < from.n ? -1 : 1;
    if (want !== dir) foundry.utils.setProperty(change, `flags.${SYSTEM_ID}.tunnelDir`, want);
  });
  Hooks.on("updateCombat", (combat, change, options) => {
    const prev = endedTurn(combat, change, options);
    if (prev) tunnelTurnEnd(prev).catch(err => console.error(`${SYSTEM_ID} | туннель`, err));
  });
}

/**
 * Куда течение вынесет самолёт за конец хода: { path: [секции], exit: {col,row} | null, fork: bool, gate: секция | null }.
 * Останавливается на Развилке (ветку выбирает пилот), в Зале, перед закрытыми Воротами и на выходе из последней секции.
 */
export function drift(scene, sec, steps, dir = 1) {
  const path = [];
  let cur = sec, exit = null, fork = false, gate = null;
  for (let i = 0; i < steps; i++) {
    const nxt = nextSections(scene, cur, dir);
    if (nxt.length > 1) { fork = true; break; }
    if (sectionBlocked(nxt[0])) { gate = nxt[0]; break; }
    if (!nxt.length) {
      // выход из последней секции: на клетку напротив предыдущей
      const back = nextSections(scene, cur, -dir)[0];
      if (back) {
        const c = cur.col * 2 - back.col, r = cur.row * 2 - back.row;
        const cols = Math.round((scene.width ?? scene.dimensions?.width ?? 0) / (scene.grid?.size ?? 1)), rows = Math.round((scene.height ?? scene.dimensions?.height ?? 0) / (scene.grid?.size ?? 1));
        if (c >= 0 && r >= 0 && (!cols || c < cols) && (!rows || r < rows) && !sectionAt(scene, c, r)) exit = { col: c, row: r };
      }
      break;
    }
    cur = nxt[0];
    path.push(cur);
    if (cur.type === "hall") break;
  }
  return { path, exit, fork, gate };
}

/** Сложность проверки пролёта: 3 + Speed, +2 если на пути Узость или Препятствие, ещё +2 на встречном курсе. */
export const passDc = (speed, secs, oncoming = false) => 3 + Math.max(0, speed) + (secs.some(sectionHard) ? 2 : 0) + (oncoming ? 2 : 0);

/** Встречный курс: в пройденных секциях есть другой самолёт, летящий в обратную сторону. */
function oncomingIn(scene, self, secs, dir) {
  const keys = new Set(secs.map(s => `${s.col},${s.row}`));
  const gs = scene.grid?.size ?? canvas.grid.size;
  return (scene.tokens ?? []).some(d => {
    if (d === self || !isFlying(d.actor) || !d.getFlag?.(SYSTEM_ID, "tunnelIn")) return false;
    const c = Math.floor((d.x + (d.width ?? 1) * gs / 2) / gs), r = Math.floor((d.y + (d.height ?? 1) * gs / 2) / gs);
    return keys.has(`${c},${r}`) && (d.getFlag(SYSTEM_ID, "tunnelDir") ?? 1) !== dir;
  });
}

/** Конец хода в туннеле: продвинуть токен и выложить карточку проверки пролёта. */
export async function tunnelTurnEnd(c) {
  const token = c.token?.object ?? null, actor = c.actor;
  if (!token || !isFlying(actor)) return null;
  const sec = tunnelAt(token, actor);
  if (!sec || sec.type === "hall") return null;
  const scene = token.document.parent, gs = scene.grid?.size ?? canvas.grid.size;
  const speed = actor.system.speed ?? 0;
  if (speed <= 0) return null;   // сваливание: своя проверка, Push против 7, провал — Doom
  const dir = token.document.getFlag?.(SYSTEM_ID, "tunnelDir") ?? 1;
  const { path, exit, fork, gate } = drift(scene, sec, speed >= 4 ? 2 : 1, dir);
  const dest = exit ?? path[path.length - 1] ?? null;
  // на Развилке ветку выбирает пилот: один перенос токена в следующую секцию бесплатно и вне своего хода
  const forkAt = fork ? (path[path.length - 1] ?? sec) : null;
  const flags = { [`flags.${SYSTEM_ID}.tunnelFork`]: forkAt ? { col: forkAt.col, row: forkAt.row } : null };
  if (dest) {
    const cell = cellOf(token);
    await token.document.update({ x: token.document.x + (dest.col - cell.col) * gs, y: token.document.y + (dest.row - cell.row) * gs, ...flags }, { tbKeep: true });
  } else if (forkAt || token.document.getFlag?.(SYSTEM_ID, "tunnelFork")) await token.document.update(flags, { tbKeep: true });
  const passed = [sec, ...path];
  const where = exit ? "вылетел из туннеля" : fork && !path.length ? "у Развилки" : path.length ? `продвинулся на ${path.length === 1 ? "секцию" : `${path.length} секции`}: Т${path[path.length - 1].n} ${esc(secName(path[path.length - 1]))}` : "остался в секции";
  const notes = [`${esc(token.name)} ${where}.`];
  if (gate) notes.push(`Ворота Т${gate.n} закрыты: дальше только сквозь разбитые (заслонка с HP и Occlusion 4).`);
  if (fork) notes.push(`Развилка: ветку выбирает пилот, перетащите токен в нужную секцию (это не Move и не ждёт хода).${passed.some(sectionHard) ? "" : " Если там Узость или Препятствие, сложность пролёта +2."}`);
  const free = hasTrigger(actor, "nevercome");
  const inHall = path[path.length - 1]?.type === "hall";
  const oncoming = oncomingIn(scene, token.document, passed, dir);
  if (oncoming) notes.push("Встречный курс: в секции самолёт, летящий навстречу, сложность +2.");
  const dc = passDc(speed, passed, oncoming);
  const check = !exit && !inHall && !free;
  if (free && !exit && !inHall) notes.push("«Это никогда не пригодится»: проверки пролёта нет.");
  if (inHall) notes.push("Зал: обычные правила боя, проверки пролёта нет.");
  const { postCard } = await import("./dice/rolls.mjs");
  return postCard(actor, { type: "tunnel", label: "Туннель: конец хода", notes, check, dc, speed, hard: passed.some(sectionHard), oncoming }, [],
    { author: game.users.find(u => u.active && !u.isGM && actor.testUserPermission(u, "OWNER"))?.id });
}

/** Выбор ветки на Развилке: перенос в одну из следующих секций, разрешённый tunnelTurnEnd. Флаг снимается этим же переносом. */
export function forkChoice(doc, change) {
  const at = doc.getFlag?.(SYSTEM_ID, "tunnelFork");
  if (!at || !("x" in change || "y" in change) || "elevation" in change) return false;
  const scene = doc.parent, gs = scene.grid?.size ?? canvas.grid.size, w = (doc.width ?? 1) * gs / 2, h = (doc.height ?? 1) * gs / 2;
  const fc = Math.floor((doc.x + w) / gs), fr = Math.floor((doc.y + h) / gs);
  if (fc !== at.col || fr !== at.row) return false;
  const tc = Math.floor(((change.x ?? doc.x) + w) / gs), tr = Math.floor(((change.y ?? doc.y) + h) / gs);
  const from = sectionAt(scene, fc, fr);
  const dir = doc.getFlag?.(SYSTEM_ID, "tunnelDir") ?? 1;
  return !!from && nextSections(scene, from, dir).some(s => s.col === tc && s.row === tr && !sectionBlocked(s));
}

/* ---------- Ворота и Препятствия: состояние меняет ведущий ---------- */

/** Ворота и Препятствия сцены по порядку секций: [{ key, n, type, name, state, states }]. */
export function specialSections(scene = game.scenes?.viewed) {
  const cells = scene?.getFlag?.(SYSTEM_ID, "tunnelCells") ?? {};
  return Object.entries(cells).filter(([, s]) => s.type === "gate" || s.type === "obstacle")
    .map(([key, s]) => {
      const states = s.type === "gate" ? GATE_STATES : OBSTACLE_STATES;
      const state = s.state in states ? s.state : Object.keys(states)[0];
      return { key, n: s.n, type: s.type, gate: s.type === "gate", name: secName(s), state, states: Object.entries(states).map(([k, v]) => ({ k, v, sel: k === state })) };
    })
    .sort((a, b) => a.n - b.n || a.key.localeCompare(b.key));
}

/** Ведущий: сменить состояние Ворот или Препятствия; подпись секции на карте показывает его. */
export async function setSectionState(scene, key, state) {
  const s = scene?.getFlag?.(SYSTEM_ID, "tunnelCells")?.[key];
  if (!game.user.isGM || !s || !["gate", "obstacle"].includes(s.type)) return;
  const states = s.type === "gate" ? GATE_STATES : OBSTACLE_STATES;
  if (!(state in states)) return;
  await scene.update({ [`flags.${SYSTEM_ID}.tunnelCells.${key}.state`]: state });
  // подпись «Т5 Ворота» из импорта миссии: дописать состояние, кроме обычного
  const [col, row] = key.split(",").map(Number), gs = scene.grid?.size ?? 100;
  const base = `Т${s.n} ${secName(s)}`, def = Object.keys(states)[0];
  const text = state === def ? base : `${base} · ${states[state]}`;
  const upd = (scene.drawings ?? []).filter(d => typeof d.text === "string" && (d.text === base || d.text.startsWith(`${base} · `))
    && Math.floor(d.x / gs) === col && Math.floor(d.y / gs) === row && d.text !== text).map(d => ({ _id: d.id, text }));
  if (upd.length) await scene.updateEmbeddedDocuments("Drawing", upd);
  const what = s.type === "gate" ? `Ворота Т${s.n} ${states[state]}` : `Препятствие Т${s.n}: ${states[state]}`;
  ui.notifications.info(`${what}.`);
}

/** Название секции по типу (из каталога, если он загружен, иначе ключ). */
export function secName(sec) {
  return TUNNEL_NAMES[sec?.type] ?? sec?.type ?? "";
}
export const TUNNEL_NAMES = { straight: "Прямая", bend: "Изгиб", narrow: "Узость", hall: "Зал", gate: "Ворота", shaft: "Шахта", fork: "Развилка", obstacle: "Препятствие" };
