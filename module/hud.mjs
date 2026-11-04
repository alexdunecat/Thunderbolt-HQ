/* HUD пилота: полоса внизу экрана над панелью макросов, как приборы в Ace Combat.
   Одна широкая низкая строка: HP, Strain, защита, захват и системы; спидометр; альтиметр; силуэт машины с пилонами;
   кнопки оружия, манёвров и конца хода. Видна в бою, когда самолёт игрока стоит на сцене;
   у ведущего показывает выделенный токен. Сворачивается щелчком по шапке, выключается в настройках клиента. */
import { SYSTEM_ID, TB, sysOff } from "./config.mjs";
import { esc, resolveActor } from "./utils.mjs";
import { tokenOf, weatherAt, defenseWithWeather, altOf, zoneDistance, isFlying, ceilingOf, flyingBoss, hasRule, ALT_ORDER } from "./scene.mjs";
import { aimedWeapon, toggleAim, hlSwitch, setHlMode } from "./range.mjs";
import { stepAltitude } from "./altitude.mjs";
import { combatantOf, spentOf, declaredOf, endTurn } from "./actions.mjs";
import { runAction, PILOT_BAR } from "./macros.mjs";
import { lockersOf } from "./rwr.mjs";
import { vmaxOf, kmhOf } from "./plane-speed.mjs";
import { ejectNow, heroNow, ejectFate, weaponReady, isGunPod, isOwnFire, computeCard, onCardAction, hudOdds } from "./dice/rolls.mjs";
import { unitKind, unitHtml, onUnitClick, registerUnitHud } from "./unit-hud.mjs";
import { hudTriggers, useCombatTrigger } from "./combat-triggers.mjs";
import { adviceRow, runAdvice, showTarget } from "./npc-advice.mjs";
import { hudPlane, planeRowHtml, useMove, useAoa, pickBooster, useDeck } from "./plane-roles.mjs";
import { poolOf, squadRowHtml, useTactic } from "./duelists.mjs";
import { aceRowHtml, aceClick } from "./ace-play.mjs";
import { justEmptied } from "./winchester.mjs";
import { wingmenOf, wingOrderOf, wingSpwOf, giveWingOrder, WING_ORDERS, WING_SPW } from "./autopilot.mjs";
import { isUnknown } from "./ident.mjs";
import { hudNemesis, isNemesis, pilotsOf, monologue, startMonologue, endMonologue, appear, useTrigger, STATE_TEXT } from "./nemesis.mjs";

const FOLD_KEY = `${SYSTEM_ID}.hudFolded`, POS_KEY = `${SYSTEM_ID}.hudPos`;
const BIG = new Set(["missile", "lock", "stall", "doom"]);
const BIG_HINT = { missile: "ракета в воздухе: Break! или смена высоты", lock: "вас держат на захвате", stall: "Speed 0 и ниже: машина сваливается, прибавьте скорость", doom: "машина обречена: катапульта или героическая гибель" };
const BUTTONS = { lock: "Lock On", break: "Break", lead: "Lead", formup: "Вплотную", recover: "Strain", end: "Конец хода" };
let el = null, timer = null, shown = null;

export function registerHud() {
  game.settings.register(SYSTEM_ID, "pilotHud", {
    name: "HUD пилота", hint: "Полоса внизу экрана в бою: HP, Strain, Speed, высота, действия хода, захват, спецоружие и предупреждения, кнопки действий.",
    scope: "client", config: true, type: Boolean, default: true, onChange: () => refreshHud()
  });
  game.settings.register(SYSTEM_ID, "hudLayout", {
    name: "Вид HUD пилота", hint: "По углам: приборы светятся в левом нижнем углу, оружие и кнопки в правом, без общей панели, середина экрана открыта. Панелью: одна полоса над панелью макросов, её можно двигать и тянуть за угол. Переключается и значком в шапке HUD.",
    scope: "client", config: true, type: String, default: "corners", choices: { corners: "По углам, как в Ace Combat", panel: "Одной панелью" },
    onChange: () => { lastHtml = ""; refreshHud(); }
  });
  game.settings.register(SYSTEM_ID, "hitFlash", {
    name: "Удар по своей машине", hint: "Когда твоя машина в HUD получает урон, HUD краснеет, идёт рябью помех и вздрагивает, как в Ace Combat. При метке Doom HUD остаётся красным. Только у себя.",
    scope: "client", config: false, type: Boolean, default: true, onChange: v => { if (!v) setDoom(false); }
  });
  game.settings.register(SYSTEM_ID, "hudScale", {
    name: "Размер HUD по углам", hint: "Насколько крупно рисуются приборы, оружие и кнопки HUD по углам. Если места на экране не хватает, сначала сужаются колонки, потом прячется силуэт машины.",
    scope: "client", config: true, type: String, default: "1.15", choices: { "1": "Обычный", "1.15": "Крупнее", "1.3": "Ещё крупнее", "1.45": "Самый крупный" },
    onChange: () => place()
  });
  // боевой экран спрятал или вернул окна Foundry, свернули чат, поменяли окно: углы HUD встают заново
  Hooks.on(`${SYSTEM_ID}.combatScreen`, () => setTimeout(place, 60));
  Hooks.on("collapseSidebar", () => setTimeout(place, 260));
  Hooks.on("thunderboltHit", actor => onEarlyHit(actor));
  // попадание отменили («Обманный манёвр», «Летающий танк»): следующий удар снова трясёт
  Hooks.on("thunderboltHitVoid", actor => { if (earlyHit?.uuid === actor?.uuid) earlyHit = null; });
  globalThis.window?.addEventListener?.("resize", () => place());
  for (const ev of ["canvasReady", "controlToken", "updateActor", "updateActorDelta", "createToken", "deleteToken", "updateItem",
    "createCombat", "updateCombat", "deleteCombat", "updateCombatant"]) Hooks.on(ev, () => refreshHud());
  // чат: только карточки системы (пуски, захваты, Doom), не обычные реплики
  for (const ev of ["createChatMessage", "updateChatMessage"]) Hooks.on(ev, m => { if (m.getFlag?.(SYSTEM_ID, "card") || m.getFlag?.(SYSTEM_ID, "rwr")) refreshHud(); });
  // токен: место, высота, видимость, данные машины и картинка (силуэт); не имя и не полоски
  const TOKEN_KEYS = ["x", "y", "elevation", "hidden", "delta", "texture", "actorLink"];
  Hooks.on("updateToken", (doc, change) => { if (TOKEN_KEYS.some(k => k in change)) refreshHud(); });
  Hooks.on(`${SYSTEM_ID}.hlMode`, () => refreshHud());
  Hooks.on(`${SYSTEM_ID}.monologue`, () => refreshHud());
  // запас Strain и тактики эскадрилий дуэлянтов
  Hooks.on(`${SYSTEM_ID}.squadrons`, () => refreshHud());
  registerUnitHud();
}

/** Перерисовать HUD (пачка обновлений даёт одну перерисовку). */
export function refreshHud() {
  clearTimeout(timer);
  timer = setTimeout(() => { try { render(); } catch (err) { console.warn(`${SYSTEM_ID} | HUD`, err); } }, 80);
}

/** Чей самолёт показывать: выделенный свой токен, иначе пилот игрока, иначе его первый пилот на сцене. У ведущего только выделенный. */
export function hudActor() {
  const own = (canvas?.tokens?.controlled ?? []).filter(t => t.actor?.isOwner && ["pilot", "npc"].includes(t.actor.type));
  if (own.length === 1 && !hudFits(own[0].actor) && !unitKind(own[0].actor)) return null;
  if (own.length === 1) return own[0].actor;
  if (game.user.isGM) return null;
  const ch = game.user.character;
  if (ch?.type === "pilot" && tokenOf(ch)) return ch;
  return game.actors.find(a => a.type === "pilot" && a.isOwner && tokenOf(a)) ?? null;
}

/** Приборы истребителя только у пилотов и военных самолётов NPC: у супероружия, кораблей, наземки, зданий и гражданских их нет. */
export function hudFits(actor) {
  if (actor?.type === "pilot") return true;
  if (actor?.type !== "npc") return false;
  const s = actor.system;
  return s.kind === "air" && s.grp !== "boss" && s.grp !== "civil" && !hasRule(actor, "civilian") && !flyingBoss(actor) && !(s.systems?.length);
}

const pips = (value, max, cls = "") => Array.from({ length: Math.max(0, max) }, (_, i) => `<i class="${i < value ? "on" : ""} ${cls}"></i>`).join("");

/** Ракеты, летящие в этот самолёт: отложенные пуски текущего боя, ещё не долетевшие. */
function incoming(actor) {
  const combat = game.combat;
  if (!combat?.started) return 0;
  return game.messages.contents.slice(-300).filter(m => {
    const c = m.getFlag(SYSTEM_ID, "card");
    // «Удар из ниоткуда»: о такой ракете цель не знает (ведущий видит)
    return c?.delayed && c.targetUuid === actor.uuid && c.combatKey?.startsWith(`${combat.id}:`) && !c.resolved && !c.dmgApplied && (!c.ghost || game.user.isGM);
  }).length;
}

/** Высоты на альтиметре: игровая ступень и высота в метрах для подписи. */
const ALT_METERS = { low: 300, med: 3000, high: 9000, strat: 18000 };

/** Всё, что показывает HUD, без разметки (для тестов). */
export function hudData(actor) {
  const s = actor.system, tok = tokenOf(actor), w = weatherAt(actor, tok);
  const pilot = actor.type === "pilot";
  const maxSpeed = (s.maxSpeed ?? s.stats?.spd ?? 0) + (w.spd ?? 0);
  const alt = tok ? altOf(tok, actor) : s.alt;
  const c = combatantOf(actor, tok);
  const spent = c ? spentOf(c) : null, declared = c ? declaredOf(c) : null;
  const target = s.lockUuid ? resolveActor(s.lockUuid) : null, tTok = tokenOf(target);
  const dist = target ? zoneDistance(tok, tTok) : null;
  const lockedBy = tok ? lockersOf(tok).length : 0;
  const missiles = incoming(actor);
  const flying = isFlying(actor);
  const warn = [];
  if (missiles) warn.push({ key: "missile", text: missiles > 1 ? `MISSILE ×${missiles}` : "MISSILE" });
  else if (lockedBy) warn.push({ key: "lock", text: "LOCK" });
  if (flying && s.speed <= 0) warn.push({ key: "stall", text: "STALL" });
  if (flying && alt === "low") warn.push({ key: "lowalt", text: "LOW ALT" });
  if (s.markers?.doom) warn.push({ key: "doom", text: "DOOM" });
  else if (s.hp.value <= 1 && s.hp.max > 1) warn.push({ key: "damage", text: "DAMAGE" });
  const aim = aimedWeapon(actor)?.id ?? null;
  const weapons = actor.items.filter(i => i.type === "weapon").map(i => {
    const a = i.system.ammo, max = a.max === null ? null : a.max + (s.ammoBonus?.[i.id] ?? 0);
    return { id: i.id, name: i.name, ammo: max === null ? "∞" : `${a.value}/${max}`, empty: !weaponReady(i), winch: justEmptied(i), aimed: i.id === aim, trait: i.system.trait ?? null };
  });
  // альтиметр: доступные ступени (потолок машины, у боссов свои), остальные тусклые
  const ceil = ceilingOf(actor);
  const allowed = flyingBoss(actor) ?? (ceil ? ALT_ORDER.slice(0, ALT_ORDER.indexOf(ceil) + 1) : ALT_ORDER);
  const kmh = kmhOf(actor, s.speed, maxSpeed);
  // повреждения: Structure ломает систему, Grit отключает навык, Doom — машина обречена
  const m = s.markers ?? {};
  const systems = Object.entries(TB.systems).map(([k, v]) => ({ key: k, label: v.label, hint: v.hint, broken: sysOff(s, k), jam: s.jam === k && s.broken !== k }));
  const grit = m.grit ? (TB.skills[m.gritSkill]?.label ?? m.gritSkill ?? "навык не выбран") : "";
  return {
    name: (pilot && s.callsign) || tok?.name || actor.name, plane: pilot ? s.plane?.name ?? "без самолёта" : TB.npcKinds?.[s.kind] ?? "",
    // дуэлянт эскадрильи: вместо своего Strain — запас эскадрильи
    hp: s.hp, strain: poolOf(actor) ?? s.strain, strainPool: !!poolOf(actor), speed: s.speed, maxSpeed, kmh, vmax: vmaxOf(actor), mach: (kmh / 1225).toFixed(1),
    img: tok?.document?.texture?.src ?? actor.img ?? "", systems, grit, doom: !!m.doom,
    canEject: pilot && !!m.doom && !["ejected", "kia", "mia", "hospital"].includes(s.service?.status),
    alt: TB.altitudes[alt] ?? alt ?? "", altKey: alt, flying, defense: defenseWithWeather(actor, w),
    alts: ALT_ORDER.map(k => ({ key: k, label: TB.altitudes[k] ?? k, m: ALT_METERS[k], on: k === alt, can: allowed.includes(k) })).reverse(),
    acts: c ? { id: c.id, canDeclare: declared === null && c.parent.getFlag?.(SYSTEM_ID, "npcDone") === c.parent.round, declared, used: spent.used, rolled: spent.rolled, list: spent.list, turn: c.parent.combatant?.id === c.id } : null,
    lock: s.lockUuid || s.lock ? { name: target?.token?.name ?? tTok?.name ?? target?.name ?? s.lock, uuid: s.lockUuid, gone: !tTok,
      dist: dist === null ? "" : dist === 0 ? "своя зона" : `${dist} ${dist === 1 ? "зона" : dist < 5 ? "зоны" : "зон"}` } : null,
    weapons, aimed: aim, warn,
    // захвачен неопознанный контакт «?»: кнопка опознания по радару (9.6)
    ident: !!tTok && isUnknown(tTok) && (pilot || !!actor.hasPlayerOwner),
    // Немезида: у пилота — лампа с именем, дальностью и тем, что действует; у ведущего на её машине — «Появление» и «Монолог»
    nem: pilot ? hudNemesis(actor) : null,
    // боевые триггеры: что можно задействовать сейчас и что действует
    ct: pilot ? hudTriggers(actor) : null,
    // последний бросок, к которому можно добавить Strain прямо из HUD
    roll: c ? strainRoll(actor) : null,
    // шанс по захваченной цели для подсказок станций: пушка, стандартная ракета, каждое спецоружие
    odds: c ? oddsOf(actor) : {},
    // сваливание: бросок уже был, а исход не применён — кнопка прямо на плашке STALL
    stall: flying ? stallPending(actor) : null,
    // роль машины, лампы свойств, Angle of Attack Limiter и фирменный приём
    planeRow: hudPlane(actor),
    // ведомые на автопилоте за этой машиной: приказы им
    wing: hudWing(actor),
    nemSelf: !pilot && isNemesis(actor) && game.user.isGM
      ? { side: s.side === "ally" || s.side === "neutral" ? s.side : "enemy", who: pilotsOf(actor).map(p => p.system.callsign || p.name).join(", "), talking: monologue()?.uuid === actor.uuid } : null
  };
}

/** Последний свой бросок, если к нему ещё можно добавить Strain (как кнопка «+1 Strain» на карточке): { id, label, total, dc, success }.
    Смотрится только самая свежая своя карточка: если к ней Strain уже нельзя, к старым тоже не предлагается. */
export function strainRoll(actor, messages = game.messages?.contents ?? [], now = Date.now()) {
  for (let i = messages.length - 1, seen = 0; i >= 0 && seen < 40; i--, seen++) {
    const c = messages[i].getFlag?.(SYSTEM_ID, "card");
    if (!c || c.actorUuid !== actor.uuid) continue;
    if (!c.rolled) return null;
    const can = c.strainable && !c.resolved && !c.dmgApplied && !(c.type === "eject" && c.applied);
    // бросок без Strain (или уже учтённый) ещё немного висит на HUD, чтобы его успели увидеть
    const age = now - (Number(messages[i].timestamp) || 0), keepMs = c.type === "eject" ? EJECT_SHOW_MS : ROLL_SHOW_MS;
    if (!can && !(messages[i].timestamp && age < keepMs)) return null;
    const r = computeCard(c);
    return { id: messages[i].id, label: c.label, total: r.total, dc: c.dc ?? null, success: r.success ?? null, strain: c.strain ?? 0, brk: c.type === "break" ? { value: r.value, ev: c.ev, applies: r.applies } : null,
      ...(can ? {} : { canStrain: false, left: keepMs - age }),
      eject: c.type === "eject" ? ejectFate(r).key : null,
      d10: c.d10 ?? null, d4: c.d4 ?? null, perk: !!r.perk, comp: !!r.comp, attack: !!c.attack, delayed: !!c.delayed,
      parts: (c.parts ?? []).filter(p => p?.[1]).slice(0, 4).map(([n, v]) => `${n} ${v > 0 ? "+" : ""}${v}`) };
  }
  return null;
}
const ROLL_SHOW_MS = 25000, EJECT_SHOW_MS = 90000;
const FATE_WORD = { ok: "КАТАПУЛЬТИРОВАЛСЯ", hurt: "РАНЕН · ПОДОБРАН", mia: "ПРОПАЛ БЕЗ ВЕСТИ", kia: "ГИБЕЛЬ" };

/** Шанс по цели для каждой станции HUD (подсказка при наведении); ошибка прикидки подсказку просто не даёт. */
function oddsOf(actor) {
  const out = {};
  for (const st of ["guns", "missile", ...actor.items.filter(i => i.type === "weapon").map(i => i.id)]) {
    try { const o = hudOdds(actor, st); if (o) out[st] = o; } catch (err) { /* без подсказки */ }
  }
  return out;
}
const oddsLine = o => (o ? `\nЦель «${o.name}»: ${o.text}` : "");

/** Неразобранная карточка сваливания этой машины: { id, ok, low } — исход применяется кнопкой прямо из HUD. */
export function stallPending(actor, messages = game.messages?.contents ?? []) {
  for (let i = messages.length - 1, seen = 0; i >= 0 && seen < 40; i--, seen++) {
    const c = messages[i].getFlag?.(SYSTEM_ID, "card");
    if (c?.type !== "stall" || c.actorUuid !== actor.uuid) continue;
    return c.applied ? null : { id: messages[i].id, ok: !!computeCard(c).success, alt: c.alt ?? actor.system.alt };
  }
  return null;
}

/** Кнопка исхода сваливания на плашке STALL: успех — выровняться, провал — потерять высоту (на Низкой — Doom). */
function stallButton(d) {
  const s = d.stall;
  if (!s) return "";
  const label = s.ok ? "Выровняться: Speed 1" : s.alt === "low" ? "Удар о землю: Doom" : s.alt === "strat" ? "Спуститься на Высокую" : "Потерять высоту";
  return `<button type="button" class="tb-hud-stallbtn ${s.ok ? "ok" : "bad"}" data-hud-stall="${s.id}" title="Исход броска на сваливание (то же, что кнопка на карточке в чате)">${label}</button>`;
}

/**
 * Табло броска над HUD: кубики, итог против защиты, вердикт, Perk и Complication, кнопки Strain («+1» и «+N до успеха»).
 * Висит, пока к броску можно добавить Strain; бросок без Strain — ещё 25 секунд.
 */
export function rollPlateHtml(d) {
  const r = d.roll;
  if (!r || r.d10 === null || r.d10 === undefined) return "";
  const left = d.strain?.max ? d.strain.value : 0, can = r.canStrain !== false;
  const has = r.dc !== null && !r.brk, gap = has && !r.success ? r.dc - r.total : 0;
  const verdict = r.eject ? FATE_WORD[r.eject] : r.brk ? `EVASION ${r.brk.value}${r.brk.applies ? "" : ` · не выше ${r.brk.ev}`}`
    : !has ? "ИТОГ" : r.success ? (r.attack ? "ПОПАДАНИЕ" : "УСПЕХ") : `${r.attack ? "МИМО" : "ПРОВАЛ"} −${gap}`;
  const cls = r.eject ? (r.eject === "ok" ? "ok eject" : "miss eject") : r.brk ? (r.brk.applies ? "ok" : "miss") : has ? (r.success ? "ok" : "miss") : "plain";
  const btns = can && left > 0 ? `<span class="tb-hud-rollbtns">
      <button type="button" data-hud-strain="${r.id}" title="Потратить 1 Strain: +1 к этому броску"><b>+1</b> STRAIN · ${left}</button>
      ${gap > 1 && gap <= left ? `<button type="button" class="reach" data-hud-strain-n="${r.id}:${gap}" title="Потратить ${gap} Strain и дотянуть бросок до успеха"><b>+${gap}</b> ДО УСПЕХА</button>` : ""}</span>`
    : can && has && !r.success ? `<span class="tb-hud-none">Strain 0</span>` : "";
  return `<div class="tb-hud-rollplate ${cls}" data-roll-id="${r.id}">
    ${r.eject ? `<i class="fas fa-parachute-box tb-hud-chute"></i>` : ""}<span class="tb-hud-dice"><i class="d10" title="d10">${r.d10}</i>${r.d4 !== null && r.d4 !== undefined && r.eject !== "ok" ? `<i class="d4${r.perk ? " perk" : r.comp ? " comp" : ""}" title="d4${r.perk ? ": Perk" : r.comp ? ": Complication" : ""}">${r.d4}</i>` : ""}</span>
    <span class="tb-hud-rollsum"><b>${r.brk ? r.total : r.total}</b>${has ? `<em>/ ${r.dc}</em>` : ""}</span>
    <span class="tb-hud-rollinfo"><strong>${esc(verdict)}</strong><small>${esc(r.label)}${r.parts?.length ? ` · ${esc(r.parts.join(" · "))}` : ""}${r.strain ? ` · Strain +${r.strain}` : ""}${r.perk ? " · PERK" : r.comp ? " · COMPLICATION" : ""}${r.delayed && r.success && !r.eject ? " · долетит в залпе конца раунда" : ""}</small></span>
    ${btns}</div>`;
}

/** Строка броска в HUD: итог последнего броска и кнопка «+1 Strain» прямо отсюда, без чата. */
function rollRowHtml(d) {
  const r = d.roll;
  if (!r) return "";
  const res = r.brk ? `Evasion ${r.brk.value}${r.brk.applies ? "" : ` · не выше ${r.brk.ev}`}`
    : `${r.total}${r.dc !== null ? ` против ${r.dc} · ${r.success ? "успех" : "мимо"}` : ""}`;
  const left = d.strain?.max ? d.strain.value : 0;
  return `<div class="tb-hud-btns tb-hud-roll ${r.dc !== null ? (r.success ? "ok" : "miss") : ""}"><small title="Последний бросок">БРОСОК</small>
    <span class="tb-hud-rolltxt" title="${esc(r.label)}${r.strain ? ` · Strain +${r.strain}` : ""}"><b>${esc(res)}</b>${r.strain ? ` <em>+${r.strain} Strain</em>` : ""} · ${esc(r.label)}</span>
    ${left > 0 ? `<button type="button" data-hud-strain="${r.id}" title="Потратить 1 Strain: +1 к этому броску (как кнопка на карточке в чате)"><b>+1</b> STRAIN · ${left}</button>` : `<span class="tb-hud-none">Strain 0</span>`}</div>`;
}

/** Строка боевых триггеров в HUD: кнопки «задействовать» и то, что действует. */
function ctRow(d) {
  if (!d.ct) return "";
  return `<div class="tb-hud-btns tb-hud-ct"><small title="Боевые триггеры">TRIG</small>
    ${d.ct.chips.map(c => `<span class="tb-hud-ctchip">${esc(c)}</span>`).join("")}
    ${d.ct.trig.map(t => t.state === "ready" || t.state === undefined
    ? `<button type="button" class="tb-hud-cttrig" data-hud-ctrig="${t.id}" title="${esc(t.hint)}">${esc(t.name)}</button>`
    : `<span class="tb-hud-cttrig ${t.state}" title="${esc(`${t.hint}. Сейчас: ${t.why}`)}">${esc(t.name)}${t.state === "on" ? " · действует" : ""}</span>`).join("")}</div>`;
}

/** Строка Немезиды в HUD. */
function hudWing(actor) {
  const list = wingmenOf(actor);
  return list.length ? { names: list.map(t => t.name), order: wingOrderOf(actor), spw: wingSpwOf(actor) } : null;
}

/* Крест команд ведомым, как в Ace Combat: стрелки-пятиугольники смотрят в центр, подпись снаружи.
   ATK сверху, CVR снизу, DSP слева, SPW справа. Горит то, что приказано. */
const WING_CROSS = [
  { k: "attack", tag: "ATK", pos: "up", pts: "6,2 34,2 34,20 20,34 6,20" },
  { k: "free", tag: "DSP", pos: "left", pts: "2,6 20,6 34,20 20,34 2,34" },
  { k: "spw", tag: "SPW", pos: "right", pts: "34,6 16,6 2,20 16,34 34,34" },
  { k: "cover", tag: "CVR", pos: "down", pts: "6,38 34,38 34,20 20,6 6,20" }
];
function wingCross(d) {
  if (!d.wing) return "";
  const on = k => (k === "spw" ? d.wing.spw : d.wing.order === k);
  const title = k => k === "spw" ? `SPW · ${WING_SPW}${d.wing.spw ? ": ещё раз — только когда оно сильнее ракеты" : ""}`
    : `${WING_CROSS.find(x => x.k === k).tag} · ${WING_ORDERS[k]}${on(k) ? ": ещё раз — по обстановке" : ""}`;
  const btn = x => `<a class="tb-wx-btn ${x.pos} ${on(x.k) ? "on" : ""}" data-hud-wing="${x.k}" title="${esc(title(x.k))}">
    <svg viewBox="0 0 36 40" aria-hidden="true"><polygon points="${x.pts}"/></svg><span>${x.tag}</span></a>`;
  const now = d.wing.order ? WING_ORDERS[d.wing.order] : "по обстановке";
  return `<div class="tb-hud-col tb-hud-wingx"><small title="Ведомые: ${esc(d.wing.names.join(", "))}">WING</small>
    <div class="tb-wx">${WING_CROSS.map(btn).join("")}<i class="tb-wx-hub"></i></div>
    <div class="tb-wx-now" title="Ведомые: ${esc(d.wing.names.join(", "))}">${esc(now)}${d.wing.spw ? " · SPW" : ""}</div></div>`;
}

function nemRow(d) {
  if (d.nem) {
    const n = d.nem;
    return `<div class="tb-hud-btns tb-hud-nem"><small title="Немезида">NEMESIS</small>
      <a class="tb-hud-nemlamp ${n.side} ${n.lock ? "lock" : ""}" data-hud-nem title="${n.lock ? "Немезида держит вас на захвате. " : ""}Показать на карте"><i class="fas fa-skull-crossbones"></i> ${esc(n.name)}${n.dist ? ` · ${n.dist}` : ""}</a>
      ${n.chips.map(c => `<span class="tb-hud-nemchip">${esc(c)}</span>`).join("")}
      ${n.trig.map(t => `<button type="button" class="tb-hud-nemtrig" data-hud-nemtrig="${t.id}" title="Триггер Немезиды: ${esc(STATE_TEXT[t.state])}">${esc(t.name)}</button>`).join("")}</div>`;
  }
  if (d.nemSelf) {
    const n = d.nemSelf;
    return `<div class="tb-hud-btns tb-hud-nem"><small title="Немезида">NEMESIS</small>
      <span class="tb-hud-nemlamp ${n.side}"><i class="fas fa-skull-crossbones"></i> ${n.who ? `враг: ${esc(n.who)}` : "пилот не выбран"}</span>
      <button type="button" class="tb-hud-nemtrig" data-hud-appear title="Заставка и реплика AWACS у всех, у её пилотов открываются триггеры Немезиды">ПОЯВЛЕНИЕ</button>
      <button type="button" class="tb-hud-nemtrig ${n.talking ? "on" : ""}" data-hud-mono title="${n.talking ? "Закончить монолог: кнопки ответа у игроков пропадут" : "Свободное действие: у пилотов появятся кнопки ответа триггерами Немезиды"}">${n.talking ? "КОНЕЦ МОНОЛОГА" : "МОНОЛОГ"}</button></div>`;
  }
  return "";
}

/** Дуга спидометра: 0…maxSpeed слева направо, стрелка на текущей Speed. */
function speedGauge(d) {
  const max = Math.max(1, d.maxSpeed), f = Math.max(0, Math.min(1, d.speed / max));
  const pt = (t, r) => { const a = Math.PI * (1 - t); return [60 + r * Math.cos(a), 58 - r * Math.sin(a)].map(v => v.toFixed(1)).join(" "); };
  const ticks = Array.from({ length: max + 1 }, (_, i) => `<line x1="${pt(i / max, 44).split(" ")[0]}" y1="${pt(i / max, 44).split(" ")[1]}" x2="${pt(i / max, 50).split(" ")[0]}" y2="${pt(i / max, 50).split(" ")[1]}"/>`).join("");
  const [nx, ny] = pt(f, 40).split(" ");
  return `<svg class="tb-hud-gauge" viewBox="0 0 120 64" aria-hidden="true">
      <path class="track" d="M ${pt(0, 50)} A 50 50 0 0 1 ${pt(1, 50)}"/>
      ${f > 0 ? `<path class="fill ${d.speed <= 0 ? "bad" : ""}" d="M ${pt(0, 50)} A 50 50 0 0 1 ${pt(f, 50)}"/>` : ""}
      <g class="ticks">${ticks}</g>
      <line class="needle ${d.speed <= 0 ? "bad" : ""}" x1="60" y1="58" x2="${nx}" y2="${ny}"/><circle class="hub" cx="60" cy="58" r="3"/>
    </svg>`;
}

/** Где на силуэте (в долях квадрата токена, нос вверху) пушка, пилоны и системы. */
const SPOTS = { gu: [[50, 7]], ms: [[17, 70], [83, 70]], sw: [[33, 60], [67, 60]], sw2: [[50, 68]], en: [[44, 92], [56, 92]], fl: [[28, 76], [72, 76]], ma: [[50, 36]] };
const at = ([x, y]) => `left:${x}%;top:${y}%`;

/** Схема машины сверху: силуэт самого токена, на нём пушка, ракеты и пилоны спецоружия (нажимаются) и отметки сломанной системы.
    Картинка обычным <img>: относительный путь в CSS-переменной браузер разрешает от файла стилей, и маска не грузилась. */
function fighter(d) {
  const off = k => d.systems.some(x => x.key === k && x.broken);
  const spw = d.weapons.slice(0, 2);
  const point = (cls, spots, attrs, title, label = "") => spots.map(p => `<a class="tb-hud-pt ${cls}" style="${at(p)}" ${attrs} title="${esc(title)}">${label}</a>`).join("");
  return `<div class="tb-hud-sil">
      ${d.img ? `<img src="${esc(d.img)}" alt="" draggable="false">` : ""}
      ${point(`gun ${off("gu") ? "dead" : ""}`, SPOTS.gu, `data-hud-act="guns"`, "Guns, Guns, Guns!")}
      ${point(`msl ${d.aimed ? "" : "aimed"} ${off("ms") ? "dead" : ""}`, SPOTS.ms, `data-hud-act="missile"`, "Fox Two! стандартной ракетой")}
      ${spw[0] ? point(`spw ${spw[0].aimed ? "aimed" : ""} ${spw[0].empty ? "empty" : ""} ${spw[0].winch ? "winch" : ""} ${off("sw") ? "dead" : ""}`, SPOTS.sw, `data-hud-spw="${spw[0].id}"`, `${spw[0].name} ${spw[0].ammo}: выбрать и пустить`) : ""}
      ${spw[1] ? point(`spw bomb ${spw[1].aimed ? "aimed" : ""} ${spw[1].empty ? "empty" : ""} ${spw[1].winch ? "winch" : ""} ${off("sw") ? "dead" : ""}`, SPOTS.sw2, `data-hud-spw="${spw[1].id}"`, `${spw[1].name} ${spw[1].ammo}: выбрать и пустить`) : ""}
      ${["en", "fl", "ma"].filter(off).map(k => point("hit", SPOTS[k], "", `${d.systems.find(x => x.key === k).jam ? "Заглушено РЭБ" : "Сломано"}: ${TB.systems[k].label} (${TB.systems[k].hint})`, "✕")).join("")}
    </div>`;
}

/** Пульт вооружения: станция на каждое оружие — лампа готовности, трафаретное имя, табло остатка, номер на панели макросов.
    Лампа зелёная — готово, жёлтая — выбрано прицелом, красная — система сломана, тёмная — пусто. Нажатие — пуск, как раньше. */
function weaponButtons(d) {
  const n = act => PILOT_BAR.indexOf(act) + 1;
  const pad = v => /^\d+$/.test(v) ? v.padStart(2, "0") : v;
  const station = ({ attrs, cls, code, cnt, key, title, tag }) =>
    `<button type="button" ${attrs} class="wpn st ${cls}" title="${esc(title)}"><i class="st-led"></i><span class="st-name">${esc(code)}</span><span class="st-cnt">${esc(cnt)}</span>${tag ? `<small class="st-trait">${esc(tag)}</small>` : ""}${key ? `<b class="st-key">${key}</b>` : ""}</button>`;
  const dead = sys => d.systems.some(x => x.key === sys && x.broken);
  return [
    station({ attrs: `data-hud-act="guns"`, cls: dead("gu") ? "dead" : "", code: "GUN", cnt: dead("gu") ? "FAIL" : "RDY", key: n("guns"), title: `Guns, Guns, Guns!${oddsLine(d.odds?.guns)}` }),
    station({ attrs: `data-hud-act="missile"`, cls: `${d.aimed ? "" : "aimed"} ${dead("ms") ? "dead" : ""}`, code: "FOX 2", cnt: dead("ms") ? "FAIL" : "RDY", key: n("missile"), title: `Fox Two! стандартной ракетой${oddsLine(d.odds?.missile)}` }),
    ...d.weapons.map(w => {
      const [ammo] = String(w.ammo).split("/");
      return station({ attrs: `data-hud-spw="${w.id}"`, cls: `spw ${w.aimed ? "aimed" : ""} ${w.empty ? "empty" : ""} ${w.winch ? "winch" : ""} ${dead("sw") ? "dead" : ""}`,
        code: w.name.split(" · ")[0], cnt: dead("sw") ? "FAIL" : pad(ammo), tag: w.trait?.tag,
        title: `${w.name} ${w.ammo}: выбрать и пустить${w.trait ? `\n${w.trait.name}. ${w.trait.text}` : ""}${oddsLine(d.odds?.[w.id])}` });
    })
  ].join("");
}

/** Системы машины: целые зелёным, сломанная (Structure) красным с подсказкой, что она отключает. */
function systemsStrip(d) {
  const SHORT = { en: "ДВГ", fl: "ЗКР", ma: "MAWS", ms: "РКТ", sw: "СПО", gu: "ПШК" };
  return `<div class="tb-hud-sys">${d.systems.map(x => `<span class="${x.broken ? "dead" : ""}${x.jam ? " jam" : ""}" title="${esc(x.label)}: ${x.jam ? `заглушено РЭБ противника, ${esc(x.hint)}` : x.broken ? `сломано, ${esc(x.hint)}` : "в порядке"}">${SHORT[x.key] ?? x.key}</span>`).join("")}</div>`;
}

/** Ручка катапульты: в полосе DOOM, её не спрятать ни размером панели, ни прокруткой. */
const ejectButton = `<button type="button" class="tb-hud-eject" data-hud-eject title="Бросок на катапультирование Push против 7: Strain добавится сам, если дотягивает, исход сразу в личное дело"><i class="fas fa-parachute-box"></i> КАТАПУЛЬТА</button>`;
/** Вторая судьба при Doom: героическая гибель с последними словами (как на карточке Doom). */
const heroButton = `<button type="button" class="tb-hud-eject hero" data-hud-hero title="Героическая гибель с последними словами: без броска, открывает «Победу любой ценой»"><i class="fas fa-skull"></i> DOOM</button>`;

function html(actor, d, folded) {
  const actBoxes = d.acts && d.acts.declared !== null
    ? Array.from({ length: Math.max(d.acts.declared, d.acts.used) }, (_, i) => `<span class="${i < d.acts.used ? "used" : ""}" title="${esc(d.acts.list[i] ?? "")}">${esc(d.acts.list[i]?.replace(/ \(заодно\)$/, "") ?? String(i + 1))}</span>`).join("")
    : d.acts?.canDeclare && actor.isOwner ? `<button type="button" class="tb-hud-declare" data-hud-declare="${d.acts.id}" title="Открыть заявку действий на этот раунд">ЗАЯВКА</button>`
    : `<span class="tb-hud-none">${d.acts ? "заявки ещё нет" : "вне боя"}</span>`;
  const button = (act, label) => {
    const n = PILOT_BAR.indexOf(act) + 1;
    return `<button type="button" data-hud-act="${act}" class="${act === "end" ? "end" : ""}">${n ? `<b>${n}</b> ` : ""}${label}</button>`;
  };
  // Strain восстанавливают только те, у кого он есть (у конскриптов его нет)
  const moves = Object.entries(BUTTONS).filter(([act]) => act !== "end" && (act !== "recover" || d.strain?.max > 0 || actor.type === "pilot")).map(([act, label]) => button(act, label)).join("");
  return `<header data-hud-fold title="Тащите шапку, чтобы передвинуть панель; щелчок сворачивает. Размер — за правый нижний угол">
      <b>${esc(d.name)}</b> <small>${esc(d.plane)}</small>
      ${d.warn.filter(w => !BIG.has(w.key)).map(w => `<span class="tb-hud-warn ${w.key}">${w.text}</span>`).join("")}
      ${d.acts?.turn ? `<span class="tb-hud-turn">ВАШ ХОД</span>` : ""}
      ${hlSwitch()}
      <a class="tb-hud-lay" data-hud-layout title="${corners() ? "Собрать HUD в одну панель" : "Разнести HUD по углам экрана"}"><i class="fas fa-${corners() ? "window-maximize" : "table-columns"}"></i></a>
      <a class="tb-hud-dock" data-hud-dock title="Вернуть панель на место над панелью макросов и к обычному размеру"><i class="fas fa-thumbtack"></i></a>
      <i class="fas fa-chevron-${folded ? "up" : "down"}"></i>
    </header>
    ${d.warn.filter(w => BIG.has(w.key)).map(w => `<div class="tb-hud-alert ${w.key}"><span>${w.key === "missile" ? "▲ " : ""}${w.text}${w.key === "missile" ? " ▲" : ""}</span><small>${BIG_HINT[w.key]}</small>${w.key === "doom" && d.canEject ? `<span class="tb-hud-fate">${ejectButton}${heroButton}</span>` : ""}${w.key === "stall" ? stallButton(d) : ""}</div>`).join("")}
    ${rollPlateHtml(d)}
    ${folded ? "" : `<div class="tb-hud-grid${d.wing ? " wing" : ""}">
      <div class="tb-hud-col tb-hud-stat">
        <div class="tb-hud-row"><small>HP</small><span class="tb-hud-pips hp ${d.hp.value <= 1 ? "low" : ""}">${pips(d.hp.value, d.hp.max)}</span><span class="tb-hud-num">${d.hp.value}/${d.hp.max}</span></div>
        ${d.strain?.max ? `<div class="tb-hud-row"${d.strainPool ? ` title="Запас Strain эскадрильи"` : ""}><small>${d.strainPool ? "ЗАПАС" : "STRAIN"}</small><span class="tb-hud-pips strain">${pips(d.strain.value, d.strain.max)}</span><span class="tb-hud-num">${d.strain.value}/${d.strain.max}</span></div>` : ""}
        <div class="tb-hud-row"><small>DEF</small><span class="tb-hud-def">${d.defense ?? "—"}</span>
          <small class="tb-hud-lbl2">ЗАХВАТ</small>${d.lock ? `<a class="tb-hud-lock ${d.lock.gone ? "gone" : ""}" data-hud-lock title="Показать цель на карте"><i class="fas fa-crosshairs"></i> ${esc(d.lock.name)}${d.lock.dist ? ` · ${d.lock.dist}` : ""}${d.lock.gone ? " · нет на сцене" : ""}</a>` : `<span class="tb-hud-none">нет</span>`}</div>
        <div class="tb-hud-row"><small>СИСТ.</small>${systemsStrip(d)}</div>
        ${d.grit ? `<div class="tb-hud-grit" title="Метка Grit: навык недоступен до конца вылета">GRIT · ${esc(d.grit)} отключён</div>` : ""}
      </div>
      <div class="tb-hud-col tb-hud-speed">
        <div class="tb-hud-dial">${speedGauge(d)}</div>
        <div class="tb-hud-readout"><a data-hud-speed="-1" title="Сбросить скорость (Change Speed)">−</a><span><b class="${d.speed <= 0 ? "bad" : ""}">${d.speed}</b><em>/${d.maxSpeed}</em></span><a data-hud-speed="1" title="Прибавить скорость (Change Speed)">+</a></div>
        <div class="tb-hud-kmh" title="Доля максимума машины (${d.vmax} км/ч) по Speed">${d.speed <= 0 ? "сваливание" : `${d.kmh} км/ч · M${d.mach}`}</div>
      </div>
      <div class="tb-hud-col tb-hud-alt">
        <a class="tb-hud-altbtn up" data-hud-alt="1" title="Набрать высоту (Climb)">▲</a>
        <a class="tb-hud-altbtn down" data-hud-alt="-1" title="Снизиться (Dive)">▼</a>
        <ol>${d.alts.map(a => `<li class="${a.on ? "on" : ""} ${a.can ? "" : "off"}" ${a.can ? `data-hud-alt-to="${a.key}"` : ""} title="${a.can ? `${a.label}` : `${a.label}: выше потолка машины`}"><span>${esc(a.label)}</span><em>${a.m.toLocaleString("ru")} м</em></li>`).join("")}</ol>
      </div>
      <div class="tb-hud-col tb-hud-arm">${fighter(d)}</div>
      <div class="tb-hud-col tb-hud-ctl">
        <div class="tb-hud-btns tb-hud-wpns"><small title="Пульт вооружения">STORES</small>${weaponButtons(d)}</div>
        <div class="tb-hud-btns tb-hud-moves"><small>МАНЁВР</small>${moves}${d.ident ? `<button type="button" data-hud-act="ident" class="ident" title="Опознать захваченный контакт: Aim против 7, проверка хода (Стрэйнджриал 9.6)">ОПОЗН</button>` : ""}</div>
        <div class="tb-hud-btns tb-hud-acts${d.acts?.turn ? " turn" : ""}" title="Действия хода${d.acts?.rolled ? " · бросок уже был" : ""}"><small>ХОД</small>${actBoxes}${d.acts?.rolled ? `<i class="fas fa-dice-d10" title="Бросок за ход уже был"></i>` : ""}${button("end", BUTTONS.end)}</div>
        ${d.roll && (d.roll.d10 === null || d.roll.d10 === undefined) ? rollRowHtml(d) : ""}
        ${planeRowHtml(d.planeRow)}
        ${actor.type === "npc" ? aceRowHtml(actor) : ""}
        ${actor.type === "npc" ? squadRowHtml(actor) : ""}
        ${ctRow(d)}
        ${nemRow(d)}
        ${actor.type === "npc" ? adviceRow(actor) : ""}
      </div>
      ${wingCross(d)}
    </div>`}`;
}

/** HUD разнесён по углам экрана (настройка «Вид HUD пилота»). */
export const corners = () => { try { return game.settings.get(SYSTEM_ID, "hudLayout") !== "panel"; } catch { return true; } };

/** Разметка HUD для актёра (для тестов и проверки вида). */
export const hudHtml = (actor, folded = false) => html(actor, hudData(actor), folded);

/** Получила ли машина урон: HP упало или прибавилась метка (на метке HP восстанавливается, по нему удар не видно),
    а это та же машина (смена машины в HUD — не удар). */
export const tookHit = (prev, now) => !!prev && prev.uuid === now.uuid && (now.hp < prev.hp || (now.marks ?? 0) > (prev.marks ?? 0));
/** Что сравнивать между перерисовками HUD: HP и число меток Grit, Structure, Doom. */
export const hitSign = actor => ({ uuid: actor.uuid, hp: Number(actor.system.hp?.value ?? 0), marks: ["grit", "structure", "doom"].filter(k => actor.system.markers?.[k]).length });

/* Удар по своей машине, как в Ace Combat: символика HUD краснеет, идёт горизонтальной рябью помех и вздрагивает;
   при метке Doom HUD остаётся красным и медленно мерцает. Края экрана не трогаю. */
let lastHp = null, hitTimer = null, rippleSvg = null;
const flashOn = () => { try { return game.settings.get(SYSTEM_ID, "hitFlash") !== false; } catch { return true; } };
const HIT_MS = 900;
/** Сила ряби в момент k (0..1 от начала удара): резкий всплеск и затухание с подёргиваниями. */
export const rippleAt = k => (k <= 0 || k >= 1 ? 0 : Math.round(26 * (k < 0.08 ? k / 0.08 : Math.pow(1 - (k - 0.08) / 0.92, 1.6)) * (0.75 + 0.25 * Math.abs(Math.sin(k * 37)))));
/** SVG-фильтр ряби: шум полосами по горизонтали сдвигает символику вбок; рисую один раз. */
function ripple() {
  if (rippleSvg?.isConnected) return rippleSvg;
  rippleSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  rippleSvg.setAttribute("width", "0"); rippleSvg.setAttribute("height", "0");
  rippleSvg.style.cssText = "position:absolute;width:0;height:0;pointer-events:none";
  rippleSvg.innerHTML = `<filter id="tb-hud-ripple" x="-5%" y="-10%" width="110%" height="120%" color-interpolation-filters="sRGB">
    <feTurbulence type="fractalNoise" baseFrequency="0.004 0.18" numOctaves="1" seed="3" result="n"/>
    <feColorMatrix in="n" type="matrix" values="1 0 0 0 0  0 0 0 0 0.5  0 0 0 0 0  0 0 0 0 1" result="d"/>
    <feDisplacementMap in="SourceGraphic" in2="d" scale="0" xChannelSelector="R" yChannelSelector="G"/></filter>`;
  document.body.append(rippleSvg);
  return rippleSvg;
}
function hitFlash() {
  if (!flashOn() || !el) return;
  const svg = ripple(), map = svg.querySelector("feDisplacementMap"), noise = svg.querySelector("feTurbulence");
  clearTimeout(hitTimer);
  el.classList.remove("hit"); void el.offsetWidth; el.classList.add("hit", "red");
  const t0 = performance.now();
  const step = now => {
    const k = (now - t0) / HIT_MS;
    if (!el || k >= 1) { map.setAttribute("scale", "0"); return; }
    map.setAttribute("scale", String(rippleAt(k)));
    // полосы помех бегут: шум каждый кадр чуть другой
    noise.setAttribute("seed", String(1 + Math.floor(k * 14)));
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
  hitTimer = setTimeout(() => { if (!el) return; el.classList.remove("hit"); el.classList.toggle("red", el.classList.contains("doom")); }, HIT_MS);
}
function setDoom(on) {
  if (!el) return;
  const doom = !!on && flashOn();
  el.classList.toggle("doom", doom);
  if (!el.classList.contains("hit")) el.classList.toggle("red", doom);
}
/* Попадание, которое ещё ждёт выбора метки: HUD уже вздрогнул, метка потом не трясёт его второй раз. */
let earlyHit = null;
const EARLY_MS = 120000;
function onEarlyHit(actor) {
  if (!el || !shown || actor?.uuid !== shown.uuid) return;
  earlyHit = { uuid: actor.uuid, t: performance.now() };
  hitFlash();
}
function watchHits(actor) {
  if (!actor) { lastHp = null; return; }
  const now = hitSign(actor);
  setDoom(!!actor.system.markers?.doom);
  if (tookHit(lastHp, now)) {
    const early = earlyHit?.uuid === now.uuid && performance.now() - earlyHit.t < EARLY_MS;
    earlyHit = null;
    if (!early) hitFlash();
  }
  lastHp = now;
}

function render() {
  const actor = game.settings.get(SYSTEM_ID, "pilotHud") && game.combat?.started && (!game.combat.scene || game.combat.scene.id === canvas?.scene?.id) ? hudActor() : null;
  if (!actor || !tokenOf(actor)) { el?.remove(); el = null; shown = null; lastHtml = ""; watchHits(null); return; }
  shown = actor;
  let folded = false;
  try { folded = localStorage.getItem(FOLD_KEY) === "1"; } catch (err) { /* хранилище недоступно */ }
  if (!el) {
    el = document.createElement("section");
    el.id = "tb-pilot-hud";
    el.className = "thunderbolt tb-hud";
    el.addEventListener("click", onClick);
    el.addEventListener("pointerdown", startDrag);
    const pos = readPos();
    if (pos.w) el.style.width = `${pos.w}px`;
    if (pos.h) el.style.height = `${pos.h}px`;
    document.body.append(el);
    // размер тянут за правый нижний угол: браузер пишет его в style, его и запоминаю; панель при этом стоит на месте
    let saveTimer = null;
    new ResizeObserver(() => {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        if (!el) return;
        const w = parseInt(el.style.width), h = parseInt(el.style.height);
        if (!w && !h) return;
        const r = el.getBoundingClientRect(), pos = readPos();
        writePos({ x: pos.x ?? Math.round(r.left), y: pos.y ?? Math.round(r.top), w: w || pos.w, h: h || pos.h });
        place();
      }, 250);
    }).observe(el);
  }
  el.classList.toggle("folded", folded);
  el.classList.toggle("pinned", readPos().x !== undefined);
  el.classList.toggle("tb-unit-hud", !hudFits(actor));
  el.classList.toggle("corners", corners() && hudFits(actor));
  watchHits(actor);
  const markup = hudFits(actor) ? html(actor, hudData(actor), folded) : unitHtml(actor, folded);
  // та же разметка: не трогать DOM и не пересчитывать раскладку
  if (markup === lastHtml) return;
  lastHtml = markup;
  el.innerHTML = markup;
  place();
  rollFx();
}

/* Новое табло броска: d10 «катится» полсекунды и замирает на выпавшем; бросок без Strain уходит с HUD сам. */
let rolledId = null, rollHide = null;
function rollFx() {
  const plate = el?.querySelector(".tb-hud-rollplate");
  const id = plate?.dataset.rollId ?? null;
  clearTimeout(rollHide);
  const left = shown ? strainRoll(shown)?.left : null;
  if (left) rollHide = setTimeout(() => { lastHtml = ""; refreshHud(); }, left + 100);
  if (!plate || id === rolledId) return;
  rolledId = id;
  plate.classList.add("fresh");
  const die = plate.querySelector(".d10"), real = die?.textContent;
  if (!die || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  const t0 = performance.now();
  const spin = now => {
    if (!die.isConnected) return;
    if (now - t0 > 520) { die.textContent = real; die.classList.add("land"); return; }
    die.textContent = String(1 + Math.floor(Math.random() * 10));
    requestAnimationFrame(spin);
  };
  requestAnimationFrame(spin);
}
let lastHtml = "";

/** Где игрок оставил панель в этом браузере: { x, y, w, h } (пусто — по центру над панелью макросов). */
let posCache = null;
function readPos() {
  if (posCache) return { ...posCache };
  try { posCache = JSON.parse(localStorage.getItem(POS_KEY) ?? "{}") ?? {}; } catch (err) { posCache = {}; }
  return { ...posCache };
}
function writePos(pos) {
  posCache = { ...pos };
  try { localStorage.setItem(POS_KEY, JSON.stringify(pos)); } catch (err) { /* хранилище недоступно */ }
}

/** Свою позицию держит панель, которую двигали или тянули; иначе она по центру над панелью макросов. В окно она влезает всегда. */
function place() {
  if (!el) return;
  if (el.classList.contains("corners")) return placeCorners();
  el.style.right = "";
  const pos = readPos();
  el.style.width = pos.w ? `${pos.w}px` : "";
  el.style.height = pos.h ? `${pos.h}px` : "";
  const w = el.offsetWidth, h = el.offsetHeight;
  if (pos.x !== undefined) {
    el.style.left = `${Math.max(0, Math.min(window.innerWidth - Math.min(w, 120), pos.x))}px`;
    el.style.top = `${Math.max(0, Math.min(window.innerHeight - 30, pos.y))}px`;
    el.style.bottom = "auto";
    return;
  }
  const bar = document.getElementById("hotbar")?.getBoundingClientRect();
  const mid = bar && bar.width ? bar.left + bar.width / 2 : window.innerWidth / 2;
  el.style.left = `${Math.max(8, Math.min(window.innerWidth - w - 8, Math.round(mid - w / 2)))}px`;
  el.style.top = "auto";
  el.style.bottom = `${bar && bar.height ? Math.max(8, window.innerHeight - bar.top + 8) : 70}px`;
}

/** Видимый прямоугольник окна Foundry или null (спрятано боевым экраном, свёрнуто, нет на странице). */
function shownRect(id) {
  const n = document.getElementById(id);
  if (!n || n.offsetParent === null) return null;
  const r = n.getBoundingClientRect();
  return r.width && r.height ? r : null;
}

/** HUD по углам: от инструментов слева до чата справа, у нижнего края. Сам HUD прозрачен, ловят щелчки только приборы.
    Игроков и панель макросов внизу обходит каждая группа приборов сама (liftOf), а не весь HUD целиком. */
export function cornerBox(win, { sidebar = null, controls = null } = {}) {
  const left = Math.max(16, controls ? controls.right + 12 : 0);
  const right = sidebar ? Math.max(16, win.w - sidebar.left + 12) : 16;
  return { left, right, bottom: 12 };
}

/** На сколько поднять группу приборов [x0, x1], чтобы она встала над окнами внизу экрана (игроки, панель макросов), которые под ней. */
export function liftOf(x0, x1, obstacles, h, base = 12) {
  let bottom = base;
  for (const o of obstacles) if (o && o.left < x1 && o.right > x0) bottom = Math.max(bottom, h - o.top + 8);
  return bottom - base;
}

/* Сколько места (до масштаба) нужно раскладкам HUD по углам: колонки, поля и промежутки; крест ведомых — ещё столько же */
const FIT_NEED = { full: 1290, compact: 1160, narrow: 1030 }, WING_NEED = 190;
/** Раскладка под ширину: full, compact (уже колонки, силуэт на месте), narrow (уже колонки и без силуэта), stack (кнопки под приборами). */
export function fitOf(width, zoom = 1, wing = false) {
  const w = width / (zoom || 1) - (wing ? WING_NEED : 0);
  return w >= FIT_NEED.full ? "full" : w >= FIT_NEED.compact ? "compact" : w >= FIT_NEED.narrow ? "narrow" : "stack";
}
/** Масштаб по углам: выбранный, но если с ним кнопки ушли бы под приборы, а мельче (не меньше 100%) влезают в строку — мельче. */
export function fitZoom(width, zoom, wing = false) {
  if (fitOf(width, zoom, wing) !== "stack") return zoom;
  const z = Math.floor(width / (FIT_NEED.narrow + (wing ? WING_NEED : 0)) * 100) / 100;
  return Math.max(1, Math.min(zoom, z));
}
const zoomNow = () => { try { const z = Number(game.settings.get(SYSTEM_ID, "hudScale")); return z > 0.5 && z < 2 ? z : 1.15; } catch { return 1.15; } };

const LEFT_COLS = ".tb-hud-stat, .tb-hud-speed, .tb-hud-alt", RIGHT_COLS = ".tb-hud-arm, .tb-hud-ctl, .tb-hud-wingx";
/** Крайние x видимых колонок группы или null. */
function spanOf(sel) {
  const rs = [...el.querySelectorAll(sel)].map(n => n.getBoundingClientRect()).filter(r => r.width);
  return rs.length ? [Math.min(...rs.map(r => r.left)), Math.max(...rs.map(r => r.right))] : null;
}

function placeCorners() {
  const win = { w: window.innerWidth, h: window.innerHeight };
  const b = cornerBox(win, { sidebar: shownRect("sidebar"), controls: shownRect("controls") });
  const wing = !!el.querySelector(".tb-hud-grid.wing"), width = win.w - b.left - b.right, z = fitZoom(width, zoomNow(), wing);
  el.style.setProperty("--tb-hud-zoom", String(z));
  el.dataset.fit = fitOf(width, z, wing);
  Object.assign(el.style, { left: `${b.left}px`, right: `${b.right}px`, bottom: `${b.bottom}px`, top: "auto", width: "auto", height: "auto" });
  // левая и правая группы приборов поднимаются над игроками и панелью макросов каждая сама, только если те под ней
  el.style.setProperty("--tb-hud-lift-l", "0px");
  el.style.setProperty("--tb-hud-lift-r", "0px");
  const below = [shownRect("players"), shownRect("hotbar")].filter(Boolean);
  if (!below.length) return;
  for (const [sel, v] of [[LEFT_COLS, "--tb-hud-lift-l"], [RIGHT_COLS, "--tb-hud-lift-r"]]) {
    const span = spanOf(sel), lift = span ? liftOf(span[0], span[1], below, win.h, b.bottom) : 0;
    el.style.setProperty(v, `${Math.round(lift / z)}px`);
  }
}

/** Перетаскивание за шапку: короткий щелчок по ней по-прежнему сворачивает панель. */
let dragged = false;
function startDrag(ev) {
  if (el?.classList.contains("corners")) return;
  if (ev.button !== 0 || !ev.target.closest("header") || ev.target.closest("[data-hud-dock], [data-hud-hl]")) return;
  const r = el.getBoundingClientRect(), dx = ev.clientX - r.left, dy = ev.clientY - r.top, x0 = ev.clientX, y0 = ev.clientY;
  dragged = false;
  const move = e => {
    if (!dragged && Math.hypot(e.clientX - x0, e.clientY - y0) < 4) return;
    dragged = true;
    el.classList.add("dragging", "pinned");
    el.style.left = `${Math.max(0, Math.min(window.innerWidth - 60, e.clientX - dx))}px`;
    el.style.top = `${Math.max(0, Math.min(window.innerHeight - 30, e.clientY - dy))}px`;
    el.style.bottom = "auto";
  };
  const up = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    el?.classList.remove("dragging");
    if (dragged && el) writePos({ ...readPos(), x: parseInt(el.style.left), y: parseInt(el.style.top) });
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
}

/** Вернуть панель на место по умолчанию и к исходному размеру. */
function dock() {
  posCache = {};
  try { localStorage.removeItem(POS_KEY); } catch (err) { /* хранилище недоступно */ }
  if (!el) return;
  el.style.width = el.style.height = "";
  el.classList.remove("pinned");
  place();
}

async function onClick(ev) {
  if (ev.target.closest("[data-hud-dock]")) { ev.preventDefault(); ev.stopPropagation(); return dock(); }
  if (ev.target.closest("[data-hud-layout]")) { ev.preventDefault(); ev.stopPropagation(); return game.settings.set(SYSTEM_ID, "hudLayout", corners() ? "panel" : "corners"); }
  const hl = ev.target.closest("[data-hud-hl]");
  if (hl) { ev.preventDefault(); ev.stopPropagation(); return setHlMode(hl.dataset.hudHl); }
  if (dragged && ev.target.closest("header")) { dragged = false; return; }
  const t = ev.target.closest("[data-u-sam], [data-u-gun], [data-u-hp], [data-u-scale], [data-u-flag], [data-u-count], [data-u-launch], [data-u-strike], [data-hud-eject], [data-hud-hero], [data-hud-act], [data-hud-spw], [data-hud-speed], [data-hud-alt], [data-hud-alt-to], [data-hud-lock], [data-hud-fold], [data-hud-nem], [data-hud-nemtrig], [data-hud-ctrig], [data-hud-appear], [data-hud-mono], [data-hud-adv], [data-hud-adv-target], [data-hud-move], [data-hud-aoa], [data-hud-booster], [data-hud-deck], [data-hud-tactic], [data-hud-ace], [data-hud-wing], [data-hud-strain], [data-hud-strain-n], [data-hud-stall], [data-hud-declare]");
  if (!t || !shown) return;
  ev.preventDefault();
  const d = t.dataset, actor = shown;
  if (d.hudFold !== undefined) {
    try { localStorage.setItem(FOLD_KEY, el.classList.contains("folded") ? "0" : "1"); } catch (err) { /* хранилище недоступно */ }
    return render();
  }
  if (d.hudLock !== undefined) {
    const tok = tokenOf(resolveActor(actor.system.lockUuid));
    if (tok) canvas.animatePan({ x: tok.center.x, y: tok.center.y, duration: 400 });
    return;
  }
  if (d.hudNem !== undefined) {
    const tok = tokenOf(resolveActor(hudNemesis(actor)?.uuid));
    if (tok) canvas.animatePan({ x: tok.center.x, y: tok.center.y, duration: 400 });
    return;
  }
  if (!actor.isOwner) return ui.notifications.warn(`«${actor.name}» вам не принадлежит.`);
  if (d.hudNemtrig) return useTrigger(actor, actor.items.get(d.hudNemtrig));
  if (d.hudCtrig) return useCombatTrigger(actor, actor.items.get(d.hudCtrig));
  if (d.hudStall) { const m = game.messages.get(d.hudStall), c = m?.getFlag(SYSTEM_ID, "card"); return c ? onCardAction(m, computeCard(c).success ? "stall-ok" : "stall-fail") : null; }
  // заявка закрыта «Позже», а трекер спрятан боевым экраном: открыть её снова прямо из HUD
  if (d.hudDeclare) return game.combat?.rollInitiative([d.hudDeclare], { updateTurn: false });
  if (d.hudStrain) { const m = game.messages.get(d.hudStrain); return m ? onCardAction(m, "strain") : null; }
  if (d.hudStrainN) {
    // «+N до успеха»: N раз по 1 Strain, как N нажатий «+1»
    const [id, n] = d.hudStrainN.split(":"), m = game.messages.get(id);
    if (!m) return null;
    t.disabled = true;
    return (async () => { for (let k = 0; k < (Number(n) || 0); k++) await onCardAction(game.messages.get(id), "strain"); })();
  }
  if (d.hudMove !== undefined) return useMove(actor);
  if (d.hudAoa !== undefined) return useAoa(actor);
  if (d.hudBooster !== undefined) return pickBooster(actor);
  if (d.hudDeck !== undefined) return useDeck(actor);
  if (d.hudWing) return giveWingOrder(actor, d.hudWing);
  if (d.hudTactic) return useTactic(actor.system.squad, d.hudTactic, actor);
  if (d.hudAce !== undefined) return aceClick(actor, d.hudAce);
  if (d.hudAdvTarget !== undefined) return showTarget(actor);
  if (d.hudAdv !== undefined) return runAdvice(actor, d.hudAdv);
  if (d.hudAppear !== undefined) return appear(actor);
  if (d.hudMono !== undefined) return monologue()?.uuid === actor.uuid ? endMonologue() : startMonologue(actor);
  if (!hudFits(actor) && await onUnitClick(t, actor)) return;
  if (d.hudEject !== undefined) return ejectNow(actor);
  if (d.hudHero !== undefined) return heroNow(actor);
  // скорость и высота как на листе и в меню токена: действие засчитывают хуки actions.mjs
  if (d.hudSpeed) {
    const v = Math.min(hudData(actor).maxSpeed, actor.system.speed + Number(d.hudSpeed));
    if (v !== actor.system.speed) await actor.update({ "system.speed": v });
    return;
  }
  if (d.hudAlt || d.hudAltTo) {
    const cur = ALT_ORDER.indexOf(altOf(tokenOf(actor), actor));
    const delta = d.hudAlt ? Number(d.hudAlt) : Math.sign(ALT_ORDER.indexOf(d.hudAltTo) - cur);
    if (delta) await stepAltitude(tokenOf(actor), delta);
    return;
  }
  // НУР и пушечные контейнеры стреляют как пушка: без захвата, сразу пульт Guns с этой станцией
  const spw = d.hudSpw ? actor.items.get(d.hudSpw) : null;
  if (spw && isGunPod(spw)) return runAction(actor, "guns", { pod: spw.id });
  // EMRG и ESM без захвата: сразу своё окно (линия, система)
  if (spw && isOwnFire(spw)) return runAction(actor, "missile", { weapon: spw.id });
  // ракеты: стандартная снимает прицел со спецоружия, пилон спецоружия наводит его и сразу открывает пуск
  if (d.hudSpw || d.hudAct === "missile") {
    const aim = aimedWeapon(actor)?.id ?? null, want = d.hudSpw ?? null;
    if (aim !== want) toggleAim(actor, want ?? aim);
    refreshHud();
    return runAction(actor, "missile");
  }
  if (d.hudAct === "end") return endTurn(actor);
  return runAction(actor, d.hudAct);
}
