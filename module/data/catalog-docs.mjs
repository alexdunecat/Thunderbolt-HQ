/* Перевод записей data/catalog.json в данные документов Foundry.
   Без обращений к Foundry: тот же код используют сборщик компендиумов (Node) и импорт миссий (браузер). */

import { footprintOf, footprintTexture } from "../config.mjs";
const WEAPON_ICON = { air: "icons/svg/target.svg", ground: "icons/svg/fire.svg", gun: "icons/svg/sword.svg", util: "icons/svg/lightning.svg", line: "icons/svg/lightning.svg" };
export const TRIGGER_ICON = "icons/svg/upgrade.svg";

export function planeItem(p) {
  return {
    name: p.name, type: "plane", img: p.img,
    system: {
      key: p.key, nato: p.nato, cls: p.cls, cat: p.cat, catName: p.catName, tier: p.tier, tierName: p.tierName, base: p.base,
      seats: p.seats, carrier: p.carrier, est: p.est, stats: { ...p.stats }, props: p.props, sig: p.sig, ac5: p.ac5,
      desc: p.desc, service: p.service
    }
  };
}

export function weaponItem(w) {
  return {
    name: `${w.key} · ${w.name}`, type: "weapon", img: WEAPON_ICON[w.target] ?? WEAPON_ICON.air,
    system: {
      key: w.key, group: w.group, kind: w.kind, target: w.target,
      ammo: { value: w.ammo ?? null, max: w.ammo ?? null },
      dmg: String(w.dmg), aa: w.aa, ag: w.ag, aim: w.aim, dep: w.dep, fx: w.fx
    }
  };
}

export function triggerItem(t) {
  return {
    name: t.name, type: "trigger", img: TRIGGER_ICON,
    system: { key: t.key, archetype: t.archetype, en: t.en, types: t.types, text: t.text, skills: t.skills, mod: t.mod, slot: t.slot, skill: "", skill2: "", used: false }
  };
}

/** Актёр NPC. tier: conscript | duelist | ace. */
export function npcActor(n, { tier = "conscript", bonus = 0, name } = {}) {
  const sys = {
    kind: n.kind, key: n.key, grp: n.grp, grpName: n.grpName, nato: n.nato ?? "", cls: n.cls ?? "", seats: n.seats ?? 1,
    tier, bonus, props: n.props ?? [], rules: n.rules ?? [], sig: n.sig ?? [], desc: n.desc ?? "", service: n.service ?? "",
    speed: 1, alt: n.kind === "air" ? "med" : "low", side: n.side ?? "enemy"
  };
  if (n.kind === "air") {
    sys.stats = { spd: n.stats.spd ?? 3, ev: n.stats.ev ?? 0, aa: n.stats.aa, ag: n.stats.ag, gun: n.stats.gun, str: null };
    sys.hp = { value: n.stats.hp ?? 3, max: n.stats.hp ?? 3 };
  } else if (n.kind === "ground") {
    sys.ground = { occ: n.t.occ ?? 4, ga: n.t.ga, gg: n.t.gg, gun: n.t.gun, strafe: n.t.strafe ?? 0 };
    sys.hp = { value: n.t.hp ?? 3, max: n.t.hp ?? 3 };
    sys.speed = 0;
  } else {
    sys.systems = n.systems.map(y => ({ name: y.name, occ: y.occ ?? 4, hp: y.hp ?? 3, value: y.hp ?? 3, ga: y.ga, gg: y.gg, gun: y.gun, note: y.note ?? "" }));
    sys.speed = 0;
  }
  const fp = footprintOf(sys);
  return {
    name: name ?? n.name, type: "npc", img: n.img, system: sys,
    prototypeToken: { name: name ?? n.name, texture: { src: fp ? footprintTexture(n.img) : n.img }, actorLink: false, disposition: { ally: 1, neutral: 0 }[n.side] ?? -1 }
  };
}
