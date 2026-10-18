/* Действия листа на панели макросов: кнопку действия или кубик навыка можно перетащить на хотбар.
   Макрос действует за выделенный свой токен, а если такого нет, за пилота, с листа которого его перетащили. */
import { SYSTEM_ID, SYS_PATH, TB } from "./config.mjs";
import { resolveActor } from "./utils.mjs";
import { leadership, formUp } from "./squad.mjs";
import { spendAction, allowAction, endTurn } from "./actions.mjs";
import { practicedReady } from "./dice/rolls.mjs";

/** Действия, которые всегда с броском (Fox Two! с броском решается в окне пуска). */
const ROLLED = new Set(["guns", "break", "recover", "skill"]);

export const ACTIONS = {
  lock: "Lock On!", missile: "Fox Two!", guns: "Guns, Guns, Guns!", break: "Break!",
  recover: "Вернуть Strain", lead: "Leadership", formup: "Вплотную"
};

/** Выполнить действие листа за актёра. В бою сделанное действие попадает в счётчик хода. */
export async function runAction(actor, act, { skill } = {}) {
  // проверка хода уже была, но «Отточенное мастерство» её не тратит: окно откроется, обычный бросок оно не пустит
  if (!allowAction(actor, act, { rolled: ROLLED.has(act) && !practicedReady(actor) })) return;
  const res = await doAction(actor, act, { skill });
  if (!res) return res;
  // действие состоялось: карточка в чате (отмена диалога и предупреждения возвращают не её) или строй собран
  const card = res.documentName === "ChatMessage" ? res.getFlag(SYSTEM_ID, "card") : null;
  if (res.documentName !== "ChatMessage" && res !== true) return res;
  await spendAction(actor, act, { rolled: !!card?.rolled && !card?.practiced });
  return res;
}

function doAction(actor, act, { skill } = {}) {
  switch (act) {
    case "skill": return TB.skills[skill] ? actor.rollSkill(skill) : null;
    case "lock": return actor.lockOn();
    case "missile": return actor.fireMissile();
    case "guns": return actor.fireGuns();
    case "break": return actor.rollBreak();
    case "recover": return actor.rollRecover();
    case "lead": return leadership(actor);
    case "formup": return formUp(actor);
  }
}

/** Вызов из макроса: game.thunderbolt.act("missile", { actor: uuid }). «end» — конец хода. */
export function actFromMacro(act, { actor: uuid, skill } = {}) {
  if (act !== "end" && act !== "skill" && !ACTIONS[act]) return ui.notifications.warn(`Нет такого действия: ${act}.`);
  const mine = (canvas?.tokens?.controlled ?? []).filter(t => t.actor?.isOwner && ["pilot", "npc"].includes(t.actor.type));
  const actor = (mine.length === 1 ? mine[0].actor : null) ?? resolveActor(uuid) ?? game.user.character;
  if (!actor || !["pilot", "npc"].includes(actor.type)) return ui.notifications.warn("Выделите свой токен или назначьте себе пилота в настройках игрока.");
  if (!actor.isOwner) return ui.notifications.warn(`«${actor.name}» вам не принадлежит: выделите свой токен.`);
  if (act === "end") return endTurn(actor);
  return runAction(actor, act, { skill });
}

export function startActionDrag(ev, actor, act, skill) {
  ev.stopPropagation();
  ev.dataTransfer.setData("text/plain", JSON.stringify({ type: "tb-action", act, skill, actorUuid: actor.uuid, actorName: actor.name }));
}

const iconOf = (act, skill) => `${SYS_PATH}assets/actions/${act === "skill" ? `skill-${skill}` : act}.svg`;

/** Строка чата для макроса действия: /tb lock, /tb skill aim, в конце может быть uuid актёра. */
export const chatCommand = (act, { skill, actor } = {}) => ["/tb", act, act === "skill" ? skill : null, actor].filter(Boolean).join(" ");

/** Разбор /tb …: { act, skill, actor } или null. */
export function parseCommand(text) {
  const m = String(text ?? "").trim().match(/^\/tb\s+(\S+)(.*)$/i);
  if (!m) return null;
  const act = m[1].toLowerCase(), rest = m[2].trim().split(/\s+/).filter(Boolean);
  const skill = act === "skill" ? rest.shift()?.toLowerCase() : undefined;
  return { act, skill, actor: rest[0] };
}

/** Панель макросов игрока: что и в каком порядке встаёт в слоты 1–9. */
export const PILOT_BAR = ["lock", "missile", "guns", "break", "lead", "formup", "recover", "end"];
const BAR_VERSION = 1;
const barName = act => act === "end" ? "Конец хода" : ACTIONS[act];

export function registerMacros() {
  game.settings.register(SYSTEM_ID, "actionBar", {
    name: "Макросы действий у игроков", hint: "Ведущий заводит макросы Lock On!, Fox Two!, пушки, Break!, Leadership, Вплотную, Strain, сваливания и конца хода (папка «Действия пилота») и ставит их игрокам в пустые слоты 1–9 панели внизу. Действуют за выделенный свой токен или за назначенного игроку пилота.",
    scope: "world", config: true, type: Boolean, default: true, onChange: v => v && game.user.isGM && fillHotbars()
  });
  Hooks.on("hotbarDrop", (bar, data, slot) => {
    if (data?.type !== "tb-action") return;
    createActionMacro(data, slot);
    return false;
  });
  // макросы действий — обычные чат-макросы со строкой /tb …: им не нужно право на скриптовые макросы
  Hooks.on("chatMessage", (log, text) => {
    const cmd = parseCommand(text);
    if (!cmd) return;
    Promise.resolve(actFromMacro(cmd.act, { actor: cmd.actor, skill: cmd.skill })).catch(err => console.error(`${SYSTEM_ID} | /tb ${cmd.act}`, err));
    return false;
  });
  Hooks.once("ready", () => {
    let on = true;
    try { on = game.settings.get(SYSTEM_ID, "actionBar"); } catch {}
    if (!on) return;
    // макросы заводит только главный ведущий: два ведущих разом создали бы их дважды
    if (game.user.isGM) { if (game.users.activeGM?.isSelf ?? true) fillHotbars().catch(err => console.warn(`${SYSTEM_ID} | панель макросов`, err)); }
    else fillHotbar(game.user).catch(err => console.warn(`${SYSTEM_ID} | панель макросов`, err));
  });
}

/** Макросы «Действий пилота» в мире (ведущий создаёт недостающие и обновляет старые). Возвращает { act: macro }. */
export async function ensureActionMacros() {
  const found = {};
  for (const m of game.macros) { const act = m.getFlag(SYSTEM_ID, "bar"); if (act && !found[act]) found[act] = m; }
  if (!game.user.isGM) return found;
  let folder = game.folders.find(f => f.type === "Macro" && f.getFlag(SYSTEM_ID, "bar"));
  folder ??= await Folder.create({ name: "Действия пилота", type: "Macro", color: "#0b1d24", flags: { [SYSTEM_ID]: { bar: true } } });
  const create = [], update = [];
  for (const act of PILOT_BAR) {
    const want = { name: barName(act), type: "chat", img: iconOf(act), command: chatCommand(act),
      ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.LIMITED }, folder: folder?.id ?? null };
    const m = found[act];
    if (!m) create.push({ ...want, flags: { [SYSTEM_ID]: { bar: act } } });
    else if (m.command !== want.command || m.img !== want.img || m.type !== want.type) update.push({ _id: m.id, ...want });
  }
  if (update.length) await Macro.updateDocuments(update);
  // действия, убранные из набора (сваливание теперь бросается само): их макросы удаляем, слот на панели освобождается
  const gone = game.macros.filter(m => { const act = m.getFlag(SYSTEM_ID, "bar"); return typeof act === "string" && !PILOT_BAR.includes(act); });
  if (gone.length) { await Macro.deleteDocuments(gone.map(m => m.id)); for (const m of gone) delete found[m.getFlag(SYSTEM_ID, "bar")]; }
  for (const m of create.length ? await Macro.createDocuments(create) : []) found[m.getFlag(SYSTEM_ID, "bar")] = m;
  return found;
}

/** Поставить макросы действий в пустые слоты 1–9 пользователя (один раз на версию набора; force — заново). */
export async function fillHotbar(user, { macros = null, force = false } = {}) {
  if (!user || user.isGM) return 0;
  if (!force && (user.getFlag(SYSTEM_ID, "actionBar") ?? 0) >= BAR_VERSION) return 0;
  if (!user.isSelf && !game.user.isGM) return 0;
  macros ??= await ensureActionMacros();
  const ids = new Set(Object.values(macros).map(m => m.id));
  if (!PILOT_BAR.every(a => macros[a])) return 0;   // макросов ещё нет (ведущий не заходил): попробуем в следующий раз
  const bar = user.hotbar ?? {}, upd = {}, left = [];
  const free = slot => { const cur = bar[slot]; return !cur || !game.macros.get(cur) || (force && ids.has(cur)); };
  const placed = new Set(Object.values(bar));
  PILOT_BAR.forEach((act, i) => {
    const slot = i + 1, m = macros[act];
    if (bar[slot] === m.id) return;
    if (free(slot)) upd[`hotbar.${slot}`] = m.id;
    else if (!placed.has(m.id)) left.push(m.id);   // слот занят своим макросом игрока: действие встанет в первый свободный дальше
  });
  for (let slot = 10; slot <= 50 && left.length; slot++) if (!bar[slot] || !game.macros.get(bar[slot])) upd[`hotbar.${slot}`] = left.shift();
  await user.update({ ...upd, [`flags.${SYSTEM_ID}.actionBar`]: BAR_VERSION });
  return Object.keys(upd).length;
}

/** Ведущий: завести макросы и разложить их всем игрокам. */
export async function fillHotbars({ force = false } = {}) {
  if (!game.user.isGM) return 0;
  const macros = await ensureActionMacros();
  let n = 0;
  for (const u of game.users) if (!u.isGM) n += await fillHotbar(u, { macros, force });
  return n;
}

async function createActionMacro(data, slot) {
  const name = data.act === "skill" ? `Проверка: ${TB.skills[data.skill]?.label ?? data.skill}` : ACTIONS[data.act];
  if (!name) return;
  const command = chatCommand(data.act, { skill: data.skill, actor: data.actorUuid });
  try {
    const macro = game.macros.find(m => m.command === command && m.isOwner)
      ?? await Macro.create({ name, type: "chat", img: iconOf(data.act, data.skill), command, flags: { [SYSTEM_ID]: { act: data.act, actor: data.actorName } } });
    if (macro) await game.user.assignHotbarMacro(macro, slot);
  } catch (err) {
    console.error(err);
    ui.notifications.warn("Не удалось создать макрос: ведущему нужно дать игрокам право создавать макросы.");
  }
}
