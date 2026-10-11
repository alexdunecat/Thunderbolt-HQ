/* Дата кампании: игровая дата для журнала вылетов, разборов полёта, итогов боя и Славы,
   чтобы даты шли по истории кампании, а не по календарю за окном. Пусто: сегодняшняя дата. */
import { SYSTEM_ID } from "./config.mjs";

export function registerCampaignDate() {
  game.settings.register(SYSTEM_ID, "campaignDate", {
    name: "Дата кампании", scope: "world", config: true, type: String, default: "",
    hint: "Игровая дата для журнала вылетов в личных делах, разбора полёта, итогов боя и Славы, например 14.03.2010. Пусто: сегодняшняя дата. Её же можно сменить в панели AWACS и в «Итогах вылета».",
    onChange: () => game.thunderbolt?.refreshAwacs?.()
  });
}

export const todayDate = () => new Date().toLocaleDateString("ru-RU");

/** Записанная дата кампании как есть ("" если не задана). */
export function campaignDateRaw() {
  try { return String(game.settings.get(SYSTEM_ID, "campaignDate") ?? "").trim(); } catch { return ""; }
}

/** Дата для записей: дата кампании или сегодняшняя. */
export const campaignDate = () => campaignDateRaw() || todayDate();

export async function setCampaignDate(v) {
  const d = String(v ?? "").trim().slice(0, 40);
  if (game.user.isGM && d !== campaignDateRaw()) await game.settings.set(SYSTEM_ID, "campaignDate", d);
}
