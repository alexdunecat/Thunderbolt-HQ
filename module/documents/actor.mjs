/* Актёр: пилот в самолёте или NPC. Урон, метки, высота, подготовка к вылету. */
import { SYSTEM_ID, TB } from "../config.mjs";
import * as R from "../dice/rolls.mjs";
import { esc } from "../utils.mjs";


export class TBActor extends Actor {
  async _preCreate(data, options, user) {
    if ((await super._preCreate(data, options, user)) === false) return false;
    const pilot = this.type === "pilot";
    const proto = {
      actorLink: pilot,
      disposition: pilot ? CONST.TOKEN_DISPOSITIONS.FRIENDLY : CONST.TOKEN_DISPOSITIONS.HOSTILE,
      displayBars: CONST.TOKEN_DISPLAY_MODES.OWNER_HOVER,
      displayName: CONST.TOKEN_DISPLAY_MODES.HOVER,
      bar1: { attribute: "hp" },
      bar2: { attribute: pilot ? "strain" : null }
    };
    if (data.img && !data.prototypeToken?.texture?.src) proto.texture = { src: data.img };
    this.updateSource({ prototypeToken: foundry.utils.mergeObject(proto, data.prototypeToken ?? {}) });
  }

  /* ---------- броски (обёртки для листов и макросов) ---------- */
  rollSkill(skill) { return R.rollCheck(this, skill); }
  rollBreak() { return R.rollBreak(this); }
  rollRecover() { return R.rollRecover(this); }
  rollStall() { return R.rollStall(this); }
  fireMissile() { return R.fireMissile(this); }
  fireGuns(opts) { return R.fireGuns(this, opts); }
  fireSam(i) { return R.fireSam(this, i); }
  lockOn() { return R.lockOn(this); }

  /* ---------- высота ---------- */
  async setAltitude(alt, options = {}) {
    if (!TB.altitudes[alt]) return;
    return this.update({ "system.alt": alt }, options);
  }

  /** Подтянуть высоту токенов к полю alt (1 = Low, 2 = Medium, 3 = High). */
  async syncElevation() {
    const elev = TB.altElevation[this.system.alt];
    if (!elev) return;
    const tokens = this.isToken ? [this.token] : this.getActiveTokens(false, true);
    for (const t of tokens) if (t && t.elevation !== elev && t.isOwner) await t.update({ elevation: elev }, { tbSync: true });
  }

  /* ---------- HP и Strain ---------- */
  /** Макс. HP или Strain изменился (триггер, самолёт, поломка): текущее значение сдвигается на ту же разницу. */
  async syncPools() {
    if (this.type !== "pilot" || this._tbNoSync || !this.isOwner) return;
    const s = this.system;
    const seen = this.getFlag(SYSTEM_ID, "pools");
    const bare = s.plane?.system.stats;
    const prev = seen ?? { hp: bare?.hp ?? s.hp.max, strain: bare?.str ?? s.strain.max };
    const upd = {};
    for (const k of ["hp", "strain"]) {
      const d = s[k].max - prev[k];
      if (d) upd[`system.${k}.value`] = Math.max(0, Math.min(s[k].max, s[k].value + d));
    }
    if (!seen || seen.hp !== s.hp.max || seen.strain !== s.strain.max) upd[`flags.${SYSTEM_ID}.pools`] = this.poolsFlag();
    if (Object.keys(upd).length) await this.update(upd);
  }

  poolsFlag() { return { hp: this.system.hp.max, strain: this.system.strain.max }; }

  /** Выполнить fn без автосдвига HP и Strain (fn сама выставляет значения и флаг pools). */
  async withoutPoolSync(fn) {
    this._tbNoSync = true;
    try { return await fn(); }
    finally { this._tbNoSync = false; }
  }

  /* ---------- урон ---------- */
  get roundKey() {
    const c = game.combat;
    return c?.started ? `${c.id}:${c.round}` : "";
  }

  /**
   * Нанести урон с учётом меток: не больше одной метки за раунд, лишний урон сгорает.
   * roundKey: раунд, к которому относится урон (залп считается после смены раунда); sourceUuid: кому засчитать сбитого.
   */
  async applyDamage(amount, { source, sourceUuid, roundKey } = {}) {
    amount = Number(amount) || 0;
    if (amount <= 0) return;
    const s = this.system;
    // по уже сбитой машине урон не идёт: иначе второй сбитый засчитался бы дважды
    if (this.statuses?.has(CONFIG.specialStatusEffects.DEFEATED) || s.markers?.doom)
      return this.#say(`<b>${esc(this.name)}</b> уже ${this.type === "pilot" ? "катапультировался" : "сбит"}: урон не нужен.`);
    const opts = { sourceUuid, roundKey };
    if (this.type === "npc" && s.kind === "ship") return this.#damageShip(amount, opts);
    if (this.type === "npc" && s.kind === "ground") {
      const hp = s.hp.value - amount;
      await this.update({ "system.hp.value": Math.max(0, hp) });
      if (hp <= 0) {
        await this.toggleStatusEffect(CONFIG.specialStatusEffects.DEFEATED, { active: true, overlay: true });
        await this.#creditKill(sourceUuid);
        return this.#say(`<b>${esc(this.name)}</b> уничтожена.`);
      }
      return this.#say(`<b>${esc(this.name)}</b>: −${amount} HP, осталось ${hp}.`);
    }

    const hp = s.hp.value - amount;
    if (hp > 0) {
      await this.update({ "system.hp.value": hp });
      return this.#say(`<b>${esc(this.name)}</b>: −${amount} HP, осталось ${hp} из ${s.hp.max}.`);
    }
    const key = roundKey ?? this.roundKey;
    if (key && s.markers.lastRound === key) {
      await this.update({ "system.hp.value": 1 });
      return this.#say(`<b>${esc(this.name)}</b>: HP до нуля, но метку в этом раунде уже ставили. Лишний урон сгорает, HP 1.`);
    }
    const full = this.type === "pilot" || this.system.fullMarkers;
    if (!full) {
      await this.update({ "system.hp.value": 0 });
      return this.markDoom("одна метка у конскриптов и дуэлянтов", opts);
    }
    const choice = await this.#chooseMarker();
    const upd = { "system.hp.value": s.hp.max, "system.markers.lastRound": key };
    if (!choice) {
      await this.update(upd);
      return this.#say(`<b>${esc(this.name)}</b>: HP до нуля. Метку выберите на листе, HP восстановлен до ${s.hp.max}.`);
    }
    if (choice.marker === "doom") { await this.update(upd); return this.markDoom("", opts); }
    if (choice.marker === "grit") Object.assign(upd, { "system.markers.grit": true, "system.markers.gritSkill": choice.skill });
    if (choice.marker === "structure") Object.assign(upd, { "system.markers.structure": true, "system.markers.sys": choice.sys });
    await this.update(upd);
    const what = choice.marker === "grit" ? `Grit: недоступен навык «${TB.skills[choice.skill]?.label}»`
      : `Structure: сломано «${TB.systems[choice.sys]?.label}» (${TB.systems[choice.sys]?.hint})`;
    return this.#say(`<b>${esc(this.name)}</b> получает метку ${what}. HP восстановлен до ${s.hp.max}.${this.system.markerCount >= 2 ? " После двух меток пора уходить из боя." : ""}`);
  }

  async markDoom(reason, { sourceUuid, roundKey } = {}) {
    await this.update({ "system.markers.doom": true, "system.markers.lastRound": roundKey ?? this.roundKey }, { tbDoom: true });
    // Doom — машина сбита у всех, и у пилота, и у аса: знак X, в конце раунда токен уходит с поля
    await this.toggleStatusEffect(CONFIG.specialStatusEffects.DEFEATED, { active: true, overlay: true });
    if (this.type === "pilot") await this.markDown(sourceUuid);
    else await this.#creditKill(sourceUuid);
    const pilot = this.type === "pilot";
    return this.#say(`<b>${esc(this.name)}</b>: метка <b>Doom</b>${reason ? ` (${esc(reason)})` : ""}. ${pilot
      ? "Катапультироваться или последние слова. Если пилот погибнет, стол выбирает: «Победа любой ценой» или «Достойное отступление»."
      : "Машина сбита."}`);
  }

  #chooseMarker() {
    const m = this.system.markers;
    const skills = Object.entries(TB.skills).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join("");
    const systems = Object.entries(TB.systems).map(([k, v]) => `<option value="${k}">${v.label}: ${v.hint}</option>`).join("");
    const radio = (v, label, extra, disabled) => `<div class="form-group"><label><input type="radio" name="marker" value="${v}" ${disabled ? "disabled" : ""}> ${label}</label>${extra}</div>`;
    return R.formDialog(`${this.name}: HP до нуля`, `
      <p class="tb-hint">Отметьте одну метку. HP восстановится до максимума.</p>
      ${radio("grit", "Grit: навык недоступен", `<select name="skill">${skills}</select>`, m.grit)}
      ${radio("structure", "Structure: сломана система", `<select name="sys">${systems}</select>`, m.structure)}
      ${radio("doom", "Doom: катапульта или смерть", "", m.doom)}`, { ok: "Отметить" })
      .then(d => (d?.marker ? d : null));
  }

  /** Отметить машину сбитой в текущем бою: в конце раунда её уберут с поля и запишут в потери (losses.mjs). */
  async markDown(sourceUuid) {
    const c = game.combat;
    if (!c?.started || this.getFlag(SYSTEM_ID, "down")?.combat === c.id) return;
    const by = sourceUuid ? R.resolveActor(sourceUuid)?.name ?? "" : "";
    await this.setFlag(SYSTEM_ID, "down", { combat: c.id, round: c.round, by, byUuid: sourceUuid ?? "" });
    // в трекере боец выбывает: заявок и хода у него больше нет
    const cb = c.combatants.find(x => (this.isToken ? x.tokenId === this.token?.id : x.actorId === this.id));
    if (cb && !cb.defeated && cb.isOwner) await cb.update({ defeated: true });
  }

  /** Засчитать сбитого или уничтоженного пилоту-стрелку (для итогов вылета). */
  async #creditKill(sourceUuid) {
    await this.markDown(sourceUuid);
    const shooter = sourceUuid ? R.resolveActor(sourceUuid) : null;
    if (shooter?.type !== "pilot") return;
    const kind = this.system.kind === "air" ? "air" : "ground";
    const k = foundry.utils.deepClone(shooter.getFlag(SYSTEM_ID, "kills") ?? { air: 0, ground: 0 });
    k[kind] = (k[kind] ?? 0) + 1;
    // имена для разбора полёта
    k.list = [...(k.list ?? []), { name: this.token?.name ?? this.name, kind }];
    await shooter.setFlag(SYSTEM_ID, "kills", k);
  }

  async #damageShip(amount, { sourceUuid } = {}) {
    const systems = foundry.utils.deepClone(this.system.systems);
    const alive = systems.map((y, i) => ({ y, i })).filter(o => o.y.value > 0);
    if (!alive.length) return this.#say(`${esc(this.name)}: все системы уже уничтожены.`);
    const data = await R.formDialog(`${this.name}: куда попали`, `
      <div class="form-group"><label>Система</label><select name="i">${alive.map(o => `<option value="${o.i}">${esc(o.y.name)} · Occ ${o.y.occ} · HP ${o.y.value}/${o.y.hp}</option>`).join("")}</select></div>`, { ok: "Нанести" });
    if (!data) return;
    const y = systems[Number(data.i)];
    y.value = Math.max(0, y.value - amount);
    await this.update({ "system.systems": systems });
    const left = systems.filter(s => s.value > 0).length;
    if (!left) {
      await this.toggleStatusEffect(CONFIG.specialStatusEffects.DEFEATED, { active: true, overlay: true });
      await this.#creditKill(sourceUuid);
      return this.#say(`<b>${esc(this.name)}</b>: уничтожена последняя система. Цель потоплена.`);
    }
    return this.#say(`<b>${esc(this.name)}</b>: «${esc(y.name)}» −${amount} HP${y.value ? `, осталось ${y.value}` : ", система уничтожена"}. Целых систем: ${left}.`);
  }

  #say(text) {
    return ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: this }),
      content: `<div class="tb-card tb-card-damage"><div class="tb-note">${text}</div></div>`
    });
  }

  /* ---------- вылет ---------- */
  /** Перед вылетом: Strain и HP до максимума, Speed 1, метки и Поворот сняты, ситуативные триггеры выключены, боезапас полный. */
  async prepareSortie() {
    await this.withoutPoolSync(async () => {
      await this.update({
        "system.speed": 1, "system.breakEv": null, "system.lock": "", "system.lockUuid": "", "system.twist": false,
        "system.markers": { grit: false, gritSkill: "", structure: false, sys: "", doom: false, lastRound: "" },
        [`flags.${SYSTEM_ID}.-=down`]: null
      }, { tbFree: true });
      // после снятия меток и Поворота максимумы пересчитаны
      await this.update({ "system.hp.value": this.system.hp.max, "system.strain.value": this.system.strain.max,
        [`flags.${SYSTEM_ID}.pools`]: this.poolsFlag() });
    });
    const items = [];
    for (const i of this.items) {
      if (i.type === "trigger" && (i.system.used || i.system.active || i.system.stack))
        items.push({ _id: i.id, "system.used": false, "system.active": false, "system.stack": 0 });
      if (i.type === "weapon" && i.system.ammo.max !== null)
        items.push({ _id: i.id, "system.ammo.value": i.system.ammo.max + (this.system.ammoBonus?.[i.id] ?? 0) });
    }
    if (items.length) await this.updateEmbeddedDocuments("Item", items);
    await this.toggleStatusEffect(CONFIG.specialStatusEffects.DEFEATED, { active: false }).catch(() => null);
    return this.#say(`<b>${esc(this.name)}</b> готов к вылету: Speed 1, Strain ${this.system.strain.max}, HP ${this.system.hp.max}.`);
  }
}

export class TBItem extends Item {}
