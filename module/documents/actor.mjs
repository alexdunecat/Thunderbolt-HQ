/* Актёр: пилот в самолёте или NPC. Урон, метки, высота, подготовка к вылету. */
import { SYSTEM_ID, TB, DT, hasProp, sortieUsed, sortieMark, moveReady, roleOf } from "../config.mjs";
import * as R from "../dice/rolls.mjs";
import { esc } from "../utils.mjs";
import { resetSortie } from "../nemesis.mjs";
import { resetCombatTriggers, fakeoutReady, offerMercy, offerGuard, afterKill, billPaid } from "../combat-triggers.mjs";
import { startStrain } from "../downtime.mjs";


const PORTRAITS = `systems/${SYSTEM_ID}/assets/portraits/`;
/** Пустая картинка: ничего или серый силуэт Foundry. */
export const blankImg = src => !src || src.includes("mystery-man");
/** Свой ли это портрет по умолчанию (его можно менять при смене роли и заменять самолётом на токене). */
export const defaultImg = src => !!src && src.includes("/assets/portraits/");

/** Один и тот же файл: путь без адреса сервера и ведущей косой черты. */
export const samePath = (a, b) => {
  const n = p => String(p ?? "").replace(/^https?:\/\/[^/]+\//, "").replace(/^\//, "");
  return n(a) === n(b);
};

/** Портрет по умолчанию: пилот в шлеме, противник в красном, офицер штаба, гражданский. */
export function defaultPortrait(type, sys = {}) {
  if (type === "pilot") return `${PORTRAITS}pilot.svg`;
  if (type === "staff") return `${PORTRAITS}${["civil", "kin"].includes(sys.role) ? "civil" : "staff"}.svg`;
  return `${PORTRAITS}${sys.side === "ally" ? "pilot" : "enemy"}.svg`;
}

/** Готовность мира: актёры с серым силуэтом получают портрет системы (и их прототип токена тоже). */
export async function migratePortraits() {
  const updates = [];
  for (const a of game.actors) {
    if (!blankImg(a._source.img)) continue;
    const img = defaultPortrait(a.type, a._source.system);
    const u = { _id: a.id, img };
    if (blankImg(a.prototypeToken.texture.src)) u["prototypeToken.texture.src"] = img;
    updates.push(u);
  }
  if (updates.length) await Actor.updateDocuments(updates);
  return updates.length;
}

/** Окно метки: выбор навыка или системы в списке сразу отмечает и саму метку (раньше нужно было ещё щёлкнуть кружок). */
function pickWithSelect(root) {
  root.querySelectorAll(".form-group").forEach(g => {
    const r = g.querySelector('input[type="radio"]'), sel = g.querySelector("select");
    if (!r || !sel) return;
    const check = () => { if (!r.disabled) r.checked = true; };
    sel.addEventListener("focus", check);
    sel.addEventListener("change", check);
    sel.addEventListener("pointerdown", check);
  });
}

export class TBActor extends Actor {
  async _preCreate(data, options, user) {
    if ((await super._preCreate(data, options, user)) === false) return false;
    const pilot = this.type === "pilot", staff = this.type === "staff";
    const proto = {
      actorLink: pilot || staff,
      disposition: pilot || staff ? CONST.TOKEN_DISPOSITIONS.FRIENDLY : CONST.TOKEN_DISPOSITIONS.HOSTILE,
      displayBars: staff ? CONST.TOKEN_DISPLAY_MODES.NONE : CONST.TOKEN_DISPLAY_MODES.OWNER_HOVER,
      displayName: CONST.TOKEN_DISPLAY_MODES.HOVER,
      bar1: { attribute: staff ? null : "hp" },
      bar2: { attribute: pilot ? "strain" : null }
    };
    // вместо серого силуэта Foundry — портрет в стиле «Брифинга»
    const img = blankImg(data.img) ? defaultPortrait(this.type, data.system ?? {}) : data.img;
    const update = { prototypeToken: foundry.utils.mergeObject(proto, data.prototypeToken ?? {}) };
    if (img !== data.img) update.img = img;
    if (blankImg(update.prototypeToken.texture?.src)) update.prototypeToken.texture = { ...(update.prototypeToken.texture ?? {}), src: img };
    this.updateSource(update);
  }

  /** Смена роли персонажа на земле или стороны NPC: портрет по умолчанию меняется следом. */
  async _preUpdate(changed, options, user) {
    if ((await super._preUpdate(changed, options, user)) === false) return false;
    const sys = changed.system ?? {};
    if (!("role" in sys) && !("side" in sys)) return;
    // лист отправляет и картинку из шапки (data-edit="img"): это не выбор игрока, если она та же
    const own = "img" in changed && samePath(changed.img, this._source.img) === false;
    if (!defaultImg(this._source.img) || own) return;
    const img = defaultPortrait(this.type, { ...this._source.system, ...sys });
    if (samePath(img, this._source.img)) return;
    changed.img = img;
    if (samePath(this.prototypeToken.texture.src, this._source.img)) foundry.utils.setProperty(changed, "prototypeToken.texture.src", img);
  }

  /* ---------- броски (обёртки для листов и макросов) ---------- */
  rollSkill(skill) { return R.rollCheck(this, skill); }
  rollBreak(opts) { return R.rollBreak(this, opts); }
  rollRecover() { return R.rollRecover(this); }
  rollStall() { return R.rollStall(this); }
  fireMissile(opts) { return R.fireMissile(this, opts); }
  fireGuns(opts) { return R.fireGuns(this, opts); }
  fireSam(i, opts) { return R.fireSam(this, i, opts); }
  lockOn(opts) { return R.lockOn(this, opts); }

  /* ---------- высота ---------- */
  async setAltitude(alt, options = {}) {
    if (!TB.altitudes[alt]) return;
    return this.update({ "system.alt": alt }, options);
  }

  /** Подтянуть высоту токенов к полю alt (1 = Низкая, 2 = Средняя, 3 = Высокая). */
  async syncElevation() {
    const elev = TB.altElevation[this.system.alt];
    if (!elev) return;
    // у несвязанных копий своя высота: двигаем только те, что сейчас на той же высоте, что и актёр
    const tokens = this.isToken ? [this.token] : this.getActiveTokens(false, true).filter(t => t.isLinked || t.actor?.system.alt === this.system.alt);
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

  /**
   * Сменить машину пилота: старая уходит, HP и Strain полные по новой, Speed не выше нового Max Speed,
   * заглушка или силуэт на токенах меняется на силуэт новой машины. create создаёт предметы
   * (лист передаёт свой drop, чтобы сохранить ссылку на компендиум); по умолчанию — просто data.
   */
  async swapPlane(data, create = () => this.createEmbeddedDocuments("Item", [data])) {
    return this.withoutPoolSync(async () => {
      const old = this.items.filter(i => i.type === "plane").map(i => i.id);
      if (old.length) await this.deleteEmbeddedDocuments("Item", old);
      const created = await create();
      const upd = { "system.hp.value": this.system.hp.max, "system.strain.value": this.system.strain.max,
        "system.speed": Math.min(this.system.speed, this.system.maxSpeed), [`flags.${SYSTEM_ID}.pools`]: this.poolsFlag() };
      // своя картинка игрока остаётся; заглушка или силуэт системы меняется на силуэт нового самолёта
      const replaceable = src => !src || src.includes("mystery-man") || src.includes("/assets/planes/") || src.includes("/assets/portraits/");
      if (data.img && replaceable(this.prototypeToken.texture.src)) upd["prototypeToken.texture.src"] = data.img;
      await this.update(upd, { tbFree: true });
      if (data.img) for (const t of this.getActiveTokens(false, true)) if (replaceable(t.texture.src) && t.texture.src !== data.img) await t.update({ "texture.src": data.img });
      return created;
    });
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
  applyDamage(amount, opts = {}) {
    // по одной машине урон идёт строго по очереди: пока открыт выбор метки, второе попадание ждёт,
    // а потом видит уже поставленную метку или сбитую машину (иначе две метки или два засчитанных сбитых)
    const run = () => this.#applyDamage(amount, opts);
    // прошлое попадание ещё ждёт выбора (метка, «Рядом с тобой»): сказать, почему урон не пришёл сразу
    if (this._tbDamageBusy) ui.notifications.warn(`«${this.name}»: ${amount} урона ждут, пока закроют окно прошлого попадания.`);
    this._tbDamageBusy = true;
    const p = (this._tbDamage ?? Promise.resolve()).then(run, run);
    this._tbDamage = p;
    p.finally(() => { if (this._tbDamage === p) this._tbDamageBusy = false; }).catch(() => null);
    return p;
  }

  async #applyDamage(amount, { source, sourceUuid, roundKey, system, guard = false, one = false, gun = false } = {}) {
    amount = Number(amount) || 0;
    if (amount <= 0 || !["pilot", "npc"].includes(this.type)) return;
    const s = this.system;
    // по уже сбитой машине урон не идёт: иначе второй сбитый засчитался бы дважды
    if (this.statuses?.has(CONFIG.specialStatusEffects.DEFEATED) || s.markers?.doom)
      return this.#say(`<b>${esc(this.name)}</b> уже ${this.type === "pilot" ? "катапультировался" : "сбит"}: урон не нужен.`);
    // Бронированная кабина: первое попадание пушкой за вылет снимает на 2 HP меньше
    if (gun && hasProp(this, "armor") && !sortieUsed(this, "armor")) {
      await this.setFlag(SYSTEM_ID, "sortie", { ...(this.getFlag(SYSTEM_ID, "sortie") ?? {}), armor: sortieMark(this) });
      const was = amount;
      amount = Math.max(0, amount - 2);
      await this.#say(`<b>${esc(this.name)}</b>: бронированная кабина, первое попадание пушкой за вылет −2 HP урона (${was} → ${amount}).`);
      if (amount <= 0) return;
    }
    const opts = { sourceUuid, roundKey, system, one };
    // «Рядом с тобой»: товарищ в той же зоне может принять удар на себя
    if (this.type === "pilot" && !guard && await offerGuard(this, amount, { source, sourceUuid, roundKey })) return;
    this.#alarm();
    if (this.type === "npc" && s.kind === "ship") return this.#damageShip(amount, opts);
    if (this.type === "npc" && s.kind === "ground") {
      const hp = s.hp.value - amount;
      await this.update({ "system.hp.value": Math.max(0, hp) });
      if (hp <= 0) {
        // сначала отметка «сбит» со стрелком: иначе её раньше поставит хук статуса, уже без стрелка
        await this.#creditKill(sourceUuid);
        await this.toggleStatusEffect(CONFIG.specialStatusEffects.DEFEATED, { active: true, overlay: true });
        await this.#say(`<b>${esc(this.name)}</b> уничтожена.`);
        return this.#explode();
      }
      this.#chatter("damaged");
      return this.#say(`<b>${esc(this.name)}</b>: −${amount} HP, осталось ${hp}.`);
    }

    const hp = s.hp.value - amount;
    if (hp > 0) {
      await this.update({ "system.hp.value": hp });
      this.#chatter("damaged");
      return this.#say(`<b>${esc(this.name)}</b>: −${amount} HP, осталось ${hp} из ${s.hp.max}.`);
    }
    const key = roundKey ?? this.roundKey;
    if (key && s.markers.lastRound === key) {
      await this.update({ "system.hp.value": 1 });
      return this.#say(`<b>${esc(this.name)}</b>: HP до нуля, но метку в этом раунде уже ставили. Лишний урон сгорает, HP 1.`);
    }
    const full = this.type === "pilot" || this.system.fullMarkers;
    if (!full) {
      // «Пощада»: стрелок может отпустить дуэлянта вместо Doom
      if (await offerMercy(this, sourceUuid)) return;
      await this.update({ "system.hp.value": 0 });
      return this.markDoom("одна метка у конскриптов и дуэлянтов", opts);
    }
    // Grit и Structure уже стоят: выбирать нечего, это Doom («Обманный манёвр» ещё может отменить попадание)
    const m = s.markers;
    const fake = fakeoutReady(this, { guard });
    // «Летающий танк» (приём Су-25 и A-10A): вместо метки HP до максимума
    const tank = moveReady(this, "tank");
    const choice = m.grit && m.structure && !fake && !tank ? { marker: "doom" } : await this.#chooseMarker(fake, tank);
    if (choice?.marker === "tank") {
      await this.setFlag(SYSTEM_ID, "sortie", { ...(this.getFlag(SYSTEM_ID, "sortie") ?? {}), move: sortieMark(this) });
      await this.update({ "system.hp.value": s.hp.max });
      return this.#say(`<b>${esc(this.name)}</b>: «${esc(TB.planeMoves.tank.name)}». Метки нет, HP восстановлен до ${s.hp.max}.`);
    }
    if (choice?.marker === "fakeout") {
      await fake.update({ "system.used": true });
      return this.#say(`<b>${esc(this.name)}</b>: «${esc(fake.name)}». Попадание отменено, метку отмечать не нужно. HP остаётся ${s.hp.value}.`);
    }
    const upd = { "system.hp.value": s.hp.max, "system.markers.lastRound": key };
    if (!choice) {
      await this.update(upd);
      return this.#say(`<b>${esc(this.name)}</b>: HP до нуля. Метку выберите на листе, HP восстановлен до ${s.hp.max}.`);
    }
    if (choice.marker === "doom") {
      if (this.type === "npc" && await offerMercy(this, sourceUuid)) return;
      await this.update(upd);
      // «Рядом с тобой»: принял удар за товарища и получил Doom — гибнет сразу, без последних слов
      return this.markDoom(guard ? "принял удар за товарища («Рядом с тобой»)" : "", { ...opts, fallen: guard });
    }
    if (choice.marker === "grit") Object.assign(upd, { "system.markers.grit": true, "system.markers.gritSkill": choice.skill });
    if (choice.marker === "structure") Object.assign(upd, { "system.markers.structure": true, "system.markers.sys": choice.sys });
    await this.update(upd);
    this.#chatter("damaged");
    const what = choice.marker === "grit" ? `Grit: недоступен навык «${TB.skills[choice.skill]?.label}»`
      : `Structure: сломано «${TB.systems[choice.sys]?.label}» (${TB.systems[choice.sys]?.hint})`;
    return this.#say(`<b>${esc(this.name)}</b> получает метку ${what}. HP восстановлен до ${s.hp.max}.${this.system.markerCount >= 2 ? " После двух меток пора уходить из боя." : ""}`);
  }

  async markDoom(reason, { sourceUuid, roundKey, fallen = false } = {}) {
    await this.update({ "system.markers.doom": true, "system.markers.lastRound": roundKey ?? this.roundKey }, { tbDoom: true });
    // Doom — машина сбита у всех, и у пилота, и у аса: знак X, в конце раунда токен уходит с поля
    // отметка «сбит» со стрелком раньше статуса: хук статуса иначе поставит её без стрелка
    if (this.type === "pilot") await this.markDown(sourceUuid);
    else await this.#creditKill(sourceUuid);
    await this.toggleStatusEffect(CONFIG.specialStatusEffects.DEFEATED, { active: true, overlay: true });
    // пилоту: судьбу решает бросок на катапультирование, либо героическая гибель по своему выбору
    // карточку пишем от имени игрока пилота, чтобы кнопки достались ему, даже если урон нанёс ведущий
    if (this.type === "pilot" && fallen) {
      await this.update({ "system.service.status": "kia" });
      return this.#say(`<b>${esc(this.name)}</b>: метка <b>Doom</b>${reason ? ` (${esc(reason)})` : ""}. Пилот гибнет сразу, без последних слов.`);
    }
    if (this.type === "pilot") {
      // игрок может писать карточку только от своего имени; ведущий отдаёт её активному игроку пилота
      const player = game.user.isGM ? game.users.find(u => !u.isGM && u.active && this.testUserPermission(u, "OWNER")) : game.user;
      return R.postCard(this, { type: "doomfate", reason: reason ?? "" }, [], { author: player?.id });
    }
    return this.#say(`<b>${esc(this.name)}</b>: метка <b>Doom</b>${reason ? ` (${esc(reason)})` : ""}. Машина сбита.`);
  }

  /** Окно выбора метки нельзя просто закрыть: попадание уже засчитано, без выбора оно бы пропало. */
  async #chooseMarker(fake = null, tank = false) {
    for (let i = 0; i < 20; i++) {
      const d = await this.#markerDialog(fake, i, tank);
      if (d?.marker) return d;
      ui.notifications.warn(`«${this.name}»: попадание уже засчитано, выберите метку.`);
    }
    return null;
  }

  #markerDialog(fake, again, tank = false) {
    const m = this.system.markers;
    // сигнал «урон по системам» у того, кто выбирает метку
    if (!again) import("../sounds.mjs").then(x => x.playLocal("sysHit")).catch(() => null);
    const skills = Object.entries(TB.skills).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join("");
    const systems = Object.entries(TB.systems).map(([k, v]) => `<option value="${k}">${v.label}: ${v.hint}</option>`).join("");
    const radio = (v, label, extra, disabled) => `<div class="form-group"><label><input type="radio" name="marker" value="${v}" ${disabled ? "disabled" : ""}> ${label}</label>${extra}</div>`;
    return R.formDialog(`${this.name}: HP до нуля`, `
      <p class="tb-hint">${again ? "<b>Попадание уже засчитано: без метки окно откроется снова.</b> " : ""}Отметьте одну метку. HP восстановится до максимума.</p>
      ${radio("grit", "Grit: навык недоступен", `<select name="skill">${skills}</select>`, m.grit)}
      ${radio("structure", "Structure: сломана система", `<select name="sys">${systems}</select>`, m.structure)}
      ${radio("doom", "Doom: машина обречена, бросок на катапультирование", "", m.doom)}
      ${fake ? radio("fakeout", `«${esc(fake.name)}»: отменить попадание (раз за вылет)`, "", false) : ""}
      ${tank ? radio("tank", `«${esc(TB.planeMoves.tank.name)}»: без метки, HP до максимума (раз за вылет)`, "", false) : ""}`, { ok: "Отметить", render: pickWithSelect })
      .then(d => (d?.marker ? d : null));
  }

  /** Отметить машину сбитой в текущем бою: в конце раунда её уберут с поля и запишут в потери (losses.mjs). */
  async markDown(sourceUuid) {
    const c = game.combat;
    if (!c?.started || this.getFlag(SYSTEM_ID, "down")?.combat === c.id) return;
    const by = sourceUuid ? R.resolveActor(sourceUuid)?.name ?? "" : "";
    await this.setFlag(SYSTEM_ID, "down", { combat: c.id, round: c.round, by, byUuid: sourceUuid ?? "" });
    this.#alarm();
    this.#chatter("down", { victim: this.uuid, killer: sourceUuid ?? "" });
    // в трекере боец выбывает: заявок и хода у него больше нет
    const cb = c.combatants.find(x => (this.isToken ? x.tokenId === this.token?.id : x.actorId === this.id));
    if (cb && !cb.defeated && cb.isOwner) await cb.update({ defeated: true });
  }

  /** Сбитый вернулся (Doom снят на листе, «Сбит» снят в трекере или в меню токена): снова в бою. */
  async unmarkDown() {
    const c = game.combat;
    const dead = CONFIG.specialStatusEffects.DEFEATED;
    if (this.getFlag(SYSTEM_ID, "down")) await this.unsetFlag(SYSTEM_ID, "down");
    if (this.statuses?.has(dead)) await this.toggleStatusEffect(dead, { active: false });
    const cb = c?.combatants.find(x => (this.isToken ? x.tokenId === this.token?.id : x.actorId === this.id));
    if (cb?.defeated && cb.isOwner) await cb.update({ defeated: false });
  }

  /** Засчитать сбитого или уничтоженного пилоту-стрелку (для итогов вылета). */
  async #creditKill(sourceUuid) {
    await this.markDown(sourceUuid);
    const shooter = sourceUuid ? R.resolveActor(sourceUuid) : null;
    // «Счёт к оплате»: сбит виновный; «Отличная работа!»: товарищ подбадривает стрелка
    await billPaid(this).catch(err => console.warn(`${SYSTEM_ID} | Счёт к оплате`, err));
    if (shooter?.type !== "pilot") return;
    await afterKill(this, shooter).catch(err => console.warn(`${SYSTEM_ID} | Отличная работа`, err));
    const kind = this.system.kind === "air" ? "air" : "ground";
    const k = foundry.utils.deepClone(shooter.getFlag(SYSTEM_ID, "kills") ?? { air: 0, ground: 0 });
    k[kind] = (k[kind] ?? 0) + 1;
    // имена для разбора полёта
    // ас, Немезида и супероружие — для подсказки наград в «Итогах вылета»
    k.list = [...(k.list ?? []), { name: this.token?.name ?? this.name, kind,
      ace: this.system.tier === "ace", nemesis: !!this.system.nemesis, boss: this.system.grp === "boss" }];
    await shooter.setFlag(SYSTEM_ID, "kills", k);
  }

  /**
   * Урон по кораблю: по системе, на которую навёлся стрелок (system — её номер), иначе выбор в окне.
   * Система уничтожена, а урон остался — лишнее идёт на другую систему на выбор (книга: «Sea Targets»).
   */
  async #damageShip(amount, { sourceUuid, system, one = false } = {}) {
    const systems = foundry.utils.deepClone(this.system.systems);
    const lines = [];
    let left = amount, i = Number.isInteger(system) && systems[system] ? system : null;
    if (i !== null && systems[i].value <= 0) { lines.push(`«${esc(systems[i].name)}» уже уничтожена`); i = null; }
    while (left > 0) {
      const alive = systems.map((y, k) => ({ y, k })).filter(o => o.y.value > 0);
      if (!alive.length) break;
      if (i === null) {
        i = await this.#pickSystem(systems, left, !!lines.length);
        if (i === null) break;
      }
      const y = systems[i], take = Math.min(y.value, left);
      y.value -= take; left -= take;
      lines.push(`«${esc(y.name)}» −${take} HP${y.value ? `, осталось ${y.value}` : ", система уничтожена"}`);
      i = null;
      // удар по площади «снимает одну систему»: без перехода лишнего урона на другие
      if (one) { left = 0; break; }
    }
    if (!lines.length || systems.every((y, k) => y.value === this.system.systems[k].value)) {
      if (!systems.some(y => y.value > 0)) return this.#say(`${esc(this.name)}: все системы уже уничтожены.`);
      return;
    }
    await this.update({ "system.systems": systems });
    const alive = systems.filter(s => s.value > 0).length;
    if (alive) this.#chatter("damaged");
    if (!alive) {
      await this.#creditKill(sourceUuid);
      await this.toggleStatusEffect(CONFIG.specialStatusEffects.DEFEATED, { active: true, overlay: true });
      return this.#say(`<b>${esc(this.name)}</b>: ${lines.join("; ")}. Уничтожена последняя система. Цель потоплена.`);
    }
    return this.#say(`<b>${esc(this.name)}</b>: ${lines.join("; ")}${left > 0 ? `. ${left} урона не досталось ни одной системе` : ""}. Целых систем: ${alive}.`);
  }

  /** Окно выбора системы по схеме: куда попали или куда уходит лишний урон. Номер системы или null. */
  async #pickSystem(systems, amount, excess) {
    const { schematicHtml } = await import("../aim.mjs");
    const { tokenOf } = await import("../scene.mjs");
    // схема показывает HP с учётом уже снятого этим попаданием
    const view = new Proxy(this, { get: (t, k) => { if (k === "system") return { ...t.system, systems }; const v = Reflect.get(t, k); return typeof v === "function" ? v.bind(t) : v; } });
    const shadow = { actor: view, token: tokenOf(this), name: this.token?.name ?? this.name };
    const pick = systems.findIndex(y => y.value > 0);
    const data = await R.formDialog(`${this.name}: ${excess ? `лишний урон ${amount}` : "куда попали"}`,
      `${excess ? `<p class="tb-hint">Система уничтожена, осталось <b>${amount}</b> урона: на какую систему его пустить?</p>` : `<p class="tb-hint">${amount} урона: выберите систему.</p>`}
      ${schematicHtml(shadow, { selected: pick })}`,
      { ok: "Нанести", width: 520, cockpit: true, render: async root => (await import("../aim.mjs")).bindSchematic(root) });
    if (!data) return null;
    const i = Number(data.sys);
    return systems[i]?.value > 0 ? i : null;
  }

  /** «Взрыв» (Стрэйнджриал 9.3): уничтоженная цель наносит 2 урона всем наземным целям своего участка. */
  async #explode() {
    const { hasRule, tokenOf, cellOf } = await import("../scene.mjs");
    if (!hasRule(this, "explode") || !canvas?.ready) return;
    const me = cellOf(tokenOf(this));
    if (!me) return;
    const dead = CONFIG.specialStatusEffects.DEFEATED;
    const near = canvas.tokens.placeables.filter(t => t.actor && t.actor !== this && t.actor.type === "npc" && t.actor.system.kind === "ground"
      && !t.actor.statuses?.has(dead) && (c => c && c.col === me.col && c.row === me.row)(cellOf(t)));
    if (!near.length) return;
    await this.#say(`<b>${esc(this.name)}</b>: взрыв, 2 урона по соседям на участке: ${near.map(t => esc(t.name)).join(", ")}.`);
    for (const t of near) await t.actor.applyDamage(2, { source: `Взрыв: ${this.name}` });
  }

  /** Тревога у всех, если это приоритетная цель союзников или гражданских (sounds.mjs). */
  #alarm() {
    import("../sounds.mjs").then(m => m.priorityAlarm(this)).catch(err => console.warn(`${SYSTEM_ID} | звук`, err));
  }

  /** Переговоры NPC (chatter.mjs): подбит, сбит. Модуль грузится лениво, как радио в даунтайме. */
  #chatter(event, data = {}) {
    import("../chatter.mjs").then(m => m.chatter(event === "down" ? { event, ...data } : { event, speaker: this.uuid, ...data }))
      .catch(err => console.warn(`${SYSTEM_ID} | переговоры`, err));
  }

  #say(text) {
    return ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: this }),
      content: `<div class="tb-card tb-card-damage"><div class="tb-note">${text}</div></div>`
    });
  }

  /* ---------- вылет ---------- */
  /** Вернулся с перевооружения за линией возврата: HP, Structure, системы и боезапас как перед вылетом, Speed 1.
      Strain — только если так настроил ведущий (strain); Grit, триггеры и связи не трогаются. */
  async refitReturn({ strain = false } = {}) {
    const m = this.system.markers ?? {};
    await this.withoutPoolSync(async () => {
      await this.update({ "system.speed": 1, "system.breakEv": null, "system.lock": "", "system.lockUuid": "",
        "system.markers": { grit: !!m.grit, gritSkill: m.gritSkill ?? "", structure: false, sys: "", doom: false, lastRound: m.lastRound ?? "" } },
        { tbFree: true, tbDoom: true });
      await this.update({ "system.hp.value": this.system.hp.max, ...(strain ? { "system.strain.value": this.system.strain.max } : {}), [`flags.${SYSTEM_ID}.pools`]: this.poolsFlag() }, { tbFree: true });
    });
    const items = this.items.filter(i => i.type === "weapon" && i.system.ammo.max !== null)
      .map(i => ({ _id: i.id, "system.ammo.value": i.system.ammo.max + (this.system.ammoBonus?.[i.id] ?? 0) }));
    if (items.length) await this.updateEmbeddedDocuments("Item", items);
    for (const w of this.items.filter(i => i.type === "weapon" && i.getFlag(SYSTEM_ID, "off"))) await w.unsetFlag(SYSTEM_ID, "off");
  }


  /** Перед вылетом: Strain и HP до максимума, Speed 1, метки и Поворот сняты, ситуативные триггеры выключены, боезапас полный. */
  async prepareSortie() {
    const notes = [];
    await this.withoutPoolSync(async () => {
      await this.update({
        "system.speed": 1, "system.breakEv": null, "system.lock": "", "system.lockUuid": "", "system.twist": false,
        "system.markers": { grit: false, gritSkill: "", structure: false, sys: "", doom: false, lastRound: "" },
        [`flags.${SYSTEM_ID}.-=down`]: null, [`flags.${SYSTEM_ID}.-=escaped`]: null, [`flags.${SYSTEM_ID}.-=rearm`]: null,
        // разовые отметки вылета (фирменный приём, броня кабины) и отметки приёмов в бою
        [`flags.${SYSTEM_ID}.-=sortie`]: null, [`flags.${SYSTEM_ID}.-=cobra`]: null, [`flags.${SYSTEM_ID}.-=phoenix`]: null,
        [`flags.${SYSTEM_ID}.-=aoa`]: null, [`flags.${SYSTEM_ID}.-=dash`]: null, [`flags.${SYSTEM_ID}.-=supermano`]: null, [`flags.${SYSTEM_ID}.-=turnPick`]: null
      }, { tbFree: true, tbDoom: true });
      // после снятия меток и Поворота максимумы пересчитаны; Strain с учётом Нервов и «Свежей головы»
      const upd = { "system.hp.value": this.system.hp.max, "system.strain.value": this.system.strain.max, [`flags.${SYSTEM_ID}.pools`]: this.poolsFlag() };
      // «Взлёт по тревоге» перехватчика: вылет на Max Speed
      if (roleOf(this) === "icpt") notes.push("взлёт по тревоге");
      if (this.type === "pilot") {
        const st = startStrain(this);
        upd["system.strain.value"] = st.value;
        notes.push(...st.notes);
        upd["system.breakdown"] = "";
        upd["system.bonds"] = foundry.utils.deepClone(this.system.bonds).map(b => ({ ...b, used: false }));
        upd[`flags.${SYSTEM_ID}.-=stupor`] = null;
        if (this.system.edgeFly) notes.push("на пределе");
        else if (this.system.nerves >= DT.maxNerves) {
          notes.push("Нервы 5: на листе выберите «Лететь на пределе» или «Рапорт об отдыхе»");
          ui.notifications.warn(`${this.name}: Нервы 5. На вкладке «Даунтайм» выберите, лететь на пределе или подать рапорт об отдыхе.`);
        }
      }
      await this.update(upd);
    });
    if (roleOf(this) === "icpt") await this.update({ "system.speed": this.system.maxSpeed }, { tbFree: true });
    const items = [];
    for (const i of this.items) {
      if (i.type === "trigger" && (i.system.used || i.system.active || i.system.stack))
        items.push({ _id: i.id, "system.used": false, "system.active": false, "system.stack": 0 });
      if (i.type === "weapon" && i.system.ammo.max !== null)
        items.push({ _id: i.id, "system.ammo.value": i.system.ammo.max + (this.system.ammoBonus?.[i.id] ?? 0) });
    }
    if (items.length) await this.updateEmbeddedDocuments("Item", items);
    // Немезида ещё не появлялась: триггеры Немезиды снова закрыты, у её NPC сняты недостатки, вызов и поединок
    if (this.type === "pilot") await resetSortie(this);
    // боевые триггеры: разовые отметки вылета, выведенное «Форсированным выстрелом» спецоружие снова в строю
    if (this.type === "pilot") await resetCombatTriggers(this);
    for (const w of this.items.filter(i => i.type === "weapon" && i.getFlag(SYSTEM_ID, "off"))) await w.unsetFlag(SYSTEM_ID, "off");
    await this.toggleStatusEffect(CONFIG.specialStatusEffects.DEFEATED, { active: false }).catch(() => null);
    return this.#say(`<b>${esc(this.name)}</b> готов к вылету: Speed ${this.system.speed}, Strain ${this.system.strain.value}, HP ${this.system.hp.max}${notes.length ? ` (${notes.map(esc).join("; ")})` : ""}.`);
  }
}

export class TBItem extends Item {}
