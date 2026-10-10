/* Переговоры NPC в эфире, как в Ace Combat: союзники и противник говорят при захвате, пуске, попадании, промахе,
   когда их подбили или сбили и когда рядом сбили своего. Гражданские зовут на помощь.
   События собирает клиент ведущего (сообщения чата, урон из actor.mjs, токены на сцене), раз в FLUSH_MS выбирает
   до MAX_LINES реплик и рассылает всем: каждый клиент показывает их субтитрами (если очередь свободна) и пишет в радиожурнал.
   Фразы берутся из data/chatter-bank.mjs с правками ведущего из окна «Реплики NPC» (настройка мира chatterBank). */
import { SYSTEM_ID } from "./config.mjs";
import { esc, resolveActor } from "./utils.mjs";
import { sideOf, hasRule } from "./scene.mjs";
import { say } from "./radio.mjs";
import { CHATTER_BANK, CHATTER_TYPES, CHATTER_SIDES, CHATTER_EVENTS, CIVIL_EVENTS } from "./data/chatter-bank.mjs";

const CHANNEL = `system.${SYSTEM_ID}`;
const FLUSH_MS = 700, MAX_LINES = 3;
// какие реплики выбирать первыми, если событий больше MAX_LINES
const PRIORITY = ["destroyed", "kill", "wingmanDown", "damaged", "hit", "miss", "evade", "incoming", "fire", "lock", "locked", "arrive"];
// в каком порядке их произносить: сначала стрелявший, потом сбитый, потом его ведомый
const ORDER = ["arrive", "lock", "locked", "fire", "incoming", "hit", "miss", "evade", "kill", "damaged", "destroyed", "wingmanDown"];
// сбитый больше ничего не говорит, кроме последних слов
const SILENT_WHEN_DOWN = ["damaged", "incoming", "evade", "locked", "hit", "miss", "fire", "lock", "arrive"];

let pending = [], timer = null;
const lastPick = new Map();

export function registerChatter() {
  game.settings.register(SYSTEM_ID, "npcChatter", {
    name: "Переговоры NPC в эфире", hint: "Союзники, противник и гражданские говорят субтитрами при захвате, пуске, попадании и потерях. Всё попадает в радиожурнал. Фразы меняются в окне «Реплики NPC».",
    scope: "world", config: true, type: Boolean, default: true
  });
  game.settings.register(SYSTEM_ID, "chatterChance", {
    name: "Переговоры NPC: как часто о мелочах", hint: "Вероятность реплики на захват, пуск, промах и появление в бою, в процентах. Сбитый, подбитый, сбивший и ведомый сбитого говорят всегда.",
    scope: "world", config: true, type: Number, range: { min: 0, max: 100, step: 10 }, default: 60
  });
  game.settings.register(SYSTEM_ID, "chatterBank", { scope: "world", config: false, type: Object, default: {} });
  game.settings.registerMenu(SYSTEM_ID, "chatterEditor", {
    name: "Реплики NPC", label: "Открыть реплики", hint: "Все фразы NPC по типам техники, сторонам и событиям: посмотреть, поменять, вернуть стандартные.",
    icon: "fas fa-comments", type: ChatterEditor, restricted: true
  });
  Hooks.once("ready", () => game.socket.on(CHANNEL, msg => {
    if (msg?.type === "chatter") hear(msg.line);
    else if (msg?.type === "chatterEvent" && isLead()) queue(msg.ev);
  }));
  Hooks.on("createChatMessage", message => {
    if (!isLead()) return;
    try { fromMessage(message); } catch (err) { console.warn(`${SYSTEM_ID} | переговоры`, err); }
  });
  // подкрепление или засада: NPC появился на сцене боя или ведущий его открыл
  Hooks.on("createToken", doc => { if (isLead() && inCombat(doc) && !doc.hidden) queue({ event: "arrive", speaker: doc.actor?.uuid }); });
  Hooks.on("updateToken", (doc, change) => { if (isLead() && change.hidden === false && inCombat(doc)) queue({ event: "arrive", speaker: doc.actor?.uuid }); });
}

/* ---------- откуда берутся события ---------- */

const isLead = () => !!game.user?.isGM && !!game.users?.activeGM?.isSelf;
const enabled = () => { try { return game.settings.get(SYSTEM_ID, "npcChatter"); } catch { return true; } };
const chance = () => { try { return game.settings.get(SYSTEM_ID, "chatterChance"); } catch { return 60; } };
const inCombat = doc => !!game.combat?.started && doc.parent?.id === game.combat.scene?.id;

/** Событие из любого клиента (урон, сбитый): на клиенте ведущего в очередь, у игрока — ведущему по сокету. */
export function chatter(ev) {
  if (!enabled() || !ev?.event) return;
  if (isLead()) return queue(ev);
  game.socket?.emit(CHANNEL, { type: "chatterEvent", ev });
}

function fromMessage(message) {
  const f = message.flags?.[SYSTEM_ID] ?? {};
  if (f.rwr) {
    if (f.rwr.fromUuid) queue({ event: "lock", speaker: f.rwr.fromUuid, target: nameOf(resolveActor(f.rwr.target)) });
    queue({ event: "locked", speaker: f.rwr.target });
    return;
  }
  const c = f.card;
  if (!c) return;
  if (c.type === "volley") {
    for (const r of c.targets ?? []) {
      if (r.missing || r.ship) continue;
      const shooter = [r.sourceUuid, ...(r.shooterUuids ?? [])].find(u => resolveActor(u)?.type === "npc");
      if (shooter) queue({ event: r.hit ? "hit" : "miss", speaker: shooter, target: r.name });
      if (!r.hit) queue({ event: "evade", speaker: r.uuid });
    }
    return;
  }
  if (!c.attack || !c.actorUuid) return;
  // пушка: исход известен сразу; урон и сбитого пришлёт actor.mjs
  if (c.instant) {
    if (!c.targetUuid || c.dc === null || c.dc === undefined) return;
    const ok = succeeded(c);
    queue({ event: ok ? "hit" : "miss", speaker: c.actorUuid, target: c.targetName });
    if (!ok) queue({ event: "evade", speaker: c.targetUuid });
    return;
  }
  queue({ event: "fire", speaker: c.actorUuid, target: c.targetName });
  if (c.targetUuid) queue({ event: "incoming", speaker: c.targetUuid });
}

/** Попала ли атака (как computeCard: ничья за атакующим). */
function succeeded(c) {
  if (c.forceFail) return false;
  const sum = c.parts.reduce((s, p) => s + p[1], 0);
  return (c.rolled ? (c.d10 ?? 0) + sum + (c.strain ?? 0) : sum) >= c.dc;
}

function queue(ev) {
  if (!enabled() || !ev?.speaker && ev?.event !== "down") return;
  pending.push(ev);
  clearTimeout(timer);
  timer = setTimeout(flush, FLUSH_MS);
}

/** Сбитый: его последние слова, реплика сбившего и ближайшего своего. */
function expandDown(ev) {
  const victim = resolveActor(ev.victim);
  if (!victim) return [];
  const name = nameOf(victim);
  const out = [{ event: "destroyed", speaker: ev.victim }];
  if (ev.killer) out.push({ event: "kill", speaker: ev.killer, target: name });
  const mate = nearestMate(victim);
  if (mate) out.push({ event: "wingmanDown", speaker: mate.actor.uuid, fallen: name });
  return out;
}

/** Выбрать реплики из накопившихся событий и разослать. */
export function flush() {
  const evs = pending.splice(0).flatMap(e => (e.event === "down" ? expandDown(e) : [e]));
  const down = new Set(evs.filter(e => e.event === "destroyed").map(e => e.speaker));
  const kills = new Set(evs.filter(e => e.event === "kill").map(e => `${e.speaker}>${e.target}`));
  const keep = evs.filter(e => !(down.has(e.speaker) && SILENT_WHEN_DOWN.includes(e.event)) && !(e.event === "hit" && kills.has(`${e.speaker}>${e.target}`)));
  keep.sort((a, b) => PRIORITY.indexOf(a.event) - PRIORITY.indexOf(b.event));
  const spoke = new Set(), lines = [];
  for (const e of keep) {
    if (lines.length >= MAX_LINES) break;
    if (spoke.has(e.speaker)) continue;
    if (CHATTER_EVENTS[e.event]?.minor && Math.random() * 100 >= chance()) continue;
    const line = lineFor(e);
    if (!line) continue;
    spoke.add(e.speaker);
    lines.push({ ...line, order: ORDER.indexOf(e.event) });
  }
  lines.sort((a, b) => a.order - b.order);
  for (const { order, ...line } of lines) broadcast(line);
  return lines;
}

function broadcast(line) {
  game.socket?.emit(CHANNEL, { type: "chatter", line });
  hear(line);
}

function hear(line) {
  if (line?.text) say(line.speaker, line.text, line.side, { low: true });
}

/* ---------- кто говорит и что ---------- */

/** Тип говорящего для банка фраз; null — молчит (объекты, беспилотники, баллистические ракеты, пилоты игроков). */
export function chatterType(actor) {
  if (actor?.type !== "npc") return null;
  const s = actor.system;
  if (s.grp === "obj" || s.key === "icbm" || hasRule(actor, "drone") || hasRule(actor, "ballistic")) return null;
  if (s.grp === "civil" || hasRule(actor, "civilian")) return s.kind === "ship" ? "civilShip" : s.kind === "ground" ? "civilGround" : "civilAir";
  if (s.grp === "boss") return "boss";
  if (s.kind === "ship") return "ship";
  if (s.kind === "ground") return s.grp === "ad" ? "ad" : "ground";
  return s.grp === "heli" ? "heli" : "air";
}

const isCivil = type => !!CHATTER_TYPES[type]?.civil;
const team = s => (s === "player" ? "ally" : s);
const dead = a => !!a?.statuses?.has(CONFIG.specialStatusEffects.DEFEATED) || !!a?.system?.markers?.doom;

function tokenDoc(actor) {
  if (!actor) return null;
  if (actor.isToken) return actor.token ?? null;
  return actor.getActiveTokens?.(false, true)?.[0] ?? null;
}

/** Имя в эфире: позывной пилота или имя токена. */
function nameOf(actor) {
  if (!actor) return "";
  return actor.system?.callsign || tokenDoc(actor)?.name || actor.name;
}

/** Ближайший живой NPC той же стороны (для гражданского — другой гражданский), который может говорить. */
function nearestMate(victim) {
  const vt = tokenDoc(victim);
  const scene = vt?.parent ?? game.combat?.scene ?? game.scenes?.viewed;
  if (!scene) return null;
  const civil = isCivil(chatterType(victim));
  const side = team(sideOf(victim));
  const list = scene.tokens.filter(t => {
    const a = t.actor;
    if (!a || t.hidden || t.id === vt?.id || dead(a)) return false;
    const type = chatterType(a);
    if (!type || isCivil(type) !== civil) return false;
    return civil || team(sideOf(a)) === side;
  });
  const d = t => (vt ? Math.hypot(t.x - vt.x, t.y - vt.y) : 0);
  return list.sort((a, b) => d(a) - d(b))[0] ?? null;
}

const bankSide = (actor, type) => (isCivil(type) ? "civil" : sideOf(actor) === "ally" ? "ally" : "enemy");
export const bankKey = (type, side, event) => `${type}.${side}.${event}`;
const overrides = () => { try { return game.settings.get(SYSTEM_ID, "chatterBank") ?? {}; } catch { return {}; } };

/** Стандартные фразы (с подстановкой из запасного типа: вертолёт → самолёт и т. п.). */
export function defaultLines(type, side, event) {
  const own = CHATTER_BANK[type]?.[side]?.[event];
  if (own) return own;
  const fb = CHATTER_TYPES[type]?.fallback;
  return fb ? defaultLines(fb, side, event) : [];
}

/** Фразы с правками ведущего. Пустой список в правках — тип молчит в этом событии. */
export function linesFor(type, side, event) {
  const o = overrides()[bankKey(type, side, event)];
  return Array.isArray(o) ? o : defaultLines(type, side, event);
}

/** Подставить имена; фраза с подстановкой, которой нет, не годится. */
export function fill(text, vars) {
  let ok = true;
  const out = text.replace(/\{(target|fallen|self)\}/g, (_, k) => { if (!vars[k]) ok = false; return vars[k] ?? ""; });
  return ok ? out : null;
}

/** Случайная фраза, по возможности не та же, что в прошлый раз. */
export function pickLine(key, lines, vars) {
  const ok = lines.map((t, i) => ({ i, text: fill(t, vars) })).filter(x => x.text);
  if (!ok.length) return null;
  const fresh = ok.length > 1 ? ok.filter(x => x.i !== lastPick.get(key)) : ok;
  const x = fresh[Math.floor(Math.random() * fresh.length)];
  lastPick.set(key, x.i);
  return x.text;
}

function lineFor(e) {
  const actor = resolveActor(e.speaker);
  const type = chatterType(actor);
  if (!type) return null;
  if (isCivil(type) && !CIVIL_EVENTS.includes(e.event)) return null;
  const tok = tokenDoc(actor);
  // скрытый токен не выдаёт себя в эфире
  if (!tok || tok.hidden) return null;
  if (e.event !== "destroyed" && dead(actor)) return null;
  const side = bankSide(actor, type);
  const key = bankKey(type, side, e.event);
  const self = tok.name || actor.name;
  const text = pickLine(key, linesFor(type, side, e.event), { target: e.target, fallen: e.fallen, self });
  return text ? { speaker: self, text, side: sideOf(actor) } : null;
}

/* ---------- окно «Реплики NPC» ---------- */

let editor = null;
export function openChatterEditor() {
  if (!game.user.isGM) return;
  editor ??= new ChatterEditor();
  editor.render(true);
}

const SAMPLE = { target: "Цель", fallen: "Ведомый", self: "" };

class ChatterEditor extends FormApplication {
  constructor(...args) {
    super(...args);
    this.type ??= "air";
    this.side ??= "enemy";
  }

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "tb-chatter", title: "Реплики NPC", classes: ["thunderbolt", "tb-chatter"],
      width: 780, height: 680, resizable: true, closeOnSubmit: false, submitOnChange: false
    });
  }

  get template() { return null; }

  async _renderInner() {
    const ov = overrides();
    const civil = isCivil(this.type);
    const side = civil ? "civil" : this.side;
    const events = civil ? CIVIL_EVENTS : Object.keys(CHATTER_EVENTS);
    const nav = Object.entries(CHATTER_TYPES).map(([k, t], i, all) => {
      const changed = Object.keys(ov).some(x => x.startsWith(`${k}.`));
      const gap = t.civil && !all[i - 1]?.[1].civil ? `<h4>Гражданские</h4>` : i === 0 ? `<h4>Военные</h4>` : "";
      return `${gap}<button type="button" data-type="${k}" class="${k === this.type ? "on" : ""}">${esc(t.label)}${changed ? ` <i class="fas fa-pen" title="есть правки"></i>` : ""}</button>`;
    }).join("");
    const sides = civil ? "" : `<div class="tb-chatter-sides">${Object.entries(CHATTER_SIDES).map(([k, l]) =>
      `<button type="button" data-side="${k}" class="tb-side-${k} ${k === side ? "on" : ""}">${esc(l)}</button>`).join("")}</div>`;
    const rows = events.map(ev => {
      const key = bankKey(this.type, side, ev), e = CHATTER_EVENTS[ev];
      const changed = Array.isArray(ov[key]);
      return `<div class="tb-chatter-ev${changed ? " changed" : ""}" data-key="${key}">
        <div class="tb-chatter-ev-head"><b>${esc(e.label)}</b><small>${esc(e.hint)}</small>
          <span class="tb-chatter-btns"><button type="button" data-test title="Послушать случайную фразу (только у вас)"><i class="fas fa-play"></i></button>
          <button type="button" data-reset title="Вернуть стандартные фразы" ${changed ? "" : "disabled"}><i class="fas fa-rotate-left"></i></button></span></div>
        <textarea rows="3" spellcheck="true">${esc(linesFor(this.type, side, ev).join("\n"))}</textarea></div>`;
    }).join("");
    const t = CHATTER_TYPES[this.type];
    const pct = chance();
    return $(`<form class="tb-chatter-body">
      <nav class="tb-chatter-nav">${nav}</nav>
      <section class="tb-chatter-main">
        <header><h3>${esc(t.label)}</h3><p class="tb-hint">${esc(t.hint)}. Одна фраза на строку, из них выбирается случайная. {target} — цель, {fallen} — сбитый свой, {self} — сам говорящий. Пустое поле: в этом случае молчит.</p>${sides}</header>
        <div class="tb-chatter-list">${rows}</div>
      </section>
      <footer class="tb-chatter-foot">
        <label><input type="checkbox" data-enabled ${enabled() ? "checked" : ""}> Переговоры в эфире</label>
        <label>О мелочах: <select data-chance>${[0, 20, 40, 60, 80, 100].map(n => `<option value="${n}" ${n === pct ? "selected" : ""}>${n}%</option>`).join("")}${[0, 20, 40, 60, 80, 100].includes(pct) ? "" : `<option selected value="${pct}">${pct}%</option>`}</select></label>
        <span class="tb-spacer"></span>
        <button type="button" data-export title="Сохранить все фразы в файл JSON"><i class="fas fa-file-export"></i> В файл</button>
        <button type="button" data-import title="Загрузить фразы из файла JSON"><i class="fas fa-file-import"></i> Из файла</button>
        <button type="button" data-reset-all title="Вернуть все стандартные фразы"><i class="fas fa-rotate-left"></i> Всё стандартное</button>
      </footer></form>`);
  }

  activateListeners(html) {
    super.activateListeners(html);
    const root = html[0] ?? html;
    root.querySelectorAll("[data-type]").forEach(b => b.addEventListener("click", () => { this.type = b.dataset.type; this.render(false); }));
    root.querySelectorAll("[data-side]").forEach(b => b.addEventListener("click", () => { this.side = b.dataset.side; this.render(false); }));
    root.querySelectorAll(".tb-chatter-ev").forEach(row => {
      const key = row.dataset.key, [type, side, event] = key.split(".");
      const area = row.querySelector("textarea");
      area.addEventListener("change", async () => {
        const lines = area.value.split("\n").map(s => s.trim()).filter(Boolean);
        const changed = await saveLines(key, lines, defaultLines(type, side, event));
        row.classList.toggle("changed", changed);
        row.querySelector("[data-reset]").disabled = !changed;
      });
      row.querySelector("[data-test]").addEventListener("click", () => {
        const lines = area.value.split("\n").map(s => s.trim()).filter(Boolean);
        const self = CHATTER_TYPES[type].label;
        const text = pickLine(`test:${key}`, lines, { ...SAMPLE, self });
        if (!text) return ui.notifications.info("В этом поле нет фраз: в этом случае NPC молчит.");
        say(self, text, side === "civil" ? "neutral" : side, { log: false });
      });
      row.querySelector("[data-reset]").addEventListener("click", async () => {
        await saveLines(key, null);
        this.render(false);
      });
    });
    root.querySelector("[data-enabled]")?.addEventListener("change", ev => game.settings.set(SYSTEM_ID, "npcChatter", ev.target.checked));
    root.querySelector("[data-chance]")?.addEventListener("change", ev => game.settings.set(SYSTEM_ID, "chatterChance", Number(ev.target.value)));
    root.querySelector("[data-export]")?.addEventListener("click", () => exportBank());
    root.querySelector("[data-import]")?.addEventListener("click", () => importBank().then(ok => ok && this.render(false)));
    root.querySelector("[data-reset-all]")?.addEventListener("click", async () => {
      if (!(await Dialog.confirm({ title: "Реплики NPC", content: "<p>Вернуть все стандартные фразы? Ваши правки пропадут.</p>" }))) return;
      await game.settings.set(SYSTEM_ID, "chatterBank", {});
      this.render(false);
    });
  }

  async _updateObject() {}
}

/** Записать фразы одного поля; совпадающие со стандартными правкой не считаются. Вернёт, есть ли правка. */
async function saveLines(key, lines, defaults = []) {
  const ov = foundry.utils.deepClone(overrides());
  const same = lines && lines.length === defaults.length && lines.every((l, i) => l === defaults[i]);
  if (!lines || same) delete ov[key];
  else ov[key] = lines;
  await game.settings.set(SYSTEM_ID, "chatterBank", ov);
  return !!lines && !same;
}

/** Все фразы (стандартные с правками) одним файлом: им можно поделиться с другим ведущим. */
export function fullBank() {
  const out = {};
  for (const type of Object.keys(CHATTER_TYPES)) {
    const civil = isCivil(type);
    for (const side of civil ? ["civil"] : Object.keys(CHATTER_SIDES))
      for (const ev of civil ? CIVIL_EVENTS : Object.keys(CHATTER_EVENTS)) out[bankKey(type, side, ev)] = linesFor(type, side, ev);
  }
  return out;
}

function exportBank() {
  saveDataToFile(JSON.stringify(fullBank(), null, 2), "application/json", "thunderbolt-replies.json");
}

/** Из файла: известные ключи со списком строк; в правки идёт только отличающееся от стандартного. */
export function bankFromFile(data) {
  const known = fullBank();
  const ov = {};
  let n = 0;
  for (const [key, lines] of Object.entries(data ?? {})) {
    if (!(key in known) || !Array.isArray(lines)) continue;
    const clean = lines.filter(l => typeof l === "string").map(l => l.trim()).filter(Boolean);
    const [type, side, event] = key.split(".");
    const def = defaultLines(type, side, event);
    n++;
    if (clean.length !== def.length || clean.some((l, i) => l !== def[i])) ov[key] = clean;
  }
  return { ov, n };
}

async function importBank() {
  const file = await new Promise(resolve => {
    const input = document.createElement("input");
    input.type = "file"; input.accept = ".json,application/json";
    input.addEventListener("change", () => resolve(input.files?.[0] ?? null));
    input.click();
  });
  if (!file) return false;
  let data;
  try { data = JSON.parse(await readTextFromFile(file)); } catch { ui.notifications.error("Не получилось прочитать файл: это не JSON."); return false; }
  const { ov, n } = bankFromFile(data);
  if (!n) { ui.notifications.warn("В файле нет фраз для NPC."); return false; }
  await game.settings.set(SYSTEM_ID, "chatterBank", ov);
  ui.notifications.info(`Фразы загружены: ${n} полей, из них изменено ${Object.keys(ov).length}.`);
  return true;
}
