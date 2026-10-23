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
import { clearLosses, lossLine } from "../losses.mjs";
import { resolveStrikes } from "../strikes.mjs";
import { advanceScales } from "../scales.mjs";
import { esc } from "../utils.mjs";

/** Значение инициативы: 1–3 заявлено действий, PASS пропуск, PASS + n отложил ход с n действиями. */
export const PASS = 10;
const isPass = v => v === PASS;
const delayedBy = v => (v > PASS ? v - PASS : 0);

/** Здание или объект: в заявке не участвует. */
export const passive = actor => actor?.type === "npc" && actor.system.grp === "obj";
const npcSide = c => !c.actor?.hasPlayerOwner;
/** Выбыл: сбит (знак X), отступил, перевооружается за линией возврата, неактивен (игрока нет) или помечен побеждённым в трекере. Заявки не делает, ход пропускается. */
export const isOut = c => !!c?.defeated || !!c?.actor?.statuses?.has(CONFIG.specialStatusEffects.DEFEATED)
  || !!c?.actor?.statuses?.has("retreat") || c?.actor?.getFlag?.(SYSTEM_ID, "down")?.combat === c?.parent?.id
  || c?.actor?.getFlag?.(SYSTEM_ID, "rearm")?.combat === c?.parent?.id || !!c?.actor?.statuses?.has("inactive");
const acting = combat => combat.combatants.filter(c => !passive(c.actor) && !isOut(c));
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
    const list = all.filter(c => !passive(c.actor) && !isOut(c));
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
async function declareDialog(combat, list) {
  // ведущему: число действий NPC по совету на ход (настройка «Совет на ход NPC»)
  const advice = {};
  if (game.user.isGM) {
    const { adviseDeclare } = await import("../npc-advice.mjs");
    for (const c of list) if (!c.actor?.hasPlayerOwner) advice[c.id] = adviseDeclare(c.actor);
  }
  const npcs = combat.combatants.filter(c => npcSide(c) && declared(c) && !passive(c.actor));
  const seen = !game.user.isGM && npcs.length
    ? `<p class="tb-hint">Заявки врага: ${npcs.map(c => `${esc(c.name)} ${declareLabel(c.initiative)}`).join(", ")}.</p>` : "";
  const rows = list.map(c => `<div class="form-group"><label>${esc(c.name)}</label>
    <select name="${c.id}">${[1, 2, 3].map(n => `<option value="${n}" ${(advice[c.id] ?? 2) === n ? "selected" : ""}>${n} ${n === 1 ? "действие" : "действия"}${advice[c.id] === n ? " · совет" : ""}</option>`).join("")}<option value="${PASS}">Пропуск</option></select></div>`).join("");
  return formDialog(`Заявка действий: раунд ${combat.round}`,
    `<p class="tb-hint">Меньше действий: ходите раньше. Пропуск уходит в конец очереди.</p>${seen}${rows}`, { ok: "Заявить" });
}

/* ---------- ход раунда (клиент ведущего) ---------- */

/** Начало раунда: ведущему форма заявки за NPC. Если NPC нет, сразу очередь игроков. */
async function beginRound(combat) {
  // сбитые, что ещё висят на поле до конца раунда, и отступившие пасуют сами
  const out = combat.combatants.filter(c => isOut(c) && !passive(c.actor) && c.initiative !== PASS);
  // срыв «Ступор»: пилот пропускает следующий ход целиком
  const stunned = combat.combatants.filter(c => !out.includes(c) && c.actor?.getFlag?.(SYSTEM_ID, "stupor"));
  for (const c of stunned) await c.actor.unsetFlag(SYSTEM_ID, "stupor");
  out.push(...stunned);
  if (out.length) await combat.updateEmbeddedDocuments("Combatant", out.map(c => ({ _id: c.id, initiative: PASS })));
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
  // если очередь уже на первом, Foundry выкинет turn из изменения и хук не начнёт ход: начинаем сами
  const already = combat.turn === 0;
  await combat.update({ turn: 0, [`flags.${SYSTEM_ID}.ready`]: combat.round });
  if (already) await turnStart(combat);
  const order = combat.turns.filter(c => !passive(c.actor) && !isOut(c))
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
  // сбитый или отступивший ход не делает
  if (isOut(combat.combatant) || passive(a)) return combat.nextTurn();
  await resolveVolley(combat, { target: a.uuid, atTurnOf: combat.combatant.name });
  // сваливание: Speed ≤ 0 в начале хода — бросок сам у владельца (повтор после провала), если прошлый не разобран
  if (a.system.speed <= 0 && !pendingStall(a))
    await a.update({ [`flags.${SYSTEM_ID}.stallTurn`]: `${combat.round}.${combat.turn}` }, { tbStallBy: ownerOf(a), tbStallTurn: true, tbFree: true });
}

/** Есть ли в чате неразобранная карточка сваливания этой машины (кнопку «Выровняться» или «Потерять высоту» ещё не нажали). */
function pendingStall(actor) {
  return game.messages.contents.slice(-30).some(m => { const c = m.getFlag(SYSTEM_ID, "card"); return c?.type === "stall" && !c.applied && c.actorUuid === actor.uuid; });
}

/** Конец раунда round: залп, потом конец Break! и его Speed, потом сброс заявок. */
async function endRound(combat, round) {
  // раунд, к которому вернулись кнопкой «назад» и прошли снова: шкалы и гибель целей второй раз не считаются
  // (залп, удары и Break! и так не повторяются: их карточки уже отмечены)
  const again = (flag(combat, "ended") ?? 0) >= round;
  if (!again) await combat.setFlag(SYSTEM_ID, "ended", round);
  const volley = await resolveVolley(combat, { round });
  // удары по площади: после всех ходов, по тем, кто так и не ушёл из отмеченных зон
  try { await resolveStrikes(combat, round); } catch (err) { console.error(`${SYSTEM_ID} | удары по площади`, err); }
  // шкалы крупных целей: «Падение», «Сброс», «Над целью», перегрев, отсчёт до пуска
  if (!again) try { await advanceScales(combat, round); } catch (err) { console.error(`${SYSTEM_ID} | шкалы`, err); }
  // гибель крупных целей по их правилам: опрокинулся, упал, взорвался (boss-fate.mjs)
  if (!again) try { const { resolveFates } = await import("../boss-fate.mjs"); await resolveFates(combat, round); } catch (err) { console.error(`${SYSTEM_ID} | гибель целей`, err); }
  // баллистическая ракета: из раунда пуска в стратосферу, после раунда в стратосфере — в космос
  if (!again) try { const { resolveBallistic } = await import("../ballistic.mjs"); await resolveBallistic(combat, round); } catch (err) { console.error(`${SYSTEM_ID} | баллистическая ракета`, err); }
  const key = `${combat.id}:${round}`;
  // Break!: Speed падает, когда атаки раунда разрешены
  const drops = new Map(), marked = [];
  for (const m of game.messages.contents) {
    const c = m.getFlag(SYSTEM_ID, "card");
    if (c?.type !== "break" || c.combatKey !== key || c.speedApplied) continue;
    drops.set(c.actorUuid, Math.max(drops.get(c.actorUuid) ?? 0, c.speedDrop ?? 2));
    const card = foundry.utils.deepClone(c);
    card.speedApplied = true;
    marked.push({ _id: m.id, [`flags.${SYSTEM_ID}.card`]: card, content: renderCard(card) });
  }
  // одним запросом: каждая правка карточки иначе гоняет перерисовку чата и панелей у всех
  if (marked.length) await ChatMessage.updateDocuments(marked);
  const lines = [];
  for (const c of combat.combatants) {
    const a = c.actor;
    if (!a) continue;
    const upd = {};
    if (a.system.breakEv !== null && a.system.breakEv !== undefined) upd["system.breakEv"] = null;
    const drop = drops.get(a.uuid);
    if (drop) { upd["system.speed"] = (a.system.speed ?? 0) - drop; lines.push(`${esc(c.name)}: Speed −${drop} после Break!`); }
    if (Object.keys(upd).length) await a.update(upd, { tbStallBy: ownerOf(a), tbFree: true });
  }
  // сбитые до этого раунда и отступившие уходят с поля (ракеты залпа, посчитанного сейчас, — в конце следующего)
  const gone = await clearLosses(combat, round);
  if (gone.length) lines.push(`С поля убраны: ${gone.map(lossLine).join(", ")}.`);
  const reset = combat.combatants.filter(c => c.initiative !== null).map(c => ({ _id: c.id, initiative: null }));
  if (reset.length) await combat.updateEmbeddedDocuments("Combatant", reset);
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
    // персонаж на земле в воздушном бою не участвует (кнопка «добавить все токены» его пропускает)
    if (c.actor?.type === "staff") return false;
    if (!passive(c.actor)) return;
    ui.notifications.info(`«${c.name}»: здания и объекты в бою не ходят.`);
    return false;
  });

  Hooks.on("updateCombat", async (combat, change, options) => {
    // игрокам: ведущий заявил NPC, теперь ваша заявка
    if (options?.tbUndo) return;
    if (!game.user.isGM && foundry.utils.getProperty(change, `flags.${SYSTEM_ID}.npcDone`) === combat.round) {
      const mine = acting(combat).filter(c => c.isOwner && !declared(c));
      if (mine.length) combat.rollInitiative(mine.map(c => c.id), { updateTurn: false }).catch(err => console.error(`${SYSTEM_ID} | заявка`, err));
    }
    if (!leadGM()) return;
    if ("round" in change) {
      // назад на раунд: заявки следующего раунда забыты, чтобы при новом шаге вперёд они начались заново
      if (options.direction === -1) for (const k of ["ready", "npcDone"]) if ((flag(combat, k) ?? 0) > combat.round) await combat.unsetFlag(SYSTEM_ID, k);
      if (options.direction === 1 && change.round >= 2) await endRound(combat, change.round - 1);
      // пилоты с перевооружения за линией возврата возвращаются до заявок
      if (options.direction === 1) try { const { returnRound } = await import("../return-line.mjs"); await returnRound(combat); } catch (err) { console.error(`${SYSTEM_ID} | линия возврата`, err); }
      if (options.direction !== -1 && combat.started) await beginRound(combat);
      return;
    }
    if ("turn" in change) await turnStart(combat);
  });

  Hooks.on("updateCombatant", (c, change, options) => {
    if (options?.tbUndo || !leadGM() || !("initiative" in change) || !c.parent?.started) return;
    // пилот отложил ход: очередь у следующего, и у него может начаться ход под ракетами
    if (delayedBy(change.initiative)) setTimeout(() => turnStart(c.parent), 150);
    clearTimeout(declareTimer);
    declareTimer = setTimeout(() => checkDeclared(c.parent), 150);
  });

  Hooks.on("renderCombatTracker", decorateTracker);
  // лицо, шильдик или уровень поменялись у того, кто в бою: перерисовать трекер
  const picChanged = change => { const s = change?.system ?? {}; return "img" in (change ?? {}) || "tier" in s || "trackerImg" in s || "insignia" in s; };
  Hooks.on("updateActor", (actor, change) => {
    if (picChanged(change) && game.combat?.combatants.some(c => c.actor === actor || c.actorId === actor.id)) ui.combat?.render();
  });
  Hooks.on("updateActorDelta", (delta, change) => { if (picChanged(change) && game.combat) ui.combat?.render(); });
}
let declareTimer = null;

/** Картинка в трекере вместо токена или null (оставить токен): пилот и ас — лицо, дуэлянт — лицо или шильдик (system.trackerImg). */
export function trackerImage(c) {
  const a = c?.actor, s = a?.system;
  if (a?.type === "pilot") return a.img || null;
  if (a?.type !== "npc" || !s) return null;
  if (s.tier === "ace") return a.img || null;
  if (s.tier === "duelist") return (s.trackerImg === "insignia" && s.insignia) || a.img || null;
  return null;
}

/** Трекер: заявки вместо чисел и кнопка «Отложить ход» у пилота, который сейчас ходит. */
function decorateTracker(app, html) {
  const combat = app.viewed;
  if (!combat) return;
  const root = html[0] ?? html;
  for (const li of root.querySelectorAll("li.combatant")) {
    const c = combat.combatants.get(li.dataset.combatantId);
    if (!c) continue;
    const ini = li.querySelector(".token-initiative .initiative");
    if (ini && declared(c)) {
      // сколько из заявленного уже сделано: «1/2»
      const spent = c.getFlag(SYSTEM_ID, "acts"), used = spent?.round === combat.round ? spent.used : 0;
      const n = isPass(c.initiative) ? 0 : delayedBy(c.initiative) || c.initiative;
      ini.textContent = used ? `${used}/${n}${delayedBy(c.initiative) ? "↓" : ""}` : declareLabel(c.initiative);
      if (used > n) ini.style.color = "#d0302a";
    }
    if (passive(c.actor)) li.querySelector(".token-initiative")?.replaceChildren();
    // картинка: конскрипт — самолёт (токен), пилот и ас — лицо, дуэлянт — лицо или шильдик по выбору в листе
    const pic = trackerImage(c), img = li.querySelector("img.token-image");
    if (pic && img) { img.src = pic; img.dataset.src = pic; }
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
