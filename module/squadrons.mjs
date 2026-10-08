/* Эскадрильи дуэлянтов: одна раскладка навыков на 4 очка на всю эскадрилью.
   Раскладки хранятся в настройке мира по названию эскадрильи; у машины в листе только название. */
import { SYSTEM_ID, TB } from "./config.mjs";
import { esc } from "./utils.mjs";

export const SQUAD_POINTS = 4;
const KEYS = Object.keys(TB.skills);
const blank = () => Object.fromEntries(KEYS.map(k => [k, 0]));

export function registerSquadronSettings() {
  game.settings.register(SYSTEM_ID, "squadrons", {
    scope: "world", config: false, type: Object, default: {},
    onChange: () => {
      for (const a of npcActors()) if (a.system.squad) { a.prepareData(); if (a.sheet?.rendered) a.sheet.render(false); }
      Hooks.callAll(`${SYSTEM_ID}.squadrons`);
    }
  });
  // эскадрилья вписана впервые: её раскладкой становятся навыки этой машины
  Hooks.on("updateActor", (actor, change, options, userId) => {
    const name = foundry.utils.getProperty(change, "system.squad");
    if (userId === game.user.id && name && game.user.isGM && !squadLayout(name)) setSquadLayout(name, actor.system.skills);
  });
}

/** Все раскладки: { название: { aim, deploy, … } }. */
export function allSquads() {
  try { return game.settings.get(SYSTEM_ID, "squadrons") ?? {}; } catch { return {}; }
}

export function squadLayout(name) {
  return name ? allSquads()[name] ?? null : null;
}

export const squadPoints = layout => KEYS.reduce((s, k) => s + (Number(layout?.[k]) || 0), 0);

/** Записать раскладку эскадрильи (только ведущий). */
export async function setSquadLayout(name, layout) {
  if (!game.user.isGM || !name) return;
  const all = foundry.utils.deepClone(allSquads());
  all[name] = { ...blank(), ...(all[name] ?? {}), ...Object.fromEntries(KEYS.filter(k => k in (layout ?? {})).map(k => [k, Math.max(0, Number(layout[k]) || 0)])) };
  return game.settings.set(SYSTEM_ID, "squadrons", all);
}

/** Распустить эскадрилью: раскладка удаляется, у машин стирается название. */
export async function deleteSquad(name) {
  if (!game.user.isGM) return;
  for (const a of squadMembers(name)) await a.update({ "system.squad": "" });
  const all = foundry.utils.deepClone(allSquads());
  delete all[name];
  return game.settings.set(SYSTEM_ID, "squadrons", all);
}

/** NPC мира и NPC токенов открытой сцены (у несвязанных токенов свои актёры). */
function npcActors() {
  const out = new Set(game.actors.filter(a => a.type === "npc"));
  for (const t of game.scenes?.viewed?.tokens ?? []) if (t.actor?.type === "npc") out.add(t.actor);
  return [...out];
}

/** Машины эскадрильи: актёры мира и токены на открытой сцене. */
export function squadMembers(name) {
  return npcActors().filter(a => a.system.tier === "duelist" && a.system.squad === name);
}

/** Ведущий: сделать выделенные токены NPC одной эскадрильей дуэлянтов. */
export async function squadFromSelection() {
  if (!game.user.isGM) return;
  const tokens = (canvas?.tokens?.controlled ?? []).filter(t => t.actor?.type === "npc" && t.actor.system.kind !== "ship");
  if (!tokens.length) return ui.notifications.warn("Выделите на сцене токены NPC, которые полетят одной эскадрильей.");
  const names = Object.keys(allSquads());
  const name = await new Promise(resolve => new Dialog({
    title: "Эскадрилья дуэлянтов",
    content: `<form class="tb-dialog"><p class="tb-hint">Машин выделено: ${tokens.length}. Они станут дуэлянтами с общей раскладкой навыков на ${SQUAD_POINTS} очка.</p>
      <div class="form-group"><label>Название</label><input type="text" name="squad" list="tb-squad-names" value="${esc(tokens[0].actor.system.squad)}" autofocus></div>
      <datalist id="tb-squad-names">${names.map(n => `<option value="${esc(n)}">`).join("")}</datalist></form>`,
    buttons: {
      ok: { icon: '<i class="fas fa-check"></i>', label: "Собрать", callback: html => resolve(html[0].querySelector("[name=squad]").value.trim()) },
      cancel: { label: "Отмена", callback: () => resolve(null) }
    },
    default: "ok", close: () => resolve(null)
  }, { classes: ["dialog", "thunderbolt"], width: 380 }).render(true));
  if (!name) return;
  if (!squadLayout(name)) await setSquadLayout(name, tokens[0].actor.system.skills);
  for (const t of tokens) await t.actor.update({ "system.tier": "duelist", "system.squad": name });
  ui.notifications.info(`Эскадрилья «${name}»: ${tokens.length} маш.`);
}
