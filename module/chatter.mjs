/* Переговоры NPC в эфире, как в Ace Combat: союзники и противник говорят при захвате, пуске, попадании, промахе,
   когда их подбили или сбили и когда рядом сбили своего. Гражданские зовут на помощь.
   События собирает клиент ведущего (сообщения чата, урон из actor.mjs, токены на сцене), раз в FLUSH_MS выбирает
   до MAX_LINES реплик и рассылает всем: каждый клиент показывает их субтитрами (если очередь свободна) и пишет в радиожурнал.
   Фразы берутся из data/chatter-bank.mjs с правками ведущего из окна «Реплики NPC». Правки и «Говорит в эфире» у каждой сцены свои
   (флаги сцены chatterBank и chatterMuted), новая сцена начинает со стандартных фраз. */
import { SYSTEM_ID } from "./config.mjs";
import { esc, resolveActor } from "./utils.mjs";
import { sideOf, hasRule } from "./scene.mjs";
import { say } from "./radio.mjs";
import { CHATTER_BANK, CHATTER_TYPES, CHATTER_SIDES, CHATTER_EVENTS, eventsFor } from "./data/chatter-bank.mjs";
import { allSquads, squadMembers } from "./squadrons.mjs";

const CHANNEL = `system.${SYSTEM_ID}`;
const FLUSH_MS = 700, MAX_LINES = 3;
// какие реплики выбирать первыми, если событий больше MAX_LINES
const PRIORITY = ["destroyed", "kill", "cheer", "wingmanDown", "damaged", "hit", "miss", "evade", "incoming", "guns", "bomb", "fire", "lock", "locked", "arrive"];
// в каком порядке их произносить: сначала стрелявший, потом сбитый, потом его ведомый и союзник игрока
const ORDER = ["arrive", "lock", "locked", "fire", "bomb", "guns", "incoming", "hit", "miss", "evade", "kill", "damaged", "destroyed", "wingmanDown", "cheer"];
// сбитый больше ничего не говорит, кроме последних слов
const SILENT_WHEN_DOWN = ["damaged", "incoming", "evade", "locked", "hit", "miss", "fire", "bomb", "guns", "lock", "arrive", "cheer"];

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
  // общие правки до 0.5.6, когда фразы были одни на весь мир: их можно перенести в сцену кнопкой в окне
  game.settings.register(SYSTEM_ID, "chatterBank", { scope: "world", config: false, type: Object, default: {} });
  game.settings.register(SYSTEM_ID, "chatterMuted", { scope: "world", config: false, type: Object, default: {} });
  // эскадрильи дуэлянтов: свои реплики по событиям и переговоры между собой { название: { replies, talk, auto } }
  game.settings.register(SYSTEM_ID, "squadChatter", {
    scope: "world", config: false, type: Object, default: {},
    onChange: () => { if (editor?.rendered) editor.render(false); }
  });
  game.settings.registerMenu(SYSTEM_ID, "chatterEditor", {
    name: "Реплики NPC", label: "Открыть реплики", hint: "Все фразы NPC по типам техники, сторонам и событиям: посмотреть, поменять, вернуть стандартные.",
    icon: "fas fa-comments", type: ChatterMenu, restricted: true
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
  // новый раунд: какая-нибудь эскадрилья иногда переговаривается между собой
  Hooks.on("updateCombat", (combat, change) => {
    if (isLead() && change && "round" in change && combat?.started) setTimeout(() => autoTalk(combat), 1800);
  });
  // окно показывает фразы открытой сцены
  Hooks.on("canvasReady", () => { if (editor?.rendered) editor.render(false); });
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
    // дальше цели берутся по uuid: имя в эфире, а не имя на карточке
    queue({ event: "locked", speaker: f.rwr.target });
    return;
  }
  const c = f.card;
  if (!c) return;
  if (c.type === "volley") {
    for (const r of c.targets ?? []) {
      if (r.missing || r.ship) continue;
      const shooter = [r.sourceUuid, ...(r.shooterUuids ?? [])].find(u => resolveActor(u)?.type === "npc");
      if (shooter) queue({ event: r.hit ? "hit" : "miss", speaker: shooter, target: radioName(r.uuid, r.name) });
      if (!r.hit) queue({ event: "evade", speaker: r.uuid });
    }
    return;
  }
  if (!c.attack || !c.actorUuid) return;
  // пушка: стрелок кричит «огонь», исход слышен от цели (ушёл, подбит, сбит — урон и сбитого пришлёт actor.mjs)
  if (c.instant) {
    queue({ event: "guns", speaker: c.actorUuid, target: radioName(c.targetUuid, c.targetName) });
    if (c.targetUuid && c.dc !== null && c.dc !== undefined && !succeeded(c)) queue({ event: "evade", speaker: c.targetUuid });
    return;
  }
  // ракета по наземной или морской цели: у авиации это удар по земле (бомбы, ракеты по объекту)
  queue({ event: c.tkind === "ground" ? "bomb" : "fire", speaker: c.actorUuid, target: radioName(c.targetUuid, c.targetName) });
  if (c.targetUuid) queue({ event: "incoming", speaker: c.targetUuid });
}

const radioName = (uuid, fallback) => (uuid && nameOf(resolveActor(uuid))) || fallback || "";

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

/** Сбитый: его последние слова, реплика сбившего, ближайшего своего и (если сбил игрок) союзника рядом с игроком. */
function expandDown(ev) {
  const victim = resolveActor(ev.victim);
  if (!victim) return [];
  const name = nameOf(victim);
  const out = [{ event: "destroyed", speaker: ev.victim }];
  const killer = ev.killer ? resolveActor(ev.killer) : null;
  if (ev.killer) out.push({ event: "kill", speaker: ev.killer, target: name });
  const mate = nearestMate(victim);
  if (mate) out.push({ event: "wingmanDown", speaker: mate.actor.uuid, fallen: name });
  const vType = chatterType(victim);
  if (killer?.type === "pilot" && team(sideOf(victim)) !== "ally" && !isCivil(vType)) {
    const fan = nearestSpeaker(killer, a => !isCivil(chatterType(a)) && team(sideOf(a)) === "ally");
    if (fan) out.push({ event: "cheer", speaker: fan.actor.uuid, target: name, killer: nameOf(killer) });
  }
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
  // переговоры эскадрильи идут подряд и не выпадают из очереди субтитров
  if (line?.text) say(line.speaker, line.text, line.side, { low: !line.queue });
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
const isAce = a => a?.type === "npc" && a.system?.tier === "ace" && !!chatterType(a);
const isSquad = a => a?.type === "npc" && a.system?.tier === "duelist" && !!a.system?.squad && !!chatterType(a);
const quiet = a => !!a?.getFlag?.(SYSTEM_ID, "quiet");
/** Сцена, чьи фразы правит окно: открытая у ведущего. */
const editScene = () => game.scenes?.viewed ?? game.combat?.scene ?? null;
/** Типы, которые молчат на сцене (галочка «Говорит в эфире»): { boss: true }. */
const muted = (scene = editScene()) => ({ ...(scene?.getFlag?.(SYSTEM_ID, "chatterMuted") ?? {}) });
const team = s => (s === "player" ? "ally" : s);
const dead = a => !!a?.statuses?.has(CONFIG.specialStatusEffects.DEFEATED) || !!a?.system?.markers?.doom;

function tokenDoc(actor) {
  if (!actor) return null;
  if (actor.isToken) return actor.token ?? null;
  // открыта другая сцена: токен ищется на сцене боя
  return actor.getActiveTokens?.(false, true)?.[0] ?? game.combat?.scene?.tokens.find(t => t.actorId === actor.id) ?? null;
}

/**
 * Имя в эфире: «Позывной в эфире» с листа NPC, позывной пилота, имя, которое дали копии на листе токена
 * (у несвязанного токена оно расходится с именем токена), иначе имя токена. own: false — без поля «Позывной в эфире».
 */
export function nameOf(actor, { own = true } = {}) {
  if (!actor) return "";
  const call = own ? String(actor.getFlag?.(SYSTEM_ID, "callsign") ?? "").trim() : "";
  if (call) return call;
  if (actor.system?.callsign) return actor.system.callsign;
  if (actor.isToken) {
    const base = actor.token?.baseActor ?? game.actors?.get?.(actor.token?.actorId);
    if (base && actor.name && actor.name !== base.name) return actor.name;
  }
  return tokenDoc(actor)?.name || actor.name;
}

/** Ближайший к from живой открытый NPC, который может говорить и подходит под fits. */
function nearestSpeaker(from, fits) {
  const ft = tokenDoc(from);
  const scene = ft?.parent ?? game.combat?.scene ?? game.scenes?.viewed;
  if (!scene) return null;
  const list = scene.tokens.filter(t => {
    const a = t.actor;
    if (!a || t.hidden || t.id === ft?.id || dead(a) || quiet(a) || !chatterType(a)) return false;
    return fits(a);
  });
  const d = t => (ft ? Math.hypot(t.x - ft.x, t.y - ft.y) : 0);
  return list.sort((a, b) => d(a) - d(b))[0] ?? null;
}

/** Ближайший свой у сбитого: той же стороны, для гражданского — другой гражданский. */
function nearestMate(victim) {
  const civil = isCivil(chatterType(victim)), side = team(sideOf(victim));
  return nearestSpeaker(victim, a => isCivil(chatterType(a)) === civil && (civil || team(sideOf(a)) === side));
}

const bankSide = (actor, type) => (isCivil(type) ? "civil" : sideOf(actor) === "ally" ? "ally" : "enemy");
export const bankKey = (type, side, event) => `${type}.${side}.${event}`;
const legacy = k => { try { return game.settings.get(SYSTEM_ID, k) ?? {}; } catch { return {}; } };

/** Правки сцены плоским списком { "air.enemy.fire": [...] }. Во флаге они вложены: chatterBank.air.enemy.fire. */
function overrides(scene = editScene()) {
  const out = {};
  for (const [type, sides] of Object.entries(scene?.getFlag?.(SYSTEM_ID, "chatterBank") ?? {}))
    for (const [side, evs] of Object.entries(sides ?? {}))
      for (const [ev, lines] of Object.entries(evs ?? {})) if (Array.isArray(lines)) out[bankKey(type, side, ev)] = lines;
  return out;
}
/** Плоский список правок → вложенный объект для флага сцены. */
function nest(flat) {
  const out = {};
  for (const [key, lines] of Object.entries(flat)) {
    const [type, side, ev] = key.split(".");
    ((out[type] ??= {})[side] ??= {})[ev] = lines;
  }
  return out;
}

/** Стандартные фразы (с подстановкой из запасного типа: вертолёт → самолёт и т. п.). */
export function defaultLines(type, side, event) {
  const own = CHATTER_BANK[type]?.[side]?.[event];
  if (own) return own;
  const fb = CHATTER_TYPES[type]?.fallback;
  return fb ? defaultLines(fb, side, event) : [];
}

/** Фразы с правками ведущего на этой сцене. Пустой список в правках — тип молчит в этом событии. */
export function linesFor(type, side, event, scene = editScene()) {
  const o = overrides(scene)[bankKey(type, side, event)];
  return Array.isArray(o) ? o : defaultLines(type, side, event);
}

/** Подставить имена; фраза с подстановкой, которой нет, не годится. */
export function fill(text, vars) {
  let ok = true;
  const out = text.replace(/\{(target|fallen|killer|self)\}/g, (_, k) => { if (!vars[k]) ok = false; return vars[k] ?? ""; });
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
  if (quiet(actor)) return null;
  // удар по земле у тех, у кого его нет (наземная техника, корабли), звучит как обычный пуск
  let event = e.event;
  if (!eventsFor(type, bankSide(actor, type)).includes(event)) {
    event = CHATTER_EVENTS[event]?.instead;
    if (!event || !eventsFor(type, bankSide(actor, type)).includes(event)) return null;
  }
  const tok = tokenDoc(actor);
  // скрытый токен не выдаёт себя в эфире
  if (!tok || tok.hidden) return null;
  if (e.event !== "destroyed" && dead(actor)) return null;
  const side = bankSide(actor, type);
  const self = nameOf(actor);
  const vars = { target: e.target, fallen: e.fallen, killer: e.killer, self };
  // ас со своими репликами говорит ими (и когда его тип молчит); если ни одна не подошла, общими фразами
  const own = isAce(actor) ? actor.getFlag?.(SYSTEM_ID, "replies")?.[event] : null;
  let text = Array.isArray(own) && own.length ? pickLine(`ace:${actor.uuid}:${event}`, own, vars) : null;
  // машина эскадрильи дуэлянтов говорит репликами эскадрильи (и когда её тип молчит)
  if (!text && isSquad(actor)) {
    const sq = squadData(actor.system.squad).replies?.[event];
    if (Array.isArray(sq) && sq.length) text = pickLine(`squad:${actor.system.squad}:${event}`, sq, vars);
  }
  const scene = tok.parent ?? editScene();
  if (!text && muted(scene)[type]) return null;
  text ??= pickLine(bankKey(type, side, event), linesFor(type, side, event, scene), vars);
  return text ? { speaker: self, text, side: sideOf(actor) } : null;
}

/* ---------- эскадрильи дуэлянтов: свои реплики и переговоры между собой ---------- */

/** Реплики эскадрильи: { replies: { событие: [...] }, talk: [[строки обмена], …], auto }. */
export function squadData(name) {
  try { return game.settings.get(SYSTEM_ID, "squadChatter")?.[name] ?? {}; } catch { return {}; }
}

async function setSquadData(name, patch) {
  const all = foundry.utils.deepClone(game.settings.get(SYSTEM_ID, "squadChatter") ?? {});
  const d = { ...(all[name] ?? {}), ...patch };
  for (const [ev, lines] of Object.entries(d.replies ?? {})) if (!lines?.length) delete d.replies[ev];
  all[name] = d;
  return game.settings.set(SYSTEM_ID, "squadChatter", all);
}

const squadNoOf = t => Number(t.getFlag?.(SYSTEM_ID, "squadNo")) || null;
/** Кто из эскадрильи может говорить: живые открытые машины на сцене, по номерам. */
export function squadSpeakers(name, scene = game.combat?.scene ?? editScene()) {
  return (scene?.tokens ?? []).filter(t => isSquad(t.actor) && t.actor.system.squad === name && !t.hidden && !dead(t.actor) && !quiet(t.actor))
    .sort((a, b) => (squadNoOf(a) ?? 99) - (squadNoOf(b) ?? 99) || String(a.name).localeCompare(String(b.name), "ru"));
}

/** Текст поля «Между собой» → обмены: пустая строка разделяет обмены. */
export const talkBlocks = text => String(text ?? "").split(/\n\s*\n/).map(splitLines).filter(b => b.length);

/**
 * Один обмен репликами: строки по очереди говорят разные машины, первая — ведущий (меньший номер).
 * «2: текст» отдаёт строку машине №2; если её нет на сцене, обмен не годится. {self} — говорящий,
 * {mate} — тот, кому он отвечает (для первой строки — следующий говорящий), {lead} — ведущий.
 */
export function talkLines(block, speakers) {
  if (!Array.isArray(block) || speakers.length < 2) return null;
  const who = [];
  let k = 0;
  for (const raw of block) {
    const m = /^(\d{1,2})\s*[:)]\s*(.+)$/.exec(raw);
    let tok = null;
    if (m) { tok = speakers.find(t => squadNoOf(t) === Number(m[1])); if (!tok) return null; }
    else {
      tok = speakers[k % speakers.length];
      if (tok === who.at(-1)?.tok) { k++; tok = speakers[k % speakers.length]; }
      k++;
    }
    who.push({ tok, text: m ? m[2] : raw });
  }
  const lead = nameOf(speakers[0].actor);
  const out = [];
  for (let i = 0; i < who.length; i++) {
    const self = nameOf(who[i].tok.actor);
    const other = (i > 0 ? who.slice(0, i).reverse() : who.slice(1)).find(x => x.tok !== who[i].tok)?.tok;
    const text = fill(who[i].text.replace(/\{(mate|lead)\}/g, (_, v) => (v === "lead" ? lead : other ? nameOf(other.actor) : "{mate}")), { self });
    if (!text || text.includes("{mate}")) return null;
    out.push({ speaker: self, text, side: sideOf(who[i].tok.actor), queue: true });
  }
  return out;
}

/** Пустить в эфир случайный обмен эскадрильи (local — услышит только ведущий, в журнал не попадёт). */
export function playSquadTalk(name, { local = false, blocks = null, scene } = {}) {
  const all = blocks ?? squadData(name).talk ?? [];
  if (!all.length) { if (local) ui.notifications?.info("У эскадрильи нет переговоров: впишите обмены в поле «Между собой»."); return null; }
  const speakers = squadSpeakers(name, scene);
  const fits = all.map((b, i) => ({ i, lines: talkLines(b, speakers) })).filter(x => x.lines);
  if (!fits.length) {
    ui.notifications?.info(speakers.length < 2 ? `Эскадрилье «${name}» нужно две живые открытые машины на сцене.` : `Ни один обмен эскадрильи «${name}» не подходит машинам на сцене (номера в начале строк).`);
    return null;
  }
  const key = `talk:${name}`, fresh = fits.length > 1 ? fits.filter(x => x.i !== lastPick.get(key)) : fits;
  const pick = fresh[Math.floor(Math.random() * fresh.length)];
  lastPick.set(key, pick.i);
  for (const line of pick.lines) local ? say(line.speaker, line.text, line.side, { log: false }) : broadcast(line);
  return pick.lines;
}

/** Начало раунда: с вероятностью вполовину «о мелочах» одна из эскадрилий на сцене боя переговаривается. */
export function autoTalk(combat = game.combat) {
  if (!enabled() || !isLead()) return null;
  const scene = combat?.scene;
  const names = Object.keys(allSquads()).filter(n => {
    const d = squadData(n);
    return d.auto !== false && d.talk?.length && squadSpeakers(n, scene).length >= 2;
  });
  if (!names.length || Math.random() * 200 >= chance()) return null;
  return playSquadTalk(names[Math.floor(Math.random() * names.length)], { scene });
}

/* ---------- окно «Реплики NPC» ---------- */

let editor = null;
/** Открыть окно; actor — сразу на личных репликах этого аса. */
export function openChatterEditor(actor = null) {
  if (!game.user.isGM) return;
  editor ??= new ChatterEditor();
  if (actor?.uuid) editor.type = `ace:${actor.uuid}`;
  editor.render(true);
}

/** Открыть окно на репликах эскадрильи дуэлянтов. */
export function openSquadChatter(name) {
  if (!game.user.isGM) return;
  editor ??= new ChatterEditor();
  editor.type = `squad:${name}`;
  editor.render(true);
}

const SAMPLE = { target: "Цель", fallen: "Ведомый", killer: "Гроза-1", self: "" };
const splitLines = v => v.split("\n").map(s => s.trim()).filter(Boolean);

/** Асы: на сцене боя (или открытой) — токены, у каждого свои реплики; в актёрах — заготовка для всех его токенов. */
function aceList() {
  const scene = editScene();
  const onScene = (scene?.tokens ?? []).filter(t => isAce(t.actor)).map(t => ({ actor: t.actor, name: nameOf(t.actor), where: "сцена" }));
  const seen = new Set(onScene.map(x => x.actor.uuid));
  const inDir = (game.actors ?? []).filter(a => isAce(a) && !seen.has(a.uuid)).map(a => ({ actor: a, name: nameOf(a), where: "актёр" }));
  return { onScene, inDir };
}

/** Кнопка в настройках открывает то же окно, что и панель AWACS, а не второе. */
class ChatterMenu extends FormApplication {
  render() { openChatterEditor(); return this; }
}

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

  /** Выбранный ас (или null, если выбран тип). */
  get ace() {
    if (!this.type?.startsWith("ace:")) return null;
    const a = resolveActor(this.type.slice(4));
    return isAce(a) ? a : null;
  }

  /** Выбранная эскадрилья дуэлянтов (или null). */
  get squad() {
    if (!this.type?.startsWith("squad:")) return null;
    const name = this.type.slice(6);
    return name in allSquads() ? name : null;
  }

  async _renderInner() {
    if (this.type?.startsWith("ace:") && !this.ace) this.type = "air";
    if (this.type?.startsWith("squad:") && !this.squad) this.type = "air";
    const scene = editScene();
    const ov = overrides(scene), mute = muted(scene);
    const aces = aceList();
    const nav = Object.entries(CHATTER_TYPES).map(([k, t], i, all) => {
      const changed = Object.keys(ov).some(x => x.startsWith(`${k}.`));
      const gap = t.civil && !all[i - 1]?.[1].civil ? `<h4>Гражданские</h4>` : i === 0 ? `<h4>Военные</h4>` : "";
      return `${gap}<button type="button" data-type="${k}" class="${k === this.type ? "on" : ""}${mute[k] ? " muted" : ""}">${esc(t.label)}${changed ? ` <i class="fas fa-pen" title="есть правки"></i>` : ""}${mute[k] ? ` <i class="fas fa-volume-xmark" title="молчит"></i>` : ""}</button>`;
    }).join("");
    const aceBtn = x => {
      const own = Object.values(x.actor.getFlag?.(SYSTEM_ID, "replies") ?? {}).some(l => Array.isArray(l) && l.length);
      const key = `ace:${x.actor.uuid}`;
      return `<button type="button" data-type="${esc(key)}" class="${key === this.type ? "on" : ""}">${esc(x.name)}${own ? ` <i class="fas fa-pen" title="есть свои реплики"></i>` : ""}</button>`;
    };
    const aceNav = `<h4>Асы на сцене</h4>${aces.onScene.map(aceBtn).join("") || `<p class="tb-hint">Нет: уровень «Ас» на листе NPC.</p>`}`
      + (aces.inDir.length ? `<h4>Асы в актёрах</h4>${aces.inDir.map(aceBtn).join("")}` : "");
    const squads = Object.keys(allSquads()).sort((a, b) => a.localeCompare(b, "ru"));
    const squadNav = `<h4>Эскадрильи дуэлянтов</h4>${squads.map(n => {
      const d = squadData(n), key = `squad:${n}`;
      const own = Object.values(d.replies ?? {}).some(l => l?.length), talk = d.talk?.length;
      const here = squadSpeakers(n, scene).length;
      return `<button type="button" data-type="${esc(key)}" class="${key === this.type ? "on" : ""}${here ? "" : " muted"}">${esc(n)}${own ? ` <i class="fas fa-pen" title="есть свои реплики"></i>` : ""}${talk ? ` <i class="fas fa-comments" title="есть переговоры между собой"></i>` : ""}</button>`;
    }).join("") || `<p class="tb-hint">Нет: панель AWACS, «Собрать из выделенных».</p>`}`;
    const ace = this.ace, squad = this.squad;
    const main = ace ? this.#aceView(ace) : squad ? this.#squadView(squad) : scene ? this.#typeView(ov, mute, scene) : `<p class="tb-hint">Откройте сцену: фразы по типам у каждой сцены свои.</p>`;
    const pct = chance();
    return $(`<form class="tb-chatter-body">
      <nav class="tb-chatter-nav">${nav}${aceNav}${squadNav}</nav>
      <section class="tb-chatter-main">${main}</section>
      <footer class="tb-chatter-foot">
        <label><input type="checkbox" data-enabled ${enabled() ? "checked" : ""}> Переговоры в эфире</label>
        <label>О мелочах: <select data-chance>${[0, 20, 40, 60, 80, 100].map(n => `<option value="${n}" ${n === pct ? "selected" : ""}>${n}%</option>`).join("")}${[0, 20, 40, 60, 80, 100].includes(pct) ? "" : `<option selected value="${pct}">${pct}%</option>`}</select></label>
        <span class="tb-spacer"></span>
        <button type="button" data-export ${scene ? "" : "disabled"} title="Сохранить фразы типов этой сцены в файл JSON: так их можно перенести в другую сцену (личные реплики асов хранятся в самих асах)"><i class="fas fa-file-export"></i> В файл</button>
        <button type="button" data-import ${scene ? "" : "disabled"} title="Загрузить фразы типов из файла JSON в эту сцену"><i class="fas fa-file-import"></i> Из файла</button>
        <button type="button" data-reset-all ${scene ? "" : "disabled"} title="Вернуть на этой сцене все стандартные фразы типов"><i class="fas fa-rotate-left"></i> Всё стандартное</button>
      </footer></form>`);
  }

  #row({ key, label, hint, value, placeholder = "", changed, resetTitle }) {
    return `<div class="tb-chatter-ev${changed ? " changed" : ""}" data-key="${esc(key)}">
      <div class="tb-chatter-ev-head"><b>${esc(label)}</b><small>${esc(hint)}</small>
        <span class="tb-chatter-btns"><button type="button" data-test title="Послушать случайную фразу (только у вас)"><i class="fas fa-play"></i></button>
        <button type="button" data-reset title="${esc(resetTitle)}" ${changed ? "" : "disabled"}><i class="fas fa-rotate-left"></i></button></span></div>
      <textarea rows="3" spellcheck="true" placeholder="${esc(placeholder)}">${esc(value)}</textarea></div>`;
  }

  #typeView(ov, mute, scene) {
    const civil = isCivil(this.type);
    const side = civil ? "civil" : this.side;
    const events = eventsFor(this.type, side);
    const t = CHATTER_TYPES[this.type];
    const sides = civil ? "" : `<div class="tb-chatter-sides">${Object.entries(CHATTER_SIDES).map(([k, l]) =>
      `<button type="button" data-side="${k}" class="tb-side-${k} ${k === side ? "on" : ""}">${esc(l)}</button>`).join("")}</div>`;
    const rows = events.map(ev => {
      const key = bankKey(this.type, side, ev), e = CHATTER_EVENTS[ev];
      return this.#row({ key, label: e.label, hint: e.hint, value: linesFor(this.type, side, ev, scene).join("\n"), changed: Array.isArray(ov[key]), resetTitle: "Вернуть стандартные фразы" });
    }).join("");
    const old = Object.keys(legacy("chatterBank")).length + Object.keys(legacy("chatterMuted")).length;
    const carry = old ? ` <button type="button" data-legacy class="tb-chatter-legacy" title="До версии 0.5.6 фразы были одни на весь мир. Перенести те правки в эту сцену"><i class="fas fa-file-import"></i> Общие правки прошлой версии</button>` : "";
    return `<header><h3>${esc(t.label)} <small class="tb-muted">· сцена «${esc(scene.name)}»</small>${carry}</h3>
        <label class="tb-chatter-voice"><input type="checkbox" data-voice ${mute[this.type] ? "" : "checked"}> Говорит в эфире</label>
        <p class="tb-hint">${esc(t.hint)}. Одна фраза на строку, из них выбирается случайная. {target} — цель, {fallen} — сбитый свой, {killer} — пилот игрока, {self} — сам говорящий. Пустое поле: в этом случае молчит. Фразы и галочка действуют только на этой сцене, новая сцена начинает со стандартных.${civil ? "" : " Асы со своими репликами говорят ими, даже если тип молчит."}</p>${sides}</header>
      <div class="tb-chatter-list${mute[this.type] ? " muted" : ""}">${rows}</div>`;
  }

  #aceView(ace) {
    const type = chatterType(ace) ?? "air", side = bankSide(ace, type);
    const own = ace.getFlag(SYSTEM_ID, "replies") ?? {};
    const events = eventsFor(type, side);
    const name = nameOf(ace);
    const scene = editScene();
    const rows = events.map(ev => {
      const e = CHATTER_EVENTS[ev], lines = Array.isArray(own[ev]) ? own[ev] : [];
      return this.#row({ key: `ace.${ev}`, label: e.label, hint: e.hint, value: lines.join("\n"), placeholder: linesFor(type, side, ev, scene).join("\n"),
        changed: lines.length > 0, resetTitle: "Убрать свои фразы: снова общие фразы типа" });
    }).join("");
    const where = ace.isToken ? "Токен на сцене: реплики только у этого токена."
      : "Актёр: реплики получат все его токены, у которых нет своих.";
    return `<header><h3>${esc(name)}</h3>
        <label class="tb-chatter-call">Позывной в эфире <input type="text" data-callsign value="${esc(ace.getFlag(SYSTEM_ID, "callsign") ?? "")}" placeholder="${esc(nameOf(ace, { own: false }))}"></label>
        <p class="tb-hint">Ас · ${esc(CHATTER_TYPES[type].label)} · ${esc(CHATTER_SIDES[side] ?? "")}. ${where} Пустое поле: говорит общими фразами типа (видны серым). {target} — цель, {fallen} — сбитый свой, {killer} — пилот игрока, {self} — его имя.</p></header>
      <div class="tb-chatter-list">${rows}</div>`;
  }

  /** Образец машины эскадрильи: по нему тип, сторона и общие фразы-подсказки. */
  #squadSample(name) {
    return squadSpeakers(name, editScene())[0]?.actor ?? squadMembers(name).find(a => chatterType(a)) ?? null;
  }

  #squadView(name) {
    const d = squadData(name), sample = this.#squadSample(name);
    const type = (sample && chatterType(sample)) ?? "air", side = sample ? bankSide(sample, type) : "enemy";
    const scene = editScene(), own = d.replies ?? {};
    const rows = eventsFor(type, side).map(ev => {
      const e = CHATTER_EVENTS[ev], lines = Array.isArray(own[ev]) ? own[ev] : [];
      return this.#row({ key: `squad.${ev}`, label: e.label, hint: e.hint, value: lines.join("\n"), placeholder: linesFor(type, side, ev, scene).join("\n"),
        changed: lines.length > 0, resetTitle: "Убрать свои фразы: снова общие фразы типа" });
    }).join("");
    const here = squadSpeakers(name, scene);
    const talk = (d.talk ?? []).map(b => b.join("\n")).join("\n\n");
    const example = "Жёлтый-4, держись крыла.\nПонял, ведущий. Иду за тобой.\n\n2: {lead}, вижу их внизу.\n1: Не торопись, {mate}. Ждём команды.";
    return `<header><h3>Эскадрилья «${esc(name)}»</h3>
        <p class="tb-hint">Дуэлянты · ${esc(CHATTER_TYPES[type].label)} · ${esc(CHATTER_SIDES[side] ?? "")} · на сцене: ${here.length ? here.map(t => esc(nameOf(t.actor))).join(", ") : "никого"}. Реплики получат все машины эскадрильи; ас и личный «Позывной в эфире» остаются своими. Пустое поле: общие фразы типа (видны серым).</p></header>
      <div class="tb-chatter-list">
        <div class="tb-chatter-ev tb-chatter-talk${talk ? " changed" : ""}" data-talk>
          <div class="tb-chatter-ev-head"><b>Между собой</b><small>переговоры внутри эскадрильи</small>
            <span class="tb-chatter-btns"><button type="button" data-talk-test title="Послушать случайный обмен (только у вас)"><i class="fas fa-play"></i></button>
            <button type="button" data-talk-air title="Пустить случайный обмен в эфир всем"><i class="fas fa-tower-broadcast"></i></button></span></div>
          <p class="tb-hint">Обмены разделяйте пустой строкой. Строки обмена по очереди говорят разные машины на сцене, первая — ведущий (меньший номер). «2: …» в начале строки отдаёт её машине №2. {self} — говорящий, {mate} — кому он отвечает, {lead} — ведущий.</p>
          <textarea rows="8" spellcheck="true" placeholder="${esc(example)}">${esc(talk)}</textarea>
          <label class="tb-chatter-voice"><input type="checkbox" data-talk-auto ${d.auto === false ? "" : "checked"}> Сами в начале раунда, иногда (вполовину реже, чем «о мелочах»)</label>
        </div>
        <h4 class="tb-chatter-sub">Реплики в бою</h4>${rows}</div>`;
  }

  activateListeners(html) {
    super.activateListeners(html);
    const root = html[0] ?? html;
    const ace = this.ace, squad = this.squad, scene = editScene();
    const sample = squad ? this.#squadSample(squad) : null;
    root.querySelectorAll("[data-type]").forEach(b => b.addEventListener("click", () => { this.type = b.dataset.type; this.render(false); }));
    root.querySelectorAll("[data-side]").forEach(b => b.addEventListener("click", () => { this.side = b.dataset.side; this.render(false); }));
    root.querySelector("[data-callsign]")?.addEventListener("change", async ev => {
      await setCallsign(ace, ev.target.value);
      this.render(false);
    });
    root.querySelector("[data-voice]")?.addEventListener("change", async ev => {
      if (ev.target.checked) await scene.unsetFlag(SYSTEM_ID, `chatterMuted.${this.type}`);
      else await scene.setFlag(SYSTEM_ID, `chatterMuted.${this.type}`, true);
      this.render(false);
    });
    root.querySelectorAll(".tb-chatter-ev").forEach(row => {
      const key = row.dataset.key;
      const area = row.querySelector("textarea");
      const mark = changed => { row.classList.toggle("changed", changed); row.querySelector("[data-reset]").disabled = !changed; };
      if (!key) return;
      if (squad) {
        const event = key.slice(6);
        area.addEventListener("change", async () => {
          const lines = splitLines(area.value);
          await setSquadData(squad, { replies: { ...(squadData(squad).replies ?? {}), [event]: lines } });
          mark(lines.length > 0);
        });
        row.querySelector("[data-reset]").addEventListener("click", async () => {
          await setSquadData(squad, { replies: { ...(squadData(squad).replies ?? {}), [event]: [] } });
          this.render(false);
        });
      } else if (ace) {
        const event = key.slice(4);
        area.addEventListener("change", async () => { const lines = splitLines(area.value); await saveAceLines(ace, event, lines); mark(lines.length > 0); });
        row.querySelector("[data-reset]").addEventListener("click", async () => { await saveAceLines(ace, event, []); this.render(false); });
      } else {
        const [type, side, event] = key.split(".");
        area.addEventListener("change", async () => mark(await saveLines(scene, key, splitLines(area.value), defaultLines(type, side, event))));
        row.querySelector("[data-reset]").addEventListener("click", async () => { await saveLines(scene, key, null); this.render(false); });
      }
      row.querySelector("[data-test]").addEventListener("click", () => {
        const lines = splitLines(area.value || area.placeholder);
        const who = ace ?? sample;
        const type = who ? chatterType(who) ?? "air" : squad ? "air" : key.split(".")[0];
        const side = who ? bankSide(who, type) : squad ? "enemy" : key.split(".")[1];
        const self = who ? nameOf(who) : squad ?? CHATTER_TYPES[type].label;
        const text = pickLine(`test:${key}`, lines, { ...SAMPLE, self });
        if (!text) return ui.notifications.info("В этом поле нет фраз: в этом случае NPC молчит.");
        say(self, text, who ? sideOf(who) : side === "civil" ? "neutral" : side, { log: false });
      });
    });
    const talk = root.querySelector("[data-talk]");
    if (talk && squad) {
      const area = talk.querySelector("textarea");
      area.addEventListener("change", async () => { const blocks = talkBlocks(area.value); await setSquadData(squad, { talk: blocks }); talk.classList.toggle("changed", blocks.length > 0); });
      talk.querySelector("[data-talk-auto]").addEventListener("change", ev => setSquadData(squad, { auto: ev.target.checked }));
      talk.querySelector("[data-talk-test]").addEventListener("click", () => playSquadTalk(squad, { local: true, blocks: talkBlocks(area.value || area.placeholder), scene }));
      talk.querySelector("[data-talk-air]").addEventListener("click", () => playSquadTalk(squad, { blocks: talkBlocks(area.value), scene }));
    }
    root.querySelector("[data-enabled]")?.addEventListener("change", ev => game.settings.set(SYSTEM_ID, "npcChatter", ev.target.checked));
    root.querySelector("[data-chance]")?.addEventListener("change", ev => game.settings.set(SYSTEM_ID, "chatterChance", Number(ev.target.value)));
    root.querySelector("[data-export]")?.addEventListener("click", () => exportBank(scene));
    root.querySelector("[data-import]")?.addEventListener("click", () => importBank(scene).then(ok => ok && this.render(false)));
    root.querySelector("[data-reset-all]")?.addEventListener("click", async () => {
      if (!(await Dialog.confirm({ title: "Реплики NPC", content: `<p>Вернуть на сцене «${esc(scene.name)}» все стандартные фразы типов? Правки этой сцены пропадут. Другие сцены и личные реплики асов останутся.</p>` }))) return;
      await scene.unsetFlag(SYSTEM_ID, "chatterBank");
      this.render(false);
    });
    root.querySelector("[data-legacy]")?.addEventListener("click", async () => {
      const bank = { ...legacy("chatterBank"), ...overrides(scene) }, mute = { ...legacy("chatterMuted"), ...muted(scene) };
      await setSceneBank(scene, bank, mute);
      ui.notifications.info(`Сцена «${scene.name}»: перенесены общие правки прошлой версии (полей: ${Object.keys(legacy("chatterBank")).length}). Правки самой сцены остались поверх.`);
      this.render(false);
    });
  }

  async _updateObject() {}
}

/** «Позывной в эфире»: пусто — снова имя с листа или токена. */
export async function setCallsign(actor, value) {
  const v = String(value ?? "").trim();
  if (v) return actor.setFlag(SYSTEM_ID, "callsign", v);
  if (actor.getFlag(SYSTEM_ID, "callsign") !== undefined) return actor.update({ [`flags.${SYSTEM_ID}.-=callsign`]: null });
}

/** Личные реплики аса: флаг replies на актёре (у несвязанного токена — в его дельте). Пустой список убирает поле. */
async function saveAceLines(actor, event, lines) {
  if (lines.length) return actor.setFlag(SYSTEM_ID, `replies.${event}`, lines);
  if (actor.getFlag(SYSTEM_ID, `replies.${event}`) !== undefined) return actor.update({ [`flags.${SYSTEM_ID}.replies.-=${event}`]: null });
}

/** Записать фразы одного поля на сцене; совпадающие со стандартными правкой не считаются. Вернёт, есть ли правка. */
async function saveLines(scene, key, lines, defaults = []) {
  const same = lines && lines.length === defaults.length && lines.every((l, i) => l === defaults[i]);
  if (!lines || same) { if (key in overrides(scene)) await scene.unsetFlag(SYSTEM_ID, `chatterBank.${key}`); }
  else await scene.setFlag(SYSTEM_ID, `chatterBank.${key}`, lines);
  return !!lines && !same;
}

/** Заменить все правки сцены (setFlag слил бы старые и новые, поэтому сначала убрать). mute — заодно галочки «Говорит в эфире». */
export async function setSceneBank(scene, flat, mute = null) {
  const data = { [`flags.${SYSTEM_ID}.-=chatterBank`]: null };
  if (mute) data[`flags.${SYSTEM_ID}.-=chatterMuted`] = null;
  await scene.update(data);
  const set = {};
  if (Object.keys(flat).length) set[`flags.${SYSTEM_ID}.chatterBank`] = nest(flat);
  if (mute && Object.keys(mute).length) set[`flags.${SYSTEM_ID}.chatterMuted`] = mute;
  if (Object.keys(set).length) await scene.update(set);
}

/** Все фразы сцены (стандартные с правками) одним файлом: им можно поделиться с другим ведущим или перенести в другую сцену. */
export function fullBank(scene = editScene()) {
  const out = {};
  for (const type of Object.keys(CHATTER_TYPES)) {
    const civil = isCivil(type);
    for (const side of civil ? ["civil"] : Object.keys(CHATTER_SIDES))
      for (const ev of eventsFor(type, side)) out[bankKey(type, side, ev)] = linesFor(type, side, ev, scene);
  }
  return out;
}

function exportBank(scene) {
  const slug = String(scene?.name ?? "").trim().replace(/[\\/:*?"<>|\s]+/g, "-").slice(0, 40);
  saveDataToFile(JSON.stringify(fullBank(scene), null, 2), "application/json", `thunderbolt-replies${slug ? "-" + slug : ""}.json`);
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

async function importBank(scene) {
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
  await setSceneBank(scene, ov);
  ui.notifications.info(`Сцена «${scene.name}»: фразы загружены, ${n} полей, из них изменено ${Object.keys(ov).length}.`);
  return true;
}
