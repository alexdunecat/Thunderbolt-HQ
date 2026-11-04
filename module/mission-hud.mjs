/* Экран боя, как в Ace Combat.
   1. Задачи на экране: в бою в правом верхнем углу (левее боковой панели Foundry) список задач миссии — строки задач из
      Планшета, приоритетные цели с состоянием («Уничтожить: 1 из 3», ✓ у поражённых, ✗ у ушедших и потерянных) и лимит
      времени делениями. Клавиша J сворачивает список в строку «ЗАДАЧИ 1/3» и разворачивает обратно (у каждого своё).
   2. «Ваш ход» с камерой: очередь дошла до машины игрока — камера плавно едет к ней, токен выделяется, HUD вспыхивает.
      Если игрок только что сам двигал карту (последние 2 секунды), камера не трогается. Настройки у каждого свои. */
import { SYSTEM_ID, TB } from "./config.mjs";
import { esc } from "./utils.mjs";
import { KILL, KEEP, liveGoals } from "./goal-calls.mjs";

/* ---------- данные и разметка (тесты) ---------- */

/**
 * Что показать: objectives — строки задач миссии; goals — приоритетные цели { name, task, out, hidden };
 * timers — лимиты времени { name, value, size }. Скрытые цели (подкрепление ещё не вышло) не называются.
 */
export function goalsView({ objectives = [], goals = [], timers = [] } = {}) {
  const shown = goals.filter(g => !g.hidden);
  const groups = [];
  for (const task of [...KILL, ...KEEP]) {
    const list = shown.filter(g => g.task === task);
    if (!list.length) continue;
    const kill = KILL.includes(task);
    const done = kill ? list.filter(g => g.out === "down").length : 0;
    const lost = list.filter(g => (kill ? g.out === "retreat" : g.out === "down")).length;
    const state = kill ? (done + lost === list.length ? (lost ? "partial" : "done") : "open") : lost ? "failed" : "open";
    groups.push({ task, verb: TB.tasks?.[task] ?? task, kill, total: list.length, done, lost, state,
      items: list.map(g => ({ name: g.name, mark: kill ? (g.out === "down" ? "done" : g.out === "retreat" ? "lost" : "open") : g.out === "down" ? "lost" : "open" })) });
  }
  const text = objectives.map(o => String(o).trim()).filter(Boolean);
  const clocks = timers.map(t => ({ name: t.name || "Лимит времени", value: Math.max(0, Number(t.value) || 0), size: Math.max(1, Number(t.size) || 1) }));
  // счётчик в шапке: поражённые цели из всех, что надо уничтожить (охрана и сопровождение «выполняются» только в конце)
  const kills = groups.filter(g => g.kill), done = kills.reduce((n, g) => n + g.done, 0), total = kills.reduce((n, g) => n + g.total, 0);
  return { text, groups, clocks, done, total, empty: !text.length && !groups.length && !clocks.length };
}

const MARK = { done: "✓", lost: "✗", open: "◇" };
/** Разметка панели. collapsed — одна строка «ЗАДАЧИ done/total». */
export function goalsHtml(v, { collapsed = false } = {}) {
  if (v.empty) return "";
  const head = `<header data-goals-fold title="Задачи миссии · J — свернуть или развернуть"><b>ЗАДАЧИ</b>${v.total ? `<span>${v.done}/${v.total}</span>` : ""}<i class="fas fa-${collapsed ? "chevron-down" : "chevron-up"}"></i></header>`;
  if (collapsed) return head;
  const text = v.text.map(t => `<li class="obj">${esc(t)}</li>`).join("");
  const groups = v.groups.map(g => {
    const count = g.kill ? `${g.done} из ${g.total}` : g.state === "failed" ? "провалено" : "в порядке";
    const items = g.items.map(x => `<li class="${x.mark}"><i>${MARK[x.mark]}</i>${esc(x.name)}</li>`).join("");
    return `<li class="goal ${g.state}"><div><b>${esc(g.verb)}</b><span>${count}</span></div><ul>${items}</ul></li>`;
  }).join("");
  const clocks = v.clocks.map(c => `<li class="clock"><div><b>${esc(c.name)}</b><span>${c.value}/${c.size}</span></div><em>${Array.from({ length: c.size }, (_, i) => `<i class="${i < c.value ? "on" : ""}"></i>`).join("")}</em></li>`).join("");
  return `${head}<ul>${text}${groups}${clocks}</ul>`;
}

/* ---------- панель задач ---------- */

const FOLD_KEY = `${SYSTEM_ID}.goalsFolded`;
const folded = () => { try { return localStorage.getItem(FOLD_KEY) === "1"; } catch { return false; } };
const setting = (k, d) => { try { return game.settings.get(SYSTEM_ID, k); } catch { return d; } };
const inCombat = () => { const c = game.combat; return !!(c?.started && canvas?.ready && (!c.scene || c.scene.id === canvas.scene?.id)); };
let box = null, timer = null, lastSig = "";

async function data() {
  const c = game.combat, scene = c?.scene ?? canvas?.scene;
  const tokens = [...(scene?.tokens ?? [])];
  // неопознанный контакт «?» называется как на карте, без позывного из эфира
  const goals = liveGoals(tokens, c?.id).map(g => {
    const t = tokens.find(x => x.actor?.uuid === g.uuid);
    return t?.getFlag?.(SYSTEM_ID, "unknown") && !game.user.isGM ? { ...g, name: t.name } : g;
  });
  let timers = [];
  try { timers = (game.settings.get(SYSTEM_ID, "threats") ?? []).filter(t => t.kind === "boss" && t.timer && !t.stopped); } catch { timers = []; }
  return goalsView({ objectives: scene?.getFlag?.(SYSTEM_ID, "objectives") ?? [], goals, timers });
}

function place() {
  if (!box) return;
  const sb = document.getElementById("sidebar"), r = sb?.getBoundingClientRect?.();
  const right = r && r.width > 0 && getComputedStyle(sb).display !== "none" ? Math.max(12, window.innerWidth - r.left + 12) : 12;
  box.style.right = `${right}px`;
}

async function render() {
  if (!setting("goalsPanel", true) || !inCombat()) { box?.remove(); box = null; lastSig = ""; return; }
  const v = await data();
  const html = goalsHtml(v, { collapsed: folded() });
  if (!html) { box?.remove(); box = null; lastSig = ""; return; }
  if (!box || !box.isConnected) {
    box = document.createElement("div");
    box.id = "tb-goals";
    box.className = "thunderbolt";
    box.addEventListener("click", ev => { if (ev.target.closest("[data-goals-fold]")) toggle(); });
    document.body.append(box);
    lastSig = "";
  }
  // что-то поменялось в задачах (не просто свернули) — панель коротко вспыхивает
  const sig = JSON.stringify([v.groups.map(g => [g.done, g.lost]), v.clocks.map(c => c.value)]);
  if (lastSig && sig !== lastSig) { box.classList.remove("flash"); void box.offsetWidth; box.classList.add("flash"); }
  lastSig = sig;
  box.innerHTML = html;
  box.classList.toggle("folded", folded());
  place();
}
export function refreshGoals() { clearTimeout(timer); timer = setTimeout(() => render().catch(err => console.warn(`${SYSTEM_ID} | задачи на экране`, err)), 200); }
function toggle() {
  try { localStorage.setItem(FOLD_KEY, folded() ? "0" : "1"); } catch { /* хранилище недоступно */ }
  refreshGoals();
  return true;
}

/* ---------- «Ваш ход» с камерой ---------- */

let touched = 0;
/** Двигать ли камеру: ход своей машины, игрок не трогал карту последние 2 секунды. */
export function wantCamera({ mine = false, isGM = false, on = true, sinceTouch = Infinity } = {}) {
  return on && mine && !isGM && sinceTouch > 2000;
}
let lastTurn = "";
function onTurn(combat) {
  if (!combat?.started || combat.getFlag(SYSTEM_ID, "ready") !== combat.round) return;
  const c = combat.combatant, key = `${combat.id}:${combat.round}:${c?.id}`;
  if (!c || key === lastTurn) return;
  lastTurn = key;
  const a = c.actor, tok = c.token?.object;
  const mine = !!a?.isOwner && (a.type === "pilot" || a.hasPlayerOwner) && !!tok && (!combat.scene || combat.scene.id === canvas?.scene?.id);
  if (!wantCamera({ mine, isGM: game.user.isGM, on: setting("turnCamera", true), sinceTouch: performance.now() - touched })) return;
  try { if (!tok.controlled) tok.control({ releaseOthers: true }); } catch { /* токен уже снят */ }
  canvas.animatePan?.({ x: tok.center.x, y: tok.center.y, duration: 650 });
  const hud = document.getElementById("tb-pilot-hud");
  if (hud) { hud.classList.remove("tb-turn-flash"); void hud.offsetWidth; hud.classList.add("tb-turn-flash"); setTimeout(() => hud.classList.remove("tb-turn-flash"), 1300); }
}

export function registerMissionHud() {
  game.settings.register(SYSTEM_ID, "goalsPanel", {
    name: "Задачи на экране", hint: "В бою в правом верхнем углу список задач миссии: цели с состоянием и лимит времени. Клавиша J сворачивает и разворачивает его.",
    scope: "client", config: true, type: Boolean, default: true, onChange: () => refreshGoals()
  });
  game.settings.register(SYSTEM_ID, "turnCamera", {
    name: "«Ваш ход» с камерой", hint: "Очередь дошла до вашей машины — камера сама плавно едет к ней, токен выделяется, HUD вспыхивает. Если вы только что двигали карту, камера не трогается.",
    scope: "client", config: true, type: Boolean, default: true
  });
  game.keybindings.register(SYSTEM_ID, "goalsPanel", {
    name: "Задачи на экране: свернуть или развернуть", editable: [{ key: "KeyJ" }],
    onDown: () => (inCombat() && box ? toggle() : false)
  });
  for (const ev of ["canvasReady", "createCombat", "deleteCombat", "combatStart", "updateActor", "updateActorDelta", "createActiveEffect", "deleteActiveEffect", "createToken", "deleteToken", "collapseSidebar"]) Hooks.on(ev, () => refreshGoals());
  Hooks.on("updateToken", (doc, change) => { if ("hidden" in change || "name" in change || foundry.utils.hasProperty(change, `flags.${SYSTEM_ID}`)) refreshGoals(); });
  Hooks.on("updateScene", (scene, change) => { if (foundry.utils.hasProperty(change, `flags.${SYSTEM_ID}.objectives`)) refreshGoals(); });
  Hooks.on("updateSetting", s => { if (s.key === `${SYSTEM_ID}.threats`) refreshGoals(); });
  Hooks.on(`${SYSTEM_ID}.combatScreen`, () => setTimeout(place, 300));
  Hooks.on("updateCombat", (combat, change) => {
    if ("round" in change || "started" in change) refreshGoals();
    if ("turn" in change || "round" in change || foundry.utils.hasProperty(change, `flags.${SYSTEM_ID}.ready`)) onTurn(combat);
  });
  globalThis.window?.addEventListener?.("resize", () => place());
  // игрок сам двигает карту — камера не перехватывает
  Hooks.once("ready", () => {
    const board = globalThis.document?.getElementById?.("board");
    for (const ev of ["pointerdown", "wheel"]) board?.addEventListener(ev, () => { touched = performance.now(); }, { passive: true });
    refreshGoals();
  });
}
