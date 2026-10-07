/* Броски и чат-карточки: проверки, ракеты, пушка, Break!, Strain, урон, сваливание. */
import { SYSTEM_ID, TB } from "../config.mjs";
import { esc } from "../utils.mjs";

const sign = n => (n >= 0 ? "+" : "−") + Math.abs(n);

/* ---------- вспомогательное ---------- */

/** Актёр по UUID, включая синтетических актёров несвязанных токенов (Scene.x.Token.y.Actor.z). */
export function resolveActor(uuid) {
  if (!uuid) return null;
  const m = /^(.*\.Token\.[^.]+)\.Actor\.[^.]+$/.exec(uuid);
  if (m) return fromUuidSync(m[1])?.actor ?? null;
  const d = fromUuidSync(uuid);
  return d?.actor ?? d ?? null;
}

/** Первая цель игрока на сцене: { actor, name, uuid, defense, kind } или null. */
export function currentTarget() {
  const t = game.user.targets.first();
  if (!t?.actor) return null;
  return describeTarget(t.actor, t.name);
}

export function describeTarget(actor, name) {
  const s = actor.system;
  const kind = actor.type === "pilot" ? "air" : s.kind;
  return { actor, name: name ?? actor.name, uuid: actor.uuid, kind, defense: s.defense ?? null };
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
  if (c.rolled && c.strainable) btn.push(`<button type="button" data-tb-action="strain" class="tb-owner"><i class="fas fa-bolt"></i> +1 Strain</button>`);
  if (c.type === "break" && !c.speedApplied) btn.push(`<button type="button" data-tb-action="break-speed" class="tb-owner">Speed −${c.speedDrop} после атак</button>`);
  if (c.type === "recover" && c.success && !c.applied) btn.push(`<button type="button" data-tb-action="recover" class="tb-owner">Вернуть ${c.regain} Strain</button>`);
  if (c.type === "stall" && !c.applied) {
    if (c.success) btn.push(`<button type="button" data-tb-action="stall-ok" class="tb-owner">Выровняться: Speed 1</button>`);
    else btn.push(`<button type="button" data-tb-action="stall-fail" class="tb-owner">${c.alt === "low" ? "Удар о землю: Doom" : "Потерять высоту"}</button>`);
  }
  if (c.dmg && c.targetUuid && (c.success || c.dc === null || c.dc === undefined) && !c.dmgApplied)
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
  return `
    <div class="form-group"><label>Модификатор</label><input type="number" name="mod" value="0"></div>
    <div class="form-group"><label><input type="checkbox" name="storm"> Ураган: Complication на 1–2</label></div>
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
  const parts = [[sk.label, actor.system.skillTotal[skill]]];
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
  const parts = [["Форсаж", actor.system.skillTotal.push]];
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
  const parts = [["Форсаж", actor.system.skillTotal.push]];
  const card = {
    type: "stall", label: "Сваливание: Push против 7", rolled: true, d10: dice.d10, d4: dice.d4, parts, strain: 0, dc: 7,
    strainable: actor.type === "pilot" || actor.system.tier === "ace", alt: actor.system.alt, ...thresholds(actor, "push"),
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
  const parts = [["Уклонение", actor.system.skillTotal.dodge]];
  if (data.lead) parts.push(["Lead", data.lead]);
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

/** Lock On!: отметить захват текущей цели. */
export async function lockOn(actor) {
  const t = currentTarget();
  if (!t) return ui.notifications.warn("Сначала выберите цель (клавиша T над токеном).");
  await actor.update({ "system.lock": t.name });
  return ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<div class="tb-card tb-card-lock"><header class="tb-card-head"><span class="tb-card-who">${esc(actor.name)}</span><span class="tb-card-what">Lock On!</span></header><div class="tb-note">Захват: <b>${esc(t.name)}</b>. Дальность: своя зона и соседние; срывается дальше двух зон.</div></div>`
  });
}

/** Fox Two!: ракета или спецоружие. Без броска: AA/AG + мод оружия − Speed. Improved: d10 + Aim/Deploy + мод − Speed. */
export async function fireMissile(actor) {
  const s = actor.system;
  const t = currentTarget();
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

  const speed = s.speed ?? 0;
  const parts = [];
  let dice = { d10: null, d4: null, rolls: [] };
  if (data.improved) {
    dice = await rollDice(actor, data.practiced);
    parts.push([TB.skills[skill].label, s.skillTotal[skill]]);
    const m = air ? ws?.aim : ws?.dep;
    if (m) parts.push([`мод ${w.name}`, m]);
  } else {
    let base = air ? s.aa : s.ag;
    if (actor.type === "npc" && actor.system.kind === "ground") base = s.ground.ga ?? 0;
    parts.push([air ? "Air-Air" : "Air-Gnd", base ?? 0]);
    const m = air ? ws?.aa : ws?.ag;
    if (m) parts.push([`мод ${w.name}`, m]);
  }
  if (speed) parts.push(["Speed", -speed]);
  if (data.mod) parts.push(["мод.", data.mod]);

  const dmg = w ? (parseInt(ws.dmg) || 0) : TB.missileDamage;
  const notes = [];
  if (w?.system.fx) notes.push(esc(w.system.fx));
  const hv = w?.system.key === "HVAA";
  const tBroken = t?.actor.system.broken === "ma";
  notes.push(hv || tBroken ? "Попадает в начале хода цели." : "Ракета долетает в конце раунда. Каждая следующая ракета по той же цели: +1 к атаке самой точной или её урон в сумму.");
  if (t?.kind === "ship") notes.push("Корабль: сравните итог с Occlusion выбранной системы.");

  if (w && !ws.unlimited) await w.update({ "system.ammo.value": Math.max(0, (ws.ammo.value ?? 0) - 1) });

  const card = {
    type: "attack", attack: true, label: `Fox Two! ${w ? w.name : "стандартная ракета"}`, rolled: !!data.improved,
    d10: dice.d10, d4: dice.d4, parts, strain: 0, dc: t && t.kind !== "ship" ? t.defense : null, vsLabel: "защиты",
    vsHint: t?.kind === "ship" ? "по Occlusion системы" : "", strainable: !!data.improved && (actor.type === "pilot" || actor.system.tier === "ace"),
    practiced: !!data.practiced, dmg, delayed: !(hv || tBroken), targetUuid: t?.uuid ?? null, targetName: t?.name ?? "", notes,
    ...thresholds(actor, skill, data.storm)
  };
  return postCard(actor, card, dice.rolls);
}

/** Guns, Guns, Guns!: d10 + Strafe − Speed против защиты, урон сразу. */
export async function fireGuns(actor, { system: sysIndex } = {}) {
  const s = actor.system;
  const t = currentTarget();
  if (s.broken === "gu") return ui.notifications.warn("Пушка сломана (метка Structure).");
  if (blocked(actor, "strafe")) return;
  const pods = weaponOptions(actor, false);
  const data = await formDialog("Guns, Guns, Guns!", `
    <p class="tb-hint">${t ? `Цель: <b>${esc(t.name)}</b>${t.defense !== null ? `, защита ${t.defense}` : ""}` : "Цель не выбрана: итог покажу без сравнения."} Только в своей зоне.</p>
    ${pods.length ? `<div class="form-group"><label>Контейнер</label><select name="pod"><option value="">Бортовая пушка</option>${pods.join("")}</select></div>` : ""}
    ${commonFields(actor, "strafe")}`, { ok: "Огонь" });
  if (!data) return;
  const dice = await rollDice(actor, data.practiced);
  let strafe = s.skillTotal.strafe;
  let gun = s.gun ?? 0;
  let label = "Guns, Guns, Guns!";
  if (actor.type === "npc" && s.kind === "ground") { strafe = s.ground.strafe; gun = s.ground.gun ?? 0; }
  if (actor.type === "npc" && s.kind === "ship" && sysIndex !== undefined) {
    const y = s.systems[sysIndex];
    gun = y?.gun ?? 0; label = `Огонь: ${y?.name}`;
    strafe = /Strafe \+(\d)/.exec(y?.note ?? "")?.[1] ? Number(/Strafe \+(\d)/.exec(y.note)[1]) : 0;
  }
  const parts = [["Пушка", strafe]];
  const pod = data.pod ? actor.items.get(data.pod) : null;
  if (pod?.system.key === "MGP") { parts.push(["MGP", 1]); gun += 3; label += " (MGP)"; }
  if (pod?.system.key === "PLSL") { parts.push(["PLSL", 1]); gun = 6; label = "Импульсный лазер"; }
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
    dmg: TB.missileDamage, delayed: true, targetUuid: t?.uuid ?? null, targetName: t?.name ?? "",
    notes: ["Ракета долетает в конце раунда."]
  };
  return postCard(actor, card);
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
      return target.applyDamage(c.dmg ?? card.dmg, { source: card.actorName });
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
  root.querySelectorAll(".tb-target-owner").forEach(b => { if (!(target?.isOwner && (canEdit || game.user.isGM))) b.remove(); });
  root.querySelectorAll("[data-tb-action]").forEach(b => b.addEventListener("click", ev => {
    ev.preventDefault();
    b.disabled = true;
    onCardAction(message, b.dataset.tbAction, b).finally(() => { b.disabled = false; });
  }));
}
