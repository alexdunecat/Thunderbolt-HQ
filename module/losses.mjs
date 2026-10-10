/* Потери в бою. Сбитая машина получает знак X (вместо черепа Foundry) и стоит на поле до конца раунда, в котором её сбили:
   пушкой — до конца текущего, ракетой из залпа — до конца следующего (залп считается уже на смене раунда).
   Отступившие (статус «Отступил из боя» на токене) уходят с поля в конце раунда. Всё это записывается в сводку боя,
   а после End combat в чат приходит отчёт с кнопкой «Итоги в личные дела». */
import { SYSTEM_ID, SYS_PATH, TB } from "./config.mjs";
import { esc, resolveActor } from "./utils.mjs";
import { sideOf, hasRule } from "./scene.mjs";

export const RETREAT = "retreat";
const OURS = ["player", "ally"];

/* Статусы токена: только нужные правилам. Сбит и «Отступил из боя» ставятся вручную или системой,
   Break! и «Сваливание» система ставит и снимает сама по листу (Break! до конца раунда, сваливание при Speed 0 и ниже). */
export const BREAK = "break", STALL = "stall";
const status = (id, name, file) => ({ id, name, img: `${SYS_PATH}assets/status/${file}.svg`, icon: `${SYS_PATH}assets/status/${file}.svg` });

export function registerLosses() {
  const dead = CONFIG.specialStatusEffects.DEFEATED;
  CONFIG.statusEffects = [
    status(dead, "Сбит", "destroyed"),
    status(RETREAT, "Отступил из боя", "retreat"),
    status(BREAK, "Break!", "break"),
    status(STALL, "Сваливание", "stall")
  ];
  Hooks.on("updateActor", (actor, change, options, userId) => {
    if (userId !== game.user.id || !actor.isOwner || !["pilot", "npc"].includes(actor.type)) return;
    const has = p => foundry.utils.hasProperty(change, p);
    if (has("system.breakEv")) syncStatus(actor, BREAK, actor.system.breakEv !== null && actor.system.breakEv !== undefined);
    if (has("system.speed") && (actor.type === "pilot" || actor.system.kind === "air")) syncStatus(actor, STALL, actor.system.speed <= 0);
    // Doom отмечен на листе вручную: машина сбита так же, как от урона (знак X, выбывает из трекера,
    // уходит с поля в конце раунда, сообщение в чат); снятая галочка возвращает её в бой
    const doom = options.tbDoom ? undefined : foundry.utils.getProperty(change, "system.markers.doom");
    if (doom === true) actor.markDoom("отмечено вручную");
    else if (doom === false) actor.unmarkDown();
    // на пределе: первая метка урона в вылете — срыв
    if (actor.type === "pilot" && ["grit", "structure", "doom"].some(k => foundry.utils.getProperty(change, `system.markers.${k}`) === true))
      import("./downtime.mjs").then(m => m.checkBreakdown(actor, "отмечена метка урона"));
  });
  // «Сбит» в трекере боя или в меню токена: то же выбытие (флаг потерь, уход с поля в конце раунда)
  Hooks.on("updateCombatant", (cb, change, options, userId) => {
    if (userId !== game.user.id || !("defeated" in change) || !cb.actor || !["pilot", "npc"].includes(cb.actor.type)) return;
    const down = cb.actor.getFlag(SYSTEM_ID, "down")?.combat === cb.parent?.id;
    if (change.defeated && !down) cb.actor.markDown();
    else if (!change.defeated && down && !cb.actor.system.markers?.doom) cb.actor.unmarkDown();
  });
  const isDead = effect => effect.statuses?.has(CONFIG.specialStatusEffects.DEFEATED) && ["pilot", "npc"].includes(effect.parent?.type);
  Hooks.on("createActiveEffect", (effect, options, userId) => {
    if (userId === game.user.id && isDead(effect) && game.combat?.started) effect.parent.markDown();
  });
  Hooks.on("deleteActiveEffect", (effect, options, userId) => {
    const a = effect.parent;
    if (userId !== game.user.id || !isDead(effect) || a.system.markers?.doom) return;
    if (a.getFlag(SYSTEM_ID, "down")?.combat === game.combat?.id) a.unmarkDown();
  });
  Hooks.on("deleteCombat", combat => {
    if (!game.users.activeGM?.isSelf || !combat.round) return;
    // урон по пилотам игроков из последнего залпа наносят их клиенты: подождать его
    setTimeout(() => battleReport(combat), 1500);
  });
}

function syncStatus(actor, id, on) {
  if (!!actor.statuses?.has(id) !== on) actor.toggleStatusEffect(id, { active: on });
}

const kindOf = a => (a.type === "pilot" ? "air" : a.system.kind);

/** Сбит в этом бою: { combat, round, by } — ставится при уничтожении (actor.mjs). */
const downOf = a => a?.getFlag(SYSTEM_ID, "down") ?? null;

/** Запись о потере для сводки. */
function lossOf(t, how) {
  const a = t.actor, d = downOf(a);
  const shooter = d?.byUuid ? resolveActor(d.byUuid) : null;
  return { name: t.name, side: sideOf(a), kind: kindOf(a), pilot: a.type === "pilot", how, by: d?.by ?? "", round: d?.round ?? null,
    byPilot: shooter?.type === "pilot" ? shooter.name : "",
    task: a.type === "npc" && a.system.priority ? a.system.task || "" : null,
    // для Славы эскадрильи: уровень, эскадрилья дуэлянтов, супероружие или летающая крепость
    tier: a.type === "npc" ? a.system.tier ?? "" : "", squad: a.type === "npc" ? a.system.squad ?? "" : "", grp: a.system.grp ?? "",
    key: a.system.key ?? "", cls: a.system.cls ?? "", missile: hasRule(a, "ballistic") || a.system.key === "icbm",
    boss: hasRule(a, "boss") || hasRule(a, "aerialship") };
}

/** Токены сцены боя, которым пора уйти: сбитые в этом бою не позже раунда upTo и отступившие. */
function leaving(combat, upTo = Infinity) {
  const scene = combat.scene ?? game.scenes.viewed;
  const out = [];
  for (const t of scene?.tokens ?? []) {
    const a = t.actor;
    if (!a || !["pilot", "npc"].includes(a.type)) continue;
    const d = downOf(a);
    if (d?.combat === combat.id && d.round <= upTo) out.push({ t, how: "down" });
    else if (a.statuses?.has(RETREAT)) out.push({ t, how: "retreat" });
  }
  return out;
}

/** Убрать с поля сбитых (до раунда upTo) и отступивших, записать их в сводку боя. Возвращает записи. */
export async function clearLosses(combat, upTo = Infinity, { keepLog = false } = {}) {
  const list = leaving(combat, upTo);
  if (!list.length) return [];
  const rows = list.map(x => lossOf(x.t, x.how));
  if (!keepLog) await combat.setFlag(SYSTEM_ID, "losses", [...(combat.getFlag(SYSTEM_ID, "losses") ?? []), ...rows]);
  // у связанных актёров (пилоты) статус и отметка живут на листе: снять, чтобы не уйти с поля в следующем бою
  for (const { t } of list) if (t.actorLink) {
    if (t.actor.statuses?.has(RETREAT)) await t.actor.toggleStatusEffect(RETREAT, { active: false });
  }
  const ids = new Set(list.map(x => x.t.id));
  const cids = combat.combatants?.filter(c => ids.has(c.tokenId)).map(c => c.id) ?? [];
  if (cids.length && game.combats.has(combat.id)) await combat.deleteEmbeddedDocuments("Combatant", cids);
  const gone = new Set(list.map(x => x.t.actor?.uuid));
  await list[0].t.parent.deleteEmbeddedDocuments("Token", [...ids]);
  // захваты на ушедшие с поля цели срываются
  for (const t of list[0].t.parent.tokens) {
    const a = t.actor;
    if (a?.system?.lockUuid && gone.has(a.system.lockUuid)) await a.update({ "system.lock": "", "system.lockUuid": "" });
  }
  return rows;
}

/** Строка о потере для карточки конца раунда. */
export const lossLine = r => `${esc(r.name)}: ${r.how === "retreat" ? "отступил" : r.pilot ? "сбит, катапульта" : r.kind === "ship" ? "потоплен" : r.kind === "ground" ? "уничтожен" : "сбит"}${r.by ? ` (${esc(r.by)})` : ""}`;

/* Задачи по приоритетным целям: «Уничтожить», «Перехватить», «Вывести из строя» выполнены, если цель сбита;
   «Защитить» и «Сопроводить» — если цела (ушла с поля тоже цела). Остальное засчитывает ведущий, отметки нет. */
const KILL = ["destroy", "intercept", "disable"], KEEP = ["protect", "escort"];
export function targetGoals(scene, losses = []) {
  const rows = new Map();
  for (const r of losses) if (r.task !== null && r.task !== undefined) rows.set(r.name, { name: r.name, task: r.task, lost: r.how === "down", how: r.how });
  for (const t of scene?.tokens ?? []) {
    const a = t.actor;
    if (a?.type !== "npc" || !a.system.priority || rows.has(t.name)) continue;
    const down = a.statuses?.has(CONFIG.specialStatusEffects.DEFEATED) || a.system.markers?.doom;
    rows.set(t.name, { name: t.name, task: a.system.task, lost: !!down, how: down ? "down" : "" });
  }
  return [...rows.values()].map(g => {
    const verb = TB.tasks[g.task] || "Цель";
    const state = g.how === "retreat" ? "ушла с поля" : g.lost ? "сбита" : "цела";
    const done = KILL.includes(g.task) ? g.lost : KEEP.includes(g.task) ? !g.lost : null;
    return `${done === true ? "✔ " : done === false ? "✘ " : ""}${esc(verb)}: ${esc(g.name)} (${state})`;
  });
}

/** Отчёт после End combat: поражённые, отступившие и уцелевшие цели, потери своих, сбитые по пилотам. */
async function battleReport(combat) {
  const scene = combat.scene ?? game.scenes.viewed;
  const losses = [...(combat.getFlag(SYSTEM_ID, "losses") ?? []), ...(await clearLosses(combat, Infinity, { keepLog: true }))];
  const survivors = [];
  for (const t of scene?.tokens ?? []) {
    const a = t.actor;
    if (a?.type !== "npc" || t.hidden || OURS.includes(sideOf(a))) continue;
    if (a.statuses?.has(CONFIG.specialStatusEffects.DEFEATED)) continue;
    survivors.push({ name: t.name, hp: a.system.hp ? `${a.system.hp.value}/${a.system.hp.max}` : "", squad: a.system.squad ?? "" });
  }
  const op = scene?.getFlag(SYSTEM_ID, "mission") || scene?.name || "Вылет";
  const objectives = scene?.getFlag(SYSTEM_ID, "objectives") ?? [];
  const theirs = losses.filter(r => !OURS.includes(r.side));
  const ours = losses.filter(r => OURS.includes(r.side));
  // счёт пилотов — только за этот бой, по записям потерь (личный счёт за весь вылет — в «Итогах вылета»)
  const score = new Map();
  for (const r of theirs) if (r.how === "down" && r.byPilot) {
    const k = score.get(r.byPilot) ?? { air: 0, ground: 0 };
    k[r.kind === "air" ? "air" : "ground"] += 1;
    score.set(r.byPilot, k);
  }
  const pilots = [...score].sort(([a], [b]) => a.localeCompare(b, "ru")).map(([n, k]) => `${esc(n)}: в воздухе ${k.air}, на земле и на море ${k.ground}`);
  const goals = targetGoals(scene, losses);
  const block = (title, rows, empty = "—") => `<h4>${title}</h4>${rows.length ? `<ul>${rows.map(x => `<li>${x}</li>`).join("")}</ul>` : `<p class="tb-muted">${empty}</p>`}`;
  const date = new Date().toLocaleDateString("ru-RU");
  const html = `<div class="tb-card tb-card-battle">
    <header class="tb-card-head"><span class="tb-card-who">AWACS</span><span class="tb-card-what">Итоги боя: ${esc(op)}</span></header>
    <div class="tb-note">${esc(scene?.name ?? "")} · ${date} · раундов: ${combat.round}</div>
    ${block("Поражённые цели", theirs.filter(r => r.how === "down").map(lossLine))}
    ${block("Отступили", theirs.filter(r => r.how === "retreat").map(lossLine))}
    ${block("Не поражены", survivors.map(s => `${esc(s.name)}${s.hp ? ` (HP ${s.hp})` : ""}`))}
    ${block("Потери авиакрыла и союзников", ours.map(lossLine), "Потерь нет.")}
    ${block("Счёт пилотов за бой", pilots, "Пилоты никого не сбили.")}
    ${goals.length ? block("Цели", goals) : ""}
    ${objectives.length ? block("Задачи операции", objectives.map(esc)) : ""}
    <div class="tb-actions"><button type="button" data-tb-action="battle-results" class="tb-gm"><i class="fas fa-file-signature"></i> Итоги в личные дела</button></div>
  </div>`;
  // разбор полёта в итогах вылета читает эту сводку: убранных с поля токенов на сцене уже нет
  if (scene) await scene.setFlag(SYSTEM_ID, "lastBattle", { op, date, rounds: combat.round, losses, survivors });
  return ChatMessage.create({ speaker: { alias: "AWACS" }, content: html, flags: { [SYSTEM_ID]: { card: { type: "battle", op } } } });
}
