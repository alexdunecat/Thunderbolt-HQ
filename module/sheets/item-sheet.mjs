/* Карточки самолёта, спецоружия и триггера. */
import { SYS_PATH, TB } from "../config.mjs";

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
    }
    if (this.item.type === "trigger") {
      ctx.archOptions = Object.fromEntries(Object.entries(TB.archetypes).map(([k, v]) => [k, v.label]));
      ctx.typeText = s.types.join(", ");
      ctx.skillOptions = Object.fromEntries(Object.entries(TB.skills).map(([k, v]) => [k, v.label]));
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
  }

  /** Поле typesText не из схемы: убираем перед сохранением. */
  _getSubmitData(updateData) {
    const data = super._getSubmitData(updateData);
    delete data.typesText;
    return data;
  }
}
