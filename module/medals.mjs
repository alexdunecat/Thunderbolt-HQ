/* Награды ВВС Юктобании: набор медалей, орденов и знаков с условиями; вручает ведущий сам из панели «Награды».
   Список правится в панели (настройка мира medalList, пусто — стандартный). Вручённое пишется пилоту во флаг medals
   (с датой, операцией и формулировкой) и строкой в «Награды» личного дела, чтобы ушло и в «Личное дело» Штаба.
   Условия — подсказка ведущему; у части есть счёт (вылеты, сбитые, катапульта), по нему панель зажигает лампу «можно». */
import { SYSTEM_ID } from "./config.mjs";
import { esc } from "./utils.mjs";
import { campaignDate } from "./campaign-date.mjs";

/** Что можно посчитать по личному делу: поле service и подпись. */
export const COUNTS = { sorties: "вылетов", ops: "операций", air: "сбито в воздухе", ground: "целей на земле и море", eject: "катапульт" };

/** Стандартный набор. ribbon — полосы колодки слева направо: [цвет, ширина]. need — счёт по личному делу. repeat — можно вручать повторно. */
export const DEFAULT_MEDALS = [
  { id: "sortie", name: "Знак «Боевой вылет»", cond: "Первый боевой вылет.", need: { sorties: 1 }, repeat: false,
    ribbon: [["#2b4a8b", 3], ["#e8e2c8", 1], ["#2b4a8b", 3]] },
  { id: "valor", name: "Медаль «За отвагу»", cond: "Личная храбрость в бою: атака под захватом или под ракетой, бой с превосходящим противником, удержал позицию вопреки всему.", repeat: true,
    ribbon: [["#3a5fa8", 1], ["#9aa3ab", 5], ["#3a5fa8", 1]] },
  { id: "merit", name: "Медаль «За боевые заслуги»", cond: "Задача операции выполнена, машина и звено сохранены.", repeat: true,
    ribbon: [["#a83232", 1], ["#d8c37a", 5], ["#a83232", 1]] },
  { id: "rescue", name: "Медаль «За спасение товарища»", cond: "Прикрыл, вытащил или заслонил союзника, который иначе бы погиб.", repeat: true,
    ribbon: [["#d8d4c4", 2], ["#2f7a4a", 3], ["#d8d4c4", 2]] },
  { id: "civil", name: "Медаль «За мирное небо»", cond: "Сорвал удар по гражданским или спас мирных жителей, рискуя собой.", repeat: true,
    ribbon: [["#5fa8d8", 2], ["#f4f1e6", 1], ["#5fa8d8", 1], ["#f4f1e6", 1], ["#5fa8d8", 2]] },
  { id: "strike", name: "Медаль «За удар с воздуха»", cond: "10 уничтоженных наземных и морских целей.", need: { ground: 10 }, repeat: false,
    ribbon: [["#3b5b2e", 2], ["#c9a227", 1], ["#3b5b2e", 1], ["#c9a227", 1], ["#3b5b2e", 2]] },
  { id: "ace", name: "Знак «Ас ВВС Юктобании»", cond: "5 воздушных побед.", need: { air: 5 }, repeat: false,
    ribbon: [["#151515", 1], ["#c9a227", 2], ["#151515", 1], ["#c9a227", 2], ["#151515", 1]] },
  { id: "ace2", name: "Знак «Дважды ас»", cond: "10 воздушных побед.", need: { air: 10 }, repeat: false,
    ribbon: [["#c9a227", 1], ["#151515", 1], ["#c9a227", 1], ["#151515", 1], ["#c9a227", 1], ["#151515", 1], ["#c9a227", 1]] },
  { id: "hunter", name: "Медаль «Охотник на асов»", cond: "Сбил вражеского аса или Немезиду.", repeat: true,
    ribbon: [["#7a1f1f", 2], ["#151515", 3], ["#7a1f1f", 2]] },
  { id: "return", name: "Знак «Возвращение»", cond: "Катапультировался, выжил и вернулся в строй.", need: { eject: 1 }, repeat: false,
    ribbon: [["#e8e2c8", 2], ["#d06a2a", 3], ["#e8e2c8", 2]] },
  { id: "wound", name: "Нашивка за ранение", cond: "Ранен в бою и вернулся в строй после госпиталя.", repeat: true,
    ribbon: [["#8e1c1c", 7]] },
  { id: "service", name: "Орден «За службу в ВВС»", cond: "10 боевых вылетов.", need: { sorties: 10 }, repeat: false,
    ribbon: [["#2b4a8b", 2], ["#a83232", 3], ["#2b4a8b", 2]] },
  { id: "banner", name: "Орден Боевого Знамени", cond: "Решающий вклад в операцию: уничтожено супероружие, флагман или ключевая цель.", repeat: true,
    ribbon: [["#f4f1e6", 1], ["#b22222", 5], ["#f4f1e6", 1]] },
  { id: "hero", name: "Звезда Героя Юктобании", cond: "Подвиг, изменивший ход войны. Вручается один раз.", repeat: false,
    ribbon: [["#b22222", 7]], star: true }
];

export function registerMedals() {
  game.settings.register(SYSTEM_ID, "medalList", { scope: "world", config: false, type: Array, default: [], onChange: () => refresh() });
  Hooks.on("updateActor", a => { if (a.type === "pilot" && a.id === pilotId) refresh(); });
}

/** Действующий список наград мира. */
export function medalList() {
  let list = [];
  try { list = game.settings.get(SYSTEM_ID, "medalList") ?? []; } catch { list = []; }
  return list.length ? list : DEFAULT_MEDALS;
}
const byId = id => medalList().find(m => m.id === id) ?? DEFAULT_MEDALS.find(m => m.id === id) ?? null;

/** Награды пилота: [{ id, name, date, op, note, key }]. */
export const awardsOf = pilot => pilot?.getFlag?.(SYSTEM_ID, "medals") ?? [];

/** Колодка награды: SVG-планка по полосам; у Звезды Героя — звезда поверх. */
export function ribbonSvg(m, { w = 36, h = 11 } = {}) {
  const stripes = m?.ribbon?.length ? m.ribbon : [["#777", 1]];
  const total = stripes.reduce((s, [, n]) => s + (Number(n) || 1), 0);
  let x = 0;
  const rects = stripes.map(([c, n]) => {
    const sw = w * (Number(n) || 1) / total;
    const r = `<rect x="${x.toFixed(2)}" y="0" width="${(sw + 0.05).toFixed(2)}" height="${h}" fill="${esc(c)}"/>`;
    x += sw;
    return r;
  }).join("");
  const star = m?.star ? `<polygon fill="#ffd34d" stroke="#7a5a00" stroke-width=".4" points="${starPoints(w / 2, h / 2, h * 0.42)}"/>` : "";
  return `<svg class="tb-ribbon" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true">${rects}${star}<rect x=".25" y=".25" width="${w - 0.5}" height="${h - 0.5}" fill="none" stroke="rgba(128,128,128,.7)" stroke-width=".6"/></svg>`;
}
function starPoints(cx, cy, r) {
  return Array.from({ length: 10 }, (_, i) => {
    const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.45 : r;
    return `${(cx + rr * Math.cos(a)).toFixed(2)},${(cy + rr * Math.sin(a)).toFixed(2)}`;
  }).join(" ");
}

/** Счёт по условию награды: { text, met } или null (условие решает ведущий). */
export function progress(pilot, m) {
  const need = Object.entries(m?.need ?? {}).filter(([k, v]) => COUNTS[k] && Number(v) > 0);
  if (!need.length) return null;
  const svc = pilot?.system?.service ?? {};
  const parts = need.map(([k, v]) => ({ k, have: Number(svc[k] ?? 0), need: Number(v) }));
  return { met: parts.every(p => p.have >= p.need), text: parts.map(p => `${COUNTS[p.k]} ${p.have}/${p.need}`).join(", ") };
}

/** Можно ли вручить: неповторяемую — один раз. */
export const canAward = (pilot, m) => m.repeat || !awardsOf(pilot).some(a => a.id === m.id);

/** Строка награды в личном деле. */
const awardLine = a => `${a.name}${[a.date, a.op].filter(Boolean).length ? ` (${[a.date, a.op].filter(Boolean).join(", ")})` : ""}${a.note ? `: ${a.note}` : ""}`;

/** Вручить: флаг пилота, строка в «Награды», карточка приказа в чат. */
export async function award(pilot, id, { date = campaignDate(), op = "", note = "" } = {}) {
  if (!game.user.isGM || pilot?.type !== "pilot") return null;
  const m = byId(id);
  if (!m) return null;
  if (!canAward(pilot, m)) return ui.notifications.warn(`${pilot.name}: ${m.name} уже есть, повторно не вручается.`);
  const a = { id: m.id, name: m.name, date: String(date).trim(), op: String(op).trim(), note: String(note).trim(), key: foundry.utils.randomID() };
  const text = String(pilot.system.service?.awards ?? "").trim();
  await pilot.update({ [`flags.${SYSTEM_ID}.medals`]: [...awardsOf(pilot), a], "system.service.awards": [text, awardLine(a)].filter(Boolean).join("\n") });
  const call = pilot.system.callsign ? `«${pilot.system.callsign}» ` : "";
  return ChatMessage.create({ speaker: { alias: "Штаб ВВС" },
    content: `<div class="tb-card tb-card-medal"><header class="tb-card-head"><span class="tb-card-who">Приказ по ВВС Юктобании</span><span class="tb-card-what">${esc(a.date)}</span></header>
      <div class="tb-medal-line">${ribbonSvg(m, { w: 54, h: 16 })}<div><b>${esc(m.name)}</b><small>${esc(m.cond)}</small></div></div>
      <div class="tb-note">Наградить: ${esc(pilot.system.rank ? `${pilot.system.rank} ` : "")}${esc(call)}${esc(pilot.name)}.${a.note ? ` Основание: ${esc(a.note)}.` : ""}${a.op ? ` Операция «${esc(a.op)}».` : ""}</div></div>` });
}

/** Отменить награду (ошибка ведущего): снять флаг и строку из «Наград». */
export async function revoke(pilot, key) {
  if (!game.user.isGM) return null;
  const list = awardsOf(pilot), a = list.find(x => x.key === key);
  if (!a) return null;
  const lines = String(pilot.system.service?.awards ?? "").split("\n");
  const i = lines.findIndex(l => l.trim() === awardLine(a));
  if (i >= 0) lines.splice(i, 1);
  return pilot.update({ [`flags.${SYSTEM_ID}.medals`]: list.filter(x => x.key !== key), "system.service.awards": lines.join("\n").trim() });
}

/** Колодки пилота для листа: [{ svg, title }]. */
export function rack(pilot) {
  return awardsOf(pilot).map(a => ({ key: a.key, svg: ribbonSvg(byId(a.id) ?? a), title: awardLine(a) }));
}

/* ---------- панель «Награды» ---------- */

let win = null, pilotId = null, ed = null;
function refresh() { if (win?.rendered && !ed) win.render(false); }

/** Открыть панель (ведущий), по желанию сразу на пилоте. */
export function openMedals(pilot = null) {
  if (!game.user.isGM) return;
  if (pilot) pilotId = pilot.id;
  win ??= new MedalsPanel();
  win.render(true);
}

const pilots = () => (game.actors?.contents ?? [...(game.actors ?? [])]).filter(a => a.type === "pilot")
  .sort((x, y) => (y.hasPlayerOwner - x.hasPlayerOwner) || x.name.localeCompare(y.name, "ru"));
const lastOp = p => (p?.system?.service?.log ?? []).at(-1)?.op ?? "";

/* ---------- конструктор наград ---------- */

/** Цвета лент ВВС Юктобании для палитры конструктора. */
export const PALETTE = [
  ["#2b4a8b", "синий"], ["#5fa8d8", "голубой"], ["#a83232", "красный"], ["#b22222", "алый"], ["#7a1f1f", "бордо"],
  ["#c9a227", "золото"], ["#d8c37a", "песок"], ["#e8e2c8", "кремовый"], ["#f4f1e6", "белый"], ["#9aa3ab", "сталь"],
  ["#151515", "чёрный"], ["#2f7a4a", "зелёный"], ["#3b5b2e", "олива"], ["#d06a2a", "оранжевый"]
];

/** Образцы колодки на двух цветах: a — основной, b — второй. */
export const PATTERNS = [
  ["Сплошная", (a) => [[a, 7]]],
  ["Кайма", (a, b) => [[b, 1], [a, 5], [b, 1]]],
  ["Полоса по центру", (a, b) => [[a, 3], [b, 1], [a, 3]]],
  ["Широкий центр", (a, b) => [[a, 2], [b, 3], [a, 2]]],
  ["Две полосы", (a, b) => [[a, 2], [b, 1], [a, 1], [b, 1], [a, 2]]],
  ["Частая", (a, b) => [[b, 1], [a, 1], [b, 1], [a, 1], [b, 1], [a, 1], [b, 1]]]
];

const clone = x => JSON.parse(JSON.stringify(x));
const mirror = (n, i) => n - 1 - i;
/** Симметрична ли колодка. */
export const isSymmetric = r => (r ?? []).every(([c, w], i, all) => all[mirror(all.length, i)][0] === c && all[mirror(all.length, i)][1] === w);
/** Два цвета колодки для образцов: основной и первый отличный от него. */
const twoColors = r => { const a = r?.[0]?.[0] ?? "#2b4a8b"; return [a, (r ?? []).map(x => x[0]).find(c => c !== a) ?? (a === "#c9a227" ? "#2b4a8b" : "#c9a227")]; };

/** Начать правку списка: черновик, выбранная награда и полоса. */
export function startEdit() {
  const draft = clone(medalList());
  ed = { draft, sel: 0, stripe: 0, sym: isSymmetric(draft[0]?.ribbon), dirty: false };
  return ed;
}
export function stopEdit() { ed = null; }

/** Правки колодки выбранной награды (симметрия отражает полосу на другую сторону). */
export const ribbonOps = {
  set(r, i, patch, sym) {
    const j = mirror(r.length, i);
    for (const k of sym ? [...new Set([i, j])] : [i]) {
      if (patch.color) r[k][0] = patch.color;
      if (patch.width) r[k][1] = Math.max(1, Math.min(9, patch.width));
    }
  },
  add(r, i, sym) {
    const s = [...(r[i] ?? ["#c9a227", 1])];
    const j = mirror(r.length, i);
    if (!sym || r.length === 0) { r.splice(i + 1, 0, s); return i + 1; }
    if (i === j) { r.splice(i + 1, 0, [...s]); r.splice(i, 0, [...s]); return i; }
    const [lo, hi] = i < j ? [i, j] : [j, i];
    r.splice(hi, 0, [...s]); r.splice(lo + 1, 0, [...s]);
    return lo + 1;
  },
  del(r, i, sym) {
    if (r.length <= 1) return 0;
    const j = mirror(r.length, i);
    const kill = sym && i !== j && r.length > 2 ? [Math.max(i, j), Math.min(i, j)] : [i];
    kill.forEach(k => r.splice(k, 1));
    return Math.max(0, Math.min(Math.min(i, j), r.length - 1));
  },
  /** Сделать симметричной: левая половина (с серединой) отражается вправо. */
  symmetrize(r) {
    const left = r.slice(0, Math.ceil(r.length / 2));
    r.splice(0, r.length, ...left, ...clone(left.slice(0, Math.floor(r.length / 2))).reverse());
    return r;
  }
};

/** Большая колодка конструктора: полосы кликаются, выбранная подчёркнута. */
function bigRibbon(m, sel) {
  const w = 210, h = 60, stripes = m?.ribbon?.length ? m.ribbon : [["#777", 1]];
  const total = stripes.reduce((s, [, n]) => s + (Number(n) || 1), 0);
  let x = 0;
  const rects = stripes.map(([c, n], i) => {
    const sw = w * (Number(n) || 1) / total;
    const r = `<rect data-stripe="${i}" x="${x.toFixed(2)}" y="0" width="${(sw + 0.1).toFixed(2)}" height="${h}" fill="${esc(c)}"><title>Полоса ${i + 1}: ${esc(c)}, ширина ${n}</title></rect>`
      + (i === sel ? `<rect class="tb-stripe-sel" x="${(x + 1).toFixed(2)}" y="1" width="${Math.max(1, sw - 2).toFixed(2)}" height="${h - 2}" fill="none"/>` : "");
    x += sw;
    return r;
  }).join("");
  const star = m?.star ? `<polygon pointer-events="none" fill="#ffd34d" stroke="#7a5a00" stroke-width="1" points="${starPoints(w / 2, h / 2, h * 0.42)}"/>` : "";
  return `<svg class="tb-ribbon-big" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">${rects}${star}<rect pointer-events="none" x=".5" y=".5" width="${w - 1}" height="${h - 1}" fill="none" stroke="rgba(128,128,128,.7)" stroke-width="1"/></svg>`;
}

/** Правая часть конструктора: всё о выбранной награде. */
function editorHtml(st) {
  const m = st.draft[st.sel];
  if (!m) return `<section class="tb-mk-edit"><p class="tb-muted">Список пуст. Добавьте награду слева.</p></section>`;
  const r = m.ribbon ?? [], cur = r[st.stripe] ?? r[0] ?? ["#777", 1];
  const [a, b] = twoColors(r);
  const stripes = r.map(([c, n], i) => `<span class="tb-mk-stripe ${i === st.stripe ? "on" : ""}" data-mk-stripe="${i}" title="Полоса ${i + 1}"><i style="background:${esc(c)}"></i>${n}</span>`).join("");
  const usedNeed = Object.keys(m.need ?? {}).filter(k => COUNTS[k]);
  const freeNeed = Object.keys(COUNTS).filter(k => !usedNeed.includes(k));
  return `<section class="tb-mk-edit">
    <div class="tb-mk-preview">${bigRibbon(m, st.stripe)}
      <div class="tb-mk-mini"><span>в листе</span>${ribbonSvg(m, { w: 42, h: 13 })}<span>в приказе</span>${ribbonSvg(m, { w: 54, h: 16 })}</div></div>
    <label class="tb-mk-field">Название<input type="text" data-mk-f="name" value="${esc(m.name)}" placeholder="Медаль «…»" maxlength="80"></label>
    <label class="tb-mk-field">За что<textarea data-mk-f="cond" rows="2" placeholder="Условие, которое увидит ведущий при вручении">${esc(m.cond)}</textarea></label>

    <fieldset class="tb-mk-box"><legend>Колодка</legend>
      <div class="tb-mk-stripes">${stripes}
        <button type="button" class="tb-mk-sq" data-mk="add" title="Добавить полосу после выбранной"><i class="fas fa-plus"></i></button></div>
      <div class="tb-mk-cur">
        <span class="tb-mk-lbl">Полоса ${st.stripe + 1}</span>
        <label class="tb-mk-color" title="Любой цвет"><input type="color" data-mk-color value="${esc(cur[0])}"><span style="background:${esc(cur[0])}"></span></label>
        <span class="tb-mk-step"><button type="button" data-mk="narrow" title="Уже">−</button><b title="Ширина полосы">${cur[1]}</b><button type="button" data-mk="wide" title="Шире">+</button></span>
        <button type="button" class="tb-mk-sq" data-mk="del" ${r.length > 1 ? "" : "disabled"} title="Убрать полосу"><i class="fas fa-trash"></i></button>
        <label class="tb-mk-toggle" title="Правка полосы повторяется на другой стороне"><input type="checkbox" data-mk-sym ${st.sym ? "checked" : ""}> симметрично</label>
      </div>
      <div class="tb-mk-palette">${PALETTE.map(([c, n]) => `<button type="button" data-mk-paint="${c}" class="${c === cur[0] ? "on" : ""}" title="${esc(n)}" style="background:${c}"></button>`).join("")}</div>
      <div class="tb-mk-patterns"><span class="tb-mk-lbl">Образцы</span>${PATTERNS.map(([n, f], i) => `<button type="button" data-mk-pattern="${i}" title="${esc(n)}">${ribbonSvg({ ribbon: f(a, b) }, { w: 36, h: 11 })}</button>`).join("")}</div>
      <label class="tb-mk-toggle"><input type="checkbox" data-mk-f="star" ${m.star ? "checked" : ""}> звезда на колодке</label>
    </fieldset>

    <fieldset class="tb-mk-box"><legend>Условие по личному делу</legend>
      <div class="tb-mk-needs">${usedNeed.map(k => `<span class="tb-mk-need">${esc(COUNTS[k])} ≥ <input type="number" min="1" max="999" data-mk-need="${k}" value="${m.need[k]}"><a data-mk-unneed="${k}" title="Убрать счёт">×</a></span>`).join("")}
        ${freeNeed.length ? `<select data-mk-addneed><option value="">+ добавить счёт…</option>${freeNeed.map(k => `<option value="${k}">${esc(COUNTS[k])}</option>`).join("")}</select>` : ""}</div>
      <small class="tb-muted">${usedNeed.length ? "Когда счёт набран, награда в списке подсветится. Вручаете всё равно вы." : "Без счёта условие решаете вы сами, по описанию выше."}</small>
    </fieldset>
    <label class="tb-mk-toggle"><input type="checkbox" data-mk-f="repeat" ${m.repeat ? "checked" : ""}> вручается повторно</label>
  </section>`;
}

/** Конструктор: список наград слева, правка выбранной справа. */
function builderHtml(st) {
  const items = st.draft.map((m, i) => `<li class="${i === st.sel ? "on" : ""}" data-mk-sel="${i}">${ribbonSvg(m, { w: 36, h: 11 })}<span>${esc(m.name)}</span></li>`).join("");
  const last = st.draft.length - 1;
  return `<div class="tb-medals tb-mk">
    <div class="tb-mk-body">
      <aside class="tb-mk-list"><ol>${items}</ol>
        <div class="tb-mk-listbtns">
          <button type="button" data-mk="new" title="Новая награда"><i class="fas fa-plus"></i></button>
          <button type="button" data-mk="copy" title="Копия выбранной" ${st.draft.length ? "" : "disabled"}><i class="fas fa-clone"></i></button>
          <button type="button" data-mk="up" title="Выше" ${st.sel > 0 ? "" : "disabled"}><i class="fas fa-arrow-up"></i></button>
          <button type="button" data-mk="down" title="Ниже" ${st.sel < last ? "" : "disabled"}><i class="fas fa-arrow-down"></i></button>
          <button type="button" data-mk="remove" title="Убрать из списка (у награждённых останется)" ${st.draft.length ? "" : "disabled"}><i class="fas fa-trash"></i></button>
        </div></aside>
      ${editorHtml(st)}
    </div>
    <footer>
      <button type="button" data-mk="save" class="${st.dirty ? "tb-mk-dirty" : ""}"><i class="fas fa-save"></i> Сохранить${st.dirty ? " *" : ""}</button>
      <button type="button" data-mk="defaults" title="Вернуть стандартный набор"><i class="fas fa-rotate-left"></i> Стандартные</button>
      <button type="button" data-mk="cancel"><i class="fas fa-xmark"></i> ${st.dirty ? "Отменить правки" : "Закрыть конструктор"}</button>
    </footer></div>`;
}

/** Действие конструктора над черновиком. Возвращает true, если нужно перерисовать. */
export function builderAct(st, act, arg) {
  const m = st.draft[st.sel], r = m?.ribbon;
  const pick = i => { st.sel = Math.max(0, Math.min(i, st.draft.length - 1)); st.stripe = 0; st.sym = isSymmetric(st.draft[st.sel]?.ribbon); };
  switch (act) {
    case "select": pick(Number(arg)); return true;
    case "stripe": st.stripe = Number(arg); return true;
    case "paint": ribbonOps.set(r, st.stripe, { color: arg }, st.sym); break;
    case "narrow": ribbonOps.set(r, st.stripe, { width: r[st.stripe][1] - 1 }, st.sym); break;
    case "wide": ribbonOps.set(r, st.stripe, { width: r[st.stripe][1] + 1 }, st.sym); break;
    case "add": st.stripe = ribbonOps.add(r, st.stripe, st.sym); break;
    case "del": st.stripe = ribbonOps.del(r, st.stripe, st.sym); break;
    case "sym": st.sym = !!arg; if (!st.sym || isSymmetric(r)) return true; ribbonOps.symmetrize(r); break;
    case "pattern": { const [a, b] = twoColors(r); m.ribbon = PATTERNS[Number(arg)][1](a, b); st.stripe = 0; st.sym = true; break; }
    case "field": m[arg.k] = arg.v; if (arg.k === "name" || arg.k === "cond") { st.dirty = true; return false; } break;
    case "need": (m.need ??= {})[arg.k] = Math.max(1, Number(arg.v) || 1); st.dirty = true; return false;
    case "addneed": if (COUNTS[arg]) (m.need ??= {})[arg] = 1; break;
    case "unneed": delete m.need?.[arg]; break;
    case "new": st.draft.splice(st.sel + 1, 0, { id: foundry.utils.randomID(), name: "Новая награда", cond: "", ribbon: [["#2b4a8b", 3], ["#c9a227", 1], ["#2b4a8b", 3]], need: {}, repeat: true });
      st.dirty = true; pick(st.sel + (st.draft.length > 1 ? 1 : 0)); return true;
    case "copy": st.draft.splice(st.sel + 1, 0, { ...clone(m), id: foundry.utils.randomID(), name: `${m.name} (копия)` }); st.dirty = true; pick(st.sel + 1); return true;
    case "up": case "down": { const j = st.sel + (act === "up" ? -1 : 1); if (j < 0 || j >= st.draft.length) return false; [st.draft[st.sel], st.draft[j]] = [st.draft[j], st.draft[st.sel]]; st.sel = j; break; }
    case "remove": st.draft.splice(st.sel, 1); st.dirty = true; pick(st.sel); return true;
    default: return false;
  }
  st.dirty = true;
  return true;
}

/** Разметка панели (для тестов и окна). В режиме правки — конструктор наград. */
export function panelHtml(pilot, { edit = false } = {}) {
  if (edit) return builderHtml(ed ?? startEdit());
  const list = medalList();
  const opts = pilots().map(p => `<option value="${p.id}" ${p.id === pilot?.id ? "selected" : ""}>${esc(p.system.callsign ? `${p.system.callsign} (${p.name})` : p.name)}</option>`).join("");
  const have = id => awardsOf(pilot).filter(a => a.id === id).length;
  const rows = list.map(m => {
    const pr = pilot ? progress(pilot, m) : null, can = pilot && canAward(pilot, m), n = have(m.id);
    return `<li class="tb-medal-row ${pr?.met && can ? "ready" : ""} ${n && !m.repeat ? "done" : ""}">${ribbonSvg(m)}
      <div class="tb-medal-text"><b>${esc(m.name)}</b>${n ? ` <span class="tb-chip">вручена${n > 1 ? ` ×${n}` : ""}</span>` : ""}<small>${esc(m.cond)}</small>
        ${pr ? `<small class="tb-medal-prog ${pr.met ? "ok" : ""}">${pr.met ? "✔" : "○"} ${esc(pr.text)}</small>` : ""}</div>
      <button type="button" data-medal-give="${esc(m.id)}" ${pilot && can ? "" : "disabled"} title="${!pilot ? "Выберите пилота" : can ? "Вручить" : "Уже вручена, повторно не вручается"}"><i class="fas fa-medal"></i> Вручить</button></li>`;
  }).join("");
  const mine = pilot ? awardsOf(pilot) : [];
  return `<div class="tb-medals">
    <header class="tb-medal-head">
      <label>Пилот <select data-medal-pilot><option value="">— выберите —</option>${opts}</select></label>
      <label>Дата <input type="text" data-medal-date value="${esc(campaignDate())}" maxlength="40"></label>
      <label>Операция <input type="text" data-medal-op value="${esc(lastOp(pilot))}" maxlength="80"></label>
      <label class="wide">Основание <input type="text" data-medal-note placeholder="за что, своими словами: попадёт в приказ и личное дело" maxlength="200"></label>
    </header>
    ${pilot ? `<div class="tb-medal-mine"><small>Награды пилота</small>${mine.length ? mine.map(a => `<span class="tb-medal-has" title="${esc(awardLine(a))}">${ribbonSvg(byId(a.id) ?? a)} ${esc(a.name)}${a.date ? ` · ${esc(a.date)}` : ""} <a data-medal-revoke="${esc(a.key)}" title="Отменить награду (снимется и из личного дела)">×</a></span>`).join("") : `<span class="tb-muted">пока нет</span>`}</div>` : ""}
    <ol class="tb-medal-list">${rows}</ol>
    <footer><button type="button" data-medal-edit><i class="fas fa-pen-ruler"></i> Конструктор наград</button></footer></div>`;
}

class MedalsPanel extends Application {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, { id: "tb-medals", title: "Награды ВВС Юктобании", classes: ["thunderbolt", "tb-medals-app"], width: 680, height: 740, resizable: true });
  }

  async _renderInner() {
    return $(panelHtml(game.actors.get(pilotId) ?? null, { edit: !!ed }));
  }

  async close(options) { ed = null; return super.close(options); }

  activateListeners(html) {
    super.activateListeners(html);
    const el = html[0];
    const on = (sel, fn) => el.querySelectorAll(sel).forEach(n => n.addEventListener("click", ev => { ev.preventDefault(); fn(n.dataset, n); }));
    if (ed) return this.#builderListeners(el, on);
    el.querySelector("[data-medal-pilot]")?.addEventListener("change", ev => { pilotId = ev.target.value || null; this.render(false); });
    const val = s => el.querySelector(s)?.value ?? "";
    on("[data-medal-give]", async d => {
      const p = game.actors.get(pilotId);
      if (p) await award(p, d.medalGive, { date: val("[data-medal-date]"), op: val("[data-medal-op]"), note: val("[data-medal-note]") });
      this.render(false);
    });
    on("[data-medal-revoke]", async d => {
      const p = game.actors.get(pilotId), a = awardsOf(p).find(x => x.key === d.medalRevoke);
      if (a && await Dialog.confirm({ title: "Отменить награду", content: `<p>Снять «${esc(a.name)}» у ${esc(p.name)}? Строка уйдёт и из личного дела.</p>` })) await revoke(p, a.key);
      this.render(false);
    });
    on("[data-medal-edit]", () => { startEdit(); this.render(false); });
  }

  #builderListeners(el, on) {
    const act = (a, arg) => { if (builderAct(ed, a, arg)) this.render(false); else this.#markDirty(el); };
    on("[data-mk-sel]", d => act("select", d.mkSel));
    on("[data-mk-stripe]", d => act("stripe", d.mkStripe));
    el.querySelectorAll(".tb-ribbon-big [data-stripe]").forEach(n => n.addEventListener("click", () => act("stripe", n.dataset.stripe)));
    on("[data-mk-paint]", d => act("paint", d.mkPaint));
    on("[data-mk-pattern]", d => act("pattern", d.mkPattern));
    on("[data-mk-unneed]", d => act("unneed", d.mkUnneed));
    el.querySelector("[data-mk-addneed]")?.addEventListener("change", ev => act("addneed", ev.target.value));
    el.querySelector("[data-mk-sym]")?.addEventListener("change", ev => act("sym", ev.target.checked));
    el.querySelectorAll("[data-mk-f]").forEach(n => n.addEventListener(n.type === "checkbox" ? "change" : "input",
      () => act("field", { k: n.dataset.mkF, v: n.type === "checkbox" ? n.checked : n.value })));
    el.querySelectorAll("[data-mk-need]").forEach(n => n.addEventListener("input", () => act("need", { k: n.dataset.mkNeed, v: n.value })));
    // название в списке слева меняется сразу, без перерисовки (чтобы не терять курсор)
    el.querySelector('[data-mk-f="name"]')?.addEventListener("input", ev => { const s = el.querySelector(".tb-mk-list li.on span"); if (s) s.textContent = ev.target.value; });
    // свой цвет: пока пипетка открыта, правим только картинку; на «change» — перерисовка
    const color = el.querySelector("[data-mk-color]");
    color?.addEventListener("input", ev => {
      ribbonOps.set(ed.draft[ed.sel].ribbon, ed.stripe, { color: ev.target.value }, ed.sym);
      ed.dirty = true;
      el.querySelector(".tb-ribbon-big")?.replaceWith($(bigRibbon(ed.draft[ed.sel], ed.stripe))[0]);
      color.nextElementSibling.style.background = ev.target.value;
    });
    color?.addEventListener("change", () => this.render(false));
    on("[data-mk]", async d => {
      const a = d.mk;
      if (a === "save") {
        await game.settings.set(SYSTEM_ID, "medalList", clone(ed.draft));
        ed.dirty = false;
        ui.notifications?.info?.("Список наград сохранён.");
        return this.render(false);
      }
      if (a === "cancel") {
        if (ed.dirty && !await Dialog.confirm({ title: "Конструктор наград", content: "<p>Закрыть без сохранения? Правки пропадут.</p>" })) return;
        stopEdit(); return this.render(false);
      }
      if (a === "defaults") {
        if (!await Dialog.confirm({ title: "Награды", content: "<p>Вернуть стандартный набор наград? Свои правки списка пропадут, вручённые награды у пилотов останутся.</p>" })) return;
        await game.settings.set(SYSTEM_ID, "medalList", []);
        startEdit(); return this.render(false);
      }
      if (a === "remove" && !await Dialog.confirm({ title: "Конструктор наград", content: `<p>Убрать «${esc(ed.draft[ed.sel]?.name ?? "")}» из списка? У награждённых она останется.</p>` })) return;
      act(a);
    });
  }

  #markDirty(el) {
    const b = el.querySelector('[data-mk="save"]');
    if (b && !b.classList.contains("tb-mk-dirty")) { b.classList.add("tb-mk-dirty"); b.innerHTML = `<i class="fas fa-save"></i> Сохранить *`; }
  }
}
