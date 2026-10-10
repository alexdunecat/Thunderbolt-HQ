/* Туннели: в конце хода самолёт сам продвигается по секциям (1, при Speed 4+ на 2) и делает проверку пролёта
   Push против 3 + Speed (+2 в Узости и у Препятствия). В Зале обычные правила, на Развилке ветку выбирает пилот.
   Триггер «Это никогда не пригодится» освобождает от проверок пролёта. Направление после разворота в Зале — флаг токена. */
import { SYSTEM_ID } from "./config.mjs";
import { esc } from "./utils.mjs";
import { sectionAt, tunnelAt, nextSections, cellOf, isFlying } from "./scene.mjs";

const HARD = ["narrow", "obstacle"];
const hasTrigger = (actor, key) => actor?.items?.some?.(i => i.type === "trigger" && i.system.key === key);

export function registerTunnel() {
  // разворот в Зале: Move из Зала к секции с меньшим номером меняет направление полёта
  Hooks.on("preUpdateToken", (doc, change) => {
    if (!("x" in change || "y" in change) || !doc.parent?.getFlag?.(SYSTEM_ID, "tunnelCells")) return;
    const scene = doc.parent, gs = scene.grid?.size ?? canvas.grid.size, w = (doc.width ?? 1) * gs / 2, h = (doc.height ?? 1) * gs / 2;
    const from = sectionAt(scene, Math.floor((doc.x + w) / gs), Math.floor((doc.y + h) / gs));
    const dest = sectionAt(scene, Math.floor(((change.x ?? doc.x) + w) / gs), Math.floor(((change.y ?? doc.y) + h) / gs));
    const dir = doc.getFlag?.(SYSTEM_ID, "tunnelDir") ?? 1;
    let want = dir;
    if (from?.type === "hall" && dest && dest.n !== from.n) want = dest.n < from.n ? -1 : 1;
    if (!dest) want = 1;
    if (want !== dir) foundry.utils.setProperty(change, `flags.${SYSTEM_ID}.tunnelDir`, want);
  });
  Hooks.on("updateCombat", (combat, change) => {
    if (!game.users.activeGM?.isSelf || !combat.started || !("turn" in change || "round" in change)) return;
    const prev = combat.previous?.combatantId ? combat.combatants.get(combat.previous.combatantId) : null;
    if (prev && prev.id !== combat.combatant?.id) tunnelTurnEnd(prev).catch(err => console.error(`${SYSTEM_ID} | туннель`, err));
  });
}

/**
 * Куда течение вынесет самолёт за конец хода: { path: [секции], exit: {col,row} | null, fork: bool }.
 * Останавливается на Развилке (ветку выбирает пилот), в Зале и на выходе из последней секции.
 */
export function drift(scene, sec, steps, dir = 1) {
  const path = [];
  let cur = sec, exit = null, fork = false;
  for (let i = 0; i < steps; i++) {
    const nxt = nextSections(scene, cur, dir);
    if (nxt.length > 1) { fork = true; break; }
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
  return { path, exit, fork };
}

/** Сложность проверки пролёта: 3 + Speed, +2 если на пути Узость или Препятствие. */
export const passDc = (speed, secs) => 3 + Math.max(0, speed) + (secs.some(s => HARD.includes(s.type)) ? 2 : 0);

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
  const { path, exit, fork } = drift(scene, sec, speed >= 4 ? 2 : 1, dir);
  const dest = exit ?? path[path.length - 1] ?? null;
  if (dest) {
    const cell = cellOf(token);
    await token.document.update({ x: token.document.x + (dest.col - cell.col) * gs, y: token.document.y + (dest.row - cell.row) * gs }, { tbKeep: true });
  }
  const passed = [sec, ...path];
  const where = exit ? "вылетел из туннеля" : fork && !path.length ? "у Развилки" : path.length ? `продвинулся на ${path.length === 1 ? "секцию" : `${path.length} секции`}: Т${path[path.length - 1].n} ${esc(secName(path[path.length - 1]))}` : "остался в секции";
  const notes = [`${esc(token.name)} ${where}.`];
  if (fork) notes.push(`Развилка: ветку выбирает пилот, перетащите токен в нужную секцию.${passed.some(s => HARD.includes(s.type)) ? "" : " Если там Узость или Препятствие, сложность пролёта +2."}`);
  const free = hasTrigger(actor, "nevercome");
  const inHall = path[path.length - 1]?.type === "hall";
  const dc = passDc(speed, passed);
  const check = !exit && !inHall && !free;
  if (free && !exit && !inHall) notes.push("«Это никогда не пригодится»: проверки пролёта нет.");
  if (inHall) notes.push("Зал: обычные правила боя, проверки пролёта нет.");
  const { postCard } = await import("./dice/rolls.mjs");
  return postCard(actor, { type: "tunnel", label: "Туннель: конец хода", notes, check, dc, speed, hard: passed.some(s => HARD.includes(s.type)) }, [],
    { author: game.users.find(u => u.active && !u.isGM && actor.testUserPermission(u, "OWNER"))?.id });
}

/** Название секции по типу (из каталога, если он загружен, иначе ключ). */
export function secName(sec) {
  return TUNNEL_NAMES[sec?.type] ?? sec?.type ?? "";
}
export const TUNNEL_NAMES = { straight: "Прямая", bend: "Изгиб", narrow: "Узость", hall: "Зал", gate: "Ворота", shaft: "Шахта", fork: "Развилка", obstacle: "Препятствие" };
