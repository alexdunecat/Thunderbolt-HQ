/* Даунтайм: проверка на земле по шкале 7+ / 4–6 / ≤3, действия между вылетами, Заделы, Связи, личные цели,
   Решимость, Нервы и «На пределе» со срывом, шкалы угроз и события на базе. Правила: «Даунтайм» (09.10.2026). */
import { SYSTEM_ID, TB, DT } from "./config.mjs";
import { esc, resolveActor } from "./utils.mjs";
import { formDialog, postCard, renderCard, computeCard } from "./dice/rolls.mjs";
import { giveNext } from "./squad.mjs";

const CHANNEL = `system.${SYSTEM_ID}`;
const sign = n => (n >= 0 ? "+" : "−") + Math.abs(n);
const leadGM = () => game.users.activeGM?.isSelf;
const randomID = () => foundry.utils.randomID();

export function registerDowntime() {
  game.settings.register(SYSTEM_ID, "threats", {
    name: "Шкалы угроз", scope: "world", config: false, type: Array, default: [],
    onChange: () => rerenderAll()
  });
  // ведущий отражает Связи на листе товарища и раздаёт Память после гибели
  Hooks.on("updateActor", (actor, change) => {
    if (!leadGM() || actor.type !== "pilot") return;
    if (foundry.utils.hasProperty(change, "system.bonds")) mirrorBonds(actor);
    if (foundry.utils.getProperty(change, "system.service.status") === "kia") fallen(actor);
    if (foundry.utils.hasProperty(change, "system.nerves") && actor.system.nerves < DT.maxNerves && actor.system.onEdge)
      actor.update({ "system.onEdge": "" });
  });
  // шкалы боя с отметкой «тикает» прибавляют деление в конце каждого раунда
  Hooks.on("updateCombat", async (combat, change, options) => {
    if (!leadGM() || !("round" in change) || options?.direction !== 1 || change.round < 2) return;
    for (const t of threats().filter(x => x.kind === "boss" && x.tick && x.value < x.size)) await stepThreat(t.id, 1);
  });
  Hooks.once("ready", () => game.socket.on(CHANNEL, async msg => {
    if (msg?.type !== "threatStep" || !leadGM()) return;
    await stepThreat(msg.id, msg.delta);
  }));
}

function rerenderAll() {
  for (const a of game.actors) if (a.type === "pilot" && a.sheet?.rendered) a.sheet.render(false);
  game.thunderbolt?.refreshAwacs?.();
}

/* ---------- шкалы угроз ---------- */

export const threats = () => game.settings.get(SYSTEM_ID, "threats") ?? [];

async function saveThreats(list) {
  if (!game.user.isGM) return ui.notifications.warn("Шкалы угроз ведёт AWACS.");
  return game.settings.set(SYSTEM_ID, "threats", list);
}

/** Новая шкала угрозы: название и размер 4, 6 или 8. */
export async function addThreat() {
  const data = await formDialog("Новая шкала угрозы", `
    <div class="form-group"><label>Угроза</label><input type="text" name="name" placeholder="Особый отдел присматривается"></div>
    <div class="form-group"><label>Делений</label><select name="size"><option value="4">4</option><option value="6" selected>6</option><option value="8">8</option></select></div>
    <div class="form-group"><label>Когда заполнится</label><input type="text" name="note" placeholder="допрос, обыск в казарме или отстранение от вылета"></div>`, { ok: "Завести" });
  if (!data?.name) return null;
  const t = { id: randomID(), name: data.name, size: Number(data.size) || 6, value: 0, note: data.note ?? "" };
  await saveThreats([...threats(), t]);
  return t;
}

/** Сдвинуть шкалу на delta делений; заполненная шкала объявляется в чате. */
export async function stepThreat(id, delta) {
  if (!game.user.isGM) return game.socket.emit(CHANNEL, { type: "threatStep", id, delta });
  const list = foundry.utils.deepClone(threats());
  const t = list.find(x => x.id === id);
  if (!t) return null;
  const was = t.value;
  t.value = Math.max(0, Math.min(t.size, t.value + delta));
  if (t.value === was) return t;
  await saveThreats(list);
  const said = t.kind === "boss" && delta > 0 ? await bossLine(t, was) : null;
  if (t.value >= t.size && was < t.size && said !== "full") await ChatMessage.create({
    speaker: { alias: "AWACS" },
    content: `<div class="tb-card tb-card-threat"><header class="tb-card-head"><span class="tb-card-who">AWACS</span><span class="tb-card-what">${t.kind === "boss" ? "Шкала заполнена" : "Шкала угрозы заполнена"}</span></header>
      <div class="tb-note"><b>${esc(t.name)}</b> (${t.size} из ${t.size}). ${t.kind === "boss" ? esc(t.note || "") : `Неприятность случается${t.note ? `: ${esc(t.note)}` : "."}`}</div></div>`
  });
  return t;
}

/** Деление, на котором срабатывает отметка шкалы боя: 50 %, 75 %, 90 % (вниз до целого, не раньше первого) или заполнение. */
export const bossMarkAt = (key, size) => key === "full" ? size : Math.max(1, Math.floor(size * Number(key) / 100));

/** Реплика AWACS на пройденной отметке: всем в чат и в субтитры; 75 % с CAUTION, 90 % и заполнение с WARNING. */
async function bossLine(t, was) {
  // пройдено сразу несколько отметок: звучит старшая, у которой есть реплика
  const keys = DT.bossMarks.map(([k]) => k).filter(k => { const at = bossMarkAt(k, t.size); return was < at && t.value >= at; }).reverse();
  const use = keys.find(k => (t.lines?.[k] ?? "").trim());
  if (!use) return null;
  const caution = use === "50" ? null : { level: use === "75" ? "caution" : "warning", title: use === "75" ? "CAUTION" : "WARNING", sub: t.name };
  // радио грузится лениво: его окна (Application) не нужны модулям, которые тянут даунтайм
  const { sendRadio } = await import("./radio.mjs");
  await sendRadio({ text: t.lines[use].trim(), caution });
  return use;
}

/** Шкала боя по шаблону (Аркбёрд, SOLG, шахта, рейлган или своя): название, деления, тик в конце раунда и реплики AWACS. */
export async function bossClockDialog(existing = null) {
  const T = DT.bossClocks;
  const cur = existing ?? { ...T.arkbird, lines: { ...T.arkbird.lines } };
  const lines = DT.bossMarks.map(([k, label]) => `<div class="form-group stacked"><label>AWACS на ${label}</label>
    <textarea name="line_${k}" rows="2">${esc(cur.lines?.[k] ?? "")}</textarea></div>`).join("");
  const data = await formDialog(existing ? `Шкала боя: ${existing.name}` : "Новая шкала боя", `
    ${existing ? "" : `<div class="form-group"><label>Шаблон</label><select name="tpl">${Object.entries(T).map(([k, v]) => `<option value="${k}">${esc(v.label)}</option>`).join("")}</select></div>`}
    <div class="form-group"><label>Название</label><input type="text" name="name" value="${esc(cur.name)}" placeholder="«Аркбёрд»: сброс"></div>
    <div class="form-group"><label>Делений</label><input type="number" name="size" min="2" max="12" value="${cur.size}"></div>
    <div class="form-group"><label><input type="checkbox" name="tick" ${cur.tick ? "checked" : ""}> +1 деление в конце каждого раунда</label></div>
    <div class="form-group"><label><input type="checkbox" name="open" ${cur.open ? "checked" : ""}> Видна игрокам на листе</label></div>
    <div class="form-group"><label title="Радарное поле на карте, проверки в конце хода пилота, внезапность +2 к первой атаке по цели, ЗРК и зенитки молчат"><input type="checkbox" name="alarm" ${cur.alarm ? "checked" : ""}> Тревога стелс-миссии</label></div>
    <p class="tb-hint">Тревога: обычно 6 делений, 8 для лёгкой миссии, где шуметь можно много, 4 для очень тихой.</p>
    <div class="form-group"><label>Когда заполнится</label><input type="text" name="note" value="${esc(cur.note ?? "")}"></div>
    <p class="tb-hint">Реплики AWACS звучат у всех, когда шкала доходит до отметки. Пустую отметку AWACS пропускает. На 6 делениях отметки 50 %, 75 % и 90 % стоят на 3, 4 и 5, на 10 делениях на 5, 7 и 9. Если две отметки попали на одно деление, звучит старшая.</p>
    ${lines}`, { ok: existing ? "Сохранить" : "Завести", width: 460, render: root => {
      const sel = root.querySelector('select[name="tpl"]');
      sel?.addEventListener("change", () => {
        const v = T[sel.value];
        const set = (n, val) => { const el = root.querySelector(`[name="${n}"]`); if (el.type === "checkbox") el.checked = !!val; else el.value = val ?? ""; };
        set("name", v.name); set("size", v.size); set("tick", v.tick); set("note", v.note); set("open", v.open); set("alarm", v.alarm);
        for (const [k] of DT.bossMarks) set(`line_${k}`, v.lines[k]);
      });
    } });
  if (!data?.name) return null;
  const patch = { kind: "boss", name: data.name, size: Math.max(2, Math.min(12, Number(data.size) || 6)), tick: !!data.tick, note: data.note ?? "",
    open: !!data.open, alarm: !!data.alarm,
    lines: Object.fromEntries(DT.bossMarks.map(([k]) => [k, data[`line_${k}`] ?? ""])) };
  if (existing) { await editThreat(existing.id, { ...patch, value: Math.min(existing.value, patch.size) }); return { ...existing, ...patch }; }
  const t = { id: randomID(), value: 0, created: Date.now(), ...patch };
  await saveThreats([...threats(), t]);
  return t;
}

export async function deleteThreat(id) {
  return saveThreats(threats().filter(t => t.id !== id));
}

export async function editThreat(id, patch) {
  return saveThreats(threats().map(t => t.id === id ? { ...t, ...patch } : t));
}

/** Шкала делениями: ■■□□ */
export const clockPips = (value, size) => Array.from({ length: size }, (_, i) => ({ on: i < value, i }));

/* ---------- событие на базе ---------- */

export async function baseEvent() {
  const r = await new Roll("1d10").evaluate();
  const [name, text, hook] = DT.events[r.total - 1];
  return ChatMessage.create({
    speaker: { alias: "AWACS" }, rolls: [r], sound: CONFIG.sounds.dice,
    content: `<div class="tb-card tb-card-event"><header class="tb-card-head"><span class="tb-card-who">Событие на базе</span><span class="tb-card-what">d10 = ${r.total}</span></header>
      <div class="tb-note"><b>${esc(name)}.</b> ${esc(text)}</div><div class="tb-note tb-hook">Крючок для общей сцены: <b>«${esc(hook)}»</b></div></div>`
  });
}

/* ---------- проверка на земле ---------- */

/** Навык на земле: ранги и поправки триггеров, без последствий на вылет (Травма). */
function groundParts(actor, skill) {
  const s = actor.system, sk = TB.skills[skill];
  const trig = (s.skillParts?.[skill] ?? []).filter(m => m.name !== DT.edges.trauma);
  return [[sk.label, s.skills[skill]], ...trig.map(m => [m.name, m.value])];
}

const actionsLeft = actor => actor.system.downtime?.actions ?? 0;

function otherPilots(actor) {
  return game.actors.filter(a => a.type === "pilot" && a.id !== actor.id).sort((a, b) => a.name.localeCompare(b.name, "ru"));
}

const skillSelect = (keys, sel) => `<select name="skill">${keys.map(k => `<option value="${k}" ${k === sel ? "selected" : ""}>${TB.skills[k].label} (${TB.skills[k].en})</option>`).join("")}</select>`;

/** Поля Задела для действия. */
function edgeFields(actor, key) {
  const s = actor.system;
  const opt = (obj, sel) => Object.entries(obj).map(([k, v]) => `<option value="${k}" ${k === sel ? "selected" : ""}>${esc(v)}</option>`).join("");
  switch (key) {
    case "hangar": return `
      <div class="form-group"><label>Доводка</label><select name="stat">${opt(Object.fromEntries(Object.entries(DT.tune).map(([k, v]) => [k, v[2]])), "aa")}</select></div>
      <div class="form-group"><label>Встречная цена</label><select name="minus"><option value="">нет</option>${opt(Object.fromEntries(Object.entries(DT.tuneMinus).map(([k, v]) => [k, `${v[1]} −1`])))}</select></div>
      <p class="tb-hint">Evasion и Max Speed поднимаются только со встречной ценой (−1 к другому параметру), без неё только с Perk на 7+.</p>`;
    case "supply": {
      const ws = actor.items.filter(i => i.type === "weapon" && i.system.ammo.max !== null);
      return `<div class="form-group"><label>Что достать</label><select name="want">
        ${ws.map(w => `<option value="ammo:${w.id}">Лишний боекомплект: ${esc(w.name)} +1</option>`).join("")}
        <option value="rare">Редкая машина или модуль</option></select></div>
        <div class="form-group"><label>Что именно</label><input type="text" name="text" placeholder="для редкой машины: прототип, трофей, модуль"></div>`;
    }
    case "intel": return `
      <div class="form-group"><label>Разведданные</label><select name="mode"><option value="question">Вопрос о следующем вылете</option><option value="weak">Слабое место врага: +2 к одной атаке</option></select></div>
      <div class="form-group"><label>Вопрос или враг</label><input type="text" name="text" placeholder="«Будут ли асы?» или эскадрилья «Пеликан»"></div>`;
    case "training": return `<div class="form-group"><label>Тренируемый навык</label><select name="trained">${Object.entries(TB.skills).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join("")}</select></div>
      <p class="tb-hint">Задел «Наработка»: раз за вылет перебросить d10 в проверке этого навыка. Бросок обычно этим же навыком, изнурительный облёт через Push.</p>`;
    case "personal": return s.goals.length
      ? `<div class="form-group"><label>Цель</label><select name="goal">${s.goals.map((g, i) => `<option value="${i}">${esc(g.name || "цель")} · ${g.value}/${g.size}</option>`).join("")}</select></div>`
      : `<p class="tb-hint">Личной цели ещё нет: заведите её на вкладке «Даунтайм».</p>`;
    case "custom": return `<div class="form-group"><label>Задел при успехе</label><input type="text" name="text" placeholder="что даст успех на следующий вылет"></div>`;
    case "leave": return `<p class="tb-hint">Задел «Свежая голова»: +2 Strain сверх максимума на вылет. Чистый успех ещё и снимает 1 Нервы (с Perk 2), на 4–6 выбор: Задел или −1 Нервы.</p>`;
    default: return "";
  }
}

/** Задел, который даст успех, по ответам окна. */
function edgeSpec(actor, key, data) {
  switch (key) {
    case "hangar": return { kind: "tune", stat: data.stat, minus: data.minus && data.minus !== data.stat ? data.minus : "" };
    case "supply": return data.want?.startsWith("ammo:") ? { kind: "ammo", weapon: data.want.slice(5) } : { kind: "rare", text: data.text };
    case "intel": return { kind: "intel", mode: data.mode, text: data.text };
    case "training": return { kind: "practice", skill: data.trained };
    case "leave": return { kind: "fresh" };
    case "custom": return data.text ? { kind: "custom", text: data.text } : null;
    default: return null;
  }
}

/** Подпись Задела: «Доводка: A-A +1, Evasion −1». */
export function edgeLabel(e, actor) {
  const name = DT.edges[e.kind] ?? "Задел";
  const minus = [e.minus, e.minus2].filter(Boolean).map(m => `${DT.tuneMinus[m]?.[1] ?? m} −1`);
  switch (e.kind) {
    case "tune": return `${name}: ${[DT.tune[e.stat]?.[2] ?? e.stat, ...minus].join(", ")}`;
    case "ammo": return `${name}: ${actor?.items.get(e.weapon)?.name ?? "спецоружие"} +1`;
    case "intel": return `${name}: ${e.mode === "weak" ? "слабое место" : "вопрос"}${e.text ? ` (${e.text})` : ""}`;
    case "practice": return `${name}: ${TB.skills[e.skill]?.label ?? e.skill}${e.comp ? ", только d10 1–5" : ""}`;
    case "fresh": return `${name}: +2 Strain сверх максимума`;
    case "memory": return `${name}: ${e.text} +${e.value}`;
    case "fatigue": return `${name}: Max Strain −2`;
    case "trauma": return `${name}: ${TB.skills[e.skill]?.label ?? "навык"} −1`;
    default: return e.text ? `${e.kind === "custom" ? "" : name + ": "}${e.text}` : name;
  }
}

/**
 * Проверка на земле. action — ключ действия даунтайма (тратит одно действие) или пусто для простой проверки.
 * Итог: d10 + навык + Lead помощника + Связь + обстоятельства (±2) против 7 или против броска NPC.
 */
export async function rollGround(actor, action = "") {
  if (actor?.type !== "pilot") return ui.notifications.warn("Проверка на земле только у пилота.");
  const s = actor.system, act = DT.actions[action];
  if (act && !act.skills.length) return simpleAction(actor, action);
  if (act && actionsLeft(actor) <= 0 && !(await Dialog.confirm({ title: act.label, content: "<p>Действий в этом даунтайме не осталось. Всё равно сделать?</p>" }))) return;
  if (action === "personal" && !s.goals.length) return ui.notifications.warn("Сначала заведите личную цель на вкладке «Даунтайм».");
  const keys = act?.skills ?? Object.keys(TB.skills);
  const bonds = s.bonds.map((b, i) => ({ ...b, i })).filter(b => !b.dead && b.value > 0 && !b.usedGround);
  const helpers = otherPilots(actor);
  const q = s.questions ?? {};
  const data = await formDialog(act ? `${act.label}: проверка на земле` : "Проверка на земле", `
    ${act ? `<p class="tb-hint">${esc(act.hint)}. Тратит действие: осталось ${actionsLeft(actor)} из 2.</p>` : `<p class="tb-hint">Только когда есть риск. AWACS заранее называет цену на 4–6 и что пойдёт не так на 3 и ниже.</p>`}
    <div class="form-group"><label>Навык</label>${skillSelect(keys, keys[0])}</div>
    ${edgeFields(actor, action)}
    <div class="form-group"><label>Помощь товарища</label><select name="helper"><option value="">без помощи</option>${helpers.map(h => `<option value="${h.id}">${esc(h.name)}: Lead ${h.system.skillTotal?.lead ?? 0}</option>`).join("")}</select></div>
    ${bonds.length ? `<div class="form-group"><label>Связь (помогает товарищу)</label><select name="bond"><option value="">нет</option>${bonds.map(b => `<option value="${b.i}">${esc(b.name)} +${b.value}</option>`).join("")}</select></div>` : ""}
    <div class="form-group"><label>Обстоятельства</label><select name="circ"><option value="0" selected>обычные</option><option value="2">+2: подготовка, связи, инструмент</option><option value="-2">−2: спешка, чужая территория</option></select></div>
    <div class="form-group"><label><input type="checkbox" name="strong"> В своей стихии: Perk на 3–4${q.ground ? ` <small>(${esc(q.ground)})</small>` : ""}</label></div>
    <div class="form-group"><label><input type="checkbox" name="fear"> Лицом к страху: Complication на 1–2${q.fear ? ` <small>(${esc(q.fear)})</small>` : ""}</label></div>
    <div class="form-group"><label>Встречная: навык NPC</label><input type="text" name="npc" placeholder="пусто: против 7"></div>
    ${s.edgeFly ? `<p class="tb-hint">На пределе: Complication на 1–2 во всех проверках (со страхом на 1–3).</p>` : ""}`, { width: 460 });
  if (!data) return;
  const skill = keys.includes(data.skill) ? data.skill : keys[0];
  const parts = groundParts(actor, skill);
  const helper = data.helper ? game.actors.get(data.helper) : null;
  if (helper) parts.push([`Lead: ${helper.name}`, helper.system.skillTotal?.lead ?? 0]);
  const bond = data.bond !== "" && data.bond !== undefined ? s.bonds[Number(data.bond)] : null;
  if (bond) parts.push([`Связь: ${bond.name}`, bond.value]);
  const circ = Number(data.circ) || 0;
  if (circ) parts.push(["обстоятельства", circ]);
  const r10 = await new Roll("1d10").evaluate(), r4 = await new Roll("1d4").evaluate();
  const rolls = [r10, r4];
  let dc = TB.difficulty, opposed = null;
  if (String(data.npc ?? "").trim() !== "") {
    const npcSkill = Number(data.npc) || 0, rn = await new Roll("1d10").evaluate();
    rolls.push(rn);
    opposed = { d10: rn.total, skill: npcSkill };
    dc = rn.total + npcSkill;
  }
  const perkOn = Math.min(data.strong ? 3 : 4, (s.groundPerkOn ?? s.perkOn)?.[skill] ?? 4);
  const compOn = ((s.groundCompOn ?? s.compOn)?.[skill] ?? 1) + (data.fear ? 1 : 0);
  const spec = act ? edgeSpec(actor, action, data) : null;
  const card = {
    type: "ground", label: act ? act.label : `Проверка на земле: ${TB.skills[skill].label}`, rolled: true,
    d10: r10.total, d4: r4.total, parts, strain: 0, dc, perkOn, compOn, skill, action, opposed,
    edge: spec, goal: action === "personal" ? Number(data.goal) || 0 : null, helper: helper?.name ?? "", costs: []
  };
  const msg = await postCard(actor, card, rolls);
  const upd = {};
  if (act) upd["system.downtime.actions"] = Math.max(0, actionsLeft(actor) - 1);
  if (bond) {
    const list = foundry.utils.deepClone(s.bonds);
    list[Number(data.bond)].usedGround = true;
    upd["system.bonds"] = list;
  }
  if (Object.keys(upd).length) await actor.update(upd);
  return msg;
}

/** Действия без броска: сцена с товарищем, помощь, сцена «Срыв». */
async function simpleAction(actor, action) {
  const s = actor.system, act = DT.actions[action];
  if (action === "breakdown" && s.nerves < DT.maxNerves) return ui.notifications.warn("Сцена «Срыв» только для пилота на пределе (Нервы 5).");
  if (actionsLeft(actor) <= 0 && !(await Dialog.confirm({ title: act.label, content: "<p>Действий в этом даунтайме не осталось. Всё равно сделать?</p>" }))) return;
  const pilots = otherPilots(actor);
  let content = `<p class="tb-hint">${esc(act.hint)}. Тратит действие: осталось ${actionsLeft(actor)} из 2.</p>`;
  if (action === "scene") content += `
    <div class="form-group"><label>С кем</label><select name="who">${pilots.map(p => `<option value="pilot:${p.id}">${esc(p.name)}</option>`).join("")}
      ${s.bonds.filter(b => b.npc && !b.dead).map(b => `<option value="npc:${esc(b.name)}">${esc(b.name)} (NPC)</option>`).join("")}<option value="new">новый NPC…</option></select></div>
    <div class="form-group"><label>Новый NPC</label><input type="text" name="npcName" placeholder="старший техник Ершов"></div>
    <div class="form-group"><label>Вопрос-крючок</label><input type="text" name="hook" placeholder="Ты считаешь меня хорошим пилотом?"></div>
    <div class="form-group"><label><input type="checkbox" name="grow" checked> Между ними что-то изменилось: Связь +1</label></div>`;
  if (action === "help") content += `<div class="form-group"><label>Кому</label><select name="who">${pilots.map(p => `<option value="${p.id}">${esc(p.name)}: его проверка получит ваш Lead ${s.skillTotal?.lead ?? 0}</option>`).join("")}</select></div>
    <p class="tb-hint">В окне его проверки выберите вас помощником. Цену делите на двоих.</p>`;
  if (action === "breakdown") content += `<p class="tb-hint">Пилот выговаривается товарищу, командиру или самому себе. Нервы падают до 2.</p>`;
  if (action !== "help") content += `<div class="form-group"><label>Строка в досье</label><input type="text" name="line" placeholder="что изменилось в пилоте"></div>`;
  const data = await formDialog(act.label, content, { ok: "Сыграно" });
  if (!data) return;
  const upd = { "system.downtime.actions": Math.max(0, actionsLeft(actor) - 1) };
  const notes = [];
  if (action === "scene") {
    let name = "", uuid = "", npc = false;
    if (data.who?.startsWith("pilot:")) { const p = game.actors.get(data.who.slice(6)); name = p?.name ?? ""; uuid = p?.uuid ?? ""; }
    else if (data.who?.startsWith("npc:")) { name = data.who.slice(4); npc = true; }
    else { name = data.npcName; npc = true; }
    if (data.hook) notes.push(`Крючок: «${esc(data.hook)}»`);
    if (name && data.grow) {
      const r = growBond(s.bonds, { name, uuid, npc, cap: bondCap(actor, npc) });
      if (r.list) upd["system.bonds"] = r.list;
      notes.push(r.note);
    } else if (name) notes.push(`Сцена с ${esc(name)}.`);
  }
  if (action === "help") notes.push(`Помогает: ${esc(game.actors.get(data.who)?.name ?? "товарищу")}.`);
  if (action === "breakdown") { upd["system.nerves"] = Math.min(s.nerves, 2); upd["system.onEdge"] = ""; notes.push("Нервы падают до 2: пилот больше не на пределе."); }
  if (data.line) {
    upd["system.dossier"] = [...foundry.utils.deepClone(s.dossier).filter(d => d.text || d.struck), { text: data.line, struck: false }];
    notes.push(`В досье: «${esc(data.line)}».`);
    const got = resolveGain(actor);
    if (got) Object.assign(upd, got.upd);
    notes.push(got ? got.note : "Решимость в этом даунтайме уже получена (или её уже 2).");
  }
  await actor.update(upd);
  return ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<div class="tb-card tb-card-ground"><header class="tb-card-head"><span class="tb-card-who">${esc(actor.name)}</span><span class="tb-card-what">${esc(act.label)}</span></header>
      ${notes.map(n => `<div class="tb-note">${n}</div>`).join("")}<div class="tb-note tb-muted">Без броска. Действий осталось: ${upd["system.downtime.actions"]}.</div></div>`
  });
}

/** +1 Решимость, если её в этом даунтайме ещё не давали и меньше двух. */
function resolveGain(actor) {
  const s = actor.system;
  if (s.downtime.resolveGot || s.resolve >= DT.maxResolve) return null;
  return { upd: { "system.resolve": s.resolve + 1, "system.downtime.resolveGot": true }, note: `+1 Решимость (${s.resolve + 1} из ${DT.maxResolve}).` };
}

/** Предел Связи: с NPC 2, у Наёмника с Контрактом тоже 2, иначе 3. */
export function bondCap(actor, npc) {
  if (npc) return DT.maxNpcBond;
  return actor?.items?.some?.(i => i.type === "trigger" && i.system.key === "contract") ? DT.maxNpcBond : DT.maxBond;
}

/** Рост Связи на 1 (не больше раза на пару за даунтайм); новая Связь с пилотом или NPC начинается с 1. */
function growBond(bonds, { name, uuid, npc, cap = npc ? DT.maxNpcBond : DT.maxBond }) {
  const list = foundry.utils.deepClone(bonds);
  const b = list.find(x => (uuid && x.uuid === uuid) || (!uuid && x.name === name));
  if (!b) {
    if (npc && list.filter(x => x.npc && !x.dead).length >= 2) return { note: `Связей с NPC уже две: с ${esc(name)} Связь не заводится.` };
    list.push({ name, uuid, npc, value: 1, was: [], dead: false, used: false, usedGround: false, grown: true });
    return { list, note: `Новая Связь: ${esc(name)} 1.` };
  }
  if (b.dead) return { note: `${esc(name)} погиб: Связь осталась Памятью.` };
  if (b.grown) return { note: `Связь с ${esc(name)} в этом даунтайме уже росла.` };
  if (b.value >= cap) return { note: `Связь с ${esc(name)} уже ${b.value}, больше не бывает.` };
  b.value += 1; b.grown = true;
  return { list, note: `Связь с ${esc(name)}: ${b.value}.` };
}

/** Разрыв: Связь падает (старое значение зачёркнуто, но остаётся). */
export function dropBond(bonds, i, to = null) {
  const list = foundry.utils.deepClone(bonds), b = list[i];
  if (!b) return list;
  const v = to ?? Math.max(0, b.value - 1);
  if (v === b.value) return list;
  if (v < b.value) b.was = [...(b.was ?? []), b.value];
  b.value = v;
  return list;
}

/* ---------- карточка проверки на земле ---------- */

const tierOf = c => { const d = c.total - c.dc; return d >= 0 ? "clean" : d >= -3 ? "cost" : "fail"; };

export function renderGround(card) {
  const c = computeCard(card);
  const tier = tierOf(c);
  const actor = resolveActor(c.actorUuid);
  const parts = c.parts.map(([l, v]) => `<span class="tb-part">${esc(l)} ${sign(v)}</span>`).join(" ");
  const rows = [`<div class="tb-dice"><span class="tb-die d10">${c.d10}</span>${parts}</div>`];
  const vs = c.opposed ? `броска NPC ${c.dc} <small>(d10 ${c.opposed.d10} ${sign(c.opposed.skill)})</small>` : `${c.dc}`;
  rows.push(`<div class="tb-total">Итог <b>${c.total}</b> против ${vs} → <b class="tb-tier ${tier}">${DT.tiers[tier]}</b></div>`);
  rows.push(`<div class="tb-note">${DT.tierHint[tier]}</div>`);
  const d4 = [];
  if (c.perk) d4.push(`<b>Perk</b>: ${DT.perkText[tier]}`);
  if (c.comp) d4.push(`<b>Complication</b>: ${DT.compText[tier]}`);
  rows.push(`<div class="tb-d4 ${c.perk ? "perk" : c.comp ? "comp" : ""}">d4 = ${c.d4}${c.resolveUsed ? " (Решимость)" : ""}${d4.length ? ": " + d4.join(" ") : ""}</div>`);
  if (c.helper) rows.push(`<div class="tb-note">Помогал ${esc(c.helper)}: цена на двоих.</div>`);
  if (c.edge && !c.edgeTaken && tier !== "fail") rows.push(`<div class="tb-note">Задел при успехе: <b>${esc(edgeLabel({ ...c.edge, comp: c.compromise }, actor))}</b>${c.compromise ? " (Компромисс)" : ""}.</div>`);
  if (c.edgeTaken) rows.push(`<div class="tb-note">Записано: ${esc(c.edgeTaken)}.</div>`);
  if (c.goalDone) rows.push(`<div class="tb-note">${esc(c.goalDone)}</div>`);
  for (const n of c.costs ?? []) rows.push(`<div class="tb-note tb-cost">Цена: ${n}</div>`);

  const btn = [];
  btn.push(...resolveButton(c, actor));
  if (c.edge && !c.edgeTaken && tier !== "fail") {
    if (c.action === "leave") {
      if (tier === "clean") btn.push(`<button type="button" data-tb-action="dt-edge" class="tb-owner">Свежая голова и −${c.perk ? 2 : 1} Нервы</button>`);
      else btn.push(`<button type="button" data-tb-action="dt-edge" class="tb-owner">Задел «Свежая голова»</button>`,
        `<button type="button" data-tb-action="dt-calm" class="tb-owner">Вместо Задела −1 Нервы</button>`);
    } else btn.push(`<button type="button" data-tb-action="dt-edge" class="tb-owner"><i class="fas fa-bookmark"></i> Записать Задел</button>`);
  }
  if (c.action === "personal" && c.goal !== null && !c.goalDone && tier !== "fail")
    btn.push(`<button type="button" data-tb-action="dt-goal" class="tb-owner">Шкала цели +${tier === "clean" ? 2 : 1}</button>`);
  if (tier !== "clean" || c.comp) {
    const can = k => k !== "trauma" || tier === "fail" || c.comp;
    btn.push(`<span class="tb-cost-row tb-gm">${Object.entries(DT.costs).filter(([k]) => can(k))
      .map(([k, v]) => `<button type="button" data-tb-action="dt-cost" data-cost="${k}" class="tb-gm" title="${esc(v.hint)}">${esc(v.label)}</button>`).join("")}</span>`);
  }
  return `<div class="tb-card tb-card-ground">
    <header class="tb-card-head"><span class="tb-card-who">${esc(c.actorName)}</span><span class="tb-card-what">${esc(c.label)}</span></header>
    ${rows.join("")}
    ${btn.length ? `<div class="tb-actions">${btn.join("")}</div>` : ""}
  </div>`;
}

/** Кнопка «Решимость: d4 = 4» для любой карточки с d4, пока у пилота есть Решимость. */
export function resolveButton(c, actor = resolveActor(c.actorUuid)) {
  if (!c.rolled || c.d4 === null || c.d4 === undefined || c.d4 >= 4 || c.resolveUsed) return [];
  if (actor?.type !== "pilot" || !(actor.system.resolve > 0)) return [];
  return [`<button type="button" data-tb-action="dt-resolve" class="tb-owner" title="Потратить 1 Решимость: d4 считается выпавшим на 4 (Perk)"><i class="fas fa-fire"></i> Решимость: d4 = 4</button>`];
}

/** Кнопки даунтайма на карточках. Возвращает true, если действие обработано. */
export async function groundAction(message, card, action, button, actor, save) {
  switch (action) {
    case "dt-resolve": {
      if (!actor?.isOwner || card.resolveUsed) return true;
      if (!(actor.system.resolve > 0)) { ui.notifications.warn("Решимости нет."); return true; }
      card.d4 = 4; card.resolveUsed = true;
      await actor.update({ "system.resolve": actor.system.resolve - 1 });
      await save();
      return true;
    }
    case "dt-edge": {
      if (!actor?.isOwner || card.edgeTaken) return true;
      const c = computeCard(card), tier = tierOf(c);
      const spec = { ...card.edge, id: randomID(), comp: !!card.compromise, used: false, value: 0 };
      // Perk на чистом успехе: Evasion или Max Speed без встречной цены
      if (spec.kind === "tune" && tier === "clean" && c.perk && ["ev", "spd"].includes(spec.stat)) spec.minus = "";
      const why = edgeProblem(actor, spec);
      if (why) { ui.notifications.warn(why); return true; }
      const upd = { "system.edges": [...foundry.utils.deepClone(actor.system.edges), spec] };
      card.edgeTaken = edgeLabel(spec, actor);
      if (card.action === "leave" && tier === "clean") {
        const down = c.perk ? 2 : 1;
        upd["system.nerves"] = Math.max(0, actor.system.nerves - down);
        card.edgeTaken += `, Нервы −${down}`;
      }
      if (spec.kind === "tune" && ["ev", "spd"].includes(spec.stat) && !spec.minus && !(tier === "clean" && c.perk))
        ui.notifications.info("Evasion и Max Speed поднимаются со встречной ценой: выберите её у Задела на вкладке «Даунтайм».");
      await actor.update(upd);
      await save();
      return true;
    }
    case "dt-calm": {
      if (!actor?.isOwner || card.edgeTaken) return true;
      await actor.update({ "system.nerves": Math.max(0, actor.system.nerves - 1) });
      card.edgeTaken = "вместо Задела Нервы −1";
      await save();
      return true;
    }
    case "dt-goal": {
      if (!actor?.isOwner || card.goalDone) return true;
      const tier = tierOf(computeCard(card));
      const goals = foundry.utils.deepClone(actor.system.goals), g = goals[card.goal];
      if (!g) { ui.notifications.warn("Этой цели на листе уже нет."); return true; }
      const step = tier === "clean" ? 2 : 1;
      g.value = Math.min(g.size, g.value + step);
      const upd = { "system.goals": goals };
      card.goalDone = `Цель «${g.name}»: ${g.value} из ${g.size}.`;
      if (g.value >= g.size) {
        card.goalDone += " Цель достигнута: допишите строку в досье.";
        const got = resolveGain(actor);
        if (got) { Object.assign(upd, got.upd); card.goalDone += ` ${got.note}`; }
      }
      await actor.update(upd);
      await save();
      return true;
    }
    case "dt-cost": {
      if (!game.user.isGM) return true;
      const note = await applyCost(actor, card, button?.dataset.cost);
      if (note) { (card.costs ??= []).push(note); await save(); }
      return true;
    }
    case "dt-break": {
      if (!actor?.isOwner || card.chosen) return true;
      await applyBreakdown(actor, button?.dataset.kind);
      card.chosen = button?.dataset.kind;
      await save();
      return true;
    }
  }
  return false;
}

/** Почему Задел нельзя записать: лимит трёх, вторая такая же доводка. */
function edgeProblem(actor, spec) {
  const s = actor.system;
  if (!DT.notEdges.includes(spec.kind) && s.edgeCount >= DT.maxEdges) return `У ${actor.name} уже ${DT.maxEdges} Задела: уберите один на вкладке «Даунтайм».`;
  if (spec.kind === "tune" && s.edges.some(e => e.kind === "tune" && e.stat === spec.stat)) return "Одна и та же доводка на вылет только одна.";
  return "";
}

/** Цена от AWACS: применить к пилоту и вернуть строку для карточки. */
async function applyCost(actor, card, key) {
  const cost = DT.costs[key];
  if (!cost || !actor) return null;
  const s = actor.system;
  switch (key) {
    case "escalate": {
      const list = threats();
      const data = await formDialog("Эскалация", `
        <div class="form-group"><label>Шкала угрозы</label><select name="id">${list.map(t => `<option value="${t.id}">${esc(t.name)} · ${t.value}/${t.size}</option>`).join("")}<option value="new">новая шкала…</option></select></div>`, { ok: "+1 деление" });
      if (!data) return null;
      const t = data.id === "new" ? await addThreat() : list.find(x => x.id === data.id);
      if (!t) return null;
      const now = await stepThreat(t.id, 1);
      return `Эскалация: «${esc(t.name)}» ${now?.value ?? t.value + 1}/${t.size}.`;
    }
    case "debt": {
      const data = await formDialog("Долг", `<div class="form-group"><label>Кому и что должен</label><input type="text" name="text" placeholder="интенданту Кравцу: ящик коньяка"></div>`, { ok: "Записать" });
      if (!data?.text) return null;
      await actor.update({ "system.debts": [...foundry.utils.deepClone(s.debts), { text: data.text, struck: false }] });
      return `Долг: ${esc(data.text)}.`;
    }
    case "time": {
      const left = Math.max(0, s.downtime.actions - 1);
      await actor.update({ "system.downtime.actions": left });
      return `Время: следующее действие потеряно (осталось ${left}).`;
    }
    case "compromise": {
      card.compromise = true;
      const edgeId = card.edge && card.edgeTaken ? s.edges.find(e => edgeLabel(e, actor) === card.edgeTaken)?.id : null;
      let extra = "";
      if (card.edge?.kind === "tune") {
        const data = await formDialog("Компромисс: доводка", `<div class="form-group"><label>−1 к параметру</label><select name="m">${Object.entries(DT.tuneMinus).filter(([k]) => k !== card.edge.stat).map(([k, v]) => `<option value="${k}">${v[1]}</option>`).join("")}</select></div>`, { ok: "Так" });
        if (data?.m) { card.edge.minus2 = data.m; extra = `, ${DT.tuneMinus[data.m][1]} −1`; }
      }
      if (edgeId) {
        const edges = foundry.utils.deepClone(s.edges).map(e => e.id === edgeId ? { ...e, comp: true, minus2: card.edge.minus2 ?? e.minus2 } : e);
        await actor.update({ "system.edges": edges });
      }
      const how = { supply: "вместо выбранного то, что было на складе", intel: "ответ неполный или устаревший", training: "перебросить можно только d10 1–5" }[card.action] ?? "Задел урезан";
      return `Компромисс: ${how}${extra}.`;
    }
    case "quarrel": {
      const alive = s.bonds.map((b, i) => ({ ...b, i })).filter(b => !b.dead && b.value > 0);
      if (!alive.length) return "Ссора: NPC теперь относится холодно.";
      const data = await formDialog("Ссора", `<div class="form-group"><label>С кем</label><select name="i">${alive.map(b => `<option value="${b.i}">${esc(b.name)} (${b.value})</option>`).join("")}<option value="npc">NPC без Связи</option></select></div>`, { ok: "−1 Связь" });
      if (!data) return null;
      if (data.i === "npc") return "Ссора: NPC теперь относится холодно.";
      const b = s.bonds[Number(data.i)];
      await actor.update({ "system.bonds": dropBond(s.bonds, Number(data.i)) });
      return `Ссора: Связь с ${esc(b.name)} ${b.value} → ${b.value - 1}.`;
    }
    case "fatigue":
      await actor.update({ "system.edges": [...foundry.utils.deepClone(s.edges), { id: randomID(), kind: "fatigue" }] });
      return "Усталость: Max Strain −2 на следующий вылет.";
    case "nerves": {
      if (s.edgeFly) return "Нервы: пилот на пределе, Нервы больше не растут.";
      const v = Math.min(DT.maxNerves, s.nerves + 1);
      await actor.update({ "system.nerves": v });
      return `Нервы +1 (${v} из ${DT.maxNerves}).`;
    }
    case "trauma": {
      const data = await formDialog("Травма", `<div class="form-group"><label>Навык −1 на вылет</label>${skillSelect(Object.keys(TB.skills), card.skill)}</div>`, { ok: "Записать" });
      if (!data) return null;
      await actor.update({ "system.edges": [...foundry.utils.deepClone(s.edges), { id: randomID(), kind: "trauma", skill: data.skill }] });
      return `Травма: ${TB.skills[data.skill].label} −1 на следующий вылет.`;
    }
  }
  return null;
}

/* ---------- Нервы, «На пределе» и срыв ---------- */

/** Выбор на Нервах 5 перед вылетом: лететь на пределе или рапорт об отдыхе. */
export async function chooseEdge(actor, choice) {
  const s = actor.system;
  if (s.nerves < DT.maxNerves) return;
  if (choice === "fly") {
    await actor.update({ "system.onEdge": "fly" });
    return say(actor, "летит на пределе", "Strain на 2 ниже максимума, Complication на 1–2 во всех проверках, раз за вылет возможен срыв. Нервы больше не растут.");
  }
  if (!(await Dialog.confirm({ title: "Рапорт об отдыхе", content: `<p>${esc(actor.name)} пропускает вылет, игрок играет «запасного». Нервы падают до 0. Подать рапорт?</p>` }))) return;
  await actor.update({ "system.nerves": 0, "system.onEdge": "" });
  return say(actor, "подал рапорт об отдыхе", "Пропускает этот вылет. Нервы 0.");
}

function say(actor, what, text) {
  return ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<div class="tb-card tb-card-nerves"><header class="tb-card-head"><span class="tb-card-who">${esc(actor.name)}</span><span class="tb-card-what">${esc(what)}</span></header><div class="tb-note">${esc(text)}</div></div>`
  });
}

/**
 * Срыв: у пилота на пределе раз за вылет, при первой d4 = 1 или первой метке урона.
 * Карточка с тремя видами срыва: выбирает и отыгрывает игрок.
 */
export async function checkBreakdown(actor, why) {
  if (actor?.type !== "pilot" || !actor.system.edgeFly || actor.system.breakdown || !actor.isOwner) return;
  await actor.update({ "system.breakdown": "pending" });
  const card = { type: "breakdown", actorUuid: actor.uuid, actorName: actor.name, why };
  return ChatMessage.create({ speaker: { alias: "AWACS" }, content: renderBreakdown(card), flags: { [SYSTEM_ID]: { card } } });
}

export function renderBreakdown(c) {
  const chosen = c.chosen ? DT.breakdowns[c.chosen] : null;
  return `<div class="tb-card tb-card-breakdown"><header class="tb-card-head"><span class="tb-card-who">Срыв</span><span class="tb-card-what">${esc(c.actorName)}</span></header>
    <div class="tb-note">Пилот на пределе: ${esc(c.why)}. Это сцена: вид срыва выбирает и отыгрывает игрок, если не хочет, описывает AWACS. Платит весь следующий ход и эффектом до конца вылета.</div>
    ${chosen ? `<div class="tb-note"><b>${chosen.label}.</b> ${chosen.text}</div>`
      : `<div class="tb-actions">${Object.entries(DT.breakdowns).map(([k, v]) => `<button type="button" data-tb-action="dt-break" data-kind="${k}" class="tb-owner" title="${esc(v.text)}">${v.label}</button>`).join("")}</div>`}
  </div>`;
}

async function applyBreakdown(actor, kind) {
  if (!DT.breakdowns[kind]) return;
  const upd = { "system.breakdown": kind };
  if (kind === "stupor") {
    upd["system.speed"] = actor.system.speed - 2;
    await actor.setFlag(SYSTEM_ID, "stupor", true);   // следующий раунд пасует сам (combat.mjs)
  }
  if (kind === "panic") Object.assign(upd, { "system.lock": "", "system.lockUuid": "", "system.strain.value": 0 });
  return actor.update(upd, { tbFree: true });
}

/* ---------- Связи между листами и гибель товарища ---------- */

/** Связь с пилотом записана на листах обоих: значение и зачёркнутые прежние значения совпадают. */
async function mirrorBonds(actor) {
  for (const b of actor.system.bonds) {
    if (!b.uuid || b.npc) continue;
    const other = resolveActor(b.uuid);
    if (other?.type !== "pilot" || other.id === actor.id) continue;
    const list = foundry.utils.deepClone(other.system.bonds);
    const mine = list.find(x => x.uuid === actor.uuid);
    if (!mine) list.push({ name: actor.name, uuid: actor.uuid, npc: false, value: b.value, was: b.was ?? [], dead: false, used: false, usedGround: false, grown: b.grown });
    else if (mine.value !== b.value || JSON.stringify(mine.was ?? []) !== JSON.stringify(b.was ?? [])) Object.assign(mine, { value: b.value, was: b.was ?? [], grown: b.grown });
    else continue;
    await other.update({ "system.bonds": list });
  }
}

/** Гибель пилота: у каждого, кто был с ним связан, Связь становится Памятью того же размера на следующий вылет. */
async function fallen(actor) {
  const lines = [];
  for (const p of game.actors.filter(a => a.type === "pilot" && a.id !== actor.id)) {
    const list = foundry.utils.deepClone(p.system.bonds);
    const b = list.find(x => x.uuid === actor.uuid || (!x.uuid && x.name === actor.name));
    if (!b || b.dead) continue;
    b.dead = true;
    const upd = { "system.bonds": list, [`flags.${SYSTEM_ID}.bondLoss`]: true };
    if (b.value > 0) upd["system.edges"] = [...foundry.utils.deepClone(p.system.edges), { id: randomID(), kind: "memory", text: actor.name, value: b.value }];
    await p.update(upd);
    lines.push(`${esc(p.name)}: Память +${b.value}`);
  }
  if (lines.length) await ChatMessage.create({
    speaker: { alias: "AWACS" },
    content: `<div class="tb-card tb-card-memory"><header class="tb-card-head"><span class="tb-card-who">AWACS</span><span class="tb-card-what">Погиб ${esc(actor.name)}</span></header>
      <div class="tb-note">${lines.join("<br>")}</div><div class="tb-note tb-muted">В следующем вылете Память один раз прибавляется к любому броску. На разборе Нервы +1.</div></div>`
  });
}

/* ---------- в вылете: Связь, Память, слабое место ---------- */

/** Прибавить Связь к следующему броску (раз за вылет на каждую Связь). */
export async function useBond(actor, i) {
  const list = foundry.utils.deepClone(actor.system.bonds), b = list[i];
  if (!b || b.dead || b.used || !b.value) return;
  b.used = true;
  await giveNext(actor, { label: `Связь: ${b.name}`, value: b.value });
  return actor.update({ "system.bonds": list });
}

/** Память или «Слабое место»: бонус к следующему броску, Задел отмечается использованным. */
export async function useEdge(actor, id) {
  const list = foundry.utils.deepClone(actor.system.edges), e = list.find(x => x.id === id);
  if (!e || e.used) return;
  if (e.kind === "memory") await giveNext(actor, { label: `Память: ${e.text}`, value: e.value });
  else if (e.kind === "intel" && e.mode === "weak") await giveNext(actor, { label: `Слабое место${e.text ? `: ${e.text}` : ""}`, value: 2 });
  else return;
  e.used = true;
  return actor.update({ "system.edges": list });
}

/** Наработка, которой можно перебросить d10 этого навыка (не использованная в этом вылете). */
export function practiceFor(actor, skill, d10) {
  if (actor?.type !== "pilot" || !skill) return null;
  return actor.system.edges?.find(e => e.kind === "practice" && e.skill === skill && !e.used && (!e.comp || d10 <= 5)) ?? null;
}

/* ---------- перед вылетом и после ---------- */

/** Strain на старте: −2 на Нервах 3+ (и на пределе), +2 сверх максимума со «Свежей головой». */
export function startStrain(actor) {
  const s = actor.system, notes = [];
  let v = s.strain.max;
  if (s.nerves >= 3) { v -= 2; notes.push(`Нервы ${s.nerves}: Strain −2`); }
  if (s.edges.some(e => e.kind === "fresh" && !e.used)) { v += 2; notes.push("Свежая голова: +2 сверх максимума"); }
  return { value: Math.max(0, v), notes };
}

/** Подсказка на разборе: сколько Нервов прибавить за вылет (не больше 2, на пределе не растут). */
export function nervesHint(actor) {
  const s = actor.system;
  if (s.edgeFly) return { up: 0, why: "на пределе: не растут" };
  const why = [];
  if (s.markerCount >= 2) why.push("две метки урона");
  if (actor.getFlag(SYSTEM_ID, "bondLoss")) why.push("погиб товарищ со Связью");
  return { up: Math.min(2, why.length), why: why.join(", ") };
}

/** После вылета: Нервы, Заделы сгорают, Связи снова доступны, новый даунтайм с двумя действиями. */
export function afterSortieUpdate(actor, nervesUp) {
  const s = actor.system;
  const up = s.edgeFly ? 0 : Math.max(0, Math.min(2, nervesUp));
  const status = s.service.status;
  const actions = ["hospital"].includes(status) ? 1 : ["active", ""].includes(status) ? 2 : 0;
  const bonds = foundry.utils.deepClone(s.bonds).map(b => ({ ...b, used: false, usedGround: false, grown: false }));
  const upd = {
    "system.nerves": Math.min(DT.maxNerves, s.nerves + up), "system.onEdge": "", "system.breakdown": "",
    "system.edges": [], "system.bonds": bonds,
    "system.downtime": { actions, resolveGot: false, nervesDown: false },
    [`flags.${SYSTEM_ID}.-=bondLoss`]: null, [`flags.${SYSTEM_ID}.-=stupor`]: null
  };
  const notes = [];
  if (up) notes.push(`Нервы +${up} (${Math.min(DT.maxNerves, s.nerves + up)})`);
  if (s.edges.length) notes.push("Заделы сгорели");
  return { upd, notes };
}
