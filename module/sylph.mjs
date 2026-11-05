/* FFR-31MR/D Super Sylph («Стрэйнджриал» 8.4 и 8.6): свойство «Тактический разведчик» и фирменный приём «Z.O.E.».
   Разведчик: в начале своего хода пилот опознаёт один контакт «?» (9.6) не дальше 2 зон, без проверки Aim. Кнопка РАЗВЕДКА
   в строке МАШИНА HUD, в начале хода подсказка; можно не опознавать. Вражеские NPC свойством не пользуются.
   Z.O.E.: плитка в окне заявки. Заявка 3 действия с местом в очереди как у 1 (declaredOf в actions.mjs), первая проверка
   хода как d10 = 10 (rollDice в dice/rolls.mjs), в конце хода Strain пилота и WSO падает до 0. Ас на автопилоте включает
   его сам, когда HP мало или он на захвате. */
import { SYSTEM_ID, TB, hasProp, moveReady, sortieMark } from "./config.mjs";
import { esc } from "./utils.mjs";
import { zoeOf, combatantOf, spentOf, turnKey } from "./actions.mjs";
import { tokenOf, zoneDistance } from "./scene.mjs";
import { isUnknown, unknownOf, requestReveal } from "./ident.mjs";

const isLead = () => !!game.user?.isGM && (game.users?.activeGM?.isSelf ?? true);
const say = (actor, html) => ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }),
  content: `<div class="tb-card tb-card-move"><div class="tb-note">${html}</div></div>` });
const who = actor => esc(actor.token?.name ?? actor.system?.callsign ?? actor.name);
const planeName = actor => actor.system?.plane?.name ?? "Super Sylph";

/* ---------- «Z.O.E.» ---------- */

/** Значение плитки «Z.O.E.» в заявке (в инициативу не пишется: там 1). */
export const ZOE = 9;

/** Можно ли заявить «Z.O.E.» этому бойцу: приём не тратился или уже заявлен в этом раунде (заявка заново). */
export const zoeOffer = c => c?.actor?.type === "pilot" && (moveReady(c.actor, "zoe") || !!zoeOf(c.actor, c.parent));

/** Строка заявки в чат. */
export const zoeDeclareText = "Z.O.E.: 3 действия, ход как с заявкой 1";

/** Заявка с «Z.O.E.»: флаг на раунд и отметка приёма за вылет. */
export async function declareZoe(c, { auto = false } = {}) {
  const actor = c?.actor;
  if (!actor) return;
  const had = !!zoeOf(actor, c.parent);
  await actor.update({
    [`flags.${SYSTEM_ID}.zoe`]: { combat: c.parent.id, round: c.parent.round, turn: c.id, started: auto, rolled: false, auto },
    [`flags.${SYSTEM_ID}.sortie`]: { ...(actor.getFlag(SYSTEM_ID, "sortie") ?? {}), move: sortieMark(actor) }
  });
  if (had) return;
  return say(actor, `<b>${who(actor)}</b> отдаёт управление ИИ <b>${esc(TB.planeMoves.zoe.name)}</b> ${auto ? "Три действия, " : "Заявка 3 действия, ход как с заявкой 1, "}проверка хода как d10 = 10. В конце хода Strain экипажа упадёт до 0.`);
}

/** Заявили заново без «Z.O.E.»: снять флаг этого раунда (приём уже потрачен). */
export async function dropZoe(c) {
  if (zoeOf(c?.actor, c?.parent)) await c.actor.unsetFlag(SYSTEM_ID, "zoe");
}

/** Пилот WSO во второй кабине: актёр-пилот, чьё имя или позывной вписан в поле WSO. */
export function wsoActorOf(actor, list = game.actors?.contents ?? game.actors ?? []) {
  const want = String(actor?.system?.wso ?? "").trim().toLowerCase();
  if (!want) return null;
  return list.find(a => a !== actor && a.type === "pilot" && [a.name, a.system?.callsign].some(n => String(n ?? "").trim().toLowerCase() === want)) ?? null;
}

/** Конец хода под «Z.O.E.»: Strain пилота и WSO до 0, строка в чат. */
export async function finishZoe(actor) {
  await actor.unsetFlag(SYSTEM_ID, "zoe");
  const crew = [actor, wsoActorOf(actor)].filter(a => a && Number.isFinite(a.system?.strain?.value));
  for (const a of crew) if (a.system.strain.value !== 0) await a.update({ "system.strain.value": 0 });
  const wso = String(actor.system?.wso ?? "").trim();
  const extra = wso && !crew[1] ? ` WSO «${esc(wso)}» тоже на нуле: отметьте на его листе.` : "";
  return say(actor, `<b>${esc(TB.planeMoves.zoe.name)}</b> возвращает ручку. Перегрузку держал планер, а не люди: Strain ${crew.map(a => `«${esc(a.system?.callsign || a.name)}»`).join(" и ") || "экипажа"} падает до 0.${extra}`);
}

/** Ас на автопилоте: включить «Z.O.E.», когда HP мало или на нём захват. */
export function zoeWanted(actor, { locked = false, incoming = 0 } = {}) {
  if (!moveReady(actor, "zoe")) return false;
  const hp = actor.system?.hp;
  return locked || incoming > 0 || (Number.isFinite(hp?.value) && hp.value <= 1);
}

/* ---------- «Тактический разведчик» ---------- */

/** Контакты «?» не дальше 2 зон от машины. */
export function reconTargets(actor) {
  const me = tokenOf(actor);
  if (!me || !canvas?.ready) return [];
  return canvas.tokens.placeables.filter(t => t !== me && !t.document.hidden && isUnknown(t) && (zoneDistance(me, t) ?? 99) <= 2);
}

/** Состояние кнопки РАЗВЕДКА: { can, why } или null (свойства нет). near — сколько контактов «?» в пределах 2 зон. */
export function reconState(actor, near = 0) {
  if (actor?.type !== "pilot" || !hasProp(actor, "recon")) return null;
  const c = combatantOf(actor);
  if (!c || c.parent.combatant?.id !== c.id) return { can: false, why: "в начале своего хода в бою" };
  if (actor.getFlag(SYSTEM_ID, "recon") === turnKey(c)) return { can: false, why: "в этот ход контакт уже опознан" };
  if (spentOf(c).used > 0) return { can: false, why: "только в начале хода, до первого действия" };
  if (!near) return { can: false, why: "контактов «?» не дальше 2 зон нет" };
  return { can: true, why: "" };
}

/** Нажали РАЗВЕДКА: выбрать контакт «?» не дальше 2 зон и опознать его. */
export async function useRecon(actor) {
  const list = reconTargets(actor);
  const st = reconState(actor, list.length);
  if (!st) return;
  if (!st.can) return ui.notifications.warn(`Тактический разведчик: ${st.why}.`);
  let tok = list.length === 1 ? list[0] : null;
  if (!tok) {
    const { pickTargetToken } = await import("./pick.mjs");
    tok = await pickTargetToken(actor, { title: "Тактический разведчик", hint: `Щёлкните по контакту «?» не дальше 2 зон (${list.map(t => t.name).join(", ")}).` });
    if (!tok) return;
    if (!list.includes(tok)) return ui.notifications.warn("Тактический разведчик: нужен контакт «?» не дальше 2 зон.");
  }
  const n = unknownOf(tok)?.n;
  await actor.setFlag(SYSTEM_ID, "recon", turnKey(combatantOf(actor)));
  await say(actor, `<b>${who(actor)}</b>, «Тактический разведчик»: ${esc(planeName(actor))} опознал контакт: Контакт ${n ?? "?"}.`);
  requestReveal(tok.document.uuid, "разведчик");
  return tok;
}

/* ---------- хуки ---------- */

export function registerSylph() {
  Hooks.on("updateCombat", (combat, change, options) => {
    if (options?.tbUndo || !("turn" in change || "round" in change)) return;
    // ведущий: начало и конец хода под «Z.O.E.»
    if (isLead()) for (const c of combat.combatants) {
      const a = c.actor, f = a?.getFlag?.(SYSTEM_ID, "zoe");
      if (!f || f.auto) continue;
      const now = f.combat === combat.id && f.round === combat.round;
      if (now && combat.combatant?.id === f.turn) { if (!f.started) a.setFlag(SYSTEM_ID, "zoe", { ...f, started: true }).catch(() => null); }
      else if (f.started) finishZoe(a).catch(err => console.error(`${SYSTEM_ID} | Z.O.E.`, err));
      else if (!now) a.unsetFlag(SYSTEM_ID, "zoe").catch(() => null);
    }
    // игрок: в начале хода подсказка разведчика
    const a = combat.combatant?.actor;
    if (!a?.isOwner || game.user.isGM || !hasProp(a, "recon")) return;
    // ход уже сменился, а отметка действий у бойца ещё старая: подсказка чуть позже
    setTimeout(() => {
      const list = reconTargets(a);
      if (list.length && reconState(a, list.length)?.can)
        ui.notifications.info(`Тактический разведчик: контакт «?» не дальше 2 зон (${list.map(t => t.name).join(", ")}). Кнопка РАЗВЕДКА в строке МАШИНА опознает его до первого действия.`);
    }, 300);
  });
}
