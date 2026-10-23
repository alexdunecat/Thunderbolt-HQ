/* Линия возврата (как в Ace Combat): клетки «за линией» на сцене, флаг сцены returnLine { cells: ["c,r"], mode }.
   Что значит пересечь линию, ведущий выбирает на миссию:
   fail   — враг ушёл за линию: отступил с поля (у приоритетной цели задача провалена, как при любом отступлении);
   later  — враг ушёл, но вернётся позже подкреплением: он в списке «Ушли за линию» панели AWACS, оттуда «Вернуть»;
   border — рубеж обороны: прорыв врага за линию проваливает задание (карточка, итоги боя и итог миссии).
   Пилот, пересёкший линию в режимах fail и later, выбирает: выйти из боя или перевооружиться и вернуться
   через раунд (HP, Structure, системы и боезапас как перед вылетом, Strain и Grit не восстанавливаются).
   Следит клиент ведущего: только переход через линию снаружи внутрь во время боя. */
import { SYSTEM_ID } from "./config.mjs";
import { esc, resolveActor } from "./utils.mjs";
import { sideOf } from "./scene.mjs";

/** Реплика AWACS всем (радио грузится лениво: его окна нужны только в игре). */
const sendRadio = data => import("./radio.mjs").then(m => m.sendRadio(data));

const CHANNEL = `system.${SYSTEM_ID}`;
export const RET_MODES = {
  fail: "Ушла приоритетная цель — задача провалена",
  later: "Ушедшие вернутся позже подкреплением",
  border: "Рубеж обороны: прорыв врага — задание провалено"
};
const leadGM = () => (game.users.activeGM ?? game.users.find(u => u.isGM && u.active))?.id === game.user.id;
const DEAD = () => CONFIG.specialStatusEffects?.DEFEATED ?? "dead";

/** Линия возврата сцены или null. */
export function lineOf(scene) {
  const l = scene?.getFlag?.(SYSTEM_ID, "returnLine");
  return l?.cells?.length ? { cells: l.cells, mode: RET_MODES[l.mode] ? l.mode : "fail" } : null;
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

/** Чем линия грозит этому NPC: подсказка для совета ведущему и панели AWACS, или "". */
export function lineHint(actor, doc) {
  const line = lineOf(doc?.parent);
  if (!line || actor?.type !== "npc" || sideOf(actor) !== "enemy") return "";
  const d = lineDistance(line, doc);
  if (d === null) return "";
  if (line.mode === "border") return d === 0 ? "уже за рубежом" : `до рубежа ${d}: прорыв за него проваливает задание`;
  if (!actor.system.priority && line.mode === "fail") return "";
  return `до линии возврата ${d}: ${line.mode === "later" ? "уйдёт и вернётся подкреплением" : "уйдёт — задача провалена"}`;
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
  // враг, ушедший за линию, вернули назад тем же ходом: отступление отменяется
  if (!now && a.getFlag(SYSTEM_ID, "escaped")?.combat === combat.id) return cancelEscape(doc);
  if (!now || before !== false) return;
  if (a.type === "pilot") return line.mode === "border" ? null : askPilot(doc, combat);
  if (sideOf(a) !== "enemy" || out(a)) return;
  return line.mode === "border" ? breach(doc, combat) : escape(doc, combat, line.mode);
}

/** Враг ушёл за линию: отступил, в конце раунда уходит с поля. В режиме later его снимок ждёт в списке «Ушли за линию». */
async function escape(doc, combat, mode) {
  const a = doc.actor;
  if (mode === "later") {
    const list = escapedOf(doc.parent);
    list.push({ id: foundry.utils.randomID(), name: doc.name, round: combat.round, token: doc.id, priority: !!a.system.priority, data: doc.toObject() });
    await doc.parent.setFlag(SYSTEM_ID, "escapedUnits", list);
  }
  await a.setFlag(SYSTEM_ID, "escaped", { combat: combat.id, round: combat.round, mode });
  await a.toggleStatusEffect("retreat", { active: true });
  const goal = a.system.priority;
  return sendRadio({ text: mode === "later"
    ? `${doc.name} уходит за линию возврата. Он ещё вернётся, и не один.`
    : goal ? `Цель ${doc.name} ушла за линию возврата! Мы её упустили.` : `${doc.name} уходит за линию возврата.` });
}

/** Отступление за линию отменено: ведущий вернул токен на эту сторону до конца раунда. */
async function cancelEscape(doc) {
  const a = doc.actor;
  await a.unsetFlag(SYSTEM_ID, "escaped");
  if (a.statuses?.has("retreat")) await a.toggleStatusEffect("retreat", { active: false });
  const list = escapedOf(doc.parent), left = list.filter(e => e.token !== doc.id);
  if (left.length !== list.length) await doc.parent.setFlag(SYSTEM_ID, "escapedUnits", left);
  ui.notifications.info(`${doc.name} снова перед линией: отступление отменено.`);
}

/** Прорыв рубежа: задание провалено. Один раз на машину за бой. */
async function breach(doc, combat) {
  const scene = doc.parent, cur = breachOf(scene, combat);
  if (cur.includes(doc.name)) return;
  await scene.setFlag(SYSTEM_ID, "retBreach", { combat: combat.id, names: [...cur, doc.name] });
  await sendRadio({ text: `${doc.name} прорвался за рубеж обороны! Задание провалено.`, caution: { level: "warning", title: "WARNING", sub: "Рубеж прорван" } });
  return ChatMessage.create({ speaker: { alias: "AWACS" }, flags: { [SYSTEM_ID]: { retline: { kind: "breach" } } },
    content: `<div class="tb-card tb-card-round"><header class="tb-card-head"><span class="tb-card-who">AWACS</span><span class="tb-card-what">Рубеж прорван</span></header>
      <div class="tb-note">${esc(doc.name)} за рубежом обороны, раунд ${combat.round}. По условиям миссии задание провалено. Бой можно продолжать: решает AWACS.</div>
      <div class="tb-actions"><button type="button" data-tb-ret="mission" class="tb-gm"><i class="fas fa-flag-checkered"></i> Итог миссии</button></div></div>` });
}

/** Кто прорвал рубеж в этом бою. */
export function breachOf(scene, combat = game.combat) {
  const b = scene?.getFlag?.(SYSTEM_ID, "retBreach");
  return b && b.combat === combat?.id ? b.names ?? [] : [];
}

/** Ушедшие за линию в режиме later: [{ id, name, round, token, priority, data }]. */
export const escapedOf = scene => foundry.utils.deepClone(scene?.getFlag?.(SYSTEM_ID, "escapedUnits") ?? []);

/** Пилот за линией: карточка с выбором владельцу (или ведущему). Не дублируется, пока прежняя не разобрана. */
async function askPilot(doc, combat) {
  const a = doc.actor;
  if (out(a) || rearmOf(a, combat)) return;
  const pending = game.messages.contents.slice(-40).some(m => { const r = m.getFlag(SYSTEM_ID, "retline"); return r?.kind === "pilot" && !r.done && r.uuid === a.uuid; });
  if (pending) return;
  return ChatMessage.create({ speaker: { alias: "AWACS" }, flags: { [SYSTEM_ID]: { retline: { kind: "pilot", uuid: a.uuid, token: doc.uuid, combat: combat.id } } },
    content: pilotCard(doc.name, combat.round) });
}

const pilotCard = (name, round, done = "") => `<div class="tb-card tb-card-round"><header class="tb-card-head"><span class="tb-card-who">AWACS</span><span class="tb-card-what">${esc(name)} за линией возврата</span></header>
  ${done ? `<div class="tb-note">${done}</div>` : `<div class="tb-note">Раунд ${round}. Выйти из боя или перевооружиться: тогда пилот пропускает следующий раунд и в начале раунда ${round + 2} возвращается с полным HP и боезапасом, исправными системами и снятой Structure. Strain и Grit не восстанавливаются.</div>
  <div class="tb-actions"><button type="button" data-tb-ret="leave"><i class="fas fa-plane-departure"></i> Выйти из боя</button><button type="button" data-tb-ret="rearm"><i class="fas fa-screwdriver-wrench"></i> Перевооружиться</button><button type="button" data-tb-ret="stay" title="Пилот залетел за линию, но остаётся в бою">Остаться</button></div>`}</div>`;

/** Выбор пилота: делает ведущий (игроку не скрыть свой токен). */
async function pilotChoice(msgId, op) {
  const msg = game.messages.get(msgId), r = msg?.getFlag(SYSTEM_ID, "retline");
  if (!r || r.done || r.kind !== "pilot") return;
  const a = resolveActor(r.uuid), doc = fromUuidSync(r.token), combat = game.combats.get(r.combat);
  if (!a || !doc) return;
  let note = "";
  if (op === "leave") {
    await a.setFlag(SYSTEM_ID, "escaped", { combat: r.combat, round: combat?.round ?? 0, mode: "leave" });
    await a.toggleStatusEffect("retreat", { active: true });
    note = `${esc(doc.name)} выходит из боя: в конце раунда уходит с поля.`;
    await sendRadio({ text: `${doc.name} выходит из боя за линией возврата.` });
  } else if (op === "rearm") {
    const back = (combat?.round ?? 0) + 2;
    await a.setFlag(SYSTEM_ID, "rearm", { combat: r.combat, back });
    await doc.update({ hidden: true }, { tbFree: true });
    note = `${esc(doc.name)} уходит на перевооружение. Вернётся в начале раунда ${back}.`;
    await sendRadio({ text: `${doc.name}, принято, уходите на перевооружение. Ждём вас обратно.` });
  } else note = `${esc(doc.name)} остаётся в бою.`;
  await msg.update({ content: pilotCard(doc.name, 0, note), [`flags.${SYSTEM_ID}.retline.done`]: op });
}

/** Начало раунда (ведущий, до заявок): пилоты с перевооружения возвращаются. */
export async function returnRound(combat) {
  for (const c of combat.combatants) {
    const a = c.actor, f = rearmOf(a, combat);
    if (!f || f.back > combat.round) continue;
    await a.refitReturn();
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

/** Режим линии сцены. */
export async function setLineMode(scene, mode) {
  const l = lineOf(scene);
  if (!l || !RET_MODES[mode]) return;
  await scene.setFlag(SYSTEM_ID, "returnLine", { ...l, mode });
  const { redrawReturnLine } = await import("./apps/mission-import.mjs");
  await redrawReturnLine(scene);
}

/** Строка для итогов боя и подсказки итога миссии. */
export const retLossNote = r => (r.ret === "later" ? "ушёл за линию, вернётся" : r.ret ? "ушёл за линию возврата" : "");

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
        return m.openMissionDialog({ op: game.scenes.viewed?.getFlag(SYSTEM_ID, "mission") || game.scenes.viewed?.name || "", suggest: { result: "failed", reason: "Противник прорвал рубеж" } });
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
