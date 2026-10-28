/* Совет ведущему на ход NPC: кого бить и чем. Цель выбирается по дальности, по тому, кого она держит на захвате,
   по тому, попадёт ли ракета без броска, и по запретам триггеров («Без опознавательных знаков», «Арьергард»).
   Немезида выбирает своих пилотов. Совет виден строкой СОВЕТ в HUD у ведущего; шаги нажимаются кнопками.
   В начале раунда тот же совет подставляет число действий в заявку NPC. */
import { SYSTEM_ID, TB, sysOff } from "./config.mjs";
import { esc, resolveActor } from "./utils.mjs";
import { tokenOf, zoneDistance, canFireAt, isFlying, altOf, ALT_ORDER, reachProblems, isAirTarget, flyingBoss, hasRule, ceilingOf } from "./scene.mjs";
import { describeTarget, foxEstimate, strikeMeans, weaponReady } from "./dice/rolls.mjs";
import { triggerAttack } from "./combat-triggers.mjs";
import { isNemesis, pilotsOf } from "./nemesis.mjs";
import { presetPick, selectTarget } from "./pick.mjs";
import { combatantOf, declaredOf, spentOf, allowAction, spendAction } from "./actions.mjs";
import { lineHint } from "./return-line.mjs";
import { instinctProblem } from "./ace-kit.mjs";

const DEAD = () => CONFIG.specialStatusEffects?.DEFEATED ?? "dead";
const out = a => !a || a.statuses?.has?.(DEAD()) || a.statuses?.has?.("retreat") || a.statuses?.has?.("inactive") || !!a.system?.markers?.doom;
const same = (a, b) => !!a && !!b && (a === b || a.uuid === b.uuid);
const words = (n, one, few, many) => (n % 10 === 1 && n % 100 !== 11 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? few : many);
const zones = d => (d === 0 ? "своя зона" : `${d} ${words(d, "зона", "зоны", "зон")}`);

/** Кому нужен совет: NPC, который сам ходит (не здание и не гражданский). */
export function advisable(actor) {
  if (actor?.type !== "npc" || out(actor)) return false;
  const s = actor.system;
  return s.grp !== "obj" && s.grp !== "civil" && !hasRule(actor, "civilian");
}

/** Ракеты, летящие в этот NPC в текущем бою. */
function incoming(actor) {
  const c = game.combat;
  if (!c?.started) return 0;
  return (game.messages?.contents ?? []).slice(-300).filter(m => {
    const card = m.getFlag?.(SYSTEM_ID, "card");
    return card?.delayed && card.targetUuid === actor.uuid && card.combatKey?.startsWith(`${c.id}:`) && !card.resolved && !card.dmgApplied;
  }).length;
}

/** Чем NPC бьёт: ракеты (по виду цели), пушка в своей зоне. Корабли и боссы — системами, их ведущий выбирает сам. */
function means(actor) {
  const s = actor.system;
  const systems = (s.systems?.length ?? 0) > 0 || s.grp === "boss" || !!flyingBoss(actor);
  return {
    systems,
    missile: k => !systems && strikeMeans(actor, k).length > 0,
    guns: !systems && !sysOff(s, "gu") && (s.kind === "air" || (s.kind === "ground" && !!s.ground?.gun)),
    longRange: k => actor.items.some(i => i.type === "weapon" && i.system.reach >= TB.range.operation && weaponReady(i) && (i.system.target === k || i.system.target === "line"))
  };
}

/** Все, по кому этот NPC может стрелять на сцене, с прикидкой. */
export function candidates(actor, token = tokenOf(actor)) {
  if (!token) return [];
  const m = means(actor), nem = isNemesis(actor) ? pilotsOf(actor) : [];
  const list = [];
  for (const t of canvas?.tokens?.placeables ?? []) {
    const a = t.actor;
    if (!a || t === token || t.document?.hidden || !["pilot", "npc"].includes(a.type) || out(a) || !canFireAt(actor, a)) continue;
    // здания и гражданских бьют, только если это приоритетная цель
    if (a.type === "npc" && (a.system.grp === "obj" || a.system.grp === "civil" || hasRule(a, "civilian")) && !a.system.priority) continue;
    const info = describeTarget(a, t.name, t);
    const kind = isAirTarget(info) ? "air" : "ground";
    const dist = zoneDistance(token, t);
    const canMissile = m.missile(kind), canGuns = m.guns && dist === 0;
    if (!m.systems && !canMissile && !(m.guns && dist !== null)) continue;
    const ban = triggerAttack(actor, a, { rolled: false }).problems ?? [];
    const est = canMissile ? foxEstimate(actor, info) : null;
    const lockedOn = a.system.lockUuid ? resolveActor(a.system.lockUuid) : null;
    const why = [];
    let score = 0;
    if (dist !== null) score -= dist * 3;
    if (actor.system.lockUuid && actor.system.lockUuid === a.uuid) { score += 4; why.push("уже на захвате"); }
    if (same(lockedOn, actor)) { score += 5; why.push("держит его на захвате"); }
    else if (lockedOn && !canFireAt(actor, lockedOn)) { score += 3; why.push(`держит на захвате «${tokenOf(lockedOn)?.name ?? lockedOn.name}»`); }
    if (est?.hit) { score += 3; why.push("ракета попадёт без броска"); }
    else if (est?.chance !== null && est?.chance !== undefined) score += Math.round(est.chance * 3);
    const hp = a.system.hp;
    if (hp && hp.value <= 2 && hp.max > 2) { score += 2; why.push("почти сбит"); }
    if (a.system.priority) { score += 4; why.push("приоритетная цель"); }
    if (nem.some(p => same(p, a))) { score += 10; why.push("пилот Немезиды"); }
    else if (nem.length) score -= 4;
    if (ban.length) score -= 100;
    list.push({ token: t, actor: a, info, kind, dist, est, score, why, ban, canMissile, canGuns });
  }
  return list.sort((x, y) => y.score - x.score || (x.dist ?? 99) - (y.dist ?? 99));
}

/** Куда сменить высоту, чтобы достать цель: +1 / −1 или 0. */
function altStep(actor, token, c) {
  if (!isFlying(actor) || flyingBoss(actor)) return 0;
  const { problems } = reachProblems(actor, c.info, TB.range.lockOn);
  if (!problems.some(p => /Высок|Низк|стратосфер/.test(p))) return 0;
  const mine = ALT_ORDER.indexOf(altOf(token, actor)), want = c.kind === "air" ? ALT_ORDER.indexOf(altOf(c.token, c.actor)) : ALT_ORDER.indexOf("med");
  const ceil = ceilingOf(actor), top = ceil ? ALT_ORDER.indexOf(ceil) : ALT_ORDER.length - 1;
  const step = Math.sign(want - mine);
  return step > 0 && mine >= top ? 0 : step;
}

/**
 * Совет на ход: { target, steps: [{ act, label, hint }], declare, notes, others } или null.
 * act: break, lock, missile, sam, guns, climb, dive, move, target.
 */
export function adviseNpc(actor, token = tokenOf(actor)) {
  if (!advisable(actor) || !token) return null;
  const s = actor.system, m = means(actor);
  const steps = [], notes = [];
  const ground = s.kind === "ground";
  const missiles = incoming(actor);
  // ас: Break! делает «Чутьём» вне хода, а проверку хода отдаёт атаке с броском
  const keen = missiles && isFlying(actor) && !m.systems && !instinctProblem(actor);
  if (keen) {
    steps.push({ act: "instinct", label: TB.aceInstinct.name, hint: `По нему ${missiles > 1 ? `летят ${missiles} ракеты` : "летит ракета"}: Break! вне хода, действие не тратится` });
    notes.push("Чутьё аса закрывает ракеты: проверку хода отдать атаке с броском (Improved Fox Two! или Guns).");
  } else if (missiles && isFlying(actor) && !m.systems)
    steps.push({ act: "break", label: "Break!", hint: `По нему ${missiles > 1 ? `летят ${missiles} ракеты` : "летит ракета"}: Dodge против неё` });
  const list = candidates(actor, token);
  const c = list.find(x => !x.ban.length) ?? null;
  const banned = list.filter(x => x.ban.length).map(x => `${x.token.name}: ${x.ban[0]}`);
  if (!c) {
    if (banned.length) notes.push(...banned);
    return { target: null, steps, declare: Math.max(1, steps.length), notes: notes.length ? notes : ["Достать некого: целей нет или все вне досягаемости."], others: [] };
  }
  const name = c.token.name;
  if (m.systems) steps.push({ act: "target", label: `Цель: ${name}`, hint: "Отметить цель и показать на карте; системы выбираете на панели" });
  else {
    const dir = altStep(actor, token, c);
    if (dir) steps.push({ act: dir > 0 ? "climb" : "dive", label: dir > 0 ? "Climb" : "Dive", hint: `${dir > 0 ? "Набрать высоту" : "Снизиться"}, чтобы достать «${name}»` });
    const lockRange = m.longRange(c.kind) ? TB.range.operation : TB.range.lockOn;
    const locked = s.lockUuid === c.actor.uuid;
    const shoot = ground ? { act: "sam", label: "Пуск" } : { act: "missile", label: "Fox Two!" };
    const foxHint = c.est ? (c.est.hit ? `без броска: итог ${c.est.fox} против защиты ${c.est.dc}, попадает` : c.est.dc !== null ? `без броска ${c.est.fox} против ${c.est.dc} мало; с броском попадает ${Math.round(c.est.chance * 100)}%` : "по Occlusion системы") : "";
    // пушка в своей зоне бьёт без захвата
    if (c.canGuns && (!c.canMissile || (!locked && !(c.est?.hit))))
      steps.push({ act: "guns", label: "Guns", hint: `Цель в своей зоне: огонь без захвата${c.info.defense !== null ? `, защита ${c.info.defense}` : ""}` });
    else if (c.canMissile && c.dist !== null) {
      if (locked && c.dist <= TB.range.lockHold) steps.push({ ...shoot, hint: foxHint });
      else if (c.dist <= lockRange) steps.push({ act: "lock", label: "Lock On!", hint: `Захват «${name}», ${zones(c.dist)}` }, { ...shoot, hint: foxHint });
      else {
        steps.push({ act: "move", label: "Сблизиться", hint: `До «${name}» ${zones(c.dist)}: подвести токен ближе, захват берётся в своей и соседней зоне` });
        if (c.dist - 1 <= lockRange) steps.push({ act: "lock", label: "Lock On!", hint: `Захват «${name}» после сближения` });
      }
    } else if (m.guns && c.dist !== null) steps.push({ act: "move", label: "Сблизиться", hint: `Ракет по этой цели нет: в зону «${name}» для пушки (${zones(c.dist)})` });
    // без броска не попадает, а Speed лишняя: сбросить её, если не сваливаться
    if (c.est && !c.est.hit && c.est.dc !== null && isFlying(actor)) {
      const need = (s.speed ?? 0) - (c.est.dc - c.est.fox);
      if (need >= 1 && need < (s.speed ?? 0)) notes.push(`Сбросив Speed до ${need}, ракета попадёт без броска, но своя защита упадёт.`);
    }
  }
  if (banned.length) notes.push(...banned.slice(0, 2));
  // линия возврата: цель может уйти за неё, враг — прорвать рубеж
  const line = lineHint(actor, token.document);
  if (line) notes.push(`${line.charAt(0).toUpperCase()}${line.slice(1)}.`);
  const others = list.filter(x => x !== c && !x.ban.length).slice(0, 3).map(x => `${x.token.name} (${x.dist === null ? "?" : zones(x.dist)})`);
  const declare = Math.max(1, Math.min(3, steps.filter(x => x.act !== "instinct").length));
  return {
    target: { name, uuid: c.actor.uuid, tokenId: c.token.id, dist: c.dist, defense: c.info.defense, why: c.why, est: c.est },
    steps, declare, notes, others
  };
}

/** Строка СОВЕТ в HUD ведущего (только на ход этого NPC или до заявки). */
export function adviceRow(actor) {
  if (!game.user?.isGM || !game.combat?.started) return "";
  const tok = tokenOf(actor), c = combatantOf(actor, tok);
  if (!c) return "";
  const a = adviseNpc(actor, tok);
  if (!a) return "";
  const turn = c.parent?.combatant?.id === c.id, used = spentOf(c)?.used ?? 0, n = declaredOf(c);
  const t = a.target;
  const head = t
    ? `<a class="tb-hud-advtgt" data-hud-adv-target title="${esc([t.why.join(", "), a.others.length ? `Ещё: ${a.others.join(", ")}` : ""].filter(Boolean).join(". ") || "Показать цель на карте")}"><i class="fas fa-crosshairs"></i> ${esc(t.name)} · ${t.dist === null ? "?" : zones(t.dist)}${t.defense !== null && t.defense !== undefined ? ` · DEF ${t.defense}` : ""}</a>`
    : `<span class="tb-hud-none">${esc(a.notes[0] ?? "целей нет")}</span>`;
  const btns = a.steps.map((s, i) => `<button type="button" class="tb-hud-adv ${turn && i < Math.max(0, (n ?? 3) - used) ? "" : "dim"}" data-hud-adv="${i}" title="${esc(s.hint)}"><b>${i + 1}</b> ${esc(s.label)}</button>`).join("");
  const plan = n === null ? `<span class="tb-hud-advchip" title="Совет для заявки действий">заявка ${a.declare}</span>` : "";
  const notes = (t ? a.notes : a.notes.slice(1)).map(x => `<span class="tb-hud-advnote">${esc(x)}</span>`).join("");
  return `<div class="tb-hud-btns tb-hud-advrow"><small title="Совет ведущему на ход этого NPC">СОВЕТ</small>${head}${plan}${btns}${notes}</div>`;
}

/** Нажатый шаг совета. */
export async function runAdvice(actor, i) {
  const tok = tokenOf(actor), a = adviseNpc(actor, tok);
  const step = a?.steps?.[Number(i)];
  if (!step) return;
  const target = a.target ? canvas.tokens.get(a.target.tokenId) : null;
  if (target && step.act !== "break" && step.act !== "instinct") selectTarget(target);
  const { runAction } = await import("./macros.mjs");
  switch (step.act) {
    case "instinct": { const { aceInstinct } = await import("./ace-play.mjs"); return aceInstinct(actor); }
    case "break": case "missile": case "guns": return runAction(actor, step.act);
    case "lock": presetPick(target); return runAction(actor, "lock");
    case "sam": {
      if (!allowAction(actor, "sam")) return;
      const r = await actor.fireSam();
      if (r?.documentName === "ChatMessage") await spendAction(actor, "sam");
      return r;
    }
    case "climb": case "dive": {
      const { stepAltitude } = await import("./altitude.mjs");
      return stepAltitude(tok, step.act === "climb" ? 1 : -1);
    }
    default: return showTarget(actor);
  }
}

/** Показать цель совета на карте. */
export function showTarget(actor) {
  const a = adviseNpc(actor), t = a?.target ? canvas.tokens.get(a.target.tokenId) : null;
  if (!t) return;
  selectTarget(t);
  canvas.animatePan?.({ x: t.center.x, y: t.center.y });
  canvas.ping?.(t.center);
}

/** Начался ход NPC: ведущему выделяется его токен, и HUD показывает совет (настройка клиента). */
export function registerNpcAdvice() {
  game.settings.register(SYSTEM_ID, "npcAdvice", {
    name: "Совет на ход NPC", hint: "Для ведущего: в начале хода NPC его токен выделяется, а в HUD строка СОВЕТ — кого бить и чем. Число действий в заявке NPC тоже подставляется по совету.",
    scope: "client", config: true, type: Boolean, default: true
  });
  Hooks.on("updateCombat", (combat, change) => {
    if (!game.user.isGM || !("turn" in change || "round" in change) || !combat.started || !on()) return;
    const c = combat.combatant, tok = c?.token?.object ?? (c?.tokenId ? canvas.tokens?.get(c.tokenId) : null);
    if (!tok || !advisable(c.actor) || c.actor.hasPlayerOwner) return;
    tok.control?.({ releaseOthers: true });
    canvas.animatePan?.({ x: tok.center.x, y: tok.center.y });
  });
}

const on = () => { try { return game.settings.get(SYSTEM_ID, "npcAdvice") !== false; } catch { return true; } };

/** Сколько действий заявить этому NPC по совету (для формы заявки), или null. */
export function adviseDeclare(actor) {
  if (!on()) return null;
  try { return adviseNpc(actor)?.declare ?? null; } catch { return null; }
}
