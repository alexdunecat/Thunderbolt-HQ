/* Действия листа на панели макросов: кнопку действия или кубик навыка можно перетащить на хотбар.
   Макрос действует за выделенный свой токен, а если такого нет, за пилота, с листа которого его перетащили. */
import { SYSTEM_ID, SYS_PATH, TB } from "./config.mjs";
import { resolveActor } from "./utils.mjs";
import { leadership, formUp } from "./squad.mjs";
import { spendAction, allowAction } from "./actions.mjs";
import { practicedReady } from "./dice/rolls.mjs";

/** Действия, которые всегда с броском (Fox Two! с броском решается в окне пуска). */
const ROLLED = new Set(["guns", "break", "recover", "skill"]);

export const ACTIONS = {
  lock: "Lock On!", missile: "Fox Two!", guns: "Guns, Guns, Guns!", break: "Break!",
  recover: "Вернуть Strain", stall: "Сваливание", lead: "Leadership", formup: "Вплотную"
};

/** Выполнить действие листа за актёра. В бою сделанное действие попадает в счётчик хода. */
export async function runAction(actor, act, { skill } = {}) {
  // проверка хода уже была, но «Отточенное мастерство» её не тратит: окно откроется, обычный бросок оно не пустит
  if (act !== "stall" && !allowAction(actor, act, { rolled: ROLLED.has(act) && !practicedReady(actor) })) return;
  const res = await doAction(actor, act, { skill });
  if (act === "stall" || !res) return res;
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
    case "stall": return actor.rollStall();
    case "lead": return leadership(actor);
    case "formup": return formUp(actor);
  }
}

/** Вызов из макроса: game.thunderbolt.act("missile", { actor: uuid }). */
export function actFromMacro(act, { actor: uuid, skill } = {}) {
  const mine = (canvas?.tokens?.controlled ?? []).filter(t => t.actor?.isOwner && ["pilot", "npc"].includes(t.actor.type));
  const actor = (mine.length === 1 ? mine[0].actor : null) ?? resolveActor(uuid) ?? game.user.character;
  if (!actor) return ui.notifications.warn("Выделите свой токен или назначьте себе пилота в настройках игрока.");
  if (!actor.isOwner) return ui.notifications.warn(`«${actor.name}» вам не принадлежит: выделите свой токен.`);
  return runAction(actor, act, { skill });
}

export function startActionDrag(ev, actor, act, skill) {
  ev.stopPropagation();
  ev.dataTransfer.setData("text/plain", JSON.stringify({ type: "tb-action", act, skill, actorUuid: actor.uuid, actorName: actor.name }));
}

const iconOf = (act, skill) => `${SYS_PATH}assets/actions/${act === "skill" ? `skill-${skill}` : act}.svg`;

export function registerMacros() {
  Hooks.on("hotbarDrop", (bar, data, slot) => {
    if (data?.type !== "tb-action") return;
    createActionMacro(data, slot);
    return false;
  });
}

async function createActionMacro(data, slot) {
  const name = data.act === "skill" ? `Проверка: ${TB.skills[data.skill]?.label ?? data.skill}` : ACTIONS[data.act];
  if (!name) return;
  const command = `game.thunderbolt.act(${JSON.stringify(data.act)}, ${JSON.stringify({ actor: data.actorUuid, skill: data.skill })});`;
  try {
    const macro = game.macros.find(m => m.command === command && m.isOwner)
      ?? await Macro.create({ name, type: "script", img: iconOf(data.act, data.skill), command, flags: { [SYSTEM_ID]: { act: data.act, actor: data.actorName } } });
    if (macro) await game.user.assignHotbarMacro(macro, slot);
  } catch (err) {
    console.error(err);
    ui.notifications.warn("Не удалось создать макрос: ведущему нужно дать игрокам право на скриптовые макросы.");
  }
}
