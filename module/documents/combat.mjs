/* Инициатива через заявку действий: в начале раунда каждый заявляет 1–3 действия.
   Кто заявил меньше, ходит раньше; при равенстве игрок раньше NPC. Значение инициативы = число заявленных действий. */
import { formDialog, resolveVolley } from "../dice/rolls.mjs";
import { esc } from "../utils.mjs";


export class TBCombat extends Combat {
  _sortCombatants(a, b) {
    const ia = Number.isNumeric(a.initiative) ? a.initiative : Infinity;
    const ib = Number.isNumeric(b.initiative) ? b.initiative : Infinity;
    if (ia !== ib) return ia - ib;
    const pa = a.actor?.hasPlayerOwner ? 0 : 1, pb = b.actor?.hasPlayerOwner ? 0 : 1;
    if (pa !== pb) return pa - pb;
    return (a.name || "").localeCompare(b.name || "", "ru") || a.id.localeCompare(b.id);
  }

  /** Вместо броска спрашиваем заявку: одна форма на всех выбранных участников. */
  async rollInitiative(ids, { updateTurn = true } = {}) {
    ids = typeof ids === "string" ? [ids] : ids;
    const list = ids.map(id => this.combatants.get(id)).filter(c => c?.isOwner);
    if (!list.length) return this;
    const rows = list.map(c => `<div class="form-group"><label>${esc(c.name)}</label>
      <select name="${c.id}"><option value="1">1 действие</option><option value="2" selected>2 действия</option><option value="3">3 действия</option></select></div>`).join("");
    const data = await formDialog("Заявка действий", `<p class="tb-hint">Меньше действий: ходите раньше. Сначала заявляют NPC, игроки видят их заявки.</p>${rows}`, { ok: "Заявить" });
    if (!data) return this;
    const currentId = this.combatant?.id;
    const updates = list.map(c => ({ _id: c.id, initiative: Number(data[c.id]) || 2 }));
    await this.updateEmbeddedDocuments("Combatant", updates);
    const lines = list.map(c => `${esc(c.name)}: ${data[c.id]}`).join("<br>");
    await ChatMessage.create({
      speaker: { alias: "Заявка" },
      content: `<div class="tb-card tb-card-declare"><header class="tb-card-head"><span class="tb-card-what">Заявка действий</span></header><div class="tb-note">${lines}</div></div>`
    });
    if (updateTurn && currentId) await this.update({ turn: this.turns.findIndex(t => t.id === currentId) });
    return this;
  }

  /** Новый раунд: ракеты раунда долетают залпом, заявки сбрасываются, Break! заканчивается. */
  async nextRound() {
    if (game.user.isGM) {
      // ракеты долетают до сброса Break!: защита целей считается с ним
      const volley = await resolveVolley(this);
      if (!volley) await ChatMessage.create({
        speaker: { alias: "AWACS" },
        content: `<div class="tb-card tb-card-round"><div class="tb-note">Конец раунда ${this.round}. Ракет в воздухе нет, Break! заканчивается.</div></div>`
      });
      await this.updateEmbeddedDocuments("Combatant", this.combatants.map(c => ({ _id: c.id, initiative: null })));
      for (const c of this.combatants) {
        const a = c.actor;
        if (a?.system.breakEv !== null && a?.system.breakEv !== undefined) await a.update({ "system.breakEv": null });
      }
    }
    return super.nextRound();
  }
}
