/* Броски и чат-карточки: проверки, ракеты, пушка, Break!, Strain, урон, сваливание. */
import { SYSTEM_ID, TB } from "../config.mjs";
import { esc, resolveActor } from "../utils.mjs";
import { tokenOf, weatherAt, weatherParts, defenseWithWeather, reachProblems, confirmReach } from "../scene.mjs";
import { takeNext, passOutcome } from "../squad.mjs";
import { pickTargetToken } from "../pick.mjs";

const sign = n => (n >= 0 ? "+" : "−") + Math.abs(n);

/* ---------- вспомогательное ---------- */

export { resolveActor };

/** Первая цель игрока на сцене: { actor, token, name, uuid, defense, kind } или null. */
export function currentTarget() {
  const t = game.user.targets.first();
  if (!t?.actor) return null;
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
export function formDialog(title, content, { ok = "Бросить", width = 380 } = {}) {
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
      close: () => resolve(null)
    }, { width, classes: ["dialog", "thunderbolt"] }).render(true);
  });
}

/** Слагаемые навыка для карточки: ранги и поправки триггеров отдельными строками. */
function skillParts(actor, skill, label = TB.skills[skill].label) {
  const s = actor.system;
  if (!s.skillParts) return [[label, s.skillTotal[skill]]];
  return [[label, s.skills[skill]], ...s.skillParts[skill].map(m => [m.name, m.value])];
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
  if (c.rolled) {
    out.perk = c.d4 >= (c.perkOn ?? 4);
    out.comp = c.d4 <= (c.compOn ?? 1);
  }
  if (c.type === "recover" && out.success) out.regain = Math.max(c.minRegain ?? 1, out.total - 7);
  return out;
}

export function renderCard(card) {
  if (card.type === "volley") return renderVolley(card);
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
  } else if (c.dc !== null && c.dc !== undefined) {
    const vs = c.vsLabel ?? "сложность";
    verdict = `<div class="tb-total">Итог <b>${c.total}</b> против ${vs} ${c.dc} → <b class="${c.success ? "ok" : "fail"}">${c.success ? (c.attack ? "Попадание" : "Успех") : (c.attack ? "Промах" : "Провал")}</b></div>`;
  } else {
    verdict = `<div class="tb-total">Итог <b>${c.total}</b>${c.vsHint ? ` · ${esc(c.vsHint)}` : ""}</div>`;
  }
  rows.push(verdict);
  if (c.rolled) {
    const d4 = c.perk ? `<div class="tb-d4 perk">d4 = ${c.d4}: <b>Perk</b> (по умолчанию +1 к следующей проверке)</div>`
      : c.comp ? `<div class="tb-d4 comp">d4 = ${c.d4}: <b>Complication</b> (по умолчанию −1)</div>`
        : `<div class="tb-d4">d4 = ${c.d4}</div>`;
    rows.push(d4);
  }
  for (const n of c.notes ?? []) rows.push(`<div class="tb-note">${n}</div>`);
  if (c.type === "recover" && c.success) rows.push(`<div class="tb-note">Вернуть <b>${c.regain}</b> Strain.</div>`);

  const btn = [];
  if (c.rolled && c.perk && !c.perkPassed) btn.push(`<button type="button" data-tb-action="perk-next" class="tb-owner">Perk: +1 к следующей</button>`);
  if (c.rolled && c.comp && !c.compPassed) btn.push(`<button type="button" data-tb-action="comp-next" class="tb-owner">Complication: −1 к следующей</button>`);
  if (c.perkPassed) rows.push(`<div class="tb-note">Perk: +1 к следующей проверке, ${esc(c.perkPassed)}.</div>`);
  if (c.compPassed) rows.push(`<div class="tb-note">Complication: −1 к следующей проверке, ${esc(c.compPassed)}.</div>`);
  if (c.rolled && c.strainable && !c.resolved) btn.push(`<button type="button" data-tb-action="strain" class="tb-owner"><i class="fas fa-bolt"></i> +1 Strain</button>`);
  if (c.type === "break" && !c.speedApplied) btn.push(`<button type="button" data-tb-action="break-speed" class="tb-owner">Speed −${c.speedDrop} после атак</button>`);
  if (c.type === "recover" && c.success && !c.applied) btn.push(`<button type="button" data-tb-action="recover" class="tb-owner">Вернуть ${c.regain} Strain</button>`);
  if (c.type === "stall" && !c.applied) {
    if (c.success) btn.push(`<button type="button" data-tb-action="stall-ok" class="tb-owner">Выровняться: Speed 1</button>`);
    else btn.push(`<button type="button" data-tb-action="stall-fail" class="tb-owner">${c.alt === "low" ? "Удар о землю: Doom" : "Потерять высоту"}</button>`);
  }
  const queued = c.delayed && c.combatKey && !c.resolved && !c.dmgApplied;
  if (queued) rows.push(`<div class="tb-note tb-queued"><i class="fas fa-hourglass-half"></i> В очереди залпа конца раунда.</div>`);
  if (c.resolved) rows.push(`<div class="tb-note">Учтена в залпе конца раунда.</div>`);
  if (c.dmg && c.targetUuid && !queued && !c.resolved && (c.success || c.dc === null || c.dc === undefined) && !c.dmgApplied)
    btn.push(`<button type="button" data-tb-action="damage" class="tb-target-owner"><i class="fas fa-burst"></i> ${c.delayed ? "В конце раунда: " : ""}${c.dmg} урона по «${esc(c.targetName)}»</button>`);
  if (c.dmgApplied) rows.push(`<div class="tb-note">Урон нанесён.</div>`);

  return `<div class="tb-card tb-card-${c.type}">
    <header class="tb-card-head"><span class="tb-card-who">${esc(c.actorName)}</span><span class="tb-card-what">${esc(c.label)}</span></header>
    ${rows.join("")}
    ${btn.length ? `<div class="tb-actions">${btn.join("")}</div>` : ""}
  </div>`;
}

async function postCard(actor, card, rolls = []) {
  card.actorUuid = actor.uuid;
  card.actorName = actor.name;
  return ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: renderCard(card),
    rolls,
    sound: rolls.length ? CONFIG.sounds.dice : null,
    flags: { [SYSTEM_ID]: { card } }
  });
}

/* ---------- проверки ---------- */

/** Пороги Perk/Complication с учётом погоды «Ураган» (Complication на 1–2). */
function thresholds(actor, skill, extraComp) {
  const s = actor.system;
  return { perkOn: s.perkOn?.[skill] ?? 4, compOn: Math.max(s.compOn?.[skill] ?? 1, extraComp ? 2 : 1) };
}

async function rollDice(actor, practiced) {
  if (practiced) return { d10: 10, d4: 4, rolls: [] };
  const r10 = await roll("1d10"), r4 = await roll("1d4");
  return { d10: r10.total, d4: r4.total, rolls: [r10, r4] };
}

function commonFields(actor, skill) {
  const pr = hasTrigger(actor, "practiced") && actor.type === "pilot";
  const w = weatherAt(actor);
  return `
    <div class="form-group"><label>Модификатор</label><input type="number" name="mod" value="0"></div>
    <div class="form-group"><label><input type="checkbox" name="storm" ${w.comp2 ? "checked" : ""}> Ураган: Complication на 1–2</label></div>
    ${w.list.length ? `<p class="tb-hint">Погода: ${w.list.map(d => `${d.ico} ${esc(d.name)}`).join(", ")}</p>` : ""}
    ${pr ? `<div class="form-group"><label><input type="checkbox" name="practiced"> Отточенное мастерство: максимум без броска</label></div>` : ""}`;
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
  const dice = await rollDice(actor, data.practiced);
  const parts = skillParts(actor, skill, sk.label);
  if (skill === "push") parts.push(...weatherParts(weatherAt(actor), "push"));
  parts.push(...await takeNext(actor));
  if (data.mod) parts.push(["мод.", data.mod]);
  const card = {
    type: "check", label: label ?? `Проверка ${sk.label} (${sk.en})`, rolled: true, d10: dice.d10, d4: dice.d4,
    parts, strain: 0, dc: data.dc, strainable: actor.type === "pilot" || actor.system.tier === "ace",
    practiced: !!data.practiced, ...thresholds(actor, skill, data.storm)
  };
  return postCard(actor, card, dice.rolls);
}

/** Восстановление Strain: Push против 7, вернуть (итог − 7), минимум 1 (2 с «Кухней и туалетом»). */
export async function rollRecover(actor) {
  if (blocked(actor, "push")) return;
  const data = await formDialog("Восстановить Strain (Push против 7)", commonFields(actor, "push"));
  if (!data) return;
  const dice = await rollDice(actor, data.practiced);
  const parts = skillParts(actor, "push", "Форсаж");
  parts.push(...weatherParts(weatherAt(actor), "push"));
  parts.push(...await takeNext(actor));
  if (data.mod) parts.push(["мод.", data.mod]);
  const card = {
    type: "recover", label: "Восстановление Strain", rolled: true, d10: dice.d10, d4: dice.d4, parts, strain: 0, dc: 7,
    strainable: true, practiced: !!data.practiced, minRegain: actor.system.planeProps?.has?.("kitchen") ? 2 : 1,
    ...thresholds(actor, "push", data.storm)
  };
  return postCard(actor, card, dice.rolls);
}

/** Сваливание: Push против 7. */
export async function rollStall(actor) {
  const dice = await rollDice(actor, false);
  const w = weatherAt(actor);
  const parts = [...skillParts(actor, "push", "Форсаж"), ...weatherParts(w, "push"), ...await takeNext(actor)];
  const card = {
    type: "stall", label: "Сваливание: Push против 7", rolled: true, d10: dice.d10, d4: dice.d4, parts, strain: 0, dc: 7,
    strainable: actor.type === "pilot" || actor.system.tier === "ace", alt: actor.system.alt, ...thresholds(actor, "push", w.comp2),
    notes: ["Успех: Speed 1. Провал: минус уровень высоты и повтор на следующем ходу, на Low сразу Doom."]
  };
  return postCard(actor, card, dice.rolls);
}

/** Break!: d10 + Dodge (+Strain, +Lead союзника), пополам вверх. */
export async function rollBreak(actor) {
  if (blocked(actor, "dodge")) return;
  if (actor.system.broken === "ma") ui.notifications.info("MAWS сломан: о ракетах узнаёшь, только когда они попадут.");
  const data = await formDialog("Break!", `
    <div class="form-group"><label>Лидерство союзника</label><input type="number" name="lead" value="0"></div>
    ${commonFields(actor, "dodge")}`);
  if (!data) return;
  const dice = await rollDice(actor, data.practiced);
  const parts = skillParts(actor, "dodge", "Уклонение");
  if (data.lead) parts.push(["Lead", data.lead]);
  parts.push(...await takeNext(actor));
  if (data.mod) parts.push(["мод.", data.mod]);
  const tvc = actor.system.planeProps?.has?.("tvc") || actor.system.props?.some?.(p => p.key === "tvc");
  const card = {
    type: "break", label: "Break!", rolled: true, d10: dice.d10, d4: dice.d4, parts, strain: 0, dc: null,
    ev: actor.system.evasion ?? actor.system.stats?.ev ?? 0, strainable: actor.type === "pilot" || actor.system.tier === "ace",
    speedDrop: tvc ? 1 : 2, practiced: !!data.practiced, ...thresholds(actor, "dodge", data.storm)
  };
  const msg = await postCard(actor, card, dice.rolls);
  await applyBreak(actor, card);
  return msg;
}

async function applyBreak(actor, card) {
  const c = computeCard(card);
  await actor.update({ "system.breakEv": c.applies ? c.value : null });
}

/* ---------- атаки ---------- */

function weaponOptions(actor, missile) {
  const opts = [];
  if (missile) {
    const noMsl = actor.system.broken === "ms";
    if (!noMsl) opts.push(`<option value="">Стандартная ракета (урон ${TB.missileDamage})</option>`);
  }
  if (actor.system.broken !== "sw") {
    for (const w of actor.items.filter(i => i.type === "weapon")) {
      const s = w.system;
      const isGun = s.target === "gun";
      if (missile === isGun) continue;
      const empty = !w.system.unlimited && (s.ammo.value ?? 0) <= 0;
      opts.push(`<option value="${w.id}" ${empty ? "disabled" : ""}>${esc(w.name)}${w.system.unlimited ? "" : ` · ${s.ammo.value}/${s.ammo.max}`}</option>`);
    }
  }
  return opts;
}

/** Захваченная цель, если её токен ещё на сцене: для Fox Two! без выбранной цели. */
function lockedTarget(actor) {
  const a = actor.system.lockUuid ? resolveActor(actor.system.lockUuid) : null;
  return a ? describeTarget(a, actor.system.lock) : null;
}

/** Lock On!: цель выбирается щелчком по токену; захват в своей или соседней зоне (дальнобойное спецоружие — в любой точке зоны операции). */
export async function lockOn(actor) {
  const tok = await pickTargetToken(actor, { title: "Lock On!" });
  if (!tok) return;
  const t = describeTarget(tok.actor, tok.name, tok);
  const longRange = actor.items.find(i => i.type === "weapon" && i.system.reach >= TB.range.operation && (i.system.unlimited || i.system.ammo.value > 0));
  const { dist, problems } = reachProblems(actor, t, longRange ? TB.range.operation : TB.range.lockOn);
  if (!(await confirmReach(problems, "Lock On!"))) return;
  await actor.update({ "system.lock": t.name, "system.lockUuid": t.uuid });
  const far = dist !== null && dist > TB.range.lockOn && longRange ? ` Захват для ${esc(longRange.name)}.` : "";
  return ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<div class="tb-card tb-card-lock"><header class="tb-card-head"><span class="tb-card-who">${esc(actor.name)}</span><span class="tb-card-what">Lock On!</span></header><div class="tb-note">Захват: <b>${esc(t.name)}</b>${dist !== null ? `, ${dist} зон.` : "."}${far} Срывается, если цель уйдёт дальше двух зон.</div></div>`
  });
}

/** Fox Two!: ракета или спецоружие. Без броска: AA/AG + мод оружия − Speed. Improved: d10 + Aim/Deploy + мод − Speed. */
export async function fireMissile(actor) {
  const s = actor.system;
  const t = currentTarget() ?? lockedTarget(actor);
  const opts = weaponOptions(actor, true);
  if (!opts.length) return ui.notifications.warn("Ракет нет: система ракет сломана, а спецоружия не осталось.");
  const ground = t ? t.kind !== "air" : false;
  const data = await formDialog("Fox Two!", `
    <p class="tb-hint">${t ? `Цель: <b>${esc(t.name)}</b>${t.defense !== null ? `, защита ${t.defense}` : ""}` : "Цель не выбрана: итог покажу без сравнения."}</p>
    <div class="form-group"><label>Оружие</label><select name="weapon">${opts.join("")}</select></div>
    <div class="form-group"><label>Цель</label><select name="tkind">
      <option value="air" ${ground ? "" : "selected"}>воздушная (Air-Air, Aim)</option>
      <option value="ground" ${ground ? "selected" : ""}>наземная или морская (Air-Gnd, Deploy)</option></select></div>
    <div class="form-group"><label><input type="checkbox" name="improved"> Improved Fox Two! (с броском)</label></div>
    ${commonFields(actor, ground ? "deploy" : "aim")}`, { ok: "Пуск" });
  if (!data) return;

  const air = data.tkind === "air";
  const skill = air ? "aim" : "deploy";
  const w = data.weapon ? actor.items.get(data.weapon) : null;
  const ws = w?.system;
  if (w && ws.target === "air" && !air) ui.notifications.warn(`${w.name} бьёт только по воздушным целям.`);
  if (w && ws.target === "ground" && air) ui.notifications.warn(`${w.name} бьёт только по наземным и морским целям.`);
  if (data.improved && blocked(actor, skill)) return;
  const wx = weatherAt(actor);
  if (t) {
    const { problems } = reachProblems(actor, t, ws?.reach ?? TB.range.missile);
    if (s.lockUuid !== t.uuid) problems.unshift(`Нет захвата цели «${t.name}»: сначала Lock On!`);
    if (!(await confirmReach(problems, "Fox Two!"))) return;
  }

  const speed = s.speed ?? 0;
  const parts = [];
  let dice = { d10: null, d4: null, rolls: [] };
  if (data.improved) {
    dice = await rollDice(actor, data.practiced);
    parts.push(...skillParts(actor, skill));
    const m = air ? ws?.aim : ws?.dep;
    if (m) parts.push([`мод ${w.name}`, m]);
    parts.push(...await takeNext(actor));
  } else {
    let base = air ? s.aa : s.ag;
    if (actor.type === "npc" && actor.system.kind === "ground") base = s.ground.ga ?? 0;
    parts.push([air ? "Air-Air" : "Air-Gnd", base ?? 0]);
    const m = air ? ws?.aa : ws?.ag;
    if (m) parts.push([`мод ${w.name}`, m]);
    parts.push(...weatherParts(wx, air ? "aa" : "ag"));
  }
  if (speed) parts.push(["Speed", -speed]);
  if (data.mod) parts.push(["мод.", data.mod]);

  const dmg = w ? (parseInt(ws.dmg) || 0) : TB.missileDamage;
  const notes = weatherNotes(wx).filter(n => !data.improved || !/A-A/.test(n));
  if (w?.system.fx) notes.push(esc(w.system.fx));
  const hv = w?.system.key === "HVAA";
  const tBroken = t?.actor.system.broken === "ma";
  const key = combatKey();
  notes.push(hv || tBroken ? "Попадает в начале хода цели."
    : key ? "Ракета долетит в конце раунда: залп посчитается сам, с защитой цели на тот момент."
      : "Ракета долетает в конце раунда. Каждая следующая ракета по той же цели: +1 к атаке самой точной или её урон в сумму.");
  if (t?.kind === "ship") notes.push("Корабль: сравните итог с Occlusion выбранной системы.");

  if (w && !ws.unlimited) await w.update({ "system.ammo.value": Math.max(0, (ws.ammo.value ?? 0) - 1) });

  const card = {
    type: "attack", attack: true, label: `Fox Two! ${w ? w.name : "стандартная ракета"}`, rolled: !!data.improved,
    d10: dice.d10, d4: dice.d4, parts, strain: 0, dc: t && t.kind !== "ship" ? t.defense : null, vsLabel: "защиты",
    vsHint: t?.kind === "ship" ? "по Occlusion системы" : "", strainable: !!data.improved && (actor.type === "pilot" || actor.system.tier === "ace"),
    practiced: !!data.practiced, dmg, delayed: !(hv || tBroken), combatKey: hv || tBroken ? "" : key,
    targetUuid: t?.uuid ?? null, targetName: t?.name ?? "", notes,
    ...thresholds(actor, skill, data.storm)
  };
  return postCard(actor, card, dice.rolls);
}

/** Guns, Guns, Guns!: d10 + Strafe − Speed против защиты, урон сразу. */
export async function fireGuns(actor, { system: sysIndex } = {}) {
  const s = actor.system;
  const t = currentTarget() ?? lockedTarget(actor);
  if (s.broken === "gu") return ui.notifications.warn("Пушка сломана (метка Structure).");
  if (blocked(actor, "strafe")) return;
  const pods = weaponOptions(actor, false);
  const data = await formDialog("Guns, Guns, Guns!", `
    <p class="tb-hint">${t ? `Цель: <b>${esc(t.name)}</b>${t.defense !== null ? `, защита ${t.defense}` : ""}` : "Цель не выбрана: итог покажу без сравнения."} Только в своей зоне.</p>
    ${pods.length ? `<div class="form-group"><label>Контейнер</label><select name="pod"><option value="">Бортовая пушка</option>${pods.join("")}</select></div>` : ""}
    ${commonFields(actor, "strafe")}`, { ok: "Огонь" });
  if (!data) return;
  const podItem = data.pod ? actor.items.get(data.pod) : null;
  if (t) {
    const { problems } = reachProblems(actor, t, podItem?.system.reach ?? TB.range.guns);
    if (podItem?.system.key === "PLSL" && weatherAt(actor).list.some(d => d.id === "clouds")) problems.push("Облачность: импульсный лазер не бьёт.");
    if (!(await confirmReach(problems, "Guns, Guns, Guns!"))) return;
  }
  const dice = await rollDice(actor, data.practiced);
  let strafe = null;
  let gun = s.gun ?? 0;
  let label = "Guns, Guns, Guns!";
  if (actor.type === "npc" && s.kind === "ground") { strafe = s.ground.strafe; gun = s.ground.gun ?? 0; }
  if (actor.type === "npc" && s.kind === "ship" && sysIndex !== undefined) {
    const y = s.systems[sysIndex];
    gun = y?.gun ?? 0; label = `Огонь: ${y?.name}`;
    strafe = /Strafe \+(\d)/.exec(y?.note ?? "")?.[1] ? Number(/Strafe \+(\d)/.exec(y.note)[1]) : 0;
  }
  const parts = strafe === null ? skillParts(actor, "strafe", "Пушка") : [["Пушка", strafe]];
  const pod = data.pod ? actor.items.get(data.pod) : null;
  if (pod?.system.key === "MGP") { parts.push(["MGP", 1]); gun += 3; label += " (MGP)"; }
  if (pod?.system.key === "PLSL") { parts.push(["PLSL", 1]); gun = 6; label = "Импульсный лазер"; }
  parts.push(...await takeNext(actor));
  const speed = actor.type === "npc" && s.kind !== "air" ? 0 : (s.speed ?? 0);
  if (speed) parts.push(["Speed", -speed]);
  if (data.mod) parts.push(["мод.", data.mod]);
  const card = {
    type: "attack", attack: true, label, rolled: true, d10: dice.d10, d4: dice.d4, parts, strain: 0,
    dc: t && t.kind !== "ship" ? t.defense : null, vsLabel: "защиты", vsHint: t?.kind === "ship" ? "по Occlusion системы" : "",
    strainable: actor.type === "pilot" || s.tier === "ace", practiced: !!data.practiced,
    dmg: gun, delayed: false, targetUuid: t?.uuid ?? null, targetName: t?.name ?? "",
    notes: pod?.system.key === "PLSL" ? ["Бьёт в своей и соседних зонах. Облака блокируют лазер."] : [],
    ...thresholds(actor, "strafe", data.storm)
  };
  return postCard(actor, card, dice.rolls);
}

/** Пуск ЗРК или ракета корабельной системы: G-A, Speed 0, без броска. */
export async function fireSam(actor, sysIndex) {
  const s = actor.system;
  const t = currentTarget();
  let ga = s.ground?.ga, label = "Пуск ЗРК";
  if (s.kind === "ship") { const y = s.systems[sysIndex]; ga = y?.ga; label = `Пуск: ${y?.name}`; }
  const data = await formDialog(label, `
    <p class="tb-hint">${t ? `Цель: <b>${esc(t.name)}</b>, защита ${t.defense}` : "Цель не выбрана."} Lock On и пуск: два действия.</p>
    <div class="form-group"><label>Модификатор</label><input type="number" name="mod" value="0"></div>`, { ok: "Пуск" });
  if (!data) return;
  const parts = [["G-A", ga ?? 0]];
  if (data.mod) parts.push(["мод.", data.mod]);
  const card = {
    type: "attack", attack: true, label, rolled: false, parts, strain: 0, dc: t?.defense ?? null, vsLabel: "защиты",
    dmg: TB.missileDamage, delayed: true, combatKey: combatKey(), targetUuid: t?.uuid ?? null, targetName: t?.name ?? "",
    notes: [combatKey() ? "Ракета долетит в конце раунда: залп посчитается сам." : "Ракета долетает в конце раунда."]
  };
  return postCard(actor, card);
}

/* ---------- залп конца раунда ---------- */

/** Карточка залпа: по строке на цель и одна кнопка урона для ведущего. */
function renderVolley(c) {
  const rk = n => `${n} ${n % 10 === 1 && n % 100 !== 11 ? "ракета" : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? "ракеты" : "ракет"}`;
  const rows = c.targets.map(r => {
    if (r.ship) return `<div class="tb-volley-row"><b>${esc(r.name)}</b>: ${rk(r.count)}, лучшая ${r.best}. Корабль: сравните с Occlusion системы, урон кнопками на карточках пусков.</div>`;
    if (r.missing) return `<div class="tb-volley-row muted"><b>${esc(r.name)}</b>: цели нет на сцене.</div>`;
    const boost = r.boosts ? ` +${r.boosts} от остальных` : "";
    const verdict = r.hit ? `<b class="ok">Попадание, ${r.dmg} урона</b>${r.added ? ` (сложен урон ${r.added + 1} ракет)` : ""}` : `<b class="fail">Промах</b>`;
    return `<div class="tb-volley-row ${r.hit ? "hit" : "miss"}"><b>${esc(r.name)}</b>: ${rk(r.count)} (${esc(r.shooters)}). Лучшая ${r.best}${boost} против защиты ${r.defense} → ${verdict}</div>`;
  }).join("");
  const hits = c.targets.filter(r => r.hit);
  const btn = hits.length && !c.applied
    ? `<div class="tb-actions"><button type="button" data-tb-action="volley-damage" class="tb-gm"><i class="fas fa-burst"></i> Нанести урон: ${hits.map(r => `${esc(r.name)} ${r.dmg}`).join(", ")}</button></div>` : "";
  return `<div class="tb-card tb-card-volley">
    <header class="tb-card-head"><span class="tb-card-who">AWACS</span><span class="tb-card-what">Конец раунда ${c.round}: залп</span></header>
    ${rows || `<div class="tb-note">Ракет в воздухе не было.</div>`}
    ${c.applied ? `<div class="tb-note">Урон нанесён.</div>` : ""}${btn}
  </div>`;
}

/**
 * Конец раунда: все ракеты этого раунда долетают. По каждой цели берётся самая точная ракета,
 * остальные дают +1 к ней, пока не хватит до защиты, а лишние добавляют свой урон.
 */
export async function resolveVolley(combat) {
  const key = `${combat.id}:${combat.round}`;
  const groups = new Map();
  for (const m of game.messages.contents) {
    const c = m.getFlag(SYSTEM_ID, "card");
    if (!c?.delayed || c.combatKey !== key || c.dmgApplied || c.resolved || !c.targetUuid) continue;
    if (!groups.has(c.targetUuid)) groups.set(c.targetUuid, []);
    groups.get(c.targetUuid).push({ m, c: computeCard(c) });
  }
  if (!groups.size) return null;
  const targets = [];
  const done = [];
  for (const [uuid, list] of groups) {
    list.sort((a, b) => b.c.total - a.c.total);
    const best = list[0].c;
    const shooters = [...new Set(list.map(x => x.c.actorName))].join(", ");
    const actor = resolveActor(uuid);
    if (!actor) { targets.push({ uuid, name: best.targetName, missing: true }); continue; }
    const info = describeTarget(actor, best.targetName);
    if (info.kind === "ship") { targets.push({ uuid, name: info.name, ship: true, count: list.length, best: best.total }); continue; }
    const extra = list.slice(1).map(x => x.c).sort((a, b) => (b.dmg ?? 0) - (a.dmg ?? 0));
    const need = Math.max(0, info.defense - best.total);
    const hit = need <= extra.length;
    const adders = hit ? extra.slice(0, extra.length - need) : [];
    targets.push({
      uuid, name: info.name, count: list.length, shooters, best: best.total, defense: info.defense, hit,
      boosts: hit ? need : 0, added: adders.length, dmg: (best.dmg ?? 0) + adders.reduce((s, x) => s + (x.dmg ?? 0), 0),
      sourceUuid: best.actorUuid, source: best.actorName
    });
    done.push(...list);
  }
  for (const { m } of done) {
    const c = foundry.utils.deepClone(m.getFlag(SYSTEM_ID, "card"));
    c.resolved = true;
    await m.update({ content: renderCard(c), [`flags.${SYSTEM_ID}.card`]: c });
  }
  const card = { type: "volley", round: combat.round, roundKey: key, targets, applied: false };
  return ChatMessage.create({ speaker: { alias: "AWACS" }, content: renderVolley(card), flags: { [SYSTEM_ID]: { card } } });
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
      if ((actor.system.strain.value ?? 0) <= 0) return ui.notifications.warn("Strain закончился.");
      await actor.update({ "system.strain.value": actor.system.strain.value - 1 });
      card.strain = (card.strain ?? 0) + 1;
      await save();
      if (card.type === "break") await applyBreak(actor, card);
      return;
    }
    case "break-speed": {
      if (!actor?.isOwner) return;
      card.speedApplied = true;
      await save();
      return actor.update({ "system.speed": actor.system.speed - card.speedDrop });
    }
    case "recover": {
      if (!actor?.isOwner) return;
      const c = computeCard(card);
      card.applied = true;
      await save();
      const s = actor.system.strain;
      return actor.update({ "system.strain.value": Math.min(s.max, s.value + c.regain) });
    }
    case "stall-ok": {
      if (!actor?.isOwner) return;
      card.applied = true; await save();
      return actor.update({ "system.speed": 1 });
    }
    case "stall-fail": {
      if (!actor?.isOwner) return;
      card.applied = true; await save();
      if (actor.system.alt === "low") return actor.markDoom("Сваливание на Low");
      const down = { high: "med", med: "low" }[actor.system.alt] ?? "low";
      return actor.setAltitude(down);
    }
    case "damage": {
      const target = resolveActor(card.targetUuid);
      if (!target) return ui.notifications.warn("Цель не найдена на сцене.");
      if (!target.isOwner) return ui.notifications.warn("Урон наносит ведущий.");
      const c = computeCard(card);
      card.dmgApplied = true;
      await save();
      return target.applyDamage(c.dmg ?? card.dmg, { source: card.actorName, sourceUuid: card.actorUuid });
    }
    case "perk-next":
    case "comp-next": {
      if (!actor?.isOwner) return;
      const who = await passOutcome(actor, action === "perk-next" ? "perk" : "comp");
      if (!who) return;
      card[action === "perk-next" ? "perkPassed" : "compPassed"] = who.name;
      return save();
    }
    case "volley-damage": {
      if (!game.user.isGM || card.applied) return;
      card.applied = true;
      await save();
      for (const r of card.targets.filter(x => x.hit)) {
        const target = resolveActor(r.uuid);
        if (target) await target.applyDamage(r.dmg, { source: r.source, sourceUuid: r.sourceUuid, roundKey: card.roundKey });
      }
      return;
    }
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
  root.querySelectorAll(".tb-target-owner").forEach(b => { if (!(target?.isOwner && (canEdit || game.user.isGM))) b.remove(); });
  root.querySelectorAll("[data-tb-action]").forEach(b => b.addEventListener("click", ev => {
    ev.preventDefault();
    b.disabled = true;
    onCardAction(message, b.dataset.tbAction, b).finally(() => { b.disabled = false; });
  }));
}
