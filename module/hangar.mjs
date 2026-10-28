/* Ангар перед вылетом. AWACS (ведущий) на вкладке «Миссия» отмечает, какие машины и какое спецоружие сейчас выдаются,
   и открывает ангар игрокам. Игрок выбирает из этого допуска машину и спецоружие на каждый узел подвески;
   выбор ставится на лист (машина как при перетаскивании из компендиума, спецоружие с полным боезапасом) и уходит карточкой в чат.
   Пилоту, который сейчас в начатом бою, ангар закрыт. Ведущий видит то же, что игроки; галочка «Весь каталог» показывает остальное (с пометкой «вне допуска»), и ставит он что угодно.
   Спецоружие не из каталога (своё, от ведущего) ангар не трогает: оно остаётся на листе и занимает узлы.
   Игрок не ставит машину и спецоружие на лист в обход ангара (перетаскиванием из компендиума), а в начатом бою
   не может ни снять, ни добавить, ни переделать их (боезапас и флаги меняются как обычно). Ведущего это не касается. */
import { SYSTEM_ID, SYS_PATH, TB } from "./config.mjs";
import { esc } from "./utils.mjs";
import { planeItem, weaponItem } from "./data/catalog-docs.mjs";
import { playLocal } from "./sounds.mjs";

const EMPTY = { open: false, planes: [], weapons: [] };
const KIND = { book: "книга", hb: "Штаб", op: "опытное" };

let CAT = null;
/** Каталог машин и спецоружия (data/catalog.json). */
export async function hangarCatalog() {
  if (!CAT) CAT = await (await fetch(SYS_PATH + "data/catalog.json")).json();
  return CAT;
}
/** Для проверок без Foundry. */
export function setHangarCatalog(cat) { CAT = cat; }

export function registerHangar() {
  game.settings.register(SYSTEM_ID, "hangar", { scope: "world", config: false, type: Object, default: EMPTY, onChange: () => refresh() });
  Hooks.on("preCreateItem", (item, data, options) => guardLoadout(item, "create", options));
  Hooks.on("preDeleteItem", (item, options) => guardLoadout(item, "delete", options));
  Hooks.on("preUpdateItem", (item, change, options) => guardLoadout(item, "update", options, change));
  Hooks.on("renderChatMessage", (message, html) => {
    const root = html?.[0] ?? html;
    root?.querySelectorAll?.("[data-tb-hangar-open]").forEach(b => b.addEventListener("click", ev => { ev.preventDefault(); openHangar(); }));
  });
}

const LOADOUT = new Set(["plane", "weapon"]);
/** Пилот в начатом бою. */
export const inBattle = actor => !!actor && (game.combats?.contents ?? []).some(c => c.started && c.combatants.some(x => x.actorId === actor.id));
/** Почему игроку нельзя так менять машину или спецоружие на листе (null — можно). */
export function loadoutBlock(item, action, options = {}, change = {}, user = game.user) {
  const actor = item?.parent;
  if (user.isGM || actor?.type !== "pilot" || !LOADOUT.has(item.type)) return null;
  if (inBattle(actor)) {
    if (action !== "update") return "Идёт бой: машину и спецоружие меняют на земле.";
    const keys = Object.keys(foundry.utils.flattenObject(change)).filter(k => k !== "_id" && k !== "system.ammo.value" && !k.startsWith("flags.") && !k.startsWith("_stats"));
    if (keys.length) return "Идёт бой: спецоружие не переделывают в воздухе.";
  }
  if (action === "create" && !options.tbHangar && !options.tbDossier) return "Машину и спецоружие выдаёт ангар: кнопка «Ангар» в шапке листа.";
  return null;
}
function guardLoadout(item, action, options, change) {
  const why = loadoutBlock(item, action, options, change);
  if (!why) return;
  ui.notifications?.warn?.(why);
  return false;
}

/** Допуск AWACS: { open, planes: [ключи], weapons: [ключи] }. */
export function hangarState() {
  let s = null;
  try { s = game.settings.get(SYSTEM_ID, "hangar"); } catch { s = null; }
  return { open: !!s?.open, planes: [...(s?.planes ?? [])], weapons: [...(s?.weapons ?? [])] };
}
export async function setHangarState(patch) {
  const next = { ...hangarState(), ...patch };
  await game.settings.set(SYSTEM_ID, "hangar", next);
  return next;
}

// единый авиапарк: свои машины и машины из сводок NPC (fleet); допуск решает ведущий.
// Шаблонов книги в ангаре нет (решение ведущего): они остаются в компендиуме для старых листов и досье
const allPlanes = cat => [...(cat.planes ?? [])];
// внутри уровня свои машины раньше машин из сводок
const byTier = (cat, t) => allPlanes(cat).filter(p => p.tier === t).sort((a, b) => !!a.fleet - !!b.fleet);
const planeOf = (cat, key) => allPlanes(cat).find(p => p.key === key) ?? null;
const weaponOf = (cat, key) => (cat.weapons ?? []).find(w => w.key === key) ?? null;

/** Узлы от триггеров и прочего сверх машины: сколько добавится к узлам любой новой машины. */
export function bonusHard(actor) {
  const s = actor.system;
  return (s.hardpoints ?? 0) - (s.plane?.system.stats.hard ?? 0);
}
/** Спецоружие не из каталога: остаётся на листе как есть. */
export const ownWeapons = (actor, cat) => actor.items.filter(i => i.type === "weapon" && !weaponOf(cat, i.system.key));
/** Сколько узлов под выбор на этой машине. */
export const slotCount = (actor, p, cat) => Math.max(0, (p?.stats.hard ?? 0) + bonusHard(actor) - ownWeapons(actor, cat).length);

/** Почему пилоту сейчас нельзя менять машину (null — можно). */
export function lockReason(actor, user = game.user) {
  if (!actor) return "Пилот не выбран.";
  if (!user.isGM && !actor.isOwner) return "Это не ваш пилот.";
  const c = game.combat;
  if (!user.isGM && c?.started && c.combatants.some(x => x.actor?.id === actor.id)) return "Идёт бой: машину и подвеску меняют на земле.";
  if (!user.isGM && !hangarState().open) return "Ангар закрыт: AWACS ещё не выдал машины.";
  return null;
}

/** Ошибка выбора или null: машина и спецоружие из допуска, узлов хватает. */
export function checkChoice(actor, planeKey, weapons, cat, user = game.user) {
  const st = hangarState(), p = planeOf(cat, planeKey);
  if (!p) return "Машина не выбрана.";
  if (!user.isGM && !st.planes.includes(p.key)) return `${p.name}: AWACS эту машину не выдаёт.`;
  const want = weapons.filter(Boolean);
  for (const k of want) {
    if (!weaponOf(cat, k)) return `Нет такого спецоружия: ${k}.`;
    if (!user.isGM && !st.weapons.includes(k)) return `${k}: AWACS это спецоружие не выдаёт.`;
  }
  const n = slotCount(actor, p, cat);
  if (want.length > n) return `${p.name}: узлов подвески ${n}, выбрано ${want.length}.`;
  return null;
}

/** Подвеска по умолчанию: что сейчас на листе и разрешено, затем штатное машины, остальные узлы пустые. */
export function defaultLoadout(actor, p, cat, allowedWeapons) {
  const n = slotCount(actor, p, cat), ok = k => !!weaponOf(cat, k) && (!allowedWeapons || allowedWeapons.includes(k));
  const out = actor.items.filter(i => i.type === "weapon" && ok(i.system.key)).map(i => i.system.key);
  for (const k of p?.sig ?? []) if (out.length < n && ok(k) && !out.includes(k)) out.push(k);
  return Array.from({ length: n }, (_, i) => out[i] ?? "");
}

/**
 * Поставить выбор на лист. Машина меняется, только если другая. Спецоружие каталога сверяется с выбором:
 * то, что уже висит, остаётся (с боезапасом до полного), лишнее снимается, недостающее создаётся.
 * Триггеры и Заделы, привязанные к снятому спецоружию, переходят на новое по порядку.
 */
export async function applyLoadout(actor, planeKey, weapons, { cat = null, user = game.user, announce = true } = {}) {
  cat ??= await hangarCatalog();
  const err = lockReason(actor, user) ?? checkChoice(actor, planeKey, weapons, cat, user);
  if (err) { ui.notifications?.warn?.(err); return false; }
  const p = planeOf(cat, planeKey);
  if (actor.system.plane?.system.key !== p.key) await actor.swapPlane(planeItem(p), () => actor.createEmbeddedDocuments("Item", [planeItem(p)], { tbHangar: true }));

  const want = weapons.filter(Boolean);
  const pool = actor.items.filter(i => i.type === "weapon" && weaponOf(cat, i.system.key));
  const make = [];
  for (const k of want) {
    const j = pool.findIndex(w => w.system.key === k);
    if (j >= 0) pool.splice(j, 1);
    else make.push(k);
  }
  const created = make.length ? await actor.createEmbeddedDocuments("Item", make.map(k => weaponItem(weaponOf(cat, k))), { tbHangar: true }) : [];
  const moved = Object.fromEntries(pool.map((w, i) => [w.id, created[i]?.id ?? ""]));
  const trig = actor.items.filter(i => i.type === "trigger" && i.system.weapon && i.system.weapon in moved)
    .map(i => ({ _id: i.id, "system.weapon": moved[i.system.weapon] }));
  if (trig.length) await actor.updateEmbeddedDocuments("Item", trig);
  const edges = actor.system.edges ?? [];
  if (edges.some(e => e.weapon && e.weapon in moved))
    await actor.update({ "system.edges": edges.map(e => (e.weapon && e.weapon in moved ? { ...e, weapon: moved[e.weapon] } : e)) });
  if (pool.length) await actor.deleteEmbeddedDocuments("Item", pool.map(w => w.id), { tbHangar: true });
  const s = actor.system;
  const ammo = actor.items.filter(i => i.type === "weapon" && i.system.ammo.max !== null && weaponOf(cat, i.system.key))
    .map(i => ({ _id: i.id, "system.ammo.value": i.system.ammo.max + (s.ammoBonus?.[i.id] ?? 0) }));
  if (ammo.length) await actor.updateEmbeddedDocuments("Item", ammo);

  if (announce) await ChatMessage.create({
    speaker: { alias: actor.name },
    content: `<div class="tb-card tb-hangar-card"><h3><i class="fas fa-warehouse"></i> Ангар</h3>
      <p><b>${esc(p.name)}</b>${p.nato ? ` <small>${esc(p.nato)}</small>` : ""}</p>
      <p>Подвеска: ${want.length ? want.map(k => `<b>${esc(k)}</b>`).join(", ") : "пусто"}${ownWeapons(actor, cat).length ? ` · своё: ${ownWeapons(actor, cat).map(w => esc(w.name)).join(", ")}` : ""}</p></div>`
  });
  return true;
}

/** Карточка в чат: ангар открыт, кнопка у каждого открывает его для своего пилота. */
export async function announceHangar() {
  const st = hangarState(), cat = await hangarCatalog();
  const names = st.planes.map(k => planeOf(cat, k)?.name).filter(Boolean);
  return ChatMessage.create({
    speaker: { alias: "AWACS" },
    content: `<div class="tb-card tb-hangar-card"><h3><i class="fas fa-warehouse"></i> Ангар открыт</h3>
      <p>Машины: ${names.length ? names.map(esc).join(", ") : "нет"}.</p>
      <p>Спецоружие: ${st.weapons.length ? st.weapons.map(esc).join(", ") : "нет"}.</p>
      <button type="button" data-tb-hangar-open><i class="fas fa-plane"></i> Выбрать машину и подвеску</button></div>`
  });
}

/* ---------- разметка ---------- */

const tierLabel = (cat, t) => `Уровень ${t} · ${allPlanes(cat).find(p => p.tier === t)?.tierName ?? ""}`;
const tiers = cat => [...new Set(allPlanes(cat).map(p => p.tier))].sort((a, b) => a - b);

/** Панель допуска у ведущего. */
export function adminHtml(cat, st = hangarState()) {
  const P = allPlanes(cat), W = cat.weapons ?? [];
  const groups = tiers(cat).map(t => `<h4>${esc(tierLabel(cat, t))}</h4><div class="tb-hg-grid">${byTier(cat, t).map(p => {
    const on = st.planes.includes(p.key);
    return `<label class="tb-hg-card${on ? " on" : ""}"><input type="checkbox" data-hg-plane="${esc(p.key)}" ${on ? "checked" : ""}>
      <img src="${esc(p.img)}" alt=""><span><b>${esc(p.name)}</b><small>${esc(p.cls)}${p.fleet ? " · из сводок" : ""} · узлов ${p.stats.hard}${p.sig?.length ? ` · ${esc(p.sig.join(", "))}` : ""}</small></span></label>`;
  }).join("")}</div>`).join("");
  const wgroups = [...new Set(W.map(w => w.group))].map(g => `<h4>${esc(g)}</h4><div class="tb-hg-wlist">${W.filter(w => w.group === g).map(w => {
    const on = st.weapons.includes(w.key);
    return `<label class="tb-hg-weap${on ? " on" : ""}" title="${esc(w.fx)}"><input type="checkbox" data-hg-weapon="${esc(w.key)}" ${on ? "checked" : ""}>
      <b>${esc(w.key)}</b><span>${esc(w.name)}</span><small>${w.ammo ?? "∞"} · ${esc(KIND[w.kind] ?? w.kind)}</small></label>`;
  }).join("")}</div>`).join("");
  return `<div class="tb-hangar tb-hangar-gm">
    <header class="tb-hg-head">
      <label class="tb-hg-switch${st.open ? " on" : ""}"><input type="checkbox" data-hg-open ${st.open ? "checked" : ""}><span class="tb-hg-lamp"></span> ${st.open ? "Ангар открыт игрокам" : "Ангар закрыт"}</label>
      <button type="button" data-hg-announce ${st.open ? "" : "disabled"}><i class="fas fa-bullhorn"></i> Объявить в чате</button>
      <button type="button" data-hg-pilot><i class="fas fa-plane"></i> Ангар пилота</button>
      <span class="tb-hg-count">Машин ${P.filter(p => st.planes.includes(p.key)).length} из ${P.length} · спецоружия ${st.weapons.length} из ${W.length}</span>
    </header>
    <div class="tb-hg-scroll">
      <section><h3>Машины</h3>
        <div class="tb-hg-quick"><button type="button" data-hg-q="planes-all">Все</button><button type="button" data-hg-q="planes-none">Ничего</button><button type="button" data-hg-q="own" title="Только машины ВВС Юктобании, без машин из сводок">Только свои</button>
          ${tiers(cat).map(t => `<button type="button" data-hg-q="tier" data-tier="${t}" title="Все машины уровня ${t} и ниже">до уровня ${t}</button>`).join("")}</div>
        ${groups}
      </section>
      <section><h3>Спецоружие</h3>
        <div class="tb-hg-quick"><button type="button" data-hg-q="weapons-all">Все</button><button type="button" data-hg-q="weapons-none">Ничего</button>
          <button type="button" data-hg-q="sig" title="Добавить штатное спецоружие отмеченных машин">Штатное отмеченных машин</button>
          <button type="button" data-hg-q="book" title="Только спецоружие из книги правил">Только из книги</button></div>
        ${wgroups}
      </section>
    </div>
  </div>`;
}

/** Быстрый выбор в допуске. */
export function quickPick(cat, st, q, tier = 0) {
  const P = allPlanes(cat), W = cat.weapons ?? [];
  switch (q) {
    case "planes-all": return { ...st, planes: P.map(p => p.key) };
    case "planes-none": return { ...st, planes: [] };
    case "tier": return { ...st, planes: P.filter(p => p.tier > 0 && p.tier <= tier).map(p => p.key) };
    case "own": return { ...st, planes: P.filter(p => p.tier > 0 && !p.fleet).map(p => p.key) };
    case "weapons-all": return { ...st, weapons: W.map(w => w.key) };
    case "weapons-none": return { ...st, weapons: [] };
    case "sig": return { ...st, weapons: W.map(w => w.key).filter(k => st.weapons.includes(k) || st.planes.some(pk => planeOf(cat, pk)?.sig?.includes(k))) };
    case "book": return { ...st, weapons: W.filter(w => w.kind === "book").map(w => w.key) };
  }
  return st;
}

const roleOfP = p => TB.planeRoles?.[p?.role || TB.roleOf?.[p?.key]] ?? null;
const moveOfP = p => TB.planeMoves?.[p?.move || TB.moveOf?.[p?.key]] ?? null;
const ROMAN = ["", "I", "II", "III", "IV", "V"];
const GAUGE = { spd: "SPD", ev: "EVA", aa: "A-A", ag: "A-G", hp: "HP", str: "STR", gun: "GUN", hard: "HRD" };
/** Наибольшее значение каждой характеристики в авиапарке: шкалы ТТХ в ангаре считаются от него. */
const statMax = cat => Object.fromEntries(Object.keys(GAUGE).map(k => [k, Math.max(1, ...allPlanes(cat).map(p => p.stats[k] ?? 0))]));
/** Где на схеме висит узел i из n: первый нечётный — под фюзеляжем, остальные парами под крыльями. */
function pylonAt(i, n) {
  if (n % 2 && i === 0) return [50, 76];
  const j = n % 2 ? i - 1 : i, rank = Math.floor(j / 2), side = j % 2 ? 1 : -1;
  return [50 + side * (17 + rank * 11), 60 + rank * 5];
}
const pad2 = n => String(n).padStart(2, "0");

/** Ангар пилота: стоянка слева, справа бокс с выбранной машиной, ТТХ и пульт подвески. */
export function pilotHtml(cat, { actor, pilots = [], planeKey, slots = [], user = game.user, full = false, fresh = false } = {}) {
  const st = hangarState(), gm = user.isGM && full;   // gm: ведущий смотрит весь каталог
  const lock = lockReason(actor, user);
  const P = allPlanes(cat).filter(p => gm || st.planes.includes(p.key));
  const cur = actor?.system.plane?.system.key ?? "";
  const p = planeOf(cat, planeKey) ?? null;
  const pick = pilots.length > 1 ? `<select data-hg-actor>${pilots.map(a => `<option value="${a.id}" ${a.id === actor?.id ? "selected" : ""}>${esc(a.name)}</option>`).join("")}</select>` : `<b>${esc(actor?.name ?? "нет пилота")}</b>`;
  const state = !st.open ? ["closed", "ЗАКРЫТ"] : lock ? ["closed", "НЕДОСТУПЕН"] : ["open", "ОТКРЫТ"];
  const off = x => gm && !st.planes.includes(x.key);
  const list = P.length ? tiers(cat).map(t => {
    const row = byTier(cat, t).filter(x => P.includes(x));
    return row.length ? `<h4><span class="tb-hgx-roman">${ROMAN[t] ?? t}</span>${esc(allPlanes(cat).find(x => x.tier === t)?.tierName ?? "")}<small>${row.length}</small></h4>${row.map(x => `<a class="tb-hg-row${x.key === planeKey ? " on" : ""}${off(x) ? " off" : ""}" data-hg-pick="${esc(x.key)}">
      <img src="${esc(x.img)}" alt=""><span><b>${esc(x.name)}${moveOfP(x) ? ` <i class="tb-hgx-star" title="Приём: ${esc(moveOfP(x).name)}">★</i>` : ""}</b><small>${esc(x.cls)}${roleOfP(x) ? ` · ${esc(roleOfP(x).name)}` : ""}${x.fleet ? " · из сводок" : ""}${off(x) ? " · вне допуска" : ""}</small></span>${x.key === cur ? `<i class="tb-hgx-mine" title="Сейчас на листе">НА ЛИСТЕ</i>` : ""}</a>`).join("")}` : "";
  }).join("") : `<p class="tb-muted">AWACS пока не выдал ни одной машины.${user.isGM ? " Отметьте машины в допуске или включите «Весь каталог»." : ""}</p>`;
  const W = (cat.weapons ?? []).filter(w => gm || st.weapons.includes(w.key));
  const own = actor ? ownWeapons(actor, cat) : [];
  const max = statMax(cat);
  const gauge = k => {
    const v = p.stats[k] ?? 0, seg = 12, lit = Math.round(seg * v / max[k]);
    return `<div class="tb-hgx-gauge" title="${esc(TB.planeStats[k][0])}: ${esc(TB.planeStats[k][1])}"><i>${GAUGE[k]}</i>
      <span class="tb-hgx-seg">${Array.from({ length: seg }, (_, i) => `<b class="${i < lit ? "on" : ""}"></b>`).join("")}</span><em>${v}</em></div>`;
  };
  const filled = slots.filter(Boolean).length;
  const bay = !p ? `<div class="tb-hgx-stage tb-hgx-idle"><span class="tb-hgx-floor"></span><p class="tb-hg-empty">Бокс пуст. Выберите машину на стоянке слева.</p></div>` : `
    <section class="tb-hgx-stage${fresh ? " fresh" : ""}">
      <span class="tb-hgx-floor"></span><span class="tb-hgx-sweep"></span>
      <span class="tb-hgx-corner tl"></span><span class="tb-hgx-corner tr"></span><span class="tb-hgx-corner bl"></span><span class="tb-hgx-corner br"></span>
      <div class="tb-hgx-plate tl">БОКС ${pad2(allPlanes(cat).indexOf(p) + 1)}<small>ВВС ЮКТОБАНИИ · ТЕХЧАСТЬ</small></div>
      <div class="tb-hgx-plate tr"><span class="tb-hgx-tier">${ROMAN[p.tier] ?? ""} · ${esc(p.tierName ?? "")}</span>${p.carrier ? `<span>⚓ ПАЛУБНЫЙ</span>` : ""}${p.fleet ? `<span>ИЗ СВОДОК</span>` : ""}${p.key === cur ? `<span class="mine">НА ЛИСТЕ</span>` : ""}</div>
      <div class="tb-hgx-craft"><img src="${esc(p.img)}" alt="">
        ${slots.map((k, i) => { const [x, y] = pylonAt(i, slots.length);
          return `<button type="button" class="tb-hgx-pylon${k ? " on" : ""}" style="left:${x}%;top:${y}%" data-hg-focus="${i}" title="Узел ${i + 1}: ${k ? esc(weaponOf(cat, k)?.name ?? k) : "пусто"}"><span>${k ? esc(k) : i + 1}</span></button>`; }).join("")}
      </div>
      <div class="tb-hgx-name"><h2>${esc(p.name)}</h2><span>${esc(p.nato ?? "")}</span><small>${esc(p.cls)} · ${esc(p.base ?? "")}${p.seats > 1 ? ` · экипаж ${p.seats}` : ""}</small></div>
    </section>
    <section class="tb-hgx-sheet">
      <div class="tb-hgx-ttx"><h3>ТТХ <small>от лучшей машины авиапарка</small></h3>${Object.keys(GAUGE).map(gauge).join("")}</div>
      <div class="tb-hgx-form"><h3>Формуляр</h3>
        ${p.desc ? `<p>${esc(p.desc)}</p>` : ""}${p.service ? `<p class="tb-hgx-quote">${esc(p.service)}</p>` : ""}
        ${p.props?.length ? `<ul class="tb-hg-props">${p.props.map(x => `<li><b>${esc(x.name)}.</b> ${esc(x.text)}</li>`).join("")}</ul>` : ""}
        ${roleOfP(p) || moveOfP(p) ? `<ul class="tb-hg-props tb-hgx-role">${roleOfP(p) ? `<li><b>Роль: ${esc(roleOfP(p).name)}${roleOfP(p).trait ? ` · ${esc(roleOfP(p).trait)}` : ""}.</b> ${esc(roleOfP(p).text)}</li>` : ""}${moveOfP(p) ? `<li class="move"><b>★ ${esc(moveOfP(p).name)} (раз за вылет).</b> ${esc(moveOfP(p).text)}</li>` : ""}</ul>` : ""}</div>
    </section>
    <h3 class="tb-hgx-h">Пульт подвески <small>${slots.length} ${slots.length === 1 ? "узел" : slots.length < 5 && slots.length ? "узла" : "узлов"}${bonusHard(actor) ? ` (с триггерами ${bonusHard(actor) > 0 ? "+" : ""}${bonusHard(actor)})` : ""} · заряжено ${filled}</small></h3>
    <div class="tb-hg-slots">${slots.map((k, i) => {
      const w = weaponOf(cat, k);
      return `<div class="tb-hg-slot${k ? " on" : ""}${p.sig?.includes(k) ? " sig" : ""}"><span class="tb-hg-lamp"></span><i>УЗЕЛ ${i + 1}</i>
        <span class="tb-hgx-code">${k ? esc(k) : "— — —"}</span>
        <select data-hg-slot="${i}" ${lock ? "disabled" : ""}><option value="">— пусто —</option>${W.map(x => `<option value="${esc(x.key)}" ${x.key === k ? "selected" : ""}>${esc(x.key)} · ${esc(x.name)}${p.sig?.includes(x.key) ? " ★ штатное" : ""}${gm && !st.weapons.includes(x.key) ? " (вне допуска)" : ""}</option>`).join("")}</select>
        <span class="tb-hgx-ammo">${w ? (w.ammo ?? "∞") : "0"}</span>
        <small>${w ? `${esc(w.name)} · урон ${esc(w.dmg)} · ${esc(w.fx)}` : "Узел свободен."}</small></div>`;
    }).join("") || `<p class="tb-muted">Узлов подвески нет.</p>`}</div>
    ${own.length ? `<p class="tb-small tb-muted">Своё спецоружие на листе остаётся и занимает узлы: ${own.map(w => esc(w.name)).join(", ")}.</p>` : ""}
    ${p.sig?.length ? `<p class="tb-small tb-muted">Штатное для этой машины: ${esc(p.sig.join(", "))}${gm ? "" : p.sig.some(k => !st.weapons.includes(k)) ? " (не всё выдаётся)" : ""}.</p>` : ""}
    <footer class="tb-hgx-go">
      <span class="tb-hgx-ready"><span class="tb-hg-lamp${p ? " lit" : ""}"></span>МАШИНА<span class="tb-hg-lamp${slots.length && filled === slots.length ? " lit" : filled ? " half" : ""}"></span>ПОДВЕСКА ${filled}/${slots.length}<span class="tb-hg-lamp${lock ? "" : " lit"}"></span>ДОПУСК</span>
      <button type="button" class="tb-hg-go" data-hg-apply ${lock ? "disabled" : ""}><i class="fas fa-plane-departure"></i> К вылету: принять машину и подвеску</button>
    </footer>`;
  return `<div class="tb-hangar tb-hangar-pilot">
    <header class="tb-hg-head"><span class="tb-hgx-brand">АНГАР<small>ВВС ЮКТОБАНИИ</small></span><span class="tb-hgx-who">ПИЛОТ ${pick}</span><span class="tb-hg-state ${state[0]}"><span class="tb-hg-lamp"></span> АНГАР ${state[1]}</span>
      ${lock ? `<span class="tb-hg-why">${esc(lock)}</span>` : user.isGM && !st.open ? `<span class="tb-hg-why">Игрокам закрыт; ведущий ставит что угодно.</span>` : ""}
      ${user.isGM ? `<label class="tb-hg-full" title="Показать и то, что AWACS сейчас не выдаёт"><input type="checkbox" data-hg-full ${full ? "checked" : ""}> Весь каталог</label>` : ""}</header>
    <div class="tb-hg-body"><aside class="tb-hg-list"><div class="tb-hgx-lhead">СТОЯНКА <small>${P.length} ${P.length % 10 === 1 && P.length % 100 !== 11 ? "машина" : P.length % 10 >= 2 && P.length % 10 <= 4 && (P.length % 100 < 10 || P.length % 100 >= 20) ? "машины" : "машин"}</small></div>${list}</aside><main class="tb-hg-bay">${bay}</main></div>
  </div>`;
}

/* ---------- окна ---------- */

const apps = new Set();
function refresh() { for (const a of apps) if (a.rendered) a.render(false); }

/** Пилоты, которых этот пользователь может снаряжать. */
function pilotsOf(user = game.user) {
  return game.actors.filter(a => a.type === "pilot" && (user.isGM || a.isOwner));
}

class HangarApp extends Application {
  constructor(actor = null, options = {}) {
    super(options);
    const list = pilotsOf();
    const own = game.user.character?.type === "pilot" ? game.user.character : null;
    this.actorId = (actor ?? own ?? list[0])?.id ?? null;
    this.planeKey = null;
    this.slots = [];
    this.full = false;   // ведущий: показывать весь каталог, а не только допуск
    this.shown = null;   // машина в боксе на прошлой отрисовке: новая выкатывается с анимацией
  }
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, { id: "tb-hangar", title: "Ангар", classes: ["thunderbolt", "tb-hangar-app"], width: 1000, height: 780, resizable: true });
  }
  get actor() { return game.actors.get(this.actorId) ?? null; }

  /** Выбрать машину: подвеска заново по умолчанию. */
  pick(key, cat) {
    const a = this.actor, st = hangarState();
    this.planeKey = key;
    const p = planeOf(cat, key);
    this.slots = a && p ? defaultLoadout(a, p, cat, game.user.isGM && this.full ? null : st.weapons) : [];
  }

  async _renderInner() {
    const cat = await hangarCatalog();
    const a = this.actor;
    if (a && !this.planeKey) {
      const cur = a.system.plane?.system.key, st = hangarState();
      const first = cur && (game.user.isGM || st.planes.includes(cur)) ? cur : (game.user.isGM ? cur : st.planes.find(k => planeOf(cat, k)));
      if (first) this.pick(first, cat);
    }
    const fresh = this.planeKey !== this.shown;
    this.shown = this.planeKey;
    return $(pilotHtml(cat, { actor: a, pilots: pilotsOf(), planeKey: this.planeKey, slots: this.slots, full: this.full, fresh }));
  }

  render(force, options) { apps.add(this); return super.render(force, options); }
  async close(options) { apps.delete(this); return super.close(options); }

  activateListeners(html) {
    super.activateListeners(html);
    const el = html[0];
    el.querySelector("[data-hg-actor]")?.addEventListener("change", ev => { this.actorId = ev.target.value; this.planeKey = null; this.render(false); });
    el.querySelector("[data-hg-full]")?.addEventListener("change", ev => { this.full = ev.target.checked; this.render(false); });
    el.querySelectorAll("[data-hg-pick]").forEach(n => n.addEventListener("click", async ev => {
      ev.preventDefault();
      this.pick(n.dataset.hgPick, await hangarCatalog());
      this.render(false);
    }));
    el.querySelectorAll("[data-hg-slot]").forEach(n => n.addEventListener("change", () => { this.slots[Number(n.dataset.hgSlot)] = n.value; playLocal("toggle"); this.render(false); }));
    // узел на схеме машины: к его станции на пульте
    el.querySelectorAll("[data-hg-focus]").forEach(n => n.addEventListener("click", ev => {
      ev.preventDefault();
      const sel = el.querySelector(`[data-hg-slot="${n.dataset.hgFocus}"]`);
      sel?.closest(".tb-hg-slot")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      sel?.focus();
    }));
    el.querySelector("[data-hg-apply]")?.addEventListener("click", async ev => {
      ev.preventDefault();
      const b = ev.currentTarget;
      b.disabled = true;
      try {
        if (await applyLoadout(this.actor, this.planeKey, this.slots)) ui.notifications.info(`${this.actor.name}: машина и подвеска на листе.`);
      } catch (err) {
        console.error(`${SYSTEM_ID} | ангар`, err);
        ui.notifications.error(`Ангар: не удалось поставить выбор на лист (${err.message}).`);
      }
      this.render(false);
    });
  }
}

class HangarAdmin extends Application {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, { id: "tb-hangar-admin", title: "Ангар: допуск AWACS", classes: ["thunderbolt", "tb-hangar-app"], width: 860, height: 720, resizable: true });
  }
  async _renderInner() { return $(adminHtml(await hangarCatalog())); }
  render(force, options) { apps.add(this); return super.render(force, options); }
  async close(options) { apps.delete(this); return super.close(options); }

  activateListeners(html) {
    super.activateListeners(html);
    const el = html[0];
    const toggle = (list, key, on) => on ? [...new Set([...list, key])] : list.filter(k => k !== key);
    el.querySelectorAll("[data-hg-plane]").forEach(n => n.addEventListener("change", () => setHangarState({ planes: toggle(hangarState().planes, n.dataset.hgPlane, n.checked) })));
    el.querySelectorAll("[data-hg-weapon]").forEach(n => n.addEventListener("change", () => setHangarState({ weapons: toggle(hangarState().weapons, n.dataset.hgWeapon, n.checked) })));
    el.querySelector("[data-hg-open]")?.addEventListener("change", async ev => {
      const open = ev.target.checked;
      await setHangarState({ open });
      if (open && hangarState().planes.length && await Dialog.confirm({ title: "Ангар открыт", content: "<p>Объявить в чате? У игроков появится кнопка выбора машины.</p>" })) await announceHangar();
    });
    el.querySelectorAll("[data-hg-q]").forEach(n => n.addEventListener("click", async ev => {
      ev.preventDefault();
      const cat = await hangarCatalog(), st = hangarState();
      const next = quickPick(cat, st, n.dataset.hgQ, Number(n.dataset.tier ?? 0));
      await setHangarState({ planes: next.planes, weapons: next.weapons });
    }));
    el.querySelector("[data-hg-announce]")?.addEventListener("click", ev => { ev.preventDefault(); announceHangar(); });
    el.querySelector("[data-hg-pilot]")?.addEventListener("click", ev => { ev.preventDefault(); openHangar(); });
  }
}

/** Ангар пилота (у игрока — свой пилот). */
export function openHangar(actor = null) {
  const app = [...apps].find(a => a instanceof HangarApp);
  if (app) {
    if (actor) { app.actorId = actor.id; app.planeKey = null; }
    return app.render(true);
  }
  return new HangarApp(actor).render(true);
}
/** Допуск AWACS (ведущий). */
export function openHangarAdmin() {
  if (!game.user.isGM) return openHangar();
  return ([...apps].find(a => a instanceof HangarAdmin) ?? new HangarAdmin()).render(true);
}
