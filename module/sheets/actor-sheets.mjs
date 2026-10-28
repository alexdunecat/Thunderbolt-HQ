/* Листы пилота и NPC (ActorSheet v1, стабильный API Foundry v12). */
import { SYSTEM_ID, SYS_PATH, TB, DT } from "../config.mjs";
import { esc } from "../utils.mjs";
import { weatherAt, defenseWithWeather, tokenOf, zoneDistance, rangeLabel, gunVs, ceilingOf, ALT_ORDER } from "../scene.mjs";
import { nextMods, dropNext, adjacentOf, breakAdjacent } from "../squad.mjs";
import { resolveActor } from "../utils.mjs";
import { squadBudget, pointsText, allSquads, squadLayout, setSquadLayout, squadMembers } from "../squadrons.mjs";
import { runAction, ACTIONS, startActionDrag } from "../macros.mjs";
import { spendAction, actsSummary, allowAction, endTurn } from "../actions.mjs";
import { openDossierExchange } from "../dossier-sync.mjs";
import { aimedWeapon, toggleAim } from "../range.mjs";
import { rollGround, chooseEdge, edgeLabel, dropBond, useBond, useEdge, threats, clockPips, stepThreat, bondCap } from "../downtime.mjs";
import { gloryView } from "../glory.mjs";
import { openChatterEditor, nameOf, setCallsign } from "../chatter.mjs";
import { openCivilRadio, RADIO_TRIGGER } from "../civil-radio.mjs";
import { rack, openMedals } from "../medals.mjs";
import { openHangar, hangarState, inBattle } from "../hangar.mjs";
import { CT, ctView, useCombatTrigger } from "../combat-triggers.mjs";
import { NEM, STATE_TEXT, nemTriggers, trigState, metOf, useTrigger, appear, monologue, startMonologue, endMonologue, fxOf, clearFx } from "../nemesis.mjs";
import { sheetPlane, useMove, useAoa } from "../plane-roles.mjs";

/** Короткая подпись эффектов триггера: «Макс. HP +1 · Все броски +2 (пока включён)». */
export function describeChanges(changes) {
  return changes.map(c => {
    const label = TB.effectTargets[c.target] ?? c.target;
    const val = /^(perk|comp)\./.test(c.target) ? ` ${c.value}` : ` ${c.value >= 0 ? "+" : ""}${c.value}`;
    const when = c.when !== "always" ? ` (${TB.effectWhen[c.when] ?? c.when})` : "";
    return label + val + when;
  }).join(" · ");
}

const opts = obj => Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, typeof v === "string" ? v : v.label]));

function weaponView(w, bonus = 0) {
  const s = w.system;
  const mods = [];
  if (s.aa !== null) mods.push(`AA ${s.aa >= 0 ? "+" : ""}${s.aa}`);
  if (s.ag !== null) mods.push(`AG ${s.ag >= 0 ? "+" : ""}${s.ag}`);
  if (s.aim !== null) mods.push(`Aim ${s.aim >= 0 ? "+" : ""}${s.aim}`);
  if (s.dep !== null) mods.push(`Deploy ${s.dep >= 0 ? "+" : ""}${s.dep}`);
  return { id: w.id, name: w.name, img: w.img, key: s.key, dmg: s.dmg, fx: s.fx, mods: mods.join(" · "), trait: s.trait,
    unlimited: s.ammo.max === null, ammo: s.ammo.value, offline: s.offline, max: s.ammo.max === null ? null : s.ammo.max + bonus, bonus, target: TB.weaponTargets[s.target] ?? "",
    range: s.target === "util" ? "действует на свою и соседние зоны" : s.target === "line" ? "линия через всю зону операции" : rangeLabel(s.reach) };
}

/** Боевой триггер для листа: кнопка, состояние, подсказка, что действует. */
function ctSheet(actor, t) {
  const v = ctView(actor, t);
  return v ? { ...v, on: v.state === "on", waiting: v.state === "wait" && !v.use } : null;
}

class TBActorSheet extends ActorSheet {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ["thunderbolt", "sheet", "actor"],
      width: 760, height: 780,
      scrollY: [".tb-body"],
      dragDrop: [{ dragSelector: ".tb-item[data-item-id]", dropSelector: null }]
    });
  }

  async getData(options) {
    const ctx = await super.getData(options);
    const a = this.actor, s = a.system;
    ctx.system = s;
    ctx.TB = TB;
    ctx.skills = Object.entries(TB.skills).map(([k, v]) => ({
      key: k, ...v, value: s.skills[k], total: s.skillTotal[k], mod: s.skillMod?.[k] ?? 0, blocked: s.skillBlocked[k],
      perk3: (s.perkOn?.[k] ?? 4) < 4, comp2: (s.compOn?.[k] ?? 1) > 1
    }));
    // выше потолка машины в списке высот ничего нет (кроме текущей, если она там уже оказалась)
    const ceil = ceilingOf(a);
    ctx.altOptions = ceil ? Object.fromEntries(Object.entries(TB.altitudes).filter(([k]) => ALT_ORDER.indexOf(k) <= ALT_ORDER.indexOf(ceil) || k === s.alt)) : TB.altitudes;
    ctx.ceiling = ceil ? TB.altitudes[ceil] : "";
    ctx.skillOptions = opts(TB.skills);
    ctx.sysOptions = Object.fromEntries(Object.entries(TB.systems).map(([k, v]) => [k, `${v.label}: ${v.hint}`]));
    const aim = aimedWeapon(a)?.id;
    ctx.weapons = a.items.filter(i => i.type === "weapon").map(w => ({ ...weaponView(w, s.ammoBonus?.[w.id] ?? 0), aimed: w.id === aim }));
    ctx.enrichedNotes = await TextEditor.enrichHTML(s.notes, { secrets: a.isOwner, relativeTo: a });
    ctx.isGM = game.user.isGM;
    const w = weatherAt(a);
    ctx.weather = w.list.map(d => ({ ico: d.ico, name: d.name, txt: d.txt }));
    if (s.defense !== null && s.defense !== undefined) {
      ctx.defenseNow = defenseWithWeather(a, w);
      ctx.defenseWeather = ctx.defenseNow !== s.defense;
    }
    ctx.maxSpeedNow = (s.maxSpeed ?? 0) + w.spd;
    ctx.nextMods = nextMods(a).map((m, i) => ({ ...m, i, sval: `${m.value >= 0 ? "+" : ""}${m.value}` }));
    ctx.adjacent = adjacentOf(a).map(uuid => ({ uuid, name: resolveActor(uuid)?.name ?? "?" }));
    ctx.acts = actsSummary(a);
    ctx.lockInfo = lockInfo(a);
    // роль машины, её черта и фирменный приём (Стрэйнджриал 8.5–8.6)
    ctx.planeRole = ["pilot", "npc"].includes(a.type) ? sheetPlane(a) : null;
    ctx.sides = TB.sides;
    ctx.insigniaHint = a.type === "pilot" ? "Шильдик авиакрыла на токене. Щелчок: выбрать картинку, правый щелчок: убрать."
      : "Шильдик авиакрыла или страны на токене. Щелчок: выбрать картинку, правый щелчок: убрать.";
    return ctx;
  }

  activateListeners(html) {
    super.activateListeners(html);
    const el = html[0];
    el.closest(".app")?.setAttribute("data-tb-skin", "brief");
    // полный рост смотрят и те, кому лист только виден
    const a = this.actor;
    el.querySelectorAll("[data-art-show]").forEach(n => n.addEventListener("click", ev => {
      ev.preventDefault();
      if (a.system.artwork) new ImagePopout(a.system.artwork, { title: a.name, uuid: a.uuid, shareable: true }).render(true);
    }));
    if (!this.isEditable) return;
    const on = (sel, fn) => el.querySelectorAll(sel).forEach(n => n.addEventListener("click", ev => { ev.preventDefault(); fn(n.dataset, n, ev); }));
    personListeners(this.actor, el);

    on("[data-roll-skill]", d => runAction(this.actor, "skill", { skill: d.rollSkill }));
    // шильдик на токене: картинка из файлов мира
    on("[data-insignia]", () => new FilePicker({ type: "image", current: this.actor.system.insignia,
      callback: path => this.actor.update({ "system.insignia": path }) }).render(true));
    el.querySelector("[data-insignia]")?.addEventListener("contextmenu", ev => {
      ev.preventDefault();
      if (this.actor.system.insignia) this.actor.update({ "system.insignia": "" });
    });
    on("[data-act]", d => {
      const a = this.actor;
      switch (d.act) {
        case "sortie": return a.prepareSortie();
        case "move": return useMove(a);
        case "aoa": return useAoa(a);
        case "unlock": return a.update({ "system.lock": "", "system.lockUuid": "" });
        case "lock-focus": {
          const t = a.system.lockUuid ? tokenOf(resolveActor(a.system.lockUuid)) : null;
          if (!t) return ui.notifications.warn("Цели захвата нет на этой сцене.");
          return canvas.animatePan({ x: t.center.x, y: t.center.y, duration: 250 });
        }
        case "unbreak": return a.update({ "system.breakEv": null });
        case "doom": return a.markDoom();
        default: return runAction(a, d.act);
      }
    });
    // кнопки действий и кубики навыков можно перетащить на панель макросов
    el.querySelectorAll("[data-act], [data-roll-skill]").forEach(n => {
      const act = n.dataset.rollSkill ? "skill" : n.dataset.act;
      if (act !== "skill" && !ACTIONS[act]) return;
      n.draggable = true;
      n.addEventListener("dragstart", ev => startActionDrag(ev, this.actor, act, n.dataset.rollSkill));
    });
    on("[data-speed]", async d => {
      const v = Math.min(this.actor.system.maxSpeed + weatherAt(this.actor).spd, this.actor.system.speed + Number(d.speed));
      if (v === this.actor.system.speed) return;
      await this.actor.update({ "system.speed": v });   // действие считает хук в actions.mjs
    });
    on("[data-step]", d => {
      const path = d.step, cur = foundry.utils.getProperty(this.actor, path) ?? 0;
      const max = d.max !== undefined ? Number(d.max) : Infinity;
      this.actor.update({ [path]: Math.max(0, Math.min(max, cur + Number(d.delta))) });
    });
    on("[data-item-edit]", d => this.actor.items.get(d.itemEdit)?.sheet.render(true));
    on("[data-item-delete]", async d => {
      const item = this.actor.items.get(d.itemDelete);
      if (item && await Dialog.confirm({ title: "Убрать", content: `<p>Убрать «${esc(item.name)}» с листа?</p>` })) item.delete();
    });
    on("[data-ammo]", d => {
      const item = this.actor.items.get(d.ammo);
      if (!item || item.system.ammo.max === null) return;
      const max = item.system.ammo.max + (this.actor.system.ammoBonus?.[item.id] ?? 0);
      const v = Math.max(0, Math.min(max, item.system.ammo.value + Number(d.delta)));
      item.update({ "system.ammo.value": v });
    });
    on("[data-civil-radio]", () => openCivilRadio());
    on("[data-item-toggle]", d => {
      const item = this.actor.items.get(d.itemToggle);
      item?.update({ "system.used": !item.system.used });
    });
    on("[data-trigger-active]", d => {
      const item = this.actor.items.get(d.triggerActive);
      // «Отставить болтовню», «Не такой ценой»: только после Поворота
      if (item && !item.system.active && CT[item.system.key]?.twist && !this.actor.system.twist)
        return ui.notifications.warn(`«${item.name}» работает только после Поворота: сначала отметьте «Поворот».`);
      item?.update({ "system.active": !item.system.active });
    });
    on("[data-trigger-stack]", d => {
      const item = this.actor.items.get(d.triggerStack);
      if (item) item.update({ "system.stack": Math.max(0, item.system.stack + Number(d.delta)) });
    });
    on("[data-chat-item]", d => this.#itemToChat(this.actor.items.get(d.chatItem)));
    on("[data-nem-use]", d => useTrigger(this.actor, this.actor.items.get(d.nemUse)));
    on("[data-ct-use]", d => useCombatTrigger(this.actor, this.actor.items.get(d.ctUse)));
    on("[data-weapon-on]", d => this.actor.items.get(d.weaponOn)?.unsetFlag(SYSTEM_ID, "off"));
    on("[data-medals]", () => openMedals(this.actor));
    on("[data-end-turn]", () => endTurn(this.actor));
    // прицел: подсветка дальности по этому спецоружию (повторный щелчок — снова стандартная ракета)
    on("[data-aim]", d => {
      toggleAim(this.actor, d.aim);
      const t = tokenOf(this.actor);
      if (t && !t.controlled && t.isOwner) t.control({ releaseOthers: true });
      this.render(false);
    });
    on("[data-next-drop]", d => dropNext(this.actor, Number(d.nextDrop)));
    on("[data-adj-drop]", d => breakAdjacent(this.actor, d.adjDrop));
    el.querySelectorAll("[data-item-field]").forEach(n => n.addEventListener("change", ev => {
      const item = this.actor.items.get(n.dataset.itemId);
      item?.update({ [n.dataset.itemField]: n.value });
    }));
  }

  async #itemToChat(item) {
    if (!item) return;
    const s = item.system;
    const body = item.type === "trigger" ? s.text : item.type === "weapon" ? s.fx : s.desc;
    return ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: this.actor }),
      content: `<div class="tb-card"><header class="tb-card-head"><span class="tb-card-who">${esc(this.actor.name)}</span><span class="tb-card-what">${esc(item.name)}</span></header><div class="tb-note">${esc(body)}</div></div>`
    });
  }
}

/** Строка захвата на листе: на кого навёлся, сколько до него зон, видна ли цель. */
function lockInfo(actor) {
  const s = actor.system;
  if (!s.lockUuid && !s.lock) return null;
  const target = s.lockUuid ? resolveActor(s.lockUuid) : null;
  const dist = zoneDistance(tokenOf(actor), tokenOf(target));
  return {
    name: target?.token?.name ?? target?.name ?? s.lock, gone: !target || !tokenOf(target),
    dist: dist === null ? "" : dist === 0 ? "в своей зоне" : `${dist} ${dist === 1 ? "зона" : "зоны"}`
  };
}

/* ---------- личное дело: картинки, Связи, цели, долги (пилот, NPC, персонаж на земле) ---------- */

const pipsOf = (n, val, from = 1) => Array.from({ length: n }, (_, k) => ({ i: k + from, on: k + from <= val }));
/** Предел Связи: у пилота по правилам даунтайма, у NPC и персонажа на земле до 3. */
const capOf = (a, npc) => a.type === "pilot" ? bondCap(a, npc) : DT.maxBond;

/** Картинки, Связи, цели, долги и Немезида для листа. */
export function personView(a) {
  const s = a.system;
  const tokenSrc = a.isToken ? a.token?.texture?.src : a.prototypeToken?.texture?.src;
  const pilots = (game.actors ?? []).filter(p => p.type === "pilot");
  const nemesisOf = s.nemesisOf ? pilots.find(p => p.id === s.nemesisOf) : null;
  return {
    images: [
      { key: "img", label: "Лицо", hint: "в списке актёров и в шапке листа", src: a.img, fate: fateOfActor(a) },
      { key: "artwork", label: "Полный рост", hint: "артворк персонажа", src: s.artwork, show: true, clear: true },
      { key: "token", label: "Токен", hint: a.type === "staff" ? "если персонаж выйдет на сцену" : "на поле боя: его самолёт", src: tokenSrc }
    ],
    bonds: (s.bonds ?? []).map((b, i) => ({ ...b, i, was: (b.was ?? []).join(", "), pips: pipsOf(capOf(a, b.npc), b.value) })),
    goals: (s.goals ?? []).map((g, i) => ({ ...g, i, small: g.size <= 4, done: g.value >= g.size, pips: clockPips(g.value, g.size) })),
    debts: (s.debts ?? []).map((d, i) => ({ ...d, i })),
    pilotOptions: Object.fromEntries(pilots.map(p => [p.id, p.system.callsign ? `${p.system.callsign} (${p.name})` : p.name])),
    nemesisName: nemesisOf ? nemesisOf.system.callsign || nemesisOf.name : ""
  };
}

/** Картинка актёра: лицо (img), полный рост (system.artwork) или токен (у связанного актёра — и его токены на сценах). */
export async function setImage(actor, key, path) {
  if (key === "img") return actor.update({ img: path });
  if (key === "artwork") return actor.update({ "system.artwork": path });
  if (actor.isToken) return actor.token.update({ "texture.src": path });
  const old = actor.prototypeToken.texture.src;
  await actor.update({ "prototypeToken.texture.src": path });
  for (const t of actor.getActiveTokens(false, true)) if (t.texture.src === old && t.isOwner) await t.update({ "texture.src": path });
}

/** Обработчики личного дела: картинки, Связи, цели, долги. */
function personListeners(a, el) {
  const on = (sel, fn) => el.querySelectorAll(sel).forEach(n => n.addEventListener("click", ev => { ev.preventDefault(); fn(n.dataset, n); }));
  const clone = k => foundry.utils.deepClone(a.system[k]);
  const current = key => key === "img" ? a.img : key === "artwork" ? a.system.artwork : a.isToken ? a.token?.texture?.src : a.prototypeToken.texture.src;
  on("[data-img-pick]", d => new FilePicker({ type: "image", current: current(d.imgPick), callback: path => setImage(a, d.imgPick, path) }).render(true));
  on("[data-img-clear]", d => setImage(a, d.imgClear, ""));
  on("[data-bond-add]", () => addBondDialog(a));
  on("[data-bond-set]", d => {
    const i = Number(d.bondSet), b = a.system.bonds[i];
    if (!b) return;
    const v = Number(d.v), next = v === b.value ? v - 1 : v;
    if (next < b.value) return a.update({ "system.bonds": dropBond(a.system.bonds, i, next) });
    const list = clone("bonds");
    list[i].value = Math.min(capOf(a, b.npc), next);
    a.update({ "system.bonds": list });
  });
  on("[data-bond-del]", async d => {
    const b = a.system.bonds[Number(d.bondDel)];
    if (!b || !(await Dialog.confirm({ title: "Связь", content: `<p>Убрать Связь с «${esc(b.name)}» с листа? Обычно разрыв зачёркивают, а не стирают.</p>` }))) return;
    // товарищ-пилот: ведущий сотрёт Связь и на его листе
    a.update({ "system.bonds": clone("bonds").filter((_, i) => i !== Number(d.bondDel)) }, b.uuid && !b.npc ? { tbBondDrop: b.uuid } : {});
  });
  on("[data-goal-add]", () => a.update({ "system.goals": [...clone("goals"), { name: "", size: 4, value: 0 }] }));
  on("[data-goal-del]", d => a.update({ "system.goals": clone("goals").filter((_, i) => i !== Number(d.goalDel)) }));
  on("[data-goal-set]", d => {
    const list = clone("goals"), g = list[Number(d.goalSet)];
    if (!g) return;
    const v = Number(d.v) + 1;
    g.value = v === g.value ? v - 1 : v;
    a.update({ "system.goals": list });
  });
  el.querySelectorAll("[data-goal-field]").forEach(n => n.addEventListener("change", ev => {
    ev.stopPropagation();
    const list = clone("goals"), g = list[Number(n.dataset.goal)];
    if (!g) return;
    if (n.dataset.goalField === "size") { g.size = Number(n.value) || 4; g.value = Math.min(g.value, g.size); } else g.name = n.value;
    a.update({ "system.goals": list });
  }));
  on("[data-debt-add]", async () => {
    const data = await formDialogLite("Долг", `<div class="form-group"><label>Кому и что должен</label><input type="text" name="text"></div>`);
    if (data?.text) a.update({ "system.debts": [...clone("debts"), { text: data.text, struck: false }] });
  });
  on("[data-debt-strike]", d => { const list = clone("debts"), x = list[Number(d.debtStrike)]; if (x) { x.struck = !x.struck; a.update({ "system.debts": list }); } });
}

/* ---------- даунтайм на листе ---------- */

const NERVES_NOTE = ["Спокоен.", "Держится.", "Держится, но устал.", "Нервы 3: вылет со Strain на 2 ниже максимума.",
  "Нервы 4: вылет со Strain на 2 ниже максимума.", "Нервы 5, на пределе: перед вылетом выбрать, лететь на пределе или подать рапорт об отдыхе."];

const EDGE_HINT = {
  tune: "временная настройка машины на один вылет", ammo: "+1 к боезапасу на вылет", rare: "то, чего нет в обычном ангаре",
  intel: "вопрос AWACS до брифинга или +2 к одной атаке по врагу", practice: "раз за вылет перебросить d10 этого навыка: кнопка на карточке броска",
  fresh: "+2 Strain сверх максимума на старте", memory: "раз в вылете к любому броску", fatigue: "последствие на вылет", trauma: "последствие на вылет", custom: "по договорённости с AWACS"
};

function downtimeView(a) {
  const s = a.system;
  const pips = (n, val, from = 1) => Array.from({ length: n }, (_, k) => ({ i: k + from, on: k + from <= val }));
  const edges = s.edges.map(e => ({ ...e, label: edgeLabel(e, a), hint: EDGE_HINT[e.kind] ?? "", notEdge: DT.notEdges.includes(e.kind),
    needsMinus: e.kind === "tune" && ["ev", "spd"].includes(e.stat) && e.mode !== "perk", isAmmo: e.kind === "ammo",
    // встречная цена — другая характеристика: своя же дала бы ноль
    minusOptions: Object.fromEntries(Object.entries(DT.tuneMinus).filter(([k]) => k !== e.stat).map(([k, v]) => [k, `${v[1]} −1`])) }));
  const live = s.bonds.map((b, i) => ({ ...b, i })).filter(b => !b.dead && b.value > 0);
  const edgeChips = s.edges.filter(e => e.kind === "memory" || (e.kind === "intel" && e.mode === "weak"))
    .map(e => ({ id: e.id, used: e.used, label: e.kind === "memory" ? `Память: ${e.text} +${e.value}` : `Слабое место${e.text ? `: ${e.text}` : ""} +2`,
      hint: e.used ? "Уже использовано в этом вылете" : "Щелчок: прибавить к следующему броску" }));
  const passive = s.edges.filter(e => !["memory", "intel"].includes(e.kind) || (e.kind === "intel" && e.mode !== "weak")).map(e => edgeLabel(e, a));
  const breakdown = s.breakdown && DT.breakdowns[s.breakdown] ? DT.breakdowns[s.breakdown] : null;
  return {
    nervesPips: pips(5, s.nerves).map(p => ({ ...p, cls: p.i >= 5 ? "edge" : p.i >= 3 ? "high" : "" })),
    nervesNote: NERVES_NOTE[s.nerves] ?? "", nervesWarn: s.nerves >= 3,
    edgeAsk: s.nerves >= DT.maxNerves && !s.onEdge, edgeFly: s.edgeFly, breakdown,
    alert: s.nerves >= DT.maxNerves && !s.onEdge,
    resolvePips: pips(DT.maxResolve, s.resolve), actionPips: pips(2, s.downtime.actions),
    actions: Object.entries(DT.actions).map(([key, x]) => ({ key, label: x.label, hint: x.hint, roll: x.skills.length > 0,
      off: key === "breakdown" && s.nerves < DT.maxNerves })),
    edges, maxEdges: DT.maxEdges, edgesOver: s.edgeCount > DT.maxEdges,
        bonds: s.bonds.map((b, i) => ({ ...b, i, was: (b.was ?? []).join(", "), pips: pips(bondCap(a, b.npc), b.value) })),
    fee: a.items.some(i => i.type === "trigger" && i.system.key === "contract") ? pips(3, s.fee) : null,
    goals: s.goals.map((g, i) => ({ ...g, i, small: g.size <= 4, done: g.value >= g.size, pips: clockPips(g.value, g.size) })),
    debts: s.debts.map((d, i) => ({ ...d, i })),
    threats: threats().filter(t => t.kind !== "boss").map(t => ({ ...t, pips: clockPips(t.value, t.size), full: t.value >= t.size })),
    bondChips: live, edgeChips, passive,
    sortie: live.length || edgeChips.length || passive.length || s.edgeFly || !!breakdown
  };
}

/** Простое окно ввода без кнопки броска. */
function formDialogLite(title, content) {
  return new Promise(resolve => new Dialog({
    title, content: `<form class="tb-dialog">${content}</form>`,
    buttons: {
      ok: { icon: '<i class="fas fa-check"></i>', label: "Записать", callback: html => {
        const out = {};
        for (const el of html[0].querySelector("form").elements) if (el.name) out[el.name] = el.type === "checkbox" ? el.checked : el.value;
        resolve(out);
      } },
      cancel: { icon: '<i class="fas fa-times"></i>', label: "Отмена", callback: () => resolve(null) }
    },
    default: "ok", close: () => resolve(null)
  }, { classes: ["dialog", "thunderbolt"], width: 420 }).render(true));
}

/** Новая Связь: с другим пилотом (запишется на обоих листах) или с NPC. */
async function addBondDialog(actor) {
  const pilots = game.actors.filter(p => p.type === "pilot" && p.id !== actor.id && !actor.system.bonds.some(b => b.uuid === p.uuid));
  const data = await formDialogLite("Связь", `
    <div class="form-group"><label>С кем</label><select name="who">${pilots.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join("")}<option value="npc">NPC…</option></select></div>
    <div class="form-group"><label>Имя NPC</label><input type="text" name="npc" placeholder="старший техник Ершов"></div>
    <div class="form-group"><label>Связь</label><select name="value"><option value="1" selected>1</option><option value="2">2</option><option value="3">3</option></select></div>
    <p class="tb-hint">${actor.type === "pilot" ? "Связь с пилотом записывается на листах обоих. С NPC Связей не больше двух, и сама Связь не выше 2." : "Связь записывается только на этом листе."}</p>`);
  if (!data) return;
  const list = foundry.utils.deepClone(actor.system.bonds);
  const p = data.who !== "npc" ? game.actors.get(data.who) : null;
  const npc = !p;
  const name = p?.name ?? data.npc;
  if (!name) return;
  if (npc && actor.type === "pilot" && list.filter(b => b.npc && !b.dead).length >= 2) return ui.notifications.warn("Связей с NPC уже две.");
  const value = Math.min(capOf(actor, npc), Number(data.value) || 1);
  list.push({ name, uuid: p?.uuid ?? "", npc, value, was: [], dead: false, used: false, usedGround: false, grown: false });
  return actor.update({ "system.bonds": list });
}

/** Задел или последствие вручную (по решению AWACS). */
async function addEdgeDialog(actor) {
  const opt = obj => Object.entries(obj).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join("");
  const data = await formDialogLite("Задел вручную", `
    <div class="form-group"><label>Вид</label><select name="kind">${opt(DT.edges)}</select></div>
    <div class="form-group"><label>Доводка</label><select name="stat">${opt(Object.fromEntries(Object.entries(DT.tune).map(([k, v]) => [k, v[2]])))}</select></div>
    <div class="form-group"><label>Навык</label><select name="skill">${opt(Object.fromEntries(Object.entries(TB.skills).map(([k, v]) => [k, v.label])))}</select></div>
    <div class="form-group"><label>Разведданные</label><select name="mode"><option value="question">вопрос</option><option value="weak">слабое место: +2 к атаке</option></select></div>
    <div class="form-group"><label>Текст или имя</label><input type="text" name="text"></div>
    <div class="form-group"><label>Размер (для Памяти)</label><input type="number" name="value" value="1"></div>
    <p class="tb-hint">Нужны только поля, подходящие к виду: доводке параметр, Наработке и Травме навык, Разведданным режим.</p>`);
  if (!data) return;
  if (!DT.notEdges.includes(data.kind) && actor.system.edgeCount >= DT.maxEdges) return ui.notifications.warn(`Заделов уже ${DT.maxEdges}: уберите один.`);
  const e = { id: foundry.utils.randomID(), kind: data.kind, text: data.text ?? "", value: Number(data.value) || 0 };
  if (data.kind === "tune") e.stat = data.stat;
  if (["practice", "trauma"].includes(data.kind)) e.skill = data.skill;
  if (data.kind === "intel") e.mode = data.mode;
  return actor.update({ "system.edges": [...foundry.utils.deepClone(actor.system.edges), e] });
}

// отметка на портрете: погибший темнее с красной строкой K.I.A., пропавший без вести или в плену с жёлтой M.I.A.
export function fateOf(status) {
  const kia = { key: "kia", label: "K.I.A." }, mia = { key: "mia", label: "M.I.A." }, out = { key: "out", label: "ВЫБЫЛ" };
  return { kia, mia, pow: mia, retired: out }[status] ?? null;
}
export const fateOfActor = a => fateOf(a?.type === "pilot" ? a.system?.service?.status : a?.system?.status);

export class PilotSheet extends TBActorSheet {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ["thunderbolt", "sheet", "actor", "pilot"],
      template: SYS_PATH + "templates/actor/pilot-sheet.hbs",
      tabs: [{ navSelector: ".tb-tabs", contentSelector: ".tb-body", initial: "combat" }]
    });
  }

  /** Кнопка «Штаб» в шапке: обмен личным делом с Штабом кодом. */
  _getHeaderButtons() {
    const buttons = super._getHeaderButtons();
    if (this.actor.isOwner) buttons.unshift({ label: "Штаб", class: "tb-shtab-sync", icon: "fas fa-id-card", onclick: () => openDossierExchange(this.actor) });
    return buttons;
  }

  async getData(options) {
    const ctx = await super.getData(options);
    const a = this.actor, s = a.system;
    const plane = s.plane;
    ctx.hangarOpen = hangarState().open;
    ctx.plane = plane ? {
      id: plane.id, name: plane.name, img: plane.img, ...plane.system,
      statRows: Object.entries(TB.planeStats).map(([k, [en, ru]]) => ({ key: k, en, ru, value: plane.system.stats[k] })),
      sigNames: plane.system.sig.join(", ")
    } : null;
    ctx.serviceLog = (s.service.log ?? []).map((x, i) => ({ ...x, i, n: i + 1 })).reverse();
    const weaponOpts = Object.fromEntries(a.items.filter(i => i.type === "weapon" && i.system.ammo.max !== null).map(w => [w.id, w.name]));
    ctx.triggers = a.items.filter(i => i.type === "trigger").map(t => ({
      id: t.id, name: t.name, ...t.system, typeText: t.system.types.join(" · "),
      archName: TB.archetypes[t.system.archetype]?.label ?? "", needsSkill: t.system.skills > 0, needsTwo: t.system.skills > 1,
      hasToggle: t.system.hasToggle, hasStack: t.system.hasStack, needsWeapon: t.system.needsWeapon,
      toggleHint: TB.toggleHints[t.system.key] ?? "ситуативный бонус",
      fxText: describeChanges(t.system.changes),
      hasOpts: t.system.skills > 0 || t.system.needsWeapon || t.system.hasToggle || t.system.hasStack,
      radio: t.system.key === RADIO_TRIGGER,
      nem: !!NEM[t.system.key] && t.system.types.includes("Nemesis"), nemState: trigState(a, t), nemHint: STATE_TEXT[trigState(a, t)],
      ct: ctSheet(a, t)
    }));
    // кнопками боевых триггеров управляет «задействовать», ручного переключателя у них нет
    for (const t of ctx.triggers) if (t.ct?.use) t.hasToggle = false;
    ctx.weaponOpts = weaponOpts;
    ctx.situational = ctx.triggers.filter(t => t.hasToggle || t.hasStack);
    // триггеры Немезиды: открываются, когда она появилась в вылете; кнопка «Задействовать»
    const nem = nemTriggers(a);
    ctx.nemesis = nem.length ? { met: metOf(a)?.name ?? "", list: nem.map(t => {
      const st = trigState(a, t);
      return { id: t.id, name: t.name, state: st, hint: `${NEM[t.system.key].fx}. ${STATE_TEXT[st]}` };
    }) } : null;
    ctx.activeFx = Object.entries(s.trigFx ?? {}).flatMap(([target, list]) =>
      list.map(m => ({ label: TB.effectTargets[target] ?? target, name: m.name, sval: `${m.value >= 0 ? "+" : ""}${m.value}` })));
    ctx.archOptions = opts(TB.archetypes);
    ctx.statusOptions = TB.status;
    ctx.fate = fateOf(s.service?.status);
    ctx.person = personView(a);
    ctx.pointsOver = s.pointsUsed > s.pointsBudget;
    ctx.weaponsOver = ctx.weapons.length > (s.hardpoints ?? 0);
    ctx.dossier = s.dossier.map((d, i) => ({ ...d, i }));
    ctx.alertSpeed = s.speed <= 0;
    ctx.dt = downtimeView(a);
    ctx.medals = rack(a);
    ctx.glory = gloryView();
    // открытые шкалы боя (Тревога стелс-миссии): игроки видят их на боевой карточке
    ctx.openClocks = threats().filter(t => t.kind === "boss" && t.open).map(t => ({ ...t, pips: clockPips(t.value, t.size), full: t.value >= t.size }));
    return ctx;
  }

  activateListeners(html) {
    super.activateListeners(html);
    if (!this.isEditable) return;
    const el = html[0];
    el.querySelector("[data-hangar]")?.addEventListener("click", ev => { ev.preventDefault(); openHangar(this.actor); });
    // досье: строки можно зачёркивать, но не стирать
    el.querySelectorAll("[data-dossier]").forEach(n => n.addEventListener("change", () => this.#saveDossier(el)));
    // ведущий правит дату и название операции прямо в таблице
    for (const [attr, field] of [["oplogDate", "date"], ["oplogOp", "op"]]) el.querySelectorAll(`[data-${attr === "oplogDate" ? "oplog-date" : "oplog-op"}]`).forEach(n => n.addEventListener("change", ev => {
      ev.stopPropagation();
      const log = foundry.utils.deepClone(this.actor.system.service.log ?? []);
      const x = log[Number(n.dataset[attr])], v = n.value.trim();
      if (x && (v || field === "date")) { x[field] = v; this.actor.update({ "system.service.log": log }); }
      else n.value = x?.[field] ?? "";
    }));
    el.querySelectorAll("[data-oplog-del]").forEach(n => n.addEventListener("click", ev => {
      ev.preventDefault();
      const log = foundry.utils.deepClone(this.actor.system.service.log ?? []);
      log.splice(Number(n.dataset.oplogDel), 1);
      this.actor.update({ "system.service.log": log });
    }));
    this.#downtimeListeners(el);
    el.querySelector("[data-dossier-add]")?.addEventListener("click", ev => {
      ev.preventDefault();
      const list = foundry.utils.deepClone(this.actor.system.dossier);
      list.push({ text: "", struck: false });
      this.actor.update({ "system.dossier": list });
    });
    el.querySelectorAll("[data-dossier-strike]").forEach(n => n.addEventListener("click", ev => {
      ev.preventDefault();
      const list = foundry.utils.deepClone(this.actor.system.dossier);
      const i = Number(n.dataset.dossierStrike);
      if (list[i]) list[i].struck = !list[i].struck;
      this.actor.update({ "system.dossier": list });
    }));
  }

  /** Вкладка «Даунтайм» и полоска Связей и Заделов на боевой карточке. */
  #downtimeListeners(el) {
    const a = this.actor;
    const on = (sel, fn) => el.querySelectorAll(sel).forEach(n => n.addEventListener("click", ev => { ev.preventDefault(); fn(n.dataset, n); }));
    const clone = k => foundry.utils.deepClone(a.system[k]);
    on("[data-nerves]", d => { const v = Number(d.nerves); a.update({ "system.nerves": v === a.system.nerves ? v - 1 : v }); });
    on("[data-edge-choice]", d => chooseEdge(a, d.edgeChoice));
    on("[data-vent]", () => {
      if (a.system.downtime.nervesDown) return ui.notifications.info("Выговориться в общей сцене можно раз за даунтайм.");
      if (!a.system.nerves) return;
      a.update({ "system.nerves": a.system.nerves - 1, "system.downtime.nervesDown": true });
    });
    on("[data-resolve]", d => {
      const v = Number(d.resolve);
      let next = v === a.system.resolve ? v - 1 : v;
      // игрок прибавляет по одной: клик через деление дал бы +2 за даунтайм
      if (!game.user.isGM && next > a.system.resolve) next = a.system.resolve + 1;
      if (next > a.system.resolve && a.system.downtime.resolveGot && !game.user.isGM) return ui.notifications.warn("Решимость в этом даунтайме уже получена: не больше одной.");
      a.update({ "system.resolve": next, ...(next > a.system.resolve ? { "system.downtime.resolveGot": true } : {}) });
    });
    on("[data-fee]", d => { const v = Number(d.fee); a.update({ "system.fee": v === a.system.fee ? v - 1 : v }); });
    on("[data-dt-actions]", d => { const v = Number(d.dtActions); a.update({ "system.downtime.actions": v === a.system.downtime.actions ? v - 1 : v }); });
    on("[data-dt-action]", d => rollGround(a, d.dtAction));
    on("[data-ground]", () => rollGround(a));
    on("[data-edge-del]", d => a.update({ "system.edges": clone("edges").filter(e => e.id !== d.edgeDel) }));
    el.querySelectorAll("[data-edge-field]").forEach(n => n.addEventListener("change", ev => {
      ev.stopPropagation();
      a.update({ "system.edges": clone("edges").map(e => e.id === n.dataset.edgeId ? { ...e, [n.dataset.edgeField]: n.value } : e) });
    }));
    on("[data-edge-add]", () => addEdgeDialog(a));
    on("[data-edge-use]", d => useEdge(a, d.edgeUse));
    on("[data-bond-use]", d => useBond(a, Number(d.bondUse)));
    on("[data-threat-step]", d => stepThreat(d.threatStep, Number(d.delta)));
  }

  #saveDossier(el) {
    const list = foundry.utils.deepClone(this.actor.system.dossier);
    el.querySelectorAll("[data-dossier]").forEach(n => { const i = Number(n.dataset.dossier); if (list[i]) list[i].text = n.value; });
    return this.actor.update({ "system.dossier": list });
  }

  /** Самолёт на листе один: новый заменяет старый, HP и Strain выравниваются по новой машине. */
  async _onDropItemCreate(itemData) {
    let items = Array.isArray(itemData) ? itemData : [itemData];
    // машину и спецоружие игрок берёт только в ангаре: перетаскивание из компендиума их не ставит
    if (!game.user.isGM && items.some(i => i.type === "plane" || i.type === "weapon")) {
      ui.notifications.warn(inBattle(this.actor) ? "Идёт бой: машину и спецоружие меняют на земле." : "Машину и спецоружие выдаёт ангар: кнопка «Ангар» в шапке листа.");
      items = items.filter(i => i.type !== "plane" && i.type !== "weapon");
      if (!items.length) return [];
    }
    const planes = items.filter(i => i.type === "plane");
    if (items.some(i => i.type === "trigger" && this.actor.items.some(t => t.type === "trigger" && t.system.key && t.system.key === i.system?.key)))
      ui.notifications.info("Этот триггер уже есть на листе.");
    if (!planes.length) return super._onDropItemCreate(items.length === 1 ? items[0] : items);
    return this.actor.swapPlane(planes[planes.length - 1], () => super._onDropItemCreate(items.length === 1 ? items[0] : items));
  }
}

export class NpcSheet extends TBActorSheet {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ["thunderbolt", "sheet", "actor", "npc"],
      template: SYS_PATH + "templates/actor/npc-sheet.hbs",
      width: 640, height: 700,
      tabs: [{ navSelector: ".tb-tabs", contentSelector: ".tb-body", initial: "combat" }]
    });
  }

  async getData(options) {
    const ctx = await super.getData(options);
    const s = this.actor.system;
    ctx.isAir = s.kind === "air";
    ctx.isGround = s.kind === "ground";
    ctx.isShip = s.kind === "ship";
    ctx.isAce = s.tier === "ace";
    ctx.isConscript = s.tier === "conscript";
    ctx.isDuelist = s.tier === "duelist" && !ctx.isShip;
    if (ctx.isDuelist) {
      ctx.squadNames = Object.keys(allSquads());
      ctx.squadBudget = squadBudget();
      ctx.squadBudgetText = pointsText(ctx.squadBudget);
      ctx.squadCount = s.squad ? Math.max(1, squadMembers(s.squad).length) : 0;
      ctx.squadOver = s.squadPoints > ctx.squadBudget;
      ctx.trackerOptions = { face: "лицо", insignia: s.insignia ? "шильдик эскадрильи" : "шильдик (не выбран, будет лицо)" };
    }
    ctx.kindOptions = TB.npcKinds;
    ctx.tierOptions = TB.tiers;
    ctx.systems = s.systems.map((y, i) => ({ ...y, i, dead: y.value <= 0 }));
    ctx.canSam = ctx.isGround && (s.ground.ga !== null || s.ground.gg !== null);
    ctx.shipSam = s.kind === "ship" && s.systems.some(y => y.ga !== null && y.ga !== undefined);
    ctx.canGun = ctx.isAir || (ctx.isGround && s.ground.gun !== null);
    ctx.gunLabel = gunVs(this.actor) === "air" ? "Зенитный огонь" : "Огонь по земле";
    ctx.taskOptions = TB.tasks;
    ctx.voice = !this.actor.getFlag(SYSTEM_ID, "quiet");
    ctx.radioCall = this.actor.getFlag(SYSTEM_ID, "callsign") ?? "";
    ctx.radioName = nameOf(this.actor, { own: false });
    // личное дело есть у асов и дуэлянтов: ФИО, картинки, Связи, цели, долги, Немезида
    ctx.hasFile = ["ace", "duelist"].includes(s.tier);
    ctx.person = personView(this.actor);
    ctx.statusOptions = TB.status;
    ctx.fate = fateOf(s.status);
    ctx.pilotBio = true;
    // Немезида: ведущему кнопки «Появление» и «Монолог», что сейчас на ней висит от триггеров пилотов
    if (s.nemesis) {
      const f = fxOf(this.actor);
      const chips = [
        f.flaw && { key: "flaw", label: `Знаю эту машину: ${{ ev: "Evasion", spd: "Max Speed", aa: "A-A" }[f.flaw]} −1` },
        f.comp2 && { key: "comp2", label: "Complication 1–2" },
        f.taunt && { key: "taunt", label: `Вызов: преследует ${f.tauntName ?? "пилота"}` },
        f.duel && { key: "duel", label: `Поединок с ${f.duelName ?? "пилотом"}` },
        f.duelBonus && { key: "duelBonus", label: "Следующая атака по пилоту поединка +2" },
        f.seen && { key: "seen", label: "Появилась в этом вылете" }
      ].filter(Boolean);
      ctx.nemView = { gm: game.user.isGM, talking: monologue()?.uuid === this.actor.uuid, chips };
    }
    return ctx;
  }

  activateListeners(html) {
    super.activateListeners(html);
    if (!this.isEditable) return;
    const el = html[0];
    // сторона и приоритет пишутся сами по себе, не всей формой: иначе любой отказ в остальных полях листа их терял
    const own = (sel, key, read) => el.querySelector(sel)?.addEventListener("change", ev => {
      ev.stopPropagation();
      const value = read(ev.currentTarget);
      this.actor.update({ [key]: value }).then(r => {
        if (!r && foundry.utils.getProperty(this.actor, key) !== value) ui.notifications.warn(`${this.actor.name}: изменение не сохранилось.`);
      }).catch(err => { console.error(err); ui.notifications.error(`${this.actor.name}: ${err.message}`); });
    });
    own("[data-tb-side]", "system.side", n => n.value);
    own("[data-tb-priority]", "system.priority", n => n.checked);
    own("[data-tb-task]", "system.task", n => n.value);
    // молчит в эфире: флаг quiet (у несвязанного токена — только у этого токена)
    el.querySelector("[data-tb-voice]")?.addEventListener("change", ev => {
      ev.stopPropagation();
      this.actor.update({ [`flags.${SYSTEM_ID}.quiet`]: !ev.currentTarget.checked });
    });
    // Немезида: появление, монолог и снятие отметок триггеров (ведущий)
    const click = (sel, fn) => el.querySelectorAll(sel).forEach(n => n.addEventListener("click", ev => { ev.preventDefault(); fn(n.dataset); }));
    click("[data-nem-appear]", () => appear(this.actor));
    click("[data-nem-mono]", () => monologue()?.uuid === this.actor.uuid ? endMonologue() : startMonologue(this.actor));
    click("[data-nem-clear]", d => clearFx(this.actor, d.nemClear));
    el.querySelector("[data-tb-callsign]")?.addEventListener("change", ev => { ev.stopPropagation(); setCallsign(this.actor, ev.currentTarget.value); });
    el.querySelector("[data-tb-replies]")?.addEventListener("click", () => openChatterEditor(this.actor));
    el.querySelectorAll("[data-sys-field]").forEach(n => n.addEventListener("change", () => {
      const list = foundry.utils.deepClone(this.actor.system.systems);
      const i = Number(n.dataset.sysIndex), k = n.dataset.sysField;
      if (!list[i]) return;
      list[i][k] = n.type === "number" ? (n.value === "" ? null : Number(n.value)) : n.value;
      this.actor.update({ "system.systems": list });
    }));
    // орудия и ЗРК систем — тоже действия хода
    const act = async (what, rolled, fn) => {
      if (!allowAction(this.actor, what, { rolled })) return;
      const r = await fn();
      if (r?.documentName === "ChatMessage") await spendAction(this.actor, what, { rolled });
    };
    el.querySelectorAll("[data-sys-gun]").forEach(n => n.addEventListener("click", ev => { ev.preventDefault(); act("guns", true, () => this.actor.fireGuns({ system: Number(n.dataset.sysGun) })); }));
    el.querySelectorAll("[data-sys-sam]").forEach(n => n.addEventListener("click", ev => { ev.preventDefault(); act("sam", false, () => this.actor.fireSam(Number(n.dataset.sysSam))); }));
    el.querySelectorAll("[data-sam]").forEach(n => n.addEventListener("click", ev => { ev.preventDefault(); act("sam", false, () => this.actor.fireSam()); }));
    el.querySelectorAll("[data-squad-skill]").forEach(n => n.addEventListener("change", ev => {
      ev.stopPropagation();
      const name = this.actor.system.squad;
      if (name) setSquadLayout(name, { ...(squadLayout(name) ?? this.actor.system.skills), [n.dataset.squadSkill]: Number(n.value) || 0 });
    }));
    el.querySelector("[data-sys-add]")?.addEventListener("click", ev => {
      ev.preventDefault();
      const list = foundry.utils.deepClone(this.actor.system.systems);
      list.push({ name: "Новая система", occ: 4, hp: 3, value: 3, ga: null, gg: null, gun: null, note: "" });
      this.actor.update({ "system.systems": list });
    });
    el.querySelectorAll("[data-sys-del]").forEach(n => n.addEventListener("click", ev => {
      ev.preventDefault();
      const list = foundry.utils.deepClone(this.actor.system.systems);
      list.splice(Number(n.dataset.sysDel), 1);
      this.actor.update({ "system.systems": list });
    }));
  }
}

/** Лист персонажа на земле: штаб, техники, гражданские, близкие пилотов. Без самолёта и боя: навыки, личное дело, Связи. */
export class StaffSheet extends TBActorSheet {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ["thunderbolt", "sheet", "actor", "staff"],
      template: SYS_PATH + "templates/actor/staff-sheet.hbs",
      width: 640, height: 700,
      tabs: [{ navSelector: ".tb-tabs", contentSelector: ".tb-body", initial: "main" }]
    });
  }

  // боевая часть общего листа (погода, захват, ход, высоты) персонажу на земле не нужна
  async getData(options) {
    const ctx = await ActorSheet.prototype.getData.call(this, options);
    const a = this.actor, s = a.system;
    Object.assign(ctx, {
      system: s, TB, isGM: game.user.isGM,
      skills: Object.entries(TB.skills).map(([k, v]) => ({ key: k, ...v, value: s.skills[k], total: s.skillTotal[k] })),
      isConscript: s.tier === "conscript", isAce: s.tier === "ace",
      roleOptions: TB.staffRoles, tierOptions: TB.tiers, statusOptions: TB.staffStatus,
      roleName: TB.staffRoles[s.role] ?? "", isKin: s.role === "kin",
      person: personView(a), pilotBio: false, fate: fateOf(s.status),
      enrichedNotes: await TextEditor.enrichHTML(s.notes, { secrets: a.isOwner, relativeTo: a }),
      insigniaHint: "Эмблема подразделения или семейный знак. Щелчок: выбрать картинку, правый щелчок: убрать."
    });
    const kin = s.role === "kin" && s.relatedTo ? game.actors.get(s.relatedTo) : null;
    ctx.kinName = kin ? kin.system.callsign || kin.name : "";
    return ctx;
  }

  activateListeners(html) {
    super.activateListeners(html);
    if (!this.isEditable) return;
    // проверка на земле: без хода и действий, сразу окно броска
    html[0].querySelectorAll("[data-staff-roll]").forEach(n => n.addEventListener("click", ev => {
      ev.preventDefault();
      this.actor.rollSkill(n.dataset.staffRoll);
    }));
  }
}
