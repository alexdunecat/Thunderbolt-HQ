/* Броски и чат-карточки: проверки, ракеты, пушка, Break!, Strain, урон, сваливание. */
import { SYSTEM_ID, TB, sysOff, offWhy, roleOf, moveReady, sortieMark, hasProp } from "../config.mjs";
import { esc, resolveActor } from "../utils.mjs";
import { sameZoneLock, tokenOf, altOf, weatherAt, weatherParts, defenseWithWeather, reachProblems, confirmReach, canFireAt, stratLift, isAirTarget, inNarrowTunnel, wallBonus, zoneDistance, rangeLabel, isFlying, struckBy, gunVs, sysGunReach, sysStrafe, gunSys, hasRule, escortCover, radarCue, awacsCue, revealAmbush, boosterOn } from "../scene.mjs";
import { alarmRows, raiseAlarm, surprise, quietAA, markVolley } from "../stealth.mjs";
import { takeNext, takeNextD4, passOutcome } from "../squad.mjs";
import { nemesisAttack, nemesisDefense } from "../nemesis.mjs";
import { triggerAttack, triggerDefense, triggerBreak, trashComp, coverPart, millionFor, letGo, trig, weakOf, followFor, offerFollow, followOffer, takeFollow, aceRadio } from "../combat-triggers.mjs";
import { pickTargetToken, selectTarget } from "../pick.mjs";
import { targetMarks } from "../target-marks.mjs";
import { aceReady, aceUsedPatch } from "../ace-kit.mjs";
import { allowRoll } from "../actions.mjs";
import { aimedWeapon } from "../range.mjs";
import { renderGround, renderBreakdown, resolveButton, groundAction, checkBreakdown, practiceFor } from "../downtime.mjs";
import { strikeShip } from "../strikes.mjs";
import { schematicHtml, bindSchematic, aimAt, cockpitDialog, defaultSys } from "../aim.mjs";
import { poolSquad, poolOf, spendPool, sunOn } from "../duelists.mjs";

const sign = n => (n >= 0 ? "+" : "−") + Math.abs(n);
/** Strain могут тратить пилоты и асы-NPC. */
// дуэлянт именной эскадрильи тратит из её запаса (Стрэйнджриал 9.1)
const canStrain = actor => actor.type === "pilot" || (actor.type === "npc" && actor.system.tier === "ace") || !!poolSquad(actor);

/* ---------- вспомогательное ---------- */

export { resolveActor };

/** Первая цель игрока на сцене: { actor, token, name, uuid, defense, kind } или null. */
export function currentTarget() {
  const t = game.user.targets.first();
  // персонаж на земле не цель: у него нет ни защиты, ни HP машины
  if (!["pilot", "npc"].includes(t?.actor?.type)) return null;
  return describeTarget(t.actor, t.name, t);
}

/** Цель с защитой на текущий момент (Break!, Speed и погода в её клетке). У кораблей защиты нет: Occlusion систем. */
export function describeTarget(actor, name, token = tokenOf(actor)) {
  const s = actor.system;
  const kind = actor.type === "pilot" ? "air" : s.kind;
  const weather = weatherAt(actor, token);
  const defense = kind === "ship" ? null : defenseWithWeather(actor, weather);
  return { actor, token, name: name ?? actor.name, uuid: actor.uuid, kind, defense, weather };
}

/** Ключ раунда текущего боя: по нему ракеты собираются в залп конца раунда. */
function combatKey() {
  const c = game.combat;
  return c?.started ? `${c.id}:${c.round}` : "";
}

/** Погода у стреляющего: строки для карточки. */
function weatherNotes(w) {
  return w.list.map(d => `${d.ico} ${esc(d.name)}: ${esc(d.txt)}`);
}

/** Простой диалог-форма. Возвращает объект значений полей или null при отмене. */
export function formDialog(title, content, { ok = "Бросить", width = 380, render, cockpit = false } = {}) {
  return new Promise(resolve => {
    new Dialog({
      title,
      content: `<form class="tb-dialog">${content}</form>`,
      buttons: {
        ok: {
          icon: '<i class="fas fa-dice-d20"></i>', label: ok,
          callback: html => {
            const form = html[0].querySelector("form");
            const data = {};
            for (const el of form.elements) {
              if (!el.name) continue;
              if (el.type === "checkbox") data[el.name] = el.checked;
              else if (el.type === "radio") { if (el.checked) data[el.name] = el.value; }
              else if (el.type === "number") data[el.name] = Number(el.value) || 0;
              else data[el.name] = el.value;
            }
            resolve(data);
          }
        },
        cancel: { icon: '<i class="fas fa-times"></i>', label: "Отмена", callback: () => resolve(null) }
      },
      default: "ok",
      render: html => render?.(html[0] ?? html),
      close: () => resolve(null)
    }, { width, classes: ["dialog", "thunderbolt", ...(cockpit ? ["tb-cockpit"] : [])] }).render(true);
  });
}

/** Слагаемые навыка для карточки: ранги и поправки триггеров отдельными строками. */
function skillParts(actor, skill, label = TB.skills[skill].label) {
  const s = actor.system;
  if (!s.skillParts) return [[label, s.skillTotal[skill]]];
  const cover = coverPart(actor, skill);
  return [[label, s.skills[skill]], ...(cover ? [cover] : []), ...s.skillParts[skill].map(m => [m.name, m.value])];
}

function hasTrigger(actor, key) { return actor.items.some(i => i.type === "trigger" && i.system.key === key); }

async function roll(formula, data = {}) { return new Roll(formula, data).evaluate(); }

/* ---------- расчёт и отрисовка карточки ---------- */

/** Пересчитать итог карточки по её состоянию. */
export function computeCard(c) {
  const out = { ...c };
  if (c.rolled) out.total = (c.d10 ?? 0) + c.parts.reduce((s, p) => s + p[1], 0) + (c.strain ?? 0);
  else out.total = c.parts.reduce((s, p) => s + p[1], 0);
  if (c.type === "break") {
    out.value = Math.ceil(out.total / 2);
    out.applies = out.value > c.ev;
  }
  if (c.dc !== null && c.dc !== undefined) out.success = out.total >= c.dc;   // ничьи: в проверках за пилотом, в атаках за атакующим
  if (c.forceHit && c.dc !== null && c.dc !== undefined) out.success = true;   // «Хватит болтать»: атака посреди монолога
  if (c.forceFail) out.success = false;
  // HPAA: промах на 1–2 — неконтактный взрыв, 4 урона
  if (c.wkey === "HPAA" && c.dc !== null && c.dc !== undefined && !out.success && out.total >= c.dc - 2) out.proxHit = true;
  if (c.rolled) {
    out.perk = c.d4 >= (c.perkOn ?? 4);
    out.comp = c.d4 <= (c.compOn ?? 1);
  }
  if (c.type === "recover" && out.success) out.regain = Math.max(c.minRegain ?? 1, out.total - 7);
  return out;
}

/** Карточка Тревоги в конце хода: что засветило пилота, кнопки ведущему и проверка Dodge игроку. */
function renderAlarm(c) {
  const btn = [];
  if (c.add && !c.applied) btn.push(`<button type="button" data-tb-action="alarm-up" data-n="${c.add}" class="tb-gm"><i class="fas fa-bell"></i> Тревога +${c.add}</button>`);
  if (c.dodge?.length && !c.dodged) btn.push(`<button type="button" data-tb-action="alarm-dodge" class="tb-owner"><i class="fas fa-dice-d10"></i> Dodge против 7</button>`);
  if (!c.patrol) btn.push(`<button type="button" data-tb-action="alarm-patrol" class="tb-gm" title="Патруль увидел пилота (та же зона, любая высота) и дожил до конца раунда"><i class="fas fa-eye"></i> Патруль: +2</button>`);
  const done = [c.applied ? `Тревога +${c.add} записана.` : "", c.patrol ? "Патруль увидел: Тревога +2." : "", c.dodged ? "Dodge брошен." : ""].filter(Boolean);
  return `<div class="tb-card tb-card-alarm">
    <header class="tb-card-head"><span class="tb-card-who">${esc(c.actorName)}</span><span class="tb-card-what">${esc(c.label)}</span></header>
    ${alarmRows(c).join("")}${done.length ? `<div class="tb-note">${done.join(" ")}</div>` : ""}
    ${btn.length ? `<div class="tb-actions">${btn.join("")}</div>` : ""}
  </div>`;
}

/**
 * Проверка вне хода: не считается броском хода (Тревога, пролёт в туннеле).
 * onFail: "alarm" — кнопка ведущему «Тревога +1»; failDmg — урон при провале (кнопка владельцу).
 */
export async function rollSideCheck(actor, skill, { dc = 7, label, notes = [], onFail = "", failDmg = 0, turnRoll = false, onWin = null, extra = {} } = {}) {
  // обязательная проверка не пропадает из-за Grit: навык недоступен — автоматический провал
  if (actor.system.skillBlocked?.[skill]) return postCard(actor, {
    type: "side", label: label ?? `${TB.skills[skill].label} против ${dc}`, rolled: false, parts: [[`${TB.skills[skill].label} недоступен (Grit)`, 0]], strain: 0, dc,
    forceFail: true, strainable: false, skill, onFail, failDmg, onWin, notes: ["Метка Grit: навык недоступен, проверка провалена.", ...notes.map(esc)], ...extra
  }, []);
  const dice = await rollDice(actor, false, { turnRoll });
  if (!dice) return null;
  const w = weatherAt(actor);
  const parts = [...skillParts(actor, skill), ...(skill === "push" ? weatherParts(w, "push") : []), ...await takeNext(actor)];
  const card = {
    type: "side", label: label ?? `${TB.skills[skill].label} против ${dc}`, rolled: true, d10: dice.d10, d4: dice.d4, parts, strain: 0, dc,
    strainable: canStrain(actor), skill, onFail, failDmg, onWin, notes: [...(turnRoll ? [] : ["Не считается броском хода."]), ...notes.map(esc)],
    ...thresholds(actor, skill, w.comp2), ...extra
  };
  return postCard(actor, card, dice.rolls);
}

/** Карточка туннеля в конце хода: куда вынесло и кнопка проверки пролёта. */
function renderTunnel(c) {
  const btn = c.check && !c.rolledPass ? `<div class="tb-actions"><button type="button" data-tb-action="tunnel-pass" class="tb-owner"><i class="fas fa-dice-d10"></i> Пролёт: Push против ${c.dc}</button></div>` : "";
  return `<div class="tb-card tb-card-tunnel">
    <header class="tb-card-head"><span class="tb-card-who">${esc(c.actorName)}</span><span class="tb-card-what">${esc(c.label)}</span></header>
    ${(c.notes ?? []).map(n => `<div class="tb-note">${n}</div>`).join("")}
    ${c.check ? `<div class="tb-note">Проверка пролёта: Push против 3 + Speed ${c.speed}${c.hard ? " + 2 (Узость или Препятствие)" : ""}${c.oncoming ? " + 2 (встречный курс)" : ""} = <b>${c.dc}</b>. Не считается броском хода. Провал: удар о стену, ${Math.max(1, c.speed)} урона.</div>` : ""}
    ${c.rolledPass ? `<div class="tb-note">Проверка пролёта брошена.</div>` : ""}${btn}
  </div>`;
}

const PROX_DMG = 4;
/** Урон попадания карточки: HPAA неконтактным взрывом — 4, UGB на Perk «×2» — вдвое. */
const hitDmg = c => (c.proxHit && !c.success ? PROX_DMG : c.dmg ?? 0) * (c.ugbPerk === "double" ? 2 : 1);

export function renderCard(card) {
  if (card.type === "tunnel") return renderTunnel(card);
  if (card.type === "alarm") return renderAlarm(card);
  if (card.type === "volley") return renderVolley(card);
  if (card.type === "ground") return renderGround(card);
  if (card.type === "breakdown") return renderBreakdown(card);
  if (card.type === "doomfate") return renderDoomFate(card);
  const c = computeCard(card);
  const rows = [];
  const parts = c.parts.map(([l, v]) => `<span class="tb-part">${esc(l)} ${sign(v)}</span>`).join(" ");
  if (c.rolled) {
    rows.push(`<div class="tb-dice"><span class="tb-die d10${c.practiced ? " max" : ""}">${c.d10}</span>${parts}${c.strain ? `<span class="tb-part strain">Strain +${c.strain}</span>` : ""}</div>`);
  } else rows.push(`<div class="tb-dice">${parts}<span class="tb-part muted">без броска</span></div>`);

  let verdict = "";
  if (c.type === "break") {
    verdict = `<div class="tb-total">${c.total} ÷ 2 = <b>${c.value}</b> · Evasion ${c.ev} → ${c.applies
      ? `<b class="ok">Evasion ${c.value} до конца раунда</b>` : `<b class="fail">не выше Evasion, остаётся ${c.ev}</b>`}</div>`;
  } else if (c.type === "rail") {
    verdict = c.word ? `<div class="tb-total">Итог <b>${c.total}</b> (${esc(c.word)})</div>`
      : `<div class="tb-total">Итог <b>${c.total}</b> по воздуху (Aim)${c.line?.some(r => r.gnd) ? ` · <b>${c.total + (c.depShift ?? 0)}</b> по земле и морю (Deploy)` : ""}</div>`;
  } else if (c.dc !== null && c.dc !== undefined) {
    const vs = c.vsLabel ?? "сложности";
    verdict = `<div class="tb-total">Итог <b>${c.total}</b> против ${vs} ${c.dc} → <b class="${c.success ? "ok" : "fail"}">${c.success ? (c.attack ? "Попадание" : "Успех") : (c.attack ? (c.delayed && c.combatKey && !c.resolved ? "одна мимо" : "Промах") : "Провал")}</b>${c.proxHit ? ` · <b class="ok">неконтактный взрыв, ${PROX_DMG} урона</b>` : ""}</div>`;
  } else {
    verdict = `<div class="tb-total">Итог <b>${c.total}</b>${c.vsHint ? ` · ${esc(c.vsHint)}` : ""}</div>`;
  }
  rows.push(verdict);
  if (c.rolled && c.type === "eject") {
    // d4 судьбы: при провале решает, выжил ли пилот, поэтому крупно, как d10
    const f = ejectFate(c);
    rows.push(c.success ? `<div class="tb-d4">d4 = ${c.d4} (при успехе не нужен)</div>`
      : `<div class="tb-dice tb-fate"><span class="tb-die d4 fate-${f.key}">${c.d4}</span><span class="tb-part">d4 судьбы</span><b class="tb-fate-word fate-${f.key}">${FATE_WORD[f.key]}</b></div>`);
  }
  else if (c.rolled) {
    const d4 = c.perk && c.comp ? `<div class="tb-d4 perk">d4 = ${c.d4}: <b>Perk</b> и <b class="comp">Complication</b> сразу (по умолчанию +1 и −1)</div>`
      : c.perk && c.wkey === "UGB" && c.targetUuid ? `<div class="tb-d4 perk">d4 = ${c.d4}: <b>Perk</b> (UGB: двойной урон цели или обычный урон всем соседним)</div>`
      : c.perk ? `<div class="tb-d4 perk">d4 = ${c.d4}: <b>Perk</b> (по умолчанию +1 к следующей проверке)</div>`
      : c.comp ? `<div class="tb-d4 comp">d4 = ${c.d4}: <b>Complication</b> (по умолчанию −1)</div>`
        : `<div class="tb-d4">d4 = ${c.d4}</div>`;
    rows.push(d4);
  }
  for (const n of c.notes ?? []) rows.push(`<div class="tb-note">${n}</div>`);
  if (c.type === "rail") rows.push(...railRows(c));
  if (c.ugbPerk) rows.push(`<div class="tb-note">Perk UGB: ${c.ugbPerk === "double" ? "двойной урон основной цели" : "обычный урон всем целям, соседним с основной"}.</div>`);
  if (c.reattack && !c.resolved) rows.push(`<div class="tb-note">${c.aceAgain ? `«${esc(TB.aceTriggers.again.name)}»` : "SAAM"}: промах при удержанном захвате, повторный заход в конце раунда ${String(c.combatKey).split(":")[1]}.</div>`);
  if (c.lost) rows.push(`<div class="tb-note">${c.aceAgain ? "Повторный заход сорван" : "SAAM потеряна"}: ${esc(c.lost)}.</div>`);
  if (c.type === "recover" && c.success) rows.push(`<div class="tb-note">Вернуть <b>${c.regain}</b> Strain.</div>`);

  const btn = [];
  // UGB: на Perk вместо +1 к следующей — двойной урон цели или урон по соседним
  const ugbPerk = c.rolled && c.perk && c.wkey === "UGB" && c.targetUuid;
  if (ugbPerk && !c.ugbPerk && !c.resolved && !c.dmgApplied) btn.push(`<button type="button" data-tb-action="ugb-perk" data-perk="double" class="tb-owner">Perk: ×2 урона цели</button><button type="button" data-tb-action="ugb-perk" data-perk="splash" class="tb-owner">Perk: урон всем соседним</button>`);
  if (c.rolled && c.type !== "eject" && c.perk && !c.perkPassed && !ugbPerk) btn.push(`<button type="button" data-tb-action="perk-next" class="tb-owner">Perk: +1 к следующей</button>`);
  if (c.rolled && c.type !== "eject" && c.comp && !c.compPassed) btn.push(`<button type="button" data-tb-action="comp-next" class="tb-owner">Complication: −1 к следующей</button>`);
  if (c.perkPassed) rows.push(`<div class="tb-note">Perk: +1 к следующей проверке, ${esc(c.perkPassed)}.</div>`);
  if (c.compPassed) rows.push(`<div class="tb-note">Complication: −1 к следующей проверке, ${esc(c.compPassed)}.</div>`);
  // Решимость (d4 = 4) и Наработка (переброс d10 навыка раз за вылет) из даунтайма
  const who = resolveActor(c.actorUuid);
  const settled = c.type === "eject" && c.applied;
  if (!settled) btn.push(...resolveButton(c, who));
  if (c.resolveUsed) rows.push(`<div class="tb-note">Решимость: d4 считается за 4.</div>`);
  if (c.rolled && !settled && !c.practiced && !c.reroll && !c.resolved && !c.dmgApplied && practiceFor(who, c.skill, c.d10))
    btn.push(`<button type="button" data-tb-action="dt-practice" class="tb-owner" title="Задел «Наработка»: раз за вылет перебросить d10 и взять лучший"><i class="fas fa-rotate"></i> Наработка: перебросить d10</button>`);
  if (c.reroll) rows.push(`<div class="tb-note">Наработка: d10 переброшен (${c.reroll.join(" → ")}), взят лучший.</div>`);
  if (c.rolled && c.strainable && !c.resolved && !settled) {
    // дуэлянт тратит из запаса эскадрильи: на кнопке сколько осталось
    const pool = poolOf(who);
    btn.push(`<button type="button" data-tb-action="strain" class="tb-owner"${pool ? ` title="Запас эскадрильи «${esc(poolSquad(who))}»"` : ""}><i class="fas fa-bolt"></i> +1 Strain${pool ? ` · запас ${pool.value}/${pool.max}` : ""}</button>`);
  }
  if (c.type === "side" && c.success && c.onWin && !c.applied) btn.push(`<button type="button" data-tb-action="side-win" class="tb-owner"><i class="fas fa-door-open"></i> «${esc(c.onWin.name)}» выходит из боя</button>`);
  if (c.type === "side" && c.success && c.onWin && c.applied) rows.push(`<div class="tb-note">«${esc(c.onWin.name)}» выходит из боя.</div>`);
  if (c.type === "side" && !c.success && !c.applied) {
    if (c.onFail === "engines") btn.push(`<button type="button" data-tb-action="side-engines" class="tb-owner"><i class="fas fa-fire"></i> Structure: Engines</button>`);
    if (c.onFail === "alarm") btn.push(`<button type="button" data-tb-action="alarm-up" data-n="1" class="tb-gm"><i class="fas fa-bell"></i> Тревога +1</button>`);
    if (c.failDmg) btn.push(`<button type="button" data-tb-action="side-dmg" class="tb-owner"><i class="fas fa-burst"></i> ${c.failDmg} урона</button>`);
  }
  if (c.type === "side" && c.applied && !c.success) rows.push(`<div class="tb-note">${c.onFail === "alarm" ? "Тревога +1 записана." : c.onFail === "engines" ? "Отмечена Structure: Engines." : "Урон нанесён."}</div>`);
  if (c.type === "break" && !c.speedApplied) btn.push(`<button type="button" data-tb-action="break-speed" class="tb-owner">Speed −${c.speedDrop} после атак</button>`);
  if (c.type === "break" && !c.speedApplied && c.combatKey) rows.push(`<div class="tb-note">Speed −${c.speedDrop} спишется сам в конце раунда.</div>`);
  if (c.type === "break" && c.speedApplied && c.speedDrop) rows.push(`<div class="tb-note">Speed −${c.speedDrop} списан.</div>`);
  if (c.type === "recover" && c.success && !c.applied) btn.push(`<button type="button" data-tb-action="recover" class="tb-owner">Вернуть ${c.regain} Strain</button>`);
  if (c.type === "eject") {
    const f = ejectFate(c);
    rows.push(`<div class="tb-note tb-eject-${f.key}"><b>${f.title}.</b> ${f.text}</div>`);
    if (c.applied) rows.push(`<div class="tb-note">В личное дело записано: ${esc(TB.status[c.applied] ?? c.applied)}.</div>`);
    else btn.push(`<button type="button" data-tb-action="eject-apply" class="tb-owner"><i class="fas fa-file-signature"></i> Записать в личное дело</button>`);
  }
  if (c.type === "stall" && !c.applied) {
    if (c.success) btn.push(`<button type="button" data-tb-action="stall-ok" class="tb-owner">Выровняться: Speed 1</button>`);
    else btn.push(`<button type="button" data-tb-action="stall-fail" class="tb-owner">${c.alt === "low" ? "Удар о землю: Doom" : c.alt === "strat" ? "Спуститься на Высокую" : "Потерять высоту"}</button>`);
  }
  // Pushing Limits (книга, стр. 21): после удачного Push преследователи должны его перебить, иначе теряют хвост
  if (c.type === "check" && c.skill === "push" && c.success && !c.chased && pursuersOf(c.actorUuid).length)
    btn.push(`<button type="button" data-tb-action="chase" class="tb-owner" title="Каждый, кто держит вас на захвате, бросает Push: не перебил ваш итог — захват сорван"><i class="fas fa-wind"></i> Оторваться: Push преследователей</button>`);
  if (c.chaseRows) rows.push(...c.chaseRows.map(r => `<div class="tb-note">${r}</div>`));
  // «Один на миллион»: промах можно сделать попаданием
  if (c.attack && c.dc !== null && c.dc !== undefined && !c.success && millionFor(c)) btn.push(`<button type="button" data-tb-action="million" class="tb-owner" title="Раз за вылет: выбранный выстрел попадает"><i class="fas fa-crosshairs"></i> ${esc(millionFor(c).name)}: попадание</button>`);
  if (c.million) rows.push(`<div class="tb-note">«${esc(c.million)}»: выстрел попадает.</div>`);
  // «104:0» на карточке пуска, которая решается сразу (не в залпе): ракета по воздуху мимо на 1–2
  if (c.attack && c.tkind === "air" && c.dc !== null && c.dc !== undefined && !c.success && c.total >= c.dc - 2 && !c.combatKey && !c.ace && moveReady(who, "ace104"))
    btn.push(`<button type="button" data-tb-action="ace104-card" class="tb-owner" title="${esc(TB.planeMoves.ace104.text)}"><i class="fas fa-crosshairs"></i> 104:0: попадает</button>`);
  if (c.ace) rows.push(`<div class="tb-note">«104:0»: промах на ${c.ace} стал попаданием.</div>`);
  if (followFor(c)) btn.push(`<button type="button" data-tb-action="follow" class="tb-owner" title="Раз за вылет: союзники в этом раунде могут взять этот бросок"><i class="fas fa-plane-departure"></i> ${esc(followFor(c).name)}</button>`);
  if (c.follow) rows.push(`<div class="tb-note">«За мной!»: союзники могут повторить этот бросок до конца раунда.</div>`);
  if (c.followOf) rows.push(`<div class="tb-note">«За мной!»: бросок ${esc(c.followOf)}.</div>`);
  const queued = c.delayed && c.combatKey && !c.resolved && !c.dmgApplied;
  if (queued && c.stack) rows.push(stackRow(c));
  if (queued) rows.push(`<div class="tb-note tb-queued"><i class="fas fa-hourglass-half"></i> ${c.atTurn ? "Ждёт начала хода цели." : "В очереди залпа конца раунда."}</div>`);
  if (c.resolved) rows.push(`<div class="tb-note">${c.shipOpen && !c.dmgApplied ? "Долетела в конце раунда: урон по системе корабля — кнопкой." : c.atTurn ? "Учтена в начале хода цели." : "Учтена в залпе конца раунда."}</div>`);
  if (c.dmg && c.targetUuid && !queued && (!c.resolved || c.shipOpen) && (c.success || c.proxHit || c.dc === null || c.dc === undefined) && !c.dmgApplied)
    btn.push(`<button type="button" data-tb-action="damage" class="tb-target-owner"><i class="fas fa-burst"></i> ${c.delayed ? "В конце раунда: " : ""}${hitDmg(c)} урона по «${esc(c.targetName)}»</button>`);
  if (c.dmgApplied) rows.push(`<div class="tb-note">${c.autoDmg ? `Попадание: ${c.dmg} урона по «${esc(c.targetName)}» нанесено сразу.` : "Урон нанесён."}</div>`);

  return `<div class="tb-card tb-card-${c.type}">
    <header class="tb-card-head"><span class="tb-card-who">${esc(c.actorName)}</span><span class="tb-card-what">${esc(c.label)}</span></header>
    ${rows.join("")}
    ${btn.length ? `<div class="tb-actions">${btn.join("")}</div>` : ""}
  </div>`;
}

export async function postCard(actor, card, rolls = [], { author } = {}) {
  card.actorUuid = actor.uuid;
  card.actorName = actor.name;
  const msg = await ChatMessage.create({
    ...(author ? { author } : {}),
    speaker: ChatMessage.getSpeaker({ actor }),
    content: renderCard(card),
    rolls,
    sound: rolls.length ? CONFIG.sounds.dice : null,
    flags: { [SYSTEM_ID]: { card } }
  });
  // бросок на катапультирование идёт уже после Doom: ни молнии, ни срыва
  if (card.rolled && card.type !== "eject" && computeCard(card).comp) { await lightningStrike(actor); await tornadoDebris(actor); }
  // на пределе: первая d4 = 1 в вылете — срыв
  if (card.rolled && !["ground", "eject"].includes(card.type) && card.d4 === 1) await checkBreakdown(actor, "на d4 выпала 1");
  return msg;
}

/**
 * Молния: Complication на d4 в зоне с грозой — в самолёт бьёт молния (раз в раунд на самолёт).
 * До конца его следующего хода −1 Evasion, а ракеты только с броском (Improved Fox Two!).
 */
async function lightningStrike(actor) {
  const c = game.combat;
  if (!c?.started || !isFlying(actor) || !actor.isOwner) return;
  if (!weatherAt(actor).list.some(d => d.id === "lightning")) return;
  if (actor.getFlag(SYSTEM_ID, "struck")?.combat === c.id && actor.getFlag(SYSTEM_ID, "struck")?.round === c.round) return;
  await actor.setFlag(SYSTEM_ID, "struck", { combat: c.id, round: c.round });
  return ChatMessage.create({
    speaker: { alias: "AWACS" },
    content: `<div class="tb-card tb-card-lightning"><header class="tb-card-head"><span class="tb-card-who">ϟ Молния</span><span class="tb-card-what">${esc(actor.token?.name ?? actor.name)}</span></header>
      <div class="tb-note">Complication в грозе: в самолёт ударила молния. До конца следующего хода <b>−1 Evasion</b>, а ракеты только с броском (Improved Fox Two!).</div></div>`,
    flags: { [SYSTEM_ID]: { radio: { to: actor.uuid, text: `${actor.system?.callsign || actor.token?.name || actor.name}, в тебя ударила молния! Проверь приборы.` } } }
  });
}

/** Торнадо: Complication в зоне торнадо — урон обломками (книга, стр. 65). Сколько, книга не говорит: 1 HP. */
export const DEBRIS_DMG = 1;
async function tornadoDebris(actor) {
  if (!game.combat?.started || !isFlying(actor) || !actor.isOwner) return;
  if (!weatherAt(actor).list.some(d => d.id === "tornado")) return;
  await ChatMessage.create({ speaker: { alias: "AWACS" },
    content: `<div class="tb-card tb-card-lightning"><header class="tb-card-head"><span class="tb-card-who">⌁ Торнадо</span><span class="tb-card-what">${esc(actor.token?.name ?? actor.name)}</span></header>
      <div class="tb-note">Complication в торнадо: обломки и порывы ветра, <b>${DEBRIS_DMG} урона</b>.</div></div>` });
  return actor.applyDamage(DEBRIS_DMG, { source: "Обломки торнадо" });
}

/* ---------- проверки ---------- */

/** Пороги Perk/Complication с учётом погоды «Ураган» (Complication на 1–2). */
function thresholds(actor, skill, extraComp) {
  const s = actor.system;
  // «Трёп в эфире» эскадрильи: у врагов Complication на 1–2
  const lead = takeNextD4(actor);
  return { perkOn: Math.min(s.perkOn?.[skill] ?? 4, lead?.perkOn ?? 4), compOn: Math.max(s.compOn?.[skill] ?? 1, extraComp || trashComp(actor) ? 2 : 1, lead?.compOn ?? 1), skill };
}

/** Триггер «Отточенное мастерство» (Practiced Competence), ещё не использованный в этом вылете. */
export function practicedReady(actor) {
  if (actor?.type !== "pilot") return null;
  return actor.items.find(i => i.type === "trigger" && i.system.key === "practiced" && !i.system.used) ?? null;
}

/**
 * Кубики хода. «Отточенное мастерство»: 10 и 4 без броска, раз за вылет (триггер отмечается использованным),
 * и это не тратит единственную проверку хода. Обычный бросок, когда проверка хода уже была, — null.
 */
async function rollDice(actor, practiced, { turnRoll = true, follow = null } = {}) {
  // «За мной!»: тот же бросок, что у ведущего манёвра; бросок хода всё равно тратится
  const fo = follow ? followOffer(actor, follow) : null;
  if (fo) {
    if (turnRoll && !allowRoll(actor)) return null;
    takeFollow(actor);
    return { d10: fo.d10, d4: fo.d4, rolls: [], follow: fo.name };
  }
  if (practiced) {
    const t = practicedReady(actor);
    if (t) {
      await t.update({ "system.used": true });
      return { d10: 10, d4: 4, rolls: [], practiced: true };
    }
    ui.notifications.warn("«Отточенное мастерство» в этом вылете уже использовано: бросаю кубики.");
  }
  if (turnRoll && !allowRoll(actor)) return null;
  const r10 = await roll("1d10"), r4 = await roll("1d4");
  return { d10: r10.total, d4: r4.total, rolls: [r10, r4] };
}

function commonFields(actor, skill) {
  const pr = !!practicedReady(actor);
  const w = weatherAt(actor);
  return `
    <div class="form-group"><label>Модификатор</label><input type="number" name="mod" value="0"></div>
    <div class="form-group"><label><input type="checkbox" name="storm" ${w.comp2 ? "checked" : ""}> Ураган: Complication на 1–2</label></div>
    ${w.list.length ? `<p class="tb-hint">Погода: ${w.list.map(d => `${d.ico} ${esc(d.name)}`).join(", ")}</p>` : ""}
    ${followOffer(actor, skill) ? `<div class="form-group"><label><input type="checkbox" name="follow" checked> «За мной!» за ${esc(followOffer(actor, skill).name)}: d10 = ${followOffer(actor, skill).d10}, d4 = ${followOffer(actor, skill).d4}</label></div>` : ""}
    ${pr ? `<div class="form-group"><label><input type="checkbox" name="practiced"> Отточенное мастерство (раз за вылет): d10 = 10 и d4 = 4 без броска, проверка хода не тратится</label></div>` : ""}`;
}

function blocked(actor, skill) {
  if (actor.system.skillBlocked?.[skill]) {
    ui.notifications.warn(`Навык «${TB.skills[skill].label}» недоступен: метка Grit.`);
    return true;
  }
  return false;
}

export async function rollCheck(actor, skill, { dc = TB.difficulty, label } = {}) {
  if (blocked(actor, skill)) return;
  const sk = TB.skills[skill];
  const data = await formDialog(`Проверка: ${sk.label}`, `
    <div class="form-group"><label>Сложность</label><input type="number" name="dc" value="${dc}"></div>
    ${commonFields(actor, skill)}`);
  if (!data) return;
  const dice = await rollDice(actor, data.practiced, { follow: data.follow ? skill : null });
  if (!dice) return;
  const parts = skillParts(actor, skill, sk.label);
  if (skill === "push") parts.push(...weatherParts(weatherAt(actor), "push"));
  parts.push(...await takeNext(actor));
  if (data.mod) parts.push(["мод.", data.mod]);
  const card = {
    type: "check", label: label ?? `Проверка ${sk.label} (${sk.en})`, rolled: true, d10: dice.d10, d4: dice.d4,
    parts, strain: 0, dc: data.dc, strainable: canStrain(actor),
    practiced: !!dice.practiced, followOf: dice.follow ?? "", ...thresholds(actor, skill, data.storm)
  };
  return postCard(actor, card, dice.rolls);
}

/** Восстановление Strain: Push против 7, вернуть (итог − 7), минимум 1 (2 с «Кухней и туалетом»). */
export async function rollRecover(actor) {
  if (blocked(actor, "push")) return;
  const data = await formDialog("Восстановить Strain (Push против 7)", commonFields(actor, "push"));
  if (!data) return;
  const dice = await rollDice(actor, data.practiced, { follow: data.follow ? "push" : null });
  if (!dice) return;
  const parts = skillParts(actor, "push", "Форсаж");
  parts.push(...weatherParts(weatherAt(actor), "push"));
  parts.push(...await takeNext(actor));
  if (data.mod) parts.push(["мод.", data.mod]);
  const card = {
    type: "recover", label: "Восстановление Strain", rolled: true, d10: dice.d10, d4: dice.d4, parts, strain: 0, dc: 7,
    strainable: true, practiced: !!dice.practiced, followOf: dice.follow ?? "", minRegain: actor.system.planeProps?.has?.("kitchen") ? 2 : 1,
    ...thresholds(actor, "push", data.storm)
  };
  return postCard(actor, card, dice.rolls);
}

/** Сваливание: Push против 7. */
export async function rollStall(actor) {
  // Push под Grit: выровняться нечем, проверка проваливается сама (как другие обязательные проверки)
  if (actor.system.skillBlocked?.push) return postCard(actor, {
    type: "stall", label: "Сваливание: Push против 7", rolled: false, parts: [["Push недоступен (Grit)", 0]], strain: 0, dc: 7, forceFail: true,
    strainable: false, alt: actor.system.alt, notes: ["Метка Grit на Push: выровняться нельзя, проверка провалена.", "Провал: минус уровень высоты и повтор на следующем ходу, на Низкой сразу Doom."]
  }, []);
  const dice = await rollDice(actor, false, { turnRoll: false });
  const w = weatherAt(actor);
  const parts = [...skillParts(actor, "push", "Форсаж"), ...weatherParts(w, "push"), ...await takeNext(actor)];
  const card = {
    type: "stall", label: "Сваливание: Push против 7", rolled: true, d10: dice.d10, d4: dice.d4, parts, strain: 0, dc: 7,
    strainable: canStrain(actor), alt: actor.system.alt, ...thresholds(actor, "push", w.comp2),
    notes: ["Успех: Speed 1. Провал: минус уровень высоты и повтор на следующем ходу, на Низкой сразу Doom."]
  };
  return postCard(actor, card, dice.rolls);
}

/* ---------- метка Doom: судьба пилота ---------- */

const FATE_WORD = { ok: "катапультировался", hurt: "жив, ранен", mia: "пропал без вести", kia: "погиб" };

/** Исход броска на катапультирование: успех — катапульта; провал решает d4 того же броска. */
export function ejectFate(c) {
  if (c.success) return { key: "ok", status: "ejected", title: "Катапультировался",
    text: "Как пилот вернётся, решают три проверки на земле: выжить при приземлении (Push), уйти от поисковых групп (Dodge), выйти к своим (Aim или Lead). Ни одной 3 и ниже: вернулся к следующему вылету; одна: пропускает вылет; две и больше: плен или окружение, спасение становится миссией." };
  if (c.d4 >= 4) return { key: "hurt", status: "hospital", title: "Провал, d4 = 4: ранен, но подобран", text: "Пилот жив и попадает в госпиталь." };
  if (c.d4 >= 2) return { key: "mia", status: "mia", title: `Провал, d4 = ${c.d4}: пропал без вести или в плену`, text: "Спасение становится миссией. Если пилот в плену, поменяйте статус в личном деле." };
  return { key: "kia", status: "kia", title: "Провал, d4 = 1: гибель", text: "Последние слова остаются за пилотом. Стол получает «Достойное отступление»." };
}

function renderDoomFate(c) {
  const done = c.chosen === "eject" ? `<div class="tb-note">Бросок на катапультирование сделан.</div>`
    : c.chosen === "hero" ? `<div class="tb-note"><b>Героическая гибель.</b> Последние слова за пилотом, кубики в этом вылете больше не бросаем. Стол выбирает: «Победа любой ценой» (ещё одна драматичная жертва) или «Достойное отступление».</div>` : "";
  const btn = c.chosen ? "" : `<div class="tb-actions">
    <button type="button" data-tb-action="doom-eject" class="tb-owner"><i class="fas fa-parachute-box"></i> Бросок на катапультирование</button>
    <button type="button" data-tb-action="doom-hero" class="tb-owner"><i class="fas fa-skull"></i> Героическая гибель</button></div>`;
  return `<div class="tb-card tb-card-doomfate">
    <header class="tb-card-head"><span class="tb-card-who">${esc(c.actorName)}</span><span class="tb-card-what">Метка Doom</span></header>
    <div class="tb-note">Машина обречена${c.reason ? ` (${esc(c.reason)})` : ""}. Судьбу решает <b>бросок на катапультирование</b>: Push против 7, Strain можно, ничья за пилотом. Успех: катапультировался. Провал, смотри d4: 4 ранен, но подобран; 2–3 пропал без вести или в плену; 1 гибель.</div>
    <div class="tb-note">Вместо броска можно выбрать <b>героическую гибель</b> с последними словами: только она открывает «Победу любой ценой».</div>
    ${done}${btn}
  </div>`;
}

/** Карточка Doom пилота отмечается выбором «катапульта»; false — выбор уже сделан. */
async function markDoomEject(actor) {
  const doom = game.messages.contents.slice(-200).reverse().find(m => { const c = m.getFlag(SYSTEM_ID, "card"); return c?.type === "doomfate" && c.actorUuid === actor.uuid; });
  const doomCard = doom ? foundry.utils.deepClone(doom.getFlag(SYSTEM_ID, "card")) : null;
  if (doomCard?.chosen) { ui.notifications.warn(doomCard.chosen === "eject" ? `${actor.name}: катапульта уже сработала.` : `${actor.name}: выбрана героическая гибель.`); return false; }
  if (doom && doom.canUserModify(game.user, "update")) {
    doomCard.chosen = "eject";
    await doom.update({ content: renderCard(doomCard), [`flags.${SYSTEM_ID}.card`]: doomCard });
  }
  return true;
}

/**
 * Катапульта одной кнопкой (HUD при метке Doom): без окон. Карточка Doom отмечается выбором «катапульта»,
 * бросок Push против 7, при провале сам тратится Strain, если его хватает дотянуть до 7, исход сразу пишется в личное дело.
 */
export async function ejectNow(actor, { marked = false } = {}) {
  if (!actor?.isOwner || actor.type !== "pilot") return null;
  if (!marked) {
    if (!actor.system.markers.doom) return ui.notifications.warn(`${actor.name}: катапульта только при метке Doom.`);
    if (!(await markDoomEject(actor))) return null;
  }
  const dice = await rollDice(actor, false, { turnRoll: false });
  if (!dice) return null;
  const card = {
    type: "eject", label: "Катапультирование: Push против 7", rolled: true, d10: dice.d10, d4: dice.d4,
    // Push под Grit: ранги Push не идут, бросок остаётся (d10 + Strain)
    parts: [...(actor.system.skillBlocked?.push ? [["Push недоступен (Grit)", 0]] : skillParts(actor, "push", "Форсаж")), ...await takeNext(actor)], strain: 0, dc: 7, strainable: true,
    skill: "push", perkOn: 4, compOn: 1
  };
  // не хватает до 7, а Strain дотягивает: тратится сам
  const gap = card.dc - computeCard(card).total, have = actor.system.strain.value ?? 0;
  if (gap > 0 && gap <= have) {
    card.strain = gap;
    card.notes = [`Strain потрачен сам: ${gap}.`];
    await actor.update({ "system.strain.value": have - gap });
  }
  const fate = ejectFate(computeCard(card));
  card.applied = fate.status;
  await actor.update({ "system.service.status": fate.status });
  return postCard(actor, card, dice.rolls);
}

/** Break!: d10 + Dodge (+Strain, +Lead союзника), пополам вверх. */
export async function rollBreak(actor, { g12 = false, instinct = false } = {}) {
  if (g12) return breakG12(actor);
  if (blocked(actor, "dodge")) return;
  // в туннеле уходить некуда (кроме Зала и триггера «Это никогда не пригодится»)
  const tun = inNarrowTunnel(tokenOf(actor), actor);
  if (tun && !hasTrigger(actor, "nevercome")) return ui.notifications.warn("В туннеле Break! нельзя: уходить некуда. Можно только в Зале.");
  if (sysOff(actor.system, "ma")) ui.notifications.info(`MAWS ${actor.system.jam === "ma" ? "заглушён РЭБ" : "сломан"}: о ракетах узнаёшь, только когда они попадут.`);
  const data = await formDialog("Break!", `
    <div class="form-group"><label>Лидерство союзника</label><input type="number" name="lead" value="0"></div>
    ${commonFields(actor, "dodge")}`);
  if (!data) return;
  const dice = await rollDice(actor, data.practiced, { follow: data.follow ? "dodge" : null });
  if (!dice) return;
  const parts = skillParts(actor, "dodge", "Уклонение");
  if (data.lead) parts.push(["Lead", data.lead]);
  parts.push(...await takeNext(actor));
  // «Продвинутое уклонение», «Общая частота» союзника, «Скажи, что делать» (если Lead дали в этом окне)
  const tb = triggerBreak(actor, { lead: data.lead && !parts.some(p => p[0] === trig(actor, "tellme")?.name) ? data.lead : 0 });
  parts.push(...tb.parts);
  if (data.mod) parts.push(["мод.", data.mod]);
  const tvc = actor.system.planeProps?.has?.("tvc") || actor.system.props?.some?.(p => p.key === "tvc");
  // в разреженном воздухе стратосферы Break! стоит на 1 Speed больше
  const thin = actor.system.alt === "strat" ? 1 : 0;
  const card = {
    type: "break", label: instinct ? `Break! · ${TB.aceInstinct.name}` : "Break!", rolled: true, d10: dice.d10, d4: dice.d4, parts, strain: 0, dc: null,
    ev: actor.system.evasion ?? actor.system.stats?.ev ?? 0, strainable: canStrain(actor),
    speedDrop: (tvc ? 1 : 2) + thin, combatKey: combatKey(), practiced: !!dice.practiced, followOf: dice.follow ?? "", ...thresholds(actor, "dodge", data.storm),
    // «Чутьё аса»: вне хода, действие не тратит и проверкой хода не считается
    ...(instinct ? { noTurnRoll: true, notes: [`<b>${esc(TB.aceInstinct.name)}.</b> Вне хода: действие не тратится, проверкой хода не считается.`] } : {})
  };
  const msg = await postCard(actor, card, dice.rolls);
  await tb.take();
  await applyBreak(actor, card);
  return msg;
}

/** «Перегрузка 12g» (приём ADF-01 FALKEN): Break! без броска, как d10 = 10; проверку хода не тратит, Speed после него не падает. */
async function breakG12(actor) {
  if (!moveReady(actor, "g12")) return ui.notifications.warn(`«${TB.planeMoves.g12.name}» в этом вылете уже был.`);
  if (blocked(actor, "dodge")) return;
  if (inNarrowTunnel(tokenOf(actor), actor) && !hasTrigger(actor, "nevercome")) return ui.notifications.warn("В туннеле Break! нельзя: уходить некуда. Можно только в Зале.");
  await actor.setFlag(SYSTEM_ID, "sortie", { ...(actor.getFlag(SYSTEM_ID, "sortie") ?? {}), move: sortieMark(actor) });
  const parts = skillParts(actor, "dodge", "Уклонение");
  parts.push(...await takeNext(actor));
  const tb = triggerBreak(actor, { lead: 0 });
  parts.push(...tb.parts);
  const card = {
    type: "break", label: `Break! · ${TB.planeMoves.g12.name}`, rolled: true, d10: 10, d4: 2, parts, strain: 0, dc: null, noTurnRoll: true,
    ev: actor.system.evasion ?? actor.system.stats?.ev ?? 0, strainable: canStrain(actor), speedDrop: 0, speedApplied: true, combatKey: combatKey(),
    notes: [`<b>${esc(TB.planeMoves.g12.name)}.</b> Без броска, как d10 = 10. Проверку хода не тратит, Speed не падает.`],
    ...thresholds(actor, "dodge"), perkOn: 99, compOn: 0
  };
  const msg = await postCard(actor, card);
  await tb.take();
  await applyBreak(actor, card);
  return msg;
}

async function applyBreak(actor, card) {
  const c = computeCard(card);
  await actor.update({ "system.breakEv": c.applies ? c.value : null });
}

/* ---------- атаки ---------- */

/** Спецоружие готово: не выведено из строя («Форсированный выстрел») и есть боезапас. */
export const weaponReady = w => w.system.ready ?? (!w.getFlag?.(SYSTEM_ID, "off") && (w.system.ammo?.max === null || (w.system.ammo?.value ?? 0) > 0));

/** Вид цели для оружия: воздушная или наземная/морская. */
/** Вид цели для ракет: воздушная — самолёты и летающие боссы (Аркбёрд, SOLG, воздушные крейсеры и линкоры), иначе наземная или морская. */
const targetKind = t => (isAirTarget(t) ? "air" : "ground");
const has = v => v !== null && v !== undefined;

/** Спецоружие подходит к виду цели: противовоздушное только по воздуху, ударное только по земле и морю. */
/** Подвесное, которое стреляет как пушка: контейнеры (MGP, PLSL) и блок НУР (RCL, только по земле и морю, с боезапасом). */
export const isGunPod = w => w.system.target === "gun" || w.system.key === "RCL";
export const weaponFits = (w, kind) => !isGunPod(w) && w.system.target === kind;
/** Спецоружие без захвата и без пуска ракетой: EMRG (линия) и ESM (РЭБ). */
export const isOwnFire = w => ["line", "util"].includes(w?.system.target);
/** Залповое спецоружие (4AAM, XLAA, XAGM): один захват до 4 целей. */
export const isSalvo = w => TB.salvoWeapons.includes(w?.system.key);

/** Кто держит этого актёра на захвате (основном или залповом): токены на сцене, не сбитые. */
export function pursuersOf(uuid) {
  if (!uuid || !canvas?.ready) return [];
  return canvas.tokens.placeables.filter(t => t.actor && t.actor.uuid !== uuid && !t.actor.statuses?.has(CONFIG.specialStatusEffects.DEFEATED)
    && (t.actor.system.lockUuid === uuid || t.actor.getFlag?.(SYSTEM_ID, "salvo")?.list?.some(x => x.uuid === uuid)));
}

/** Держит ли токен эту машину на захвате (преследователь для кормовой пушки). */
const tailChaser = (actor, tok) => pursuersOf(actor.uuid).includes(tok);

/** «Укреплённый» (Стрэйнджриал 9.3): обычные ракеты и пушки наносят половину урона, вниз. Спецоружие (GPB, UGB, LACM и другое) бьёт полным. */
const hardened = t => !!t && hasRule(t.actor, "hardened");
const HARD_NOTE = "<b>Укреплённый.</b> Обычная ракета или пушка: урон вдвое меньше (вниз).";

/** Есть ли у стрелка стандартная ракета против вида цели: у NPC — только при Air-Air / Air-Gnd в листе (у бомбардировщиков Air-Air нет). */
function stdMissile(actor, kind) {
  const s = actor.system;
  if (sysOff(s, "ms")) return false;
  if (actor.type === "pilot") return true;
  if (s.kind === "air") return has(kind === "air" ? s.stats.aa : s.stats.ag);
  return false;
}

/** Чем стрелок может атаковать цель этого вида ракетами: стандартная ракета, спецоружие, ЗРК и ракетные системы корабля. */
export function strikeMeans(actor, kind) {
  const s = actor.system, air = kind === "air", out = [];
  if (stdMissile(actor, kind)) out.push("Стандартная ракета");
  if (actor.type === "npc" && s.kind === "ground" && has(air ? s.ground.ga : s.ground.gg)) out.push(air ? "ЗРК" : "G-G");
  if (actor.type === "npc" && s.kind === "ship" && s.systems.some(y => y.value > 0 && has(air ? y.ga : y.gg))) out.push("ракетная система");
  if (!sysOff(s, "sw")) for (const w of actor.items)
    if (w.type === "weapon" && weaponFits(w, kind) && weaponReady(w)) out.push(w.name);
  return out;
}

function weaponOptions(actor, missile, kind = null) {
  const opts = [];
  if (missile && (kind ? stdMissile(actor, kind) : stdMissile(actor, "air") || stdMissile(actor, "ground")))
    opts.push(`<option value="">Стандартная ракета (урон ${TB.missileDamage}, ${rangeLabel(TB.range.missile)})</option>`);
  const aim = aimedWeapon(actor)?.id;
  if (!sysOff(actor.system, "sw")) {
    for (const w of actor.items.filter(i => i.type === "weapon")) {
      const s = w.system;
      const isGun = isGunPod(w);
      if (missile === isGun) continue;
      if (missile && (s.target === "util" || (kind && !weaponFits(w, kind)))) continue;
      const empty = !weaponReady(w);
      const vs = s.target === "air" ? "по воздуху" : s.target === "ground" ? "по земле и морю" : "";
      // оружие под прицелом подсветки дальности стоит выбранным
      opts.push(`<option value="${w.id}" ${empty ? "disabled" : w.id === aim ? "selected" : ""}>${esc(w.name)}${w.system.unlimited ? "" : ` · ${s.ammo.value}/${s.ammo.max}`} · ${[vs, rangeLabel(s.reach)].filter(Boolean).join(", ")}</option>`);
    }
  }
  return opts;
}

/** У цели-игрока работает MAWS: её владелец услышит сигнал о пуске. */
const mawsOn = t => !!t?.actor?.hasPlayerOwner && !sysOff(t.actor.system, "ma");

/** Захваченная цель, если её токен ещё на сцене: для Fox Two! без выбранной цели. */
function lockedTarget(actor) {
  const a = actor.system.lockUuid ? resolveActor(actor.system.lockUuid) : null;
  return a ? describeTarget(a, actor.system.lock) : null;
}

/**
 * Дальность Lock On! по цели этого вида: своя и соседняя зона; дальнобойное спецоружие — вся зона операции,
 * «Мощный радар» тяжёлого истребителя по воздуху и ЗРК большой дальности — 2 зоны, ЗРК малой дальности — только своя.
 */
export function lockRangeOf(actor, kind) {
  const longRange = actor.items.find(i => i.type === "weapon" && weaponFits(i, kind) && i.system.reach >= TB.range.operation && weaponReady(i)) ?? null;
  let range = longRange ? TB.range.operation : TB.range.lockOn;
  // «Мощный радар» тяжёлого истребителя: воздушная цель на 2 зоны; «Феникс» F-14: в любой точке зоны операции
  const radar = kind === "air" && roleOf(actor) === "heavy" && range < 2;
  if (radar) range = 2;
  // ЗРК большой дальности: захват на две зоны; малой: только своя зона (Стрэйнджриал 9.3)
  if (hasRule(actor, "longsam") && range < 2) range = 2;
  if (hasRule(actor, "shortsam")) range = 0;
  return { range, longRange, radar };
}

/** Lock On!: цель выбирается щелчком по токену; захват в своей или соседней зоне (дальнобойное спецоружие — в любой точке зоны операции). */
export async function lockOn(actor, { free = false, phoenix = false, maxDist = null, label = "" } = {}) {
  const tok = await pickTargetToken(actor, { title: label ? `Lock On! · ${label}` : "Lock On!" });
  if (!tok) return;
  if (tok.actor.statuses?.has(CONFIG.specialStatusEffects.DEFEATED)) return ui.notifications.warn(`«${tok.name}» уже сбит.`);
  if (!canFireAt(actor, tok.actor)) return ui.notifications.warn(`«${tok.name}» на вашей стороне: захват берётся только на противника или нейтрала (сторона NPC — во вкладке «Заметки AWACS»).`);
  const t = describeTarget(tok.actor, tok.name, tok);
  const kind = targetKind(t);
  if (!strikeMeans(actor, kind).length)
    return ui.notifications.warn(`Lock On! невозможен: у «${actor.name}» нечем бить по ${kind === "air" ? "воздушным" : "наземным и морским"} целям.`);
  let { range, longRange, radar } = lockRangeOf(actor, kind);
  const fenix = phoenix && kind === "air";
  if (phoenix && !fenix) return ui.notifications.warn("«Феникс»: захват в любой точке зоны операции только по воздушной цели.");
  if (fenix) range = TB.range.operation;
  if (maxDist !== null) range = Math.min(range, maxDist);
  const { dist, far, problems } = reachProblems(actor, t, range, { strike: true });
  // дальше своей и соседней зоны захват не берётся; запреты по высоте ведущий может разрешить
  if (far) return ui.notifications.warn(`Lock On! невозможен: ${problems[0]}`);
  // Малозаметность и Станция РЭБ: только из той же зоны
  const same = dist ? sameZoneLock(t.actor, t.token) : "";
  if (same) return ui.notifications.warn(`Lock On! невозможен: ${same}`);
  // «Ордер»: при целом эскорте авианосец берут только из соседней зоны или ближе (и дальнобойным оружием тоже)
  const guard = dist > 1 ? escortCover(t.actor, t.token) : "";
  if (guard) return ui.notifications.warn(`Lock On! невозможен: ордер (${guard} рядом), «${t.name}» захватывают только из соседней зоны или ближе.`);
  if (!(await confirmReach(problems, "Lock On!"))) return;
  selectTarget(tok);
  // залповое спецоружие: тот же Lock On берёт ещё до трёх целей в пределах его дальности
  const sw = sysOff(actor.system, "sw") ? null : actor.items.find(i => i.type === "weapon" && isSalvo(i) && weaponFits(i, kind) && weaponReady(i));
  const extra = sw ? await pickSalvo(actor, sw, t, kind) : [];
  await actor.update({ "system.lock": t.name, "system.lockUuid": t.uuid,
    [`flags.${SYSTEM_ID}.salvo`]: sw ? { weapon: sw.id, list: [{ uuid: t.uuid, name: t.name }, ...extra.map(x => ({ uuid: x.uuid, name: x.name }))] } : null,
    [`flags.${SYSTEM_ID}.phoenix`]: fenix ? t.uuid : null });
  if (fenix) await actor.setFlag(SYSTEM_ID, "sortie", { ...(actor.getFlag(SYSTEM_ID, "sortie") ?? {}), move: sortieMark(actor) });
  const longNote = dist !== null && dist > TB.range.lockOn && longRange && !fenix ? ` Захват для ${esc(longRange.name)}.` : "";
  const salvoNote = extra.length ? ` Залп ${esc(sw.name.split(" · ")[0])}: ещё ${extra.map(x => `<b>${esc(x.name)}</b>`).join(", ")}; захват каждой цели срывается отдельно.` : "";
  const how = fenix ? " «Феникс»: захват не срывается расстоянием, пока цель в зоне операции."
    : radar ? " Мощный радар: срывается, если цель уйдёт дальше трёх зон." : " Срывается, если цель уйдёт дальше двух зон.";
  const what = free ? `Lock On! (${esc(label || "бесплатно")})` : fenix ? "Lock On! · Феникс" : "Lock On!";
  return ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<div class="tb-card tb-card-lock"><header class="tb-card-head"><span class="tb-card-who">${esc(actor.name)}</span><span class="tb-card-what">${what}</span></header><div class="tb-note">Захват: <b>${esc(t.name)}</b>${dist !== null ? `, ${dist} зон.` : "."}${longNote}${salvoNote}${how}</div></div>`,
    flags: { [SYSTEM_ID]: { rwr: { target: t.uuid, from: actor.name, fromUuid: actor.uuid, also: extra.map(x => x.uuid) } } }
  });
}

/** Ещё цели для залпа: щелчками, до 4 вместе с первой; Esc — хватит. Каждая — противник того же вида в пределах дальности оружия. */
async function pickSalvo(actor, w, first, kind) {
  const out = [], code = w.name.split(" · ")[0];
  while (out.length < 3) {
    const have = [first, ...out].map(x => `<b>${esc(x.name)}</b>`).join(", ");
    const tok = await pickTargetToken(actor, { title: `Залп ${code}: цель ${out.length + 2} из 4`,
      hint: `В залпе: ${have}. Щёлкните по следующей цели или нажмите «Готово».`,
      done: `Готово: ${out.length + 1} ${out.length ? "цели" : "цель"}` });
    if (!tok) break;
    const a = tok.actor;
    if (a === first.actor || out.some(x => x.actor === a)) { ui.notifications.warn(`«${tok.name}» уже в залпе.`); continue; }
    if (a.statuses?.has(CONFIG.specialStatusEffects.DEFEATED)) { ui.notifications.warn(`«${tok.name}» уже сбит.`); continue; }
    if (!canFireAt(actor, a)) { ui.notifications.warn(`«${tok.name}» на вашей стороне.`); continue; }
    const t = describeTarget(a, tok.name, tok);
    if (targetKind(t) !== kind) { ui.notifications.warn(`${code} бьёт только по ${kind === "air" ? "воздушным" : "наземным и морским"} целям.`); continue; }
    const { far, problems } = reachProblems(actor, t, w.system.reach);
    if (far) { ui.notifications.warn(`«${tok.name}»: ${problems[0]}`); continue; }
    out.push(t);
    tok.setTarget?.(true, { releaseOthers: false, groupSelection: true });   // цели залпа видны метками прицела
  }
  return out;
}

/**
 * Защита цели против ракеты на этот момент с чертой спецоружия (Стрэйнджриал 8.2): QAAM по цели в своей зоне — без Break!,
 * HVAA — Speed цели вполовину, GPB — Occlusion −2 и туннель не прикрывает. Плюс туннель, «Опять ты!» и боевые триггеры. null — корабль.
 */
export function missileDef(shooter, actor, { token = tokenOf(actor), weather = null, wkey = "", close = false, ghost = false } = {}) {
  // «Удар из ниоткуда» (приём F-22 и F-117): цель не может Break! против этой ракеты
  const d = defenseWithWeather(actor, weather ?? weatherAt(actor, token), { noBreak: (wkey === "QAAM" && close) || ghost, halfSpeed: wkey === "HVAA" });
  if (d === null || d === undefined) return null;
  return d + (wkey === "GPB" ? -2 : wallBonus(token, actor)) + nemesisDefense(shooter, actor) + triggerDefense(shooter, actor);
}
/** QAAM: цель в своей зоне в момент пуска. */
const closeTo = (actor, t) => zoneDistance(tokenOf(actor), t?.token) === 0;
/** Защита цели t (из describeTarget) против этого спецоружия у стрелка; у кораблей null. */
const defVs = (actor, t, w, ghost = false) => t && t.kind !== "ship" ? missileDef(actor, t.actor, { token: t.token, weather: t.weather, wkey: w?.system.key ?? "", close: closeTo(actor, t), ghost }) : null;

/** Навык Improved Fox Two!: Aim по воздуху, Deploy по земле; «Универсал» многоцелевой машины — больший из двух (не под меткой Grit). */
export function foxSkill(actor, air) {
  const base = air ? "aim" : "deploy";
  if (roleOf(actor) !== "multi") return base;
  const other = air ? "deploy" : "aim", bl = k => !!actor.system.skillBlocked?.[k];
  if (bl(base) !== bl(other)) return bl(base) ? other : base;
  return skillSum(actor, other) > skillSum(actor, base) ? other : base;
}

/** «Штурмовой заход» (черта штурмовика): стрелок на Низкой, цель на земле или воде в своей зоне. */
export function casRun(actor, t) {
  if (!t || isAirTarget(t) || roleOf(actor) !== "attack") return false;
  const me = tokenOf(actor);
  return !!me && altOf(me, actor) === "low" && zoneDistance(me, t.token ?? tokenOf(t.actor)) === 0;
}

/** «Подавление ПВО» (свойство машины): +2 к атакам A-G по ЗРК, зениткам, РЛС и станциям помех. Строка поправки или null. */
export function seadPart(actor, t) {
  const a = t?.actor;
  return hasProp(actor, "sead") && a?.type === "npc" && a.system.kind === "ground" && a.system.grp === "ad" ? ["Подавление ПВО", 2] : null;
}

/** Морская цель для противокорабельной ракеты: корабль (не летающий босс). */
const seaTarget = t => t?.kind === "ship" && !isAirTarget(t);
/** Противокорабельная ракета (свойство машины): станция ASM на пульте Fox Two!, A-G − Speed против Occlusion, урон 12. */
export const ASM = { id: "ASM", dmg: 12 };
/** Наземная цель для крылатой ракеты NPC. */
const landTarget = t => t?.kind === "ground";
/** Крылатые ракеты бомбардировщика NPC: станция CRS, по наземной цели в любой точке зоны операции, A-G − Speed против Occlusion, урон 7. */
export const CRS = { id: "CRS", dmg: 7 };

/** С чем сравнивать атаку: защита цели, Occlusion выбранной системы корабля или (система не выбрана) итог без сравнения. */
function shipDc(t, aim, dc, occCut = 0) {
  if (aim) return { dc: aim.occ - occCut, vsLabel: `Occlusion «${aim.y.name}»`, vsHint: "", sys: aim.i, sysName: aim.y.name };
  if (t?.kind === "ship") return { dc: null, vsLabel: "защиты", vsHint: "по Occlusion системы" };
  return { dc, vsLabel: "защиты", vsHint: "" };
}

const sum = list => list.reduce((n, p) => n + (p?.[1] ?? 0), 0);
/** Сумма навыка для подсказки на кнопке; у NPC без навыков — 0. */
const skillSum = (actor, skill) => { try { return sum(skillParts(actor, skill)); } catch { return 0; } };

/**
 * Прикидка Fox Two! по цели для совета ведущему: итог без броска (fox), прибавка к d10 с броском (imp), с чем сравнивать (dc),
 * попадёт ли без броска (hit) и доля бросков d10, что попадут (chance). Ракетой — стандартной, иначе первым подходящим спецоружием.
 */
export function foxEstimate(actor, t) {
  const s = actor.system, kind = targetKind(t), air = kind === "air";
  const w = stdMissile(actor, kind) ? null : sysOff(s, "sw") ? null : actor.items.find(i => i.type === "weapon" && weaponFits(i, kind) && weaponReady(i)) ?? null;
  let base = air ? s.aa : s.ag;
  if (actor.type === "npc" && s.kind === "ground") base = (air ? s.ground?.ga : s.ground?.gg) ?? 0;
  const ws = w?.system, wx = weatherAt(actor);
  const common = (air ? sum([stratLift(actor, t)]) : 0) - (s.speed ?? 0);
  const ct = r => sum(triggerAttack(actor, t.actor, { rolled: r, skill: air ? "aim" : "deploy" }).parts) + sum(nemesisAttack(actor, t.actor, { rolled: r, skill: air ? "aim" : "deploy" }).parts);
  const fox = (base ?? 0) + ((air ? ws?.aa : ws?.ag) ?? 0) + sum(weatherParts(wx, air ? "aa" : "ag")) + common + ct(false) + (air ? 0 : sum([seadPart(actor, t)]));
  const imp = skillSum(actor, foxSkill(actor, air)) + ((air ? ws?.aim : ws?.dep) ?? 0) + common + ct(true) + (air ? 0 : sum([seadPart(actor, t)]));
  const dc = t.defense === null ? null : defVs(actor, t, w);
  const chance = dc === null ? null : Math.max(0, Math.min(10, 11 - (dc - imp))) / 10;
  return { fox, imp, dc, hit: dc !== null && fox >= dc, chance, weapon: w?.name ?? null };
}

/**
 * Пульт Fox Two! в стиле HUD: станции оружия, вид цели (если цели нет), схема корабля и две кнопки пуска:
 * FOX 2 — без броска, итог виден сразу; IMPROVED — d10 + Aim/Deploy. Поправки свёрнуты.
 * Возвращает { pick: "fox" | "improved", weapon, tkind, sys, mod, storm, practiced } или null.
 */
export function foxPanel(actor, t, tk, { preMove = "", src = {} } = {}) {
  const s = actor.system;
  const wx = weatherAt(actor);
  const kinds = tk ? [tk] : ["air", "ground"];
  const aimId = aimedWeapon(actor)?.id ?? "";
  const speed = s.speed ?? 0;
  const lift = t ? sum([stratLift(actor, t)]) : 0;
  const sneak = sum([surprise(actor, t)]);
  const ciws = t?.kind === "ship" ? sum(aimAt(actor, t, 0, { missile: true })?.parts ?? []) : 0;
  // станции: стандартная ракета и спецоружие, у каждой — по каким целям бьёт и итоги для обеих кнопок
  const stations = [];
  if (kinds.some(k => stdMissile(actor, k))) stations.push({ id: "", code: "MSL", cnt: "∞", dmg: TB.missileDamage, fits: kinds.filter(k => stdMissile(actor, k)), w: null });
  // противокорабельная ракета: только по морской цели, в любой точке зоны операции, без захвата и без броска
  if (hasProp(actor, "antiship") && kinds.includes("ground") && (!t || seaTarget(t)) && !sysOff(s, "ms"))
    stations.push({ id: ASM.id, code: "ASM", cnt: "∞", dmg: ASM.dmg, fits: ["ground"], w: null, asm: true,
      trait: { name: "Противокорабельная ракета", tag: "SEA", text: "По морской цели в любой точке зоны операции, без захвата: A-G − Speed против Occlusion, урон 12. Только без броска." } });
  if (hasProp(actor, "cruise") && kinds.includes("ground") && (!t || landTarget(t)))
    stations.push({ id: CRS.id, code: "CRS", cnt: "∞", dmg: CRS.dmg, fits: ["ground"], w: null, crs: true,
      trait: { name: "Крылатые ракеты", tag: "LAND", text: "По наземной цели в любой точке зоны операции, без захвата: A-G − Speed против Occlusion, урон 7. Только без броска." } });
  // EMRG и ESM без захвата и цели: станция есть при любом виде цели, пуск уходит в своё окно (линия, система)
  if (!sysOff(s, "sw")) for (const w of actor.items.filter(i => i.type === "weapon" && !isGunPod(i))) {
    const own = isOwnFire(w);
    const fits = own ? kinds : kinds.filter(k => weaponFits(w, k));
    if (!fits.length) continue;
    const empty = !weaponReady(w);
    stations.push({ id: w.id, code: w.name.split(" · ")[0], cnt: w.getFlag?.(SYSTEM_ID, "off") ? "OFF" : w.system.unlimited ? "∞" : String(w.system.ammo.value ?? 0).padStart(2, "0"), dmg: parseInt(w.system.dmg) || 0, fits, w, empty, own, trait: w.system.trait });
  }
  const prev = {};
  for (const st of stations) {
    prev[st.id] = {};
    for (const k of st.fits) {
      const air = k === "air", ws = st.w?.system;
      let base = air ? s.aa : s.ag;
      if (actor.type === "npc" && s.kind === "ground") base = (air ? s.ground.ga : s.ground.gg) ?? 0;
      const common = (air ? lift : 0) + sneak + ciws - speed;
      const nem = r => sum(nemesisAttack(actor, t?.actor, { rolled: r, skill: air ? "aim" : "deploy" }).parts)
        + sum(triggerAttack(actor, t?.actor, { rolled: r, skill: air ? "aim" : "deploy" }).parts);
      const sead = air ? 0 : sum([seadPart(actor, t)]);
      prev[st.id][k] = {
        fox: (base ?? 0) + ((air ? ws?.aa : ws?.ag) ?? 0) + sum(weatherParts(wx, air ? "aa" : "ag")) + common + nem(false) + sead,
        imp: skillSum(actor, foxSkill(actor, air)) + ((air ? ws?.aim : ws?.dep) ?? 0) + common + nem(true) + sead
      };
    }
  }
  const first = stations.find(x => x.id === aimId && !x.empty) ?? stations.find(x => !x.empty) ?? stations[0];
  // защита цели против каждой станции: черты QAAM, HVAA и GPB меняют её
  const dcs = Object.fromEntries(stations.map(st => [st.id, defVs(actor, t, st.w)]));
  const dc = t && t.kind !== "ship" ? dcs[first?.id ?? ""] ?? defVs(actor, t, null) : null;
  // «Форсированный выстрел»: раз за вылет спецоружием +2 к атаке и урону, потом оно не работает
  const oc = stations.some(x => x.w) ? practicedOvercharge(actor) : null;
  const occ = t?.kind === "ship" ? Object.fromEntries((t.actor.system.systems ?? []).map((y, i) => [i, y.occ])) : null;
  const struck = struckBy(actor);
  const lockOk = !t || s.lockUuid === t.uuid || (t && seaTarget(t) && stations.some(x => x.asm)) || (t && landTarget(t) && stations.some(x => x.crs));
  // фирменные приёмы при пуске (раз за вылет): «Удар из ниоткуда», «Ракетный шквал»
  const moveBox = (key, hint) => moveReady(actor, key) ? `<label title="${esc(TB.planeMoves[key].text)}"><input type="checkbox" name="${key}" ${preMove === key ? "checked" : ""}><span>${esc(TB.planeMoves[key].name.toUpperCase())}</span><em>${esc(hint)}</em></label>` : "";
  const moves = moveBox("ghost", "без предупреждения, без Break!") + moveBox("salvo", "две ракеты, −2 Ammo");
  const pr = !!practicedReady(actor);
  // первые значения на кнопках сразу в разметке: окно не мигает пустыми табло
  const k0 = first?.fits.includes(kinds[0]) ? kinds[0] : first?.fits[0] ?? kinds[0];
  const p0 = prev[first?.id]?.[k0] ?? { fox: 0, imp: 0 };
  const gpbOcc = st => st?.w?.system.key === "GPB" ? 2 : 0;
  const need0 = occ ? occ[defaultSys(t.actor)] - gpbOcc(first) : dc;
  // ракеты, что уже летят в эту цель в этом раунде: каждая следующая даёт +1 самой точной (прикидка: +1 за каждую)
  const inAir = t && t.kind !== "ship" ? sameVolley({ delayed: true, combatKey: combatKey(), targetUuid: t.uuid, targetName: t.name }).length : 0;
  const hit0 = need0 === null || need0 === undefined ? "" : p0.fox + inAir >= need0 ? "ok" : "bad";
  const station = st => `<label class="st ${st.empty ? "empty" : ""} ${st === first ? "aimed" : ""} ${st.fits.includes(k0) ? "" : "off"}" data-fits="${st.fits.join(" ")}" title="${esc(st.w?.name ?? "Стандартная ракета")} · урон ${st.dmg}${st.w ? ` · ${rangeLabel(st.w.system.reach)}` : ""}">
      <input type="radio" name="weapon" value="${st.id}" ${st === first ? "checked" : ""} ${st.empty ? "disabled" : ""}><i class="st-led"></i><span class="st-name">${esc(st.code)}</span><span class="st-cnt">${st.empty ? "EMPTY" : esc(st.cnt)}</span>${st.trait ? `<small class="st-trait">${esc(st.trait.tag)}</small>` : ""}<b class="st-key">${st.dmg ? `DMG ${st.dmg}` : "ECM"}</b></label>`;
  const content = `
    <div class="tb-ck-tgt">
      <small>ЦЕЛЬ${src.from ? ` · ${src.from === "lock" ? "ЗАХВАТ" : "МЕТКА T"}` : ""}</small><b>${t ? esc(t.name) : "не выбрана"}</b>
      ${src.alt ? `<button type="button" class="tb-ck-mapick" data-pick="swap" title="Стрелять по ${src.from === "lock" ? "цели с меткой T" : "захваченной цели"}"><i class="fas fa-right-left"></i> ${src.from === "lock" ? "МЕТКА T" : "ЗАХВАТ"}: ${esc(src.alt.name)}</button>` : ""}
      ${t ? `<span class="tb-ck-def">${dc !== null ? `DEF <b data-ck-def>${dc}</b>` : `OCC <b data-ck-occ>${need0 ?? "—"}</b>`}</span>` : `<span class="tb-ck-def muted">итог без сравнения</span>`}
      ${t ? `<span class="tb-ck-lamp ${lockOk ? "ok" : "bad"}">${lockOk ? "LOCK" : "NO LOCK"}</span>` : ""}
    </div>
    ${inAir ? `<div class="tb-ck-trait tb-ck-stack"><b>В воздухе по цели: ${inAir}.</b> Каждая ещё ракета в этом раунде даёт +1 самой точной или свой урон: ${inAir === 1 ? "эта ракета даст" : "вместе с этой"} +${inAir}.</div>` : ""}
    ${tk ? `<input type="hidden" name="tkind" value="${tk}">` : `<div class="tb-ck-seg"><small>ВИД ЦЕЛИ</small>
      <label><input type="radio" name="tkind" value="air" checked><span>AIR · Aim</span></label>
      <label><input type="radio" name="tkind" value="ground"><span>GND · Deploy</span></label></div>`}
    <div class="tb-ck-stores"><small>STORES</small><div class="tb-ck-st">${stations.map(station).join("")}</div></div>
    <div class="tb-ck-trait" data-ck-trait ${first?.trait ? "" : "hidden"}>${first?.trait ? `<b>${esc(first.trait.name)}.</b> ${esc(first.trait.text)}` : ""}</div>
    ${moves ? `<div class="tb-ck-seg tb-ck-move"><small>ПРИЁМ</small>${moves}</div>` : ""}
    ${t?.kind === "ship" ? schematicHtml(t) : ""}
    <details class="tb-ck-more"><summary>Поправки</summary>
      <div class="form-group"><label>Модификатор</label><input type="number" name="mod" value="0"></div>
      <div class="form-group"><label><input type="checkbox" name="storm" ${wx.comp2 ? "checked" : ""}> Ураган: Complication на 1–2</label></div>
      ${pr ? `<div class="form-group"><label><input type="checkbox" name="practiced"> Отточенное мастерство: d10 = 10 и d4 = 4 без броска</label></div>` : ""}
      ${oc ? `<div class="form-group"><label title="${esc(oc.system.text)}"><input type="checkbox" name="overcharge"> ${esc(oc.name)}: спецоружием +2 к атаке и урону, потом оно не работает до конца вылета</label></div>` : ""}
      ${wx.list.length ? `<p class="tb-hint">Погода: ${wx.list.map(d => `${d.ico} ${esc(d.name)}`).join(", ")}</p>` : ""}
    </details>
    <div class="tb-ck-fire">
      <button type="button" class="tb-ck-big fox" data-pick="fox" ${struck ? `disabled title="После удара молнии ракеты только с броском"` : ""}>
        <b>FOX 2</b><small>${struck ? "молния: только с броском" : `без броска · итог <span data-ck-fox>${p0.fox}</span>`}</small><i class="tb-ck-hit ${hit0}" data-ck-foxhit></i></button>
      <button type="button" class="tb-ck-big imp" data-pick="improved">
        <b>IMPROVED</b><small>d10 <span data-ck-imp>${sign(p0.imp)}</span> · <span data-ck-skill>${k0 === "air" ? "Aim" : "Deploy"}</span></small></button>
    </div>`;
  const render = root => {
    const form = root.querySelector("form");
    const val = n => form.querySelector(`[name="${n}"]:checked`)?.value ?? form.querySelector(`[name="${n}"]`)?.value ?? "";
    const upd = () => {
      const k = val("tkind") || "air";
      // станции не под этот вид цели гаснут
      for (const lab of form.querySelectorAll(".tb-ck-st .st")) {
        const ok = lab.dataset.fits.split(" ").includes(k), inp = lab.querySelector("input");
        lab.classList.toggle("off", !ok);
        if (!ok && inp.checked) inp.checked = false;
      }
      if (!form.querySelector('[name="weapon"]:checked')) form.querySelector('.tb-ck-st .st:not(.off):not(.empty) input')?.click();
      const p = prev[val("weapon")]?.[k] ?? { fox: 0, imp: 0 };
      const ocBox = form.querySelector('[name="overcharge"]');
      if (ocBox) { ocBox.disabled = !val("weapon"); if (ocBox.disabled) ocBox.checked = false; }
      const mod = (Number(form.querySelector('[name="mod"]')?.value) || 0) + (ocBox?.checked ? 2 : 0);
      const fox = p.fox + mod, imp = p.imp + mod;
      const cur = stations.find(x => x.id === val("weapon"));
      const need = occ ? occ[Number(val("sys"))] - gpbOcc(cur) : dcs[val("weapon")] ?? dc;
      const set = (sel, v) => { const n = form.querySelector(sel); if (n) n.textContent = v; };
      set("[data-ck-fox]", fox); set("[data-ck-imp]", sign(imp)); set("[data-ck-skill]", k === "air" ? "Aim" : "Deploy");
      set("[data-ck-occ]", need ?? "—"); set("[data-ck-def]", need ?? "—");
      // черта выбранной станции; EMRG и ESM — без броска «FOX 2», своё окно
      const tr = form.querySelector("[data-ck-trait]");
      if (tr) { tr.hidden = !cur?.trait; tr.innerHTML = cur?.trait ? `<b>${esc(cur.trait.name)}.</b> ${esc(cur.trait.text)}` : ""; }
      const fb = form.querySelector('[data-pick="fox"]');
      if (fb && !struck) fb.disabled = !!cur?.own;
      // противокорабельная ракета — только без броска
      const ib = form.querySelector('[data-pick="improved"]');
      if (ib) ib.disabled = !!cur?.asm || !!cur?.crs;
      const lamp = form.querySelector("[data-ck-foxhit]");
      const all = fox + (occ ? 0 : inAir);
      if (lamp) { lamp.className = `tb-ck-hit ${need === null || need === undefined ? "" : all >= need ? "ok" : "bad"}`; lamp.title = need === null || need === undefined ? "" : all >= need ? `Сейчас хватает до цели${inAir && fox < need ? ` вместе с ракетами в воздухе (+${inAir})` : ""}` : `Сейчас не хватает ${need - all}${inAir ? ` даже с ракетами в воздухе (+${inAir})` : ""}`; }
      const sel = form.querySelector('[name="weapon"]:checked')?.closest(".st");
      form.querySelectorAll(".tb-ck-st .st").forEach(n => n.classList.toggle("aimed", n === sel));
    };
    form.addEventListener("change", upd);
    form.addEventListener("input", upd);
    root.querySelectorAll(".tb-aim [data-aim-sys]").forEach(n => n.addEventListener("click", () => setTimeout(upd, 0)));
    root.querySelectorAll(".tb-aim-spot").forEach(n => n.addEventListener("pointerup", () => setTimeout(upd, 0)));
    upd();
  };
  const marks = targetMarks(t?.token ? [{ token: t.token, label: "" }] : []);
  return cockpitDialog(`Fox Two! · ${actor.token?.name ?? actor.name}`, content, { render, width: t?.kind === "ship" ? 560 : 460 })
    .finally(() => marks.destroy());
}

/** «Форсированный выстрел», если он ещё не использован в этом вылете. */
const practicedOvercharge = actor => actor.items.find(i => i.type === "trigger" && i.system.key === "overcharge" && !i.system.used) ?? null;

/**
 * Пульт пушки в стиле HUD: цели в зоне досягаемости плитками (DEF и шанс попасть), станции «бортовая пушка / контейнеры»,
 * схема корабля и кнопка GUNS. Окна нет, если выбирать нечего: одна цель, без контейнеров, корабля и «Отточенного мастерства».
 * Ураган берётся из погоды, «За мной!» — если предложено. Возвращает { target, pod, sys_i, practiced, follow, storm, mod } или null.
 */
function gunPanel(actor, { list, pre, podItems, sys, pod = "" }) {
  const s = actor.system, wx = weatherAt(actor);
  const fo = followOffer(actor, "strafe"), pr = !!practicedReady(actor);
  const targets = list ?? (pre ? [pre] : []);
  const auto = { target: list ? String(Math.max(0, list.indexOf(pre))) : "p", pod, storm: !!wx.comp2, follow: !!fo, practiced: false, mod: 0 };
  if (targets.length <= 1 && !podItems.length && !targets.some(x => x.kind === "ship") && !pr) return Promise.resolve(auto);
  const speed = actor.type === "npc" && s.kind !== "air" ? 0 : (s.speed ?? 0);
  const own = actor.type === "npc" && s.kind === "ground" ? s.ground.strafe : actor.type === "npc" && s.kind === "ship" && sys ? sysStrafe(actor, sys) : null;
  const base = (own ?? skillSum(actor, "strafe")) - speed;
  const gun0 = actor.type === "npc" && s.kind === "ground" ? s.ground.gun ?? 0 : sys ? sys.gun ?? 0 : s.gun ?? 0;
  // станции: бортовая пушка (с MGP: +1 и урон уже +3 в Gun DMG) и подвесное (PLSL +1 и урон 6, НУР — урон залпа)
  const mgp = !sys && !!s.mgp;
  const stations = [{ id: "", code: mgp ? "GUN+MGP" : "GUN", cnt: "∞", add: mgp ? 1 : 0, dmg: gun0 },
    ...podItems.map(w => ({ id: w.id, code: w.name.split(" · ")[0], cnt: w.system.unlimited ? "∞" : String(w.system.ammo.value ?? 0).padStart(2, "0"),
      add: w.system.key === "PLSL" ? 1 : 0, dmg: w.system.key === "PLSL" ? 6 : w.system.key === "RCL" ? Number(w.system.dmg) || 5 : gun0 }))];
  // станция по умолчанию: выбранная на HUD, иначе лазер (он заменяет пушку), иначе пушка
  const pick = stations.find(x => x.id && x.id === pod)?.id ?? podItems.find(w => w.system.key === "PLSL")?.id ?? "";
  const tg = targets.map((x, i) => ({ x, key: list ? String(i) : "p",
    def: x.defense === null || x.defense === undefined ? null : x.defense + nemesisDefense(actor, x.actor) + triggerDefense(actor, x.actor),
    add: sum(triggerAttack(actor, x.actor, { rolled: true, skill: "strafe", guns: true }).parts) + sum(nemesisAttack(actor, x.actor, { rolled: true, skill: "strafe" }).parts) + sum([surprise(actor, x)])
      + (casRun(actor, x) ? speed : 0) }));
  const first = tg.find(g => g.x === pre) ?? tg[0];
  const chance = (need, b) => `${Math.max(0, Math.min(10, 11 - (need - b))) * 10}%`;
  // несколько целей: номер плитки совпадает с номером метки на карте (одинаковые машины иначе не различить)
  const many = tg.length > 1;
  const hpOf = x => { const h = x.actor?.system?.hp; return h && h.max ? ` · HP ${h.value}/${h.max}` : ""; };
  const tile = (g, i) => `<label class="st tg ${g === first ? "aimed" : ""}" data-tg="${i}" title="${esc(g.x.name)}${g.x.dist ? " · соседняя зона" : ""}${hpOf(g.x)}${many ? " · номер на карте " + (i + 1) : ""}">
      <input type="radio" name="target" value="${g.key}" ${g === first ? "checked" : ""}><i class="st-led"></i><span class="st-name">${many ? `<em class="st-num">${i + 1}</em>` : ""}${g.x.priority ? "★ " : ""}${esc(g.x.name)}</span>
      <span class="st-cnt">${g.def !== null ? `DEF ${g.def}` : "OCC"}${g.x.dist ? " · ADJ" : ""}</span>${g.def !== null ? `<b class="st-key" data-ck-pk="${g.key}"></b>` : ""}</label>`;
  const station = st => `<label class="st ${st.id === pick ? "aimed" : ""}" title="урон ${st.dmg}">
      <input type="radio" name="pod" value="${st.id}" ${st.id === pick ? "checked" : ""}><i class="st-led"></i><span class="st-name">${esc(st.code)}</span><span class="st-cnt">${esc(st.cnt)}</span><b class="st-key">DMG ${st.dmg}</b></label>`;
  const schemes = tg.filter(g => g.x.kind === "ship").map(g => schematicHtml(g.x, { name: `sys_${g.key}`, key: g.key, hidden: g !== first })).join("");
  const toggles = [
    fo ? `<label title="d10 = ${fo.d10}, d4 = ${fo.d4}"><input type="checkbox" name="follow" checked><span>ЗА МНОЙ · ${esc(fo.name)}</span></label>` : "",
    pr ? `<label title="Раз за вылет: d10 = 10 и d4 = 4 без броска, проверка хода не тратится"><input type="checkbox" name="practiced"><span>МАСТЕРСТВО</span></label>` : "",
    wx.list.length ? `<label title="${wx.list.map(d => esc(d.name)).join(", ")}"><input type="checkbox" name="storm" ${wx.comp2 ? "checked" : ""}><span>УРАГАН 1–2</span></label>` : ""].join("");
  const content = `
    <div class="tb-ck-stores"><small>ЦЕЛЬ${many && canvas?.ready ? ` <button type="button" class="tb-ck-mapick" data-ck-mapick title="Щёлкнуть по цели на карте"><i class="fas fa-crosshairs"></i> НА КАРТЕ</button>` : ""}</small><div class="tb-ck-st">${tg.length ? tg.map(tile).join("") : `<span class="tb-ck-def muted">цель не выбрана: итог без сравнения</span>`}</div></div>
    ${schemes}
    ${stations.length > 1 ? `<div class="tb-ck-stores"><small>STORES</small><div class="tb-ck-st">${stations.map(station).join("")}</div></div>` : ""}
    ${toggles ? `<div class="tb-ck-seg">${toggles}</div>` : ""}
    <div class="tb-ck-fire one">
      <button type="button" class="tb-ck-big fox" data-pick="fire"><b>GUNS</b><small>d10 <span data-ck-imp>${sign(base + (first?.add ?? 0))}</span> · DMG <span data-ck-dmg>${gun0}</span></small></button>
    </div>`;
  const render = root => {
    const form = root.querySelector("form");
    const val = n => form.querySelector(`[name="${n}"]:checked`)?.value ?? "";
    const upd = () => {
      const st = stations.find(x => x.id === val("pod")) ?? stations[0];
      const g = tg.find(x => x.key === val("target")) ?? first;
      for (const t of tg) { const n = form.querySelector(`[data-ck-pk="${t.key}"]`); if (n && t.def !== null) n.textContent = chance(t.def, base + st.add + t.add); }
      const set = (sel, v) => { const n = form.querySelector(sel); if (n) n.textContent = v; };
      set("[data-ck-imp]", sign(base + st.add + (g?.add ?? 0))); set("[data-ck-dmg]", st.dmg);
      form.querySelectorAll(".tb-ck-st .st").forEach(n => n.classList.toggle("aimed", !!n.querySelector("input:checked")));
      root.querySelectorAll(".tb-aim").forEach(n => { n.hidden = n.dataset.aimKey !== g?.key; });
    };
    bindSchematic(root);
    marks = targetMarks(tg.map((g, i) => ({ token: g.x.token, label: many ? i + 1 : "" })));
    const selIdx = () => Math.max(0, tg.findIndex(x => x.key === val("target")));
    form.addEventListener("change", () => { upd(); marks.select(selIdx()); });
    form.querySelectorAll("[data-tg]").forEach(n => {
      n.addEventListener("mouseenter", () => marks.hover(Number(n.dataset.tg)));
      n.addEventListener("mouseleave", () => marks.hover(null));
    });
    root.querySelector("[data-ck-mapick]")?.addEventListener("click", async ev => {
      ev.preventDefault();
      const tok = await pickTargetToken(actor, { title: "Guns: цель на карте", hint: "Щёлкните по одной из отмеченных целей." });
      if (!tok) return;
      const i = tg.findIndex(g => g.x.token === tok || g.x.token?.id === tok.id);
      if (i < 0) return ui.notifications.warn(`«${tok.name}» не в досягаемости пушки: выберите одну из отмеченных целей.`);
      const inp = form.querySelector(`[name="target"][value="${tg[i].key}"]`);
      if (inp) { inp.checked = true; inp.dispatchEvent(new Event("change", { bubbles: true })); }
    });
    upd();
    marks.select(selIdx());
  };
  let marks = null;
  return cockpitDialog(`Guns, Guns, Guns! · ${actor.token?.name ?? actor.name}`, content, { render, width: schemes ? 560 : 460 })
    .finally(() => marks?.destroy())
    .then(d => d ? { ...auto, ...d, storm: !!d.storm, follow: !!d.follow, practiced: !!d.practiced, target: d.target ?? auto.target, pod: d.pod ?? "" } : null);
}

/** Fox Two!: ракета или спецоружие. Без броска: AA/AG + мод оружия − Speed. Improved: d10 + Aim/Deploy + мод − Speed. */
export async function fireMissile(actor, { weapon = null, preMove = "", useMark = false } = {}) {
  const s = actor.system;
  // станция EMRG или ESM на HUD: сразу своё окно, без пульта Fox Two!
  const direct = weapon ? actor.items.get(weapon) : null;
  if (isOwnFire(direct)) return fireOwn(actor, direct);
  // цель — захват этой машины; метка T (общая на все машины ведущего) — только без захвата или по выбору на пульте
  const locked = lockedTarget(actor), marked = currentTarget();
  const other = locked && marked && marked.uuid !== locked.uuid ? marked : null;
  const t = useMark && other ? other : locked ?? marked;
  const src = { from: t === locked ? "lock" : t ? "mark" : "", alt: useMark && other ? locked : other };
  if (t && !canFireAt(actor, t.actor)) return ui.notifications.warn(`Fox Two!: «${t.name}» на вашей стороне.`);
  // цель известна: в списке только то, что бьёт по её виду, и вид цели не меняется
  const tk = t ? targetKind(t) : null;
  const opts = weaponOptions(actor, true, tk);
  const own = sysOff(s, "sw") ? [] : actor.items.filter(i => i.type === "weapon" && isOwnFire(i));
  if (!opts.length && !own.length) return ui.notifications.warn(tk
    ? `Fox Two!: у «${actor.name}» нечем бить по ${tk === "air" ? "воздушной" : "наземной или морской"} цели «${t.name}».`
    : "Ракет нет: система ракет сломана, а спецоружия не осталось.");
  const data = await foxPanel(actor, t, tk, { preMove, src });
  if (!data) return;
  if (data.pick === "swap") return fireMissile(actor, { weapon, preMove, useMark: !useMark });
  data.improved = data.pick === "improved";
  if (data.practiced) data.improved = true;   // максимум на кубиках бывает только у действия с броском
  if (!data.improved && struckBy(actor)) {
    data.improved = true;
    ui.notifications.info("После удара молнии ракета только с броском: пуск идёт как Improved Fox Two!.");
  }
  const air = data.tkind === "air";
  // противокорабельная ракета: своя станция, без броска
  const asm = data.weapon === ASM.id;
  if (asm) {
    if (!t || !seaTarget(t)) return ui.notifications.warn("Противокорабельная ракета бьёт только по морской цели: выберите корабль.");
    data.improved = false;
  }
  const crs = data.weapon === CRS.id;
  if (crs) {
    if (!t || !landTarget(t)) return ui.notifications.warn("Крылатые ракеты бьют только по наземной цели: выберите её.");
    data.improved = false;
  }
  // «Универсал» многоцелевой машины: Improved Fox Two! с большим из Aim и Deploy
  const skill = data.improved ? foxSkill(actor, air) : air ? "aim" : "deploy";
  const w = data.weapon && !asm && !crs ? actor.items.get(data.weapon) : null;
  const ws = w?.system;
  if (isOwnFire(w)) return fireOwn(actor, w, data);
  // фирменные приёмы при пуске
  const ghostMove = !!data.ghost && moveReady(actor, "ghost");
  // «Со стороны солнца» эскадрильи дуэлянтов: в этот раунд ракеты без предупреждения, как «Удар из ниоткуда»
  const sun = !ghostMove && sunOn(actor);
  const ghost = ghostMove || sun;
  const shkval = !!data.salvo && moveReady(actor, "salvo");
  if (shkval && w && !ws.unlimited && (ws.ammo.value ?? 0) < 2) return ui.notifications.warn(`«Ракетный шквал»: у ${w.name} меньше 2 Ammo.`);
  // противовоздушное спецоружие не бьёт по земле, ударное не бьёт по воздуху; стандартной ракеты у NPC без Air-Air / Air-Gnd нет
  if (w && !weaponFits(w, air ? "air" : "ground"))
    return ui.notifications.warn(`${w.name} бьёт только по ${ws.target === "air" ? "воздушным" : "наземным и морским"} целям.`);
  if (!w && !asm && !crs && !stdMissile(actor, air ? "air" : "ground"))
    return ui.notifications.warn(`У «${actor.name}» нет стандартной ракеты против ${air ? "воздушных" : "наземных и морских"} целей.`);
  if (data.improved && blocked(actor, skill)) return;
  if (data.improved && !data.practiced && !allowRoll(actor)) return;
  if (["UGB", "GPB"].includes(ws?.key) && inNarrowTunnel(tokenOf(actor), actor)
    && !(await confirmReach(["Свободнопадающие бомбы под землёй работают только в Зале."], "Fox Two!"))) return;
  const wx = weatherAt(actor);
  const aim = t?.kind === "ship" ? aimAt(actor, t, Number(data.sys), { missile: true }) : null;
  const nem = nemesisAttack(actor, t?.actor, { rolled: !!data.improved, skill });
  const ct = triggerAttack(actor, t?.actor, { rolled: !!data.improved, skill });
  const oc = data.overcharge && w ? practicedOvercharge(actor) : null;
  const ugb = ws?.key === "UGB";
  if (t) {
    // UGB без захвата: сброс по наземной или морской цели на своём участке, с Низкой или Средней
    // «Прицельный комплекс» бомбардировщика: с Высокой по земле ракетами и GPB (strike), но не UGB
    const { problems } = reachProblems(actor, t, ugb ? 0 : asm || crs ? TB.range.operation : ws?.reach ?? TB.range.missile, { strike: !ugb });
    if (ugb && !["low", "med"].includes(altOf(tokenOf(actor), actor))) problems.unshift("UGB сбрасывают только с Низкой или Средней высоты.");
    if (!ugb && !asm && !crs && s.lockUuid !== t.uuid) problems.unshift(`Нет захвата цели «${t.name}»: сначала Lock On!`);
    if (aim) problems.push(...aim.problems);
    problems.push(...nem.problems, ...ct.problems);
    if (!(await confirmReach(problems, "Fox Two!"))) return;
  }
  // залп: остальные захваченные цели, если основной захват тот же и их захват не сорван
  const salvo = t && isSalvo(w) ? salvoTargets(actor, w, t) : null;

  const speed = s.speed ?? 0;
  const parts = [];
  let dice = { d10: null, d4: null, rolls: [] };
  if (data.improved) {
    dice = await rollDice(actor, data.practiced);
    if (!dice) return;
    parts.push(...skillParts(actor, skill));
    const m = air ? ws?.aim : ws?.dep;
    if (m) parts.push([`мод ${w.name}`, m]);
    parts.push(...await takeNext(actor));
  } else {
    let base = air ? s.aa : s.ag;
    if (actor.type === "npc" && actor.system.kind === "ground") base = (air ? s.ground.ga : s.ground.gg) ?? 0;
    parts.push([air ? "Air-Air" : "Air-Gnd", base ?? 0]);
    const m = air ? ws?.aa : ws?.ag;
    if (m) parts.push([`мод ${w.name}`, m]);
    parts.push(...weatherParts(wx, air ? "aa" : "ag"));
  }
  const sead = air ? null : seadPart(actor, t);
  if (sead) parts.push(sead);
  const cue = awacsCue(actor);
  if (cue) parts.push(cue);
  // Targeting Booster ганшипа рядом: +1 к A-A и A-G, а с броском к Aim и Deploy
  const bst = boosterOn(actor);
  if (bst) parts.push([`Targeting Booster: ${bst}`, 1]);
  const lift = t && air ? stratLift(actor, t) : null;
  if (lift) parts.push(lift);
  const sneak = surprise(actor, t);
  if (sneak) parts.push(sneak);
  if (aim) parts.push(...aim.parts);
  parts.push(...nem.parts, ...ct.parts);
  if (oc) parts.push([oc.name, 2]);
  if (speed) parts.push(["Speed", -speed]);
  if (data.mod) parts.push(["мод.", data.mod]);

  const hard = !w && !asm && !crs && hardened(t);
  const dmg0 = (asm ? ASM.dmg : crs ? CRS.dmg : w ? (parseInt(ws.dmg) || 0) : TB.missileDamage) + (oc ? 2 : 0) + ct.dmg;
  const dmg = hard ? Math.floor(dmg0 / 2) : dmg0;
  const notes = weatherNotes(wx).filter(n => !data.improved || !/A-A/.test(n));
  if (hard) notes.push(HARD_NOTE);
  // черта спецоружия вместо старого текста эффекта
  if (ws?.trait) notes.push(`<b>${esc(ws.trait.name)}.</b> ${esc(ws.trait.text)}`);
  if (asm) notes.push("<b>Противокорабельная ракета.</b> По морской цели в любой точке зоны операции, без захвата, урон 12.");
  if (crs) notes.push("<b>Крылатые ракеты.</b> По наземной цели в любой точке зоны операции, без захвата, урон 7.");
  if (data.improved && skill !== (air ? "aim" : "deploy")) notes.push(`<b>Универсал.</b> Improved Fox Two! с ${esc(TB.skills[skill].en)}: он больше.`);
  if (ghostMove) notes.push(`<b>${esc(TB.planeMoves.ghost.name)}.</b> Цель не получает предупреждения о ракете и не может сделать Break! против неё.`);
  if (sun) notes.push(`<b>${esc(TB.squadTactics.sun.name)}.</b> Цель не получает предупреждения о ракете и не может сделать Break! против неё.`);
  if (shkval) notes.push(`<b>${esc(TB.planeMoves.salvo.name)}.</b> Две ракеты по цели: вторая даёт +1 к атаке или свой урон.`);
  else if (ws?.fx) notes.push(esc(ws.fx));
  const close = ws?.key === "QAAM" && !!t && closeTo(actor, t);
  if (close) notes.push(`QAAM в своей зоне: Break! «${esc(t.name)}» против неё не работает.`);
  if (ws?.key === "GPB" && t?.kind === "ship") notes.push("GPB: Occlusion системы −2.");
  if (salvo) {
    if (salvo.list.length) notes.push(`Залп: ещё ${salvo.list.map(x => `${esc(x.name)} (${x.dc !== null ? `защита ${x.dc}` : x.sysName ? `Occlusion «${esc(x.sysName)}» ${x.occ}` : "корабль"})`).join(", ")}. Бросок один, каждая ракета против своей цели.`);
    if (salvo.lost.length) notes.push(`Захват сорван, ракета не пошла: ${salvo.lost.map(esc).join(", ")}.`);
  }
  const hv = ws?.key === "HVAA";
  // залп бьёт в конце раунда по всем целям сразу
  const tBroken = !salvo?.list.length && sysOff(t?.actor.system, "ma");
  const key = combatKey();
  const atTurn = (hv || tBroken) && !!key;
  notes.push(atTurn ? `Ракета ударит в начале хода цели${tBroken ? " (у неё сломан MAWS)" : ""}: посчитается сама.`
    : hv || tBroken ? "Попадает в начале хода цели."
    : key ? "Ракета долетит в конце раунда: залп посчитается сам, с защитой цели на тот момент."
      : "Ракета долетает в конце раунда. Каждая следующая ракета по той же цели: +1 к атаке самой точной или её урон в сумму.");
  if (t?.kind === "ship" && !aim) notes.push("Корабль: сравните итог с Occlusion выбранной системы.");
  if (t && wallBonus(t.token, t.actor)) notes.push(ws?.key === "GPB" ? "Цель в туннеле, но GPB укрытие не мешает." : "Цель в туннеле: стены сбивают ракеты, защита +2.");
  const nemDef = t ? nemesisDefense(actor, t.actor) : 0;
  if (nemDef) notes.push(`«Опять ты!»: защита ${esc(t.name)} против Немезиды +${nemDef}.`);
  notes.push(...nem.notes.map(esc), ...ct.notes.map(esc));
  const ctDef = t ? triggerDefense(actor, t.actor) : 0;
  if (ctDef) notes.push(ctDef < 0 ? `«Уязвимость»: защита ${esc(t.name)} ${ctDef}.` : `Поединок: защита ${esc(t.name)} +${ctDef}.`);
  if (oc) notes.push(`«${esc(oc.name)}»: +2 к атаке и урону. ${esc(w.name)} больше не работает до конца вылета.`);

  if (w && !ws.unlimited) await w.update({ "system.ammo.value": Math.max(0, (ws.ammo.value ?? 0) - (shkval ? 2 : 1)) });
  if (ghostMove || shkval) await actor.setFlag(SYSTEM_ID, "sortie", { ...(actor.getFlag(SYSTEM_ID, "sortie") ?? {}), move: sortieMark(actor) });
  if (oc) { await oc.update({ "system.used": true }); await w.setFlag(SYSTEM_ID, "off", true); }

  const card = {
    type: "attack", attack: true, label: `Fox Two! ${w ? w.name : "стандартная ракета"}`, rolled: !!data.improved,
    d10: dice.d10, d4: dice.d4, parts, strain: 0, ...shipDc(t, aim, defVs(actor, t, w, ghost), ws?.key === "GPB" ? 2 : 0),
    wkey: asm ? ASM.id : crs ? CRS.id : ws?.key ?? "", close, ghost, shotKey: key, salvo: salvo?.list.length ? salvo.list.map(({ uuid, name, dc, sys }) => ({ uuid, name, dc, sys })) : null,
    strainable: !!data.improved && canStrain(actor), forceHit: nem.forceHit || ct.forceHit,
    practiced: !!dice.practiced, followOf: dice.follow ?? "", dmg, delayed: atTurn || !(hv || tBroken), atTurn, combatKey: hv || tBroken ? (atTurn ? key : "") : key,
    targetUuid: t?.uuid ?? null, targetName: t?.name ?? "", notes, maws: !ghost && mawsOn(t), tkind: air ? "air" : "ground", bomb: ["UGB", "GPB"].includes(ws?.key),
    ...thresholds(actor, skill, data.storm)
  };
  const msg = await postCard(actor, card, dice.rolls);
  // «Ракетный шквал»: вторая ракета тем же пуском — своя карточка, в залпе она даёт +1 самой точной или свой урон
  if (shkval) await postCard(actor, { ...card, label: `${card.label} · вторая ракета`, strainable: false, perkOn: 99, compOn: 0, notes: [`<b>${esc(TB.planeMoves.salvo.name)}.</b> Вторая ракета того же пуска.`] });
  await nem.take();
  await ct.take();
  return msg;
}

/**
 * Цели залпа (4AAM, XLAA, XAGM) кроме основной: захваченные тем же Lock On, пока основной захват тот же.
 * Захват каждой срывается отдельно: сбита, ушла со сцены или вне дальности оружия — ракета в неё не идёт.
 * Возвращает { list: [{ uuid, name, dc, sys, sysName, occ }], lost: [имена] }.
 */
function salvoTargets(actor, w, t) {
  const f = actor.getFlag?.(SYSTEM_ID, "salvo"), out = { list: [], lost: [] };
  if (!f?.list?.length || f.list[0].uuid !== actor.system.lockUuid || !f.list.some(x => x.uuid === t.uuid)) return out;
  const kind = targetKind(t), me = tokenOf(actor);
  for (const e of f.list) {
    if (e.uuid === t.uuid) continue;
    const a = resolveActor(e.uuid), tok = tokenOf(a);
    if (!a || !tok || a.statuses?.has(CONFIG.specialStatusEffects.DEFEATED)) { out.lost.push(e.name); continue; }
    const d = describeTarget(a, e.name, tok), dist = zoneDistance(me, tok);
    if (targetKind(d) !== kind || (dist !== null && dist > w.system.reach)) { out.lost.push(e.name); continue; }
    if (d.kind === "ship") {
      const i = defaultSys(a), y = a.system.systems?.[i];
      out.list.push({ uuid: e.uuid, name: e.name, dc: null, sys: y ? i : undefined, sysName: y?.name ?? "", occ: y ? y.occ - weakOf(actor, a, i) : null });
    } else out.list.push({ uuid: e.uuid, name: e.name, dc: defVs(actor, d, w) });
  }
  return out;
}

/** EMRG и ESM: своё окно вместо пуска ракетой. */
async function fireOwn(actor, w, pre = {}) {
  if (sysOff(actor.system, "sw")) return ui.notifications.warn(`Спецоружие ${offWhy(actor.system, "sw")}.`);
  if (!weaponReady(w)) return ui.notifications.warn(`${w.name}: ${w.getFlag?.(SYSTEM_ID, "off") ? "не работает до конца вылета" : "боезапас кончился"}.`);
  if (w.system.target === "util") { const { fireEsm } = await import("../special-weapons.mjs"); return fireEsm(actor, w); }
  return fireRail(actor, w, pre);
}

const DIRS = [[-1, -1, "↖"], [0, -1, "↑"], [1, -1, "↗"], [-1, 0, "←"], null, [1, 0, "→"], [-1, 1, "↙"], [0, 1, "↓"], [1, 1, "↘"]];
/** Итог EMRG против строки линии: по земле и морю Deploy вместо Aim. */
const railTotal = (c, r) => c.total + (r.gnd ? c.depShift ?? 0 : 0);

/**
 * EMRG: без захвата. Линия от самолёта по прямой (сторона или диагональ) до края карты на своей высоте (Низкая — вместе с землёй),
 * d10 + Aim (по земле и морю Deploy) − Speed. Все на линии, свои тоже, с защитой или Occlusion не выше броска сразу получают урон.
 */
async function fireRail(actor, w, pre = {}) {
  const tok = tokenOf(actor);
  if (!tok || !canvas?.ready) return ui.notifications.warn(`${w.name}: нужен самолёт на сцене с сеткой.`);
  const SW = await import("../special-weapons.mjs");
  const lines = SW.railLines(actor, tok);
  if (!lines) return ui.notifications.warn(`${w.name}: на сцене без сетки линию не провести.`);
  const s = actor.system, wx = weatherAt(actor), pr = !!practicedReady(actor), dmg = parseInt(w.system.dmg) || 12;
  const alt = altOf(tok, actor), code = w.name.split(" · ")[0];
  const dir = d => {
    if (!d) return `<div class="tb-rail-me"><b>${esc(code)}</b><small>${esc(TB.altitudes[alt] ?? alt)}</small></div>`;
    const ln = lines[`${d[0]},${d[1]}`];
    return `<button type="button" class="tb-rail-dir" data-pick="${d[0]},${d[1]}" title="${esc(ln.units.map(u => u.name).join(", ") || "на линии никого")}"><b>${d[2]}</b><small>${ln.units.length ? `на линии ${ln.units.length}` : "пусто"}</small></button>`;
  };
  const content = `
    <div class="tb-ck-tgt"><small>ЛИНИЯ</small><b>${esc(TB.altitudes[alt] ?? alt)}${alt === "low" ? " и земля" : ""}</b><span class="tb-ck-def">DMG ${dmg}</span></div>
    <div class="tb-ck-trait"><b>${esc(w.system.trait?.name ?? "Линия")}.</b> ${esc(w.system.trait?.text ?? "")}</div>
    <div class="tb-rail-grid">${DIRS.map(dir).join("")}</div>
    <div class="tb-ck-seg">
      ${pr ? `<label title="Раз за вылет: d10 = 10 и d4 = 4 без броска"><input type="checkbox" name="practiced" ${pre.practiced ? "checked" : ""}><span>МАСТЕРСТВО</span></label>` : ""}
      ${wx.list.length ? `<label><input type="checkbox" name="storm" ${pre.storm ?? wx.comp2 ? "checked" : ""}><span>УРАГАН 1–2</span></label>` : ""}
    </div>`;
  const render = root => root.querySelectorAll(".tb-rail-dir").forEach(b => {
    b.addEventListener("mouseenter", () => SW.showLine(lines[b.dataset.pick].cells));
    b.addEventListener("mouseleave", () => SW.showLine(null));
  });
  const data = await cockpitDialog(`${code} · ${actor.token?.name ?? actor.name}`, content, { width: 420, render });
  SW.showLine(null);
  if (!data) return;
  const ln = lines[data.pick];
  if (!ln) return;
  const air = ln.units.some(u => !u.gnd);
  if (blocked(actor, air || !ln.units.length ? "aim" : "deploy")) return;
  if (!data.practiced && !allowRoll(actor)) return;
  const dice = await rollDice(actor, data.practiced);
  if (!dice) return;
  const aimP = skillParts(actor, "aim"), depP = skillParts(actor, "deploy");
  const parts = [...aimP];
  if (w.system.aim) parts.push([`мод ${w.name}`, w.system.aim]);
  parts.push(...await takeNext(actor));
  if (s.speed) parts.push(["Speed", -s.speed]);
  if (pre.mod) parts.push(["мод.", pre.mod]);
  if (!w.system.unlimited) await w.update({ "system.ammo.value": Math.max(0, (w.system.ammo.value ?? 0) - 1) });
  const arrow = DIRS.find(d => d && `${d[0]},${d[1]}` === data.pick)?.[2] ?? "";
  const card = {
    type: "rail", attack: true, shotKey: combatKey(), label: `${w.name}: линия ${arrow}`, rolled: true, d10: dice.d10, d4: dice.d4, parts, strain: 0, dc: null,
    strainable: canStrain(actor), practiced: !!dice.practiced, dmg, depShift: sum(depP) + (w.system.dep ?? 0) - sum(aimP) - (w.system.aim ?? 0),
    line: ln.units.map(u => ({ uuid: u.uuid, name: u.name, vs: u.vs, gnd: u.gnd, ship: u.ship, sys: u.sys, sysName: u.sysName ?? "" })),
    where: ln.where, end: ln.cells.at(-1) ?? null, notes: [`<b>${esc(w.system.trait?.name ?? "Линия")}.</b> Линия ${arrow} на высоте ${esc(TB.altitudes[alt] ?? alt)}${alt === "low" ? " и по земле" : ""}: ${esc(ln.where || "до края карты")}.`],
    ...thresholds(actor, "aim", data.storm)
  };
  const msg = await postCard(actor, card, dice.rolls);
  await railHit(msg);
  return msg;
}

/** Строки линии EMRG на карточке: кто на линии, итог против его защиты. */
function railRows(c) {
  if (!c.line?.length) return [`<div class="tb-note">${c.word ? "Наземных целей противника там нет." : "На линии никого нет."}</div>`];
  return c.line.map(r => {
    const tot = railTotal(c, r), hit = tot >= r.vs;
    return `<div class="tb-volley-row ${hit ? "hit" : "miss"}"><b>${esc(r.name)}</b>: ${c.word ? esc(c.word) : r.gnd ? "Deploy" : "Aim"} ${tot} против ${r.ship ? `Occlusion «${esc(r.sysName)}»` : r.gnd ? "Occlusion" : "защиты"} ${r.vs} → ${hit ? `<b class="ok">${c.dmg} урона${r.applied ? ", нанесено" : ""}</b>` : `<b class="fail">мимо</b>`}</div>`;
  });
}

/** EMRG бьёт сразу: урон по всем, кого итог достал (и после Strain или переброса — по новым). */
async function railHit(message) {
  const card = foundry.utils.deepClone(message?.getFlag(SYSTEM_ID, "card") ?? {});
  if (card.type !== "rail") return;
  const c = computeCard(card);
  const due = (card.line ?? []).filter(r => !r.applied && railTotal(c, r) >= r.vs);
  if (!due.length) return;
  for (const r of due) r.applied = true;
  if (message.canUserModify(game.user, "update")) await message.update({ content: renderCard(card), [`flags.${SYSTEM_ID}.card`]: card });
  const key = combatKey();
  for (const r of due) {
    const target = resolveActor(r.uuid), by = target && damageUser(target);
    if (!by) continue;
    const hit = { uuid: r.uuid, name: r.name, dmg: card.dmg, source: card.actorName, sourceUuid: card.actorUuid, sys: r.sys, roundKey: key };
    if (by === game.user.id) await hitTarget(hit, key).catch(err => damageFailed(hit, err));
    else game.socket.emit(CHANNEL, { type: "hit", to: by, hit });
  }
}

/** Наземные цели противника не дальше dist участков от стрелка: строки для карточки по площади (как линия EMRG). */
function groundRows(actor, dist, only = null) {
  const me = tokenOf(actor);
  if (!me || !canvas?.ready) return null;
  const rows = [];
  for (const t of only ? [only] : canvas.tokens.placeables) {
    const a = t.actor;
    if (!a || a === actor || a.type !== "npc" || a.system.kind !== "ground" || (t.document.hidden && !game.user.isGM)) continue;
    if (a.statuses?.has(CONFIG.specialStatusEffects.DEFEATED) || !canFireAt(actor, a)) continue;
    const d = zoneDistance(me, t);
    if (d === null || d > dist) continue;
    rows.push({ uuid: a.uuid, name: t.name, vs: describeTarget(a, t.name, t).defense, gnd: true, ship: false, sys: null, sysName: "", hard: hardened({ actor: a }) });
  }
  return rows;
}

/** «Ковровая бомбардировка» бомбардировщика NPC: действием каждая наземная цель противника его участка, A-G − Speed против Occlusion, урон 6 сразу. */
export async function fireCarpet(actor) {
  if (!hasProp(actor, "carpet")) return ui.notifications.warn(`У «${actor.name}» нет ковровой бомбардировки.`);
  const rows = groundRows(actor, 0);
  if (!rows) return ui.notifications.warn("Ковровая бомбардировка: нужен самолёт на сцене с сеткой.");
  const s = actor.system, speed = s.speed ?? 0;
  const parts = [["Air-Gnd", s.ag ?? 0], ...weatherParts(weatherAt(actor), "ag")];
  const cue = awacsCue(actor);
  if (cue) parts.push(cue);
  if (speed) parts.push(["Speed", -speed]);
  const card = {
    type: "rail", attack: true, shotKey: combatKey(), label: "Ковровая бомбардировка", rolled: false, parts, strain: 0, dc: null, dmg: 6, word: "A-G",
    line: rows, notes: ["<b>Ковровая бомбардировка.</b> Вся наземка противника в участке под бомбардировщиком: A-G − Speed против Occlusion, урон 6. Бомбы: «Укреплённый» не спасает."]
  };
  const msg = await postCard(actor, card);
  await railHit(msg);
  return msg;
}

/** «Бортовые орудия» AC-130: наземная цель противника в своём или соседнем участке, d10 + 1 против Occlusion, урон 4 сразу. */
export async function fireGunship(actor) {
  if (!hasProp(actor, "gunship")) return ui.notifications.warn(`У «${actor.name}» нет бортовых орудий.`);
  const tok = await pickTargetToken(actor, { title: "Бортовые орудия", hint: "Наземная цель противника в своём или соседнем участке" });
  if (!tok) return;
  const rows = groundRows(actor, 1, tok);
  if (!rows?.length) return ui.notifications.warn(`Бортовые орудия: «${tok.name}» не наземная цель противника в своём или соседнем участке.`);
  if (!allowRoll(actor)) return;
  const dice = await rollDice(actor, false);
  if (!dice) return;
  const hard = rows[0].hard;
  const card = {
    type: "rail", attack: true, shotKey: combatKey(), label: "Бортовые орудия", rolled: true, d10: dice.d10, d4: dice.d4, parts: [["Бортовые орудия", 1], ...await takeNext(actor)],
    strain: 0, dc: null, dmg: hard ? 2 : 4, word: "d10 + 1", line: rows,
    notes: ["<b>Бортовые орудия.</b> По наземной цели своего или соседнего участка: d10 + 1 против Occlusion, урон 4.", ...(hard ? [HARD_NOTE] : [])],
    ...thresholds(actor, "strafe")
  };
  const msg = await postCard(actor, card, dice.rolls);
  await railHit(msg);
  return msg;
}

/** Guns, Guns, Guns!: d10 + Strafe − Speed против защиты, урон сразу. */
/** Дальность пушки: бортовая — своя зона, контейнер — по своей дальности. */
const gunReach = pod => pod?.system.reach ?? TB.range.guns;
/** Пушки корабля: выбранная система или все целые системы с пушкой. */
const shipGuns = (actor, sys) => actor?.type === "npc" && actor.system.kind === "ship"
  ? (sys ? [sys] : (actor.system.systems ?? []).filter(y => (y.gun ?? 0) > 0 && (y.value ?? 0) > 0)) : [];

/**
 * Цели для пушки: противники и нейтралы (сторона NPC на вкладке «Заметки AWACS»), до которых достаёт хоть одна пушка,
 * без запретов по высоте; приоритетные цели первыми. Возвращает { list, why }: why — почему отсеяны ближние токены.
 * list === null — проверить нельзя (у стрелка нет токена на сцене с сеткой).
 */
function gunTargets(actor, pods, sys) {
  const me = tokenOf(actor);
  if (!me || !canvas?.ready || canvas.grid.type === CONST.GRID_TYPES.GRIDLESS) return { list: null, why: [] };
  const reach = Math.max(TB.range.guns, ...pods.map(gunReach), ...shipGuns(actor, sys).map(sysGunReach));
  const list = [], why = [];
  // приоритетные цели — задача для игроков и их союзников
  const ours = actor.type === "pilot" || actor.system.side === "ally";
  const vs = gunVs(actor, sys);
  for (const t of canvas.tokens.placeables) {
    if (t === me || !["pilot", "npc"].includes(t.actor?.type) || t.actor === actor || (t.document.hidden && !game.user.isGM)) continue;
    const near = (zoneDistance(me, t) ?? 99) <= reach + 1;
    if (t.actor.statuses?.has(CONFIG.specialStatusEffects.DEFEATED)) { if (near) why.push(`${t.name}: сбит`); continue; }
    if (!canFireAt(actor, t.actor)) { if (near) why.push(`${t.name}: своя сторона`); continue; }
    const d = describeTarget(t.actor, t.name, t);
    // зенитные орудия наземки и кораблей бьют только по воздуху
    if (vs === "air" && !isAirTarget(d)) { if (near) why.push(`${t.name}: зенитное орудие не бьёт по земле и морю`); continue; }
    if (vs === "ground" && isAirTarget(d)) { if (near) why.push(`${t.name}: по воздуху это орудие не стреляет`); continue; }
    const r = reachProblems(actor, d, reach);
    if (r.problems.length) { if (near) why.push(`${t.name}: ${r.problems[0]}`); continue; }
    // «Кормовая пушка»: только по тому, кто держит эту машину на захвате, в её зоне
    if (hasProp(actor, "tailgun") && (r.dist !== 0 || !tailChaser(actor, t))) { if (near) why.push(`${t.name}: кормовая пушка бьёт только по преследователю в своей зоне`); continue; }
    list.push({ ...d, dist: r.dist, priority: ours && !!t.actor.system.priority });
  }
  list.sort((x, y) => (y.priority - x.priority) || (x.dist ?? 0) - (y.dist ?? 0) || x.name.localeCompare(y.name));
  return { list, why, reach };
}

/** Guns, Guns, Guns!: Strafe − Speed против защиты цели в своей зоне, без захвата. Попадание наносит урон сразу. */
export async function fireGuns(actor, { system: sysIndex, pod: podPref = "" } = {}) {
  const s = actor.system;
  const prefItem = podPref ? actor.items.get(podPref) : null;
  if (prefItem && !weaponReady(prefItem)) return ui.notifications.warn(`${prefItem.name}: ${prefItem.getFlag(SYSTEM_ID, "off") ? "выведено из строя до конца вылета" : "боезапас кончился"}.`);
  if (sysOff(s, "gu") && (!prefItem || prefItem.system.key === "MGP")) return ui.notifications.warn(`Пушка ${offWhy(s, "gu")}.`);
  if (blocked(actor, "strafe")) return;
  // MGP не отдельная станция: он висит на пушке всегда (Gun DMG уже +3, в броске +1)
  const podItems = sysOff(s, "sw") ? [] : actor.items.filter(i => i.type === "weapon" && isGunPod(i) && i.system.key !== "MGP" && weaponReady(i));
  // цель: противник в зоне досягаемости; если их несколько или есть что выбрать, выбор на пульте
  const sys = s.kind === "ship" && sysIndex !== undefined ? gunSys(actor, s.systems[sysIndex]) : null;
  const { list, why, reach } = gunTargets(actor, podItems, sys);
  if (list && !list.length) return ui.notifications.warn(`Guns, Guns, Guns!: ${reach ? "в своей и соседних зонах" : "в своей зоне"} нет противника.${why.length ? ` Рядом: ${why.join("; ")}.` : ""}`, { permanent: why.length > 0 });
  const picked = currentTarget();
  const pre = list ? (list.find(x => x.uuid === picked?.uuid && x.token === picked?.token) ?? list[0]) : picked ?? lockedTarget(actor);
  const data = await gunPanel(actor, { list, pre, podItems, sys, pod: podItems.some(w => w.id === podPref) ? podPref : "" });
  if (!data) return;
  const podItem = data.pod ? actor.items.get(data.pod) : null;
  if (!podItem && sysOff(s, "gu")) return ui.notifications.warn(`Пушка ${offWhy(s, "gu")}: стрелять можно только подвесным.`);
  const tIdx = list ? (list.length > 1 ? Number(data.target) || 0 : list.indexOf(pre)) : "p";
  const t = list ? (list.length > 1 ? list[tIdx] : pre) : pre;
  const aim = t?.kind === "ship" && data[`sys_${tIdx}`] !== undefined ? aimAt(actor, t, Number(data[`sys_${tIdx}`])) : null;
  if (t) {
    const { problems } = reachProblems(actor, t, Math.max(gunReach(podItem), ...shipGuns(actor, sys).map(sysGunReach)));
    if (podItem?.system.key === "PLSL" && weatherAt(actor).list.some(d => d.id === "clouds")) problems.push("Облачность: импульсный лазер не бьёт.");
    const vs = gunVs(actor, sys);
    if (vs === "air" && !isAirTarget(t)) problems.unshift("зенитное орудие не бьёт по земле и морю.");
    if (vs === "ground" && isAirTarget(t)) problems.unshift("по воздуху это орудие не стреляет.");
    if (podItem?.system.key === "RCL" && isAirTarget(t)) problems.unshift("НУР бьют только по земле и морю.");
    if (hasProp(actor, "tailgun") && t.token && (zoneDistance(tokenOf(actor), t.token) !== 0 || !tailChaser(actor, t.token))) problems.unshift("кормовая пушка бьёт только по преследователю в своей зоне.");
    if (problems.length) return ui.notifications.warn(`Guns, Guns, Guns!: ${problems[0]}`);
    if (aim && !(await confirmReach(aim.problems, "Guns, Guns, Guns!"))) return;
    const quiet = isAirTarget(t) ? quietAA(actor) : null;
    if (quiet && !(await confirmReach([quiet], "Guns, Guns, Guns!"))) return;
    if (!(await confirmReach([...nemesisAttack(actor, t.actor).problems, ...triggerAttack(actor, t.actor).problems], "Guns, Guns, Guns!"))) return;
    if (t.token) selectTarget(t.token);
  }
  // луч супероружия бьёт раз в раунд сам по себе: это не бросок хода
  const dice = await rollDice(actor, data.practiced, { follow: data.follow ? "strafe" : null, turnRoll: !sys?.beam });
  if (!dice) return;
  let strafe = null;
  let gun = s.gun ?? 0;
  let label = "Guns, Guns, Guns!";
  if (actor.type === "npc" && s.kind === "ground") { strafe = s.ground.strafe; gun = s.ground.gun ?? 0; }
  if (actor.type === "npc" && s.kind === "ship" && sysIndex !== undefined) {
    const y = sys;
    gun = y?.gun ?? 0; label = `${y?.beam ? "Луч" : "Огонь"}: ${y?.name}`;
    strafe = sysStrafe(actor, y);
  }
  const parts = strafe === null ? skillParts(actor, "strafe", "Пушка") : [[sys?.beam ? "Луч" : "Пушка", strafe]];
  const pod = podItem;
  if (!pod && !sys && s.mgp) { parts.push(["MGP", 1]); label += " (MGP)"; }
  if (pod?.system.key === "PLSL") { parts.push(["PLSL", 1]); gun = 6; label = "Импульсный лазер"; }
  if (pod?.system.key === "RCL") { gun = Number(pod.system.dmg) || 5; label = `Залп НУР (${pod.name})`; }
  if (pod && !pod.system.unlimited) await pod.update({ "system.ammo.value": Math.max(0, (pod.system.ammo.value ?? 0) - 1) });
  parts.push(...await takeNext(actor));
  const sneak = surprise(actor, t);
  if (sneak) parts.push(sneak);
  const nem = nemesisAttack(actor, t?.actor, { rolled: true, skill: "strafe" });
  const ct = triggerAttack(actor, t?.actor, { rolled: true, skill: "strafe", guns: !pod || pod.system.key !== "RCL" });
  parts.push(...nem.parts, ...ct.parts);
  const nemDef = t ? nemesisDefense(actor, t.actor) : 0;
  const ctDef = t ? triggerDefense(actor, t.actor) : 0;
  // «Штурмовой заход» штурмовика: на Низкой Guns и RCL по земле и морю своей зоны без вычета Speed
  const cas = casRun(actor, t);
  const speed = actor.type === "npc" && s.kind !== "air" ? 0 : (s.speed ?? 0);
  if (speed && !cas) parts.push(["Speed", -speed]);
  if (speed && cas) parts.push(["Штурмовой заход: Speed не вычитается", 0]);
  if (data.mod) parts.push(["мод.", data.mod]);
  const card = {
    type: "attack", attack: true, label, rolled: true, d10: dice.d10, d4: dice.d4, parts, strain: 0, shotKey: combatKey(),
    ...shipDc(t, aim, t && t.kind !== "ship" ? t.defense + nemDef + ctDef : null),
    strainable: canStrain(actor), practiced: !!dice.practiced, followOf: dice.follow ?? "", forceHit: nem.forceHit || ct.forceHit,
    dmg: hardened(t) ? Math.floor((gun + ct.dmg) / 2) : gun + ct.dmg, delayed: false, instant: true, targetUuid: t?.uuid ?? null, targetName: t?.name ?? "",
    notes: [...(hardened(t) ? [HARD_NOTE] : []), ...(t?.actor.system.breakEv != null && t.kind === "air" ? [`У цели Break!: защита ${t.defense}.`] : []),
      ...(pod?.system.key === "PLSL" ? ["Бьёт в своей и соседних зонах. Облака блокируют лазер."] : []),
      ...(nemDef ? [`«Опять ты!»: защита ${esc(t.name)} против Немезиды +${nemDef}.`] : []), ...nem.notes.map(esc), ...ct.notes.map(esc),
      ...(ctDef ? [ctDef < 0 ? `«Уязвимость»: защита ${esc(t.name)} ${ctDef}.` : `Поединок: защита ${esc(t.name)} +${ctDef}.`] : [])],
    ...thresholds(actor, "strafe", data.storm)
  };
  const msg = await postCard(actor, card, dice.rolls);
  await revealAmbush(actor);
  await nem.take();
  await ct.take();
  await autoHit(msg);
  return msg;
}

/* ---------- урон без кнопки ---------- */

const CHANNEL = `system.${SYSTEM_ID}`;

/** Кто наносит урон цели: игрок-владелец в сети (у него откроется выбор метки), иначе ведущий. */
export function damageUser(actor) {
  return game.users.find(u => u.active && !u.isGM && actor.testUserPermission(u, "OWNER"))?.id ?? game.users.activeGM?.id ?? null;
}

/**
 * Пушка попала: урон сразу (по правилам Guns бьёт мгновенно, Break! после выстрела уже не поможет).
 * Срабатывает при выстреле и когда Strain превращает промах в попадание. По кораблю — когда выбрана система (против её Occlusion), иначе по кнопке.
 */
async function autoHit(message) {
  const card = foundry.utils.deepClone(message?.getFlag(SYSTEM_ID, "card") ?? {});
  if (!card.instant || card.dmgApplied || !card.targetUuid || card.dc === null || card.dc === undefined) return;
  const c = computeCard(card);
  if (!c.success) return;
  const target = resolveActor(card.targetUuid);
  const by = target && damageUser(target);
  if (!by) return;   // ведущего нет: урон останется на кнопке
  card.dmgApplied = true;
  card.autoDmg = true;
  if (message.canUserModify(game.user, "update")) await message.update({ content: renderCard(card), [`flags.${SYSTEM_ID}.card`]: card });
  const hit = { uuid: card.targetUuid, name: card.targetName, dmg: c.dmg ?? card.dmg, source: card.actorName, sourceUuid: card.actorUuid, gun: true, sys: card.sys };
  if (by === game.user.id) return hitTarget(hit);
  game.socket.emit(CHANNEL, { type: "hit", to: by, hit });
}

/** Урон, который другой клиент поручил этому. */
export function initHitSocket() {
  game.socket.on(CHANNEL, msg => {
    if (msg?.type === "hit" && msg.to === game.user.id) hitTarget(msg.hit, msg.hit.roundKey).catch(err => damageFailed(msg.hit, err));
    // «104:0» игрока: карточку залпа правит ведущий
    if (msg?.type === "ace104" && game.users.activeGM?.isSelf) applyAce(game.messages.get(msg.msg), msg.row).catch(err => console.error(`${SYSTEM_ID} | 104:0`, err));
  });
}

/** Пуск ЗРК или ракета корабельной системы: G-A, Speed 0, без броска. */
export async function fireSam(actor, sysIndex, { target = null, free = false, tag = "", key: forceKey = "", auto = false } = {}) {
  const s = actor.system;
  const src = s.kind === "ship" ? s.systems[sysIndex] : s.ground;
  // захват этой системы важнее метки T: метка у ведущего одна на все его машины; target — цель задана («Ловушка» аса)
  let t = target ? describeTarget(target.actor, target.name, target) : lockedTarget(actor) ?? currentTarget();
  // цели нет: щелчок по токену на карте, как у Lock On!
  if (!t && canvas?.ready && (src?.ga || src?.gg)) {
    const tok = await pickTargetToken(actor, { title: s.kind === "ship" ? `Пуск: ${src?.name}` : "Пуск" });
    if (!tok) return;
    t = describeTarget(tok.actor, tok.name, tok);
  }
  if (t && !canFireAt(actor, t.actor)) return ui.notifications.warn(`Пуск: «${t.name}» на вашей стороне.`);
  // по воздуху G-A (ЗРК), по земле и морю G-G; без цели — чем система стреляет
  const air = t ? isAirTarget(t) : !!src?.ga;
  const ga = air ? src?.ga : src?.gg;
  const label = (s.kind === "ship" ? `Пуск: ${src?.name}` : air ? "Пуск ЗРК" : "Пуск G-G") + (tag ? ` · ${tag}` : "");
  if (!has(ga)) return ui.notifications.warn(air ? `${label}: по воздуху эта система не стреляет.` : `${label}: по земле и морю нечем, нет G-G${t ? `, а «${t.name}» на земле или на воде` : ""}.`);
  // ЗРК — та же ракета: нужен захват этой цели (Lock On! на листе), дальность ракеты.
  // Системам корабля захват нужен, только если так сказано в описании («Lock On и пуск — два действия»): нижним орудиям — нет
  const needLock = !free && (s.kind !== "ship" || /Lock On/i.test(src?.note ?? ""));
  if (t) {
    const { problems } = reachProblems(actor, t, hasRule(actor, "shortsam") ? 0 : TB.range.missile);
    if (needLock && s.lockUuid !== t.uuid) problems.unshift(`Нет захвата цели «${t.name}»: сначала Lock On!`);
    const quiet = quietAA(actor);
    if (quiet && air) problems.unshift(quiet);
    problems.push(...nemesisAttack(actor, t.actor).problems, ...triggerAttack(actor, t.actor).problems);
    // автопилот окон не открывает: что-то мешает — пуска нет
    if (auto && problems.length) return null;
    if (!(await confirmReach(problems, label))) return;
  }
  const parts = [[air ? "G-A" : "G-G", ga ?? 0]];
  // «Наведение» РЛС рядом и «Радар ДРЛО» своей стороны
  const cue = air ? radarCue(actor) : null, aw = awacsCue(actor);
  if (cue) parts.push(cue);
  if (aw) parts.push(aw);
  // «Батарея»: урон +1 за каждое целое орудие сверх первого (счётчик на панели цели)
  const guns = hasRule(actor, "battery") ? Math.max(1, actor.getFlag(SYSTEM_ID, "unit")?.guns ?? 3) : 1;
  const key = forceKey || combatKey(), tBroken = sysOff(t?.actor.system, "ma");
  const card = {
    type: "attack", attack: true, label, rolled: false, parts, strain: 0,
    // по кораблю и летающему супероружию — против Occlusion системы, а не защиты (у кораблей её нет)
    ...shipDc(t, null, t && t.kind !== "ship" ? t.defense + wallBonus(t.token, t.actor) + nemesisDefense(actor, t.actor) + triggerDefense(actor, t.actor) : null),
    dmg: (hardened(t) ? Math.floor(TB.missileDamage / 2) : TB.missileDamage) + guns - 1, delayed: true, atTurn: tBroken && !!key, combatKey: key, targetUuid: t?.uuid ?? null, targetName: t?.name ?? "", maws: mawsOn(t),
    notes: [...(hardened(t) ? [HARD_NOTE] : []), ...(guns > 1 ? [`Батарея: орудий ${guns}, урон +${guns - 1}.`] : []), tBroken ? (key ? "Ракета ударит в начале хода цели (у неё сломан MAWS): посчитается сама." : "Попадает в начале хода цели: у неё сломан MAWS.")
      : forceKey ? AUTO_NOTE : key ? "Ракета долетит в конце раунда: залп посчитается сам." : "Ракета долетает в конце раунда."]
  };
  await revealAmbush(actor);
  return postCard(actor, card);
}

/* ---------- автопилот: те же действия без окон ---------- */

const AUTO_NOTE = "Пуск автопилота в конце раунда: ракета долетит в конце следующего раунда, цель успеет Break!.";

/** Ключ следующего раунда: ракеты автопилота, пущенные в конце раунда, бьют залпом следующего. */
export function nextRoundKey() {
  const c = game.combat;
  return c?.started ? `${c.id}:${c.round + 1}` : "";
}

/** Lock On! автопилота по токену: без окон. Возвращает null или почему нельзя. */
export async function autoLock(actor, tok) {
  if (!tok?.actor || tok.actor.statuses?.has(CONFIG.specialStatusEffects.DEFEATED)) return "цель сбита";
  if (!canFireAt(actor, tok.actor)) return "своя сторона";
  const t = describeTarget(tok.actor, tok.name, tok), kind = targetKind(t);
  if (!strikeMeans(actor, kind).length) return "нечем бить";
  const { range } = lockRangeOf(actor, kind);
  const { dist, problems } = reachProblems(actor, t, range, { strike: true });
  if (problems.length) return problems[0];
  const same = dist ? sameZoneLock(t.actor, t.token) : "";
  if (same) return same;
  const guard = dist > 1 ? escortCover(t.actor, t.token) : "";
  if (guard) return `ордер (${guard} рядом)`;
  await actor.update({ "system.lock": t.name, "system.lockUuid": t.uuid, [`flags.${SYSTEM_ID}.salvo`]: null, [`flags.${SYSTEM_ID}.phoenix`]: null });
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<div class="tb-card tb-card-lock"><header class="tb-card-head"><span class="tb-card-who">${esc(actor.name)}</span><span class="tb-card-what">Lock On!</span></header><div class="tb-note">Захват: <b>${esc(t.name)}</b>${dist !== null ? `, ${dist} зон.` : "."} Срывается, если цель уйдёт дальше двух зон.</div></div>`,
    flags: { [SYSTEM_ID]: { rwr: { target: t.uuid, from: actor.name, fromUuid: actor.uuid, also: [] } } }
  });
  return null;
}

/**
 * Fox Two! автопилота по захваченному токену: стандартная ракета без броска (Air-Air или Air-Gnd − Speed), ЗРК наземной цели
 * или ракетная система корабля. Ракета бьёт залпом следующего раунда. Возвращает сообщение или почему нельзя (строка).
 */
export async function autoFox(actor, tok, { sys = null } = {}) {
  const t = describeTarget(tok.actor, tok.name, tok), air = targetKind(t) === "air", s = actor.system;
  const key = nextRoundKey();
  if (actor.type === "npc" && (s.kind === "ground" || s.kind === "ship")) {
    const m = await fireSam(actor, sys ?? undefined, { target: tok, key, auto: true });
    return m ?? "пуск не прошёл";
  }
  if (s.lockUuid !== t.uuid) return "нет захвата";
  if (!stdMissile(actor, air ? "air" : "ground")) return "нет ракет";
  const { problems } = reachProblems(actor, t, TB.range.missile, { strike: true });
  problems.push(...nemesisAttack(actor, t.actor).problems, ...triggerAttack(actor, t.actor).problems);
  if (problems.length) return problems[0];
  const parts = [[air ? "Air-Air" : "Air-Gnd", (air ? s.aa : s.ag) ?? 0], ...weatherParts(weatherAt(actor), air ? "aa" : "ag")];
  const sead = air ? null : seadPart(actor, t);
  if (sead) parts.push(sead);
  const cue = awacsCue(actor);
  if (cue) parts.push(cue);
  if (s.speed) parts.push(["Speed", -s.speed]);
  const hard = hardened(t);
  const card = {
    type: "attack", attack: true, label: "Fox Two! стандартная ракета", rolled: false, d10: null, d4: null, parts, strain: 0, ...shipDc(t, null, defVs(actor, t, null)),
    wkey: "", close: false, ghost: false, shotKey: key, salvo: null, strainable: false, dmg: hard ? Math.floor(TB.missileDamage / 2) : TB.missileDamage,
    delayed: true, atTurn: false, combatKey: key, targetUuid: t.uuid, targetName: t.name, maws: mawsOn(t), tkind: air ? "air" : "ground", bomb: false,
    notes: [...(hard ? [HARD_NOTE] : []), AUTO_NOTE]
  };
  return postCard(actor, card);
}

/** Guns автопилота по токену в своей зоне: d10 + Strafe − Speed против защиты, урон сразу. Самолёты и наземная техника NPC. */
export async function autoGuns(actor, tok) {
  const s = actor.system;
  if (sysOff(s, "gu")) return "пушка сломана";
  if (s.kind === "ship") return "корабль бьёт системами";
  if (s.kind === "ground" && !has(s.ground?.gun)) return "пушки нет";
  if (blocked(actor, "strafe")) return "навык под меткой";
  const t = describeTarget(tok.actor, tok.name, tok);
  if (t.kind === "ship" || t.defense === null || t.defense === undefined) return "по кораблю пушкой не бьёт";
  const { problems } = reachProblems(actor, t, TB.range.guns);
  problems.push(...nemesisAttack(actor, t.actor).problems, ...triggerAttack(actor, t.actor).problems);
  if (problems.length) return problems[0];
  const dice = await rollDice(actor, false, { turnRoll: false });
  if (!dice) return "бросок не прошёл";
  const ground = s.kind === "ground";
  const parts = ground ? [["Пушка", s.ground.strafe ?? 0]] : skillParts(actor, "strafe", "Пушка");
  const speed = ground ? 0 : (s.speed ?? 0);
  if (speed) parts.push(["Speed", -speed]);
  const gun = ground ? s.ground.gun ?? 0 : s.gun ?? 0;
  const card = {
    type: "attack", attack: true, label: "Guns, Guns, Guns!", rolled: true, d10: dice.d10, d4: dice.d4, parts, strain: 0, shotKey: combatKey(),
    dc: t.defense + nemesisDefense(actor, t.actor) + triggerDefense(actor, t.actor), strainable: false, practiced: false,
    dmg: hardened(t) ? Math.floor(gun / 2) : gun, delayed: false, instant: true, targetUuid: t.uuid, targetName: t.name,
    notes: [...(hardened(t) ? [HARD_NOTE] : []), "Очередь автопилота."], ...thresholds(actor, "strafe")
  };
  const msg = await postCard(actor, card, dice.rolls);
  await autoHit(msg);
  return msg;
}

/** Break! автопилота: Dodge с броском, без окна; защита от ракет этого раунда. */
export async function autoBreak(actor) {
  if (blocked(actor, "dodge")) return "навык под меткой";
  if (inNarrowTunnel(tokenOf(actor), actor) && !hasTrigger(actor, "nevercome")) return "в туннеле";
  const dice = await rollDice(actor, false, { turnRoll: false });
  if (!dice) return "бросок не прошёл";
  const parts = skillParts(actor, "dodge", "Уклонение");
  const tvc = actor.system.planeProps?.has?.("tvc") || actor.system.props?.some?.(p => p.key === "tvc");
  const card = {
    type: "break", label: "Break!", rolled: true, d10: dice.d10, d4: dice.d4, parts, strain: 0, dc: null,
    ev: actor.system.evasion ?? actor.system.stats?.ev ?? 0, strainable: false,
    speedDrop: (tvc ? 1 : 2) + (actor.system.alt === "strat" ? 1 : 0), combatKey: combatKey(), ...thresholds(actor, "dodge")
  };
  const msg = await postCard(actor, card, dice.rolls);
  await applyBreak(actor, card);
  return msg;
}

/* ---------- залп конца раунда ---------- */

/** Карточка залпа: по строке на цель и одна кнопка урона для ведущего. */
function renderVolley(c) {
  const rk = n => `${n} ${n % 10 === 1 && n % 100 !== 11 ? "ракета" : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? "ракеты" : "ракет"}`;
  const rows = c.targets.map((r, i) => {
    if (r.cobra) return `<div class="tb-volley-row miss"><b>${esc(r.name)}</b>: ${rk(r.count)} (${esc(r.shooters)}) → <b class="fail">мимо: «${esc(TB.planeMoves.cobra.name)}»</b></div>`;
    if (r.ship) return `<div class="tb-volley-row"><b>${esc(r.name)}</b>: ${rk(r.count)}, лучшая ${r.best}. Корабль: сравните с Occlusion системы, урон кнопками на карточках пусков.</div>`;
    if (r.missing) return `<div class="tb-volley-row muted"><b>${esc(r.name)}</b>: цели нет на сцене.</div>`;
    if (r.splash) return `<div class="tb-volley-row hit"><b>${esc(r.name)}</b>: рядом с целью UGB (${esc(r.source)}) → <b class="ok">${r.dmg} урона</b></div>`;
    const boost = r.boosts ? ` +${r.boosts} от остальных` : "";
    const verdict = r.prox ? `<b class="ok">HPAA рвётся рядом, ${r.dmg} урона</b>`
      : r.hit ? `<b class="ok">Попадание, ${r.dmg} урона</b>${r.added ? ` (сложен урон ${r.added + 1} ракет)` : ""}${r.doubled ? " (UGB на Perk: вдвое)" : ""}`
      : `<b class="fail">Промах</b>${r.again ? `, ${r.keen ? `«${esc(TB.aceTriggers.again.name)}»` : "SAAM держит захват"}: повторный заход в конце раунда ${r.again}` : ""}`;
    const ace = r.aceHit ? ` · <b class="ok">«104:0» (${esc(r.ace.name)}): попадает, ${r.dmg} урона</b>`
      : r.ace && !r.hit ? ` <button type="button" data-tb-action="ace104" data-row="${i}" class="tb-uuid-owner" data-owner="${esc(r.ace.uuid)}" title="${esc(TB.planeMoves.ace104.text)}"><i class="fas fa-crosshairs"></i> 104:0 · ${esc(r.ace.name)}: попадает</button>` : "";
    const cobra = r.dodged ? ` Ещё ${rk(r.dodged)} мимо: «${esc(TB.planeMoves.cobra.name)}».` : "";
    return `<div class="tb-volley-row ${r.hit ? "hit" : "miss"}"><b>${esc(r.name)}</b>: ${rk(r.count)} (${esc(r.shooters)}). Лучшая ${r.best}${boost} против ${r.occ ? "Occlusion" : "защиты"} ${r.defense}${r.broke ? " (с Break!)" : ""} → ${verdict}${ace}${cobra}</div>`;
  }).join("") + (c.lost ?? []).map(l => `<div class="tb-volley-row muted"><b>${esc(l.name)}</b>: ${l.ace ? "повторный заход" : "SAAM"} (${esc(l.shooter)}) ${l.ace ? "сорван" : "потеряна"}, ${esc(l.why)}.</div>`).join("");
  // «Вираж»: захват на промахнувшегося стрелка
  const turns = (c.turns ?? []).map(e => e.locked || e.chosen
    ? `<div class="tb-volley-row"><b>${esc(e.name)}</b>: «Вираж», бесплатный захват на <b>${esc(e.locked || e.chosen)}</b>.</div>`
    : e.pick.length > 1 ? `<div class="tb-volley-row"><b>${esc(e.name)}</b>: «Вираж», захват на одного из промахнувшихся: ${e.pick.map(p => `<button type="button" data-tb-action="turn-lock" data-t="${esc(e.uuid)}" data-p="${esc(p.uuid)}" class="tb-uuid-owner" data-owner="${esc(e.uuid)}">${esc(p.name)}</button>`).join(" ")}</div>` : "").join("");
  const hits = c.targets.filter(r => r.hit);
  const btn = hits.length && !c.applied
    ? `<div class="tb-actions"><button type="button" data-tb-action="volley-damage" class="tb-gm"><i class="fas fa-burst"></i> Нанести урон: ${hits.map(r => `${esc(r.name)} ${r.dmg}`).join(", ")}</button></div>` : "";
  return `<div class="tb-card tb-card-volley">
    <header class="tb-card-head"><span class="tb-card-who">AWACS</span><span class="tb-card-what">${c.atTurnOf ? `Начало хода «${esc(c.atTurnOf)}»: ракеты` : `Конец раунда ${c.round}: залп`}</span></header>
    ${rows || `<div class="tb-note">Ракет в воздухе не было.</div>`}${turns}
    ${c.auto ? `<div class="tb-note">Урон нанесён сам.</div>` : c.applied ? `<div class="tb-note">Урон нанесён.</div>` : ""}${btn}
  </div>`;
}

/**
 * Конец раунда: все ракеты этого раунда долетают. По каждой цели берётся самая точная ракета (у каждой своя защита цели:
 * черты QAAM, HVAA, GPB), остальные дают +1 к ней, пока не хватит до защиты, а лишние добавляют свой урон.
 * Залп (4AAM, XLAA, XAGM) — по ракете в каждую захваченную цель с одним итогом. SAAM без захвата потеряна, а промах
 * при удержанном захвате заходит ещё раз в конце следующего раунда. HPAA рвётся рядом при промахе на 1–2. UGB на Perk —
 * вдвое по цели или урон по соседним.
 * Ракеты по цели со сломанным MAWS (и HVAA) ждут начала её хода: target — её uuid, atTurnOf — имя.
 * all — все ракеты этого боя, что ещё в воздухе (бой завершается).
 */
export async function resolveVolley(combat, { round = combat.round, target = null, atTurnOf = "", all = false } = {}) {
  const key = `${combat.id}:${round}`, prefix = `${combat.id}:`;
  const take = c => target ? c.atTurn && c.targetUuid === target && c.combatKey.startsWith(prefix)
    : all ? c.combatKey.startsWith(prefix) : c.combatKey === key && !c.atTurn;
  const groups = new Map(), lost = [], marks = new Map();
  // правки карточек пусков: одним запросом в конце
  const mark = (m, patch) => { const x = marks.get(m.id) ?? { m, patch: {} }; Object.assign(x.patch, patch); marks.set(m.id, x); };
  for (const m of game.messages.contents) {
    const c = m.getFlag(SYSTEM_ID, "card");
    if (!c?.delayed || !c.combatKey || c.dmgApplied || c.resolved || !c.targetUuid || !take(c)) continue;
    // SAAM летит по захвату стрелка: захват сорван до удара — ракета потеряна
    const why = c.wkey === "SAAM" ? saamLost(c, m) : c.aceAgain ? aceAgainLost(c) : "";
    if (why) { lost.push({ name: c.targetName, shooter: c.actorName, why, ...(c.aceAgain ? { ace: true } : {}) }); mark(m, { resolved: true, lost: why }); continue; }
    const cc = computeCard(c);
    // по кораблю ракеты собираются по системам: каждая система — своя цель залпа; залп — ракета в каждую захваченную цель
    for (const t of [{ uuid: c.targetUuid, name: c.targetName, sys: c.sys, primary: true }, ...(c.salvo ?? [])]) {
      const g = Number.isInteger(t.sys) ? `${t.uuid}#${t.sys}` : t.uuid;
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push({ m, primary: !!t.primary, c: { ...cc, targetUuid: t.uuid, targetName: t.name, sys: t.sys } });
    }
  }
  if (!groups.size && !lost.length) return null;
  const targets = [], turns = new Map();
  for (const [, all0] of groups) {
    let list = all0;
    const first = list[0].c;
    const uuid = first.targetUuid, sys = Number.isInteger(first.sys) ? first.sys : undefined;
    const shooters = [...new Set(list.map(x => x.c.actorName))].join(", ");
    const actor = resolveActor(uuid);
    if (!actor) { targets.push({ uuid, name: first.targetName, missing: true }); for (const x of list) mark(x.m, { resolved: true }); continue; }
    const info = describeTarget(actor, first.targetName);
    const y = sys !== undefined ? actor.system.systems?.[sys] : null;
    // корабль без выбранной системы: урон ведущий наносит кнопкой на карточке пуска (она остаётся и после залпа)
    if (info.kind === "ship" && !y) {
      targets.push({ uuid, name: info.name, ship: true, count: list.length, best: Math.max(...list.map(x => x.c.total)) });
      for (const x of list) mark(x.m, x.primary ? { resolved: true, shipOpen: true } : { resolved: true });
      continue;
    }
    // «Кобра Пугачёва»: ракеты этого раунда в цель, сделавшую кобру, промахиваются
    const cobra = cobraKey(actor);
    const dodged = cobra ? list.filter(x => x.c.combatKey === cobra) : [];
    if (dodged.length) {
      for (const x of dodged) mark(x.m, { resolved: true });
      list = list.filter(x => !dodged.includes(x));
      if (!list.length) { targets.push({ uuid, name: info.name, cobra: true, count: dodged.length, shooters }); continue; }
    }
    const { best, need, hit, used, dmg, prox } = volleyOutcome(list, actor, info, y, sys);
    if (y) info.name = `${info.name}: ${y.name}`;
    // «Вираж» лёгкого истребителя: промахнувшийся стрелок в своей или соседней зоне — бесплатный захват на него
    if (!hit && roleOf(actor) === "light" && info.token) for (const x of list) {
      const sh = resolveActor(x.c.actorUuid), st = tokenOf(sh), d = st ? zoneDistance(info.token, st) : null;
      if (!sh || !canFireAt(actor, sh) || d === null || d > 1 || sh.statuses?.has(CONFIG.specialStatusEffects.DEFEATED)) continue;
      const e = turns.get(uuid) ?? { uuid, name: info.name, pick: [] };
      if (!e.pick.some(p => p.uuid === sh.uuid)) e.pick.push({ uuid: sh.uuid, name: x.c.actorName });
      turns.set(uuid, e);
    }
    // «104:0» F-15C: ракета по воздушной цели промахнулась на 1–2 — кнопка «попадает» стрелку
    const short = hit ? 0 : need - (list.length - 1);
    const aceBy = !hit && short <= 2 && isAirTarget(info) ? list.find(x => { const sh = resolveActor(x.c.actorUuid); return sh && moveReady(sh, "ace104"); }) : null;
    const ev = actor.system.evasion ?? actor.system.stats?.ev ?? 0;
    // SAAM: промах при удержанном захвате — один повторный заход в конце следующего раунда, боезапас не тратится
    // «Не уйдёшь» (триггер аса): так же заходит ещё раз ракета аса, если захват держится; раз за вылет
    const keen = [];
    if (!hit && !all) for (const x of list) {
      if (x.c.wkey === "SAAM" || x.c.reattack || !x.primary) continue;
      const sh = resolveActor(x.c.actorUuid);
      if (!aceReady(sh, "again") || keen.some(k => k.sh === sh) || sh.system.lockUuid !== x.c.targetUuid) continue;
      keen.push({ x, sh });
    }
    for (const { sh } of keen) { await sh.update(aceUsedPatch(sh, "again")); aceRadio(sh, "От меня не уйдёшь."); }
    const again = !hit && !all ? [...list.filter(x => x.c.wkey === "SAAM" && !x.c.reattack && x.primary), ...keen.map(k => k.x)] : [];
    for (const x of list) mark(x.m, again.includes(x) ? { combatKey: `${combat.id}:${round + 1}`, atTurn: false, reattack: true, ...(keen.some(k => k.x === x) ? { aceAgain: true } : {}) } : { resolved: true });
    targets.push({
      uuid, name: info.name, count: list.length, shooters, best: best.c.total, defense: best.def, hit, sys, occ: !!y, prox: !!prox,
      broke: !y && (actor.system.breakEv ?? -Infinity) > ev && !(best.c.wkey === "QAAM" && best.c.close),
      boosts: hit && !prox ? need : 0, added: Math.max(0, used.length - 1), dmg, again: again.length ? round + 1 : 0, keen: keen.length > 0,
      doubled: used.some(x => x.c.ugbPerk === "double"),
      sourceUuid: best.c.actorUuid, source: best.c.actorName, shooterUuids: [...new Set(list.map(x => x.c.actorUuid))],
      bomb: list.some(x => x.c.bomb), dodged: dodged.length,
      ace: aceBy ? { uuid: aceBy.c.actorUuid, name: aceBy.c.actorName, dmg: best.c.dmg ?? TB.missileDamage } : null,
      // урон наносит клиент владельца-игрока (у него откроется выбор метки), иначе ведущий
      by: damageUser(actor) ?? game.user.id
    });
    // UGB на Perk «по соседним»: обычный урон всем целям рядом с основной
    for (const x of used.filter(u => u.c.ugbPerk === "splash")) targets.push(...ugbSplash(x.c, actor, info.token));
  }
  const marked = [...marks.values()].map(({ m, patch }) => {
    const c = Object.assign(foundry.utils.deepClone(m.getFlag(SYSTEM_ID, "card")), patch);
    return { _id: m.id, content: renderCard(c), [`flags.${SYSTEM_ID}.card`]: c };
  });
  if (marked.length) await ChatMessage.updateDocuments(marked);
  // урон по попавшим наносится сам: ракета уже посчитана с защитой цели на этот момент (Break!, Speed, погода)
  // «Вираж»: один промахнувшийся — захват сам; несколько — пилот выбирает кнопкой на карточке
  const turnList = [...turns.values()];
  for (const e of turnList) if (e.pick.length === 1) e.locked = await freeLock(e.uuid, e.pick[0]) ? e.pick[0].name : "";
  const auto = targets.some(r => r.hit);
  const card = { type: "volley", round, roundKey: key, atTurnOf, targets, lost, applied: auto, auto, turns: turnList };
  const msg = await ChatMessage.create({ speaker: { alias: "AWACS" }, content: renderVolley(card), flags: { [SYSTEM_ID]: { card } } });
  // сбитые залпом сбиты в раунде залпа, хотя он считается уже на смене раунда (для Тревоги от уничтоженной РЛС)
  markVolley(round);
  try { for (const r of targets.filter(x => x.hit && x.by === game.user.id)) await hitTarget(r, key); }
  finally { markVolley(null); }
  return msg;
}

/**
 * Итог ракет по одной цели (или одной системе корабля): у каждой ракеты своя защита цели (черты QAAM, HVAA, GPB),
 * берётся самая точная, остальные дают ей +1, пока не хватит до защиты, а лишние добавляют свой урон.
 * list: [{ c: computeCard(карточки пуска) }], сортируется на месте. Возвращает { best, need, hit, used, dmg, prox }.
 */
function volleyOutcome(list, actor, info, y, sys) {
  // корабль — Occlusion системы; в туннеле стены сбивают ракеты
  for (const x of list) {
    const sh = resolveActor(x.c.actorUuid);
    x.def = y ? y.occ - weakOf(sh, actor, sys) - (x.c.wkey === "GPB" ? 2 : 0)
      : missileDef(sh, actor, { token: info.token, weather: info.weather, wkey: x.c.wkey, close: x.c.close, ghost: !!x.c.ghost });
    x.margin = x.c.total - x.def;
  }
  list.sort((p, q) => q.margin - p.margin);
  const best = list[0];
  const extra = list.slice(1).sort((p, q) => (q.c.dmg ?? 0) - (p.c.dmg ?? 0));
  const need = Math.max(0, -best.margin);
  // «Хватит болтать»: ракета, пущенная посреди монолога, попадает всегда
  let hit = need <= extra.length || list.some(x => x.c.forceHit);
  const used = hit ? [best, ...extra.slice(0, extra.length - need)] : [];
  let dmg = used.reduce((n, x) => n + (x.c.dmg ?? 0) * (x.c.ugbPerk === "double" ? 2 : 1), 0);
  // HPAA: промах на 1–2 — рвётся рядом
  const prox = hit ? null : list.find(x => x.c.wkey === "HPAA" && x.margin >= -2);
  if (prox) { hit = true; dmg = PROX_DMG; }
  return { best, need, hit, used, dmg, prox };
}

/** Ракеты в воздухе по той же цели, что и карточка пуска, вместе с ней: [{ m, c }]. Только в бою и пока залп не посчитан. */
function sameVolley(card) {
  if (!card?.delayed || !card.combatKey || !card.targetUuid || card.resolved || card.dmgApplied) return [];
  const prefix = `${String(card.combatKey).split(":")[0]}:`;
  const sys = Number.isInteger(card.sys) ? card.sys : undefined;
  const out = [];
  for (const m of game.messages.contents) {
    const c = m.getFlag(SYSTEM_ID, "card");
    if (!c?.delayed || !c.combatKey || c.dmgApplied || c.resolved || !c.targetUuid) continue;
    // в начале хода цели бьют все её «отложенные» ракеты этого боя, в конце раунда — ракеты раунда
    if (card.atTurn ? !(c.atTurn && c.combatKey.startsWith(prefix)) : (c.atTurn || c.combatKey !== card.combatKey)) continue;
    const t = [{ uuid: c.targetUuid, name: c.targetName, sys: c.sys }, ...(c.salvo ?? [])]
      .find(e => e.uuid === card.targetUuid && (Number.isInteger(e.sys) ? e.sys : undefined) === sys);
    if (t) out.push({ m, c: { ...computeCard(c), targetUuid: t.uuid, targetName: t.name, sys: t.sys } });
  }
  return out;
}

/**
 * Прогноз залпа для карточки пуска: сколько ракет летит в ту же цель и попадут ли они вместе с защитой цели на сейчас.
 * { n, best, boost, def, hit, dmg, short } или null — ракета одна, корабль без выбранной системы или бой не идёт.
 */
export function volleyForecast(card) {
  const list = sameVolley(card);
  if (list.length < 2) return null;
  const actor = resolveActor(card.targetUuid);
  if (!actor) return null;
  const info = describeTarget(actor, card.targetName);
  const sys = Number.isInteger(card.sys) ? card.sys : undefined;
  const y = sys !== undefined ? actor.system.systems?.[sys] : null;
  if (info.kind === "ship" && !y) return null;
  const o = volleyOutcome(list, actor, info, y, sys);
  return { n: list.length, best: o.best.c.total, boost: o.hit && !o.prox ? o.need : Math.min(o.need, list.length - 1), def: o.best.def,
    hit: o.hit, prox: !!o.prox, dmg: o.dmg, short: o.hit ? 0 : o.need - (list.length - 1) };
}

/** Строка прогноза залпа на карточке пуска. */
function stackRow(c) {
  const f = c.stack;
  if (!f) return "";
  const rk = f.n === 2 ? "2 ракеты" : f.n < 5 ? `${f.n} ракеты` : `${f.n} ракет`;
  const verdict = f.prox ? `<b class="ok">HPAA рвётся рядом, ${f.dmg} урона</b>`
    : f.hit ? `<b class="ok">попадут, ${f.dmg} урона</b>` : `<b class="fail">пока мимо, не хватает ${f.short}</b>`;
  return `<div class="tb-note tb-stack"><i class="fas fa-layer-group"></i> Залп по «${esc(c.targetName)}»: ${rk}. Лучшая ${f.best}${f.boost ? ` +${f.boost} от остальных` : ""} против ${f.def} → ${verdict}. Каждая ещё ракета по этой цели: +1.</div>`;
}

/** Ведущий: после пуска или Strain пересчитать прогноз залпа на всех карточках ракет по той же цели. */
let stackTimer = null;
const stackQueue = new Set();
export function queueStack(message) {
  const c = message?.getFlag?.(SYSTEM_ID, "card");
  if (!c?.delayed || !c.combatKey || !c.targetUuid || !game.users.activeGM?.isSelf) return;
  stackQueue.add(message.id);
  clearTimeout(stackTimer);
  stackTimer = setTimeout(() => refreshStacks().catch(err => console.warn(`${SYSTEM_ID} | прогноз залпа`, err)), 150);
}
export async function refreshStacks() {
  const ids = [...stackQueue];
  stackQueue.clear();
  const seen = new Set(), upd = [];
  for (const id of ids) {
    const card = game.messages.get(id)?.getFlag(SYSTEM_ID, "card");
    for (const { m } of sameVolley(card)) {
      if (seen.has(m.id)) continue;
      seen.add(m.id);
      const c = foundry.utils.deepClone(m.getFlag(SYSTEM_ID, "card"));
      const f = volleyForecast(c);
      if (JSON.stringify(f) === JSON.stringify(c.stack ?? null)) continue;
      c.stack = f;
      upd.push({ _id: m.id, content: renderCard(c), [`flags.${SYSTEM_ID}.card`]: c });
    }
  }
  if (upd.length) await ChatMessage.updateDocuments(upd);
}

/** Бесплатный захват («Вираж»): цель uuid берёт на захват стрелка p. false — этот клиент не может писать актёра. */
export async function freeLock(uuid, p) {
  const a = resolveActor(uuid);
  if (!a?.isOwner) return false;
  await a.update({ "system.lock": p.name, "system.lockUuid": p.uuid, [`flags.${SYSTEM_ID}.salvo`]: null, [`flags.${SYSTEM_ID}.phoenix`]: null });
  return true;
}

/** «Кобра Пугачёва» этой машины: ключ раунда («бой:раунд»), в котором она сделана, или "". */
export const cobraKey = actor => actor?.getFlag?.(SYSTEM_ID, "cobra") ?? "";

/** Ведущий: «104:0» на строке залпа — промах становится попаданием, урон наносится. */
export async function applyAce(message, row) {
  const card = foundry.utils.deepClone(message?.getFlag(SYSTEM_ID, "card") ?? {});
  const r = card.targets?.[row];
  const sh = resolveActor(r?.ace?.uuid);
  if (!r?.ace || r.hit || !sh || !moveReady(sh, "ace104")) return;
  await sh.setFlag(SYSTEM_ID, "sortie", { ...(sh.getFlag(SYSTEM_ID, "sortie") ?? {}), move: sortieMark(sh) });
  Object.assign(r, { hit: true, aceHit: true, dmg: r.ace.dmg, by: damageUser(resolveActor(r.uuid)) ?? game.user.id });
  card.auto = true; card.applied = true;
  await message.update({ content: renderCard(card), [`flags.${SYSTEM_ID}.card`]: card });
  const hit = { uuid: r.uuid, name: r.name, dmg: r.dmg, source: r.ace.name, sourceUuid: r.ace.uuid, sys: r.sys, roundKey: card.roundKey };
  if (r.by === game.user.id) return hitTarget(hit, card.roundKey);
  game.socket.emit(CHANNEL, { type: "hit", to: r.by, hit });
}

/** «Не уйдёшь»: повторный заход ракеты аса срывается, если захват не держится. */
function aceAgainLost(c) {
  const sh = resolveActor(c.actorUuid);
  if (!sh || sh.statuses?.has(CONFIG.specialStatusEffects.DEFEATED)) return "стрелок сбит";
  return sh.system.lockUuid !== c.targetUuid ? "захват переведён или снят" : "";
}

/** SAAM: почему ракета потеряна (захват сорван до удара) или "" — захват держится. */
function saamLost(c, m) {
  const sh = resolveActor(c.actorUuid);
  if (!sh || sh.statuses?.has(CONFIG.specialStatusEffects.DEFEATED)) return "стрелок сбит";
  if (sh.system.lockUuid !== c.targetUuid) return "захват переведён или снят";
  const d = zoneDistance(tokenOf(sh), tokenOf(resolveActor(c.targetUuid)));
  if (d !== null && d > TB.range.lockHold) return `цель ушла на ${d} зон`;
  const broke = game.messages.contents.some(x => (x.timestamp ?? 0) > (m.timestamp ?? 0) && x.getFlag(SYSTEM_ID, "card")?.type === "break" && x.getFlag(SYSTEM_ID, "card")?.actorUuid === c.actorUuid);
  return broke ? "стрелок сделал Break!" : "";
}

/** UGB на Perk «по соседним»: противники на земле и воде в своей и соседних клетках основной цели получают обычный урон бомбы. */
function ugbSplash(c, main, mainTok) {
  if (!mainTok || !canvas?.ready) return [];
  const shooter = resolveActor(c.actorUuid);
  const out = [];
  for (const tok of canvas.tokens.placeables) {
    const a = tok.actor;
    if (!a || a === main || !["pilot", "npc"].includes(a.type) || isFlying(a) || a.statuses?.has(CONFIG.specialStatusEffects.DEFEATED)) continue;
    if (shooter && !canFireAt(shooter, a)) continue;
    const d = zoneDistance(mainTok, tok);
    if (d === null || d > 1) continue;
    const sys = a.system.kind === "ship" ? defaultSys(a) : undefined;
    out.push({ uuid: a.uuid, name: tok.name, hit: true, splash: true, dmg: c.dmg ?? 0, sys: sys >= 0 ? sys : undefined,
      source: c.actorName, sourceUuid: c.actorUuid, bomb: true, by: damageUser(a) ?? game.user.id });
  }
  return out;
}

/** Нанести урон попадания (залп или пушка); пилоту — сигнал. */
export async function hitTarget(r, roundKey) {
  const target = resolveActor(r.uuid);
  if (!target?.isOwner) return;
  if (target.type === "pilot" && !game.user.isGM) {
    ui.notifications.error(`${r.gun ? "Пушка" : "Ракета"}${r.source ? ` (${r.source})` : ""} попала в «${r.name}»: ${r.dmg} урона.`);
    foundry.audio.AudioHelper.play({ src: CONFIG.sounds.notification, volume: 0.8, autoplay: true, loop: false }, false);
  }
  await target.applyDamage(r.dmg, { source: r.source, sourceUuid: r.sourceUuid, roundKey, system: r.sys, gun: !!r.gun });
}

/** Игрок: залп попал в его самолёт — урон наносит его клиент. */
export function onVolleyCreated(message) {
  const c = message.getFlag(SYSTEM_ID, "card");
  if (c?.type !== "volley" || !c.auto || game.user.isGM) return;
  for (const r of c.targets.filter(x => x.hit && x.by === game.user.id)) hitTarget(r, c.roundKey).catch(err => damageFailed(r, err));
}

/** Урон не прошёл: сказать на экране, а не только в консоли, чтобы попадание не потерялось молча. */
function damageFailed(r, err) {
  console.error("Thunderbolt | урон", err);
  ui.notifications.error(`Урон по «${r?.name ?? "цели"}» не нанесён (${err?.message ?? err}). Нажмите кнопку урона на карточке или поставьте HP вручную; подробности в консоли (F12).`, { permanent: true });
}

/* ---------- кнопки на карточках ---------- */

export async function onCardAction(message, action, button) {
  const card = foundry.utils.deepClone(message.getFlag(SYSTEM_ID, "card"));
  if (!card) return;
  const actor = resolveActor(card.actorUuid);
  const canSave = message.canUserModify(game.user, "update");
  const save = () => canSave ? message.update({ content: renderCard(card), [`flags.${SYSTEM_ID}.card`]: card }) : null;

  switch (action) {
    case "strain": {
      if (!actor?.isOwner) return;
      if (actor.system.off?.has?.("fl")) return ui.notifications.warn(`Strain 0: закрылки ${actor.system.jam === "fl" ? "заглушены РЭБ" : "сломаны"}.`);
      if (poolSquad(actor)) {
        if (!(await spendPool(actor, 1))) return ui.notifications.warn(poolOf(actor) ? `Запас Strain эскадрильи «${poolSquad(actor)}» кончился.` : "Запас Strain эскадрильи есть только в идущем бою.");
      } else {
        if ((actor.system.strain.value ?? 0) <= 0) return ui.notifications.warn("Strain закончился.");
        await actor.update({ "system.strain.value": actor.system.strain.value - 1 });
      }
      card.strain = (card.strain ?? 0) + 1;
      await save();
      if (card.type === "break") await applyBreak(actor, card);
      if (card.instant) await autoHit(message);
      if (card.type === "rail") await railHit(message);
      return;
    }
    case "break-speed": {
      if (!actor?.isOwner) return;
      card.speedApplied = true;
      await save();
      return actor.update({ "system.speed": actor.system.speed - card.speedDrop }, { tbFree: true });
    }
    case "recover": {
      if (!actor?.isOwner) return;
      const c = computeCard(card);
      card.applied = true;
      await save();
      const s = actor.system.strain;
      return actor.update({ "system.strain.value": Math.min(s.max, s.value + c.regain) });
    }
    case "doom-eject":
    case "doom-hero": {
      if (!actor?.isOwner || card.chosen) return;
      if (action === "doom-hero" && !(await Dialog.confirm({ title: "Героическая гибель", content: `<p>${esc(actor.name)} погибает с последними словами, статус в личном деле станет «${TB.status.kia}». Точно?</p>` }))) return;
      card.chosen = action === "doom-eject" ? "eject" : "hero";
      await save();
      if (card.chosen === "hero") return actor.update({ "system.service.status": "kia" });
      // та же катапульта, что в HUD: Strain дотягивает сам, исход сразу в личном деле
      return ejectNow(actor, { marked: true });
    }
    case "eject-apply": {
      if (!actor?.isOwner || card.applied) return;
      const f = ejectFate(computeCard(card));
      card.applied = f.status;
      await save();
      return actor.update({ "system.service.status": f.status });
    }
    case "tunnel-pass": {
      if (!actor?.isOwner || card.rolledPass) return;
      card.rolledPass = true; await save();
      return rollSideCheck(actor, "push", { dc: card.dc, label: `Пролёт туннеля: Push против ${card.dc}`, failDmg: Math.max(1, card.speed ?? 1),
        notes: ["Complication: задел стену, на выбор −1 Speed или 1 урон."] });
    }
    case "alarm-up": {
      if (!game.user.isGM || card.applied) return;
      card.applied = true; await save();
      return raiseAlarm(Number(button?.dataset.n) || 1);
    }
    case "alarm-patrol": {
      if (!game.user.isGM || card.patrol) return;
      card.patrol = true; await save();
      return raiseAlarm(2);
    }
    case "alarm-dodge": {
      if (!actor?.isOwner || card.dodged) return;
      card.dodged = true; await save();
      return rollSideCheck(actor, "dodge", { dc: 7, label: "Тревога: Dodge против 7", notes: card.dodge, onFail: "alarm" });
    }
    case "side-win": {
      if (!actor?.isOwner || card.applied || !card.onWin) return;
      card.applied = true; await save();
      return letGo(actor, card.onWin);
    }
    case "side-engines": {
      if (!actor?.isOwner || card.applied) return;
      card.applied = true; await save();
      const m = actor.system.markers;
      if (m.structure) return ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), content: `<div class="tb-card tb-card-damage"><div class="tb-note"><b>${esc(actor.name)}</b>: Structure уже отмечена (${esc(TB.systems[m.sys]?.label ?? m.sys)}). Что сломалось ещё, решает ведущий.</div></div>` });
      await actor.update({ "system.markers.structure": true, "system.markers.sys": "en" });
      return ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), content: `<div class="tb-card tb-card-damage"><div class="tb-note"><b>${esc(actor.name)}</b>: двигатели не выдержали, метка Structure: ${esc(TB.systems.en?.label ?? "Engines")}.</div></div>` });
    }
    case "follow": {
      if (!actor?.isOwner || !(await offerFollow(actor, card))) return;
      card.follow = true;
      return save();
    }
    case "million": {
      const t = millionFor(card);
      if (!actor?.isOwner || !t) return;
      await t.update({ "system.used": true });
      card.forceHit = true; card.million = t.name;
      await save();
      if (card.instant) await autoHit(message);
      return;
    }
    case "side-dmg": {
      if (!actor?.isOwner || card.applied) return;
      card.applied = true; await save();
      return actor.applyDamage(card.failDmg, { source: card.label });
    }
    case "stall-ok": {
      if (!actor?.isOwner) return;
      card.applied = true; await save();
      return actor.update({ "system.speed": 1 }, { tbFree: true });
    }
    case "stall-fail": {
      if (!actor?.isOwner) return;
      card.applied = true; await save();
      if (actor.system.alt === "low") return actor.markDoom("Сваливание на Низкой");
      const down = { strat: "high", high: "med", med: "low" }[actor.system.alt] ?? "low";
      return actor.setAltitude(down, { tbFree: true });
    }
    case "damage": {
      const target = resolveActor(card.targetUuid);
      if (!target) return ui.notifications.warn("Цель не найдена на сцене.");
      if (!target.isOwner) return ui.notifications.warn("Урон наносит ведущий.");
      const c = computeCard(card);
      card.dmgApplied = true;
      await save();
      return target.applyDamage(hitDmg(c), { source: card.actorName, sourceUuid: card.actorUuid, system: card.sys, gun: !!card.instant && card.type === "attack" });
    }
    case "ugb-perk": {
      if (!actor?.isOwner || card.ugbPerk || card.resolved) return;
      card.ugbPerk = button?.dataset.perk === "splash" ? "splash" : "double";
      return save();
    }
    case "chase": {
      if (!actor?.isOwner || card.chased) return;
      const c = computeCard(card);
      if (!c.success) return;
      const rows = [], lost = [], rolls = [];
      for (const p of pursuersOf(actor.uuid)) {
        const r = await roll("1d10"), sk = p.actor.system.skillBlocked?.push ? 0 : p.actor.system.skillTotal?.push ?? 0, total = r.total + sk;
        rolls.push(r);
        // ничья за пилотом: за пилотом-беглецом нужно перебить, пилот-преследователь держится и при равенстве
        const keep = actor.type === "pilot" ? total > c.total : total >= c.total;
        if (!keep) lost.push(p.actor.uuid);
        rows.push(`${esc(p.name)}: Push d10 ${r.total} + ${sk} = <b>${total}</b> против ${c.total} — ${keep ? "<b>держится на хвосте</b>" : '<b class="fail">отстал, захват сорван</b>'}.`);
      }
      card.chased = true;
      card.chaseRows = rows.length ? rows : ["На хвосте никого нет."];
      await save();
      if (rolls.length && game.dice3d) for (const r of rolls) game.dice3d.showForRoll(r, game.user, true).catch(() => null);
      if (lost.length) { const { dropLocks } = await import("../plane-roles.mjs"); await dropLocks(actor.uuid, lost); }
      return;
    }
    case "perk-next":
    case "comp-next": {
      if (!actor?.isOwner) return;
      const who = await passOutcome(actor, action === "perk-next" ? "perk" : "comp");
      if (!who) return;
      card[action === "perk-next" ? "perkPassed" : "compPassed"] = who.name;
      return save();
    }
    case "dt-practice": {
      if (!actor?.isOwner || card.reroll) return;
      const edge = practiceFor(actor, card.skill, card.d10);
      if (!edge) return ui.notifications.warn("Наработки по этому навыку нет или она уже потрачена.");
      const r = await roll("1d10");
      if (game.dice3d) await game.dice3d.showForRoll(r, game.user, true);
      card.reroll = [card.d10, r.total];
      card.d10 = Math.max(card.d10, r.total);
      await actor.update({ "system.edges": actor.system.edges.map(e => e.id === edge.id ? { ...e, used: true } : e) });
      await save();
      if (card.type === "break") await applyBreak(actor, card);
      if (card.instant) await autoHit(message);
      if (card.type === "rail") await railHit(message);
      return;
    }
    case "battle-results": {
      if (game.user.isGM) game.thunderbolt.sortieResults();
      return;
    }
    case "strike-ship": return strikeShip(message, button.dataset.uuid);
    case "turn-lock": {
      const a = resolveActor(button?.dataset.t), e = card.turns?.find(x => x.uuid === button?.dataset.t), p = e?.pick.find(x => x.uuid === button?.dataset.p);
      if (!a?.isOwner || !p || e.chosen || a.getFlag(SYSTEM_ID, "turnPick") === message.id) return;
      await freeLock(a.uuid, p);
      await a.setFlag(SYSTEM_ID, "turnPick", message.id);
      e.chosen = p.name;
      if (canSave) await save();
      else ui.chat?.updateMessage?.(message);
      return ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor: a }), content: `<div class="tb-card tb-card-lock"><div class="tb-note"><b>${esc(a.name)}</b>: «Вираж», бесплатный захват на <b>${esc(p.name)}</b>.</div></div>` });
    }
    case "ace104-card": {
      const c = computeCard(card);
      if (!actor?.isOwner || c.success || !moveReady(actor, "ace104")) return;
      await actor.setFlag(SYSTEM_ID, "sortie", { ...(actor.getFlag(SYSTEM_ID, "sortie") ?? {}), move: sortieMark(actor) });
      card.forceHit = true; card.ace = c.dc - c.total;
      return save();
    }
    case "ace104": {
      const r = card.targets?.[Number(button?.dataset.row)];
      const sh = resolveActor(r?.ace?.uuid);
      if (!r?.ace || r.hit || !sh?.isOwner) return;
      if (game.user.isGM) return applyAce(message, Number(button.dataset.row));
      if (!game.users.activeGM) return ui.notifications.warn("«104:0»: ведущего нет в сети, попадание не записать.");
      game.socket.emit(CHANNEL, { type: "ace104", msg: message.id, row: Number(button.dataset.row) });
      return;
    }
    case "volley-damage": {
      if (!game.user.isGM || card.applied) return;
      card.applied = true;
      await save();
      for (const r of card.targets.filter(x => x.hit)) {
        const target = resolveActor(r.uuid);
        if (target) await target.applyDamage(r.dmg, { source: r.source, sourceUuid: r.sourceUuid, roundKey: card.roundKey, system: r.sys });
      }
      return;
    }
    default: return groundAction(message, card, action, button, actor, save);
  }
}

/** Скрыть кнопки, которые этому пользователю нажимать нельзя. */
export function decorateCard(message, html) {
  const card = message.getFlag(SYSTEM_ID, "card");
  const root = html[0] ?? html;
  if (!card) return;
  const actor = resolveActor(card.actorUuid);
  const target = card.targetUuid ? resolveActor(card.targetUuid) : null;
  const canEdit = message.isAuthor || game.user.isGM;
  root.querySelectorAll(".tb-owner").forEach(b => { if (!(actor?.isOwner && canEdit)) b.remove(); });
  root.querySelectorAll(".tb-gm").forEach(b => { if (!game.user.isGM) b.remove(); });
  // кнопки владельца другой машины на карточке залпа («104:0» стрелка, «Вираж» цели); выбор «Виража» уже сделан — прячутся
  root.querySelectorAll(".tb-uuid-owner").forEach(b => {
    const a = resolveActor(b.dataset.owner);
    if (!a?.isOwner || (b.dataset.tbAction === "turn-lock" && a.getFlag?.(SYSTEM_ID, "turnPick") === message.id)) b.remove();
  });
  root.querySelectorAll(".tb-target-owner").forEach(b => { if (!(target?.isOwner && (canEdit || game.user.isGM))) b.remove(); });
  root.querySelectorAll("[data-tb-action]").forEach(b => b.addEventListener("click", ev => {
    ev.preventDefault();
    b.disabled = true;
    onCardAction(message, b.dataset.tbAction, b).finally(() => { b.disabled = false; });
  }));
}
