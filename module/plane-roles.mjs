/* Роли машин и фирменные приёмы (Стрэйнджриал 8.5–8.6), лампы свойств машины в HUD (8.4).
   Черты ролей и свойства встроены туда, где они срабатывают: броски и залп (dice/rolls.mjs), Move (actions.mjs),
   захват и защита (scene.mjs), урон (documents/actor.mjs). Здесь кнопки «ПРИЁМ» и Angle of Attack Limiter,
   «Кобра» через ведущего (чужие захваты), строка «МАШИНА» в HUD и уборка отметок хода. */
import { SYSTEM_ID, TB, sysOff, roleOf, moveOf, moveReady, hasProp, sortieMark, sortieUsed } from "./config.mjs";
import { esc } from "./utils.mjs";
import { tokenOf, altOf, ecmCover, firedThisRound } from "./scene.mjs";
import { combatantOf, actionProblem, allowAction, spendAction, turnKey, twoZones } from "./actions.mjs";

const CHANNEL = `system.${SYSTEM_ID}`;
const isLead = () => !!game.user?.isGM && (game.users?.activeGM?.isSelf ?? true);
const markMove = actor => actor.setFlag(SYSTEM_ID, "sortie", { ...(actor.getFlag(SYSTEM_ID, "sortie") ?? {}), move: sortieMark(actor) });
const roundKey = () => { const c = game.combat; return c?.started ? `${c.id}:${c.round}` : ""; };
/** Боец этого актёра и его ли сейчас ход. */
const myTurn = actor => { const c = combatantOf(actor); return c && c.parent.combatant?.id === c.id ? c : null; };

/** Ракеты, что летят в машину в этом бою (пущены, ещё не долетели): то, о чём предупреждает MAWS. */
export function inbound(actor) {
  const c = game.combat;
  if (!c?.started) return 0;
  return game.messages.contents.slice(-300).filter(m => {
    const card = m.getFlag(SYSTEM_ID, "card");
    if (!card?.delayed || !card.combatKey?.startsWith(`${c.id}:`) || card.resolved || card.dmgApplied || card.ghost) return false;
    return card.targetUuid === actor.uuid || (card.salvo ?? []).some(x => x.uuid === actor.uuid);
  }).length;
}

/** Что делает кнопка приёма сейчас: { key, name, text, ready, why, passive }. why — почему нельзя ("" — можно). */
export function moveState(actor) {
  const key = moveOf(actor);
  if (!key) return null;
  const d = TB.planeMoves[key];
  const out = { key, name: d.name, text: d.text, ready: moveReady(actor), why: "", passive: false };
  if (!out.ready) { out.why = "в этом вылете уже был"; return out; }
  const turn = myTurn(actor);
  const inCombat = !!combatantOf(actor);
  switch (key) {
    case "cobra":
      if (sysOff(actor.system, "ma")) out.why = "MAWS не работает: о пуске не узнать";
      else if (!inbound(actor)) out.why = "когда по вам пущена ракета";
      break;
    case "supermano": case "dash":
      if (!turn) out.why = "только в свой ход";
      else if (key === "dash") out.why = actionProblem(actor, "move") ?? "";
      break;
    case "hmd": out.why = inCombat && !turn ? "только в свой ход" : actionProblem(actor, "missile") ?? ""; break;
    case "phoenix": out.why = actionProblem(actor, "lock") ?? ""; break;
    case "g12": out.why = actionProblem(actor, "break") ?? ""; break;
    case "tank": out.passive = true; out.why = "срабатывает сам: кнопка в окне метки урона"; break;
    case "ace104": out.passive = true; out.why = "срабатывает сам: кнопка на промахе ракеты на 1–2"; break;
    case "ghost": case "salvo": out.why = actionProblem(actor, "missile") ?? ""; break;
  }
  return out;
}

/** Нажали «ПРИЁМ» на HUD или листе. */
export async function useMove(actor) {
  const st = moveState(actor);
  if (!st) return ui.notifications.warn(`У «${actor.name}» нет фирменного приёма.`);
  if (st.why) return ui.notifications.warn(`«${st.name}»: ${st.why}.`);
  const say = text => ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }),
    content: `<div class="tb-card tb-card-move"><header class="tb-card-head"><span class="tb-card-who">${esc(actor.token?.name ?? actor.name)}</span><span class="tb-card-what">${esc(st.name)}</span></header><div class="tb-note">${text}</div></div>` });
  const { runAction } = await import("./macros.mjs");
  switch (st.key) {
    case "cobra": {
      await markMove(actor);
      await actor.update({ "system.speed": 1, [`flags.${SYSTEM_ID}.cobra`]: roundKey() }, { tbFree: true });
      await toGm("cobra", { uuid: actor.uuid });
      return say("Кобра Пугачёва: все ракеты в машину в этом раунде промахнутся, все захваты на неё сорваны. Speed 1, сваливания нет.");
    }
    case "supermano": {
      await markMove(actor);
      await actor.setFlag(SYSTEM_ID, "supermano", turnKey(myTurn(actor)));
      return say("Сверхманёвренность: в этот ход можно сделать вторую проверку с броском.");
    }
    case "dash": {
      await markMove(actor);
      await actor.setFlag(SYSTEM_ID, "dash", turnKey(myTurn(actor)));
      return say("Бросок на рубеж: перетащите токен до 3 зон одним Move. Speed станет равной Max Speed, потом бесплатный Lock On! по цели в зоне прибытия или соседней.");
    }
    case "hmd": return hmdStrike(actor);
    case "phoenix": return runAction(actor, "lock", { opts: { phoenix: true } });
    case "g12": return runAction(actor, "break", { opts: { g12: true } });
    case "ghost": case "salvo": return runAction(actor, "missile", { opts: { preMove: st.key } });
    default: return ui.notifications.info(`«${st.name}»: ${st.why}.`);
  }
}

/** «Нашлемный прицел» (МиГ-35): Lock On! и Fox Two! по цели в своей зоне одним действием. */
async function hmdStrike(actor) {
  if (!allowAction(actor, "missile")) return;
  const lock = await actor.lockOn({ maxDist: 0, free: true, label: TB.planeMoves.hmd.name });
  if (!lock) return;
  const res = await actor.fireMissile();
  if (res?.documentName !== "ChatMessage") return;
  await markMove(actor);
  const card = res.getFlag(SYSTEM_ID, "card");
  await spendAction(actor, "missile", { rolled: !!card?.rolled && !card?.practiced });
  return res;
}

/** Angle of Attack Limiter: в свой ход −2 Strain, до конца хода +1 к Evasion, Air-to-Air, Aim, Dodge, Push. */
export async function useAoa(actor) {
  if (!hasProp(actor, "aoa")) return;
  const c = myTurn(actor);
  if (!c) return ui.notifications.warn("Angle of Attack Limiter: только в свой ход в бою.");
  if (actor.system.aoa) return ui.notifications.info("Angle of Attack Limiter уже включён до конца хода.");
  const st = actor.system.strain;
  if (actor.type === "pilot" && (st?.value ?? 0) < 2) return ui.notifications.warn("Angle of Attack Limiter: нужно 2 Strain.");
  const upd = { [`flags.${SYSTEM_ID}.aoa`]: { combat: c.parent.id, round: c.parent.round, turn: c.id } };
  if (st?.max) upd["system.strain.value"] = Math.max(0, st.value - 2);
  await actor.update(upd);
  return ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }),
    content: `<div class="tb-card tb-card-move"><div class="tb-note"><b>${esc(actor.token?.name ?? actor.name)}</b>: Angle of Attack Limiter, −2 Strain. До конца хода +1 к Evasion, Air-to-Air, Aim, Dodge и Push.</div></div>` });
}

/** Сделать на клиенте ведущего: чужие захваты игрок сам не снимает. */
function toGm(op, data) {
  if (game.user.isGM) return run(op, data);
  if (!game.users.activeGM) return ui.notifications.warn("Ведущего нет в сети: захваты на вас снимите вручную.");
  game.socket.emit(CHANNEL, { type: "planeMove", op, data });
}

async function run(op, d) {
  if (op !== "cobra") return;
  const names = [];
  for (const tok of canvas?.tokens?.placeables ?? []) {
    const a = tok.actor;
    if (!a || a.uuid === d.uuid) continue;
    const salvo = a.getFlag(SYSTEM_ID, "salvo");
    const inSalvo = salvo?.list?.some(x => x.uuid === d.uuid);
    if (a.system.lockUuid !== d.uuid && !inSalvo) continue;
    const upd = {};
    if (a.system.lockUuid === d.uuid) Object.assign(upd, { "system.lock": "", "system.lockUuid": "", [`flags.${SYSTEM_ID}.salvo`]: null, [`flags.${SYSTEM_ID}.phoenix`]: null });
    else upd[`flags.${SYSTEM_ID}.salvo`] = { ...salvo, list: salvo.list.filter(x => x.uuid !== d.uuid) };
    await a.update(upd);
    names.push(tok.name);
  }
  if (names.length) await ChatMessage.create({ speaker: { alias: "AWACS" },
    content: `<div class="tb-card tb-card-lock"><div class="tb-note">Кобра: захват сорван у ${names.map(n => `<b>${esc(n)}</b>`).join(", ")}.</div></div>` });
}

/** Строка «МАШИНА» в HUD: роль и черта, лампы свойств, Angle of Attack Limiter и кнопка приёма. */
export function hudPlane(actor) {
  const r = roleOf(actor), role = r ? { key: r, ...TB.planeRoles[r] } : null;
  const s = actor.system, tok = tokenOf(actor), alt = tok ? altOf(tok, actor) : s.alt;
  const lamps = [];
  const lamp = (text, on, title) => lamps.push({ text, on: !!on, title });
  if (hasProp(actor, "swing")) lamp("КРЫЛО +1", s.speed >= s.maxSpeed, "Крыло изменяемой стреловидности: на Max Speed Evasion +1");
  if (hasProp(actor, "terrain")) lamp("РЕЛЬЕФ +1", alt === "low", "Огибание рельефа: на Низкой Evasion +1");
  const fast = (hasProp(actor, "highspeed") || hasProp(actor, "supercruise")) ? twoZones(actor) : null;
  if (hasProp(actor, "highspeed") || hasProp(actor, "supercruise"))
    lamp("2 ЗОНЫ", fast, fast ? `${fast.label}: Move на 2 зоны${fast.speed !== null ? `, Speed станет ${fast.speed} заодно` : ""}` : "High Speed: Max Speed не хватает до 5 (сверхзвук — до 4)");
  if (hasProp(actor, "stealth")) { const quiet = !firedThisRound(actor); lamp("СТЕЛС", quiet, quiet ? "Малозаметность: пока не стреляли в этом раунде, захват только из той же зоны" : "Стреляли в этом раунде: захватить можно и из соседней зоны"); }
  const ecm = ecmCover(actor, tok);
  if (ecm) lamp("РЭБ +1", true, `Станция РЭБ (${ecm}): Defense +1, захват только из той же зоны`);
  if (hasProp(actor, "armor")) { const left = !sortieUsed(actor, "armor"); lamp("БРОНЯ", left, left ? "Бронированная кабина: первое попадание пушкой за вылет −2 HP" : "Бронированная кабина уже приняла попадание в этом вылете"); }
  if (hasProp(actor, "sead")) lamp("ПВО +2", true, "Подавление ПВО: +2 к атакам A-G по ЗРК, зениткам, РЛС и станциям помех");
  if (hasProp(actor, "antiship")) lamp("ПКР", !sysOff(s, "ms"), "Противокорабельная ракета: станция ASM на пульте Fox Two!, по кораблю в любой точке зоны операции");
  const aoa = hasProp(actor, "aoa") ? { on: !!s.aoa, can: !!myTurn(actor) && !s.aoa && (actor.type !== "pilot" || (s.strain?.value ?? 0) >= 2) } : null;
  const move = moveState(actor);
  if (!role?.trait && !lamps.length && !aoa && !move) return null;
  return { role, lamps, aoa, move };
}

/** Разметка строки «МАШИНА» для HUD. */
export function planeRowHtml(p) {
  if (!p) return "";
  const role = p.role?.trait ? `<span class="tb-hud-role" title="${esc(p.role.name)}. ${esc(p.role.trait)}: ${esc(p.role.text)}">${esc(p.role.tag)} · ${esc(p.role.trait)}</span>` : "";
  const lamps = p.lamps.map(l => `<span class="tb-hud-plamp ${l.on ? "on" : ""}" title="${esc(l.title)}">${esc(l.text)}</span>`).join("");
  const aoa = p.aoa ? `<button type="button" class="tb-hud-aoa ${p.aoa.on ? "on" : ""}" data-hud-aoa ${p.aoa.can || p.aoa.on ? "" : "disabled"} title="Angle of Attack Limiter: в свой ход −2 Strain, до конца хода +1 к Evasion, A-A, Aim, Dodge, Push">AOA${p.aoa.on ? " +1" : ""}</button>` : "";
  const m = p.move;
  const move = m ? `<button type="button" class="tb-hud-move ${m.ready ? "" : "used"} ${m.why ? "wait" : "ready"}" data-hud-move title="${esc(m.name)} (раз за вылет): ${esc(m.text)}${m.why ? `\nСейчас: ${esc(m.why)}` : ""}">ПРИЁМ · ${esc(m.name)}</button>` : "";
  return `<div class="tb-hud-btns tb-hud-plane"><small title="Роль, свойства и фирменный приём машины">МАШИНА</small>${role}${lamps}${aoa}${move}</div>`;
}

/** Для листа: роль и приём машины. */
export function sheetPlane(actor) {
  const r = roleOf(actor), m = moveState(actor);
  return { role: r ? TB.planeRoles[r] : null, move: m, aoa: hasProp(actor, "aoa") };
}

export function registerPlaneRoles() {
  Hooks.once("ready", () => {
    game.socket.on(CHANNEL, msg => { if (msg?.type === "planeMove" && isLead()) run(msg.op, msg.data ?? {}).catch(err => console.error(`${SYSTEM_ID} | приём`, err)); });
  });
  // смена хода: Angle of Attack Limiter кончается (лист и HUD пересчитываются, пока флаг снят)
  Hooks.on("updateCombat", (combat, change, options) => {
    if (options?.tbUndo || !isLead() || !("turn" in change || "round" in change)) return;
    for (const c of combat.combatants) {
      const a = c.actor, f = a?.getFlag?.(SYSTEM_ID, "aoa");
      if (f && !(f.combat === combat.id && f.round === combat.round && combat.combatant?.id === f.turn)) a.unsetFlag(SYSTEM_ID, "aoa").catch(() => null);
    }
  });
  // «Взлёт по тревоге»: асы-NPC на перехватчиках начинают бой на Max Speed (пилотам Speed ставит «К вылету»)
  Hooks.on("combatStart", combat => {
    if (!isLead()) return;
    for (const c of combat.combatants) {
      const a = c.actor;
      if (a?.type === "npc" && roleOf(a) === "icpt" && a.system.speed < a.system.maxSpeed) a.update({ "system.speed": a.system.maxSpeed }, { tbFree: true }).catch(() => null);
    }
  });
}
