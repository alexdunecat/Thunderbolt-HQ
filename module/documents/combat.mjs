/* Раунд боя.
   Заявка: в начале раунда каждый участник (кроме зданий и объектов) заявляет 1–3 действия или пропуск.
   Сначала ведущий заявляет за NPC, потом игроки, уже видя заявки врага. Кто заявил меньше, ходит раньше;
   при равенстве игрок раньше NPC. Пропуск уходит в конец очереди. Пилот может отложить ход: он тоже уходит в конец
   со своими действиями.
   Конец раунда: ракеты раунда долетают залпом, потом заканчивается Break! и списывается его Speed, заявки сбрасываются.
   Ракеты по цели со сломанным MAWS (и HVAA) бьют в начале её хода.
   Всё, что меняет бой, делает клиент ведущего: так раунд закрывается правильно, даже если ход передал игрок. */
import { SYSTEM_ID } from "../config.mjs";
import { formDialog, resolveVolley, renderCard } from "../dice/rolls.mjs";
import { esc } from "../utils.mjs";

/** Значение инициативы: 1–3 заявлено действий, PASS пропуск, PASS + n отложил ход с n действиями. */
export const PASS = 10;
const isPass = v => v === PASS;
const delayedBy = v => (v > PASS ? v - PASS : 0);

/** Здание или объект: в заявке не участвует. */
export const passive = actor => actor?.type === "npc" && actor.system.grp === "obj";
const npcSide = c => !c.actor?.hasPlayerOwner;
const acting = combat => combat.combatants.filter(c => !passive(c.actor) && !c.defeated);
const declared = c => Number.isNumeric(c.initiative);
const leadGM = () => (game.users.activeGM ?? game.users.find(u => u.isGM && u.active))?.id === game.user.id;
const flag = (combat, k) => combat.getFlag(SYSTEM_ID, k);

/** Подпись заявки для трекера и чата. */
export function declareLabel(v) {
  if (!Number.isNumeric(v)) return "";
  if (isPass(v)) return "пас";
  if (delayedBy(v)) return `${delayedBy(v)}↓`;
  return String(v);
}

export class TBCombat extends Combat {
  _sortCombatants(a, b) {
    const ia = Number.isNumeric(a.initiative) ? a.initiative : Infinity;
    const ib = Number.isNumeric(b.initiative) ? b.initiative : Infinity;
    if (ia !== ib) return ia - ib;
    const pa = a.actor?.hasPlayerOwner ? 0 : 1, pb = b.actor?.hasPlayerOwner ? 0 : 1;
    if (pa !== pb) return pa - pb;
    return (a.name || "").localeCompare(b.name || "", "ru") || a.id.localeCompare(b.id);
  }

  /** Вместо броска инициативы — заявка: одна форма на всех выбранных участников. */
  async rollInitiative(ids, { updateTurn = true } = {}) {
    ids = typeof ids === "string" ? [ids] : ids;
    const all = ids.map(id => this.combatants.get(id)).filter(c => c?.isOwner);
    if (all.some(c => passive(c.actor))) ui.notifications.info("Здания и объекты действий не заявляют.");
    const list = all.filter(c => !passive(c.actor));
    if (!list.length) return this;
    const data = await declareDialog(this, list);
    if (!data) return this;
    const currentId = this.combatant?.id;
    await this.updateEmbeddedDocuments("Combatant", list.map(c => ({ _id: c.id, initiative: Number(data[c.id]) || 2 })));
    await ChatMessage.create({
      speaker: { alias: "Заявка" },
      content: `<div class="tb-card tb-card-declare"><header class="tb-card-head"><span class="tb-card-what">Заявка действий</span></header>
        <div class="tb-note">${list.map(c => `${esc(c.name)}: ${declareText(Number(data[c.id]))}`).join("<br>")}</div></div>`
    });
    if (updateTurn && currentId && flag(this, "ready") === this.round) await this.update({ turn: this.turns.findIndex(t => t.id === currentId) });
    return this;
  }

  /** Бой завершается: все ракеты, что ещё в воздухе, долетают. */
  async _preDelete(options, user) {
    if ((await super._preDelete(options, user)) === false) return false;
    if (this.started && user.id === game.user.id && game.user.isGM) await resolveVolley(this, { all: true });
  }
}

const declareText = v => (isPass(v) ? "пропуск" : `${v} ${v === 1 ? "действие" : "действия"}`);

/** Форма заявки. Игроки видят, что заявили NPC. */
function declareDialog(combat, list) {
  const npcs = combat.combatants.filter(c => npcSide(c) && declared(c) && !passive(c.actor));
  const seen = !game.user.isGM && npcs.length
    ? `<p class="tb-hint">Заявки врага: ${npcs.map(c => `${esc(c.name)} ${declareLabel(c.initiative)}`).join(", ")}.</p>` : "";
  const rows = list.map(c => `<div class="form-group"><label>${esc(c.name)}</label>
    <select name="${c.id}"><option value="1">1 действие</option><option value="2" selected>2 действия</option><option value="3">3 действия</option><option value="${PASS}">Пропуск</option></select></div>`).join("");
  return formDialog(`Заявка действий: раунд ${combat.round}`,
    `<p class="tb-hint">Меньше действий: ходите раньше. Пропуск уходит в конец очереди.</p>${seen}${rows}`, { ok: "Заявить" });
}

/* ---------- ход раунда (клиент ведущего) ---------- */

/** Начало раунда: ведущему форма заявки за NPC. Если NPC нет, сразу очередь игроков. */
async function beginRound(combat) {
  const npcs = acting(combat).filter(c => npcSide(c) && !declared(c));
  if (!npcs.length) return markNpcDone(combat);
  await combat.rollInitiative(npcs.map(c => c.id), { updateTurn: false });
}

async function markNpcDone(combat) {
  if (flag(combat, "npcDone") !== combat.round) await combat.setFlag(SYSTEM_ID, "npcDone", combat.round);
}

/** Все заявились: очередь с первого, карточка порядка ходов, удар ракет по первому, если надо. */
async function checkDeclared(combat) {
  if (!combat.started) return;
  const list = acting(combat);
  if (list.filter(npcSide).every(declared)) await markNpcDone(combat);
  if (!list.length || !list.every(declared) || flag(combat, "ready") === combat.round) return;
  await combat.update({ turn: 0, [`flags.${SYSTEM_ID}.ready`]: combat.round });
  const order = combat.turns.filter(c => !passive(c.actor) && !c.defeated)
    .map((c, i) => `${i + 1}. ${esc(c.name)} · ${declareLabel(c.initiative)}`).join("<br>");
  await ChatMessage.create({
    speaker: { alias: "AWACS" },
    content: `<div class="tb-card tb-card-round"><header class="tb-card-head"><span class="tb-card-what">Раунд ${combat.round}: порядок ходов</span></header><div class="tb-note">${order}</div></div>`
  });
}

/** Начало хода: ракеты по цели со сломанным MAWS (и HVAA) бьют сейчас. */
async function turnStart(combat) {
  const a = combat.combatant?.actor;
  if (!a || flag(combat, "ready") !== combat.round) return;
  await resolveVolley(combat, { target: a.uuid, atTurnOf: combat.combatant.name });
}

/** Конец раунда round: залп, потом конец Break! и его Speed, потом сброс заявок. */
async function endRound(combat, round) {
  const volley = await resolveVolley(combat, { round });
  const key = `${combat.id}:${round}`;
  // Break!: Speed падает, когда атаки раунда разрешены
  const drops = new Map();
  for (const m of game.messages.contents) {
    const c = m.getFlag(SYSTEM_ID, "card");
    if (c?.type !== "break" || c.combatKey !== key || c.speedApplied) continue;
    drops.set(c.actorUuid, Math.max(drops.get(c.actorUuid) ?? 0, c.speedDrop ?? 2));
    const card = foundry.utils.deepClone(c);
    card.speedApplied = true;
    await m.update({ [`flags.${SYSTEM_ID}.card`]: card, content: renderCard(card) });
  }
  const lines = [];
  for (const c of combat.combatants) {
    const a = c.actor;
    if (!a) continue;
    const upd = {};
    if (a.system.breakEv !== null && a.system.breakEv !== undefined) upd["system.breakEv"] = null;
    const drop = drops.get(a.uuid);
    if (drop) { upd["system.speed"] = (a.system.speed ?? 0) - drop; lines.push(`${esc(c.name)}: Speed −${drop} после Break!`); }
    if (Object.keys(upd).length) await a.update(upd, { tbStallBy: ownerOf(a) });
  }
  await combat.updateEmbeddedDocuments("Combatant", combat.combatants.map(c => ({ _id: c.id, initiative: null })));
  const tail = lines.length ? `<br>${lines.join("<br>")}` : "";
  await ChatMessage.create({
    speaker: { alias: "AWACS" },
    content: `<div class="tb-card tb-card-round"><div class="tb-note">Конец раунда ${round}. ${volley ? "Залп посчитан выше." : "Ракет в воздухе нет."} Break! заканчивается.${tail}</div></div>`
  });
}

/** Кто бросает сваливание после списания Speed: активный игрок-владелец, иначе ведущий. */
function ownerOf(actor) {
  return game.users.find(u => u.active && !u.isGM && actor.testUserPermission(u, "OWNER"))?.id ?? game.user.id;
}

/* ---------- отложить ход ---------- */

/** Пилот откладывает ход: уходит в конец очереди со своими действиями. Очередь переходит к следующему. */
export async function delayTurn(combat, combatant) {
  if (!combatant?.isOwner || !combatant.actor?.hasPlayerOwner) return;
  const v = combatant.initiative;
  if (!Number.isNumeric(v) || isPass(v) || delayedBy(v)) return ui.notifications.info("Ход уже отложен или пропущен.");
  await combatant.update({ initiative: PASS + v });
  ChatMessage.create({ speaker: { alias: "AWACS" }, content: `<div class="tb-card tb-card-round"><div class="tb-note">${esc(combatant.name)} откладывает ход.</div></div>` });
}

/* ---------- хуки ---------- */

export function registerCombat() {
  Hooks.on("preCreateCombatant", (c) => {
    if (!passive(c.actor)) return;
    ui.notifications.info(`«${c.name}»: здания и объекты в бою не ходят.`);
    return false;
  });

  Hooks.on("updateCombat", async (combat, change, options) => {
    // игрокам: ведущий заявил NPC, теперь ваша заявка
    if (!game.user.isGM && foundry.utils.getProperty(change, `flags.${SYSTEM_ID}.npcDone`) === combat.round) {
      const mine = acting(combat).filter(c => c.isOwner && !declared(c));
      if (mine.length) combat.rollInitiative(mine.map(c => c.id), { updateTurn: false });
    }
    if (!leadGM()) return;
    if ("round" in change) {
      if (options.direction === 1 && change.round >= 2) await endRound(combat, change.round - 1);
      if (options.direction !== -1 && combat.started) await beginRound(combat);
      return;
    }
    if ("turn" in change) await turnStart(combat);
  });

  Hooks.on("updateCombatant", (c, change) => {
    if (!leadGM() || !("initiative" in change) || !c.parent?.started) return;
    // пилот отложил ход: очередь у следующего, и у него может начаться ход под ракетами
    if (delayedBy(change.initiative)) setTimeout(() => turnStart(c.parent), 150);
    clearTimeout(declareTimer);
    declareTimer = setTimeout(() => checkDeclared(c.parent), 150);
  });

  Hooks.on("renderCombatTracker", decorateTracker);
}
let declareTimer = null;

/** Трекер: заявки вместо чисел и кнопка «Отложить ход» у пилота, который сейчас ходит. */
function decorateTracker(app, html) {
  const combat = app.viewed;
  if (!combat) return;
  const root = html[0] ?? html;
  for (const li of root.querySelectorAll("li.combatant")) {
    const c = combat.combatants.get(li.dataset.combatantId);
    if (!c) continue;
    const ini = li.querySelector(".token-initiative .initiative");
    if (ini && declared(c)) ini.textContent = declareLabel(c.initiative);
    if (passive(c.actor)) li.querySelector(".token-initiative")?.replaceChildren();
    const mine = c.id === combat.combatant?.id && c.isOwner && c.actor?.hasPlayerOwner && Number.isNumeric(c.initiative) && c.initiative <= 3;
    if (mine && flag(combat, "ready") === combat.round) {
      const ctl = li.querySelector(".combatant-controls");
      const b = document.createElement("a");
      b.className = "combatant-control tb-delay"; b.dataset.tooltip = "Отложить ход: в конец очереди";
      b.innerHTML = '<i class="fas fa-hourglass-half"></i>';
      b.addEventListener("click", ev => { ev.preventDefault(); ev.stopPropagation(); delayTurn(combat, c); });
      ctl?.prepend(b);
    }
  }
}
