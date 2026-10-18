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

let win = null, pilotId = null, editing = false;
function refresh() { if (win?.rendered) win.render(false); }

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
const stripesText = r => (r ?? []).map(([c, n]) => `${c} ${n}`).join(", ");
const parseStripes = s => String(s).split(",").map(x => x.trim().split(/\s+/)).filter(x => /^#?[0-9a-z]+$/i.test(x[0] ?? "")).map(([c, n]) => [c.startsWith("#") ? c : `#${c}`, Number(n) || 1]);

/** Разметка панели (для тестов и окна). */
export function panelHtml(pilot, { edit = false } = {}) {
  const list = medalList();
  const opts = pilots().map(p => `<option value="${p.id}" ${p.id === pilot?.id ? "selected" : ""}>${esc(p.system.callsign ? `${p.system.callsign} (${p.name})` : p.name)}</option>`).join("");
  const have = id => awardsOf(pilot).filter(a => a.id === id).length;
  const rows = list.map((m, i) => {
    if (edit) return `<li class="tb-medal-row edit" data-i="${i}">${ribbonSvg(m)}
      <div class="tb-medal-edit"><input type="text" data-f="name" value="${esc(m.name)}" placeholder="Название"><textarea data-f="cond" rows="2" placeholder="За что">${esc(m.cond)}</textarea>
        <label>Полосы <input type="text" data-f="ribbon" value="${esc(stripesText(m.ribbon))}" placeholder="#2b4a8b 3, #e8e2c8 1, #2b4a8b 3" title="Цвет и ширина полосы через запятую, слева направо"></label>
        <span class="tb-medal-need">${Object.entries(COUNTS).map(([k, l]) => `<label title="${esc(l)}: счёт из личного дела, пусто — условие решает ведущий">${esc(l)} <input type="number" min="0" data-need="${k}" value="${m.need?.[k] ?? ""}"></label>`).join("")}</span>
        <label><input type="checkbox" data-f="repeat" ${m.repeat ? "checked" : ""}> вручается повторно</label> <label><input type="checkbox" data-f="star" ${m.star ? "checked" : ""}> звезда на колодке</label></div>
      <a class="tb-icon" data-medal-del="${i}" title="Убрать из списка (у награждённых останется)"><i class="fas fa-trash"></i></a></li>`;
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
    ${pilot && !edit ? `<div class="tb-medal-mine"><small>Награды пилота</small>${mine.length ? mine.map(a => `<span class="tb-medal-has" title="${esc(awardLine(a))}">${ribbonSvg(byId(a.id) ?? a)} ${esc(a.name)}${a.date ? ` · ${esc(a.date)}` : ""} <a data-medal-revoke="${esc(a.key)}" title="Отменить награду (снимется и из личного дела)">×</a></span>`).join("") : `<span class="tb-muted">пока нет</span>`}</div>` : ""}
    <ol class="tb-medal-list">${rows}</ol>
    <footer>${edit
      ? `<button type="button" data-medal-add><i class="fas fa-plus"></i> Добавить награду</button><button type="button" data-medal-save><i class="fas fa-save"></i> Сохранить список</button><button type="button" data-medal-reset title="Вернуть стандартный набор"><i class="fas fa-rotate-left"></i> Стандартные</button><button type="button" data-medal-edit><i class="fas fa-xmark"></i> Отмена</button>`
      : `<button type="button" data-medal-edit><i class="fas fa-pen"></i> Править список наград</button>`}</footer></div>`;
}

class MedalsPanel extends Application {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, { id: "tb-medals", title: "Награды ВВС Юктобании", classes: ["thunderbolt", "tb-medals-app"], width: 640, height: 720, resizable: true });
  }

  async _renderInner() {
    return $(panelHtml(game.actors.get(pilotId) ?? null, { edit: editing }));
  }

  activateListeners(html) {
    super.activateListeners(html);
    const el = html[0];
    const on = (sel, fn) => el.querySelectorAll(sel).forEach(n => n.addEventListener("click", ev => { ev.preventDefault(); fn(n.dataset, n); }));
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
    on("[data-medal-edit]", () => { editing = !editing; this.render(false); });
    const read = () => [...el.querySelectorAll(".tb-medal-row.edit")].map(li => {
      const old = medalList()[Number(li.dataset.i)] ?? {};
      const f = k => li.querySelector(`[data-f="${k}"]`);
      const need = Object.fromEntries([...li.querySelectorAll("[data-need]")].filter(n => Number(n.value) > 0).map(n => [n.dataset.need, Number(n.value)]));
      return { id: old.id ?? foundry.utils.randomID(), name: f("name").value.trim() || "Награда", cond: f("cond").value.trim(), ribbon: parseStripes(f("ribbon").value),
        need, repeat: f("repeat").checked, star: f("star").checked };
    });
    on("[data-medal-save]", async () => { await game.settings.set(SYSTEM_ID, "medalList", read()); editing = false; this.render(false); });
    on("[data-medal-add]", async () => {
      await game.settings.set(SYSTEM_ID, "medalList", [...read(), { id: foundry.utils.randomID(), name: "Новая награда", cond: "", ribbon: [["#2b4a8b", 3], ["#c9a227", 1], ["#2b4a8b", 3]], need: {}, repeat: true }]);
    });
    on("[data-medal-del]", async d => { const list = read(); list.splice(Number(d.medalDel), 1); await game.settings.set(SYSTEM_ID, "medalList", list); });
    on("[data-medal-reset]", async () => {
      if (await Dialog.confirm({ title: "Награды", content: "<p>Вернуть стандартный набор наград? Свои правки списка пропадут, вручённые награды у пилотов останутся.</p>" })) {
        await game.settings.set(SYSTEM_ID, "medalList", []);
        editing = false; this.render(false);
      }
    });
  }
}
