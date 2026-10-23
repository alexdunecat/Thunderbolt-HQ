/* Небоевые триггеры: гибель пилота («Всё, чему я научился», «Я продолжу твоё дело», «Наследие проекта», «Голос в эфире»),
   «Наставник» (урок на вылет, замена при гибели наставника), «Без лишних вопросов» (Репутация вместо Нервов),
   «Пересмотр условий» (доплата или «ухожу»). Гибель замечает ведущий: статус пилота «погиб» в личном деле.
   Кнопки приходят карточками в чат; на листе у триггеров кнопки через combat-triggers.mjs. */
import { SYSTEM_ID, TB, DT } from "./config.mjs";
import { esc, resolveActor } from "./utils.mjs";
import { gm, say, pickToken, reputation, callsign, trig } from "./combat-triggers.mjs";
import { cockpitDialog } from "./aim.mjs";

const VOICE = "voiceDebt";
const isLead = () => game.users?.activeGM?.isSelf ?? game.user?.isGM;
const alive = a => a?.type === "pilot" && !["kia", "mia", "retired"].includes(a.system.service?.status);
const pilots = () => (game.actors?.contents ?? [...(game.actors ?? [])]).filter(a => a.type === "pilot");
const notUsed = (a, key) => { const t = trig(a, key); return t && !t.system.used ? t : null; };

export function registerCareerTriggers() {
  game.settings.register(SYSTEM_ID, VOICE, { scope: "world", config: false, type: Array, default: [] });
  Hooks.on("updateActor", (actor, change, options) => {
    if (options?.tbUndo || actor.type !== "pilot" || foundry.utils.getProperty(change, "system.service.status") !== "kia" || !isLead()) return;
    onDeath(actor).catch(err => console.error(`${SYSTEM_ID} | триггеры гибели`, err));
  });
  // combatStart приходит только тому, кто начал бой (может быть и не главный ведущий)
  Hooks.on("combatStart", combat => { if (game.user.isGM) voiceReminder(combat).catch(err => console.warn(`${SYSTEM_ID} | Голос в эфире`, err)); });
  Hooks.on("renderChatMessage", (message, html) => bindCard(message, html?.[0] ?? html));
}

/* ---------- гибель пилота ---------- */

/** Карточка с кнопкой: who — чей это выбор (кнопка видна его владельцу и ведущему). */
function card(actor, what, note, buttons = []) {
  return ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<div class="tb-card tb-card-ctrig tb-card-life"><header class="tb-card-head"><span class="tb-card-who">${esc(actor.name)}</span><span class="tb-card-what"><i class="fas fa-bolt"></i> ${esc(what)}</span></header>
      <div class="tb-note">${note}</div>${buttons.length ? `<div class="tb-actions">${buttons.map(b => `<button type="button" data-tb-life="${b.op}" data-who="${b.who}" data-dead="${b.dead ?? ""}">${esc(b.label)}</button>`).join("")}</div>` : ""}</div>`,
    flags: { [SYSTEM_ID]: { life: true } }
  });
}

/** Пилот погиб: его триггеры гибели, «Я продолжу твоё дело» у союзников, ученики этого наставника. */
export async function onDeath(dead) {
  const who = callsign(dead);
  const st = notUsed(dead, "everything");
  if (st) {
    const name = dead.getFlag(SYSTEM_ID, "student");
    await card(dead, st.name, `${esc(who)} погиб. ${name ? `Ученик <b>${esc(name)}</b>` : "Ученик"} становится новым пилотом игрока: 9 очков навыков и дополнительный триггер к Core.`,
      [{ op: "student", who: dead.uuid, label: "Создать пилота-ученика" }]);
  }
  const pl = notUsed(dead, "projlegacy");
  if (pl) await card(dead, pl.name, `${esc(who)} погиб. Один союзник навсегда получает +1 к параметру самолёта (как Доводка, переходит между самолётами).`,
    [{ op: "projlegacy", who: dead.uuid, label: "Выбрать союзника и параметр" }]);
  const vo = notUsed(dead, "voice");
  if (vo) {
    await vo.update({ "system.used": true });
    const debt = [...(game.settings.get(SYSTEM_ID, VOICE) ?? []), { name: who, uuid: dead.uuid }];
    await game.settings.set(SYSTEM_ID, VOICE, debt);
    await card(dead, vo.name, `Последние слова ${esc(who)} слышат обе стороны. В начале следующего боя ведущий выберет вражеского дуэлянта или аса, который его знал: тот откажется воевать или перейдёт на сторону эскадрильи.`);
  }
  for (const heir of pilots().filter(p => p.id !== dead.id && alive(p))) {
    const lg = notUsed(heir, "legacy");
    if (lg) await card(heir, lg.name, `Погиб ${esc(who)}. ${esc(callsign(heir))} может взять его раскладку навыков: где свои ранги выше, они остаются.`,
      [{ op: "legacy", who: heir.uuid, dead: dead.uuid, label: `Взять навыки ${who}` }]);
    // ученик этого наставника: «Наставник» меняется на «Всё, чему я научился»
    const m = heir.getFlag(SYSTEM_ID, "mentor");
    if (trig(heir, "mentor") && m?.uuid && (m.uuid === dead.uuid || m.uuid === dead.id)) await mentorLost(heir, dead);
  }
}

/** Наставник погиб: триггер «Наставник» заменяется на «Всё, чему я научился» из компендиума. */
async function mentorLost(pilot, dead) {
  const old = trig(pilot, "mentor");
  const pack = game.packs?.get(`${SYSTEM_ID}.triggers`);
  const docs = pack ? await pack.getDocuments() : [];
  const src = docs.find(d => d.system?.key === "everything");
  if (src) {
    const data = src.toObject();
    delete data._id;
    await pilot.createEmbeddedDocuments("Item", [data]);
  }
  if (old) await pilot.deleteEmbeddedDocuments("Item", [old.id]);
  await pilot.unsetFlag(SYSTEM_ID, "mentor");
  return card(pilot, "Наставник", `Наставник ${esc(callsign(dead))} погиб. У ${esc(callsign(pilot))} триггер «Наставник» сменился на «Всё, чему я научился»${src ? "" : " (в компендиуме его не нашлось: добавьте вручную)"}.`);
}

/** «Я продолжу твоё дело»: навыки погибшего, свои выше — свои. */
export async function takeLegacy(heir, dead) {
  const t = notUsed(heir, "legacy");
  if (!t || !dead) return null;
  const mine = heir.system.skills, his = dead.system.skills;
  const upd = {}, got = [];
  for (const k of Object.keys(TB.skills)) {
    const v = Math.max(mine[k] ?? 0, his?.[k] ?? 0);
    if (v !== (mine[k] ?? 0)) { upd[`system.skills.${k}`] = v; got.push(`${TB.skills[k].label} ${v}`); }
  }
  if (got.length) await heir.update(upd);
  await t.update({ "system.used": true });
  return say(`${esc(callsign(heir))} продолжает дело ${esc(callsign(dead))}: ${got.length ? got.join(", ") : "свои ранги везде не ниже, навыки прежние"}.`, heir, t.name);
}

/** «Наследие проекта»: союзнику +1 к параметру самолёта навсегда (флаг legacy, считается в данных пилота). */
async function projLegacy(dead) {
  const t = notUsed(dead, "projlegacy");
  if (!t) return null;
  const allies = pilots().filter(p => p.id !== dead.id && alive(p));
  if (!allies.length) return ui.notifications.warn("Живых союзников нет.");
  const tune = DT.tune ?? {};
  const data = await cockpitDialog(t.name, `<p class="tb-hint">Кому и что: +1 навсегда, переходит между самолётами.</p>
    <div class="form-group"><label>Союзник</label><select name="ally">${allies.map(a => `<option value="${a.id}">${esc(callsign(a))}</option>`).join("")}</select></div>
    <div class="form-group"><label>Параметр</label><select name="stat">${Object.entries(tune).map(([k, v]) => `<option value="${k}">${esc(v[2])}</option>`).join("")}</select></div>
    <div class="tb-ck-fire"><button type="button" class="tb-ck-big" data-pick="ok"><b>ЗАПИСАТЬ</b></button></div>`, { width: 420 });
  if (!data) return null;
  const ally = allies.find(a => a.id === data.ally), stat = data.stat;
  if (!ally || !tune[stat]) return null;
  const list = [...(ally.getFlag(SYSTEM_ID, "legacy") ?? []), { stat, from: callsign(dead) }];
  if (ally.isOwner) await ally.setFlag(SYSTEM_ID, "legacy", list);
  else gm("flag", { uuid: ally.uuid, key: "legacy", value: list });
  await t.update({ "system.used": true });
  return say(`Наследие ${esc(callsign(dead))}: ${esc(callsign(ally))} навсегда получает ${esc(tune[stat][2])}.`, dead, t.name);
}

/** «Всё, чему я научился»: новый пилот-ученик у того же игрока. */
async function makeStudent(dead) {
  const t = notUsed(dead, "everything");
  if (!t) return null;
  const pre = dead.getFlag(SYSTEM_ID, "student") ?? "";
  const data = await cockpitDialog(t.name, `<div class="form-group"><label>Позывной ученика</label><input type="text" name="name" value="${esc(pre)}"></div>
    <div class="tb-ck-fire"><button type="button" class="tb-ck-big" data-pick="ok"><b>СОЗДАТЬ ПИЛОТА</b><small>9 очков навыков, + триггер к Core</small></button></div>`, { width: 420 });
  const name = data?.name?.trim();
  if (!name) return null;
  // у игрока по умолчанию нет права создавать актёров: пилота создаёт ведущий
  if (!game.user.isGM && !game.user.can?.("ACTOR_CREATE")) {
    const { gm } = await import("./combat-triggers.mjs");
    gm("student", { uuid: dead.uuid, name });
    return ui.notifications.info(`Ведущий создаёт пилота ${name}: он появится в списке актёров.`);
  }
  return createStudent(dead, name, true);
}

/** Создать ученика погибшего пилота (у ведущего или у игрока с правом создавать актёров). */
export async function createStudent(dead, name, open = false) {
  const t = notUsed(dead, "everything");
  if (!t) return null;
  const ownership = foundry.utils.deepClone(dead.ownership ?? {});
  const a = await Actor.create({ name, type: "pilot", ownership, system: { callsign: name } });
  await t.update({ "system.used": true });
  if (open) a?.sheet?.render(true);
  return say(`${esc(callsign(dead))} успел научить ${esc(name)} всему. Новый пилот создан: распределите 9 очков навыков и выберите дополнительный триггер к Core.`, dead, t.name);
}

/* ---------- «Голос в эфире» в начале следующего боя ---------- */

async function voiceReminder(combat) {
  const debt = game.settings.get(SYSTEM_ID, VOICE) ?? [];
  if (!debt.length) return;
  const gmIds = game.users.filter(u => u.isGM).map(u => u.id);
  for (const d of debt) await ChatMessage.create({
    speaker: { alias: "AWACS" }, whisper: gmIds,
    content: `<div class="tb-card tb-card-ctrig tb-card-life"><header class="tb-card-head"><span class="tb-card-who">AWACS</span><span class="tb-card-what"><i class="fas fa-bolt"></i> Голос в эфире</span></header>
      <div class="tb-note">Последние слова ${esc(d.name)} помнят. Выберите вражеского дуэлянта или аса на сцене, который его знал.</div>
      <div class="tb-actions"><button type="button" data-tb-life="voice-retreat" data-who="" data-dead="${d.uuid}">Отказывается воевать</button><button type="button" data-tb-life="voice-side" data-who="" data-dead="${d.uuid}">Переходит к эскадрилье</button></div></div>`,
    flags: { [SYSTEM_ID]: { life: true } }
  });
}

async function voicePick(deadUuid, side) {
  const debt = game.settings.get(SYSTEM_ID, VOICE) ?? [];
  const d = debt.find(x => x.uuid === deadUuid);
  if (!d) return ui.notifications.info("«Голос в эфире» уже разыгран.");
  const tok = await pickToken(game.user.character ?? null, "Голос в эфире", a => (a?.type !== "npc" || !["duelist", "ace"].includes(a.system.tier) ? "нужен дуэлянт или ас." : a.system.side === "ally" ? "он и так на вашей стороне." : ""));
  if (!tok) return null;
  if (side) await tok.actor.update({ "system.side": "ally" });
  else await tok.actor.toggleStatusEffect("retreat", { active: true });
  await game.settings.set(SYSTEM_ID, VOICE, debt.filter(x => x !== d));
  return say(side ? `«${esc(tok.name)}» помнит последние слова ${esc(d.name)} и переходит на сторону эскадрильи.` : `«${esc(tok.name)}» помнит последние слова ${esc(d.name)} и отказывается воевать: выходит из боя.`, null, "Голос в эфире");
}

/* ---------- кнопки карточек ---------- */

function bindCard(message, root) {
  if (!message.getFlag?.(SYSTEM_ID, "life") || !root?.querySelectorAll) return;
  for (const b of root.querySelectorAll("[data-tb-life]")) {
    const who = b.dataset.who ? resolveActor(b.dataset.who) : null;
    if (!(game.user.isGM || who?.isOwner)) { b.remove(); continue; }
    b.addEventListener("click", async ev => {
      ev.preventDefault();
      b.disabled = true;
      try {
        const op = b.dataset.tbLife, dead = b.dataset.dead ? resolveActor(b.dataset.dead) : null;
        if (op === "student") await makeStudent(who);
        else if (op === "projlegacy") await projLegacy(who);
        else if (op === "legacy") await takeLegacy(who, dead);
        else if (op === "voice-retreat" || op === "voice-side") await voicePick(b.dataset.dead, op === "voice-side");
      } catch (err) {
        console.error(`${SYSTEM_ID} | триггеры гибели`, err);
        ui.notifications.error(`Не вышло: ${err.message ?? err}`);
      } finally { b.disabled = false; }
    });
  }
}

/* ---------- кнопки на листе ---------- */

/** Кнопка небоевого триггера на листе пилота. */
export async function useLifeTrigger(pilot, item) {
  const key = item.system.key, name = item.name, who = callsign(pilot);
  switch (key) {
    case "noquestions": {
      if (!(await Dialog.confirm({ title: name, content: `<p>Тяжёлое решение или увиденное военное преступление? Вместо Нервов: деление на шкалу «Репутация» (6).</p>` }))) return null;
      await reputation(pilot);
      const g = (pilot.system.goals ?? []).find(x => /репутац/i.test(x.name));
      return say(`${esc(who)}: «${esc(name)}». Нервов нет, «Репутация» ${g?.value ?? 1}/${g?.size ?? 6}.${g && g.value >= g.size ? " Шкала заполнена: о пилоте узнали, и это аукнется." : ""}`, pilot, name);
    }
    case "renegotiate": {
      const r = await cockpitDialog(name, `<p class="tb-hint">Контракт такого не предусматривал.</p><div class="tb-ck-fire tb-ct-pick">
        <button type="button" class="tb-ck-big" data-pick="pay"><b>ДОПЛАТА</b><small>задача выполнена: +1 Гонорар сверх лимита</small></button>
        <button type="button" class="tb-ck-big" data-pick="leave"><b>УХОЖУ</b><small>выход из зоны операции без проверок, никто не преследует</small></button></div>`, { width: 460 });
      if (!r?.pick) return null;
      await item.update({ "system.used": true });
      if (r.pick === "pay") {
        await pilot.update({ "system.fee": Math.min(5, (pilot.system.fee ?? 0) + 1) });
        return say(`${esc(who)}: «Контракт такого не предусматривал». Доплата: +1 Гонорар сверх лимита (если задача выполнена).`, pilot, name);
      }
      await pilot.toggleStatusEffect?.("retreat", { active: true });
      return say(`${esc(who)}: «Ухожу». Выходит из зоны операции без проверок, никто не преследует. Это не отступление эскадрильи.`, pilot, name);
    }
    case "mentor": {
      const m = pilot.getFlag(SYSTEM_ID, "mentor") ?? {};
      const list = pilots().filter(p => p.id !== pilot.id && alive(p));
      const data = await cockpitDialog(name, `
        <div class="form-group"><label>Наставник</label><select name="uuid"><option value="">не выбран</option>${list.map(p => `<option value="${p.uuid}" ${m.uuid === p.uuid ? "selected" : ""}>${esc(callsign(p))}</option>`).join("")}</select></div>
        <div class="form-group"><label>Урок на вылет</label><input type="text" name="lesson" value="${esc(m.lesson ?? "")}"></div>
        <div class="form-group"><label><input type="checkbox" name="done" ${m.done ? "checked" : ""}> Урок выполнен в этом вылете</label></div>
        <div class="tb-ck-fire"><button type="button" class="tb-ck-big" data-pick="ok"><b>ЗАПИСАТЬ</b><small>выполненный урок в «Итогах вылета» даст +1 очко</small></button></div>`, { width: 440 });
      if (!data) return null;
      const mentor = list.find(p => p.uuid === data.uuid);
      return pilot.setFlag(SYSTEM_ID, "mentor", { uuid: mentor?.uuid ?? "", name: mentor ? callsign(mentor) : "", lesson: data.lesson ?? "", done: !!data.done });
    }
    case "everything": {
      const data = await cockpitDialog(name, `<div class="form-group"><label>Ученик (младший пилот эскадрильи, не персонаж другого игрока)</label><input type="text" name="name" value="${esc(pilot.getFlag(SYSTEM_ID, "student") ?? "")}"></div>
        <div class="tb-ck-fire"><button type="button" class="tb-ck-big" data-pick="ok"><b>ЗАПИСАТЬ</b></button></div>`, { width: 420 });
      if (!data) return null;
      return pilot.setFlag(SYSTEM_ID, "student", data.name?.trim() ?? "");
    }
  }
  return null;
}

/** «Итоги вылета»: урок наставника выполнен (галочка заранее). */
export const lessonDone = pilot => !!(trig(pilot, "mentor") && pilot.getFlag?.(SYSTEM_ID, "mentor")?.done);
/** После «Итогов вылета»: урок закрыт, следующий наставник даст перед новым вылетом. */
export async function lessonReset(pilot) {
  const m = pilot.getFlag?.(SYSTEM_ID, "mentor");
  if (m?.done || m?.lesson) await pilot.setFlag(SYSTEM_ID, "mentor", { ...m, lesson: "", done: false });
}
