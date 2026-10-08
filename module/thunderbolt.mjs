/* Thunderbolt: Штаб ВВС Юктобании — точка входа системы. */
import { SYSTEM_ID, TB } from "./config.mjs";
import { PilotData, NpcData, PlaneData, WeaponData, TriggerData } from "./data/models.mjs";
import { TBActor, TBItem } from "./documents/actor.mjs";
import { TBCombat, registerCombat } from "./documents/combat.mjs";
import { registerActions } from "./actions.mjs";
import { PilotSheet, NpcSheet } from "./sheets/actor-sheets.mjs";
import { TBItemSheet } from "./sheets/item-sheet.mjs";
import * as R from "./dice/rolls.mjs";
import { openImportDialog, importMission } from "./apps/mission-import.mjs";
import { TBMemoSheet } from "./apps/memo-sheet.mjs";
import { openAwacs, refreshAwacs, sortieResults } from "./apps/awacs-panel.mjs";
import { tokenOf, zoneDistance } from "./scene.mjs";
import { esc } from "./utils.mjs";
import { initSocket, checkAdjacency, leadership, formUp } from "./squad.mjs";
import { registerTokenSettings, arrangeSceneTokens } from "./tokens.mjs";
import { registerSquadronSettings, squadFromSelection } from "./squadrons.mjs";
import { registerMacros, actFromMacro } from "./macros.mjs";
import { registerRwr } from "./rwr.mjs";
import { registerInsignia } from "./insignia.mjs";
import { registerLosses } from "./losses.mjs";
import { registerAltitude, stepAltitude } from "./altitude.mjs";

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
  registerTokenSettings();
  registerSquadronSettings();
  registerMacros();
  registerRwr();
  registerAltitude();
  registerInsignia();
  registerLosses();
  registerCombat();
  registerActions();

  game.thunderbolt = { importMission, openImportDialog, openAwacs, sortieResults, leadership, formUp, arrangeSceneTokens,
    squadFromSelection, act: actFromMacro, stepAltitude, rolls: R, TB };
});

Hooks.once("ready", () => {
  applySkin(game.settings.get(SYSTEM_ID, "skin"));
  // пилоты, созданные до автоматики триггеров: подтянуть HP и Strain к новым максимумам
  initSocket();
  R.initHitSocket();
  // «В строю» читает союзника: после загрузки всех актёров пересчитать тех, кто стоит вплотную
  for (const a of game.actors) if (a.type === "pilot" && a.getFlag(SYSTEM_ID, "adjacent")?.length) { a.prepareData(); a.sheet?.rendered && a.sheet.render(false); }
  if (game.user.isGM) for (const a of game.actors) if (a.type === "pilot") a.syncPools();
});

/* Триггер или самолёт добавлен, изменён, убран: максимумы пересчитаны, текущие HP и Strain сдвигаются следом. */
for (const ev of ["createItem", "updateItem", "deleteItem"]) Hooks.on(ev, (item, ...args) => {
  const userId = args.at(-1);
  if (userId === game.user.id && item.parent?.type === "pilot") item.parent.syncPools();
});

Hooks.on("renderChatMessage", (message, html) => R.decorateCard(message, html));
// залп попал в самолёт игрока: урон наносит его клиент (выбор метки открывается у него)
Hooks.on("createChatMessage", message => R.onVolleyCreated(message));

/* Высота: поле листа и высота токена (1 = Low, 2 = Medium, 3 = High) держатся вместе. */
Hooks.on("updateToken", (token, change, options, userId) => {
  const moved = "x" in change || "y" in change || "elevation" in change;
  if (moved && token.actor?.sheet?.rendered) token.actor.sheet.render(false);   // погода и защита в новой клетке
  if (moved && game.users.activeGM?.isSelf) setTimeout(() => { checkLocks(token.parent); checkAdjacency(); }, 50);
  if (userId !== game.user.id || !("elevation" in change) || !token.actor) return;
  const alt = Object.entries(TB.altElevation).find(([, v]) => v === change.elevation)?.[0];
  if (alt && token.actor.system.alt !== alt) token.actor.update({ "system.alt": alt }, { tbSync: true });
});

/** Захват срывается, если цель ушла дальше двух зон (кроме дальнобойного спецоружия). */
async function checkLocks(scene) {
  if (!canvas?.ready || scene !== canvas.scene) return;
  for (const tok of canvas.tokens.placeables) {
    const a = tok.actor, uuid = a?.system.lockUuid;
    if (!uuid) continue;
    const target = R.resolveActor(uuid);
    const far = a.items.some(i => i.type === "weapon" && i.system.reach >= TB.range.operation && (i.system.unlimited || i.system.ammo.value > 0));
    const dist = zoneDistance(tok, tokenOf(target));
    if (far || dist === null || dist <= TB.range.lockHold) continue;
    await a.update({ "system.lock": "", "system.lockUuid": "" });
    await ChatMessage.create({
      speaker: { alias: "AWACS" },
      content: `<div class="tb-card tb-card-lock"><div class="tb-note"><b>${esc(a.name)}</b>: захват «${esc(target?.name ?? "цель")}» сорван, цель в ${dist} зонах.</div></div>`
    });
  }
}

/* Панель AWACS: кнопка на панели токенов и в разделе «Актёры» (только ведущему). */
Hooks.on("getSceneControlButtons", controls => {
  if (!game.user.isGM) return;
  const tokens = controls.find(c => c.name === "token");
  tokens?.tools.push({ name: "tb-awacs", title: "Панель AWACS", icon: "fas fa-satellite-dish", button: true, onClick: () => openAwacs() });
});
Hooks.on("renderActorDirectory", (app, html) => {
  if (!game.user.isGM) return;
  const root = html[0] ?? html;
  const bar = root.querySelector(".header-actions");
  if (!bar || bar.querySelector(".tb-awacs-open")) return;
  const b = document.createElement("button");
  b.type = "button";
  b.className = "tb-awacs-open";
  b.innerHTML = `<i class="fas fa-satellite-dish"></i> Панель AWACS`;
  b.addEventListener("click", openAwacs);
  bar.append(b);
});
for (const ev of ["updateActor", "createItem", "updateItem", "deleteItem", "createToken", "updateToken", "deleteToken",
  "updateScene", "canvasReady", "updateCombat", "deleteCombat", "createChatMessage", "updateChatMessage", `${SYSTEM_ID}.squadrons`]) Hooks.on(ev, () => refreshAwacs());

/* Прежний архетип нужен после обновления, чтобы убрать его Core-триггер. */
Hooks.on("preUpdateActor", (actor, change, options) => {
  if (actor.type === "pilot" && foundry.utils.hasProperty(change, "system.archetype")) options.tbOldArchetype = actor.system.archetype;
});

/* Сторона NPC меняет и сторону его токенов (цвет рамки Foundry), чтобы сцена и система не расходились. */
const SIDE_DISPOSITION = { enemy: -1, neutral: 0, ally: 1 };
Hooks.on("updateActor", (actor, change, options, userId) => {
  const side = foundry.utils.getProperty(change, "system.side");
  if (userId !== game.user.id || actor.type !== "npc" || !(side in SIDE_DISPOSITION)) return;
  const disposition = SIDE_DISPOSITION[side];
  if (actor.isToken) return actor.token.update({ disposition });
  actor.update({ "prototypeToken.disposition": disposition });
  for (const t of actor.getActiveTokens(true, true)) if (t.disposition !== disposition) t.update({ disposition });
});

Hooks.on("updateActor", async (actor, change, options, userId) => {
  const has = p => foundry.utils.hasProperty(change, p);
  // сваливание: Speed ≤ 0 у летящей машины. Бросает тот, кого назвал конец раунда (владелец пилота), иначе кто менял
  if (has("system.speed") && actor.system.speed <= 0 && (options.tbStallBy ?? userId) === game.user.id) {
    const flying = actor.type === "pilot" || actor.system.kind === "air";
    const hover = actor.system.planeProps?.has?.("vtol") || actor.system.props?.some?.(p => p.key === "vtol" || p.key === "hover");
    if (flying && !hover) R.rollStall(actor);
  }
  if (userId !== game.user.id) return;
  if (has("system.alt")) actor.syncElevation();
  if (actor.type === "pilot" && (has("system.twist") || has("system.markers"))) actor.syncPools();

  // архетип сменился: убрать Core-триггер прежнего архетипа и добавить Core нового из компендиума
  if (actor.type === "pilot" && has("system.archetype")) {
    const oldCore = TB.archetypes[options.tbOldArchetype]?.core;
    const core = TB.archetypes[actor.system.archetype]?.core;
    if (oldCore && oldCore !== core) {
      const stale = actor.items.filter(i => i.type === "trigger" && i.system.key === oldCore).map(i => i.id);
      if (stale.length) {
        await actor.deleteEmbeddedDocuments("Item", stale);
        ui.notifications.info(`Убран Core-триггер прежнего архетипа.`);
      }
    }
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
