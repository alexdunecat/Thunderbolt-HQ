/* Модели данных (TypeDataModel) для пилота, NPC, самолёта, спецоружия и триггера. */
import { SYSTEM_ID, TB } from "../config.mjs";
import { squadLayout, squadPoints } from "../squadrons.mjs";

const f = foundry.data.fields;
const int = (initial = 0, opts = {}) => new f.NumberField({ required: true, nullable: false, integer: true, initial, ...opts });
const nint = (initial = null) => new f.NumberField({ required: true, nullable: true, integer: true, initial });
const str = (initial = "") => new f.StringField({ required: true, blank: true, initial });
const bool = (initial = false) => new f.BooleanField({ required: true, initial });
const named = () => new f.ArrayField(new f.SchemaField({ key: str(), name: str(), text: str() }));
const SKILL_KEYS = Object.keys(TB.skills);
const skillSchema = () => new f.SchemaField(Object.fromEntries(SKILL_KEYS.map(k => [k, int(0, { min: 0, max: 10 })])));

/* Общее для всего, что летает или стоит на карте во время вылета. */
function sortieFields() {
  return {
    hp: new f.SchemaField({ value: int(3), max: int(3) }),
    strain: new f.SchemaField({ value: int(0), max: int(0) }),
    speed: int(1),
    alt: str("med"),
    breakEv: nint(),
    lock: str(), lockUuid: str(),
    markers: new f.SchemaField({
      grit: bool(), gritSkill: str(), structure: bool(), sys: str(), doom: bool(), lastRound: str()
    })
  };
}

/* Защита воздушной цели: Evasion (или Break!, если он выше) + Speed. */
function airDefense(sys, ev) {
  const evasion = Math.max(ev, sys.breakEv ?? -Infinity);
  return evasion + sys.speed;
}

export class PilotData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      callsign: str(), lastName: str(), firstName: str(), patronymic: str(),
      rank: str(), flight: str(), squadron: str(), base: str(), birth: str(),
      archetype: str(),
      questions: new f.SchemaField({ callsign: str(), ground: str(), fear: str(), defy: str() }),
      dossier: new f.ArrayField(new f.SchemaField({ text: str(), struck: bool() }), { initial: [{ text: "", struck: false }] }),
      service: new f.SchemaField({
        sorties: int(0, { min: 0 }), ops: int(0, { min: 0 }), air: int(0, { min: 0 }), ground: int(0, { min: 0 }),
        eject: int(0, { min: 0 }), awards: str(), status: str("active")
      }),
      bonusPoints: int(0),
      skills: skillSchema(),
      twist: bool(),
      wso: str(),
      ...sortieFields(),
      notes: new f.HTMLField({ required: true, blank: true })
    };
  }

  get plane() { return this.parent.items.find(i => i.type === "plane") ?? null; }

  prepareDerivedData() {
    const actor = this.parent;
    const plane = this.plane;
    const ps = plane?.system.stats ?? { spd: 1, ev: 0, aa: 0, ag: 0, hp: 1, str: 0, gun: 0, hard: 0 };
    const propKeys = new Set((plane?.system.props ?? []).map(p => p.key));
    const triggers = actor.items.filter(i => i.type === "trigger");

    // эффекты триггеров: { цель: [{ name, value }] }
    const fx = {};
    const push = (target, name, value) => (fx[target] ??= []).push({ name, value });
    this.ammoBonus = {};
    this.perkOn = Object.fromEntries(SKILL_KEYS.map(k => [k, 4]));
    this.compOn = Object.fromEntries(SKILL_KEYS.map(k => [k, 1]));
    for (const t of triggers) {
      const s = t.system;
      const chosen = [s.skill, s.skills > 1 ? s.skill2 : ""].filter(k => SKILL_KEYS.includes(k));
      for (const c of s.changes) {
        const n = s.factor(c, this);
        if (!n || !c.value) continue;
        const v = c.value * n;
        if (c.target === "skill.chosen") chosen.forEach(k => push(`skill.${k}`, t.name, v));
        else if (c.target === "perk.chosen") chosen.forEach(k => { this.perkOn[k] = Math.min(this.perkOn[k], c.value); });
        else if (c.target === "comp.chosen") chosen.forEach(k => { this.compOn[k] = Math.max(this.compOn[k], c.value); });
        else if (c.target === "ammo") { if (s.weapon) this.ammoBonus[s.weapon] = (this.ammoBonus[s.weapon] ?? 0) + v; }
        else push(c.target, t.name, v);
      }
    }
    // «В строю» у союзника вплотную: + его ранги Lead к Evasion
    try {
      for (const uuid of actor.getFlag?.(SYSTEM_ID, "adjacent") ?? []) {
        const ally = fromUuidSync(uuid);
        if (ally?.items?.some(i => i.type === "trigger" && i.system.key === "inelement") && ally.system.skills?.lead)
          push("evasion", `В строю: ${ally.name}`, ally.system.skills.lead);
      }
    } catch { /* союзник ещё не загружен: пересчёт на ready */ }
    const sum = target => (fx[target] ?? []).reduce((a, m) => a + m.value, 0);
    this.trigFx = fx;

    // навыки: база + триггеры (по навыку и на все броски)
    this.skillParts = Object.fromEntries(SKILL_KEYS.map(k => [k, [...(fx[`skill.${k}`] ?? []), ...(fx.allRolls ?? [])]]));
    this.skillMod = Object.fromEntries(SKILL_KEYS.map(k => [k, this.skillParts[k].reduce((a, m) => a + m.value, 0)]));
    this.skillTotal = Object.fromEntries(SKILL_KEYS.map(k => [k, this.skills[k] + this.skillMod[k]]));
    this.skillBlocked = Object.fromEntries(SKILL_KEYS.map(k => [k, this.markers.grit && this.markers.gritSkill === k]));
    this.pointsUsed = SKILL_KEYS.reduce((s, k) => s + this.skills[k], 0);
    this.pointsBudget = (this.archetype === "rookie" ? 3 : 6) + this.bonusPoints + sum("points");

    // самолёт с поправками триггеров и поломок
    const broken = this.markers.structure ? this.markers.sys : "";
    this.maxSpeed = Math.max(1, ps.spd + sum("maxSpeed") - (broken === "en" ? 1 : 0));
    this.hp.max = Math.max(1, ps.hp + sum("hpMax"));
    this.strain.max = broken === "fl" ? 0 : Math.max(0, (ps.str ?? 0) + sum("strainMax"));
    let ev = ps.ev + sum("evasion");
    if (propKeys.has("swing") && this.speed >= this.maxSpeed) ev += 1;
    if (propKeys.has("terrain") && this.alt === "low") ev += 1;
    this.evasion = ev;
    this.defense = airDefense(this, ev);
    this.aa = ps.aa + sum("aa"); this.ag = ps.ag + sum("ag"); this.gun = ps.gun + sum("gun"); this.hardpoints = ps.hard + sum("hardpoints");
    this.planeProps = propKeys;
    this.broken = broken;
    this.markerCount = ["grit", "structure", "doom"].filter(k => this.markers[k]).length;
  }
}

export class NpcData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      kind: str("air"), key: str(), grp: str(), grpName: str(), nato: str(), cls: str(), seats: int(1),
      tier: str("conscript"), bonus: int(0), squad: str(),
      skills: skillSchema(),
      stats: new f.SchemaField({ spd: int(3), ev: int(3), aa: nint(6), ag: nint(5), gun: nint(2), str: nint() }),
      ground: new f.SchemaField({ occ: int(4), ga: nint(), gg: nint(), gun: nint(), strafe: int(0) }),
      systems: new f.ArrayField(new f.SchemaField({
        name: str(), occ: int(4), hp: int(3), value: int(3), ga: nint(), gg: nint(), gun: nint(), note: str()
      })),
      props: named(), rules: named(),
      sig: new f.ArrayField(new f.StringField()),
      desc: str(), service: str(),
      ...sortieFields(),
      notes: new f.HTMLField({ required: true, blank: true })
    };
  }

  /* Конскрипты и дуэлянты: одна метка = Doom. Асы получают метки как пилоты. */
  get fullMarkers() { return this.tier === "ace"; }

  prepareDerivedData() {
    const conscript = this.tier === "conscript";
    // дуэлянты эскадрильи берут общую раскладку из настройки мира
    const layout = this.tier === "duelist" ? squadLayout(this.squad) ?? this.skills : this.skills;
    this.skillTotal = Object.fromEntries(SKILL_KEYS.map(k => [k, conscript ? this.bonus : layout[k] ?? 0]));
    this.squadPoints = squadPoints(layout);
    this.skillBlocked = Object.fromEntries(SKILL_KEYS.map(k => [k, this.markers.grit && this.markers.gritSkill === k]));
    this.perkOn = Object.fromEntries(SKILL_KEYS.map(k => [k, 4]));
    this.compOn = Object.fromEntries(SKILL_KEYS.map(k => [k, 1]));
    this.markerCount = ["grit", "structure", "doom"].filter(k => this.markers[k]).length;
    this.broken = this.markers.structure ? this.markers.sys : "";
    if (this.kind === "ship") {
      this.hp.max = this.systems.reduce((s, y) => s + y.hp, 0);
      this.hp.value = this.systems.reduce((s, y) => s + Math.max(0, y.value), 0);
      this.defense = null;
      this.maxSpeed = 0;
    } else if (this.kind === "ground") {
      this.defense = this.ground.occ;
      this.maxSpeed = 0;
    } else {
      this.maxSpeed = Math.max(1, this.stats.spd - (this.broken === "en" ? 1 : 0));
      this.evasion = this.stats.ev;
      this.defense = airDefense(this, this.stats.ev);
      this.aa = this.stats.aa; this.ag = this.stats.ag; this.gun = this.stats.gun;
      this.strain.max = this.tier === "ace" ? (this.stats.str ?? 0) : 0;
    }
  }
}

export class PlaneData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      key: str(), nato: str(), cls: str(), cat: str(), catName: str(), tier: int(0), tierName: str(), base: str(),
      seats: int(1), carrier: bool(), est: bool(),
      stats: new f.SchemaField({
        spd: int(3), ev: int(3), aa: int(6), ag: int(5), hp: int(3), str: int(10), gun: int(2), hard: int(1)
      }),
      props: named(),
      sig: new f.ArrayField(new f.StringField()),
      ac5: new f.ObjectField({ required: false, nullable: true, initial: null }),
      desc: str(), service: str()
    };
  }
}

export class WeaponData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      key: str(), group: str(), kind: str("book"), target: str("air"),
      ammo: new f.SchemaField({ value: nint(4), max: nint(4) }),
      dmg: str("5"), aa: nint(), ag: nint(), aim: nint(), dep: nint(),
      fx: str(),
      range: nint()   // null: по ключу из TB.weaponRange или как обычная ракета
    };
  }
  get unlimited() { return this.ammo.max === null; }
  /** Дальность в зонах: 0 своя, 1 соседние, 2 обычная ракета, 99 вся зона операции. */
  get reach() { return this.range ?? TB.weaponRange[this.key] ?? (this.target === "gun" ? TB.range.guns : TB.range.missile); }
}

export class TriggerData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      key: str(), archetype: str(), en: str(),
      types: new f.ArrayField(new f.StringField()),
      text: str(), skills: int(0), mod: int(0), slot: bool(),
      skill: str(), skill2: str(),
      used: bool(),
      active: bool(), stack: int(0, { min: 0 }), weapon: str(),
      // null: встроенные эффекты книжного триггера по ключу (TB.triggerEffects), массив: свой список
      effects: new f.ArrayField(new f.SchemaField({ target: str("hpMax"), value: int(1), when: str("always") }),
        { required: true, nullable: true, initial: null })
    };
  }

  /** Эффекты, которые сейчас действуют на чарник. */
  get changes() { return this.effects ?? TB.triggerEffects[this.key] ?? []; }
  get hasToggle() { return this.changes.some(c => c.when === "toggle"); }
  get hasStack() { return this.changes.some(c => c.when === "stack"); }
  get needsWeapon() { return this.changes.some(c => c.target === "ammo"); }

  /** Множитель эффекта: 0, если условие не выполнено. */
  factor(change, actorSystem) {
    switch (change.when) {
      case "twist": return actorSystem.twist ? 1 : 0;
      case "toggle": return this.active ? 1 : 0;
      case "stack": return this.stack;
      default: return 1;
    }
  }
}
