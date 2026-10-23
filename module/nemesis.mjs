/* Немезида: личный враг пилота (флаг nemesis на листе NPC, nemesisOf — для кого; пусто — для всех пилотов).
   Появление идёт как представление асов: заставка с эмблемой, реплика AWACS, и у её пилотов открываются триггеры Немезиды
   (по книге раз за вылет после её появления). Эффекты триггеров считаются в атаке и защите сами, только против неё.
   Монолог — свободное действие Немезиды: ведущий жмёт «Монолог», у игроков появляются кнопки ответа нужными триггерами.
   Пишет в NPC, бой и настройки только ведущий: игроки шлют ему просьбы по сокету. */
import { SYSTEM_ID } from "./config.mjs";
import { esc, resolveActor, layoutChanged } from "./utils.mjs";
import { sideOf, tokenOf, zoneDistance } from "./scene.mjs";
import { cockpitDialog } from "./aim.mjs";

const CHANNEL = `system.${SYSTEM_ID}`;
/** Флаги: у NPC nemFx { seen, flaw, comp2, taunt, duel, duelBonus }, у пилота nemMet, nemSure (атака попадёт), nemNext (+2 к следующей атаке). */
const FX = "nemFx", MET = "nemMet", SURE = "nemSure", NEXT = "nemNext";

/** Триггеры Немезиды по ключам и что делает кнопка «Задействовать». */
export const NEM = {
  notyou: { kind: "on", fx: "+1 к Evasion против Немезиды" },
  handle: { kind: "on", fx: "+2 к броскам, пока атакуешь её один" },
  expartner: { kind: "on", fx: "+1 ко всем броскам против неё, монолог можно перебить атакой" },
  drawattn: { kind: "on", fx: "пока она держит тебя на захвате, союзники прибавляют твой Lead к Aim по ней" },
  knowmachine: { kind: "pick", fx: "−1 к Evasion, Max Speed или A-A Немезиды до конца вылета" },
  taunt: { kind: "pick", fx: "Немезида преследует тебя" },
  salute: { kind: "pick", fx: "поединок один на один" },
  enough: { kind: "monologue", fx: "атака посреди монолога всегда попадает" },
  philosophy: { kind: "monologue", fx: "оспорить доводы монолога" },
  ibelieved: { kind: "monologue", fx: "ответ на монолог: Complication 1–2 у неё, если стол согласен" },
  fated: { kind: "story", fx: "дуэль без кубиков, проигравший больше не летает" }
};
/** Что сказать в эфир, отвечая на монолог (игрок говорит сам, это строка в субтитры и журнал). */
const REPLY = { enough: "Хватит болтать!", expartner: "Хватит. Я тебя знаю, напарник.", philosophy: "Я тоже читал философов.", ibelieved: "Я тоже в это верил." };

export const isNemesis = a => a?.type === "npc" && !!a.system?.nemesis;
const baseId = a => (a?.isToken ? a.token?.actorId ?? a.id : a?.id);
const team = a => (sideOf(a) === "player" ? "ally" : sideOf(a));
const callsign = a => (a?.type === "pilot" ? a.system.callsign || a.name : nameOf(a));
const dead = a => !!a?.statuses?.has?.(CONFIG.specialStatusEffects?.DEFEATED);
const same = (uuid, a) => !!uuid && !!a && (uuid === a.uuid || resolveActor(uuid) === a);
const isLead = () => !!game.user?.isGM && (game.users?.activeGM?.isSelf ?? true);

/** Имя в эфире, как в переговорах NPC: «Позывной в эфире» с листа, иначе имя токена. */
export function nameOf(a) {
  const call = String(a?.getFlag?.(SYSTEM_ID, "callsign") ?? "").trim();
  return call || a?.system?.callsign || (a?.isToken ? a.token?.name : tokenOf(a)?.name) || a?.name || "";
}

/** Немезида ли этот NPC для пилота. */
export function isNemesisFor(npc, pilot) {
  if (!isNemesis(npc) || pilot?.type !== "pilot") return false;
  const of = npc.system.nemesisOf;
  return !of || of === baseId(pilot);
}

/** Пилоты, чья это Немезида: выбранный на листе, иначе все пилоты игроков. */
export function pilotsOf(npc) {
  if (!isNemesis(npc)) return [];
  return (game.actors?.contents ?? game.actors ?? []).filter(p => p.type === "pilot" && isNemesisFor(npc, p) && (npc.system.nemesisOf || p.hasPlayerOwner));
}

export const fxOf = npc => npc?.getFlag?.(SYSTEM_ID, FX) ?? {};
/** Появилась ли Немезида этого пилота в этом вылете (открыты ли триггеры Немезиды). */
export const metOf = pilot => pilot?.getFlag?.(SYSTEM_ID, MET) ?? null;
const trig = (pilot, key) => pilot?.items?.find?.(i => i.type === "trigger" && i.system.key === key) ?? null;
const on = (pilot, key) => !!trig(pilot, key)?.system.active;
/** Триггеры Немезиды пилота. */
export const nemTriggers = pilot => (pilot?.items?.filter?.(i => i.type === "trigger" && NEM[i.system.key] && (i.system.types ?? []).includes("Nemesis")) ?? []);

/** Немезиды на сцене: живые токены, у игрока — открытые. */
function sceneNemeses(scene = canvas?.scene) {
  return (scene?.tokens?.contents ?? scene?.tokens ?? []).filter(t => isNemesis(t.actor) && !dead(t.actor) && (game.user.isGM || !t.hidden)).map(t => t.actor);
}

/* ---------- ведущему по сокету ---------- */

/** Сделать на клиенте ведущего: у ведущего сразу, у игрока — просьба по сокету. */
function gm(op, data) {
  if (game.user.isGM) return run(op, data);
  if (!game.users.activeGM) return ui.notifications.warn("Немезида: ведущего нет в сети, отметка не записана.");
  game.socket.emit(CHANNEL, { type: "nemesis", op, data, user: game.user.id });
}

async function run(op, d) {
  const npc = d.npc ? resolveActor(d.npc) : null, pilot = d.pilot ? resolveActor(d.pilot) : null;
  if (op === "fx" && npc) return setFx(npc, d.patch);
  if (op === "say") return radioLine(d, npc, pilot);
  if (op === "interrupt") { await radioLine(d, npc, pilot); return endMonologue(); }
  if (op === "believed") { await radioLine(d, npc, pilot); return askBelieved(npc, pilot); }
}

async function setFx(npc, patch) {
  const next = { ...fxOf(npc), ...patch };
  for (const [k, v] of Object.entries(next)) if (v === null || v === undefined) delete next[k];
  await npc.unsetFlag(SYSTEM_ID, FX);
  if (Object.keys(next).length) await npc.setFlag(SYSTEM_ID, FX, next);
}

/** Снять отметку триггера с Немезиды (ведущий, с листа NPC). */
export function clearFx(npc, key) {
  if (!game.user.isGM) return null;
  return setFx(npc, { [key]: null, ...(key === "duel" ? { duelName: null } : key === "taunt" ? { tauntName: null } : {}) });
}

/** Реплика пилота в эфир (синим, как свои) и строка в чат. */
async function radioLine({ speaker, text, note }, npc, pilot) {
  const { sendRadio } = await import("./radio.mjs");
  if (text) await sendRadio({ speaker: speaker ?? callsign(pilot), text, side: "ally" });
  if (note) await card(npc, note);
}

/** Карточка Немезиды в чате. */
function card(npc, note) {
  return ChatMessage.create({ speaker: { alias: "AWACS" },
    content: `<div class="tb-card tb-card-nemesis tb-nem-${team(npc) ?? "enemy"}"><header class="tb-card-head"><span class="tb-card-who"><i class="fas fa-skull-crossbones"></i> ${esc(nameOf(npc) || "Немезида")}</span><span class="tb-card-what">Немезида</span></header><div class="tb-note">${note}</div></div>` });
}

/* ---------- появление ---------- */

/** Реплика AWACS о появлении по стороне Немезиды. */
export function appearLine(npc, who) {
  const name = nameOf(npc), to = who ? `${who}, ` : "";
  const side = team(npc);
  if (side === "ally") return `${cap(to)}на связи «${name}». Летит с нами, старые счёты подождут.`;
  if (side === "neutral") return `${cap(to)}в районе «${name}». На чьей стороне, неясно. Будь начеку.`;
  return `${cap(to)}внимание! В районе «${name}». Это твоя Немезида.`;
}
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Немезида появилась: заставка как у асов (эмблема, имя, NEMESIS, чей враг) и реплика AWACS, отметка у её пилотов
 * (открыты триггеры Немезиды) и строка в чат, какие триггеры теперь доступны. auto — сама при выходе на сцену боя.
 */
export async function appear(npc, { auto = false } = {}) {
  if (!game.user.isGM || !isNemesis(npc)) return null;
  if (auto && fxOf(npc).seen) return null;
  const pilots = pilotsOf(npc), name = nameOf(npc), who = pilots.map(callsign).join(", ");
  for (const p of pilots) if (!metOf(p)) await p.setFlag(SYSTEM_ID, MET, { uuid: npc.uuid, name });
  await setFx(npc, { seen: true });
  const side = team(npc);
  const intro = { name, unit: "NEMESIS", wing: who ? `ЛИЧНЫЙ ВРАГ: ${who}` : "", motto: "", emblem: npc.system.insignia ?? "", side };
  const { sendRadio } = await import("./radio.mjs");
  await sendRadio({ text: appearLine(npc, who), caution: { title: name, sub: "NEMESIS", level: side === "ally" ? "intro-ally" : "intro", intro } });
  const open = pilots.map(p => {
    const list = nemTriggers(p).filter(t => !t.system.used).map(t => `«${esc(t.name)}»`);
    return list.length ? `<b>${esc(callsign(p))}</b>: ${list.join(", ")}` : "";
  }).filter(Boolean);
  return card(npc, `Немезида появилась${who ? ` (враг: ${esc(who)})` : ""}. ${open.length ? `Триггеры Немезиды открыты, раз за вылет: ${open.join("; ")}.` : "Триггеров Немезиды у её пилотов нет."}`);
}

/* ---------- триггеры с листа и HUD ---------- */

/** Состояние триггера Немезиды для листа и HUD: wait (Немезиды не было), ready, on (действует), used. */
export function trigState(pilot, item) {
  const s = item.system, k = NEM[s.key]?.kind;
  if (s.active) return "on";
  if (s.used) return "used";
  if (!metOf(pilot)) return "wait";
  return k === "monologue" && !monologueFor(pilot) ? "listen" : "ready";
}

/** Подпись состояния для подсказки. */
export const STATE_TEXT = { wait: "ждёт появления Немезиды", listen: "только во время её монолога", ready: "можно задействовать", on: "действует", used: "уже использован в этом вылете" };

/** Немезида для триггера: единственная на сцене или выбор в окне. */
async function pickNemesis(pilot) {
  const list = sceneNemeses().filter(n => isNemesisFor(n, pilot));
  if (list.length <= 1) return list[0] ?? null;
  const r = await cockpitDialog("Какая Немезида?", `<div class="tb-ck-fire tb-nem-pick">${list.map((n, i) => `<button type="button" class="tb-ck-big" data-pick="${i}"><b>${esc(nameOf(n))}</b></button>`).join("")}</div>`, { width: 360 });
  return r ? list[Number(r.pick)] : null;
}

/** «Задействовать» триггер Немезиды: проверка появления, отметка «использован», эффект. */
export async function useTrigger(pilot, item) {
  if (!pilot?.isOwner || !item) return null;
  const key = item.system.key, def = NEM[key];
  if (!def) return null;
  // включённый ситуативный — щелчок выключает бонус (использованным он остаётся)
  if (item.system.active) return item.update({ "system.active": false });
  if (item.system.used) return ui.notifications.warn(`«${item.name}» в этом вылете уже использован.`);
  if (!metOf(pilot)) {
    if (!game.user.isGM) return ui.notifications.warn(`«${item.name}»: триггеры Немезиды открываются, когда она появится в вылете.`);
    if (!(await Dialog.confirm({ title: item.name, content: `<p>Немезида пилота ещё не появлялась в этом вылете. Всё равно задействовать «${esc(item.name)}»?</p>` }))) return null;
  }
  const who = callsign(pilot);
  if (def.kind === "monologue") {
    const m = monologueFor(pilot);
    if (!m) return ui.notifications.warn(`«${item.name}» отвечает на монолог Немезиды: кнопка появится, когда ведущий начнёт монолог.`);
    return respond(pilot, key);
  }
  if (def.kind === "on") {
    await item.update({ "system.used": true, "system.active": true });
    return storyCard(pilot, `${esc(who)} задействует «${esc(item.name)}»: ${esc(def.fx)}.`);
  }
  if (def.kind === "story") {
    await item.update({ "system.used": true });
    return storyCard(pilot, `${esc(who)}: «${esc(item.name)}». Кубики в сторону: опишите дуэль, игрок сам решает, кто победил. Проигравший больше никогда не летает.`);
  }
  const npc = await pickNemesis(pilot);
  if (!npc) return ui.notifications.warn(`«${item.name}»: Немезиды пилота на сцене нет.`);
  const name = nameOf(npc);
  if (key === "knowmachine") {
    const r = await cockpitDialog(`Знаю эту машину · ${name}`, `<p class="tb-hint">Если «${esc(name)}» на опытной машине, назовите её недостаток. До конца вылета:</p>
      <div class="tb-ck-fire">${[["ev", "EVASION"], ["spd", "MAX SPEED"], ["aa", "AIR-AIR"]].map(([k, l]) => `<button type="button" class="tb-ck-big" data-pick="${k}"><b>${l}</b><small>−1</small></button>`).join("")}</div>`, { width: 420 });
    if (!r) return null;
    await item.update({ "system.used": true });
    gm("fx", { npc: npc.uuid, patch: { flaw: r.pick } });
    return storyCard(pilot, `${esc(who)} знает машину «${esc(name)}»: ${{ ev: "Evasion", spd: "Max Speed", aa: "A-A" }[r.pick]} −1 до конца вылета.`);
  }
  await item.update({ "system.used": true });
  if (key === "taunt") {
    gm("fx", { npc: npc.uuid, patch: { taunt: pilot.uuid, tauntName: who } });
    return storyCard(pilot, `${esc(who)} бросает вызов чести «${esc(name)}». Теперь Немезида неотступно преследует того, кто бросил вызов, даже вопреки здравому смыслу.`);
  }
  if (key === "salute") {
    gm("fx", { npc: npc.uuid, patch: { duel: pilot.uuid, duelName: who, duelBonus: null } });
    return storyCard(pilot, `${esc(who)} вызывает «${esc(name)}» на поединок по открытому каналу. Пока они дерутся один на один, её ведомые не выбирают целью пилота поединка, а сама она не атакует никого другого. Вмешался её ведомый: следующая атака пилота поединка +2. Вмешался союзник: следующая атака Немезиды по пилоту поединка +2, поединок окончен.`);
  }
  return null;
}

function storyCard(pilot, note) {
  return ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor: pilot }),
    content: `<div class="tb-card tb-card-nemesis"><header class="tb-card-head"><span class="tb-card-who">${esc(pilot.name)}</span><span class="tb-card-what"><i class="fas fa-skull-crossbones"></i> Триггер Немезиды</span></header><div class="tb-note">${note}</div></div>` });
}

/* ---------- атака и защита ---------- */

/** Кто в этом бою уже бил Немезиду: [{ nem, by }] (для «Я с ним справлюсь!» и «Салюта»). */
const hitsOf = (combat = game.combat) => combat?.getFlag?.(SYSTEM_ID, "nemHits") ?? [];

/** Атакует ли пилот свою Немезиду один: никто из союзников в этом бою её не бил. */
export function alone(pilot, npc, combat = game.combat) {
  return !hitsOf(combat).some(h => same(h.nem, npc) && !same(h.by, pilot) && team(resolveActor(h.by)) === "ally");
}

/**
 * Что триггеры Немезиды меняют в атаке: { parts, notes, problems, forceHit, take }.
 * rolled — атака с броском («ко всем броскам»), skill — навык броска (aim для «Отвлечь на себя»).
 * problems — что запрещают «Салют» и «Вызов» (ведущий может разрешить), take() — списать разовые бонусы после выстрела.
 */
export function nemesisAttack(attacker, target, { rolled = false, skill = "" } = {}) {
  const out = { parts: [], notes: [], problems: [], forceHit: false, take: async () => {} };
  const ta = target?.actor ?? target;
  if (!attacker || !ta) return out;
  const later = [];
  if (attacker.type === "pilot") {
    if (isNemesisFor(ta, attacker)) {
      if (rolled && on(attacker, "expartner")) out.parts.push([trig(attacker, "expartner").name, 1]);
      if (rolled && on(attacker, "handle")) {
        if (alone(attacker, ta)) out.parts.push([trig(attacker, "handle").name, 2]);
        else out.notes.push(`«${trig(attacker, "handle").name}»: союзник вмешался, бонуса нет.`);
      }
      if (same(attacker.getFlag(SYSTEM_ID, SURE), ta)) {
        out.forceHit = true;
        out.notes.push("«Хватит болтать»: атака посреди монолога попадает всегда.");
        later.push(() => attacker.unsetFlag(SYSTEM_ID, SURE));
      }
    }
    const next = attacker.getFlag(SYSTEM_ID, NEXT);
    if (next?.value) { out.parts.push([next.label, next.value]); later.push(() => attacker.unsetFlag(SYSTEM_ID, NEXT)); }
  }
  // «Отвлечь на себя»: Немезида держит пилота на захвате — союзники прибавляют его Lead к Aim по ней
  if (isNemesis(ta) && rolled && skill === "aim" && team(attacker) === "ally") {
    for (const p of game.actors ?? []) {
      if (p.type !== "pilot" || same(attacker.uuid, p) || baseId(p) === baseId(attacker) || !on(p, "drawattn") || !isNemesisFor(ta, p)) continue;
      if (!same(ta.system.lockUuid, p)) continue;
      if (p.system.skills?.lead) out.parts.push([`${trig(p, "drawattn").name}: ${callsign(p)}`, p.system.skills.lead]);
    }
  }
  // Немезида: поединок, вызов и +2 после вмешательства союзника
  if (isNemesis(attacker)) {
    const f = fxOf(attacker);
    if (f.duel && !same(f.duel, ta)) out.problems.push(`«Салют»: «${nameOf(attacker)}» в поединке (${f.duelName ?? "пилот"}) и атакует только пилота поединка.`);
    else if (f.taunt && !same(f.taunt, ta)) out.problems.push(`«Вызов»: «${nameOf(attacker)}» неотступно преследует того, кто бросил вызов (${f.tauntName ?? "пилот"}).`);
    if (f.duelBonus && same(f.duelBonus.vs, ta)) {
      out.parts.push(["Салют: вмешался союзник", f.duelBonus.value ?? 2]);
      later.push(() => gm("fx", { npc: attacker.uuid, patch: { duelBonus: null } }));
    }
  } else if (attacker.type === "npc" && ta.type === "pilot") {
    // ведомые Немезиды по пилоту в поединке
    const nem = sceneNemeses().find(n => same(fxOf(n).duel, ta) && team(n) === team(attacker));
    if (nem) out.problems.push(`«Салют»: ведомые «${nameOf(nem)}» не выбирают целью пилота поединка (${callsign(ta)}). Если всё же стреляют, у пилота поединка следующая атака +2.`);
  }
  out.take = async () => { for (const f of later) await f(); };
  return out;
}

/** «Опять ты!»: +1 к защите пилота против его Немезиды. */
export function nemesisDefense(attacker, target) {
  const ta = target?.actor ?? target;
  return ta?.type === "pilot" && isNemesisFor(attacker, ta) && on(ta, "notyou") ? 1 : 0;
}

/** Атака по Немезиде или Немезидой записана в чат (ведущий): кто вмешался, поединок. */
export async function trackAttack(message) {
  const c = message.getFlag?.(SYSTEM_ID, "card");
  if (!c?.attack || !c.actorUuid || !c.targetUuid) return;
  const by = resolveActor(c.actorUuid), ta = resolveActor(c.targetUuid);
  if (!by || !ta) return;
  const combat = game.combat;
  if (isNemesis(ta) && combat?.started) {
    const list = hitsOf(combat);
    if (!list.some(h => h.nem === ta.uuid && h.by === by.uuid)) await combat.setFlag(SYSTEM_ID, "nemHits", [...list, { nem: ta.uuid, by: by.uuid }]);
  }
  for (const n of sceneNemeses()) {
    const f = fxOf(n);
    if (!f.duel) continue;
    const duelist = resolveActor(f.duel);
    // союзник пилота ударил Немезиду: поединок окончен, её следующая атака по пилоту +2
    if (ta === n && !same(f.duel, by) && team(by) === "ally") {
      await setFx(n, { duel: null, duelName: null, duelBonus: { vs: f.duel, value: 2 } });
      await card(n, `«Салют»: в поединок вмешался союзник (${esc(callsign(by))}). Поединок окончен, у «${esc(nameOf(n))}» следующая атака по пилоту поединка (${esc(f.duelName ?? "пилот")}) +2.`);
    } else if (duelist && same(f.duel, ta) && by !== n && team(by) === team(n)) {
      // её ведомый ударил пилота поединка: его следующая атака +2
      await duelist.setFlag(SYSTEM_ID, NEXT, { label: "Салют: вмешался ведомый", value: 2 });
      await card(n, `«Салют»: в поединок вмешался ведомый «${esc(nameOf(n))}» (${esc(callsign(by))}). У пилота поединка (${esc(f.duelName ?? "пилот")}) следующая атака +2.`);
    }
  }
}

/* ---------- монолог ---------- */

/** Идущий монолог: { uuid, name, side, at } или null. */
export function monologue() {
  try { const m = game.settings.get(SYSTEM_ID, "monologue"); return m?.uuid ? m : null; } catch { return null; }
}
/** Монолог Немезиды этого пилота. */
function monologueFor(pilot) {
  const m = monologue(), npc = m ? resolveActor(m.uuid) : null;
  return npc && isNemesisFor(npc, pilot) ? m : null;
}

/** «Монолог» (ведущий, свободное действие): по желанию первая фраза в эфир цветом стороны, у игроков кнопки ответа. */
export async function startMonologue(npc) {
  if (!game.user.isGM || !isNemesis(npc)) return null;
  const name = nameOf(npc), side = team(npc);
  const r = await cockpitDialog(`Монолог · ${name}`, `
    <p class="tb-hint">Свободное действие. Монолог произносите сами. Пока он идёт, у пилотов этой Немезиды кнопки ответа: «Хватит болтать», «Бывший напарник», «Я тоже читал философов», «Я тоже в это верил».</p>
    <div class="form-group stacked"><label>Фраза в эфир (необязательно)</label><textarea name="text" rows="2" placeholder="Видишь ли, у войны нет сторон…"></textarea></div>
    <div class="tb-ck-fire"><button type="button" class="tb-ck-big tb-nem-${side}" data-pick="go"><b>МОНОЛОГ</b><small>${esc(name)}</small></button></div>`, { width: 440 });
  if (!r) return null;
  await game.settings.set(SYSTEM_ID, "monologue", { uuid: npc.uuid, name, side, at: Date.now() });
  const text = String(r.text ?? "").trim();
  if (text) {
    const { sendRadio } = await import("./radio.mjs");
    await sendRadio({ speaker: name, text, side });
  }
  return card(npc, `Монолог «${esc(name)}». Пилоты могут ответить триггерами Немезиды.`);
}

export async function endMonologue() {
  if (!game.user.isGM || !monologue()) return;
  await game.settings.set(SYSTEM_ID, "monologue", {});
}

/** Ответ пилота на монолог триггером. */
export async function respond(pilot, key) {
  const m = monologueFor(pilot), npc = m ? resolveActor(m.uuid) : null;
  const item = trig(pilot, key);
  if (!npc || !item) return null;
  if (key !== "expartner" && item.system.used) return ui.notifications.warn(`«${item.name}» в этом вылете уже использован.`);
  const who = callsign(pilot), name = nameOf(npc);
  const base = { npc: npc.uuid, pilot: pilot.uuid, speaker: who, text: REPLY[key] };
  if (key === "enough") {
    await item.update({ "system.used": true });
    await pilot.setFlag(SYSTEM_ID, SURE, npc.uuid);
    return gm("interrupt", { ...base, note: `${esc(who)} обрывает монолог: «${esc(item.name)}». ${esc(who)}: следующая атака по «${esc(name)}» попадает всегда.` });
  }
  if (key === "expartner") return gm("interrupt", { ...base, note: `${esc(who)} перебивает монолог «${esc(name)}» атакой («${esc(item.name)}»).` });
  await item.update({ "system.used": true });
  if (key === "philosophy") return gm("say", { ...base, note: `${esc(who)} оспаривает доводы «${esc(name)}» («${esc(item.name)}»).` });
  if (key === "ibelieved") return gm("believed", { ...base, note: `${esc(who)} отвечает на монолог «${esc(name)}»: «${esc(item.name)}». Стол решает, попал ли ответ в точку.` });
  return null;
}

/** «Я тоже в это верил»: ведущий отмечает, согласен ли стол. */
async function askBelieved(npc, pilot) {
  if (!npc) return;
  const name = nameOf(npc);
  const r = await cockpitDialog(`Я тоже в это верил · ${name}`, `<p class="tb-hint">${esc(callsign(pilot))} ответил на монолог. Стол согласен, что попал в точку?</p>
    <div class="tb-ck-fire"><button type="button" class="tb-ck-big fox" data-pick="yes"><b>В ТОЧКУ</b><small>Complication 1–2 до конца вылета</small></button><button type="button" class="tb-ck-big" data-pick="no"><b>МИМО</b></button></div>`, { width: 420 });
  if (r?.pick !== "yes") return;
  await setFx(npc, { comp2: true });
  return card(npc, `${esc(callsign(pilot))} попадает в точку: у «${esc(name)}» до конца вылета Complication на 1–2.`);
}

/** Кнопки ответа для пилота на монолог: [{ key, label, hint }]. */
export function replyButtons(pilot, npc) {
  if (!isNemesisFor(npc, pilot)) return [];
  const out = [];
  for (const key of ["enough", "expartner", "philosophy", "ibelieved"]) {
    const t = trig(pilot, key);
    if (!t || (key !== "expartner" && t.system.used)) continue;
    out.push({ key, label: key === "expartner" ? "Перебить атакой" : t.name, hint: key === "expartner" ? `«${t.name}»: монолог можно перебить атакой` : NEM[key].fx });
  }
  return out;
}

/** Панель монолога: у всех, у пилотов этой Немезиды — кнопки ответа, у ведущего — «Конец монолога». */
export function monologueHtml(m = monologue()) {
  const npc = m ? resolveActor(m.uuid) : null;
  if (!npc) return "";
  const pilots = game.user.isGM ? pilotsOf(npc) : (game.actors ?? []).filter(p => p.type === "pilot" && p.isOwner && isNemesisFor(npc, p));
  const rows = pilots.map(p => ({ p, b: replyButtons(p, npc) })).filter(x => x.b.length).map(({ p, b }) =>
    `<div class="tb-mono-row"><span>${esc(callsign(p))}</span>${b.map(x => `<button type="button" data-mono-reply="${x.key}" data-mono-pilot="${esc(p.uuid)}" title="${esc(x.hint)}">${esc(x.label)}</button>`).join("")}</div>`).join("");
  return `<div class="tb-mono tb-nem-${esc(m.side ?? "enemy")}">
    <div class="tb-mono-head"><i class="fas fa-skull-crossbones"></i><small>NEMESIS · МОНОЛОГ</small><b>${esc(m.name)}</b>${game.user.isGM ? `<button type="button" data-mono-end title="Монолог окончен: кнопки ответа пропадут">Конец</button>` : ""}</div>
    ${rows}</div>`;
}

let box = null;
function renderMonologue() {
  const content = monologueHtml();
  if (!content) { box?.remove(); box = null; return; }
  if (!box) {
    box = document.createElement("section");
    box.id = "tb-monologue";
    box.addEventListener("click", onMonoClick);
    document.body.append(box);
  }
  box.className = `thunderbolt tb-nem-${monologue()?.side ?? "enemy"}`;
  box.innerHTML = content;
}

async function onMonoClick(ev) {
  const b = ev.target.closest("[data-mono-reply], [data-mono-end]");
  if (!b) return;
  ev.preventDefault();
  if (b.dataset.monoEnd !== undefined) return endMonologue();
  const pilot = resolveActor(b.dataset.monoPilot);
  if (!pilot?.isOwner) return;
  b.disabled = true;
  try { await respond(pilot, b.dataset.monoReply); } finally { renderMonologue(); }
}

/* ---------- HUD и токен ---------- */

/**
 * Немезида пилота для HUD: { name, side, dist, lock, uuid, chips, trig } или null.
 * chips — что действует сейчас, trig — триггеры, которые можно задействовать.
 */
export function hudNemesis(pilot) {
  if (pilot?.type !== "pilot") return null;
  const me = tokenOf(pilot);
  const npc = sceneNemeses().find(n => isNemesisFor(n, pilot));
  if (!npc) return null;
  const tok = tokenOf(npc), d = me && tok ? zoneDistance(me, tok) : null, f = fxOf(npc);
  const chips = [];
  for (const t of nemTriggers(pilot).filter(t => t.system.active)) {
    const k = t.system.key;
    if (k === "notyou") chips.push(`${t.name} +1 DEF`);
    else if (k === "expartner") chips.push(`${t.name} +1`);
    else if (k === "handle") chips.push(alone(pilot, npc) ? `${t.name} +2` : `${t.name}: вмешались`);
    else if (k === "drawattn") chips.push(same(npc.system.lockUuid, pilot) ? `${t.name}: Lead союзникам` : t.name);
  }
  if (same(f.duel, pilot)) chips.push("ПОЕДИНОК");
  if (same(f.taunt, pilot)) chips.push("ВЫЗОВ");
  if (f.flaw) chips.push({ ev: "EV −1", spd: "MAX SPD −1", aa: "A-A −1" }[f.flaw]);
  if (f.comp2) chips.push("COMP 1–2");
  if (same(pilot.getFlag(SYSTEM_ID, SURE), npc)) chips.push("ПОПАДЁТ");
  const trigs = nemTriggers(pilot).map(t => ({ id: t.id, name: t.name, state: trigState(pilot, t) })).filter(t => t.state === "ready");
  return { name: nameOf(npc), side: team(npc), uuid: npc.uuid, lock: same(npc.system.lockUuid, pilot),
    dist: d === null ? "" : d === 0 ? "своя зона" : `${d} ${d === 1 ? "зона" : d < 5 ? "зоны" : "зон"}`, chips, trig: trigs };
}

const RING = { enemy: 0xff3b2f, ally: 0x4fb3ff, neutral: 0xf2c14e };
/** Кольцо на токене Немезиды: видят ведущий и владельцы её пилотов, цвет по стороне. */
function drawRing(token) {
  const a = token.actor;
  const show = isNemesis(a) && !dead(a) && (game.user.isGM || pilotsOf(a).some(p => p.isOwner));
  let g = token.tbNemRing;
  if (!show) { if (g && !g.destroyed) g.destroy(); token.tbNemRing = null; return; }
  if (!g || g.destroyed) { g = token.tbNemRing = token.addChildAt(new PIXI.Graphics(), 0); g.eventMode = "none"; }
  const r = Math.max(token.w, token.h) / 2, c = RING[team(a)] ?? RING.enemy;
  g.clear();
  g.lineStyle(Math.max(2, r * 0.06), c, 0.95).drawCircle(0, 0, r + 3);
  g.lineStyle(Math.max(1, r * 0.025), c, 0.6).drawCircle(0, 0, r + 3 + Math.max(4, r * 0.1));
  // засечки по четырём сторонам, как метка цели в Ace Combat
  for (const [x, y] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) g.lineStyle(Math.max(2, r * 0.06), c, 0.95).moveTo(x * (r + 6), y * (r + 6)).lineTo(x * (r + 6 + r * 0.22), y * (r + 6 + r * 0.22));
  g.position.set(token.w / 2, token.h / 2);
}
function refreshRings() { if (canvas?.ready) for (const t of canvas.tokens.placeables) drawRing(t); }

/* ---------- регистрация ---------- */

/** Сброс к вылету (подготовка пилота): Немезиды не было, разовые отметки сняты; у его Немезид снимаются недостатки и вызовы. */
export async function resetSortie(pilot) {
  const upd = {};
  for (const k of [MET, SURE, NEXT]) if (pilot.getFlag?.(SYSTEM_ID, k) !== undefined) upd[`flags.${SYSTEM_ID}.-=${k}`] = null;
  if (Object.keys(upd).length) await pilot.update(upd);
  if (!game.user.isGM) return;
  // её отметки живут в актёре из мира или, у несвязанного токена, в самом токене открытой сцены
  const list = new Set([...(game.actors ?? []), ...sceneNemeses()]);
  for (const n of list) if (isNemesisFor(n, pilot) && n.getFlag(SYSTEM_ID, FX)) await n.unsetFlag(SYSTEM_ID, FX);
}

export function registerNemesis() {
  game.settings.register(SYSTEM_ID, "monologue", { scope: "world", config: false, type: Object, default: {}, onChange: () => {
    renderMonologue();
    Hooks.callAll(`${SYSTEM_ID}.monologue`);
    // кнопки «Задействовать» на листах зависят от монолога
    for (const a of game.actors ?? []) if ((a.type === "pilot" || isNemesis(a)) && a.sheet?.rendered) a.sheet.render(false);
  } });
  Hooks.once("ready", () => {
    game.socket.on(CHANNEL, msg => { if (msg?.type === "nemesis" && isLead()) run(msg.op, msg.data ?? {}).catch(err => console.error(`${SYSTEM_ID} | Немезида`, err)); });
    renderMonologue();
  });
  // появление: токен Немезиды вышел на сцену боя, ведущий его открыл или бой начался при ней на сцене
  const inCombat = doc => !!game.combat?.started && doc.parent?.id === (game.combat.scene ?? canvas?.scene)?.id;
  Hooks.on("createToken", (doc, options) => { if (isLead() && !options?.tbUndo && inCombat(doc) && !doc.hidden && isNemesis(doc.actor)) appear(doc.actor, { auto: true }); });
  Hooks.on("updateToken", (doc, change, options) => { if (isLead() && !options?.tbUndo && change.hidden === false && inCombat(doc) && isNemesis(doc.actor)) appear(doc.actor, { auto: true }); });
  // combatStart приходит только тому, кто начал бой
  Hooks.on("combatStart", async combat => {
    if (!game.user.isGM) return;
    for (const t of (combat.scene ?? canvas?.scene)?.tokens ?? []) if (!t.hidden && isNemesis(t.actor) && !dead(t.actor)) await appear(t.actor, { auto: true });
  });
  Hooks.on("deleteCombat", () => { if (isLead()) endMonologue(); });
  Hooks.on("createChatMessage", (message, options) => { if (isLead() && !options?.tbUndo) trackAttack(message).catch(err => console.warn(`${SYSTEM_ID} | Немезида`, err)); });
  // кольцо на токене
  Hooks.on("refreshToken", (t, flags) => { if (layoutChanged(flags)) drawRing(t); });
  Hooks.on("canvasReady", refreshRings);
  let timer = null;
  for (const ev of ["updateActor", "updateActorDelta", "createToken", "updateToken"]) Hooks.on(ev, () => { clearTimeout(timer); timer = setTimeout(refreshRings, 80); });
  // панель монолога: кнопки зависят от триггеров пилота
  for (const ev of ["updateItem", "createItem", "deleteItem"]) Hooks.on(ev, () => { if (monologue()) renderMonologue(); });
}
