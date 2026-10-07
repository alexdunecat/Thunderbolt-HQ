/* Карточки самолёта, спецоружия и триггера. */
import { SYS_PATH, TB } from "../config.mjs";
import { describeChanges } from "./actor-sheets.mjs";
import { rangeLabel } from "../scene.mjs";

export class TBItemSheet extends ItemSheet {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ["thunderbolt", "sheet", "item"],
      width: 560, height: 560
    });
  }

  get template() { return `${SYS_PATH}templates/item/${this.item.type}.hbs`; }

  async getData(options) {
    const ctx = await super.getData(options);
    const s = this.item.system;
    ctx.system = s;
    ctx.TB = TB;
    if (this.item.type === "plane") {
      ctx.statRows = Object.entries(TB.planeStats).map(([k, [en, ru]]) => ({ key: k, en, ru, value: s.stats[k] }));
      ctx.ac5 = s.ac5 ? [["Скорость", s.ac5.spd], ["Манёвр", s.ac5.mob], ["Устойч.", s.ac5.sta], ["Защита", s.ac5.def],
        ["Возд.", s.ac5.a2a], ["Земля", s.ac5.a2g], ["Ракеты", s.ac5.msl]] : null;
    }
    if (this.item.type === "weapon") {
      ctx.targetOptions = TB.weaponTargets;
      ctx.kindOptions = TB.weaponKinds;
      ctx.unlimited = s.ammo.max === null;
      ctx.rangeOptions = TB.rangeOptions;
      ctx.rangeValue = s.range === null ? "" : String(s.range);
      ctx.reachLabel = rangeLabel(s.reach);
    }
    if (this.item.type === "trigger") {
      ctx.archOptions = Object.fromEntries(Object.entries(TB.archetypes).map(([k, v]) => [k, v.label]));
      ctx.typeText = s.types.join(", ");
      ctx.skillOptions = Object.fromEntries(Object.entries(TB.skills).map(([k, v]) => [k, v.label]));
      ctx.fxCustom = s.effects !== null;
      ctx.fxBook = !!TB.triggerEffects[s.key];
      ctx.fxRows = (s.effects ?? []).map((r, i) => ({ ...r, i }));
      ctx.fxText = describeChanges(s.changes);
      ctx.targetOptions = TB.effectTargets;
      ctx.whenOptions = TB.effectWhen;
    }
    return ctx;
  }

  activateListeners(html) {
    super.activateListeners(html);
    if (!this.isEditable) return;
    const el = html[0];
    el.querySelector("[name='typesText']")?.addEventListener("change", ev => {
      const types = ev.target.value.split(/[,·]/).map(t => t.trim()).filter(Boolean);
      this.item.update({ "system.types": types });
    });
    // эффекты триггера: правим массив целиком
    const fx = () => foundry.utils.deepClone(this.item.system.effects ?? this.item.system.changes);
    const click = (sel, fn) => el.querySelectorAll(sel).forEach(n => n.addEventListener("click", ev => { ev.preventDefault(); fn(n.dataset); }));
    click("[data-fx-edit]", () => this.item.update({ "system.effects": fx() }));
    click("[data-fx-reset]", () => this.item.update({ "system.effects": null }));
    click("[data-fx-add]", () => this.item.update({ "system.effects": [...fx(), { target: "hpMax", value: 1, when: "always" }] }));
    click("[data-fx-delete]", d => { const list = fx(); list.splice(Number(d.fxDelete), 1); this.item.update({ "system.effects": list }); });
    el.querySelectorAll("[data-fx-field]").forEach(n => n.addEventListener("change", ev => {
      ev.stopPropagation();
      const list = fx(), row = list[Number(n.dataset.fxIndex)];
      if (!row) return;
      row[n.dataset.fxField] = n.dataset.fxField === "value" ? (parseInt(n.value) || 0) : n.value;
      this.item.update({ "system.effects": list });
    }));
  }

  /** Поле typesText не из схемы: убираем перед сохранением. */
  _getSubmitData(updateData) {
    const data = super._getSubmitData(updateData);
    delete data.typesText;
    return data;
  }
}
