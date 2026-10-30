/* «Винчестер»: у машины кончился боезапас спецоружия. Пилоту игрока об этом говорит AWACS, союзный NPC (ведомый, звено)
   докладывает сам; противник молчит. Стандартные ракеты и пушка бесконечны, поэтому речь только об оружии с Ammo.
   Табло пустой станции в HUD пилота несколько секунд мигает. Говорит главный ведущий, только в идущем бою. */
import { SYSTEM_ID } from "./config.mjs";

const lead = () => !!game.user?.isGM && (game.users?.activeGM?.isSelf ?? true);
const BLINK_MS = 4000;
/** uuid оружия → когда опустело (у каждого клиента свой: по нему мигает HUD). */
const emptiedAt = new Map();
export const justEmptied = (item, now = Date.now()) => now - (emptiedAt.get(item?.uuid) ?? -Infinity) < BLINK_MS;

/** Оружие с конечным боезапасом. */
const limited = i => i?.type === "weapon" && !i.system?.unlimited && i.system?.ammo?.max !== null && i.system?.ammo?.max !== undefined;
const short = name => String(name ?? "").split(" · ")[0];
const hash = s => [...String(s)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
const pick = (list, key) => list[hash(key) % list.length];

/**
 * Кто и что говорит, когда у машины опустело оружие weapon. rest — имена оружия с Ammo, где ещё что-то осталось.
 * who: { type: "pilot" | "npc", side, callsign, name }. Возвращает { speaker, text, side } или null (противнику не говорят).
 */
export function winchesterCall(who, weapon, rest = [], key = "") {
  const w = short(weapon);
  if (who?.type === "pilot") {
    const cs = who.callsign || who.name;
    const text = rest.length
      ? pick([`«${cs}», ${w}: боезапас пуст. Остаётся ${rest.map(short).join(", ")}.`, `«${cs}», у вас кончились ${w}. Переходите на ${rest.map(short).join(", ")}.`], key)
      : pick([`«${cs}», Винчестер по спецоружию. Работайте ракетами и пушкой.`, `«${cs}», у вас Винчестер: ${w} был последним. Дальше только ракеты и пушка.`], key);
    return { speaker: "AWACS", text, side: "ally" };
  }
  if (who?.type === "npc" && ["ally", "player"].includes(who.side)) {
    const text = rest.length
      ? pick([`${w} пусто, перехожу на ${rest.map(short).join(", ")}.`, `Израсходовал ${w}. Остались ${rest.map(short).join(", ")}.`], key)
      : pick([`Винчестер! ${w} кончились, работаю ракетами.`, `Винчестер, спецоружия больше нет. Прикрою, как смогу.`], key);
    return { speaker: who.name, text, side: "ally" };
  }
  return null;
}

async function onEmpty(item) {
  const actor = item.parent;
  if (!lead() || !game.combat?.started || !actor) return;
  const rest = actor.items.filter(i => limited(i) && i.id !== item.id && (i.system.ammo.value ?? 0) > 0).map(i => i.name);
  const who = { type: actor.type, side: actor.system?.side, callsign: actor.system?.callsign, name: actor.token?.name ?? actor.prototypeToken?.name ?? actor.name };
  const call = winchesterCall(who, item.name, rest, `${actor.uuid}:${item.id}:${game.combat.round}`);
  if (!call) return;
  const { sendRadio } = await import("./radio.mjs");
  await sendRadio(call);
}

export function registerWinchester() {
  Hooks.on("updateItem", (item, change, options) => {
    if (options?.tbUndo || !limited(item)) return;
    const v = foundry.utils.getProperty(change, "system.ammo.value");
    if (v === undefined || Number(v) > 0) return;
    emptiedAt.set(item.uuid, Date.now());
    onEmpty(item).catch(err => console.error(`${SYSTEM_ID} | винчестер`, err));
  });
}
