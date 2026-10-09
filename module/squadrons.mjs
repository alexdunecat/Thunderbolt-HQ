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
  Hooks.on("preCreateToken", (doc, data, options) => { if (!options.tbKeep) autoSquadNumber(doc); });
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
  return numberSquad(name);
}

/* ---------- номера машин в эскадрилье ---------- */

/** Обозначение эскадрильи для имён токенов (по умолчанию её название). */
export const squadTag = name => allSquads()[name]?.tag || name;

/** Машина токена: имя актёра-образца без номера. */
const machineOf = t => t.baseActor?.name ?? t.actor?.name ?? t.name;
const squadNo = t => Number(t.getFlag?.(SYSTEM_ID, "squadNo")) || null;
export const squadTokenName = (machine, tag, n) => `${machine} «${tag}-${n}»`;

/** Токены дуэлянтов эскадрильи на открытой сцене. */
function squadTokens(name, scene = game.scenes?.viewed) {
  return (scene?.tokens ?? []).filter(t => t.actor?.type === "npc" && t.actor.system.tier === "duelist" && t.actor.system.squad === name);
}

/** Свободный номер в эскадрилье на сцене. */
function freeNo(name, scene, taken = new Set()) {
  for (const t of squadTokens(name, scene)) if (squadNo(t)) taken.add(squadNo(t));
  let n = 1;
  while (taken.has(n)) n++;
  return n;
}

/**
 * Ведущий: обозначение эскадрильи и номера её машин на сцене. Имя токена станет «Машина «Обозначение-номер»».
 * Если в эскадрилье разные машины, номера выбираются в окне по каждой.
 */
export async function numberSquad(name) {
  if (!game.user.isGM) return;
  const scene = game.scenes.viewed, tokens = squadTokens(name, scene);
  if (!tokens.length) return ui.notifications.warn(`На сцене нет машин эскадрильи «${name}».`);
  tokens.sort((a, b) => (squadNo(a) ?? 99) - (squadNo(b) ?? 99) || machineOf(a).localeCompare(machineOf(b), "ru") || a.name.localeCompare(b.name, "ru"));
  const taken = new Set(tokens.map(squadNo).filter(Boolean));
  const nos = tokens.map(t => squadNo(t) ?? (() => { const n = freeNo(name, null, taken); taken.add(n); return n; })());
  const machines = new Set(tokens.map(machineOf));
  const rows = tokens.map((t, i) => `<tr><td>${esc(machineOf(t))}</td><td><small>${esc(t.name)}</small></td>
    <td><input type="number" name="n_${t.id}" value="${nos[i]}" min="1" style="width:4em"></td></tr>`).join("");
  const data = await new Promise(resolve => new Dialog({
    title: `Номера эскадрильи «${name}»`,
    content: `<form class="tb-dialog">
      <div class="form-group"><label>Обозначение</label><input type="text" name="tag" value="${esc(squadTag(name))}" placeholder="например, Жёлтые"></div>
      <p class="tb-hint">Имя токена станет «Машина «Обозначение-номер»», например «${esc(squadTokenName(machineOf(tokens[0]), squadTag(name), nos[0]))}».${machines.size > 1 ? " В эскадрилье разные машины: проверьте, кому какой номер." : ""} Новые машины эскадрильи получат следующий свободный номер сами.</p>
      <table class="tb-results"><tr><th>Машина</th><th>Сейчас</th><th>Номер</th></tr>${rows}</table></form>`,
    buttons: {
      ok: { icon: '<i class="fas fa-check"></i>', label: "Назначить", callback: html => {
        const f = html[0].querySelector("form"), out = { tag: f.elements.tag.value.trim() || name };
        for (const t of tokens) out[t.id] = Math.max(1, Number(f.elements[`n_${t.id}`].value) || 1);
        resolve(out);
      } },
      cancel: { label: "Отмена", callback: () => resolve(null) }
    },
    default: "ok", close: () => resolve(null)
  }, { classes: ["dialog", "thunderbolt"], width: 460 }).render(true));
  if (!data) return;
  const dup = tokens.map(t => data[t.id]).filter((n, i, all) => all.indexOf(n) !== i);
  if (dup.length) ui.notifications.warn(`Номер ${dup[0]} занят дважды: проверьте эскадрилью.`);
  const all = foundry.utils.deepClone(allSquads());
  all[name] = { ...blank(), ...(all[name] ?? {}), tag: data.tag };
  await game.settings.set(SYSTEM_ID, "squadrons", all);
  await scene.updateEmbeddedDocuments("Token", tokens.map(t => ({
    _id: t.id, name: squadTokenName(machineOf(t), data.tag, data[t.id]), [`flags.${SYSTEM_ID}.squadNo`]: data[t.id]
  })));
  ui.notifications.info(`Эскадрилья «${name}»: номера назначены.`);
}

const recent = new Map();
/** Новая машина эскадрильи на сцене сама получает обозначение и следующий свободный номер. */
export function autoSquadNumber(doc) {
  const a = doc.actor, name = a?.system?.squad;
  if (a?.type !== "npc" || a.system.tier !== "duelist" || !name || !allSquads()[name]?.tag || squadNo(doc)) return;
  // токены одной вставки создаются разом и на сцене друг друга ещё не видят: номера, выданные только что, тоже заняты
  const key = `${doc.parent?.id}:${name}`, given = recent.get(key) ?? new Set();
  const n = freeNo(name, doc.parent, new Set(given));
  given.add(n);
  recent.set(key, given);
  setTimeout(() => { if (recent.get(key) === given) recent.delete(key); }, 2000);
  doc.updateSource({ name: squadTokenName(machineOf(doc), squadTag(name), n), [`flags.${SYSTEM_ID}.squadNo`]: n });
}
