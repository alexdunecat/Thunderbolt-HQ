/* Модели данных (TypeDataModel) для пилота, NPC, самолёта, спецоружия и триггера. */
import { TB } from "../config.mjs";

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
    lock: str(),
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
    const tkeys = new Set(triggers.map(t => t.system.key));

    // навыки: база + триггеры, пороги Perk и Complication
    this.skillMod = Object.fromEntries(SKILL_KEYS.map(k => [k, 0]));
    this.perkOn = Object.fromEntries(SKILL_KEYS.map(k => [k, 4]));
    this.compOn = Object.fromEntries(SKILL_KEYS.map(k => [k, 1]));
    for (const t of triggers) {
      const s = t.system;
      if (s.key === "reckless" && s.skill) { this.skillMod[s.skill] += 2; this.compOn[s.skill] = 2; }
      if (s.key === "cautious_rk" && s.skill) { this.skillMod[s.skill] -= 1; this.perkOn[s.skill] = 3; }
      if (s.key === "cautious_og") for (const k of [s.skill, s.skill2]) if (k) this.perkOn[k] = 3;
    }
    this.skillTotal = Object.fromEntries(SKILL_KEYS.map(k => [k, this.skills[k] + this.skillMod[k]]));
    this.skillBlocked = Object.fromEntries(SKILL_KEYS.map(k => [k, this.markers.grit && this.markers.gritSkill === k]));
    this.pointsUsed = SKILL_KEYS.reduce((s, k) => s + this.skills[k], 0);
    this.pointsBudget = (this.archetype === "rookie" ? 3 : 6) + this.bonusPoints;

    // самолёт с поправками триггеров и поломок
    const broken = this.markers.structure ? this.markers.sys : "";
    this.maxSpeed = Math.max(1, ps.spd + (tkeys.has("holding") && this.twist ? 1 : 0) - (broken === "en" ? 1 : 0));
    this.hp.max = ps.hp + (tkeys.has("armor") ? 1 : 0);
    this.strain.max = broken === "fl" ? 0 : (ps.str ?? 0) + (tkeys.has("heart") ? 3 : 0);
    let ev = ps.ev;
    if (propKeys.has("swing") && this.speed >= this.maxSpeed) ev += 1;
    if (propKeys.has("terrain") && this.alt === "low") ev += 1;
    this.evasion = ev;
    this.defense = airDefense(this, ev);
    this.aa = ps.aa; this.ag = ps.ag; this.gun = ps.gun; this.hardpoints = ps.hard;
    this.planeProps = propKeys;
    this.broken = broken;
    this.markerCount = ["grit", "structure", "doom"].filter(k => this.markers[k]).length;
  }
}

export class NpcData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      kind: str("air"), key: str(), grp: str(), grpName: str(), nato: str(), cls: str(), seats: int(1),
      tier: str("conscript"), bonus: int(0),
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
    this.skillTotal = Object.fromEntries(SKILL_KEYS.map(k => [k, conscript ? this.bonus : this.skills[k]]));
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
      fx: str()
    };
  }
  get unlimited() { return this.ammo.max === null; }
}

export class TriggerData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      key: str(), archetype: str(), en: str(),
      types: new f.ArrayField(new f.StringField()),
      text: str(), skills: int(0), mod: int(0), slot: bool(),
      skill: str(), skill2: str(),
      used: bool()
    };
  }
}
