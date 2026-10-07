/* Эскадрилья: бонусы к следующему броску (Perk, Complication, Leadership), строй «вплотную».
   Чужого актёра игрок менять не может: такие изменения через сокет применяет ведущий. */
import { SYSTEM_ID } from "./config.mjs";
import { esc, resolveActor } from "./utils.mjs";
import { tokenOf, zoneDistance } from "./scene.mjs";

const CHANNEL = `system.${SYSTEM_ID}`;
const NEXT = "next", ADJ = "adjacent";

export function initSocket() {
  game.socket.on(CHANNEL, async msg => {
    if (!game.users.activeGM?.isSelf) return;
    const actor = resolveActor(msg.uuid);
    if (!actor) return;
    if (msg.type === "next") await addNextLocal(actor, msg.mod);
    if (msg.type === "adjacent") await actor.setFlag(SYSTEM_ID, ADJ, msg.list);
  });
}

/** Выполнить на своём актёре или попросить ведущего. */
function viaOwner(actor, type, payload, local) {
  if (actor.isOwner) return local();
  if (!game.users.activeGM) return ui.notifications.warn("Чтобы изменить чужой лист, в игре должен быть ведущий.");
  game.socket.emit(CHANNEL, { type, uuid: actor.uuid, ...payload });
}

/* ---------- к следующему броску ---------- */

export const nextMods = actor => actor?.getFlag(SYSTEM_ID, NEXT) ?? [];

async function addNextLocal(actor, mod) {
  return actor.setFlag(SYSTEM_ID, NEXT, [...nextMods(actor), mod]);
}

/** Добавить бонус или штраф к следующему броску актёра: { label, value }. */
export function giveNext(actor, mod) {
  return viaOwner(actor, "next", { mod }, () => addNextLocal(actor, mod));
}

/** Забрать отложенные бонусы в бросок: строки для карточки, флаг очищается. */
export async function takeNext(actor) {
  const list = nextMods(actor);
  if (!list.length || !actor.isOwner) return [];
  await actor.unsetFlag(SYSTEM_ID, NEXT);
  return list.map(m => [m.label, m.value]);
}

export async function dropNext(actor, index) {
  const list = nextMods(actor).filter((_, i) => i !== index);
  return list.length ? actor.setFlag(SYSTEM_ID, NEXT, list) : actor.unsetFlag(SYSTEM_ID, NEXT);
}

/** Союзники для выбора: другие пилоты; с токеном в той же зоне помечаются. */
function allies(actor) {
  const me = tokenOf(actor);
  return game.actors.filter(a => a.type === "pilot" && a.id !== actor.id).map(a => {
    const dist = me ? zoneDistance(me, tokenOf(a)) : null;
    return { actor: a, sameZone: dist === 0, dist };
  }).sort((x, y) => (x.dist ?? 99) - (y.dist ?? 99) || x.actor.name.localeCompare(y.actor.name, "ru"));
}

function pickDialog(title, intro, rows, ok, { radio = false } = {}) {
  return new Promise(resolve => {
    const name = radio ? "pick" : null;
    const items = rows.map((r, i) => `<label class="tb-pick"><input type="${radio ? "radio" : "checkbox"}" ${radio ? `name="${name}"` : `name="p${i}"`} value="${i}" ${r.checked ? "checked" : ""}> ${esc(r.label)}${r.hint ? ` <small>${esc(r.hint)}</small>` : ""}</label>`).join("");
    new Dialog({
      title, content: `<form class="tb-dialog"><p class="tb-hint">${intro}</p><div class="tb-pick-list">${items}</div></form>`,
      buttons: {
        ok: { icon: '<i class="fas fa-check"></i>', label: ok, callback: html => {
          const form = html[0].querySelector("form");
          const chosen = [...form.querySelectorAll("input:checked")].map(n => rows[Number(n.value)]);
          resolve(chosen);
        } },
        cancel: { label: "Отмена", callback: () => resolve(null) }
      },
      default: "ok", close: () => resolve(null)
    }, { classes: ["dialog", "thunderbolt"], width: 380 }).render(true);
  });
}

/** Perk или Complication с карточки: +1 / −1 к следующей проверке себе или союзнику. */
export async function passOutcome(actor, kind) {
  const value = kind === "perk" ? 1 : -1;
  const label = `${kind === "perk" ? "Perk" : "Complication"} от ${actor.name}`;
  const rows = [{ actor, label: `${actor.name} (себе)`, checked: true },
    ...allies(actor).map(a => ({ actor: a.actor, label: a.actor.name, hint: a.sameZone ? "в вашей зоне" : "" }))];
  const chosen = await pickDialog(kind === "perk" ? "Perk: +1 к следующей проверке" : "Complication: −1 к следующей проверке",
    "Кому достаётся? Бонус сам попадёт в следующий бросок.", rows, "Передать", { radio: true });
  const who = chosen?.[0]?.actor;
  if (!who) return false;
  await giveNext(who, { label, value });
  return who;
}

/** Leadership: союзники, которые послушали, прибавят ваш Lead к следующему броску. */
export async function leadership(actor) {
  const lead = actor.system.skillTotal?.lead ?? 0;
  if (actor.system.skillBlocked?.lead) return ui.notifications.warn("Lead недоступен: метка Grit.");
  if (lead <= 0) return ui.notifications.warn("Lead 0: приказ ничего не добавит.");
  const adj = new Set(actor.getFlag(SYSTEM_ID, ADJ) ?? []);
  const target = game.user.targets.first()?.actor;
  const rows = allies(actor).map(a => ({ actor: a.actor, label: a.actor.name, checked: adj.has(a.actor.uuid) || a.actor === target,
    hint: adj.has(a.actor.uuid) ? "вплотную" : a.sameZone ? "в вашей зоне" : "" }));
  if (!rows.length) return ui.notifications.info("Других пилотов нет.");
  const chosen = await pickDialog("Leadership: совет или приказ", `Кто послушал, прибавит ваш Lead (+${lead}) к следующему броску. Подходит и для «Сомкнуть строй».`, rows, "Приказать");
  if (!chosen?.length) return;
  for (const r of chosen) await giveNext(r.actor, { label: `Lead ${actor.name}`, value: lead });
  return ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<div class="tb-card tb-card-lead"><header class="tb-card-head"><span class="tb-card-who">${esc(actor.name)}</span><span class="tb-card-what">Leadership</span></header><div class="tb-note">${chosen.map(r => `<b>${esc(r.actor.name)}</b>`).join(", ")}: +${lead} к следующему броску.</div></div>`
  });
}

/* ---------- строй «вплотную» ---------- */

export const adjacentOf = actor => actor?.getFlag(SYSTEM_ID, ADJ) ?? [];

function setAdjacent(actor, list) {
  return viaOwner(actor, "adjacent", { list }, () => actor.setFlag(SYSTEM_ID, ADJ, list));
}

/** Встать вплотную: связь двусторонняя, только с самолётами в своей зоне. */
export async function formUp(actor) {
  const mine = new Set(adjacentOf(actor));
  const rows = allies(actor).map(a => ({ actor: a.actor, label: a.actor.name, checked: mine.has(a.actor.uuid),
    hint: a.sameZone ? "в вашей зоне" : a.dist === null ? "" : `в ${a.dist} зон.` }));
  if (!rows.length) return ui.notifications.info("Других пилотов нет.");
  const chosen = await pickDialog("Вплотную (Adjacent)", "Встать вплотную к самолётам в своей зоне. Отрыв бесплатный: связь снимается, когда вы окажетесь в разных зонах.", rows, "Встать в строй");
  if (!chosen) return;
  const now = new Set(chosen.map(r => r.actor.uuid));
  for (const r of rows) {
    const other = r.actor, theirs = new Set(adjacentOf(other));
    const want = now.has(other.uuid);
    if (want === theirs.has(actor.uuid)) continue;
    want ? theirs.add(actor.uuid) : theirs.delete(actor.uuid);
    await setAdjacent(other, [...theirs]);
  }
  await actor.setFlag(SYSTEM_ID, ADJ, [...now]);
}

export async function breakAdjacent(actor, uuid) {
  await actor.setFlag(SYSTEM_ID, ADJ, adjacentOf(actor).filter(u => u !== uuid));
  const other = resolveActor(uuid);
  if (other) await setAdjacent(other, adjacentOf(other).filter(u => u !== actor.uuid));
}

/** Ведущий: разорвать строй, если самолёты оказались в разных зонах. */
export async function checkAdjacency() {
  if (!canvas?.ready) return;
  for (const a of game.actors.filter(x => x.type === "pilot")) {
    const list = adjacentOf(a);
    if (!list.length) continue;
    const keep = list.filter(u => {
      const d = zoneDistance(tokenOf(a), tokenOf(resolveActor(u)));
      return d === null || d === 0;
    });
    if (keep.length !== list.length) await a.setFlag(SYSTEM_ID, ADJ, keep);
  }
}
