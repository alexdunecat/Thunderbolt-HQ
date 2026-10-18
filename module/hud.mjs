/* HUD пилота: полоса внизу экрана над панелью макросов, как приборы в Ace Combat.
   Слева HP и Strain делениями, в центре Speed, высота и действия хода, справа захват, спецоружие и предупреждения,
   снизу кнопки действий с номерами панели макросов. Видна в бою, когда самолёт игрока стоит на сцене;
   у ведущего показывает выделенный токен. Сворачивается щелчком по шапке, выключается в настройках клиента. */
import { SYSTEM_ID, TB } from "./config.mjs";
import { esc, resolveActor } from "./utils.mjs";
import { tokenOf, weatherAt, defenseWithWeather, altOf, zoneDistance, isFlying, ceilingOf, flyingBoss, ALT_ORDER } from "./scene.mjs";
import { aimedWeapon, toggleAim } from "./range.mjs";
import { stepAltitude } from "./altitude.mjs";
import { combatantOf, spentOf, declaredOf, endTurn } from "./actions.mjs";
import { runAction, PILOT_BAR } from "./macros.mjs";
import { lockersOf } from "./rwr.mjs";

const FOLD_KEY = `${SYSTEM_ID}.hudFolded`;
const BUTTONS = { lock: "Lock On", break: "Break", lead: "Lead", formup: "Вплотную", recover: "Strain", end: "Конец хода" };
let el = null, timer = null, shown = null;

export function registerHud() {
  game.settings.register(SYSTEM_ID, "pilotHud", {
    name: "HUD пилота", hint: "Полоса внизу экрана в бою: HP, Strain, Speed, высота, действия хода, захват, спецоружие и предупреждения, кнопки действий.",
    scope: "client", config: true, type: Boolean, default: true, onChange: () => refreshHud()
  });
  for (const ev of ["canvasReady", "controlToken", "updateActor", "updateActorDelta", "updateToken", "createToken", "deleteToken", "updateItem",
    "createCombat", "updateCombat", "deleteCombat", "updateCombatant", "createChatMessage", "updateChatMessage"]) Hooks.on(ev, () => refreshHud());
  globalThis.window?.addEventListener("resize", () => place());
}

/** Перерисовать HUD (пачка обновлений даёт одну перерисовку). */
export function refreshHud() {
  clearTimeout(timer);
  timer = setTimeout(() => { try { render(); } catch (err) { console.warn(`${SYSTEM_ID} | HUD`, err); } }, 80);
}

/** Чей самолёт показывать: выделенный свой токен, иначе пилот игрока, иначе его первый пилот на сцене. У ведущего только выделенный. */
export function hudActor() {
  const own = (canvas?.tokens?.controlled ?? []).filter(t => t.actor?.isOwner && ["pilot", "npc"].includes(t.actor.type));
  if (own.length === 1) return own[0].actor;
  if (game.user.isGM) return null;
  const ch = game.user.character;
  if (ch?.type === "pilot" && tokenOf(ch)) return ch;
  return game.actors.find(a => a.type === "pilot" && a.isOwner && tokenOf(a)) ?? null;
}

const pips = (value, max, cls = "") => Array.from({ length: Math.max(0, max) }, (_, i) => `<i class="${i < value ? "on" : ""} ${cls}"></i>`).join("");

/** Ракеты, летящие в этот самолёт: отложенные пуски текущего боя, ещё не долетевшие. */
function incoming(actor) {
  const combat = game.combat;
  if (!combat?.started) return 0;
  return game.messages.contents.slice(-300).filter(m => {
    const c = m.getFlag(SYSTEM_ID, "card");
    return c?.delayed && c.targetUuid === actor.uuid && c.combatKey?.startsWith(`${combat.id}:`) && !c.resolved && !c.dmgApplied;
  }).length;
}

/** Speed в км/ч для приборов: игровая Speed — шкала, а не скорость, так что это только картинка. 1 ≈ 500 км/ч, 3 ≈ 1100, 5 ≈ 1700. */
export const speedKmh = speed => (speed <= 0 ? 0 : 200 + speed * 300);
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
  if (s.hp.value <= 1 && s.hp.max > 1) warn.push({ key: "damage", text: "DAMAGE" });
  const aim = aimedWeapon(actor)?.id ?? null;
  const weapons = actor.items.filter(i => i.type === "weapon").map(i => {
    const a = i.system.ammo, max = a.max === null ? null : a.max + (s.ammoBonus?.[i.id] ?? 0);
    return { id: i.id, name: i.name, ammo: max === null ? "∞" : `${a.value}/${max}`, empty: max !== null && a.value <= 0, aimed: i.id === aim };
  });
  // альтиметр: доступные ступени (потолок машины, у боссов свои), остальные тусклые
  const ceil = ceilingOf(actor);
  const allowed = flyingBoss(actor) ?? (ceil ? ALT_ORDER.slice(0, ALT_ORDER.indexOf(ceil) + 1) : ALT_ORDER);
  const kmh = speedKmh(s.speed);
  return {
    name: (pilot && s.callsign) || tok?.name || actor.name, plane: pilot ? s.plane?.name ?? "без самолёта" : TB.npcKinds?.[s.kind] ?? "",
    hp: s.hp, strain: s.strain, speed: s.speed, maxSpeed, kmh, mach: (kmh / 1225).toFixed(1),
    alt: TB.altitudes[alt] ?? alt ?? "", altKey: alt, flying, defense: defenseWithWeather(actor, w),
    alts: ALT_ORDER.map(k => ({ key: k, label: TB.altitudes[k] ?? k, m: ALT_METERS[k], on: k === alt, can: allowed.includes(k) })).reverse(),
    acts: c ? { declared, used: spent.used, rolled: spent.rolled, list: spent.list, turn: c.parent.combatant?.id === c.id } : null,
    lock: s.lockUuid || s.lock ? { name: target?.token?.name ?? tTok?.name ?? target?.name ?? s.lock, uuid: s.lockUuid, gone: !tTok,
      dist: dist === null ? "" : dist === 0 ? "своя зона" : `${dist} ${dist === 1 ? "зона" : dist < 5 ? "зоны" : "зон"}` } : null,
    weapons, aimed: aim, warn
  };
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

/** Схема истребителя сверху: пушка в носу, ракеты под консолями, спецоружие на внутренних пилонах и под фюзеляжем. Всё нажимается. */
function fighter(d) {
  const spw = d.weapons.slice(0, 2);
  const missile = (x, y) => `<path d="M${x} ${y - 9} l2 3 v12 l2 3 h-8 l2 -3 v-12 z"/>`;
  const bomb = (x, y) => `<rect x="${x - 3}" y="${y - 7}" width="6" height="14" rx="3"/>`;
  const pylon = (w, places, key) => w ? `<g class="hp spw ${w.aimed ? "aimed" : ""} ${w.empty ? "empty" : ""}" data-hud-spw="${w.id}" tabindex="0">
        <title>${esc(w.name)} ${w.ammo}: выбрать и пустить</title>${places.map(([x, y]) => key === "c" ? bomb(x, y) : missile(x, y)).join("")}</g>` : "";
  return `<svg class="tb-hud-plane" viewBox="0 0 200 128" aria-label="Оружие">
      <path class="body" d="M100 6 C104 16 107 26 107 42 L107 54 L184 84 L184 92 L107 84 L106 102 L126 114 L126 119 L100 115 L74 119 L74 114 L94 102 L93 84 L16 92 L16 84 L93 54 L93 42 C93 26 96 16 100 6 Z"/>
      <path class="canopy" d="M100 22 C103 26 104 32 103 40 L97 40 C96 32 97 26 100 22 Z"/>
      <g class="hp gun" data-hud-act="guns" tabindex="0"><title>Guns, Guns, Guns!</title><circle cx="100" cy="8" r="9" class="halo"/><circle cx="100" cy="8" r="2.5"/></g>
      <g class="hp msl" data-hud-act="missile" tabindex="0"><title>Fox Two! стандартной ракетой</title>${missile(32, 82)}${missile(168, 82)}</g>
      ${pylon(spw[0], [[62, 74], [138, 74]], "w")}
      ${pylon(spw[1], [[100, 96]], "c")}
    </svg>
    <div class="tb-hud-arms">
      <a data-hud-act="guns"><b>${PILOT_BAR.indexOf("guns") + 1}</b> GUN</a>
      <a data-hud-act="missile" class="${d.aimed ? "" : "aimed"}"><b>${PILOT_BAR.indexOf("missile") + 1}</b> MSL</a>
      ${d.weapons.map(w => `<a data-hud-spw="${w.id}" class="${w.aimed ? "aimed" : ""} ${w.empty ? "empty" : ""}" title="Выбрать и пустить">${esc(w.name)} ${w.ammo}</a>`).join("")}
    </div>`;
}

function html(actor, d, folded) {
  const actBoxes = d.acts && d.acts.declared !== null
    ? Array.from({ length: Math.max(d.acts.declared, d.acts.used) }, (_, i) => `<span class="${i < d.acts.used ? "used" : ""}" title="${esc(d.acts.list[i] ?? "")}">${esc(d.acts.list[i]?.replace(/ \(заодно\)$/, "") ?? String(i + 1))}</span>`).join("")
    : `<span class="tb-hud-none">${d.acts ? "заявки ещё нет" : "вне боя"}</span>`;
  const buttons = Object.entries(BUTTONS).map(([act, label]) => {
    const n = PILOT_BAR.indexOf(act) + 1;
    return `<button type="button" data-hud-act="${act}" class="${act === "end" ? "end" : ""}">${n ? `<b>${n}</b> ` : ""}${label}</button>`;
  }).join("");
  return `<header data-hud-fold title="Свернуть или развернуть HUD">
      <b>${esc(d.name)}</b> <small>${esc(d.plane)}</small>
      ${d.warn.map(w => `<span class="tb-hud-warn ${w.key}">${w.text}</span>`).join("")}
      ${d.acts?.turn ? `<span class="tb-hud-turn">ВАШ ХОД</span>` : ""}
      <i class="fas fa-chevron-${folded ? "up" : "down"}"></i>
    </header>
    ${folded ? "" : `<div class="tb-hud-grid">
      <div class="tb-hud-col">
        <small>HP</small><span class="tb-hud-pips hp ${d.hp.value <= 1 ? "low" : ""}">${pips(d.hp.value, d.hp.max)}</span><span class="tb-hud-num">${d.hp.value}/${d.hp.max}</span>
        ${d.strain?.max ? `<small>STRAIN</small><span class="tb-hud-pips strain">${pips(d.strain.value, d.strain.max)}</span><span class="tb-hud-num">${d.strain.value}/${d.strain.max}</span>` : ""}
        <small>DEF</small><span class="tb-hud-def">${d.defense ?? "—"}</span>
        <small>ЗАХВАТ</small>${d.lock ? `<a class="tb-hud-lock ${d.lock.gone ? "gone" : ""}" data-hud-lock title="Показать цель на карте"><i class="fas fa-crosshairs"></i> ${esc(d.lock.name)}${d.lock.dist ? ` · ${d.lock.dist}` : ""}${d.lock.gone ? " · нет на сцене" : ""}</a>` : `<span class="tb-hud-none">нет</span>`}
      </div>
      <div class="tb-hud-col tb-hud-speed">
        <small>SPEED</small>
        <div class="tb-hud-dial">${speedGauge(d)}<div class="tb-hud-readout"><b class="${d.speed <= 0 ? "bad" : ""}">${d.speed}</b><em>/${d.maxSpeed}</em></div></div>
        <div class="tb-hud-kmh">${d.speed <= 0 ? "сваливание" : `≈ ${d.kmh} км/ч · M${d.mach}`}</div>
        <div class="tb-hud-step"><a data-hud-speed="-1" title="Сбросить скорость (Change Speed)">−</a><a data-hud-speed="1" title="Прибавить скорость (Change Speed)">+</a></div>
      </div>
      <div class="tb-hud-col tb-hud-altcol">
        <small>ВЫСОТА</small>
        <div class="tb-hud-alt">
          <a class="tb-hud-altbtn" data-hud-alt="1" title="Набрать высоту (Climb)">▲</a>
          <ol>${d.alts.map(a => `<li class="${a.on ? "on" : ""} ${a.can ? "" : "off"}" ${a.can ? `data-hud-alt-to="${a.key}"` : ""} title="${a.can ? `${a.label}` : `${a.label}: выше потолка машины`}"><span>${esc(a.label)}</span><em>${a.m.toLocaleString("ru")} м</em></li>`).join("")}</ol>
          <a class="tb-hud-altbtn" data-hud-alt="-1" title="Снизиться (Dive)">▼</a>
        </div>
      </div>
      <div class="tb-hud-col tb-hud-arm">${fighter(d)}</div>
    </div>
    <div class="tb-hud-foot">
      <div class="tb-hud-acts" title="Действия хода${d.acts?.rolled ? " · бросок уже был" : ""}"><small>ДЕЙСТВИЯ</small>${actBoxes}${d.acts?.rolled ? `<i class="fas fa-dice-d10" title="Бросок за ход уже был"></i>` : ""}</div>
      <div class="tb-hud-btns">${buttons}</div>
    </div>`}`;
}

/** Разметка HUD для актёра (для тестов и проверки вида). */
export const hudHtml = (actor, folded = false) => html(actor, hudData(actor), folded);

function render() {
  const actor = game.settings.get(SYSTEM_ID, "pilotHud") && game.combat?.started && (!game.combat.scene || game.combat.scene.id === canvas?.scene?.id) ? hudActor() : null;
  if (!actor || !tokenOf(actor)) { el?.remove(); el = null; shown = null; return; }
  shown = actor;
  let folded = false;
  try { folded = localStorage.getItem(FOLD_KEY) === "1"; } catch (err) { /* хранилище недоступно */ }
  if (!el) {
    el = document.createElement("section");
    el.id = "tb-pilot-hud";
    el.className = "thunderbolt tb-hud";
    el.addEventListener("click", onClick);
    document.body.append(el);
  }
  el.classList.toggle("folded", folded);
  el.innerHTML = html(actor, hudData(actor), folded);
  place();
}

/** Над панелью макросов, по центру экрана. */
function place() {
  if (!el) return;
  const bar = document.getElementById("hotbar")?.getBoundingClientRect();
  el.style.bottom = `${bar && bar.height ? Math.max(8, window.innerHeight - bar.top + 8) : 70}px`;
}

async function onClick(ev) {
  const t = ev.target.closest("[data-hud-act], [data-hud-spw], [data-hud-speed], [data-hud-alt], [data-hud-alt-to], [data-hud-lock], [data-hud-fold]");
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
  if (!actor.isOwner) return ui.notifications.warn(`«${actor.name}» вам не принадлежит.`);
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
