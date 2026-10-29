/* Асы в бою (Стрэйнджриал 9.5): штатное спецоружие на листе, «Чутьё аса» (Break! вне хода) и триггеры аса.
   Сами срабатывают «Не уйдёшь» (залп в rolls.mjs), «Удар в спину» и «Я тебя помню» (combat-triggers.mjs), «Последний заход».
   Остальные ведущий жмёт кнопкой: в строке АС на HUD, на листе аса или на карточке-подсказке в чате (видна только ведущим). */
import { SYSTEM_ID, TB } from "./config.mjs";
import { esc, resolveActor } from "./utils.mjs";
import { tokenOf, zoneDistance, canFireAt } from "./scene.mjs";
import { isAce, aceReady, aceUsedPatch, aceTriggersOf, aceSlots, setPlaneStrains, instinctProblem, roundKeyNow, aceMarks } from "./ace-kit.mjs";
import { aceRadio } from "./combat-triggers.mjs";
import { lastRunOf, allowAction, spendAction } from "./actions.mjs";
import { pickTargetToken, selectTarget } from "./pick.mjs";
import { hangarCatalog } from "./hangar.mjs";
import { weaponItem } from "./data/catalog-docs.mjs";
import { freeLock, computeCard } from "./dice/rolls.mjs";

const DEAD = () => CONFIG.specialStatusEffects.DEFEATED;
const alive = a => !!a && !a.statuses?.has(DEAD());
const nameOf = a => a?.type === "pilot" ? a.system.callsign || a.name : a?.token?.name ?? tokenOf(a)?.name ?? a?.name ?? "";
const isLead = () => game.users.activeGM?.isSelf ?? game.user.isGM;
const gmIds = () => game.users.filter(u => u.isGM).map(u => u.id);
/** Подсказка ведущему: шепотом, с кнопками data-tb-ace. */
const gmCard = (title, body, buttons = "") => ChatMessage.create({
  speaker: { alias: "AWACS" }, whisper: gmIds(),
  content: `<div class="tb-card tb-card-ace"><header class="tb-card-head"><span class="tb-card-who">Ас</span><span class="tb-card-what">${esc(title)}</span></header><div class="tb-note">${body}</div>${buttons ? `<div class="tb-actions">${buttons}</div>` : ""}</div>`
});
const btn = (op, data, label, icon = "fa-jet-fighter") =>
  `<button type="button" data-tb-ace="${op}" ${Object.entries(data).map(([k, v]) => `data-${k}="${esc(v)}"`).join(" ")}><i class="fas ${icon}"></i> ${esc(label)}</button>`;

/* ---------- лист аса: спецоружие ---------- */

/** Штатное спецоружие машины (sig) на лист аса, если его там ещё нет. Ведущий. */
export async function addAceWeapons(actor, cat = null) {
  if (!isAce(actor) || !game.user.isGM) return [];
  cat ??= await hangarCatalog();
  const have = new Set(actor.items.filter(i => i.type === "weapon").map(i => i.system.key));
  const add = [...new Set(actor.system.sig ?? [])].filter(k => !have.has(k)).map(k => (cat.weapons ?? []).find(w => w.key === k)).filter(Boolean).map(weaponItem);
  if (add.length) await actor.createEmbeddedDocuments("Item", add);
  return add.map(w => w.system.key);
}

/* ---------- «Чутьё аса» ---------- */

/** Break! аса вне хода: раз в раунд, при рабочем MAWS. Действие и проверку хода не тратит. */
export async function aceInstinct(actor) {
  const why = instinctProblem(actor);
  if (why) return ui.notifications.warn(`${TB.aceInstinct.name}: ${why}.`);
  const msg = await actor.rollBreak({ instinct: true });
  if (msg) await actor.setFlag(SYSTEM_ID, "instinct", roundKeyNow());
  return msg;
}

/** Ракеты, летящие в этого аса в этом раунде (ещё не долетели). */
export function missilesAt(actor) {
  // ракеты в воздухе — из недавних карточек; лист аса перерисовывается часто, весь чат не перебираем
  return game.messages.contents.slice(-300).filter(m => {
    const c = m.getFlag(SYSTEM_ID, "card");
    return c?.delayed && !c.resolved && !c.dmgApplied && c.targetUuid && (c.targetUuid === actor.uuid || resolveActor(c.targetUuid) === actor);
  }).length;
}

/* ---------- триггеры кнопкой ---------- */

async function pickPilot(ace, title) {
  const tok = await pickTargetToken(ace, { title: `${ace.token?.name ?? ace.name}: ${title}`, hint: "Щёлкните по самолёту пилота." });
  if (!tok) return null;
  if (tok.actor?.type !== "pilot") { ui.notifications.warn("Нужен самолёт пилота."); return null; }
  return tok;
}
const mark = (ace, key) => ace.update(aceUsedPatch(ace, key));

/** Ведущий задействует триггер аса с листа или HUD. */
export async function useAceTrigger(ace, key) {
  if (!game.user.isGM) return ui.notifications.warn("Триггеры аса применяет ведущий.");
  const t = TB.aceTriggers[key];
  if (!t) return;
  if (!aceReady(ace, key)) return ui.notifications.warn(`«${t.name}»: ${(ace.system.aceTriggers ?? []).includes(key) ? "в этом вылете уже был" : "у этого аса нет такого триггера"}.`);
  switch (key) {
    case "again": case "back": case "last":
      return ui.notifications.info(`«${t.name}» срабатывает сам: ${t.text}`);
    case "prey": {
      const tok = await pickPilot(ace, t.name);
      if (!tok) return;
      await ace.update({ ...aceUsedPatch(ace, key), [`flags.${SYSTEM_ID}.aceFx.prey`]: { uuid: tok.actor.uuid, name: nameOf(tok.actor) } });
      await aceRadio(ace, `${nameOf(tok.actor)}, ты моя добыча.`);
      return gmCard(t.name, `<b>${esc(nameOf(tok.actor))}</b> — добыча «${esc(nameOf(ace))}»: пока ас держит его на захвате, Lead ему не помогает.${ace.system.lockUuid === tok.actor.uuid ? "" : " Сейчас ас его на захвате не держит."}`);
    }
    case "remember": {
      const tok = await pickPilot(ace, t.name);
      if (!tok) return;
      await ace.update({ ...aceUsedPatch(ace, key), [`flags.${SYSTEM_ID}.aceFx.remember`]: { uuid: tok.actor.uuid, name: nameOf(tok.actor) } });
      await aceRadio(ace, `${nameOf(tok.actor)}. Я тебя помню.`);
      return gmCard(t.name, `До конца вылета атаки «${esc(nameOf(ace))}» по <b>${esc(nameOf(tok.actor))}</b> получают +2.`);
    }
    case "psy": return psyAttack(ace);
    case "bugout": return bugout(ace);
    case "shake": {
      const hunters = (canvas?.tokens?.placeables ?? []).filter(x => x.actor?.type === "pilot" && x.actor.system.lockUuid === ace.uuid);
      const tok = hunters.length === 1 ? hunters[0] : await pickPilot(ace, `${t.name}: кто держит захват`);
      if (!tok) return;
      if (tok.actor.system.lockUuid !== ace.uuid) return ui.notifications.warn(`«${nameOf(tok.actor)}» не держит «${nameOf(ace)}» на захвате.`);
      return shakeLock(ace, tok.actor);
    }
    case "wing": {
      const tok = await pickTargetToken(ace, { title: `${nameOf(ace)}: ${t.name}`, hint: "Щёлкните по цели, в которую попал ведомый." });
      if (tok) return wingLock(ace, tok.actor, tok);
      return;
    }
    case "trap": {
      const tok = await pickPilot(ace, t.name);
      if (tok) return trapOffer(ace, tok, { force: true });
    }
  }
}

/** «Психическая атака»: пилот теряет 2 Strain. Действие аса без броска (у Немезиды свободное). */
async function psyAttack(ace) {
  const t = TB.aceTriggers.psy;
  const free = !!ace.system.nemesis || !game.combat?.started;
  if (!free && !allowAction(ace, "Психическая атака")) return;
  const tok = await pickPilot(ace, t.name);
  if (!tok) return;
  const p = tok.actor, st = p.system.strain?.value ?? 0;
  await p.update({ "system.strain.value": Math.max(0, st - 2) });
  await mark(ace, "psy");
  if (!free) await spendAction(ace, "Психическая атака");
  await aceRadio(ace, `${nameOf(p)}, ты знаешь, чем это кончится.`);
  return gmCard(t.name, `<b>${esc(nameOf(p))}</b> теряет 2 Strain (${st} → ${Math.max(0, st - 2)}).${free ? " Немезиде монолог ничего не стоит." : " Действие аса без броска."}`);
}

/** «Ещё встретимся»: ас с двумя метками уходит из зоны операции, не сбит. */
async function bugout(ace) {
  if ((ace.system.markerCount ?? 0) < 2) return ui.notifications.warn(`«${TB.aceTriggers.bugout.name}»: нужны две метки.`);
  if (!alive(ace)) return ui.notifications.warn("Ас уже сбит.");
  await mark(ace, "bugout");
  const tok = tokenOf(ace);
  await aceRadio(ace, "Ещё встретимся.");
  const c = game.combat?.combatants.find(x => x.actor === ace || x.tokenId === tok?.id);
  if (c) await c.delete();
  if (tok) await tok.document.update({ hidden: true });
  return gmCard(TB.aceTriggers.bugout.name, `<b>${esc(nameOf(ace))}</b> уходит из зоны операции: не сбит, вернётся в другом вылете. Токен скрыт, из боя убран.`);
}

/** «Сорвать захват»: встречная Push, ничья за пилотом; ас выиграл — захват пилота сорван. */
async function shakeLock(ace, pilot) {
  const roll = async a => { const r = await new Roll("1d10").evaluate(); return { r, total: r.total + (a.system.skillTotal?.push ?? 0), d: r.total, sk: a.system.skillTotal?.push ?? 0 }; };
  const a = await roll(ace), p = await roll(pilot);
  const win = a.total > p.total;
  await mark(ace, "shake");
  if (win) await pilot.update({ "system.lock": "", "system.lockUuid": "", [`flags.${SYSTEM_ID}.salvo`]: null, [`flags.${SYSTEM_ID}.phoenix`]: null });
  await aceRadio(ace, win ? "Не так быстро." : "Цепкий, зараза.");
  return ChatMessage.create({ speaker: { alias: "AWACS" }, rolls: [a.r, p.r],
    content: `<div class="tb-card tb-card-ace"><header class="tb-card-head"><span class="tb-card-who">${esc(nameOf(ace))}</span><span class="tb-card-what">${esc(TB.aceTriggers.shake.name)}</span></header>
      <div class="tb-note">Push: ас d10 ${a.d} + ${a.sk} = <b>${a.total}</b> против ${esc(nameOf(pilot))} d10 ${p.d} + ${p.sk} = <b>${p.total}</b> (ничья за пилотом).</div>
      <div class="tb-note">${win ? `<b class="fail">Захват сорван</b> у ${esc(nameOf(pilot))}.` : `<b class="ok">Захват держится.</b>`}</div></div>` });
}

/** «Звено»: бесплатный захват аса на цель, по которой попал ведомый (если цель в досягаемости захвата). */
async function wingLock(ace, target, tok = tokenOf(target)) {
  if (!aceReady(ace, "wing")) return ui.notifications.warn(`«${TB.aceTriggers.wing.name}» в этом вылете уже был.`);
  if (!alive(target)) return ui.notifications.warn(`«${tok?.name ?? target?.name}» уже сбит.`);
  if (!canFireAt(ace, target)) return ui.notifications.warn("Это своя сторона.");
  const d = zoneDistance(tokenOf(ace), tok);
  if (d === null || d > TB.range.lockOn) return ui.notifications.warn(`«${tok?.name}» вне досягаемости захвата (${d ?? "?"} зон).`);
  await freeLock(ace.uuid, { uuid: target.uuid, name: tok?.name ?? target.name });
  await mark(ace, "wing");
  await aceRadio(ace, `Вижу его. ${tok?.name ?? target.name} мой.`);
  return gmCard(TB.aceTriggers.wing.name, `<b>${esc(nameOf(ace))}</b> бесплатно берёт на захват <b>${esc(tok?.name ?? target.name)}</b>.`);
}

/** Зенитные средства стороны аса в зоне пилота: ЗРК (G-A) и зенитки (пушка), не сбитые. */
function trapUnits(ace, pilotTok) {
  return (canvas?.tokens?.placeables ?? []).filter(x => {
    const a = x.actor;
    if (a?.type !== "npc" || a.system.kind !== "ground" || !alive(a) || canFireAt(a, ace) || zoneDistance(x, pilotTok) !== 0) return false;
    return Number.isFinite(a.system.ground?.ga) || Number.isFinite(a.system.ground?.gun);
  });
}

/** «Ловушка»: подсказка ведущему с кнопками зениток в зоне пилота. force — с листа (без проверки «пошёл за асом»). */
async function trapOffer(ace, pilotTok, { force = false } = {}) {
  const units = trapUnits(ace, pilotTok);
  if (!units.length) return force ? ui.notifications.warn(`«${TB.aceTriggers.trap.name}»: в зоне «${pilotTok.name}» нет ЗРК или зениток стороны аса.`) : null;
  return gmCard(TB.aceTriggers.trap.name, `<b>${esc(pilotTok.name)}</b> пошёл за «${esc(nameOf(ace))}»: зенитка стороны аса в этой зоне может сразу ударить по нему, без захвата и вне своего хода.`,
    units.map(u => btn("trap", { ace: ace.uuid, unit: u.document.uuid, pilot: pilotTok.document.uuid }, `${u.name}: ${Number.isFinite(u.actor.system.ground?.ga) ? "пуск ЗРК" : "огонь"}`, "fa-crosshairs")).join(" "));
}

async function trapFire(ace, unitTok, pilotTok) {
  if (!aceReady(ace, "trap")) return ui.notifications.warn(`«${TB.aceTriggers.trap.name}» в этом вылете уже был.`);
  const u = unitTok.actor;
  await mark(ace, "trap");
  await aceRadio(ace, "Добро пожаловать в мою зону.");
  if (Number.isFinite(u.system.ground?.ga)) return u.fireSam(undefined, { target: pilotTok, free: true, tag: TB.aceTriggers.trap.name });
  selectTarget(pilotTok);
  return u.fireGuns();
}

/* ---------- «Последний заход» ---------- */

async function startLastRun(ace) {
  await ace.update({ ...aceUsedPatch(ace, "last"), [`flags.${SYSTEM_ID}.lastRun`]: { combat: game.combat?.id ?? "", used: 0, rolls: 0, list: [] } });
  await aceRadio(ace, "Ещё один заход. Последний.");
  return gmCard(TB.aceTriggers.last.name, `<b>${esc(nameOf(ace))}</b> получил Doom и перед катапультированием сразу делает ещё один ход: до трёх действий, одно с броском. Действия с листа или HUD считаются в этот заход.`,
    btn("lastEnd", { ace: ace.uuid }, "Заход окончен", "fa-parachute-box"));
}

async function endLastRun(ace, why = "") {
  if (!ace?.getFlag(SYSTEM_ID, "lastRun")) return;
  await ace.unsetFlag(SYSTEM_ID, "lastRun");
  return gmCard(TB.aceTriggers.last.name, `<b>${esc(nameOf(ace))}</b>: последний заход окончен${why ? ` (${esc(why)})` : ""}, катапультирование.`);
}

/* ---------- строка АС в HUD ведущего и лист ---------- */

/** Данные для HUD и листа: чутьё и триггеры. */
export function aceState(actor) {
  if (!isAce(actor)) return null;
  const why = instinctProblem(actor);
  return { instinct: { ready: !why, why, incoming: missilesAt(actor) }, triggers: aceTriggersOf(actor), slots: aceSlots(actor), lastRun: lastRunOf(actor), marks: aceMarks(actor) };
}

/** Разметка строки АС для HUD (только ведущему). */
export function aceRowHtml(actor) {
  if (!game.user?.isGM) return "";
  const s = aceState(actor);
  if (!s) return "";
  const inst = `<button type="button" class="tb-hud-move ${s.instinct.ready && s.instinct.incoming ? "ready" : "wait"} ${s.instinct.ready ? "" : "used"}" data-hud-ace="instinct" title="${esc(TB.aceInstinct.text)}${s.instinct.why ? `\nСейчас: ${esc(s.instinct.why)}` : s.instinct.incoming ? `\nВ аса летит ракет: ${s.instinct.incoming}` : "\nСейчас в аса ракеты не летят"}">ЧУТЬЁ${s.instinct.incoming ? ` · ${s.instinct.incoming}` : ""}</button>`;
  const trig = s.triggers.map(t => `<button type="button" class="tb-hud-move ${t.used ? "used" : t.how === "auto" ? "wait" : "ready"}" data-hud-ace="${t.key}" title="${esc(t.name)} (раз за вылет${t.how === "auto" ? ", сам" : ""}): ${esc(t.text)}${t.used ? "\nУже был в этом вылете" : ""}">${esc(t.name)}</button>`).join("");
  const run = s.lastRun ? `<span class="tb-hud-plamp on" title="Последний заход: сделано ${s.lastRun.used} из 3">ЗАХОД ${s.lastRun.used}/3</span>` : "";
  return `<div class="tb-hud-btns tb-hud-plane tb-hud-ace"><small title="Ас: Чутьё и личные триггеры (Стрэйнджриал 9.5)">АС</small>${inst}${run}${trig}</div>`;
}

/** Нажатие в строке АС или на листе аса. */
export function aceClick(actor, what) {
  return what === "instinct" ? aceInstinct(actor) : useAceTrigger(actor, what);
}

/* ---------- хуки ---------- */

export function registerAcePlay() {
  // Strain машин пилотов из каталога: ас на такой же машине берёт его
  Hooks.once("ready", () => {
    hangarCatalog().then(cat => {
      setPlaneStrains(cat.planes);
      for (const a of game.actors) if (isAce(a)) { a.prepareData(); if (a.sheet?.rendered) a.sheet.render(false); }
    }).catch(err => console.warn(`${SYSTEM_ID} | Strain машин для асов`, err));
  });
  // стал асом (уровень на листе или создан из каталога асом): штатное спецоружие машины
  Hooks.on("updateActor", (actor, change, options, userId) => {
    if (options?.tbUndo || userId !== game.user.id) return;
    if (foundry.utils.getProperty(change, "system.tier") === "ace") addAceWeapons(actor).catch(err => console.warn(`${SYSTEM_ID} | спецоружие аса`, err));
  });
  Hooks.on("createActor", (actor, options, userId) => {
    if (!options?.tbUndo && userId === game.user.id && isAce(actor)) addAceWeapons(actor).catch(err => console.warn(`${SYSTEM_ID} | спецоружие аса`, err));
  });
  // Doom: «Последний заход»; три действия захода сделаны — конец
  Hooks.on("updateActor", (actor, change, options) => {
    if (options?.tbUndo || !isLead() || !isAce(actor)) return;
    if (foundry.utils.getProperty(change, "system.markers.doom") === true && aceReady(actor, "last") && game.combat?.started) startLastRun(actor).catch(err => console.error(err));
    const lr = foundry.utils.getProperty(change, `flags.${SYSTEM_ID}.lastRun`);
    if (lr?.used >= 3) endLastRun(actor, "три действия сделаны").catch(err => console.error(err));
  });
  // конец раунда: «Ещё встретимся» для аса с двумя метками
  Hooks.on("updateCombat", (combat, change, options) => {
    if (options?.tbUndo || !isLead() || !("round" in change) || !combat.started) return;
    for (const c of combat.combatants) {
      const a = c.actor;
      if (a?.getFlag(SYSTEM_ID, "lastRun")) endLastRun(a, "раунд кончился").catch(() => null);
      if (!aceReady(a, "bugout") || !alive(a) || (a.system.markerCount ?? 0) !== 2) continue;
      gmCard(TB.aceTriggers.bugout.name, `<b>${esc(nameOf(a))}</b> с двумя метками может уйти из зоны операции (не сбит, вернётся в другом вылете).`,
        btn("bugout", { ace: a.uuid }, `${nameOf(a)}: уйти`, "fa-plane-departure"));
    }
  });
  // подсказки ведущему по карточкам: захват пилота на аса («Сорвать захват»), попадание ведомого («Звено»)
  Hooks.on("createChatMessage", (message, options) => {
    if (options?.tbUndo || !isLead()) return;
    const rwr = message.getFlag(SYSTEM_ID, "rwr");
    if (rwr?.target && rwr.fromUuid) {
      const ace = resolveActor(rwr.target), pilot = resolveActor(rwr.fromUuid);
      if (pilot?.type === "pilot" && aceReady(ace, "shake") && alive(ace))
        gmCard(TB.aceTriggers.shake.name, `<b>${esc(nameOf(pilot))}</b> взял «${esc(nameOf(ace))}» на захват.`, btn("shake", { ace: ace.uuid, pilot: pilot.uuid }, "Push против Push", "fa-dice-d10"));
    }
    const card = message.getFlag(SYSTEM_ID, "card");
    if (card) wingOffers(card);
  });
  // пилот вошёл в зону аса: «Ловушка»
  const offered = new Set();
  Hooks.on("updateToken", (doc, change, options) => {
    if (options?.tbUndo || !isLead() || !("x" in change || "y" in change) || doc.actor?.type !== "pilot" || !game.combat?.started) return;
    const pt = doc.object;
    if (!pt) return;
    for (const t of canvas.tokens.placeables) {
      const ace = t.actor;
      if (!aceReady(ace, "trap") || !alive(ace) || !canFireAt(ace, doc.actor) || zoneDistance(t, pt) !== 0) continue;
      const k = `${ace.uuid}:${doc.id}:${roundKeyNow()}`;
      if (offered.has(k) || !trapUnits(ace, pt).length) continue;
      offered.add(k);
      trapOffer(ace, pt).catch(err => console.error(err));
    }
  });
  // кнопки подсказок и «Чутьё аса» на карточках ракет в аса
  Hooks.on("renderChatMessage", (message, html) => {
    const root = html?.[0] ?? html;
    if (!root?.querySelectorAll) return;
    if (game.user.isGM) instinctButton(message, root);
    root.querySelectorAll("[data-tb-ace]").forEach(b => b.addEventListener("click", ev => { ev.preventDefault(); cardAction(b.dataset).catch(err => { console.error(err); ui.notifications.error(err.message); }); }));
  });
}

/** На карточке ракеты, летящей в аса: кнопка «Чутьё аса» (ведущему, раз в раунд). */
function instinctButton(message, root) {
  const c = message.getFlag(SYSTEM_ID, "card");
  if (!c?.delayed || c.resolved || c.dmgApplied || !c.targetUuid) return;
  const ace = resolveActor(c.targetUuid);
  if (!isAce(ace) || instinctProblem(ace)) return;
  const box = root.querySelector(".tb-card");
  if (!box || box.querySelector("[data-tb-ace=instinct]")) return;
  const wrap = document.createElement("div");
  wrap.className = "tb-actions";
  wrap.innerHTML = btn("instinct", { ace: ace.uuid }, `${TB.aceInstinct.name}: Break! вне хода`, "fa-person-falling");
  box.append(wrap);
}

/** «Звено»: попадание ведомого (ас или дуэлянт той же эскадрильи) — подсказка ведущему про захват аса. */
function wingOffers(card) {
  const hits = [];
  if (card.type === "volley") for (const r of card.targets ?? []) { if (r.hit) for (const u of r.shooterUuids ?? []) hits.push({ shooter: u, target: r.uuid, name: r.name }); }
  else if (card.attack && !card.delayed && card.targetUuid && computeCard(card).success) hits.push({ shooter: card.actorUuid, target: card.targetUuid, name: card.targetName });
  for (const h of hits) {
    const sh = resolveActor(h.shooter), squad = sh?.type === "npc" ? sh.system.squad : "";
    if (!squad) continue;
    for (const t of canvas?.tokens?.placeables ?? []) {
      const ace = t.actor;
      if (!ace || ace === sh || ace.system?.squad !== squad || !aceReady(ace, "wing") || !alive(ace)) continue;
      gmCard(TB.aceTriggers.wing.name, `Ведомый «${esc(nameOf(sh))}» попал по <b>${esc(h.name)}</b>: «${esc(nameOf(ace))}» может бесплатно взять эту цель на захват.`,
        btn("wing", { ace: ace.uuid, target: h.target }, `${nameOf(ace)}: захват`, "fa-crosshairs"));
    }
  }
}

async function cardAction(d) {
  if (!game.user.isGM) return ui.notifications.warn("Это кнопка ведущего.");
  const ace = resolveActor(d.ace);
  if (!ace) return ui.notifications.warn("Аса нет на сцене.");
  switch (d.tbAce) {
    case "instinct": return aceInstinct(ace);
    case "bugout": return aceReady(ace, "bugout") ? bugout(ace) : ui.notifications.warn("Уже было.");
    case "shake": { const p = resolveActor(d.pilot); if (!aceReady(ace, "shake")) return ui.notifications.warn("Уже было."); return p?.system.lockUuid === ace.uuid ? shakeLock(ace, p) : ui.notifications.warn("Захвата на аса уже нет."); }
    case "wing": { const t = resolveActor(d.target); return t ? wingLock(ace, t) : ui.notifications.warn("Цели нет на сцене."); }
    case "trap": {
      const u = fromUuidSync(d.unit)?.object, p = fromUuidSync(d.pilot)?.object;
      return u && p ? trapFire(ace, u, p) : ui.notifications.warn("Зенитки или пилота уже нет на сцене.");
    }
    case "lastEnd": return endLastRun(ace, "ведущий");
  }
}
