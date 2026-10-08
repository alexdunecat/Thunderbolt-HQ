/* Потери в бою. Сбитая машина получает знак X (вместо черепа Foundry) и стоит на поле до конца раунда, в котором её сбили:
   пушкой — до конца текущего, ракетой из залпа — до конца следующего (залп считается уже на смене раунда).
   Отступившие (статус «Отступил из боя» на токене) уходят с поля в конце раунда. Всё это записывается в сводку боя,
   а после End combat в чат приходит отчёт с кнопкой «Итоги в личные дела». */
import { SYSTEM_ID, SYS_PATH } from "./config.mjs";
import { esc } from "./utils.mjs";
import { sideOf } from "./scene.mjs";

export const RETREAT = "retreat";
const OURS = ["player", "ally"];

export function registerLosses() {
  const dead = CONFIG.specialStatusEffects.DEFEATED;
  const fx = CONFIG.statusEffects.find(e => e.id === dead);
  if (fx) { fx.img = `${SYS_PATH}assets/status/destroyed.svg`; fx.icon = fx.img; }
  if (!CONFIG.statusEffects.some(e => e.id === RETREAT))
    CONFIG.statusEffects.push({ id: RETREAT, name: "Отступил из боя", img: `${SYS_PATH}assets/status/retreat.svg`, icon: `${SYS_PATH}assets/status/retreat.svg` });
  Hooks.on("deleteCombat", combat => {
    if (!game.users.activeGM?.isSelf || !combat.round) return;
    // урон по пилотам игроков из последнего залпа наносят их клиенты: подождать его
    setTimeout(() => battleReport(combat), 1500);
  });
}

const kindOf = a => (a.type === "pilot" ? "air" : a.system.kind);

/** Сбит в этом бою: { combat, round, by } — ставится при уничтожении (actor.mjs). */
const downOf = a => a?.getFlag(SYSTEM_ID, "down") ?? null;

/** Запись о потере для сводки. */
function lossOf(t, how) {
  const a = t.actor, d = downOf(a);
  return { name: t.name, side: sideOf(a), kind: kindOf(a), pilot: a.type === "pilot", how, by: d?.by ?? "", round: d?.round ?? null };
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
  await list[0].t.parent.deleteEmbeddedDocuments("Token", [...ids]);
  return rows;
}

/** Строка о потере для карточки конца раунда. */
export const lossLine = r => `${esc(r.name)}: ${r.how === "retreat" ? "отступил" : r.pilot ? "сбит, катапульта" : r.kind === "ship" ? "потоплен" : r.kind === "ground" ? "уничтожен" : "сбит"}${r.by ? ` (${esc(r.by)})` : ""}`;

/** Отчёт после End combat: поражённые, отступившие и уцелевшие цели, потери своих, сбитые по пилотам. */
async function battleReport(combat) {
  const scene = combat.scene ?? game.scenes.viewed;
  const losses = [...(combat.getFlag(SYSTEM_ID, "losses") ?? []), ...(await clearLosses(combat, Infinity, { keepLog: true }))];
  const survivors = [];
  for (const t of scene?.tokens ?? []) {
    const a = t.actor;
    if (a?.type !== "npc" || t.hidden || OURS.includes(sideOf(a))) continue;
    if (a.statuses?.has(CONFIG.specialStatusEffects.DEFEATED)) continue;
    survivors.push({ name: t.name, hp: a.system.hp ? `${a.system.hp.value}/${a.system.hp.max}` : "" });
  }
  const op = scene?.getFlag(SYSTEM_ID, "mission") || scene?.name || "Вылет";
  const objectives = scene?.getFlag(SYSTEM_ID, "objectives") ?? [];
  const theirs = losses.filter(r => !OURS.includes(r.side));
  const ours = losses.filter(r => OURS.includes(r.side));
  const pilots = game.actors.filter(a => a.type === "pilot" && a.getFlag(SYSTEM_ID, "kills"))
    .map(a => { const k = a.getFlag(SYSTEM_ID, "kills"); return `${esc(a.name)}: в воздухе ${k.air ?? 0}, на земле и на море ${k.ground ?? 0}`; });
  const block = (title, rows, empty = "—") => `<h4>${title}</h4>${rows.length ? `<ul>${rows.map(x => `<li>${x}</li>`).join("")}</ul>` : `<p class="tb-muted">${empty}</p>`}`;
  const date = new Date().toLocaleDateString("ru-RU");
  const html = `<div class="tb-card tb-card-battle">
    <header class="tb-card-head"><span class="tb-card-who">AWACS</span><span class="tb-card-what">Итоги боя: ${esc(op)}</span></header>
    <div class="tb-note">${esc(scene?.name ?? "")} · ${date} · раундов: ${combat.round}</div>
    ${block("Поражённые цели", theirs.filter(r => r.how === "down").map(lossLine))}
    ${block("Отступили", theirs.filter(r => r.how === "retreat").map(lossLine))}
    ${block("Не поражены", survivors.map(s => `${esc(s.name)}${s.hp ? ` (HP ${s.hp})` : ""}`))}
    ${block("Потери авиакрыла и союзников", ours.map(lossLine), "Потерь нет.")}
    ${pilots.length ? block("Счёт пилотов", pilots) : ""}
    ${objectives.length ? block("Задачи операции", objectives.map(esc)) : ""}
    <div class="tb-actions"><button type="button" data-tb-action="battle-results" class="tb-gm"><i class="fas fa-file-signature"></i> Итоги в личные дела</button></div>
  </div>`;
  // разбор полёта в итогах вылета читает эту сводку: убранных с поля токенов на сцене уже нет
  if (scene) await scene.setFlag(SYSTEM_ID, "lastBattle", { op, date, rounds: combat.round, losses, survivors });
  return ChatMessage.create({ speaker: { alias: "AWACS" }, content: html, flags: { [SYSTEM_ID]: { card: { type: "battle", op } } } });
}
