/* Листы пилота и NPC (ActorSheet v1, стабильный API Foundry v12). */
import { SYSTEM_ID, SYS_PATH, TB } from "../config.mjs";
import { esc } from "../utils.mjs";

const opts = obj => Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, typeof v === "string" ? v : v.label]));

function weaponView(w) {
  const s = w.system;
  const mods = [];
  if (s.aa !== null) mods.push(`AA ${s.aa >= 0 ? "+" : ""}${s.aa}`);
  if (s.ag !== null) mods.push(`AG ${s.ag >= 0 ? "+" : ""}${s.ag}`);
  if (s.aim !== null) mods.push(`Aim ${s.aim >= 0 ? "+" : ""}${s.aim}`);
  if (s.dep !== null) mods.push(`Deploy ${s.dep >= 0 ? "+" : ""}${s.dep}`);
  return { id: w.id, name: w.name, img: w.img, key: s.key, dmg: s.dmg, fx: s.fx, mods: mods.join(" · "),
    unlimited: s.ammo.max === null, ammo: s.ammo.value, max: s.ammo.max, target: TB.weaponTargets[s.target] ?? "" };
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
    ctx.weapons = a.items.filter(i => i.type === "weapon").map(weaponView);
    ctx.enrichedNotes = await TextEditor.enrichHTML(s.notes, { secrets: a.isOwner, relativeTo: a });
    ctx.isGM = game.user.isGM;
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
        case "unlock": return a.update({ "system.lock": "" });
        case "unbreak": return a.update({ "system.breakEv": null });
        case "doom": return a.markDoom();
      }
    });
    on("[data-speed]", d => {
      const v = this.actor.system.speed + Number(d.speed);
      this.actor.update({ "system.speed": Math.min(this.actor.system.maxSpeed, v) });
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
      const v = Math.max(0, Math.min(item.system.ammo.max + 2, item.system.ammo.value + Number(d.delta)));
      item.update({ "system.ammo.value": v });
    });
    on("[data-item-toggle]", d => {
      const item = this.actor.items.get(d.itemToggle);
      item?.update({ "system.used": !item.system.used });
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
    ctx.triggers = a.items.filter(i => i.type === "trigger").map(t => ({
      id: t.id, name: t.name, ...t.system, typeText: t.system.types.join(" · "),
      archName: TB.archetypes[t.system.archetype]?.label ?? "", needsSkill: t.system.skills > 0, needsTwo: t.system.skills > 1
    }));
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
    if (planes.length) {
      const old = this.actor.items.filter(i => i.type === "plane").map(i => i.id);
      if (old.length) await this.actor.deleteEmbeddedDocuments("Item", old);
    }
    if (items.some(i => i.type === "trigger" && this.actor.items.some(t => t.type === "trigger" && t.system.key && t.system.key === i.system?.key)))
      ui.notifications.info("Этот триггер уже есть на листе.");
    const created = await super._onDropItemCreate(items.length === 1 ? items[0] : items);
    if (planes.length) {
      const p = planes[planes.length - 1];
      const upd = { "system.hp.value": this.actor.system.hp.max, "system.strain.value": this.actor.system.strain.max,
        "system.speed": Math.min(this.actor.system.speed, this.actor.system.maxSpeed) };
      const defaultImg = !this.actor.prototypeToken.texture.src || this.actor.prototypeToken.texture.src.includes("mystery-man");
      if (p.img && defaultImg) upd["prototypeToken.texture.src"] = p.img;
      await this.actor.update(upd);
    }
    return created;
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
