/* Thunderbolt: Штаб ВВС Юктобании — точка входа системы. */
import { SYSTEM_ID, TB } from "./config.mjs";
import { PilotData, NpcData, PlaneData, WeaponData, TriggerData } from "./data/models.mjs";
import { TBActor, TBItem } from "./documents/actor.mjs";
import { TBCombat } from "./documents/combat.mjs";
import { PilotSheet, NpcSheet } from "./sheets/actor-sheets.mjs";
import { TBItemSheet } from "./sheets/item-sheet.mjs";
import * as R from "./dice/rolls.mjs";
import { openImportDialog, importMission } from "./apps/mission-import.mjs";
import { TBMemoSheet } from "./apps/memo-sheet.mjs";

function applySkin(skin) {
  document.body.dataset.tbSkin = TB.skins[skin] ? skin : "shtab";
  for (const app of Object.values(ui.windows)) if (app.options?.classes?.includes("thunderbolt")) app.render(false);
}

Hooks.once("init", () => {
  console.log(`${SYSTEM_ID} | init`);
  CONFIG.TB = TB;
  CONFIG.Actor.documentClass = TBActor;
  CONFIG.Item.documentClass = TBItem;
  CONFIG.Combat.documentClass = TBCombat;
  Object.assign(CONFIG.Actor.dataModels, { pilot: PilotData, npc: NpcData });
  Object.assign(CONFIG.Item.dataModels, { plane: PlaneData, weapon: WeaponData, trigger: TriggerData });
  CONFIG.Combat.initiative = { formula: "2", decimals: 0 };
  CONFIG.Actor.trackableAttributes = {
    pilot: { bar: ["hp", "strain"], value: ["speed"] },
    npc: { bar: ["hp", "strain"], value: ["speed"] }
  };

  Actors.unregisterSheet("core", ActorSheet);
  Actors.registerSheet(SYSTEM_ID, PilotSheet, { types: ["pilot"], makeDefault: true, label: "Лист пилота" });
  Actors.registerSheet(SYSTEM_ID, NpcSheet, { types: ["npc"], makeDefault: true, label: "Лист NPC" });
  Items.unregisterSheet("core", ItemSheet);
  Items.registerSheet(SYSTEM_ID, TBItemSheet, { makeDefault: true, label: "Карточка" });
  DocumentSheetConfig.registerSheet(JournalEntry, SYSTEM_ID, TBMemoSheet, { makeDefault: false, label: "Памятка пилота (оформление Штаба)" });

  game.settings.register(SYSTEM_ID, "skin", {
    name: "TB.SkinName", hint: "TB.SkinHint", scope: "client", config: true, type: String,
    choices: TB.skins, default: "shtab", onChange: applySkin
  });

  game.thunderbolt = { importMission, openImportDialog, rolls: R, TB };
});

Hooks.once("ready", () => {
  applySkin(game.settings.get(SYSTEM_ID, "skin"));
  // пилоты, созданные до автоматики триггеров: подтянуть HP и Strain к новым максимумам
  if (game.user.isGM) for (const a of game.actors) if (a.type === "pilot") a.syncPools();
});

/* Триггер или самолёт добавлен, изменён, убран: максимумы пересчитаны, текущие HP и Strain сдвигаются следом. */
for (const ev of ["createItem", "updateItem", "deleteItem"]) Hooks.on(ev, (item, ...args) => {
  const userId = args.at(-1);
  if (userId === game.user.id && item.parent?.type === "pilot") item.parent.syncPools();
});

Hooks.on("renderChatMessage", (message, html) => R.decorateCard(message, html));

/* Высота: поле листа и высота токена (1 = Low, 2 = Medium, 3 = High) держатся вместе. */
Hooks.on("updateToken", (token, change, options, userId) => {
  if (userId !== game.user.id || !("elevation" in change) || !token.actor) return;
  const alt = Object.entries(TB.altElevation).find(([, v]) => v === change.elevation)?.[0];
  if (alt && token.actor.system.alt !== alt) token.actor.update({ "system.alt": alt });
});

Hooks.on("updateActor", async (actor, change, options, userId) => {
  if (userId !== game.user.id) return;
  const has = p => foundry.utils.hasProperty(change, p);
  if (has("system.alt")) actor.syncElevation();
  if (actor.type === "pilot" && (has("system.twist") || has("system.markers"))) actor.syncPools();

  // сваливание: Speed ≤ 0 у летящей машины
  if (has("system.speed") && actor.system.speed <= 0) {
    const flying = actor.type === "pilot" || actor.system.kind === "air";
    const hover = actor.system.planeProps?.has?.("vtol") || actor.system.props?.some?.(p => p.key === "vtol" || p.key === "hover");
    if (flying && !hover) R.rollStall(actor);
  }

  // архетип выбран: добавить его Core-триггер из компендиума
  if (actor.type === "pilot" && has("system.archetype")) {
    const core = TB.archetypes[actor.system.archetype]?.core;
    if (!core || actor.items.some(i => i.type === "trigger" && i.system.key === core)) return;
    const pack = game.packs.get(`${SYSTEM_ID}.triggers`);
    const idx = await pack?.getIndex({ fields: ["system.key"] });
    const entry = idx?.find(e => e.system?.key === core);
    if (!entry) return;
    const doc = await pack.getDocument(entry._id);
    await actor.createEmbeddedDocuments("Item", [doc.toObject()]);
    ui.notifications.info(`Добавлен Core-триггер «${doc.name}».`);
  }
});

/* Кнопка импорта миссии в разделе «Сцены». */
Hooks.on("renderSceneDirectory", (app, html) => {
  if (!game.user.isGM) return;
  const root = html[0] ?? html;
  const bar = root.querySelector(".header-actions");
  if (!bar || bar.querySelector(".tb-import")) return;
  const b = document.createElement("button");
  b.type = "button";
  b.className = "tb-import";
  b.innerHTML = `<i class="fas fa-satellite-dish"></i> ${game.i18n.localize("TB.ImportMission")}`;
  b.addEventListener("click", openImportDialog);
  bar.append(b);
});
