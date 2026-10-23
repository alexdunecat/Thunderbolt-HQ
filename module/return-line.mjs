/* Линия возврата (как в Ace Combat): клетки «за линией» на сцене, флаг сцены returnLine { cells: ["c,r"], ...настройки }.
   Настройки (return-rules.mjs) задаёт ведущий: что бывает с врагом за линией (уходит с поля, уходит и вернётся,
   остаётся), сколько врагов или приоритетных целей за линией проваливают задание, сопровождение (одна или все
   союзные цели за линией — задание выполнено) и что делает пилот за линией (выбирает сам, выходит из боя,
   перевооружается и возвращается, ничего). Счёт боя — флаг сцены retTally.
   Следит клиент ведущего: только переход через линию снаружи внутрь во время боя. */
import { SYSTEM_ID } from "./config.mjs";
import { esc, resolveActor } from "./utils.mjs";
import { sideOf } from "./scene.mjs";
import { retNorm, rearmText } from "./return-rules.mjs";

/** Реплика AWACS всем (радио грузится лениво: его окна нужны только в игре). */
const sendRadio = data => import("./radio.mjs").then(m => m.sendRadio(data));

const CHANNEL = `system.${SYSTEM_ID}`;
const leadGM = () => (game.users.activeGM ?? game.users.find(u => u.isGM && u.active))?.id === game.user.id;
const DEAD = () => CONFIG.specialStatusEffects?.DEFEATED ?? "dead";

/** Линия возврата сцены или null. */
export function lineOf(scene) {
  const l = scene?.getFlag?.(SYSTEM_ID, "returnLine");
  return l?.cells?.length ? { cells: l.cells, ...retNorm(l) } : null;
}

/** Клетки, которые занимает токен (по документу, без холста): большой токен стоит во всех своих клетках. */
export function docCells(doc, x = doc.x, y = doc.y) {
  const gs = doc.parent?.grid?.size ?? 200, w = doc.width ?? 1, h = doc.height ?? 1, out = [];
  const c0 = Math.floor((x + 1) / gs), r0 = Math.floor((y + 1) / gs);
  const c1 = Math.floor((x + Math.max(1, w * gs) - 1) / gs), r1 = Math.floor((y + Math.max(1, h * gs) - 1) / gs);
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) out.push([c, r]);
  return out;
}

/** За линией ли токен: хоть одна его клетка за линией. */
export function isBeyond(line, doc, x, y) {
  if (!line) return false;
  const set = new Set(line.cells);
  return docCells(doc, x, y).some(([c, r]) => set.has(`${c},${r}`));
}

/** Сколько зон до линии (0 — уже за ней). */
export function lineDistance(line, doc) {
  if (!line) return null;
  const cs = line.cells.map(k => k.split(",").map(Number));
  let best = Infinity;
  for (const [c, r] of docCells(doc)) for (const [a, b] of cs) best = Math.min(best, Math.max(Math.abs(a - c), Math.abs(b - r)));
  return Number.isFinite(best) ? best : null;
}

/** Чем линия грозит этому NPC (враг) или что она для него (союзник при сопровождении): подсказка ведущему, или "". */
export function lineHint(actor, doc) {
  const line = lineOf(doc?.parent);
  if (!line || actor?.type !== "npc") return "";
  const side = sideOf(actor);
  if (side === "ally" && line.escort !== "off" && escortTargets(doc.parent).includes(doc)) {
    const d = lineDistance(line, doc);
    return d === null ? "" : `до линии сопровождения ${d}`;
  }
  if (side !== "enemy") return "";
  const d = lineDistance(line, doc);
  if (d === null) return "";
  const what = actor.system.priority && line.failPriority ? "уйдёт — к провалу задания"
    : line.failEnemies ? "прорыв идёт к провалу задания"
    : line.enemy === "later" ? "уйдёт и вернётся подкреплением" : line.enemy === "leave" ? "уйдёт с поля" : "";
  return what ? `до линии ${d}: ${what}` : "";
}

const combatOn = scene => { const c = game.combat; return c?.started && (c.scene ?? game.scenes.viewed) === scene ? c : null; };
const out = a => !a || a.statuses?.has(DEAD()) || a.statuses?.has("retreat") || !!a.system?.markers?.doom;
export const rearmOf = (actor, combat = game.combat) => { const f = actor?.getFlag?.(SYSTEM_ID, "rearm"); return f && f.combat === combat?.id ? f : null; };

/* ---------- пересечение линии ---------- */

/** Где был токен до хода: за линией или нет (клиент ведущего). */
const was = new Map();
function remember(doc) { was.set(doc.uuid, isBeyond(lineOf(doc.parent), doc)); }

async function onMove(doc, change, options) {
  if (!leadGM() || !("x" in change || "y" in change)) return;
  const before = was.get(doc.uuid);
  remember(doc);
  // отмена ведущего возвращает и отметки: заново ничего не делаем
  if (options?.tbUndo) return;
  const line = lineOf(doc.parent), combat = combatOn(doc.parent), a = doc.actor;
  if (!line || !combat || !a || !["pilot", "npc"].includes(a.type)) return;
  const now = isBeyond(line, doc);
  // ушедшего за линию вернули назад тем же ходом: уход отменяется
  if (!now && a.getFlag(SYSTEM_ID, "escaped")?.combat === combat.id) return cancelEscape(doc, combat);
  if (!now || before !== false) return;
  if (a.type === "pilot") return pilotCrossed(doc, combat, line);
  if (out(a)) return;
  const side = sideOf(a);
  if (side === "enemy") return enemyCrossed(doc, combat, line);
  if (side === "ally" && line.escort !== "off" && escortTargets(doc.parent).includes(doc)) return allyCrossed(doc, combat, line);
}

/** Союзные цели сопровождения: союзные приоритетные цели, а если их нет — все союзные машины (кроме зданий и объектов). */
export function escortTargets(scene) {
  const allies = (scene?.tokens ?? []).filter(t => t.actor?.type === "npc" && sideOf(t.actor) === "ally" && t.actor.system.grp !== "obj");
  const goals = allies.filter(t => t.actor.system.priority);
  return goals.length ? goals : allies;
}

/* ---------- счёт боя ---------- */

/** Счёт линии в этом бою: { combat, enemies: [], priority: [], allies: [], result: "" | "failed" | "success", reason }. */
export function tallyOf(scene, combat = game.combat) {
  const t = scene?.getFlag?.(SYSTEM_ID, "retTally");
  return t && t.combat === combat?.id ? foundry.utils.deepClone(t) : { combat: combat?.id ?? "", enemies: [], priority: [], allies: [], result: "", reason: "" };
}

/** Итог по счёту: провал по порогам, успех сопровождения, иначе пусто. */
function judge(scene, line, t) {
  if (line.failPriority && t.priority.length >= line.failPriority) return { result: "failed", reason: "Цели ушли за линию" };
  if (line.failEnemies && t.enemies.length >= line.failEnemies) return { result: "failed", reason: line.enemy === "stay" ? "Противник прорвал рубеж" : "Противник ушёл за линию" };
  if (line.escort !== "off" && t.allies.length) {
    // «все»: из целей сопровождения в строю не осталось никого перед линией
    const left = escortTargets(scene).filter(x => !out(x.actor) && !t.allies.includes(x.name));
    if (line.escort === "one" || !left.length) return { result: "success", reason: "Сопровождение выполнено" };
  }
  return { result: "", reason: "" };
}

/** Записать пересечение (или его отмену) и объявить итог, если он только что сложился. */
async function tally(doc, combat, line, add, remove = false) {
  const scene = doc.parent, t = tallyOf(scene, combat), before = t.result;
  for (const [k, on] of Object.entries(add)) {
    if (!on) continue;
    t[k] = remove ? t[k].filter(n => n !== doc.name) : [...new Set([...t[k], doc.name])];
  }
  Object.assign(t, judge(scene, line, t));
  await scene.setFlag(SYSTEM_ID, "retTally", t);
  if (t.result && t.result !== before) return announce(combat, t);
  if (before && !t.result) ui.notifications.info("Линия возврата: итог задания снят, условия больше не выполнены.");
}

async function announce(combat, t) {
  const ok = t.result === "success";
  await sendRadio({ text: ok ? "Все цели за линией. Задание выполнено, отличная работа!" : `${t.reason}. Задание провалено.`,
    caution: { level: ok ? "caution" : "warning", title: ok ? "MISSION" : "WARNING", sub: ok ? "Сопровождение выполнено" : t.reason } });
  return ChatMessage.create({ speaker: { alias: "AWACS" }, flags: { [SYSTEM_ID]: { retline: { kind: "result", result: t.result, reason: t.reason } } },
    content: `<div class="tb-card tb-card-round"><header class="tb-card-head"><span class="tb-card-who">AWACS</span><span class="tb-card-what">${ok ? "Задание выполнено" : "Задание провалено"}</span></header>
      <div class="tb-note">${esc(t.reason)}, раунд ${combat.round}: ${tallyLine(t)}. Бой можно продолжать, итог объявляет AWACS.</div>
      <div class="tb-actions"><button type="button" data-tb-ret="mission" class="tb-gm"><i class="fas fa-flag-checkered"></i> Итог миссии</button></div></div>` });
}

/** Счёт одной строкой. */
export function tallyLine(t) {
  const parts = [];
  if (t.enemies.length) parts.push(`врагов за линией ${t.enemies.length}${t.priority.length ? `, из них целей ${t.priority.length}` : ""}`);
  if (t.allies.length) parts.push(`союзных целей дошло ${t.allies.length}`);
  return parts.join("; ") || "за линию никто не ушёл";
}

/* ---------- кто пересёк ---------- */

async function enemyCrossed(doc, combat, line) {
  const a = doc.actor, goal = !!a.system.priority;
  if (line.enemy === "stay") await sendRadio({ text: `${doc.name} за линией!` });
  else {
    if (line.enemy === "later") {
      const list = escapedOf(doc.parent);
      list.push({ id: foundry.utils.randomID(), name: doc.name, round: combat.round, token: doc.id, priority: goal, data: doc.toObject() });
      await doc.parent.setFlag(SYSTEM_ID, "escapedUnits", list);
    }
    await a.setFlag(SYSTEM_ID, "escaped", { combat: combat.id, round: combat.round, mode: line.enemy });
    await a.toggleStatusEffect("retreat", { active: true });
    await sendRadio({ text: line.enemy === "later" ? `${doc.name} уходит за линию возврата. Он ещё вернётся, и не один.`
      : goal ? `Цель ${doc.name} ушла за линию возврата! Мы её упустили.` : `${doc.name} уходит за линию возврата.` });
  }
  return tally(doc, combat, line, { enemies: true, priority: goal });
}

async function allyCrossed(doc, combat, line) {
  const a = doc.actor;
  await a.setFlag(SYSTEM_ID, "escaped", { combat: combat.id, round: combat.round, mode: "safe" });
  await a.toggleStatusEffect("retreat", { active: true });
  await sendRadio({ text: `${doc.name} за линией, в безопасности.` });
  return tally(doc, combat, line, { allies: true });
}

/** Ушедшего вернули на эту сторону до конца раунда: уход и счёт отменяются. */
async function cancelEscape(doc, combat = game.combat) {
  const a = doc.actor, mode = a.getFlag(SYSTEM_ID, "escaped")?.mode;
  await a.unsetFlag(SYSTEM_ID, "escaped");
  if (a.statuses?.has("retreat")) await a.toggleStatusEffect("retreat", { active: false });
  const list = escapedOf(doc.parent), left = list.filter(e => e.token !== doc.id);
  if (left.length !== list.length) await doc.parent.setFlag(SYSTEM_ID, "escapedUnits", left);
  const line = lineOf(doc.parent);
  if (line && combat && a.type === "npc") await tally(doc, combat, line, mode === "safe" ? { allies: true } : { enemies: true, priority: !!a.system.priority }, true);
  ui.notifications.info(`${doc.name} снова перед линией: уход отменён.`);
}

/** Ушедшие за линию в режиме later: [{ id, name, round, token, priority, data }]. */
export const escapedOf = scene => foundry.utils.deepClone(scene?.getFlag?.(SYSTEM_ID, "escapedUnits") ?? []);

/** Пилот за линией: как решил ведущий в настройках линии. «Выбирает сам» — карточка владельцу (или ведущему), без дублей. */
async function pilotCrossed(doc, combat, line) {
  const a = doc.actor;
  if (line.pilots === "stay" || out(a) || rearmOf(a, combat)) return;
  if (line.pilots === "leave" || line.pilots === "rearm") return pilotAct(doc, combat, line, line.pilots);
  const pending = game.messages.contents.slice(-40).some(m => { const r = m.getFlag(SYSTEM_ID, "retline"); return r?.kind === "pilot" && !r.done && r.uuid === a.uuid; });
  if (pending) return;
  return ChatMessage.create({ speaker: { alias: "AWACS" }, flags: { [SYSTEM_ID]: { retline: { kind: "pilot", uuid: a.uuid, token: doc.uuid, combat: combat.id } } },
    content: pilotCard(doc.name, line) });
}

const pilotCard = (name, line, done = "") => `<div class="tb-card tb-card-round"><header class="tb-card-head"><span class="tb-card-who">AWACS</span><span class="tb-card-what">${esc(name)} за линией возврата</span></header>
  ${done ? `<div class="tb-note">${done}</div>` : `<div class="tb-note">Выйти из боя, перевооружиться или остаться. Перевооружение: пилот ${esc(rearmText(line))}.</div>
  <div class="tb-actions"><button type="button" data-tb-ret="leave"><i class="fas fa-plane-departure"></i> Выйти из боя</button><button type="button" data-tb-ret="rearm"><i class="fas fa-screwdriver-wrench"></i> Перевооружиться</button><button type="button" data-tb-ret="stay" title="Пилот залетел за линию, но остаётся в бою">Остаться</button></div>`}</div>`;

/** Выйти из боя или уйти на перевооружение (делает ведущий: игроку не скрыть свой токен). Возвращает строку для карточки. */
async function pilotAct(doc, combat, line, op) {
  const a = doc.actor;
  if (op === "leave") {
    await a.setFlag(SYSTEM_ID, "escaped", { combat: combat.id, round: combat.round, mode: "leave" });
    await a.toggleStatusEffect("retreat", { active: true });
    await sendRadio({ text: `${doc.name} выходит из боя за линией возврата.` });
    return `${esc(doc.name)} выходит из боя: в конце раунда уходит с поля.`;
  }
  const back = combat.round + line.rearmRounds + 1;
  await a.setFlag(SYSTEM_ID, "rearm", { combat: combat.id, back, strain: line.rearmStrain });
  await doc.update({ hidden: true }, { tbFree: true });
  await sendRadio({ text: `${doc.name}, принято, уходите на перевооружение. Ждём вас обратно.` });
  return `${esc(doc.name)} уходит на перевооружение. Вернётся в начале раунда ${back}${line.rearmStrain ? "" : ", Strain не восстанавливается"}.`;
}

/** Выбор пилота с карточки. */
async function pilotChoice(msgId, op) {
  const msg = game.messages.get(msgId), r = msg?.getFlag(SYSTEM_ID, "retline");
  if (!r || r.done || r.kind !== "pilot") return;
  const doc = fromUuidSync(r.token), combat = game.combats.get(r.combat), line = lineOf(doc?.parent);
  if (!doc?.actor || !combat || !line) return;
  const note = op === "stay" ? `${esc(doc.name)} остаётся в бою.` : await pilotAct(doc, combat, line, op);
  await msg.update({ content: pilotCard(doc.name, line, note), [`flags.${SYSTEM_ID}.retline.done`]: op });
}

/** Начало раунда (ведущий, до заявок): пилоты с перевооружения возвращаются. */
export async function returnRound(combat) {
  for (const c of combat.combatants) {
    const a = c.actor, f = rearmOf(a, combat);
    if (!f || f.back > combat.round) continue;
    await a.refitReturn({ strain: !!f.strain });
    await a.unsetFlag(SYSTEM_ID, "rearm");
    const doc = c.token;
    if (doc?.hidden) await doc.update({ hidden: false }, { tbFree: true });
    if (doc) remember(doc);
    await sendRadio({ text: `${c.name} снова в строю: боезапас полон, машина в порядке.` });
  }
}

/** Вернуть ушедшего за линию (режим later): токен на прежнее место за линией и в бой. */
export async function bringBack(id) {
  const scene = game.scenes.viewed, list = escapedOf(scene), e = list.find(x => x.id === id);
  if (!e) return;
  const old = scene.tokens.get(e.token);
  let doc;
  if (old) { await cancelEscape(old); doc = old; }
  else {
    const data = foundry.utils.deepClone(e.data);
    delete data._id;
    data.hidden = false;
    // снимок взят до отступления, но на всякий случай: без статуса отступления и отметки ухода
    if (data.delta?.effects) data.delta.effects = data.delta.effects.filter(ef => !(ef.statuses ?? []).includes("retreat"));
    if (data.delta?.flags?.[SYSTEM_ID]) { delete data.delta.flags[SYSTEM_ID].escaped; delete data.delta.flags[SYSTEM_ID].down; }
    [doc] = await scene.createEmbeddedDocuments("Token", [data]);
    await scene.setFlag(SYSTEM_ID, "escapedUnits", list.filter(x => x.id !== id));
    const combat = combatOn(scene);
    if (doc && combat) await combat.createEmbeddedDocuments("Combatant", [{ tokenId: doc.id, sceneId: scene.id, actorId: doc.actorId }]);
  }
  if (doc) remember(doc);
  return sendRadio({ text: `Внимание, ${e.name} возвращается из-за линии${e.priority ? "" : " с подкреплением"}!`, caution: { title: "CAUTION", sub: "Противник возвращается" } });
}

/** Забыть ушедшего (не вернётся). */
export async function forgetEscaped(id) {
  const scene = game.scenes.viewed;
  await scene.setFlag(SYSTEM_ID, "escapedUnits", escapedOf(scene).filter(x => x.id !== id));
}

/** Настройки линии сцены (часть полей): подпись на карте может смениться. */
export async function setLineSettings(scene, patch) {
  const l = lineOf(scene);
  if (!l) return;
  const { cells, ...cur } = l;
  await scene.setFlag(SYSTEM_ID, "returnLine", { cells, ...retNorm({ ...cur, ...patch }) });
  const { redrawReturnLine } = await import("./apps/mission-import.mjs");
  await redrawReturnLine(scene);
}

/* ---------- хуки ---------- */

function bindCard(message, root) {
  const r = message.getFlag?.(SYSTEM_ID, "retline");
  if (!r || !root?.querySelectorAll) return;
  for (const b of root.querySelectorAll("[data-tb-ret]")) {
    const op = b.dataset.tbRet;
    const who = r.uuid ? resolveActor(r.uuid) : null;
    if (op === "mission" ? !game.user.isGM : !(game.user.isGM || who?.isOwner)) { b.remove(); continue; }
    b.addEventListener("click", async ev => {
      ev.preventDefault();
      if (op === "mission") {
        const m = await import("./mission.mjs");
        return m.openMissionDialog({ op: game.scenes.viewed?.getFlag(SYSTEM_ID, "mission") || game.scenes.viewed?.name || "", suggest: { result: r.result || "failed", reason: r.reason ?? "" } });
      }
      b.disabled = true;
      if (game.user.isGM) await pilotChoice(message.id, op).catch(err => console.error(`${SYSTEM_ID} | линия возврата`, err));
      else if (game.users.activeGM) game.socket.emit(CHANNEL, { type: "retline", msg: message.id, op });
      else { b.disabled = false; ui.notifications.warn("Ведущего нет в сети: выбор за линией делает он."); }
    });
  }
}

export function registerReturnLine() {
  Hooks.on("updateToken", (doc, change, options) => { onMove(doc, change, options).catch(err => console.error(`${SYSTEM_ID} | линия возврата`, err)); });
  Hooks.on("createToken", doc => { if (game.user.isGM) remember(doc); });
  Hooks.on("deleteToken", doc => was.delete(doc.uuid));
  Hooks.on("canvasReady", () => { was.clear(); for (const t of canvas.scene?.tokens ?? []) remember(t); });
  Hooks.on("updateScene", (scene, change) => { if (foundry.utils.hasProperty(change, `flags.${SYSTEM_ID}`)) for (const t of scene.tokens) remember(t); });
  Hooks.on("renderChatMessage", (message, html) => bindCard(message, html?.[0] ?? html));
  // бой кончился, пока пилот перевооружался: токен снова виден, отметка снята
  Hooks.on("deleteCombat", combat => {
    if (!leadGM()) return;
    for (const c of combat.combatants) if (rearmOf(c.actor, combat)) {
      c.actor.unsetFlag(SYSTEM_ID, "rearm").catch(() => null);
      if (c.token?.hidden) c.token.update({ hidden: false }, { tbFree: true }).catch(() => null);
    }
  });
  Hooks.once("ready", () => game.socket.on(CHANNEL, msg => {
    if (msg?.type === "retline" && leadGM()) pilotChoice(msg.msg, msg.op).catch(err => console.error(`${SYSTEM_ID} | линия возврата`, err));
  }));
}
