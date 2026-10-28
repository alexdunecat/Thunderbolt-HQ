/* Именная эскадрилья дуэлянтов (Стрэйнджриал 9.1, решение Alex 28.10): запас Strain эскадрильи на вылет, тактики раз за вылет,
   строка ЭСКАДРИЛЬЯ в HUD ведущего. Две метки дуэлянта — documents/actor.mjs, бюджет раскладки и выбор тактик — squadrons.mjs.
   Состояние вылета (запас, отметки тактик) — настройка мира squadSortie по названию эскадрильи, на один бой. Пишет только ведущий. */
import { SYSTEM_ID, TB, airDuelist } from "./config.mjs";
import { esc, resolveActor } from "./utils.mjs";
import { squadTactics } from "./squadrons.mjs";
import { tokenOf, zoneDistance, altOf, sideOf, cellOf } from "./scene.mjs";

const KEY = "squadSortie";
const isLead = () => !!game.user?.isGM && (game.users?.activeGM?.isSelf ?? true);
const down = a => !!a?.statuses?.has?.(CONFIG.specialStatusEffects.DEFEATED) || !!a?.system?.markers?.doom;
const cmb = () => (game.combat?.started ? game.combat : null);
const same = (u, a) => !!u && !!a && (u === a.uuid || u === a.actor?.uuid);

export function registerDuelists() {
  game.settings.register(SYSTEM_ID, KEY, { scope: "world", config: false, type: Object, default: {},
    onChange: () => Hooks.callAll(`${SYSTEM_ID}.squadrons`) });
  // запас Strain выставляется в начале боя: потом сбитые машины его уже не уменьшают
  Hooks.on("combatStart", combat => { if (isLead()) startSortie(combat).catch(err => console.error(`${SYSTEM_ID} | запас эскадрилий`, err)); });
}

/* ---------- состав и состояние вылета ---------- */

/** Дуэлянты-самолёты эскадрильи на сцене боя (токены на холсте); alive — только несбитые. */
export function squadOnScene(name, { alive = false } = {}) {
  if (!name || !canvas?.ready) return [];
  return canvas.tokens.placeables.filter(t => airDuelist(t.actor) && t.actor.system.squad === name && !(alive && down(t.actor)));
}

const stored = () => { try { return game.settings.get(SYSTEM_ID, KEY) ?? {}; } catch { return {}; } };

/** Состояние эскадрильи в этом бою: { combat, strain: { value, max }, used: { тактика: раунд }, … }. Нового боя ещё нет в настройке — свежее. */
export function sortieOf(name) {
  const c = cmb();
  if (!c || !name) return null;
  const st = stored()[name];
  if (st?.combat === c.id) return st;
  const max = 2 * squadOnScene(name).length;
  return { combat: c.id, strain: { value: max, max }, used: {} };
}

async function patch(name, fn) {
  if (!game.user.isGM) return;
  const st = foundry.utils.deepClone(sortieOf(name));
  if (!st) return;
  fn(st);
  const all = Object.fromEntries(Object.entries(foundry.utils.deepClone(stored())).filter(([, v]) => v?.combat === st.combat));
  all[name] = st;
  return game.settings.set(SYSTEM_ID, KEY, all);
}

/** Начало боя: запас каждой эскадрильи на сцене = 2 × её дуэлянтов. */
async function startSortie() {
  const names = new Set(canvas?.tokens?.placeables.filter(t => airDuelist(t.actor) && t.actor.system.squad).map(t => t.actor.system.squad) ?? []);
  for (const name of names) await patch(name, () => {});
}

/* ---------- запас Strain ---------- */

/** Эскадрилья, из запаса которой тратит этот дуэлянт, или "". */
export const poolSquad = actor => (airDuelist(actor) && actor.system.squad) || "";

/** Запас Strain эскадрильи дуэлянта в этом бою: { value, max } или null. */
export function poolOf(actor) {
  const name = poolSquad(actor);
  return name ? sortieOf(name)?.strain ?? null : null;
}

/** Потратить из запаса эскадрильи. false — не хватило или вне боя. */
export async function spendPool(actor, n = 1) {
  const p = poolOf(actor);
  if (!p || p.value < n) return false;
  await patch(poolSquad(actor), st => { st.strain.value = Math.max(0, st.strain.value - n); });
  return true;
}

/* ---------- тактики ---------- */

/** Клещи: два живых дуэлянта эскадрильи держат на захвате одну цель из разных зон. { a, b, target } или null. */
function pincerPair(name) {
  const list = squadOnScene(name, { alive: true }).filter(t => t.actor.system.lockUuid);
  for (const a of list) for (const b of list) {
    if (a === b || a.actor.system.lockUuid !== b.actor.system.lockUuid) continue;
    if ((zoneDistance(a, b) ?? 0) >= 1) return { a, b, target: a.actor.system.lockUuid };
  }
  return null;
}

/** Строй: самая большая группа живых дуэлянтов в одной зоне (участок и высота), не меньше двух. */
function wallGroup(name) {
  const groups = new Map();
  for (const t of squadOnScene(name, { alive: true })) {
    const c = cellOf(t);
    const k = c ? `${c.col}:${c.row}:${altOf(t, t.actor)}` : t.id;
    groups.set(k, [...(groups.get(k) ?? []), t]);
  }
  const best = [...groups.values()].sort((x, y) => y.length - x.length)[0];
  return best?.length >= 2 ? best : null;
}

/** Почему тактику сейчас не применить ("" — можно). actor — выделенный дуэлянт (для «Приманки»). */
function blocker(name, key, actor = null) {
  const st = sortieOf(name);
  if (!st) return "только в идущем бою";
  if (!squadTactics(name).includes(key)) return "у эскадрильи нет этой тактики";
  if (st.used?.[key]) return "в этом вылете уже была";
  if (key === "revenge") return "сработает сама, когда дуэлянта собьёт пилот";
  if (key === "pincer" && !pincerPair(name)) return "нужны два дуэлянта с захватом одной цели из разных зон";
  if (key === "wall" && !wallGroup(name)) return "нужны два дуэлянта эскадрильи в одной зоне";
  if (key === "bait" && !(actor && poolSquad(actor) === name && !down(actor)) && !controlledMember(name)) return "выделите дуэлянта-приманку";
  return "";
}

const controlledMember = name => canvas?.tokens?.controlled?.find(t => airDuelist(t.actor) && t.actor.system.squad === name && !down(t.actor))?.actor ?? null;

/** Тактики эскадрильи для кнопок: [{ key, name, text, used, why }]. */
export function tacticsView(name, actor = null) {
  const st = sortieOf(name);
  return squadTactics(name).map(key => ({ key, ...TB.squadTactics[key], used: !!st?.used?.[key], why: blocker(name, key, actor) }));
}

/** Кто говорит за эскадрилью: живая открытая машина с меньшим номером. */
function speaker(name) {
  const t = squadOnScene(name, { alive: true }).filter(x => !x.document.hidden)
    .sort((a, b) => (Number(a.document.getFlag?.(SYSTEM_ID, "squadNo")) || 99) - (Number(b.document.getFlag?.(SYSTEM_ID, "squadNo")) || 99))[0];
  return t ? { name: t.name, side: sideOf(t.actor) } : { name, side: "enemy" };
}

/** Строка в эфир (субтитры и радиожурнал) и карточка с правилом тактики. */
async function announce(name, key, extra = "") {
  const t = TB.squadTactics[key], who = speaker(name);
  const { sendRadio } = await import("./radio.mjs");
  await sendRadio({ speaker: who.name, text: t.line, side: who.side === "player" ? "ally" : who.side });
  return ChatMessage.create({ speaker: { alias: "AWACS" },
    content: `<div class="tb-card tb-card-lock"><div class="tb-note">Эскадрилья «${esc(name)}»: тактика <b>«${esc(t.name)}»</b>. ${esc(t.text)}${extra ? ` ${extra}` : ""}</div></div>` });
}

/** Ведущий: применить тактику эскадрильи. actor — выделенный дуэлянт (приманка). */
export async function useTactic(name, key, actor = null) {
  if (!game.user.isGM) return;
  const why = blocker(name, key, actor);
  if (why) return ui.notifications.warn(`«${TB.squadTactics[key]?.name ?? key}»: ${why}.`);
  const round = cmb().round;
  let extra = "";
  let data = {};
  if (key === "pincer") {
    const p = pincerPair(name);
    data = { round, target: p.target, members: [p.a.actor.uuid, p.b.actor.uuid] };
    extra = `Клещи: ${esc(p.a.name)} и ${esc(p.b.name)}.`;
  } else if (key === "wall") {
    const g = wallGroup(name);
    data = { round, members: g.map(t => t.actor.uuid) };
    extra = `В строю: ${g.map(t => esc(t.name)).join(", ")}.`;
  } else if (key === "bait") {
    const b = actor && poolSquad(actor) === name && !down(actor) ? actor : controlledMember(name);
    data = { uuid: b.uuid, name: tokenOf(b)?.name ?? b.name };
    extra = `Приманка: ${esc(data.name)}.`;
  } else if (key === "carousel") data = { round, moved: [] };
  else if (key === "sun") data = { round };
  await patch(name, st => { st.used = { ...(st.used ?? {}), [key]: round }; st[key] = data; });
  return announce(name, key, extra);
}

/** «За ведомого»: дуэлянта сбил пилот — живые машины эскадрильи получают +2 к следующей атаке по нему. Ведущий, из markDoom. */
export async function duelistDown(actor, sourceUuid) {
  const name = poolSquad(actor), st = sortieOf(name);
  if (!st || !game.user.isGM || !squadTactics(name).includes("revenge") || st.used?.revenge) return;
  const killer = sourceUuid ? resolveActor(sourceUuid) : null;
  if (killer?.type !== "pilot") return;
  const members = squadOnScene(name, { alive: true }).filter(t => t.actor !== actor).map(t => t.actor.uuid);
  if (!members.length) return;
  await patch(name, s => { s.used = { ...(s.used ?? {}), revenge: cmb().round }; s.revenge = { uuid: killer.uuid, name: tokenOf(killer)?.name ?? killer.name, members }; });
  return announce(name, "revenge", `Цель: ${esc(tokenOf(killer)?.name ?? killer.name)}.`);
}

/* ---------- что тактики меняют в бою ---------- */

/** Поправки атаки от тактик: { parts, later } — later снимает разовую «За ведомого» после атаки. ta — актёр цели. */
export function tacticAttack(attacker, ta) {
  const out = { parts: [], later: [] };
  const c = cmb();
  if (!c || !attacker || !ta) return out;
  const mine = poolSquad(attacker);
  if (mine) {
    const st = sortieOf(mine);
    if (st?.pincer?.round === c.round && same(st.pincer.target, ta) && st.pincer.members.includes(attacker.uuid)) out.parts.push([TB.squadTactics.pincer.name, 2]);
    if (st?.revenge && same(st.revenge.uuid, ta) && st.revenge.members.includes(attacker.uuid)) {
      out.parts.push([`${TB.squadTactics.revenge.name}: ${st.revenge.name}`, 2]);
      out.later.push(() => patch(mine, s => { s.revenge.members = s.revenge.members.filter(u => u !== attacker.uuid); }));
    }
  }
  // «Приманка»: по остальным дуэлянтам эскадрильи из зоны приманки −2, пока она цела
  const theirs = poolSquad(ta);
  if (theirs && attacker.type === "pilot") {
    const bait = sortieOf(theirs)?.bait;
    const b = bait && bait.uuid !== ta.uuid ? resolveActor(bait.uuid) : null;
    const bt = b ? tokenOf(b) : null, me = tokenOf(attacker);
    if (bt && me && !down(b) && zoneDistance(me, bt) === 0) out.parts.push([`${TB.squadTactics.bait.name}: ${bait.name}`, -2]);
  }
  return out;
}

/** «Строй»: дуэлянт в строю этого раунда (Defense +1, не перемещается). */
export function inWall(actor) {
  const c = cmb(), name = poolSquad(actor);
  const w = name ? sortieOf(name)?.wall : null;
  return !!c && w?.round === c.round && w.members.includes(actor.uuid);
}

/** «Со стороны солнца»: ракеты этого дуэлянта в этом раунде без предупреждения MAWS. */
export function sunOn(actor) {
  const c = cmb(), name = poolSquad(actor);
  return !!c && sortieOf(name)?.sun?.round === c.round;
}

/** «Карусель»: дуэлянт ещё может бесплатно сместиться на соседнюю зону в этом раунде. */
export function carouselFree(actor) {
  const c = cmb(), name = poolSquad(actor);
  const k = name ? sortieOf(name)?.carousel : null;
  return !!c && k?.round === c.round && !k.moved.includes(actor.uuid);
}

/** Отметить бесплатное смещение «Карусели». */
export const carouselMoved = actor => patch(poolSquad(actor), st => { st.carousel.moved = [...(st.carousel.moved ?? []), actor.uuid]; });

/* ---------- HUD ведущего ---------- */

/** Строка ЭСКАДРИЛЬЯ в HUD у выделенного дуэлянта: запас Strain и кнопки тактик. */
export function squadRowHtml(actor) {
  const name = poolSquad(actor);
  if (!name || !game.user.isGM) return "";
  const p = poolOf(actor);
  const pool = p ? `<span class="tb-hud-plamp ${p.value ? "on" : ""}" title="Запас Strain эскадрильи на вылет: 2 за каждого дуэлянта на сцене, тратит любой">STRAIN ${p.value}/${p.max}</span>` : "";
  const btns = tacticsView(name, actor).map(t => `<button type="button" class="tb-hud-aoa ${t.used ? "on" : ""}" data-hud-tactic="${t.key}" ${t.why ? "disabled" : ""} title="${esc(t.name)} (раз за вылет): ${esc(t.text)}${t.why ? `\nСейчас: ${esc(t.why)}` : ""}">${esc(t.name.toUpperCase())}</button>`).join("");
  return `<div class="tb-hud-btns tb-hud-plane"><small title="Именная эскадрилья «${esc(name)}»">ЭСКАДРИЛЬЯ</small>${pool}${btns}</div>`;
}
