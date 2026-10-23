/* Отмена и возврат действий для ведущего. Клиент ведущего пишет журнал всех изменений боя: пилоты и NPC (лист, токен без связи),
   их предметы и эффекты (статус «сбит»), токены, участники трекера, отметки боя (раунд и ход не трогаем: для них есть стрелки трекера)
   и карточки чата. Изменения одного игрока подряд (меньше чем через 1,5 с) — один шаг: Fox Two! = карточка, захват, боезапас, урон.
   Урон и метка, которые клиент цели поставил следом за чужой карточкой, прилипают к её шагу.
   Отмена откатывает шаг целиком (карточка исчезает, HP, метки, боезапас, место токена — как было), возврат делает его снова.
   Чтобы знать прежние значения при чужих изменениях, клиент ведущего держит копию документов и обновляет её после каждого изменения.
   Свои откаты идут с опцией tbUndo: журнал их не пишет, и обработчики системы по ней не повторяют побочные действия (звук, сбитый, триггеры). */
import { SYSTEM_ID } from "./config.mjs";
import { esc } from "./utils.mjs";

const GAP = 1500, MAX = 60;
const shadow = new Map();          // uuid → копия данных документа до следующего изменения
const done = [], undone = [];       // шаги: { t, user, ops: [], label }
let busy = false;

/* ---------- чистые части (тесты) ---------- */

/** Плоские ключи изменения; массивы и пустые объекты — листья. */
export function flat(o, pre = "", out = {}) {
  for (const [k, v] of Object.entries(o ?? {})) {
    const key = pre ? `${pre}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length) flat(v, key, out);
    else out[key] = v;
  }
  return out;
}
const getp = (o, path) => path.split(".").reduce((x, k) => (x === undefined || x === null ? undefined : x[k]), o);
const clone = v => (v === undefined ? undefined : structuredClone(v));
const SKIP = /^(_id|_stats|items|effects|sort|ownership)(\.|$)/;

/** Обратное изменение: прежние значения тех же ключей; ключ, которого не было, удаляется («-=»). Удаление «-=k» возвращает k. */
export function inverseOf(before, changes) {
  const inv = {};
  for (const key of Object.keys(flat(changes))) {
    if (SKIP.test(key)) continue;
    const parts = key.split(".");
    const real = parts.map(p => p.replace(/^-=/, "")).join(".");
    const old = getp(before, real);
    if (old === undefined) {
      const last = parts.at(-1).replace(/^-=/, "");
      inv[[...parts.slice(0, -1).map(p => p.replace(/^-=/, "")), `-=${last}`].join(".")] = null;
    } else inv[real] = clone(old);
  }
  return inv;
}

/** Только то, что можно повторить: без служебных полей. */
export function forwardOf(changes) {
  const f = {};
  for (const [k, v] of Object.entries(flat(changes))) if (!SKIP.test(k)) f[k] = clone(v);
  return f;
}

/** Положить операцию в журнал: в последний шаг или новым шагом. */
export function pushOp(op, { t = Date.now(), user = "" } = {}, log = done) {
  const last = log.at(-1);
  const sameUser = last && last.user === user && t - last.t < GAP;
  // урон и метка от клиента цели сразу за чужой карточкой — часть того же выстрела
  const follow = last && t - last.t < GAP * 2 && last.ops.some(o => o.kind === "create" && o.doc === "ChatMessage") && op.doc !== "ChatMessage";
  if (sameUser || follow) { last.ops.push(op); last.t = t; return last; }
  const step = { t, user, ops: [op] };
  log.push(step);
  if (log.length > MAX) log.shift();
  return step;
}

const WORDS = [[/^system\.hp/, "HP"], [/^system\.strain/, "Strain"], [/^system\.speed/, "Speed"], [/^system\.alt/, "высота"], [/^system\.markers/, "метки"],
  [/^system\.ammo/, "боезапас"], [/^system\.lock/, "захват"], [/^system\.breakEv/, "Break!"], [/^system\.systems/, "системы"], [/^system\.service/, "личное дело"],
  [/^(x|y)$/, "перемещение"], [/^elevation$/, "высота"], [/^hidden$/, "скрыт/показан"], [/^initiative$/, "заявка"], [/^defeated$/, "выбыл"], [/^flags\./, "отметки"]];

/** Подпись шага для журнала: карточка чата, иначе кто и что поменял. */
export function labelOf(step) {
  const card = step.ops.find(o => o.kind === "create" && o.doc === "ChatMessage");
  if (card) {
    const d = card.data, c = d.flags?.[SYSTEM_ID]?.card;
    const who = d.speaker?.alias ?? "";
    const what = c?.label ?? (String(d.flavor ?? "") || String(d.content ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()).slice(0, 70);
    return [who, what].filter(Boolean).join(": ");
  }
  const op = step.ops[0];
  const keys = [...new Set(step.ops.flatMap(o => Object.keys(o.fwd ?? {})).map(k => WORDS.find(([re]) => re.test(k))?.[1]).filter(Boolean))];
  const verb = op.kind === "create" ? "появился" : op.kind === "delete" ? "убран" : keys.join(", ") || "изменения";
  return `${op.name ?? op.doc}: ${verb}`;
}

/* ---------- запись ---------- */

const gmHere = () => !!game.user?.isGM;
const snap = doc => {
  try {
    const o = doc.toObject();
    delete o.items; delete o.effects;
    shadow.set(doc.uuid, o);
  } catch { /* документ без данных */ }
};
const nameOf = doc => doc.name ?? doc.parent?.name ?? doc.speaker?.alias ?? doc.documentName;

/** Как найти документ снова: по родителю (у токена без связи — его актёр) и id. */
function finder(doc) {
  const name = doc.documentName, id = doc.id, parent = doc.parent;
  if (name === "Actor" && doc.isToken) { const tok = doc.token, scene = tok?.parent; return () => scene?.tokens.get(tok.id)?.actor ?? null; }
  if (!parent) return () => game.collections.get(name)?.get(id) ?? null;
  const p = parentFinder(parent);
  return () => p()?.getEmbeddedDocument?.(name, id) ?? null;
}
function parentFinder(parent) {
  if (parent.documentName === "Actor" && parent.isToken) { const tok = parent.token, scene = tok?.parent; return () => scene?.tokens.get(tok.id)?.actor ?? null; }
  if (parent.documentName === "TokenDocument" || parent.documentName === "Token") { const scene = parent.parent, id = parent.id; return () => scene?.tokens.get(id) ?? null; }
  const id = parent.id, coll = parent.collection;
  return () => (coll?.get?.(id) ?? parent) || null;
}

function recordUpdate(doc, changes, options, userId) {
  if (!gmHere()) return;
  // актёр токена без связи пишется через его дельту (там и флаги, и система); мост delta-bridge повторяет её как updateActor
  if (doc.documentName === "Actor" && (doc.isToken || options?.tbBridged)) return;
  if (options?.tbUndo) {
    snap(doc);
    if (doc.documentName === "ActorDelta" && doc.parent?.actor) snap(doc.parent.actor);
    if (doc.documentName === "Token" && changes.delta && doc.actor) snap(doc.actor);
    return;
  }
  // актёр токена без связи: правка приходит дельтой (updateActorDelta или updateToken с delta) — пишем как правку его актёра
  if (doc.documentName === "ActorDelta") return recordSynthetic(doc.parent?.actor, changes, userId);
  let ch = changes;
  if (doc.documentName === "Token" && ch.delta) {
    recordSynthetic(doc.actor, ch.delta, userId);
    ch = Object.fromEntries(Object.entries(ch).filter(([k]) => k !== "delta"));
  }
  // у боя пишем только отметки: раунд и ход откатывают стрелки трекера
  if (doc.documentName === "Combat") ch = changes.flags ? { flags: changes.flags } : null;
  const before = shadow.get(doc.uuid);
  snap(doc);
  if (!ch || !before) return;
  const fwd = forwardOf(ch);
  if (!Object.keys(fwd).length) return;
  const inv = inverseOf(before, ch);
  pushOp({ kind: "update", doc: doc.documentName, uuid: doc.uuid, name: nameOf(doc), get: finder(doc), fwd, inv }, { user: userId });
  fresh();
}
function recordSynthetic(actor, changes, userId) {
  if (!actor) return;
  const ch = Object.fromEntries(Object.entries(changes ?? {}).filter(([k]) => !["items", "effects", "_id"].includes(k)));
  const before = shadow.get(actor.uuid);
  snap(actor);
  const fwd = forwardOf(ch);
  if (!before || !Object.keys(fwd).length) return;
  // одна и та же правка может прийти и дельтой, и токеном: второй раз не пишем
  const last = done.at(-1)?.ops.at(-1);
  if (last?.uuid === actor.uuid && Date.now() - done.at(-1).t < GAP && JSON.stringify(last.fwd) === JSON.stringify(fwd)) return;
  pushOp({ kind: "update", doc: "Actor", uuid: actor.uuid, name: actor.token?.name ?? actor.name, get: finder(actor), fwd, inv: inverseOf(before, ch) }, { user: userId });
  fresh();
}

function recordCreate(doc, options, userId) {
  if (!gmHere()) return;
  snap(doc);
  if (doc.documentName === "Token" && !doc.actorLink && doc.actor) { const a = doc.actor; snap(a); for (const i of a.items) snap(i); for (const e of a.effects) snap(e); }
  if (doc.documentName === "ActorDelta") return;
  if (options?.tbUndo) return;
  pushOp({ kind: "create", doc: doc.documentName, name: nameOf(doc), get: finder(doc), parent: doc.parent ? parentFinder(doc.parent) : null, data: doc.toObject() }, { user: userId });
  fresh();
}
function recordDelete(doc, options, userId) {
  if (!gmHere() || doc.documentName === "ActorDelta") return;
  shadow.delete(doc.uuid);
  if (options?.tbUndo) return;
  pushOp({ kind: "delete", doc: doc.documentName, name: nameOf(doc), get: finder(doc), parent: doc.parent ? parentFinder(doc.parent) : null, data: doc.toObject() }, { user: userId });
  fresh();
}

/** Новое действие после отмены: отменённое уже не вернуть. */
function fresh() { undone.length = 0; changed(); }

const DOCS = ["Actor", "ActorDelta", "Item", "ActiveEffect", "Token", "Combatant", "Combat", "ChatMessage"];

/** Копии того, что может поменяться в бою: актёры с предметами, токены сцены с их актёрами, бой, последние сообщения. */
function snapAll() {
  if (!gmHere()) return;
  for (const a of game.actors ?? []) { snap(a); for (const i of a.items) snap(i); for (const e of a.effects) snap(e); }
  snapScene();
  for (const c of game.combats ?? []) { snap(c); for (const x of c.combatants) snap(x); }
  for (const m of (game.messages?.contents ?? []).slice(-150)) snap(m);
}
function snapScene() {
  if (!gmHere()) return;
  for (const t of globalThis.canvas?.scene?.tokens ?? []) {
    snap(t);
    if (t.delta) snap(t.delta);
    const a = t.actorLink ? null : t.actor;
    if (a) { snap(a); for (const i of a.items) snap(i); for (const e of a.effects) snap(e); }
  }
}

export function registerUndo() {
  for (const d of DOCS) {
    Hooks.on(`update${d}`, recordUpdate);
    Hooks.on(`create${d}`, recordCreate);
    Hooks.on(`delete${d}`, recordDelete);
  }
  const safe = fn => () => { try { fn(); } catch (err) { console.warn(`${SYSTEM_ID} | журнал действий`, err); } };
  Hooks.once("ready", safe(snapAll));
  Hooks.on("canvasReady", safe(snapScene));
  game.keybindings.register(SYSTEM_ID, "undo", {
    name: "Ведущий: отменить последнее действие", editable: [{ key: "KeyZ", modifiers: ["Alt"] }], restricted: true,
    onDown: () => { undo(); return true; }
  });
  game.keybindings.register(SYSTEM_ID, "redo", {
    name: "Ведущий: вернуть отменённое действие", editable: [{ key: "KeyZ", modifiers: ["Alt", "Shift"] }], restricted: true,
    onDown: () => { redo(); return true; }
  });
}

/* ---------- откат и возврат ---------- */

const OPT = { tbUndo: true, tbFree: true, tbDoom: true, render: true };
const cls = name => getDocumentClass(name === "Token" ? "Token" : name);

async function apply(op, back) {
  const doc = op.get();
  const kind = back ? { update: "update", create: "delete", delete: "create" }[op.kind] : op.kind;
  if (kind === "update") {
    if (!doc) return false;
    const data = back ? op.inv : op.fwd;
    if (doc.documentName === "Actor" && doc.withoutPoolSync) await doc.withoutPoolSync(() => doc.update(data, OPT));
    else await doc.update(data, OPT);
    return true;
  }
  if (kind === "delete") {
    if (!doc) return true;
    await doc.delete(OPT);
    return true;
  }
  if (doc) return true;
  const parent = op.parent?.() ?? null;
  if (op.parent && !parent) return false;
  await cls(op.doc).create(structuredClone(op.data), { ...OPT, keepId: true, ...(parent ? { parent } : {}) });
  return true;
}

async function run(step, back) {
  let miss = 0;
  const ops = back ? [...step.ops].reverse() : step.ops;
  for (const op of ops) {
    try { if (!(await apply(op, back))) miss++; } catch (err) { miss++; console.warn(`${SYSTEM_ID} | отмена`, err); }
  }
  return miss;
}

/** Отменить последний шаг (или n шагов). */
export async function undo(n = 1) {
  if (!game.user.isGM || busy) return;
  if (!done.length) return ui.notifications.info("Отменять нечего.");
  busy = true;
  try {
    for (let i = 0; i < n && done.length; i++) {
      const step = done.pop();
      step.label ??= labelOf(step);
      const miss = await run(step, true);
      undone.push(step);
      await notice(`Отменено: ${step.label}`, miss);
    }
  } finally { busy = false; changed(); }
}

/** Вернуть последний отменённый шаг. */
export async function redo(n = 1) {
  if (!game.user.isGM || busy) return;
  if (!undone.length) return ui.notifications.info("Возвращать нечего.");
  busy = true;
  try {
    for (let i = 0; i < n && undone.length; i++) {
      const step = undone.pop();
      const miss = await run(step, false);
      done.push(step);
      await notice(`Возвращено: ${step.label}`, miss);
    }
  } finally { busy = false; changed(); }
}

async function notice(text, miss) {
  ui.notifications.info(text + (miss ? ` (не всё: ${miss} изм. уже не к чему применить)` : ""));
  await ChatMessage.create({ speaker: { alias: "AWACS" }, content: `<p class="tb-undo-note"><i class="fas fa-rotate-left"></i> ${esc(text)}</p>` }, { tbUndo: true });
}

/** Шаги для журнала: новые сверху. */
export function history() {
  return {
    done: done.map((s, i) => ({ i, label: (s.label ??= labelOf(s)), t: s.t, n: s.ops.length })).reverse(),
    undone: undone.map((s, i) => ({ i, label: s.label ?? labelOf(s), t: s.t, n: s.ops.length })).reverse()
  };
}

/* ---------- журнал ---------- */

let app = null;
let refreshTimer = null;
function changed() {
  if (refreshTimer) return;
  refreshTimer = setTimeout(() => { refreshTimer = null; if (app?.rendered) app.render(false); Hooks.callAll(`${SYSTEM_ID}.undo`); }, 200);
}

const time = t => new Date(t).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

export function historyHtml(h = history()) {
  const row = (s, k, kind) => `<li class="${kind}"><span class="tb-undo-t">${time(s.t)}</span><span class="tb-undo-l">${esc(s.label)}</span><small>${s.n} изм.</small>
    <a data-undo-${kind === "done" ? "to" : "back"}="${k + 1}" title="${kind === "done" ? "Отменить этот шаг и всё, что было после него" : "Вернуть этот шаг и все отменённые до него"}"><i class="fas fa-${kind === "done" ? "rotate-left" : "rotate-right"}"></i></a></li>`;
  return `<div class="tb-undo">
    <div class="tb-undo-bar"><button type="button" data-undo ${h.done.length ? "" : "disabled"}><i class="fas fa-rotate-left"></i> Отменить <kbd>Alt+Z</kbd></button>
      <button type="button" data-redo ${h.undone.length ? "" : "disabled"}><i class="fas fa-rotate-right"></i> Вернуть <kbd>Alt+Shift+Z</kbd></button></div>
    ${h.undone.length ? `<h4>Отменено</h4><ol class="tb-undo-list">${h.undone.map((s, k) => row(s, k, "undone")).join("")}</ol>` : ""}
    <h4>Сделано</h4>${h.done.length ? `<ol class="tb-undo-list">${h.done.map((s, k) => row(s, k, "done")).join("")}</ol>` : `<p class="tb-muted">Журнал пуст: он пишется, пока открыт этот клиент ведущего.</p>`}
    <p class="tb-small tb-muted">Отмена возвращает HP, метки, боезапас, захват, места токенов, заявки и убирает карточку. Раунд и ход откатывают стрелки трекера. Новое действие после отмены стирает список «Отменено».</p>
  </div>`;
}

class UndoLog extends Application {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, { id: "tb-undo", title: "Журнал действий", classes: ["thunderbolt", "tb-undo-app"], width: 440, height: 520, resizable: true });
  }
  async _renderInner() { return $(historyHtml()); }
  activateListeners(html) {
    super.activateListeners(html);
    const el = html[0];
    el.querySelector("[data-undo]")?.addEventListener("click", () => undo());
    el.querySelector("[data-redo]")?.addEventListener("click", () => redo());
    el.querySelectorAll("[data-undo-to]").forEach(n => n.addEventListener("click", () => undo(Number(n.dataset.undoTo))));
    el.querySelectorAll("[data-undo-back]").forEach(n => n.addEventListener("click", () => redo(Number(n.dataset.undoBack))));
  }
}

export function openUndoLog() {
  if (!game.user.isGM) return;
  app ??= new UndoLog();
  return app.render(true);
}

export const _test = { done, undone, shadow };
