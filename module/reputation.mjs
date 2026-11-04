/* Репутация пилота и расстрел куполов (Стрэйнджриал 10, хоумрул 18).
   Шкала у каждого пилота своя, от −10 до +10, пять уровней: Чудовище, Каратель, Солдат, Рыцарь неба, Белый рыцарь.
   Меняется на разборе: «Итоги вылета» сами предлагают сдвиги этого вылета (выстрел по куполу, сбитый гражданский, огонь по своим,
   добитый отступивший, отпущенный враг), ведущий подтверждает галочками. Нарушение кодекса Белого рыцаря — сразу −4 и +1 Нервы.
   Эффекты уровня в бою: прибавки и штрафы к атакам, кто стреляет по куполу, «Слово чести», «Сдаюсь!», «Ложная сдача», ужас
   у конскриптов, «кровная месть» стрелявшему по куполу. Здесь же цвет HUD, следа и надписей по уровню своего пилота. */
import { SYSTEM_ID } from "./config.mjs";
import { esc, resolveActor } from "./utils.mjs";
import { tokenOf, zoneDistance } from "./scene.mjs";

const CHANNEL = `system.${SYSTEM_ID}`;
export const REP_MIN = -10, REP_MAX = 10;
const clamp = (v, lo = REP_MIN, hi = REP_MAX) => Math.max(lo, Math.min(hi, Math.round(Number(v) || 0)));

/** Уровни снизу вверх. rank: 0 Чудовище … 4 Белый рыцарь. bonus и minus — что даёт и чем платит (складываются к краям). */
export const REP_LEVELS = [
  { key: "monster", rank: 0, name: "Чудовище", min: -10, max: -8, mean: "о нём пишут в листовках обе стороны",
    bonus: [["Ужас.", "Вражеские Conscripts в его зоне −2 ко всем атакам (вместо −1). В начале раунда Conscript у него на захвате бросает d10: на 1–3 выходит из боя."]],
    minus: [["Охота.", "В каждом вылете за ним приходит ас или эскадрилья дуэлянтов; атаки вражеских асов и дуэлянтов по нему +2."],
      ["Пленных не берут.", "Катапультировался и d4 = 2–3 («пропал без вести или в плену»): вместо этого погиб. По его куполу стреляют все, включая зенитки."],
      ["Никто не летит с ним.", "Союзные NPC не слушают его приказов: Leadership и команды ведомым не работают. «Особый отдел присматривается» +2 за операцию (вместо +1)."],
      ["Кошмары.", "Нервы не опускаются ниже 2. Наёмник вместо этого получает +1 деление «Дурной славы» за каждый вылет."]] },
  { key: "punisher", rank: 1, name: "Каратель", min: -7, max: -4, mean: "его боятся и ненавидят",
    bonus: [["Страх.", "Вражеские Conscripts в его зоне −1 ко всем атакам."]],
    minus: [["Ненависть.", "Враги в его зоне не сдаются и не отступают: там не работают «Строй дрогнул» и «Имя на крыле» Славы и «Без границ» Анархиста. Любой вражеский самолёт может стрелять по его куполу."],
      ["Свои отворачиваются.", "«За ними!» Славы на него не работает; в каждой операции, где он летает, +1 на шкалу «Особый отдел присматривается»."]] },
  { key: "soldier", rank: 2, name: "Солдат", min: -3, max: 3, mean: "всё по книге", bonus: [], minus: [] },
  { key: "knight", rank: 3, name: "Рыцарь неба", min: 4, max: 7, mean: "о нём знают и ищут поединка",
    bonus: [["Пощада врагу.", "Сбитые им вражеские пилоты охотнее прыгают: шанс катапультироваться +2 из 10. Вражеские асы и дуэлянты не стреляют по его куполу (кроме Немезиды)."],
      ["Слово чести.", "Раз за вылет по открытому каналу Lead против 7: вражеский Conscript в его зоне выходит из боя. Анархисту +1."]],
    minus: [["Достойный противник.", "Вражеские асы в его зоне выбирают целью его первым."]] },
  { key: "white", rank: 4, name: "Белый рыцарь", min: 8, max: 10, mean: "живая легенда о чести",
    bonus: [["«Сдаюсь!»", "Атака, которая ставит дуэлянту первую метку (Structure): дуэлянт сдаётся, выпускает шасси и уходит. Для задач и Славы он сбит."],
      ["Слово чести дуэлянту.", "Работает и на дуэлянтов: Lead против 9."]],
    minus: [["Кодекс без исключений.", "Не стреляет по куполам, отступающим, врагу с Doom и вслепую по контактам «?». Нарушил: Репутация сразу −4, +1 Нервы, до конца вылета никаких бонусов уровня."],
      ["Ложная сдача.", "Раз за вылет AWACS объявляет, что враг в его зоне сдаётся: до конца следующего раунда его не атаковать. Сдача ложная — враг затем атакует его с +2."],
      ["Мишень пропаганды.", "В каждой операции хотя бы один ас приходит именно за ним; атаки асов по нему +1."]] }
];
const BY_KEY = Object.fromEntries(REP_LEVELS.map(l => [l.key, l]));

/** Уровень по очкам. */
export function repLevel(points) {
  const p = clamp(points);
  return REP_LEVELS.find(l => p >= l.min && p <= l.max) ?? BY_KEY.soldier;
}
/** Эффекты уровня с накоплением к краю: у Белого рыцаря и всё Рыцаря неба, у Чудовища всё Карателя. */
export function repEffects(key) {
  const l = BY_KEY[key] ?? BY_KEY.soldier;
  const chain = l.rank > 2 ? REP_LEVELS.filter(x => x.rank > 2 && x.rank <= l.rank) : l.rank < 2 ? REP_LEVELS.filter(x => x.rank < 2 && x.rank >= l.rank).reverse() : [];
  return { bonus: chain.flatMap(x => x.bonus.map(([t, s]) => ({ level: x.name, title: t, text: s }))), minus: chain.flatMap(x => x.minus.map(([t, s]) => ({ level: x.name, title: t, text: s }))) };
}

export const repPoints = actor => clamp(actor?.system?.reputation?.points);
/** Репутация пилота: { points, key, rank, name, … } или null у не-пилота. */
export function repOf(actor) {
  if (actor?.type !== "pilot") return null;
  const points = repPoints(actor);
  return { points, ...repLevel(points) };
}
const rankOf = a => repOf(a)?.rank ?? 2;

/* ---------- вылет: флаги до конца боя ---------- */

const combatId = () => globalThis.game?.combat?.started ? game.combat.id : "";
const thisSortie = f => !!f && !!combatId() && (f === combatId() || f.combat === combatId());
/** Кодекс Белого рыцаря нарушен в этом вылете: бонусов уровня нет до конца вылета. */
export const codeBroken = a => thisSortie(a?.getFlag?.(SYSTEM_ID, "repBroken"));
/** Ранг для бонусов: после нарушения кодекса как у Солдата. Штрафы считаются по настоящему уровню. */
const bonusRank = a => (codeBroken(a) ? 2 : rankOf(a));
/** «Кровная месть»: пилот стрелял по куполу в этом вылете. */
export const hasFeud = a => thisSortie(a?.getFlag?.(SYSTEM_ID, "feud"));

const isLead = () => !!game.user?.isGM && (game.users?.activeGM?.isSelf ?? true);
const callsignOf = a => a?.system?.callsign || a?.token?.name || a?.name || "";
const tierOf = a => (a?.type === "npc" ? a.system?.tier ?? "conscript" : "");
const enemies = (a, b) => { const t = x => (x?.type === "pilot" ? "ally" : x?.system?.side === "player" ? "ally" : x?.system?.side ?? "enemy"); return t(a) !== t(b) && t(a) !== "neutral" && t(b) !== "neutral"; };

/* ---------- сдвиги: журнал вылета и разбор ---------- */

/** За что и сколько (раздел 2). */
export const REP_SHIFTS = {
  chute: { delta: -2, why: "выстрел по вражескому куполу" },
  civil: { delta: -2, why: "сбит гражданский борт или удар по мирным" },
  friendly: { delta: -1, why: "огонь по своим" },
  retreat: { delta: -1, why: "добит враг, отступивший из боя" },
  mercy: { delta: 1, why: "отпустил врага" },
  saved: { delta: 1, why: "сорвал удар по мирным или спас гражданских" },
  shield: { delta: 1, why: "заслонил мирных: принял атаку на себя" },
  rescue: { delta: 1, why: "передал спасателям координаты вражеского купола" },
  refuse: { delta: 2, why: "отказался выполнить приказ, который бьёт по мирным, пленным или сбитым" }
};
export const UP_CAP = 2;

/** Записать событие вылета для подсказки на разборе. Владелец пишет сам, иначе через ведущего. once — не повторять (ключ). */
export async function noteRep(pilot, kind, { why = "", once = "" } = {}) {
  if (pilot?.type !== "pilot" || !REP_SHIFTS[kind]) return;
  if (!pilot.isOwner) return game.socket?.emit(CHANNEL, { type: "rep", op: "note", uuid: pilot.uuid, kind, why, once });
  const list = foundry.utils.deepClone(pilot.getFlag(SYSTEM_ID, "repEvents") ?? []);
  if (once && list.some(e => e.once === once)) return;
  list.push({ kind, delta: REP_SHIFTS[kind].delta, why: why || REP_SHIFTS[kind].why, combat: combatId(), once });
  return pilot.setFlag(SYSTEM_ID, "repEvents", list);
}

/**
 * Подсказки на разборе: события вылета, сдвиги вверх не больше UP_CAP. events — [{ kind, delta, why }].
 * Возвращает [{ i, kind, delta, why, on }] — on: галочка по умолчанию (вверх сверх лимита — без галочки).
 */
export function repSuggest(events = []) {
  let up = 0;
  return events.map((e, i) => {
    const d = Number(e.delta) || 0;
    const on = d < 0 || up + d <= UP_CAP;
    if (d > 0 && on) up += d;
    return { i, kind: e.kind, delta: d, why: e.why, on };
  });
}
/** Итог выбранных сдвигов с лимитом вверх. */
export function repTotal(list) {
  const down = list.filter(x => x.delta < 0).reduce((s, x) => s + x.delta, 0);
  const up = Math.min(UP_CAP, list.filter(x => x.delta > 0).reduce((s, x) => s + x.delta, 0));
  return down + up;
}

/** Сдвинуть шкалу сейчас и записать в журнал. date — игровая дата. */
export async function shiftRep(pilot, delta, why, date = "") {
  if (pilot?.type !== "pilot" || !delta) return null;
  if (!pilot.isOwner) return game.socket?.emit(CHANNEL, { type: "rep", op: "shift", uuid: pilot.uuid, delta, why, date });
  const r = pilot.system.reputation ?? { points: 0, log: [] };
  const before = repLevel(r.points), points = clamp(r.points + delta), after = repLevel(points);
  const { campaignDate } = await import("./campaign-date.mjs");
  const log = [...(r.log ?? []), { date: date || campaignDate(), delta, why: String(why ?? "") }];
  await pilot.update({ "system.reputation.points": points, "system.reputation.log": log });
  return { before, after, points };
}

/* ---------- эффекты в бою ---------- */

/** Шанс катапультироваться NPC: +2, если его сбил Рыцарь неба или Белый рыцарь. */
export function ejectBonus(victim) {
  const by = victim?.getFlag?.(SYSTEM_ID, "down")?.byUuid;
  const killer = by ? resolveActor(by) : null;
  return killer && bonusRank(killer) >= 3 ? 2 : 0;
}

/**
 * Может ли NPC стрелять по куполу. f — флаг купола (side, uuid, pilot).
 * Обычно — ас или дуэлянт. Купол Рыцаря аса и дуэлянта не подпускает (кроме Немезиды); у Карателя и «кровной мести» — любой
 * вражеский самолёт; у Чудовища ещё ПВО на земле.
 */
export function chuteShooterOk(shooter, f) {
  const s = shooter?.system;
  if (shooter?.type !== "npc" || shooter.hasPlayerOwner) return false;
  if (shooter.getFlag?.(SYSTEM_ID, "down") || shooter.statuses?.has?.(CONFIG.specialStatusEffects.DEFEATED)) return false;
  const victim = f?.pilot && f.uuid ? resolveActor(f.uuid) : null;
  const rank = victim ? rankOf(victim) : 2, feud = victim ? hasFeud(victim) : false;
  const air = s?.kind === "air";
  if (rank === 0 && (air || (s?.kind === "ground" && s?.grp === "ad"))) return true;
  if (!air) return false;
  if (rank === 1 || feud) return true;
  if (!["ace", "duelist"].includes(s.tier)) return false;
  if (victim && bonusRank(victim) >= 3 && !s.nemesis) return false;
  return true;
}

const zone = (a, b) => { try { return zoneDistance(tokenOf(a), tokenOf(b)); } catch { return null; } };
const pilots = () => (globalThis.game?.actors ?? []).filter(a => a.type === "pilot");

/** Пилоты Карателя и Чудовища в зоне аттакующего конскрипта: −1 или −2 к атаке (сильнейший). */
export function fearOf(attacker, zoneFn = zone, list = pilots()) {
  if (tierOf(attacker) !== "conscript" || attacker.system?.kind === "ship") return null;
  let best = null;
  for (const p of list) {
    const r = bonusRank(p);
    if (r > 1 || !enemies(attacker, p)) continue;
    if (zoneFn(attacker, p) !== 0) continue;
    const v = r === 0 ? -2 : -1;
    if (!best || v < best.value) best = { value: v, label: `${r === 0 ? "Ужас" : "Страх"}: ${callsignOf(p)} рядом` };
  }
  return best;
}

/**
 * Что Репутация меняет в атаке: { parts, problems, notes, later }.
 * NPC по пилоту: кровная месть, «Мишень пропаганды», «Охота», «Ложная сдача». Конскрипт рядом с Карателем или Чудовищем: −1/−2.
 * Белый рыцарь: нарушение кодекса — предупреждение (ведущий или игрок решает) и после выстрела −4.
 */
export function repAttack(attacker, target, { zoneFn = zone, list = pilots() } = {}) {
  const out = { parts: [], problems: [], notes: [], later: [] };
  const ta = target?.actor ?? target;
  if (!attacker) return out;
  if (attacker.type === "npc" && ta?.type === "pilot" && enemies(attacker, ta)) {
    const tier = tierOf(attacker), rank = rankOf(ta);
    if (hasFeud(ta) && ["ace", "duelist"].includes(tier)) out.parts.push(["Кровная месть", 1]);
    if (rank === 4 && tier === "ace") out.parts.push(["Мишень пропаганды", 1]);
    if (rank === 0 && ["ace", "duelist"].includes(tier)) out.parts.push(["Охота", 2]);
    const fs = attacker.getFlag?.(SYSTEM_ID, "falseSurrender");
    if (fs && thisSortie(fs) && fs.by === ta.uuid && (game.combat?.round ?? 0) > Number(fs.round) + 1) out.parts.push(["Ложная сдача", 2]);
  }
  if (attacker.type === "npc") { const f = fearOf(attacker, zoneFn, list); if (f) out.parts.push([f.label, f.value]); }
  if (attacker.type === "pilot" && ta && rankOf(attacker) === 4 && !codeBroken(attacker)) {
    const why = codeIssue(attacker, ta);
    if (why) {
      out.problems.push(`Кодекс без исключений: ${why}. Выстрел нарушит кодекс: Репутация сразу −4, +1 Нервы, до конца вылета без бонусов уровня.`);
      out.later.push(() => breakCode(attacker, why));
    }
  }
  return out;
}

/** Почему атака по цели нарушает кодекс Белого рыцаря, или "". */
export function codeIssue(pilot, ta) {
  if (!ta || !enemies(pilot, ta) && !civil(ta)) return "";
  if (civil(ta)) return "это гражданские";
  if (ta.statuses?.has?.("retreat")) return "цель отступает из боя";
  if (ta.system?.markers?.doom) return "у цели Doom";
  const tok = ta.isToken ? ta.token : ta.getActiveTokens?.(false, true)?.[0];
  if (tok?.getFlag?.(SYSTEM_ID, "unknown")) return "это неопознанный контакт «?»";
  const fs = ta.getFlag?.(SYSTEM_ID, "falseSurrender");
  if (fs && thisSortie(fs) && fs.by === pilot.uuid && (game.combat?.round ?? 0) <= Number(fs.round) + 1) return "противник объявил о сдаче";
  return "";
}
const civil = a => a?.type === "npc" && (a.system?.grp === "civil" || (a.system?.rules ?? []).some(r => (r?.key ?? r) === "civilian") || (a.system?.props ?? []).some(r => (r?.key ?? r) === "civilian"));

/** Нарушение кодекса Белого рыцаря: −4 сразу, +1 Нервы, бонусы уровня гаснут до конца вылета. */
export async function breakCode(pilot, why) {
  if (!pilot) return;
  if (!pilot.isOwner) return game.socket?.emit(CHANNEL, { type: "rep", op: "code", uuid: pilot.uuid, why });
  if (codeBroken(pilot)) return;
  await pilot.setFlag(SYSTEM_ID, "repBroken", { combat: combatId() });
  await shiftRep(pilot, -4, `нарушен кодекс Белого рыцаря: ${why}`);
  const { DT } = await import("./config.mjs");
  await pilot.update({ "system.nerves": Math.min(DT.maxNerves ?? 5, (pilot.system.nerves ?? 0) + 1) });
  await ChatMessage.create({ speaker: { alias: "AWACS" }, whisper: game.users.filter(u => u.isGM || pilot.testUserPermission(u, "OWNER")).map(u => u.id),
    content: `<div class="tb-card tb-card-damage"><header class="tb-card-head"><span class="tb-card-who">${esc(callsignOf(pilot))}</span><span class="tb-card-what">Кодекс нарушен</span></header>
      <div class="tb-note">${esc(why)}. Репутация −4 (теперь ${repPoints(pilot)}), Нервы +1. До конца вылета бонусов уровня нет.</div></div>` });
}

/** Порядок целей автопилота: кровная месть и «Достойный противник» — первыми. Больше — раньше. */
export function targetPull(attacker, target, zoneFn = zone) {
  const ta = target?.actor ?? target;
  if (attacker?.type !== "npc" || ta?.type !== "pilot" || !enemies(attacker, ta)) return 0;
  let n = 0;
  if (hasFeud(ta)) n += 2;
  if (tierOf(attacker) === "ace" && rankOf(ta) >= 3 && zoneFn(attacker, ta) === 0) n += 1;
  return n;
}

/** Слово чести: кому можно (конскрипт; у Белого рыцаря и дуэлянт), сложность. null — нельзя. */
export function honorWordOf(pilot, ta) {
  const r = bonusRank(pilot);
  if (r < 3 || ta?.type !== "npc" || !enemies(pilot, ta)) return null;
  const tier = tierOf(ta);
  if (tier === "conscript") return { dc: 7 };
  if (tier === "duelist" && r === 4) return { dc: 9 };
  return null;
}
export const honorUsed = pilot => thisSortie(pilot?.getFlag?.(SYSTEM_ID, "honorWord"));
const anarchist = a => a?.system?.archetype === "borderless" || a?.items?.some?.(i => i.type === "trigger" && i.system?.key === "noborders");
/** Ненависть Карателя: враг в зоне Карателя или Чудовища не сдаётся. */
export function hatedZone(ta, zoneFn = zone, list = pilots()) {
  return list.find(p => rankOf(p) <= 1 && enemies(p, ta) && zoneFn(p, ta) === 0) ?? null;
}

/** Кнопка HUD «Слово чести»: выбрать врага в своей зоне, Lead против 7 (дуэлянт у Белого рыцаря — 9). */
export async function honorWord(pilot) {
  if (!pilot?.isOwner || bonusRank(pilot) < 3) return;
  if (honorUsed(pilot)) return ui.notifications.warn("Слово чести уже звучало в этом вылете.");
  if (pilot.system.skillBlocked?.lead) return ui.notifications.warn("Lead недоступен: метка Grit.");
  const me = tokenOf(pilot);
  const list = (canvas?.tokens?.placeables ?? []).filter(t => t.actor && !t.document.hidden && honorWordOf(pilot, t.actor) && zoneDistance(me, t) === 0
    && !t.actor.statuses?.has?.(CONFIG.specialStatusEffects.DEFEATED) && !t.actor.statuses?.has?.("retreat"));
  if (!list.length) return ui.notifications.warn(bonusRank(pilot) === 4 ? "В вашей зоне нет вражеского конскрипта или дуэлянта." : "В вашей зоне нет вражеского конскрипта.");
  const R = await import("./dice/rolls.mjs");
  let tok = list[0];
  if (list.length > 1) {
    const d = await R.formDialog("Слово чести", `<div class="form-group"><label>Кому</label><select name="i">${list.map((t, i) => `<option value="${i}">${esc(t.name)}</option>`).join("")}</select></div>`, { ok: "В эфир" });
    if (!d) return;
    tok = list[Number(d.i)] ?? list[0];
  }
  const hate = hatedZone(tok.actor);
  if (hate) return ui.notifications.warn(`«${tok.name}» рядом с ${callsignOf(hate)}: там не сдаются.`);
  const { dc } = honorWordOf(pilot, tok.actor);
  const msg = await R.rollSideCheck(pilot, "lead", { dc, label: `Слово чести: Lead против ${dc}`, turnRoll: true,
    notes: [`По открытому каналу. Успех: «${tok.name}» выходит из боя.`], onWin: { uuid: tok.actor.uuid, name: tok.name } });
  if (!msg) return;
  if (anarchist(pilot)) {
    // Анархисту +1: дописать в карточку
    const card = foundry.utils.deepClone(msg.getFlag(SYSTEM_ID, "card"));
    card.parts = [...card.parts, ["Анархист", 1]];
    await msg.update({ content: R.renderCard(card), [`flags.${SYSTEM_ID}.card`]: card });
  }
  await pilot.setFlag(SYSTEM_ID, "honorWord", { combat: combatId() });
  return msg;
}

/** «Ложная сдача» (кнопка ведущего в меню вражеского токена): враг объявляет о сдаче Белому рыцарю в своей зоне. */
export async function falseSurrender(token) {
  if (!game.user.isGM) return;
  const ta = token?.actor;
  const wk = pilots().find(p => rankOf(p) === 4 && enemies(p, ta) && zoneDistance(tokenOf(p), token) === 0 && !thisSortie(p.getFlag(SYSTEM_ID, "falseSurrenderAt")));
  if (!wk) return ui.notifications.warn("Рядом с этой машиной нет Белого рыцаря, для которого «Ложная сдача» ещё не звучала в этом вылете.");
  const round = game.combat?.round ?? 0;
  await ta.setFlag(SYSTEM_ID, "falseSurrender", { combat: combatId(), round, by: wk.uuid, name: callsignOf(wk) });
  await wk.setFlag(SYSTEM_ID, "falseSurrenderAt", { combat: combatId() });
  const { sendRadio } = await import("./radio.mjs");
  await sendRadio({ text: `${callsignOf(wk)}, «${token.name}» выпускает шасси, сдаётся. Не атаковать до конца следующего раунда.` });
  await ChatMessage.create({ speaker: { alias: "AWACS" }, whisper: game.users.filter(u => u.isGM).map(u => u.id),
    content: `<div class="tb-card"><div class="tb-note">«Ложная сдача»: атака ${esc(callsignOf(wk))} по «${esc(token.name)}» до конца раунда ${round + 1} нарушит кодекс. После этого «${esc(token.name)}» атакует его с +2.</div></div>` });
}

/** Чудовище: в начале раунда Conscript у него на захвате бросает d10, на 1–3 выходит из боя. Только главный ведущий. */
async function terror(combat) {
  if (!isLead() || !combat?.started) return;
  for (const p of pilots()) {
    if (bonusRank(p) !== 0 || !p.system.lockUuid) continue;
    const ta = resolveActor(p.system.lockUuid);
    if (tierOf(ta) !== "conscript" || !enemies(p, ta) || ta.statuses?.has?.("retreat") || ta.getFlag?.(SYSTEM_ID, "down")) continue;
    const r = await new Roll("1d10").evaluate();
    const out = r.total <= 3;
    await r.toMessage({ speaker: { alias: "AWACS" }, flavor: `Ужас: «${callsignOf(ta)}» под захватом ${callsignOf(p)}. 1–3 — выходит из боя.` });
    if (!out) continue;
    await ta.toggleStatusEffect("retreat", { active: true });
    const { sendRadio } = await import("./radio.mjs");
    await sendRadio({ speaker: callsignOf(ta), side: ta.system?.side ?? "enemy", text: "Он у меня на хвосте... Нет. Нет! Выхожу из боя, выхожу!" });
  }
}

/* ---------- «Заслонить» ---------- */

const roundKey = () => (game.combat?.started ? `${game.combat.id}:${game.combat.round}` : "");
/** Свой пилот этого клиента в зоне цели карточки, ещё не заслонявший в этом раунде, или null. */
export function shieldPilotSync(card) {
  if (!card?.targetUuid || !globalThis.canvas?.ready) return null;
  const target = resolveActor(card.targetUuid), tt = target ? tokenOf(target) : null;
  if (!tt) return null;
  const mine = pilots().filter(p => p.isOwner);
  return mine.find(p => !p.system?.markers?.doom && p.getFlag(SYSTEM_ID, "shieldRound") !== roundKey() && zoneDistance(tokenOf(p), tt) === 0) ?? null;
}
export const shieldPilot = card => shieldPilotSync(card);

/** Пилот принимает атаку по мирным на себя: карточка переписывается на него (Defense, урон), +1 на разборе. */
export async function shieldCard(message, pilot) {
  await pilot.setFlag(SYSTEM_ID, "shieldRound", roundKey());
  await noteRep(pilot, "shield", { why: `заслонил мирных: ${message.getFlag(SYSTEM_ID, "card")?.targetName ?? ""}` });
  if (!isLead()) return game.socket?.emit(CHANNEL, { type: "rep", op: "shield", uuid: pilot.uuid, msg: message.id });
  return shieldApply(message, pilot);
}
async function shieldApply(message, pilot) {
  const card = foundry.utils.deepClone(message?.getFlag(SYSTEM_ID, "card") ?? {});
  if (!card.attack || card.shielded || card.resolved || card.dmgApplied) return;
  const R = await import("./dice/rolls.mjs");
  const shooter = resolveActor(card.actorUuid);
  const dc = R.missileDef(shooter, pilot) ?? pilot.system.defense;
  Object.assign(card, { shielded: callsignOf(pilot), shieldedFrom: card.targetName, targetUuid: pilot.uuid, targetName: tokenOf(pilot)?.name ?? pilot.name, dc });
  await message.update({ content: R.renderCard(card), [`flags.${SYSTEM_ID}.card`]: card });
  const { sendRadio } = await import("./radio.mjs");
  await sendRadio({ text: `${callsignOf(pilot)} закрывает собой «${card.shieldedFrom}». Ракета идёт на него!` });
}

/* ---------- «Сдаюсь!» Белого рыцаря ---------- */

/** Сдаётся ли дуэлянт вместо первой метки: атакует Белый рыцарь с бонусами уровня. */
export function surrenders(target, sourceUuid) {
  const by = sourceUuid ? resolveActor(sourceUuid) : null;
  return !!by && bonusRank(by) === 4 && tierOf(target) === "duelist" && enemies(by, target);
}

/* ---------- «Никто не летит с ним» ---------- */

/** Почему союзные NPC не слушают приказов пилота, или "". */
export const ordersRefused = pilot => (rankOf(pilot) === 0 ? "союзники не слушают его приказов (Репутация: «Никто не летит с ним»)" : "");

/* ---------- эфир: выстрел по куполу ---------- */

export const CHUTE_ENEMY = [
  "Он стреляет по куполу! Вы это видели?!",
  "Это же парашютист! Он уже не в бою, сволочь!",
  "Всем бортам: юктобанцы добивают катапультировавшихся!",
  "Запомните этот борт. Живым он отсюда не уйдёт.",
  "Нет... Только не так. Он же уже выпрыгнул...",
  "Пленных не брать. Слышали? Ни одного из них!"
];
export const CHUTE_ALLY = [
  "{who}, прекратить огонь по куполу! Немедленно! Это пойдёт в рапорт.",
  "Ты что творишь?! Он уже не в бою!",
  "Мы так не воюем. Слышишь меня? Мы так не воюем.",
  "Отставить... Просто отставить.",
  "Молодец. Теперь они за нами до самой базы охотиться будут.",
  "Это был чей-то сын, понял?"
];
export const CHUTE_OURS_DOWN = ["Они расстреляли его под куполом! Твари!", "Видел, кто это был? Я его запомнил."];
const lastLine = new Map();
/** Фраза из банка без повтора подряд. */
export function pickNoRepeat(key, list, rnd = Math.random) {
  if (!list.length) return "";
  let i = Math.floor(rnd() * list.length);
  if (list.length > 1 && i === lastLine.get(key)) i = (i + 1) % list.length;
  lastLine.set(key, i);
  return list[i];
}

/** Ближайший к точке говорящий NPC стороны side ("enemy" — враги пилота, "ally" — свои), живой и открытый. */
async function speakerNear(pilot, wantAlly) {
  const C = await import("./chatter.mjs");
  const me = tokenOf(pilot);
  const list = (canvas?.tokens?.placeables ?? []).filter(t => {
    const a = t.actor;
    if (!a || a.type !== "npc" || t.document.hidden || !C.chatterType(a) || ["civilAir", "civilGround", "civilShip"].includes(C.chatterType(a))) return false;
    if (a.statuses?.has?.(CONFIG.specialStatusEffects.DEFEATED) || a.system?.markers?.doom || t.document.getFlag?.(SYSTEM_ID, "unknown")) return false;
    return wantAlly ? !enemies(pilot, a) && a.system?.side !== "neutral" : enemies(pilot, a);
  });
  const d = t => (me ? Math.hypot(t.x - me.x, t.y - me.y) : 0);
  // ас говорит раньше рядовых
  const tok = list.sort((a, b) => (b.actor.system?.tier === "ace") - (a.actor.system?.tier === "ace") || d(a) - d(b))[0];
  return tok ? { name: C.nameOf(tok.actor), side: tok.actor.system?.side ?? (wantAlly ? "ally" : "enemy") } : null;
}

/** Ведущий: пилот выстрелил по куполу (попал или нет). Эфир, CAUTION, кровная месть, сдвиг или нарушение кодекса. */
export async function chuteShotByPilot(pilot) {
  if (!isLead() || !pilot) return;
  const who = callsignOf(pilot);
  const { sendRadio } = await import("./radio.mjs");
  const foe = await speakerNear(pilot, false);
  await sendRadio({ speaker: foe?.name ?? "Противник", side: "enemy", text: pickNoRepeat("chuteEnemy", CHUTE_ENEMY), caution: { title: "CAUTION", sub: "Расстрел купола" } });
  const line = pickNoRepeat("chuteAlly", CHUTE_ALLY);
  const mate = line.includes("{who}") ? null : await speakerNear(pilot, true);
  await sendRadio({ speaker: mate?.name ?? "AWACS", side: "ally", text: line.replace("{who}", who) });
  await pilot.setFlag(SYSTEM_ID, "feud", { combat: combatId() });
  // Белый рыцарь: нарушение кодекса (−4 сразу) вместо обычного сдвига
  if (rankOf(pilot) === 4 && !codeBroken(pilot)) await breakCode(pilot, "выстрел по куполу");
  else await noteRep(pilot, "chute");
}

/* ---------- цвет HUD, след и надписи по уровню ---------- */

/** Цвета уровня для надписей HIT / MISS / DESTROYED (у клиента своего пилота). Солдат — null, как раньше. */
export const REP_CALLOUT = {
  knight: { HIT: 0x8fd3ff, MISS: 0xb9d6ea, DESTROYED: 0x4fb3ff },
  white: { HIT: 0xf2f8ff, MISS: 0xc9d8e6, DESTROYED: 0xdbeeff },
  punisher: { HIT: 0xffa040, MISS: 0xd8b48c, DESTROYED: 0xff5a2a },
  monster: { HIT: 0xff6a3a, MISS: 0xc98a78, DESTROYED: 0xd8261a }
};
let localKey = "soldier";
/** Уровень пилота в HUD этого клиента. */
export const localRep = () => localKey;
/** HUD этого клиента показывает actor: класс уровня на теле страницы (HUD, полоса очереди, тихие подсказки, табло броска). */
export function paintHud(actor) {
  const key = actor?.type === "pilot" ? repOf(actor).key : "soldier";
  if (key === localKey && document.body.classList.contains(`tb-rep-${key}`)) return;
  for (const l of REP_LEVELS) document.body.classList.remove(`tb-rep-${l.key}`);
  document.body.classList.add(`tb-rep-${key}`);
  localKey = key;
}

/* ---------- строка REP в HUD ---------- */

/** Что показать в HUD пилота: уровень, кровная месть, кнопки. chutes — число вражеских куполов рядом. */
export function hudRep(actor, chutes = 0) {
  const r = repOf(actor);
  if (!r) return null;
  const honor = bonusRank(actor) >= 3 && !honorUsed(actor) && !!game.combat?.started;
  const rescue = chutes > 0 && game.combat?.started && actor.getFlag?.(SYSTEM_ID, "rescueCall") !== game.combat.id;
  const view = { key: r.key, name: r.name, soldier: r.key === "soldier", feud: hasFeud(actor), broken: codeBroken(actor), honor, chute: chutes > 0, rescue };
  return view.soldier && !view.feud && !view.broken && !honor && !view.chute ? null : view;
}
/** Разметка строки REP. */
export function repRowHtml(v) {
  if (!v) return "";
  const chips = [!v.soldier ? `<span class="tb-hud-ctchip tb-rep-lv lv-${v.key}" title="Репутация пилота: эффекты уровня на листе">${esc(v.name)}</span>` : "",
    v.broken ? `<span class="tb-hud-ctchip bad" title="Кодекс Белого рыцаря нарушен: до конца вылета без бонусов уровня">КОДЕКС НАРУШЕН</span>` : "",
    v.feud ? `<span class="tb-hud-ctchip bad" title="Вы стреляли по куполу: вражеские NPC выбирают вас первым, асы и дуэлянты +1 к атакам, ваш купол расстреляет любой">КРОВНАЯ МЕСТЬ</span>` : ""].join("");
  const btns = [v.honor ? `<button type="button" data-hud-rep="honor" title="Слово чести: раз за вылет Lead против 7 по открытому каналу, вражеский Conscript в вашей зоне выходит из боя${v.key === "white" ? " (дуэлянт — против 9)" : ""}">СЛОВО ЧЕСТИ</button>` : "",
    v.chute ? `<button type="button" class="tb-hud-chute-shoot" data-hud-rep="chute" title="Расстрелять вражеский купол рядом: Strafe против 6, проверка хода. Эфир это запомнит: −2 Репутации, кровная месть">ПО КУПОЛУ</button>` : "",
    v.rescue ? `<button type="button" data-hud-rep="rescue" title="Координаты спасателям: передать в открытый эфир, где вражеский купол (раз за вылет, без броска): +1 Репутации">СПАСАТЕЛЯМ</button>` : ""].join("");
  return `<div class="tb-hud-btns tb-hud-rep"><small title="Репутация пилота">REP</small>${chips}${btns}</div>`;
}

/* ---------- лист пилота и панель AWACS ---------- */

/** Для листа и панели: уровень, шкала, эффекты, журнал (последние сверху). */
export function repView(actor) {
  const r = repOf(actor);
  if (!r) return null;
  const fx = repEffects(r.key);
  const pct = Math.round((r.points - REP_MIN) / (REP_MAX - REP_MIN) * 100);
  return { ...r, pct, sign: r.points > 0 ? `+${r.points}` : String(r.points), bonus: fx.bonus, minus: fx.minus, broken: codeBroken(actor), feud: hasFeud(actor),
    log: [...(actor.system.reputation?.log ?? [])].reverse().slice(0, 12).map(x => ({ ...x, sign: x.delta > 0 ? `+${x.delta}` : String(x.delta) })),
    pending: (actor.getFlag(SYSTEM_ID, "repEvents") ?? []).length };
}

/** Ведущий: ±1 с причиной (панель AWACS, лист). */
export async function repStep(pilot, delta) {
  if (!game.user.isGM || !pilot) return;
  const { formDialog } = await import("./dice/rolls.mjs");
  const d = await formDialog(`Репутация: ${pilot.name} ${delta > 0 ? "+" : "−"}${Math.abs(delta)}`,
    `<div class="form-group"><label>За что</label><input type="text" name="why" placeholder="${delta > 0 ? "отпустил врага, спас гражданских…" : "добил отступившего, огонь по своим…"}"></div>`, { ok: "Записать" });
  if (!d) return;
  const r = await shiftRep(pilot, delta, d.why || (delta > 0 ? "решение ведущего" : "решение ведущего"));
  if (r && r.before.key !== r.after.key) ui.notifications.info(`${pilot.name}: теперь «${r.after.name}».`);
}

/** «Отказался от приказа» (кнопка ведущего): +2 на разборе и +1 на шкалу «Особый отдел присматривается». */
export async function refuseOrder(pilot) {
  if (!game.user.isGM || pilot?.type !== "pilot") return;
  const { formDialog } = await import("./dice/rolls.mjs");
  const d = await formDialog(`${pilot.name}: отказ от приказа`, `<p class="tb-hint">Пилот отказался выполнить приказ, который бьёт по мирным, пленным или сбитым. На разборе +2 Репутации (подсказка с галочкой), сейчас +1 на шкалу «Особый отдел присматривается».</p>
    <div class="form-group"><label>Какой приказ</label><input type="text" name="why" placeholder="ударить по колонне беженцев…"></div>`, { ok: "Записать" });
  if (!d) return;
  await noteRep(pilot, "refuse", { why: d.why ? `отказался от приказа: ${d.why}` : "" });
  const { bumpThreat } = await import("./downtime.mjs");
  await bumpThreat("Особый отдел присматривается", 1, { note: "допрос, обыск в казарме или отстранение от вылета" });
  ui.notifications.info(`${pilot.name}: отказ от приказа записан, «Особый отдел» +1.`);
}

/* ---------- разбор: строки для «Итогов вылета» ---------- */

/** Блок формы «Итогов вылета»: подсказанные сдвиги каждого пилота с галочками. */
export function debriefFields(list) {
  const rows = list.map(a => {
    const ev = repSuggest(a.getFlag(SYSTEM_ID, "repEvents") ?? []);
    const v = repView(a);
    const items = [...ev.map(e => `<label><input type="checkbox" name="rep_${a.id}_${e.i}" ${e.on ? "checked" : ""}> ${e.delta > 0 ? "+" : "−"}${Math.abs(e.delta)} ${esc(e.why)}</label>`),
      `<label title="Сорвал удар по мирным или спас гражданских (условие медали «За мирное небо»): решает AWACS"><input type="checkbox" name="rep_${a.id}_saved"> +1 спас мирных</label>`];
    return `<div class="tb-rep-row"><b>${esc(a.name)}</b> <span class="tb-rep-chip lv-${v.key}">${esc(v.name)} ${esc(v.sign)}</span> ${items.join(" ") || `<small class="tb-muted">сдвигов нет</small>`}</div>`;
  }).join("");
  return `<details class="tb-glory-block tb-rep-block" open><summary>Репутация пилотов <small class="tb-muted">подсказки по событиям вылета; без галочки шкала не меняется, вверх не больше +${UP_CAP} за вылет</small></summary>${rows}</details>`;
}

/** Применить отмеченное на разборе. Возвращает строки для итогов и подсказки ведущему. */
export async function applyDebrief(pilot, data, date) {
  const ev = repSuggest(pilot.getFlag(SYSTEM_ID, "repEvents") ?? []);
  const picked = ev.filter(e => data[`rep_${pilot.id}_${e.i}`]);
  if (data[`rep_${pilot.id}_saved`]) picked.push({ kind: "saved", delta: 1, why: REP_SHIFTS.saved.why });
  await pilot.unsetFlag(SYSTEM_ID, "repEvents");
  const notes = [];
  let r = null;
  const total = repTotal(picked);
  if (total) r = await shiftRep(pilot, total, picked.map(e => `${e.delta > 0 ? "+" : "−"}${Math.abs(e.delta)} ${e.why}`).join("; "), date);
  if (r) notes.push(`Репутация ${total > 0 ? "+" : "−"}${Math.abs(total)} (${r.points}${r.before.key !== r.after.key ? `, теперь «${r.after.name}»` : ""})`);
  const lv = repOf(pilot);
  const hints = [];
  if (lv.rank <= 1) hints.push(`«Особый отдел присматривается» +${lv.rank === 0 ? 2 : 1} за операцию (${pilot.name})`);
  if (lv.rank === 0) hints.push(`за ${pilot.name} в следующем вылете приходит ас или эскадрилья дуэлянтов`);
  if (lv.rank === 4) hints.push(`в этой операции хотя бы один ас приходит за ${pilot.name}`);
  if (lv.rank === 0 && pilot.items.some(i => i.type === "trigger" && i.system.key === "noquestions")) {
    const { reputation } = await import("./combat-triggers.mjs");
    await reputation(pilot);
    notes.push("«Дурная слава» +1 (Кошмары)");
  }
  return { notes, hints };
}

/* ---------- регистрация ---------- */

export function registerReputation() {
  Hooks.once("ready", () => {
    game.socket.on(CHANNEL, msg => {
      if (msg?.type !== "rep" || !isLead()) return;
      const a = msg.uuid ? resolveActor(msg.uuid) : null;
      if (!a) return;
      if (msg.op === "note") noteRep(a, msg.kind, { why: msg.why, once: msg.once }).catch(err => console.warn(`${SYSTEM_ID} | репутация`, err));
      if (msg.op === "shift") shiftRep(a, msg.delta, msg.why, msg.date).catch(err => console.warn(`${SYSTEM_ID} | репутация`, err));
      if (msg.op === "code") breakCode(a, msg.why).catch(err => console.warn(`${SYSTEM_ID} | репутация`, err));
      if (msg.op === "shield") shieldApply(game.messages.get(msg.msg), a).catch(err => console.warn(`${SYSTEM_ID} | Заслонить`, err));
    });
  });
  // Кошмары: у Чудовища Нервы не ниже 2 (Наёмник вместо этого копит «Дурную славу»)
  Hooks.on("preUpdateActor", (actor, change) => {
    if (actor.type !== "pilot" || rankOf(actor) !== 0) return;
    const n = foundry.utils.getProperty(change, "system.nerves");
    if (n === undefined || n >= 2) return;
    if (actor.items.some(i => i.type === "trigger" && i.system.key === "noquestions")) return;
    foundry.utils.setProperty(change, "system.nerves", 2);
  });
  Hooks.on("updateCombat", (combat, change) => { if ("round" in change && combat.started) terror(combat).catch(err => console.warn(`${SYSTEM_ID} | Ужас`, err)); });
  // «Ложная сдача»: кнопка ведущего в меню вражеского токена, когда рядом Белый рыцарь
  Hooks.on("renderTokenHUD", (hud, html) => {
    const token = hud.object, a = token?.actor;
    if (!game.user.isGM || a?.type !== "npc" || !game.combat?.started) return;
    if (!pilots().some(p => rankOf(p) === 4 && enemies(p, a))) return;
    const col = (html[0] ?? html).querySelector(".col.left");
    if (!col) return;
    const b = document.createElement("div");
    b.className = "control-icon tb-false-surrender";
    b.title = "«Ложная сдача»: эта машина объявляет о сдаче Белому рыцарю в своей зоне (раз за вылет)";
    b.innerHTML = `<i class="fas fa-flag"></i>`;
    b.addEventListener("click", ev => { ev.preventDefault(); ev.stopPropagation(); hud.clear(); falseSurrender(token).catch(err => console.error(`${SYSTEM_ID} | Ложная сдача`, err)); });
    col.append(b);
  });
}

export { BY_KEY as REP_BY_KEY, rankOf as repRank, bonusRank as repBonusRank, enemies as repEnemies, civil as repCivil };
export const repName = key => BY_KEY[key]?.name ?? BY_KEY.soldier.name;
