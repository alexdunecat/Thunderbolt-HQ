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
import { ejectNow, weaponReady, isGunPod, isOwnFire } from "./dice/rolls.mjs";
import { unitKind, unitHtml, onUnitClick, registerUnitHud } from "./unit-hud.mjs";
import { hudTriggers, useCombatTrigger } from "./combat-triggers.mjs";
import { adviceRow, runAdvice, showTarget } from "./npc-advice.mjs";
import { hudPlane, planeRowHtml, useMove, useAoa, pickBooster, useDeck } from "./plane-roles.mjs";
import { poolOf, squadRowHtml, useTactic } from "./duelists.mjs";
import { aceRowHtml, aceClick } from "./ace-play.mjs";
import { justEmptied } from "./winchester.mjs";
import { wingmenOf, wingOrderOf, wingSpwOf, giveWingOrder, WING_ORDERS, WING_SPW } from "./autopilot.mjs";
import { hudNemesis, isNemesis, pilotsOf, monologue, startMonologue, endMonologue, appear, useTrigger, STATE_TEXT } from "./nemesis.mjs";

const FOLD_KEY = `${SYSTEM_ID}.hudFolded`, POS_KEY = `${SYSTEM_ID}.hudPos`;
const BIG = new Set(["missile", "lock", "doom"]);
const BIG_HINT = { missile: "ракета в воздухе: Break! или смена высоты", lock: "вас держат на захвате", doom: "машина обречена: катапульта или героическая гибель" };
const BUTTONS = { lock: "Lock On", break: "Break", lead: "Lead", formup: "Вплотную", recover: "Strain", end: "Конец хода" };
let el = null, timer = null, shown = null;

export function registerHud() {
  game.settings.register(SYSTEM_ID, "pilotHud", {
    name: "HUD пилота", hint: "Полоса внизу экрана в бою: HP, Strain, Speed, высота, действия хода, захват, спецоружие и предупреждения, кнопки действий.",
    scope: "client", config: true, type: Boolean, default: true, onChange: () => refreshHud()
  });
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
  globalThis.window?.addEventListener("resize", () => place());
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
    acts: c ? { declared, used: spent.used, rolled: spent.rolled, list: spent.list, turn: c.parent.combatant?.id === c.id } : null,
    lock: s.lockUuid || s.lock ? { name: target?.token?.name ?? tTok?.name ?? target?.name ?? s.lock, uuid: s.lockUuid, gone: !tTok,
      dist: dist === null ? "" : dist === 0 ? "своя зона" : `${dist} ${dist === 1 ? "зона" : dist < 5 ? "зоны" : "зон"}` } : null,
    weapons, aimed: aim, warn,
    // Немезида: у пилота — лампа с именем, дальностью и тем, что действует; у ведущего на её машине — «Появление» и «Монолог»
    nem: pilot ? hudNemesis(actor) : null,
    // боевые триггеры: что можно задействовать сейчас и что действует
    ct: pilot ? hudTriggers(actor) : null,
    // роль машины, лампы свойств, Angle of Attack Limiter и фирменный приём
    planeRow: hudPlane(actor),
    // ведомые на автопилоте за этой машиной: приказы им
    wing: hudWing(actor),
    nemSelf: !pilot && isNemesis(actor) && game.user.isGM
      ? { side: s.side === "ally" || s.side === "neutral" ? s.side : "enemy", who: pilotsOf(actor).map(p => p.system.callsign || p.name).join(", "), talking: monologue()?.uuid === actor.uuid } : null
  };
}

/** Строка боевых триггеров в HUD: кнопки «задействовать» и то, что действует. */
function ctRow(d) {
  if (!d.ct) return "";
  return `<div class="tb-hud-btns tb-hud-ct"><small title="Боевые триггеры">TRIG</small>
    ${d.ct.chips.map(c => `<span class="tb-hud-ctchip">${esc(c)}</span>`).join("")}
    ${d.ct.trig.map(t => `<button type="button" class="tb-hud-cttrig" data-hud-ctrig="${t.id}" title="${esc(t.hint)}">${esc(t.name)}</button>`).join("")}</div>`;
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
    station({ attrs: `data-hud-act="guns"`, cls: dead("gu") ? "dead" : "", code: "GUN", cnt: dead("gu") ? "FAIL" : "RDY", key: n("guns"), title: "Guns, Guns, Guns!" }),
    station({ attrs: `data-hud-act="missile"`, cls: `${d.aimed ? "" : "aimed"} ${dead("ms") ? "dead" : ""}`, code: "FOX 2", cnt: dead("ms") ? "FAIL" : "RDY", key: n("missile"), title: "Fox Two! стандартной ракетой" }),
    ...d.weapons.map(w => {
      const [ammo] = String(w.ammo).split("/");
      return station({ attrs: `data-hud-spw="${w.id}"`, cls: `spw ${w.aimed ? "aimed" : ""} ${w.empty ? "empty" : ""} ${w.winch ? "winch" : ""} ${dead("sw") ? "dead" : ""}`,
        code: w.name.split(" · ")[0], cnt: dead("sw") ? "FAIL" : pad(ammo), tag: w.trait?.tag,
        title: `${w.name} ${w.ammo}: выбрать и пустить${w.trait ? `\n${w.trait.name}. ${w.trait.text}` : ""}` });
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

function html(actor, d, folded) {
  const actBoxes = d.acts && d.acts.declared !== null
    ? Array.from({ length: Math.max(d.acts.declared, d.acts.used) }, (_, i) => `<span class="${i < d.acts.used ? "used" : ""}" title="${esc(d.acts.list[i] ?? "")}">${esc(d.acts.list[i]?.replace(/ \(заодно\)$/, "") ?? String(i + 1))}</span>`).join("")
    : `<span class="tb-hud-none">${d.acts ? "заявки ещё нет" : "вне боя"}</span>`;
  const button = (act, label) => {
    const n = PILOT_BAR.indexOf(act) + 1;
    return `<button type="button" data-hud-act="${act}" class="${act === "end" ? "end" : ""}">${n ? `<b>${n}</b> ` : ""}${label}</button>`;
  };
  const moves = Object.entries(BUTTONS).filter(([act]) => act !== "end").map(([act, label]) => button(act, label)).join("");
  return `<header data-hud-fold title="Тащите шапку, чтобы передвинуть панель; щелчок сворачивает. Размер — за правый нижний угол">
      <b>${esc(d.name)}</b> <small>${esc(d.plane)}</small>
      ${d.warn.filter(w => !BIG.has(w.key)).map(w => `<span class="tb-hud-warn ${w.key}">${w.text}</span>`).join("")}
      ${d.acts?.turn ? `<span class="tb-hud-turn">ВАШ ХОД</span>` : ""}
      ${hlSwitch()}
      <a class="tb-hud-dock" data-hud-dock title="Вернуть панель на место над панелью макросов и к обычному размеру"><i class="fas fa-thumbtack"></i></a>
      <i class="fas fa-chevron-${folded ? "up" : "down"}"></i>
    </header>
    ${d.warn.filter(w => BIG.has(w.key)).map(w => `<div class="tb-hud-alert ${w.key}"><span>${w.key === "missile" ? "▲ " : ""}${w.text}${w.key === "missile" ? " ▲" : ""}</span><small>${BIG_HINT[w.key]}</small>${w.key === "doom" && d.canEject ? ejectButton : ""}</div>`).join("")}
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
        <div class="tb-hud-btns"><small>МАНЁВР</small>${moves}</div>
        <div class="tb-hud-btns tb-hud-acts" title="Действия хода${d.acts?.rolled ? " · бросок уже был" : ""}"><small>ХОД</small>${actBoxes}${d.acts?.rolled ? `<i class="fas fa-dice-d10" title="Бросок за ход уже был"></i>` : ""}${button("end", BUTTONS.end)}</div>
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

/** Разметка HUD для актёра (для тестов и проверки вида). */
export const hudHtml = (actor, folded = false) => html(actor, hudData(actor), folded);

function render() {
  const actor = game.settings.get(SYSTEM_ID, "pilotHud") && game.combat?.started && (!game.combat.scene || game.combat.scene.id === canvas?.scene?.id) ? hudActor() : null;
  if (!actor || !tokenOf(actor)) { el?.remove(); el = null; shown = null; lastHtml = ""; return; }
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
  const markup = hudFits(actor) ? html(actor, hudData(actor), folded) : unitHtml(actor, folded);
  // та же разметка: не трогать DOM и не пересчитывать раскладку
  if (markup === lastHtml) return;
  lastHtml = markup;
  el.innerHTML = markup;
  place();
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
  const pos = readPos(), w = el.offsetWidth, h = el.offsetHeight;
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

/** Перетаскивание за шапку: короткий щелчок по ней по-прежнему сворачивает панель. */
let dragged = false;
function startDrag(ev) {
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
  const hl = ev.target.closest("[data-hud-hl]");
  if (hl) { ev.preventDefault(); ev.stopPropagation(); return setHlMode(hl.dataset.hudHl); }
  if (dragged && ev.target.closest("header")) { dragged = false; return; }
  const t = ev.target.closest("[data-u-sam], [data-u-gun], [data-u-hp], [data-u-scale], [data-u-flag], [data-u-count], [data-u-launch], [data-u-strike], [data-hud-eject], [data-hud-act], [data-hud-spw], [data-hud-speed], [data-hud-alt], [data-hud-alt-to], [data-hud-lock], [data-hud-fold], [data-hud-nem], [data-hud-nemtrig], [data-hud-ctrig], [data-hud-appear], [data-hud-mono], [data-hud-adv], [data-hud-adv-target], [data-hud-move], [data-hud-aoa], [data-hud-booster], [data-hud-deck], [data-hud-tactic], [data-hud-ace], [data-hud-wing]");
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
