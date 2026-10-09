/* Личные дела: обмен кодом с «Личным делом» Штаба (kind "yukto-dossier" и "yukto-dossiers").
   Из Штаба в Foundry: анкета, послужной список, навыки, триггеры, самолёт со своими характеристиками, спецоружие с боезапасом,
   состояние вылета, даунтайм (Нервы, Решимость, Заделы, Связи, цели, долги) и фото (если игроку можно загружать файлы). Из Foundry в Штаб — то же самое, с номером дела Штаба:
   Штаб обновит дело с этим номером, а не заведёт новое. Номер дела и бортовое имя хранятся во флаге shtab,
   заметки к триггерам — во флагах триггеров. */
import { SYSTEM_ID, TB, DT } from "./config.mjs";
import { esc } from "./utils.mjs";

const STAT_MAP = [["spd", "spd"], ["eva", "ev"], ["aa", "aa"], ["ag", "ag"], ["hp", "hp"], ["str", "str"], ["gun", "gun"], ["hpts", "hard"]];
const SKILLS = Object.keys(TB.skills);
const num = v => { const x = parseInt(v, 10); return Number.isFinite(x) ? x : null; };

/* ---------- разбор кода ---------- */

/** Дела из текста кода: массив сырых дел Штаба или null. */
export function parseCode(text) {
  let d;
  try { d = JSON.parse(String(text ?? "").trim()); } catch { return null; }
  const list = Array.isArray(d?.pilots) ? d.pilots : [d?.pilot ?? d];
  const ok = list.filter(p => p && typeof p === "object" && "skills" in p);
  return ok.length ? ok : null;
}

async function catalog(name) {
  const pack = game.packs.get(`${SYSTEM_ID}.${name}`);
  if (!pack) return { get: async () => null };
  const index = await pack.getIndex({ fields: ["system.key"] });
  const byKey = new Map(index.map(e => [e.system?.key, e._id]));
  return { get: async key => { const id = byKey.get(key); return id ? (await pack.getDocument(id))?.toObject() : null; } };
}

/* ---------- Штаб → Foundry ---------- */

/** Перенести дело Штаба в актёра (новый, если actor не задан). Возвращает актёра. */
export async function importDossier(raw, actor = null) {
  const [planes, weapons, triggers] = await Promise.all(["planes", "weapons", "triggers"].map(catalog));
  const svc = raw.service ?? {}, q = raw, so = raw.sortie ?? {};
  const name = raw.callsign || [raw.lastName, raw.firstName].filter(Boolean).join(" ") || "Пилот";
  const system = {
    callsign: raw.callsign ?? "", lastName: raw.lastName ?? "", firstName: raw.firstName ?? "", patronymic: raw.patronymic ?? "",
    rank: raw.rank ?? "", flight: raw.flight ?? "", squadron: raw.squadron ?? "", base: raw.base ?? "", birth: raw.birth ?? "",
    archetype: raw.archetype ?? "",
    questions: { callsign: q.qCallsign ?? "", ground: q.qGround ?? "", fear: q.qFear ?? "", defy: q.qDefy ?? "" },
    dossier: (Array.isArray(raw.dossier) && raw.dossier.length ? raw.dossier : [{ text: "" }]).map(x => ({ text: String(x.text ?? ""), struck: !!x.struck })),
    "service.sorties": num(svc.sorties) ?? 0, "service.ops": num(svc.ops) ?? 0, "service.air": num(svc.air) ?? 0,
    "service.ground": num(svc.ground) ?? 0, "service.eject": num(svc.eject) ?? 0,
    "service.awards": svc.awards ?? "", "service.status": svc.status || "active",
    bonusPoints: num(raw.bonusPoints) ?? 0,
    skills: Object.fromEntries(SKILLS.map(k => [k, Math.max(0, Math.min(10, num(raw.skills?.[k]) ?? 0))])),
    twist: !!so.twist, wso: raw.plane?.wso ?? "",
    speed: num(so.speed) ?? 1, alt: so.alt || "med",
    markers: { grit: !!so.grit, gritSkill: so.gritSkill ?? "", structure: !!so.structure, sys: so.sys ?? "", doom: !!so.doom, lastRound: "" }
  };
  if (Array.isArray(svc.log)) system["service.log"] = svc.log;
  const flag = { id: raw.id ?? "", caseNo: raw.caseNo ?? "", created: raw.created ?? 0, startPoints: num(raw.startPoints) ?? 6,
    planeName: raw.plane?.name ?? "", planeProps: raw.plane?.props ?? "" };

  // предметы: самолёт по модели (характеристики из дела поверх справочных), спецоружие по узлам, триггеры
  const items = [];
  const model = raw.plane?.model;
  let plane = model ? await planes.get(model) : null;
  if (plane) {
    for (const [k, fk] of STAT_MAP) { const v = num(raw.plane?.stats?.[k]); if (v !== null) plane.system.stats[fk] = v; }
    if (raw.plane?.name) plane.name = `${plane.name} «${raw.plane.name}»`;
    items.push(plane);
  }
  const slots = [];
  for (const [i, w] of (raw.weapons ?? []).entries()) {
    const doc = w?.code ? await weapons.get(w.code) : null;
    if (!doc) continue;
    doc.sort = (i + 1) * 1000;
    doc.flags = { [SYSTEM_ID]: { slot: i, ammo: w.ammo ?? null } };
    slots[i] = items.push(doc) - 1;
  }
  for (const t of raw.triggers ?? []) {
    let doc = t.key && t.key !== "custom" ? await triggers.get(t.key) : null;
    if (!doc && (t.key === "custom" || t.name)) doc = { name: t.name || "Свой триггер", type: "trigger", system: { key: "custom", text: t.text ?? "" } };
    if (!doc) continue;
    Object.assign(doc.system, { skill: t.sk1 ?? "", skill2: t.sk2 ?? "", used: !!t.used });
    doc.flags = { [SYSTEM_ID]: { slot: t.slot ?? null, note: t.note ?? "", auto: !!t.auto } };
    items.push(doc);
  }

  if (!actor) {
    actor = await Actor.create({ name, type: "pilot", prototypeToken: { actorLink: true, disposition: 1, name } });
    if (!actor) return null;
  } else {
    const old = actor.items.filter(i => ["plane", "weapon", "trigger"].includes(i.type)).map(i => i.id);
    if (old.length) await actor.deleteEmbeddedDocuments("Item", old);
  }
  const created = await actor.createEmbeddedDocuments("Item", items);
  // узел подвески из Штаба становится ссылкой на предмет спецоружия; боезапас «полный» считается с бонусом триггеров
  const weaponIds = [];
  created.forEach(it => { const s = it.getFlag(SYSTEM_ID, "slot"); if (it.type === "weapon" && s !== undefined && s !== null) weaponIds[s] = it.id; });
  const trigUpd = created.filter(it => it.type === "trigger" && it.getFlag(SYSTEM_ID, "slot") !== null && it.getFlag(SYSTEM_ID, "slot") !== undefined)
    .map(it => ({ _id: it.id, "system.weapon": weaponIds[Number(it.getFlag(SYSTEM_ID, "slot"))] ?? "" }));
  if (trigUpd.length) await actor.updateEmbeddedDocuments("Item", trigUpd);
  if (raw.ground && typeof raw.ground === "object") Object.assign(system, groundFrom(raw.ground, weaponIds));

  const upd = { name, ...Object.fromEntries(Object.entries(system).map(([k, v]) => [`system.${k}`, v])), [`flags.${SYSTEM_ID}.shtab`]: flag };
  if (raw.callsign) upd["prototypeToken.name"] = raw.callsign;
  if (plane?.img) {
    const replaceable = src => !src || src.includes("mystery-man") || src.includes("/assets/planes/");
    if (replaceable(actor.prototypeToken.texture.src)) upd["prototypeToken.texture.src"] = plane.img;
  }
  const img = await uploadPhoto(raw);
  if (img) upd.img = img;
  await actor.withoutPoolSync(() => actor.update(upd, { tbFree: true }));
  // HP и Strain: null в Штабе — полный запас
  const s = actor.system;
  const ammo = actor.items.filter(i => i.type === "weapon" && i.system.ammo.max !== null).map(i => {
    const v = i.getFlag(SYSTEM_ID, "ammo"), max = i.system.ammo.max + (s.ammoBonus?.[i.id] ?? 0);
    return { _id: i.id, "system.ammo.value": v === null || v === undefined ? max : Math.max(0, Math.min(max, num(v) ?? max)) };
  });
  if (ammo.length) await actor.updateEmbeddedDocuments("Item", ammo);
  await actor.withoutPoolSync(() => actor.update({
    "system.hp.value": so.hp === null || so.hp === undefined ? s.hp.max : Math.max(0, Math.min(s.hp.max, num(so.hp) ?? s.hp.max)),
    "system.strain.value": so.strain === null || so.strain === undefined ? s.strain.max : Math.max(0, Math.min(s.strain.max, num(so.strain) ?? s.strain.max)),
    "system.speed": Math.min(s.speed, s.maxSpeed), [`flags.${SYSTEM_ID}.pools`]: actor.poolsFlag()
  }, { tbFree: true }));
  return actor;
}

/** Фото из дела (data:) в папку мира, если игроку можно загружать файлы. */
async function uploadPhoto(raw) {
  const src = raw.photo;
  if (!src) return null;
  if (/^https?:\/\//.test(src)) return src;
  const m = /^data:image\/(png|jpe?g|webp|gif);base64,/.exec(src);
  if (!m || !game.user.can("FILES_UPLOAD")) return null;
  try {
    const dir = `worlds/${game.world.id}/pilots`;
    await FilePicker.createDirectory("data", dir).catch(() => null);
    const blob = await (await fetch(src)).blob();
    const file = new File([blob], `${(raw.id || raw.caseNo || "pilot").replace(/[^\w-]/g, "")}.${m[1].replace("jpeg", "jpg")}`, { type: blob.type });
    const res = await FilePicker.upload("data", dir, file, {}, { notify: false });
    return res?.path ?? null;
  } catch (err) {
    console.warn(`${SYSTEM_ID} | фото пилота`, err);
    return null;
  }
}

/* ---------- Foundry → Штаб ---------- */

/** Дело пилота в формате Штаба. */
export function exportDossier(actor) {
  const s = actor.system, f = actor.getFlag(SYSTEM_ID, "shtab") ?? {};
  const planeItem = s.plane;
  const ps = planeItem?.system.stats ?? {};
  const weapons = actor.items.filter(i => i.type === "weapon").sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
  const triggerItems = actor.items.filter(i => i.type === "trigger");
  return {
    id: f.id || `pf${actor.id}`, caseNo: f.caseNo || `Л-F${actor.id.slice(0, 4)}`, created: f.created || Date.now(), updated: Date.now(),
    lastName: s.lastName, firstName: s.firstName, patronymic: s.patronymic, callsign: s.callsign || actor.name,
    rank: s.rank, flight: s.flight, squadron: s.squadron, base: s.base, birth: s.birth, photo: "", archetype: s.archetype,
    qCallsign: s.questions.callsign, qGround: s.questions.ground, qFear: s.questions.fear, qDefy: s.questions.defy,
    dossier: s.dossier.map(x => ({ text: x.text, struck: x.struck, at: 0 })),
    service: { sorties: s.service.sorties, ops: s.service.ops, air: s.service.air, ground: s.service.ground, eject: s.service.eject,
      awards: s.service.awards, status: s.service.status, log: s.service.log },
    startPoints: f.startPoints ?? (s.archetype === "rookie" ? 3 : 6), bonusPoints: s.bonusPoints,
    skills: { ...s.skills },
    triggers: triggerItems.map(t => {
      const wi = t.system.weapon ? weapons.findIndex(w => w.id === t.system.weapon) : -1;
      const out = { key: t.system.key || "custom", used: !!t.system.used, note: t.getFlag(SYSTEM_ID, "note") ?? "" };
      if (out.key === "custom") Object.assign(out, { name: t.name, text: t.system.text });
      if (t.system.skill) out.sk1 = t.system.skill;
      if (t.system.skill2) out.sk2 = t.system.skill2;
      if (wi >= 0) out.slot = String(wi);
      if (t.getFlag(SYSTEM_ID, "auto")) out.auto = true;
      return out;
    }),
    plane: {
      model: planeItem?.system.key ?? "", name: f.planeName ?? "", wso: s.wso, props: f.planeProps || (planeItem?.system.props ?? []).map(p => p.name).join(", "),
      stats: Object.fromEntries(STAT_MAP.map(([k, fk]) => [k, ps[fk] ?? ""]))
    },
    weapons: weapons.map(w => {
      const max = w.system.ammo.max === null ? null : w.system.ammo.max + (s.ammoBonus?.[w.id] ?? 0);
      return { code: w.system.key, ammo: max === null || w.system.ammo.value >= max ? null : w.system.ammo.value };
    }),
    ground: groundTo(actor, weapons),
    sortie: { speed: s.speed, hp: s.hp.value >= s.hp.max ? null : s.hp.value, strain: s.strain.value >= s.strain.max ? null : s.strain.value,
      alt: s.alt, grit: s.markers.grit, gritSkill: s.markers.gritSkill, structure: s.markers.structure, sys: s.markers.sys, doom: s.markers.doom, twist: s.twist }
  };
}

/* ---------- даунтайм: Нервы, Решимость, Заделы, Связи, цели, долги ---------- */

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, num(v) ?? lo));

/** Даунтайм из Штаба в поля листа. Узел подвески Задела «боекомплект» становится ссылкой на предмет; Связь с пилотом — по номеру дела Штаба. */
function groundFrom(g, weaponIds) {
  const byShtab = id => game.actors.find(a => a.type === "pilot" && (a.getFlag(SYSTEM_ID, "shtab")?.id === id || `pf${a.id}` === id));
  const edges = (g.edges ?? []).filter(e => e && DT.edges[e.kind]).map(e => ({
    id: foundry.utils.randomID(), kind: e.kind, stat: e.stat ?? "", minus: e.minus ?? "", minus2: e.minus2 ?? "",
    weapon: e.slot !== undefined && e.slot !== "" && e.slot !== null ? weaponIds[Number(e.slot)] ?? "" : "",
    skill: e.skill ?? "", mode: e.mode ?? "", text: e.text ?? "", value: num(e.value) ?? 0, comp: !!e.comp, used: !!e.used
  }));
  const bonds = (g.bonds ?? []).filter(b => b?.name).map(b => {
    const other = b.pid ? byShtab(b.pid) : game.actors.find(a => a.type === "pilot" && a.name === b.name);
    return { name: b.name, uuid: !b.npc && other ? other.uuid : "", npc: !!b.npc, value: clamp(b.value, 0, b.npc ? DT.maxNpcBond : DT.maxBond),
      was: (b.was ?? []).map(Number).filter(Number.isFinite), dead: !!b.dead, used: false, usedGround: false, grown: false };
  });
  return {
    nerves: clamp(g.nerves, 0, DT.maxNerves), onEdge: g.onEdge === "fly" ? "fly" : "", resolve: clamp(g.resolve, 0, DT.maxResolve),
    "downtime.actions": clamp(g.actions ?? 2, 0, 2), "downtime.resolveGot": !!g.resolveGot,
    edges, bonds,
    goals: (g.goals ?? []).filter(x => x?.name || x?.value).map(x => { const size = num(x.size) === 6 ? 6 : 4; return { name: x.name ?? "", size, value: clamp(x.value, 0, size) }; }),
    debts: (g.debts ?? []).filter(x => x?.text).map(x => ({ text: x.text, struck: !!x.struck }))
  };
}

/** Даунтайм листа в формате Штаба. */
function groundTo(actor, weapons) {
  const s = actor.system;
  const shtabId = a => a.getFlag(SYSTEM_ID, "shtab")?.id || `pf${a.id}`;
  return {
    nerves: s.nerves, onEdge: s.onEdge, resolve: s.resolve, actions: s.downtime.actions, resolveGot: s.downtime.resolveGot,
    edges: s.edges.map(e => {
      const out = { kind: e.kind, text: e.text, comp: e.comp, used: e.used };
      for (const k of ["stat", "minus", "minus2", "skill", "mode"]) if (e[k]) out[k] = e[k];
      if (e.kind === "memory") out.value = e.value;
      const wi = e.weapon ? weapons.findIndex(w => w.id === e.weapon) : -1;
      if (wi >= 0) out.slot = String(wi);
      return out;
    }),
    bonds: s.bonds.map(b => {
      const other = b.uuid ? fromUuidSync(b.uuid) : null;
      return { name: b.name, value: b.value, was: b.was ?? [], npc: b.npc, dead: b.dead, ...(other ? { pid: shtabId(other) } : {}) };
    }),
    goals: s.goals.map(g => ({ name: g.name, size: g.size, value: g.value })),
    debts: s.debts.map(d => ({ text: d.text, struck: d.struck }))
  };
}

export const codeFor = actors => actors.length === 1
  ? JSON.stringify({ kind: "yukto-dossier", v: 1, pilot: exportDossier(actors[0]) })
  : JSON.stringify({ kind: "yukto-dossiers", v: 1, pilots: actors.map(exportDossier) });

/* ---------- окна ---------- */

async function copy(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}

/** Окно обмена: код показан и скопирован, ниже поле для кода из Штаба. actor — один пилот, иначе все пилоты (ведущий). */
export function openDossierExchange(actor = null) {
  const own = actor ? [actor] : game.actors.filter(a => a.type === "pilot" && (game.user.isGM || a.isOwner));
  const out = own.length ? codeFor(own) : "";
  const title = actor ? `Личное дело: ${actor.name}` : "Личные дела и Штаб";
  const intro = actor
    ? "Код ниже — дело этого пилота для Штаба: в «Личном деле» Штаба кнопка «Код дела» → вставить → «Завести или обновить из кода». Чтобы перенести дело из Штаба сюда, вставьте его код в нижнее поле: анкета, навыки, триггеры, самолёт, спецоружие и состояние вылета заменят текущие."
    : "Код ниже — все пилоты мира для Штаба (вставить в «Личном деле» Штаба: «Код дела» → «Завести или обновить из кода»). В нижнее поле вставьте код из Штаба («Скопировать код этого дела» или «Скопировать все дела»): пилоты с тем же номером дела обновятся, остальные появятся новыми актёрами.";
  new Dialog({
    title,
    content: `<form class="tb-dialog tb-dossier-sync"><p class="tb-hint">${intro}</p>
      <label>Код для Штаба (${own.length} ${own.length === 1 ? "дело" : "дел."})</label><textarea name="out" rows="3" readonly>${esc(out)}</textarea>
      <label>Код из Штаба</label><textarea name="in" rows="4" placeholder='{"kind":"yukto-dossier", …}'></textarea></form>`,
    buttons: {
      copy: { icon: '<i class="fas fa-copy"></i>', label: "Скопировать код для Штаба", callback: async html => {
        const ok = await copy(out);
        ui.notifications[ok ? "info" : "warn"](ok ? "Код для Штаба скопирован." : "Скопировать не вышло: выделите код в окне вручную.");
        if (!ok) openDossierExchange(actor);
      } },
      load: { icon: '<i class="fas fa-file-import"></i>', label: "Загрузить из кода", callback: html => loadFrom(html[0].querySelector("[name=in]").value, actor) },
      cancel: { label: "Закрыть" }
    },
    default: "copy",
    render: html => html[0].querySelector("[name=out]").addEventListener("focus", e => e.target.select())
  }, { classes: ["dialog", "thunderbolt"], width: 520 }).render(true);
}

async function loadFrom(text, actor) {
  const list = parseCode(text);
  if (!list) return ui.notifications.warn("Это не код личного дела Штаба: вставьте текст целиком, от первой до последней фигурной скобки.");
  if (actor) {
    if (list.length > 1) ui.notifications.info(`В коде ${list.length} дел: на этот лист берётся первое.`);
    const ok = await Dialog.confirm({ title: "Дело из Штаба", content: `<p>Заменить данные «${esc(actor.name)}» делом «${esc(list[0].callsign || "без позывного")}» из Штаба? Самолёт, спецоружие и триггеры на листе будут заменены.</p>` });
    if (!ok) return;
    await importDossier(list[0], actor);
    return ui.notifications.info(`Дело «${actor.name}» загружено из Штаба.`);
  }
  const made = [], upd = [];
  for (const raw of list) {
    const found = game.actors.find(a => a.type === "pilot" && raw.id && a.getFlag(SYSTEM_ID, "shtab")?.id === raw.id);
    if (found && !found.isOwner) continue;
    if (!found && !game.user.can("ACTOR_CREATE")) { ui.notifications.warn("Создавать актёров может только ведущий."); break; }
    const a = await importDossier(raw, found ?? null);
    if (a) (found ? upd : made).push(a.name);
  }
  ui.notifications.info([upd.length ? `Обновлены: ${upd.join(", ")}.` : "", made.length ? `Новые пилоты: ${made.join(", ")}.` : ""].filter(Boolean).join(" ") || "Ничего не изменилось.");
}
