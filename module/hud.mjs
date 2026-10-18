/* HUD пилота: полоса внизу экрана над панелью макросов, как приборы в Ace Combat.
   Слева HP и Strain делениями, в центре Speed, высота и действия хода, справа захват, спецоружие и предупреждения,
   снизу кнопки действий с номерами панели макросов. Видна в бою, когда самолёт игрока стоит на сцене;
   у ведущего показывает выделенный токен. Сворачивается щелчком по шапке, выключается в настройках клиента. */
import { SYSTEM_ID, TB } from "./config.mjs";
import { esc, resolveActor } from "./utils.mjs";
import { tokenOf, weatherAt, defenseWithWeather, altOf, zoneDistance, isFlying } from "./scene.mjs";
import { combatantOf, spentOf, declaredOf, endTurn } from "./actions.mjs";
import { runAction, PILOT_BAR } from "./macros.mjs";
import { lockersOf } from "./rwr.mjs";

const FOLD_KEY = `${SYSTEM_ID}.hudFolded`;
const BUTTONS = { lock: "Lock On", missile: "Fox Two", guns: "Guns", break: "Break", lead: "Lead", formup: "Вплотную", recover: "Strain", end: "Конец хода" };
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
  const warn = [];
  if (missiles) warn.push({ key: "missile", text: missiles > 1 ? `MISSILE ×${missiles}` : "MISSILE" });
  else if (lockedBy) warn.push({ key: "lock", text: "LOCK" });
  if (isFlying(actor) && s.speed <= 0) warn.push({ key: "stall", text: "STALL" });
  if (isFlying(actor) && alt === "low") warn.push({ key: "lowalt", text: "LOW ALT" });
  if (s.hp.value <= 1 && s.hp.max > 1) warn.push({ key: "damage", text: "DAMAGE" });
  const weapons = actor.items.filter(i => i.type === "weapon").map(i => {
    const a = i.system.ammo, max = a.max === null ? null : a.max + (s.ammoBonus?.[i.id] ?? 0);
    return { name: i.name, ammo: max === null ? "∞" : `${a.value}/${max}`, empty: max !== null && a.value <= 0 };
  });
  return {
    name: (pilot && s.callsign) || tok?.name || actor.name, plane: pilot ? s.plane?.name ?? "без самолёта" : TB.npcKinds?.[s.kind] ?? "",
    hp: s.hp, strain: s.strain, speed: s.speed, maxSpeed, alt: TB.altitudes[alt] ?? alt ?? "", defense: defenseWithWeather(actor, w),
    acts: c ? { declared, used: spent.used, rolled: spent.rolled, list: spent.list, turn: c.parent.combatant?.id === c.id } : null,
    lock: s.lockUuid || s.lock ? { name: target?.token?.name ?? tTok?.name ?? target?.name ?? s.lock, uuid: s.lockUuid, gone: !tTok,
      dist: dist === null ? "" : dist === 0 ? "своя зона" : `${dist} ${dist === 1 ? "зона" : dist < 5 ? "зоны" : "зон"}` } : null,
    weapons, warn
  };
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
      </div>
      <div class="tb-hud-col mid">
        <div class="tb-hud-big"><div><small>SPEED</small><b class="${d.speed <= 0 ? "bad" : ""}">${d.speed}</b><em>/${d.maxSpeed}</em></div>
          <div><small>ВЫСОТА</small><b>${esc(d.alt)}</b></div><div><small>DEF</small><b>${d.defense}</b></div></div>
        <div class="tb-hud-acts" title="Действия хода${d.acts?.rolled ? " · бросок уже был" : ""}">${actBoxes}${d.acts?.rolled ? `<i class="fas fa-dice-d10" title="Бросок за ход уже был"></i>` : ""}</div>
      </div>
      <div class="tb-hud-col">
        <small>ЗАХВАТ</small>${d.lock ? `<a class="tb-hud-lock ${d.lock.gone ? "gone" : ""}" data-hud-lock title="Показать цель на карте"><i class="fas fa-crosshairs"></i> ${esc(d.lock.name)}${d.lock.dist ? ` · ${d.lock.dist}` : ""}${d.lock.gone ? " · нет на сцене" : ""}</a>` : `<span class="tb-hud-none">нет</span>`}
        <small>ОРУЖИЕ</small><span class="tb-hud-weapons">MSL${d.weapons.map(w => ` · <span class="${w.empty ? "empty" : ""}">${esc(w.name)} ${w.ammo}</span>`).join("")}</span>
      </div>
    </div>
    <div class="tb-hud-btns">${buttons}</div>`}`;
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
  const t = ev.target.closest("[data-hud-act], [data-hud-lock], [data-hud-fold]");
  if (!t || !shown) return;
  ev.preventDefault();
  if (t.dataset.hudFold !== undefined) {
    try { localStorage.setItem(FOLD_KEY, el.classList.contains("folded") ? "0" : "1"); } catch (err) { /* хранилище недоступно */ }
    return render();
  }
  if (t.dataset.hudLock !== undefined) {
    const tok = tokenOf(resolveActor(shown.system.lockUuid));
    if (tok) canvas.animatePan({ x: tok.center.x, y: tok.center.y, duration: 400 });
    return;
  }
  const act = t.dataset.hudAct;
  if (!shown.isOwner) return ui.notifications.warn(`«${shown.name}» вам не принадлежит.`);
  if (act === "end") return endTurn(shown);
  return runAction(shown, act);
}
