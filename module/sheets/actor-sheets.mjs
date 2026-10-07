/* Листы пилота и NPC (ActorSheet v1, стабильный API Foundry v12). */
import { SYSTEM_ID, SYS_PATH, TB } from "../config.mjs";
import { esc } from "../utils.mjs";
import { weatherAt, defenseWithWeather } from "../scene.mjs";

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
  return { id: w.id, name: w.name, img: w.img, key: s.key, dmg: s.dmg, fx: s.fx, mods: mods.join(" · "),
    unlimited: s.ammo.max === null, ammo: s.ammo.value, max: s.ammo.max === null ? null : s.ammo.max + bonus, bonus, target: TB.weaponTargets[s.target] ?? "" };
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
    ctx.skin = game.settings.get(SYSTEM_ID, "skin");
    ctx.skills = Object.entries(TB.skills).map(([k, v]) => ({
      key: k, ...v, value: s.skills[k], total: s.skillTotal[k], mod: s.skillMod?.[k] ?? 0, blocked: s.skillBlocked[k],
      perk3: (s.perkOn?.[k] ?? 4) < 4, comp2: (s.compOn?.[k] ?? 1) > 1
    }));
    ctx.altOptions = TB.altitudes;
    ctx.skillOptions = opts(TB.skills);
    ctx.sysOptions = Object.fromEntries(Object.entries(TB.systems).map(([k, v]) => [k, `${v.label}: ${v.hint}`]));
    ctx.weapons = a.items.filter(i => i.type === "weapon").map(w => weaponView(w, s.ammoBonus?.[w.id] ?? 0));
    ctx.enrichedNotes = await TextEditor.enrichHTML(s.notes, { secrets: a.isOwner, relativeTo: a });
    ctx.isGM = game.user.isGM;
    const w = weatherAt(a);
    ctx.weather = w.list.map(d => ({ ico: d.ico, name: d.name, txt: d.txt }));
    if (s.defense !== null && s.defense !== undefined) {
      ctx.defenseNow = defenseWithWeather(a, w);
      ctx.defenseWeather = ctx.defenseNow !== s.defense;
    }
    ctx.maxSpeedNow = (s.maxSpeed ?? 0) + w.spd;
    return ctx;
  }

  activateListeners(html) {
    super.activateListeners(html);
    const el = html[0];
    el.closest(".app")?.setAttribute("data-tb-skin", game.settings.get(SYSTEM_ID, "skin"));
    if (!this.isEditable) return;
    const on = (sel, fn) => el.querySelectorAll(sel).forEach(n => n.addEventListener("click", ev => { ev.preventDefault(); fn(n.dataset, n, ev); }));

    on("[data-roll-skill]", d => this.actor.rollSkill(d.rollSkill));
    on("[data-act]", d => {
      const a = this.actor;
      switch (d.act) {
        case "missile": return a.fireMissile();
        case "guns": return a.fireGuns();
        case "break": return a.rollBreak();
        case "lock": return a.lockOn();
        case "recover": return a.rollRecover();
        case "stall": return a.rollStall();
        case "sortie": return a.prepareSortie();
        case "unlock": return a.update({ "system.lock": "", "system.lockUuid": "" });
        case "unbreak": return a.update({ "system.breakEv": null });
        case "doom": return a.markDoom();
      }
    });
    on("[data-speed]", d => {
      const v = this.actor.system.speed + Number(d.speed);
      this.actor.update({ "system.speed": Math.min(this.actor.system.maxSpeed + weatherAt(this.actor).spd, v) });
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
    on("[data-item-toggle]", d => {
      const item = this.actor.items.get(d.itemToggle);
      item?.update({ "system.used": !item.system.used });
    });
    on("[data-trigger-active]", d => {
      const item = this.actor.items.get(d.triggerActive);
      item?.update({ "system.active": !item.system.active });
    });
    on("[data-trigger-stack]", d => {
      const item = this.actor.items.get(d.triggerStack);
      if (item) item.update({ "system.stack": Math.max(0, item.system.stack + Number(d.delta)) });
    });
    on("[data-chat-item]", d => this.#itemToChat(this.actor.items.get(d.chatItem)));
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

export class PilotSheet extends TBActorSheet {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ["thunderbolt", "sheet", "actor", "pilot"],
      template: SYS_PATH + "templates/actor/pilot-sheet.hbs",
      tabs: [{ navSelector: ".tb-tabs", contentSelector: ".tb-body", initial: "combat" }]
    });
  }

  async getData(options) {
    const ctx = await super.getData(options);
    const a = this.actor, s = a.system;
    const plane = s.plane;
    ctx.plane = plane ? {
      id: plane.id, name: plane.name, img: plane.img, ...plane.system,
      statRows: Object.entries(TB.planeStats).map(([k, [en, ru]]) => ({ key: k, en, ru, value: plane.system.stats[k] })),
      sigNames: plane.system.sig.join(", ")
    } : null;
    const weaponOpts = Object.fromEntries(a.items.filter(i => i.type === "weapon" && i.system.ammo.max !== null).map(w => [w.id, w.name]));
    ctx.triggers = a.items.filter(i => i.type === "trigger").map(t => ({
      id: t.id, name: t.name, ...t.system, typeText: t.system.types.join(" · "),
      archName: TB.archetypes[t.system.archetype]?.label ?? "", needsSkill: t.system.skills > 0, needsTwo: t.system.skills > 1,
      hasToggle: t.system.hasToggle, hasStack: t.system.hasStack, needsWeapon: t.system.needsWeapon,
      toggleHint: TB.toggleHints[t.system.key] ?? "ситуативный бонус",
      fxText: describeChanges(t.system.changes),
      hasOpts: t.system.skills > 0 || t.system.needsWeapon || t.system.hasToggle || t.system.hasStack
    }));
    ctx.weaponOpts = weaponOpts;
    ctx.situational = ctx.triggers.filter(t => t.hasToggle || t.hasStack);
    ctx.activeFx = Object.entries(s.trigFx ?? {}).flatMap(([target, list]) =>
      list.map(m => ({ label: TB.effectTargets[target] ?? target, name: m.name, sval: `${m.value >= 0 ? "+" : ""}${m.value}` })));
    ctx.archOptions = opts(TB.archetypes);
    ctx.statusOptions = TB.status;
    ctx.pointsOver = s.pointsUsed > s.pointsBudget;
    ctx.weaponsOver = ctx.weapons.length > (s.hardpoints ?? 0);
    ctx.dossier = s.dossier.map((d, i) => ({ ...d, i }));
    ctx.alertSpeed = s.speed <= 0;
    return ctx;
  }

  activateListeners(html) {
    super.activateListeners(html);
    if (!this.isEditable) return;
    const el = html[0];
    // досье: строки можно зачёркивать, но не стирать
    el.querySelectorAll("[data-dossier]").forEach(n => n.addEventListener("change", () => this.#saveDossier(el)));
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

  #saveDossier(el) {
    const list = foundry.utils.deepClone(this.actor.system.dossier);
    el.querySelectorAll("[data-dossier]").forEach(n => { const i = Number(n.dataset.dossier); if (list[i]) list[i].text = n.value; });
    return this.actor.update({ "system.dossier": list });
  }

  /** Самолёт на листе один: новый заменяет старый, HP и Strain выравниваются по новой машине. */
  async _onDropItemCreate(itemData) {
    const items = Array.isArray(itemData) ? itemData : [itemData];
    const planes = items.filter(i => i.type === "plane");
    if (items.some(i => i.type === "trigger" && this.actor.items.some(t => t.type === "trigger" && t.system.key && t.system.key === i.system?.key)))
      ui.notifications.info("Этот триггер уже есть на листе.");
    if (!planes.length) return super._onDropItemCreate(items.length === 1 ? items[0] : items);
    const a = this.actor;
    return a.withoutPoolSync(async () => {
      const old = a.items.filter(i => i.type === "plane").map(i => i.id);
      if (old.length) await a.deleteEmbeddedDocuments("Item", old);
      const created = await super._onDropItemCreate(items.length === 1 ? items[0] : items);
      const p = planes[planes.length - 1];
      const upd = { "system.hp.value": a.system.hp.max, "system.strain.value": a.system.strain.max,
        "system.speed": Math.min(a.system.speed, a.system.maxSpeed), [`flags.${SYSTEM_ID}.pools`]: a.poolsFlag() };
      const defaultImg = !a.prototypeToken.texture.src || a.prototypeToken.texture.src.includes("mystery-man");
      if (p.img && defaultImg) upd["prototypeToken.texture.src"] = p.img;
      await a.update(upd);
      return created;
    });
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
    ctx.kindOptions = TB.npcKinds;
    ctx.tierOptions = TB.tiers;
    ctx.systems = s.systems.map((y, i) => ({ ...y, i, dead: y.value <= 0 }));
    ctx.canSam = ctx.isGround && s.ground.ga !== null;
    ctx.canGun = ctx.isAir || (ctx.isGround && s.ground.gun !== null);
    return ctx;
  }

  activateListeners(html) {
    super.activateListeners(html);
    if (!this.isEditable) return;
    const el = html[0];
    el.querySelectorAll("[data-sys-field]").forEach(n => n.addEventListener("change", () => {
      const list = foundry.utils.deepClone(this.actor.system.systems);
      const i = Number(n.dataset.sysIndex), k = n.dataset.sysField;
      if (!list[i]) return;
      list[i][k] = n.type === "number" ? (n.value === "" ? null : Number(n.value)) : n.value;
      this.actor.update({ "system.systems": list });
    }));
    el.querySelectorAll("[data-sys-gun]").forEach(n => n.addEventListener("click", ev => { ev.preventDefault(); this.actor.fireGuns({ system: Number(n.dataset.sysGun) }); }));
    el.querySelectorAll("[data-sys-sam]").forEach(n => n.addEventListener("click", ev => { ev.preventDefault(); this.actor.fireSam(Number(n.dataset.sysSam)); }));
    el.querySelectorAll("[data-sam]").forEach(n => n.addEventListener("click", ev => { ev.preventDefault(); this.actor.fireSam(); }));
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
