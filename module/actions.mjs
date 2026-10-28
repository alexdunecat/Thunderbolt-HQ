/* Счётчик действий в бою: сколько из заявленных действий уже сделано за ход и был ли бросок.
   Считаются кнопки листа (Lock On!, Fox Two!, Guns, Break!, передышка, Leadership, Вплотную, проверки навыков),
   кнопки Speed ±, переход токена в другую зону (Move) и смена высоты (Climb / Dive).
   Смену скорости вместе с Move или Climb / Dive в тот же ход правила дают бесплатно.
   Запрещено: действовать до заявки и не в свой ход, сверх заявки, второй бросок за ход, Move дальше соседней зоны
   и Climb / Dive больше чем на ступень. Ведущий может переставить токен в обход правил, перетаскивая его с Shift.
   Move и Climb / Dive засчитываются в момент перемещения, и двигавший видит об этом сообщение. */
import { SYSTEM_ID, TB, hasProp } from "./config.mjs";
import { PASS, isOut } from "./documents/combat.mjs";
import { landBlocked, climbProblem, ALT_ORDER, tunnelClimbProblem, tunnelMoveProblem, tokenOf } from "./scene.mjs";
import { esc } from "./utils.mjs";
import { forkChoice } from "./tunnel.mjs";

export const ACT_NAMES = {
  lock: "Lock On!", missile: "Fox Two!", guns: "Guns, Guns, Guns!", break: "Break!", recover: "Передышка",
  lead: "Leadership", formup: "Вплотную", sam: "Пуск ЗРК", skill: "Проверка", speed: "Change Speed", move: "Move", climb: "Climb / Dive"
};

/** Боец текущего боя для актёра или токена: сначала по токену, потом по актёру. */
export function combatantOf(actor, token = null) {
  const c = game.combat;
  if (!c?.started || !actor) return null;
  const tokId = token?.id ?? (actor.isToken ? actor.token?.id : null);
  return c.combatants.find(x => tokId && x.tokenId === tokId)
    ?? c.combatants.find(x => x.actor === actor || (!actor.isToken && x.actorId === actor.id))
    ?? null;
}

/** Заявлено действий: 1–3, отложивший ход — свои, пропуск — 0. */
export function declaredOf(c) {
  const v = c?.initiative;
  if (typeof v !== "number") return null;
  if (v === PASS) return 0;
  return v > PASS ? v - PASS : v;
}

// своё последнее записанное, пока запись летит на сервер: следующее действие считается уже от него, а не от старого флага.
// Когда запись дошла, флаг сам свежий и своё больше не нужно.
const mine = new Map(), writing = new Map();

/** Что сделано за этот ход: { used, rolled, freeSpeed, list }. */
export function spentOf(c) {
  const round = c?.parent?.round;
  const fresh = s => (s?.round === round ? s : null);
  const own = fresh(mine.get(c?.id));
  return own ?? fresh(c?.getFlag(SYSTEM_ID, "acts")) ?? { round, used: 0, rolled: false, freeSpeed: false, list: [] };
}

/** Почему действие сейчас нельзя сделать, или null. Вне боя ограничений нет. */
export function actionProblem(actor, what, { rolled = false, token = null } = {}) {
  const c = combatantOf(actor, token);
  if (!c) return null;
  const combat = c.parent, name = ACT_NAMES[what] ?? what;
  // «Последний заход» аса: ход вне очереди после Doom, до трёх действий, одно с броском
  const lr = lastRunOf(actor);
  if (lr) return lr.used >= 3 ? `${c.name}: последний заход окончен, три действия сделаны.` : rolled && lr.rolls >= 1 ? `${c.name}: в последнем заходе бросок уже был.` : null;
  if (isOut(c)) return `${c.name} выбыл из боя: действий нет.`;
  if (combat.getFlag(SYSTEM_ID, "ready") !== combat.round) return `${c.name}: сначала заявка действий на этот раунд.`;
  if (combat.combatant?.id !== c.id) return `${c.name}: «${name}» только в свой ход.`;
  const s = spentOf(c), n = declaredOf(c) ?? 0;
  const free = what === "speed" && s.freeSpeed;
  if (!free && s.used >= n) return n === 0 ? `${c.name}: ход пропущен, действий нет.` : `${c.name}: все заявленные действия (${n}) уже сделаны.`;
  if (rolled && s.rolled && !extraRoll(c, s)) return `${c.name}: бросок за этот ход уже был, а он один.`;
  return null;
}

/** «Последний заход» аса в этом бою: { combat, used, rolls, list } или null. */
export function lastRunOf(actor) {
  const f = actor?.getFlag?.(SYSTEM_ID, "lastRun");
  return f && f.combat === globalThis.game?.combat?.id ? f : null;
}

/** Ключ хода бойца: бой, раунд, боец (для отметок «в этот ход»). */
export const turnKey = c => (c ? `${c.parent.id}:${c.parent.round}:${c.id}` : "");

/** «Сверхманёвренность» (приём Су-47 и ADLER) в этот ход: вторая проверка с броском, пока бросков меньше двух. */
function extraRoll(c, s) {
  return c.actor?.getFlag?.(SYSTEM_ID, "supermano") === turnKey(c) && (s.rolls ?? (s.rolled ? 1 : 0)) < 2;
}

/** Можно ли действие; если нет, объяснить. */
export function allowAction(actor, what, opts) {
  const p = actionProblem(actor, what, opts);
  if (p) ui.notifications.warn(p);
  return !p;
}

/** Второй бросок за ход (Improved Fox Two! решается уже в окне пуска). */
export function allowRoll(actor) {
  const lr = lastRunOf(actor);
  if (lr) { if (lr.rolls < 1) return true; ui.notifications.warn("В последнем заходе бросок уже был."); return false; }
  const c = combatantOf(actor);
  if (!c || !spentOf(c).rolled || extraRoll(c, spentOf(c))) return true;
  ui.notifications.warn(`${c.name}: бросок за этот ход уже был, а он один.`);
  return false;
}

/**
 * Отметить сделанное действие. what — ключ из ACT_NAMES; rolled — с броском.
 * Move и Climb / Dive открывают бесплатную смену скорости в этот ход.
 */
export async function spendAction(actor, what, { rolled = false, token = null } = {}) {
  const lr = lastRunOf(actor);
  if (lr) {
    const next = { ...lr, used: lr.used + 1, rolls: lr.rolls + (rolled ? 1 : 0), list: [...(lr.list ?? []), ACT_NAMES[what] ?? what] };
    return actor.setFlag(SYSTEM_ID, "lastRun", next);
  }
  const c = combatantOf(actor, token);
  if (!c?.isOwner) return;
  const name = ACT_NAMES[what] ?? what;
  const s = foundry.utils.deepClone(spentOf(c));
  const free = what === "speed" && s.freeSpeed;
  if (free) s.freeSpeed = false;
  else s.used += 1;
  if (what === "move" || what === "climb") s.freeSpeed = true;
  if (rolled) { s.rolled = true; s.rolls = (s.rolls ?? 0) + 1; }
  s.list.push(free ? `${name} (заодно)` : name);
  // действия идут быстрее, чем сервер отвечает: считаю сразу у себя, а пишу по очереди, последним состоянием
  mine.set(c.id, s);
  const next = (writing.get(c.id) ?? Promise.resolve())
    .then(() => mine.get(c.id) === s ? c.setFlag(SYSTEM_ID, "acts", s) : null)
    .finally(() => { if (mine.get(c.id) === s) mine.delete(c.id); });
  writing.set(c.id, next.catch(() => {}));
  await next;
}

/** Строка для листа и трекера: «1 из 2», «бросок был». */
export function actsSummary(actor) {
  const c = combatantOf(actor);
  if (!c) return null;
  const s = spentOf(c), n = declaredOf(c);
  const turn = c.parent.combatant?.id === c.id;
  const label = `${turn ? "Ваш ход" : "Ход"}: действий ${s.used}${n === null ? ", заявки ещё нет" : ` из ${n}`}${s.rolled ? " · бросок был" : ""}${s.freeSpeed ? " · скорость можно сменить заодно" : ""}`;
  return { used: s.used, declared: n, rolled: s.rolled, freeSpeed: s.freeSpeed, list: s.list.join(", "), over: n !== null && s.used > n, turn, label,
    left: n !== null && s.used < n ? n - s.used : 0, canEnd: turn && c.isOwner && c.parent.getFlag(SYSTEM_ID, "ready") === c.parent.round };
}

/** Завершить свой ход: «Следующий ход», а если действия ещё остались — «Пропустить действия» (с отметкой в чате). */
export async function endTurn(actor) {
  const c = combatantOf(actor);
  const combat = c?.parent;
  if (!c || combat.combatant?.id !== c.id) return ui.notifications.warn(`${actor.name}: сейчас не ваш ход.`);
  if (!c.isOwner) return;
  const s = spentOf(c), n = declaredOf(c) ?? 0, left = Math.max(0, n - s.used);
  if (left) await ChatMessage.create({ speaker: { alias: "AWACS" },
    content: `<div class="tb-card tb-card-round"><div class="tb-note">${esc(c.name)} пропускает ${left === 1 ? "оставшееся действие" : `оставшиеся действия (${left})`} и передаёт ход.</div></div>` });
  return combat.nextTurn();
}

/** На сколько зон сдвигается токен (по центру): 0 — в своей зоне. */
function zoneStep(doc, to) {
  const scene = doc.parent, gs = scene?.grid?.size;
  if (!gs || scene.grid.type === CONST.GRID_TYPES.GRIDLESS) return 0;
  const w = to.width ?? doc.width, h = to.height ?? doc.height;
  const zone = (x, y, ww, hh) => [Math.floor((x + (ww * gs) / 2) / gs), Math.floor((y + (hh * gs) / 2) / gs)];
  const [a, b] = zone(doc.x, doc.y, doc.width, doc.height), [p, q] = zone(to.x ?? doc.x, to.y ?? doc.y, w, h);
  return Math.max(Math.abs(a - p), Math.abs(b - q));
}

/**
 * Move на 2 зоны свойством машины: { label, speed } — High Speed (Speed 5) или сверхзвуковой режим (Speed не ниже 4).
 * Скорость, которой не хватает, ставится заодно с Move (смена скорости при Move бесплатна). null — нельзя.
 */
export function twoZones(actor) {
  const s = actor.system, max = s.maxSpeed ?? s.stats?.spd ?? 0;
  for (const [key, need, label] of [["highspeed", 5, "High Speed"], ["supercruise", 4, "сверхзвуковой режим"]]) {
    if (!hasProp(actor, key)) continue;
    if ((s.speed ?? 0) >= need) return { label, speed: null };
    if (max >= need) return { label, speed: need };
  }
  return null;
}
const twoZoneHint = actor => hasProp(actor, "highspeed") ? " High Speed — 2 зоны при Speed 5." : hasProp(actor, "supercruise") ? " Сверхзвуковой режим — 2 зоны при Speed от 4." : "";

/** После Move на 2–3 зоны: скорость заодно с Move; «Бросок на рубеж» — Speed = Max Speed и бесплатный Lock On!. */
async function afterFastMove(doc, { fast, dash }) {
  const actor = doc.actor;
  if (!actor || (!fast && !dash)) return;
  if (dash) {
    await actor.update({ "system.speed": actor.system.maxSpeed ?? actor.system.speed, [`flags.${SYSTEM_ID}.-=dash`]: null }, { tbFree: true });
    ui.notifications.info(`${doc.name}: «Бросок на рубеж» — Speed ${actor.system.maxSpeed}. Бесплатный Lock On! по цели в зоне прибытия или соседней.`);
    // токен ещё едет: захват считается от места прибытия
    setTimeout(() => actor.lockOn?.({ free: true, label: "Бросок на рубеж" })?.catch?.(err => console.warn(`${SYSTEM_ID} | бросок на рубеж`, err)), 600);
    return;
  }
  if (fast.speed !== null) {
    await spendAction(actor, "speed", { token: doc });
    await actor.update({ "system.speed": fast.speed }, { tbFree: true });
  }
  ui.notifications.info(`${doc.name}: ${fast.label} — Move на 2 зоны${fast.speed !== null ? `, Speed ${fast.speed} заодно` : ""}.`);
}

/** Засчитать Move и Climb / Dive по токену и сказать об этом тому, кто двигал. */
async function countMove(actor, acts, token = null) {
  for (const what of acts) await spendAction(actor, what, { token });
  const c = combatantOf(actor, token);
  if (!c) return;
  const s = spentOf(c), n = declaredOf(c) ?? 0;
  ui.notifications.info(`${token?.name ?? c.name}: ${acts.map(a => ACT_NAMES[a]).join(" и ")} засчитан${acts.length > 1 ? "ы" : ""}, действий ${s.used} из ${n}.`);
}

export function registerActions() {
  // корабли держатся воды (и вне боя); ведущий с Shift ставит куда угодно
  Hooks.on("preUpdateToken", (doc, change, options) => {
    if (options.tbKeep || !("x" in change || "y" in change)) return;
    if (game.user.isGM && game.keyboard?.isModifierActive?.(KeyboardManager.MODIFIER_KEYS.SHIFT)) return;
    const p = landBlocked(doc, change);
    if (!p) return;
    ui.notifications.warn(p);
    return false;
  });
  Hooks.on("preCreateToken", (doc, data, options) => {
    if (options.tbKeep || (game.user.isGM && game.keyboard?.isModifierActive?.(KeyboardManager.MODIFIER_KEYS.SHIFT))) return;
    const p = landBlocked(doc, {});
    if (!p) return;
    ui.notifications.warn(p);
    return false;
  });
  // Move и Climb / Dive проверяются и засчитываются ещё до перемещения: только этот хук точно знает, откуда шёл токен
  Hooks.on("preUpdateToken", (doc, change, options) => {
    // tbSync: токен подтягивается к уже сменённой на листе высоте, Climb / Dive засчитан там
    if (options.tbKeep || options.tbSync || !doc.actor) return;
    if (forkChoice(doc, change)) { foundry.utils.setProperty(change, `flags.${SYSTEM_ID}.tunnelFork`, null); return; }
    const moving = "x" in change || "y" in change || "elevation" in change;
    if (!moving || !game.combat?.started) return;
    if (!combatantOf(doc.actor, doc)) return console.log(`${SYSTEM_ID} | ${doc.name}: токена нет в текущем бою, перемещение не считается`);
    const gmFree = game.user.isGM && !!game.keyboard?.isModifierActive?.(KeyboardManager.MODIFIER_KEYS.SHIFT);
    const problems = [], acts = [];
    // «Полный газ» (Punch It, раз за вылет): одним Move до 3 зон
    const punch = doc.actor.items?.find?.(i => i.type === "trigger" && i.system.key === "punch" && !i.system.used) ?? null;
    let punchUsed = null, fast = null, dash = false;
    if ("x" in change || "y" in change) {
      const d = zoneStep(doc, change);
      if (d > 0) {
        acts.push("move");
        const p = actionProblem(doc.actor, "move", { token: doc }) ?? tunnelMoveProblem(doc, change);
        // «Бросок на рубеж» (приём МиГ-31М и МиГ-1.44), объявленный в этот ход: Move до 3 зон
        dash = d <= 3 && doc.actor.getFlag?.(SYSTEM_ID, "dash") === turnKey(combatantOf(doc.actor, doc));
        // High Speed и сверхзвуковой режим: Move на 2 зоны, если в конце действия Speed 5 (не ниже 4); скорость меняется заодно
        fast = d === 2 && !dash ? twoZones(doc.actor) : null;
        if (p) problems.push(p);
        else if (dash || fast) { /* можно */ }
        else if (d > 1 && d <= 3 && punch) punchUsed = punch;
        else if (d > 1) problems.push(`${doc.name}: Move только в соседнюю зону, а здесь ${d}.${punch ? " «Полный газ» — до 3 зон." : ""}${twoZoneHint(doc.actor)}`);
      }
    }
    // токен без высоты (0, брошен на сцену вручную) стоит на высоте листа
    const levels = Object.values(TB.altElevation);
    const was = levels.includes(doc.elevation) ? doc.elevation : TB.altElevation[doc.actor.system.alt];
    if ("elevation" in change && change.elevation !== was && levels.includes(change.elevation)) {
      acts.push("climb");
      const to = Object.keys(TB.altElevation).find(k => TB.altElevation[k] === change.elevation);
      const p = actionProblem(doc.actor, "climb", { token: doc }) ?? climbProblem(doc.actor, to) ?? (doc.object ? tunnelClimbProblem(doc.object, to) : null);
      if (p) problems.push(p);
      else if (was && Math.abs(change.elevation - was) > 1) problems.push(`${doc.name}: Climb / Dive меняет высоту только на одну ступень.`);
    }
    if (problems.length && !gmFree) { ui.notifications.warn(problems[0]); return false; }
    if (gmFree && problems.length) return;   // ведущий с Shift: в обход правил и без счёта
    console.log(`${SYSTEM_ID} | ${doc.name}: ${acts.join(", ") || "в своей зоне"}${problems.length ? ` (в обход: ${problems[0]})` : ""}`);
    if (acts.length) countMove(doc.actor, acts, doc).then(() => afterFastMove(doc, { fast, dash }))
      .catch(err => console.error(`${SYSTEM_ID} | счёт действий`, err));
    if (punchUsed) punchUsed.update({ "system.used": true }).then(() => ui.notifications.info(`${doc.name}: «Полный газ» — Move через несколько зон, триггер отмечен использованным в этом вылете.`))
      .catch(err => console.error(`${SYSTEM_ID} | Полный газ`, err));
  });
  // Change Speed: кнопки ±, поле листа и полоска токена. Сброс после Break!, сваливание и т. п. идут с options.tbFree.
  Hooks.on("preUpdateActor", (actor, change, options) => {
    if (options.tbFree || !foundry.utils.hasProperty(change, "system.speed")) return;
    const v = Number(change.system.speed);
    if (!Number.isFinite(v) || v === actor.system.speed || !combatantOf(actor)) return;
    const p = actionProblem(actor, "speed");
    if (p) { ui.notifications.warn(p); return false; }
    spendAction(actor, "speed")?.catch?.(err => console.error(`${SYSTEM_ID} | счёт действий`, err));
  });
  // смена высоты из листа проверяется и засчитывается так же, как ▲▼ на токене (токены потом подтягиваются с tbSync)
  Hooks.on("preUpdateActor", (actor, change, options) => {
    if (options.tbSync || options.tbFree || !foundry.utils.hasProperty(change, "system.alt") || change.system.alt === actor.system.alt) return;
    if (!combatantOf(actor)) return;
    const step = Math.abs(ALT_ORDER.indexOf(change.system.alt) - ALT_ORDER.indexOf(actor.system.alt));
    const tok = tokenOf(actor);
    const p = actionProblem(actor, "climb") ?? climbProblem(actor, change.system.alt) ?? (tok ? tunnelClimbProblem(tok, change.system.alt) : null)
      ?? (step > 1 ? `${actor.name}: Climb / Dive меняет высоту только на одну ступень.` : null);
    if (p) { ui.notifications.warn(p); return false; }
    countMove(actor, ["climb"]);
  });
  // лист и трекер показывают счётчик
  Hooks.on("updateCombatant", c => { if (c.actor?.sheet?.rendered) c.actor.sheet.render(false); });
}
