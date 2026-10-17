/* Thunderbolt: Штаб ВВС Юктобании — точка входа системы. */
import "./delta-bridge.mjs";
import { SYSTEM_ID, SYS_PATH, TB } from "./config.mjs";
import { PilotData, NpcData, StaffData, PlaneData, WeaponData, TriggerData } from "./data/models.mjs";
import { TBActor, TBItem, migratePortraits } from "./documents/actor.mjs";
import { TBCombat, registerCombat } from "./documents/combat.mjs";
import { registerActions } from "./actions.mjs";
import { PilotSheet, NpcSheet, StaffSheet, fateOfActor } from "./sheets/actor-sheets.mjs";
import { TBItemSheet } from "./sheets/item-sheet.mjs";
import * as R from "./dice/rolls.mjs";
import { openImportDialog, importMission } from "./apps/mission-import.mjs";
import { TBMemoSheet } from "./apps/memo-sheet.mjs";
import { openAwacs, refreshAwacs, sortieResults } from "./apps/awacs-panel.mjs";
import { registerGlory, gloryDialog } from "./glory.mjs";
import { registerCampaignDate } from "./campaign-date.mjs";
import { registerStealth } from "./stealth.mjs";
import { registerTunnel } from "./tunnel.mjs";
import { tokenOf, zoneDistance } from "./scene.mjs";
import { esc } from "./utils.mjs";
import { initSocket, checkAdjacency, leadership, formUp } from "./squad.mjs";
import { registerTokenSettings, arrangeSceneTokens } from "./tokens.mjs";
import { registerSquadronSettings, squadFromSelection } from "./squadrons.mjs";
import { registerMacros, actFromMacro, fillHotbars } from "./macros.mjs";
import { registerRwr } from "./rwr.mjs";
import { registerRadio, sendRadio, say, caution, openRadioDialog } from "./radio.mjs";
import { registerRange } from "./range.mjs";
import * as Downtime from "./downtime.mjs";
import { openRadioLog } from "./radio-log.mjs";
import { registerChatter, openChatterEditor } from "./chatter.mjs";
import { registerMission, openMissionDialog } from "./mission.mjs";
import { registerSounds, cue } from "./sounds.mjs";
import { registerAces, openAceIntro, announceAces } from "./aces.mjs";
import { registerPause } from "./pause.mjs";
import { registerBoot, openBootDialog, startBoot, playBoot, stopBoot } from "./boot.mjs";
import { registerBriefing, openBriefing, startBriefing, stopBriefing, bootThenBriefing } from "./briefing.mjs";
import { registerOpCode } from "./opcode.mjs";
import { applyCanvasStyle, patchTargetReticle } from "./canvas-style.mjs";
import { openDossierExchange, importDossier, exportDossier } from "./dossier-sync.mjs";
import { registerMapInfo } from "./mapinfo.mjs";
import { registerRotate } from "./rotate.mjs";
import { registerInsignia } from "./insignia.mjs";
import { registerSideColor } from "./sidecolor.mjs";
import { registerLosses } from "./losses.mjs";
import { registerAltitude, stepAltitude } from "./altitude.mjs";
import { registerPopout, mirrorPopouts } from "./popout.mjs";

// триггер выключен или машина сменилась: Max Speed мог упасть
for (const ev of ["updateItem", "createItem", "deleteItem"])
  Hooks.on(ev, (item, ...rest) => { if (rest[rest.length - 1] === game.user.id && item.parent) clampSpeed(item.parent); });

/** Speed не выше Max Speed: после спуска из стратосферы, выключения «Снять ограничитель», смены машины. */
function clampSpeed(actor) {
  if (!actor?.isOwner || !["pilot", "npc"].includes(actor.type)) return;
  const max = actor.system.maxSpeed;
  if (max > 0 && (actor.system.speed ?? 0) > max) actor.update({ "system.speed": max }, { tbFree: true });
}

/** Оформление одно — «Брифинг» (с 0.5.31 другие темы убраны). */
function applySkin() {
  document.body.dataset.tbSkin = "brief";
  applyDarkUi();
  for (const app of Object.values(ui.windows)) if (app.options?.classes?.includes("thunderbolt")) app.render(false);
}

/** Тёмные окна Foundry: стандартные окна тоже в тёмных цветах «Брифинга», если клиент не выключил. */
function applyDarkUi() {
  let on = true;
  try { on = game.settings.get(SYSTEM_ID, "darkUi"); } catch {}
  document.body.classList?.toggle("tb-dark-ui", on);
  let hud = true;
  try { hud = game.settings.get(SYSTEM_ID, "briefUi"); } catch {}
  const brief = hud && document.body.dataset.tbSkin === "brief";
  document.body.classList?.toggle("tb-brief-ui", brief);
  // подписи, рамки и прицел на холсте: при переключении холст перерисовывается
  if (applyCanvasStyle(brief) && globalThis.canvas?.ready) canvas.draw();
  mirrorPopouts();
}

// надписи карты рисуются шрифтами «Брифинга»: дождаться их до отрисовки сцены
Hooks.once("setup", () => {
  for (const f of ['16px "Jura"', '16px "JetBrains Mono"']) document.fonts?.load(f, "АБВ abc 123").catch(() => null);
  // стиль холста ставится до первой отрисовки сцены (сам интерфейс — на ready, в applySkin)
  document.body.dataset.tbSkin = "brief";
  let hud = true;
  try { hud = game.settings.get(SYSTEM_ID, "briefUi"); } catch {}
  applyCanvasStyle(hud);
  patchTargetReticle();
});

Hooks.once("init", () => {
  console.log(`${SYSTEM_ID} | init`);
  CONFIG.TB = TB;
  CONFIG.Actor.documentClass = TBActor;
  CONFIG.Item.documentClass = TBItem;
  CONFIG.Combat.documentClass = TBCombat;
  Object.assign(CONFIG.Actor.dataModels, { pilot: PilotData, npc: NpcData, staff: StaffData });
  Object.assign(CONFIG.Item.dataModels, { plane: PlaneData, weapon: WeaponData, trigger: TriggerData });
  CONFIG.Combat.initiative = { formula: "2", decimals: 0 };
  CONFIG.Actor.trackableAttributes = {
    pilot: { bar: ["hp", "strain"], value: ["speed"] },
    npc: { bar: ["hp", "strain"], value: ["speed"] },
    staff: { bar: [], value: [] }
  };

  Actors.unregisterSheet("core", ActorSheet);
  Actors.registerSheet(SYSTEM_ID, PilotSheet, { types: ["pilot"], makeDefault: true, label: "Лист пилота" });
  Actors.registerSheet(SYSTEM_ID, NpcSheet, { types: ["npc"], makeDefault: true, label: "Лист NPC" });
  Actors.registerSheet(SYSTEM_ID, StaffSheet, { types: ["staff"], makeDefault: true, label: "Лист персонажа на земле" });
  // общие куски листов: картинки, личное дело, Связи и цели
  loadTemplates(["images", "biography", "ties"].map(n => `${SYS_PATH}templates/actor/parts/${n}.hbs`));
  Items.unregisterSheet("core", ItemSheet);
  Items.registerSheet(SYSTEM_ID, TBItemSheet, { makeDefault: true, label: "Карточка" });
  DocumentSheetConfig.registerSheet(JournalEntry, SYSTEM_ID, TBMemoSheet, { makeDefault: false, label: "Памятка пилота (оформление Штаба)" });

  game.settings.register(SYSTEM_ID, "darkUi", {
    name: "Тёмные окна Foundry", hint: "Стандартные окна Foundry (настройки, журналы, диалоги других модулей) тоже тёмные, а не на светлом пергаменте.",
    scope: "client", config: true, type: Boolean, default: true, onChange: () => applyDarkUi()
  });
  game.settings.register(SYSTEM_ID, "briefUi", {
    name: "Интерфейс Foundry в стиле «Брифинга»", hint: "Инструменты сцены, игроки, панель макросов, боковая панель, навигация сцен, заголовки окон, подсказки, меню и уведомления Foundry тоже в его цветах и шрифтах, а вместо наковальни — эмблема.",
    scope: "client", config: true, type: Boolean, default: true, onChange: () => applyDarkUi()
  });
  // шрифты «Брифинга» лежат в системе (assets/fonts): их видят и надписи на карте
  Object.assign(CONFIG.fontDefinitions, { "Jura": { editor: true, fonts: [] }, "JetBrains Mono": { editor: true, fonts: [] } });
  registerTokenSettings();
  registerSquadronSettings();
  registerMacros();
  registerRwr();
  registerRadio();
  registerChatter();
  registerMission();
  registerSounds();
  registerAces();
  registerPause();
  registerBoot();
  registerBriefing();
  registerOpCode();
  registerRange();
  Downtime.registerDowntime();
  registerGlory();
  registerCampaignDate();
  registerStealth();
  registerTunnel();
  registerPopout();
  registerMapInfo();
  registerRotate();
  registerAltitude();
  registerInsignia();
  registerSideColor();
  registerLosses();
  registerCombat();
  registerActions();

  game.thunderbolt = { gloryDialog, importMission, openImportDialog, openAwacs, sortieResults, leadership, formUp, arrangeSceneTokens,
    squadFromSelection, act: actFromMacro, fillHotbars, stepAltitude, rolls: R, TB, sound: cue, radio: { send: sendRadio, say, caution, log: openRadioLog, replies: openChatterEditor, mission: openMissionDialog, aces: openAceIntro, announceAces }, dossier: { open: openDossierExchange, importDossier, exportDossier },
    refreshAwacs, boot: { open: openBootDialog, start: startBoot, play: playBoot, stop: stopBoot },
    briefing: { open: openBriefing, start: startBriefing, stop: stopBriefing, afterBoot: bootThenBriefing }, downtime: { ground: Downtime.rollGround, baseEvent: Downtime.baseEvent, threats: Downtime.threats, addThreat: Downtime.addThreat, stepThreat: Downtime.stepThreat } };
});

Hooks.once("ready", async () => {
  applySkin();
  // пилоты, созданные до автоматики триггеров: подтянуть HP и Strain к новым максимумам
  initSocket();
  R.initHitSocket();
  // «В строю» читает союзника: после загрузки всех актёров пересчитать тех, кто стоит вплотную
  for (const a of game.actors) if (a.type === "pilot" && a.getFlag(SYSTEM_ID, "adjacent")?.length) { a.prepareData(); a.sheet?.rendered && a.sheet.render(false); }
  // пишет один клиент: активный ведущий (при двух ведущих в сети они не дублируют правки)
  const lead = game.users.activeGM?.isSelf;
  if (lead) for (const a of game.actors) if (a.type === "pilot") a.syncPools();
  // серые силуэты Foundry у старых актёров — на портреты системы
  if (lead) migratePortraits().catch(err => console.warn(`${SYSTEM_ID} | портреты`, err));
});

/* Триггер или самолёт добавлен, изменён, убран: максимумы пересчитаны, текущие HP и Strain сдвигаются следом. */
for (const ev of ["createItem", "updateItem", "deleteItem"]) Hooks.on(ev, (item, ...args) => {
  const userId = args.at(-1);
  if (userId === game.user.id && item.parent?.type === "pilot") item.parent.syncPools();
});

Hooks.on("renderChatMessage", (message, html) => R.decorateCard(message, html));
// залп попал в самолёт игрока: урон наносит его клиент (выбор метки открывается у него)
Hooks.on("createChatMessage", message => R.onVolleyCreated(message));

/* Высота: поле листа и высота токена (1 = Низкая, 2 = Средняя, 3 = Высокая) держатся вместе. */
let moveTimer = null, locking = false, lockAgain = false;
Hooks.on("updateToken", (token, change, options, userId) => {
  const moved = "x" in change || "y" in change || "elevation" in change;
  if (moved && token.actor?.sheet?.rendered) token.actor.sheet.render(false);   // погода и защита в новой клетке
  if (moved && game.users.activeGM?.isSelf) {
    // группу токенов двигают одним действием: проверяем один раз после всех перемещений
    clearTimeout(moveTimer);
    moveTimer = setTimeout(() => { checkLocks(token.parent); checkAdjacency(); }, 80);
  }
  if (userId !== game.user.id || !("elevation" in change) || !["pilot", "npc"].includes(token.actor?.type)) return;
  const alt = Object.entries(TB.altElevation).find(([, v]) => v === change.elevation)?.[0];
  if (alt && token.actor.system.alt !== alt) token.actor.update({ "system.alt": alt }, { tbSync: true });
});

/** Захват срывается, если цель ушла дальше двух зон (кроме дальнобойного спецоружия). */
async function checkLocks(scene) {
  if (!canvas?.ready || scene !== canvas.scene) return;
  // проверка уже идёт: повторить её после, чтобы не потерять ход, сделанный за это время
  if (locking) { lockAgain = true; return; }
  locking = true;
  try { do { lockAgain = false; await breakLocks(); } while (lockAgain); }
  catch (err) { console.error(`${SYSTEM_ID} | срыв захвата`, err); }
  finally { locking = false; }
}
async function breakLocks() {
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
  const tokens = controls.find(c => c.name === "token");
  tokens?.tools.push({ name: "tb-radio-log", title: "Радиожурнал: AWACS и переговоры", icon: "fas fa-book-open", button: true, onClick: () => openRadioLog() });
  if (!game.user.isGM) return;
  tokens?.tools.push({ name: "tb-radio", title: "Радио AWACS: реплика всем", icon: "fas fa-tower-broadcast", button: true, onClick: () => openRadioDialog() });
  tokens?.tools.push({ name: "tb-chatter", title: "Реплики NPC: фразы союзников, противника и гражданских", icon: "fas fa-comments", button: true, onClick: () => openChatterEditor() });
  tokens?.tools.push({ name: "tb-awacs", title: "Панель AWACS", icon: "fas fa-satellite-dish", button: true, onClick: () => openAwacs() });
  tokens?.tools.push({ name: "tb-boot", title: "Заставка АСУ «Тайга» перед брифингом: у всех на экране", icon: "fas fa-terminal", button: true, onClick: () => openBootDialog() });
  tokens?.tools.push({ name: "tb-briefing", title: "Брифинг миссии: карта, этапы и субтитры у всех на экране", icon: "fas fa-map", button: true, onClick: () => openBriefing() });
});
Hooks.on("renderActorDirectory", (app, html) => {
  const root = html[0] ?? html;
  markFallen(root);
  const bar = root.querySelector(".header-actions");
  if (bar && !bar.querySelector(".tb-shtab-sync")) {
    const s = document.createElement("button");
    s.type = "button";
    s.className = "tb-shtab-sync";
    s.title = "Перенести личные дела пилотов из Штаба и обратно кодом";
    s.innerHTML = `<i class="fas fa-id-card"></i> Пилоты из Штаба`;
    s.addEventListener("click", () => openDossierExchange());
    bar.append(s);
  }
  if (!game.user.isGM) return;
  if (!bar || bar.querySelector(".tb-awacs-open")) return;
  const b = document.createElement("button");
  b.type = "button";
  b.className = "tb-awacs-open";
  b.innerHTML = `<i class="fas fa-satellite-dish"></i> Панель AWACS`;
  b.addEventListener("click", openAwacs);
  bar.append(b);
});
/** Список «Актёры»: погибшие и пропавшие (в том числе в плену) с той же строкой K.I.A. / M.I.A. на миниатюре, что и на листе. */
function markFallen(root) {
  for (const li of root.querySelectorAll(".directory-item.document, .directory-item[data-document-id], .directory-item[data-entry-id]")) {
    const id = li.dataset.documentId ?? li.dataset.entryId ?? li.dataset.uuid?.split(".").pop();
    if (!id) continue;
    const fate = fateOfActor(game.actors.get(id));
    li.classList.remove("tb-fate-kia", "tb-fate-mia");
    li.querySelector(".tb-fate-thumb .tb-fate-tag")?.remove();
    if (!fate) continue;
    li.classList.add(`tb-fate-${fate.key}`);
    let wrap = li.querySelector(".tb-fate-thumb");
    const img = wrap?.querySelector("img.thumbnail") ?? li.querySelector("img.thumbnail");
    if (!img) continue;
    if (!wrap) {
      const cs = getComputedStyle(img), size = parseFloat(cs.height) || parseFloat(cs.flexBasis) || 0;
      wrap = document.createElement("span");
      wrap.className = "tb-fate-thumb";
      wrap.style.width = wrap.style.height = size ? `${size}px` : "var(--sidebar-item-height, 48px)";
      wrap.style.margin = cs.margin;
      img.replaceWith(wrap);
      wrap.append(img);
      Object.assign(img.style, { width: "100%", height: "100%", margin: "0" });
    }
    const tag = document.createElement("span");
    tag.className = "tb-fate-tag";
    tag.textContent = fate.label;
    wrap.append(tag);
  }
}

// состояние сменилось: список «Актёры» может и не перерисоваться, метки ставлю сразу
Hooks.on("updateActor", (actor, change) => {
  if (!foundry.utils.hasProperty(change, "system.service.status") && !foundry.utils.hasProperty(change, "system.status")) return;
  for (const el of [ui.actors?.element, ...Object.values(ui.windows).filter(w => globalThis.ActorDirectory && w instanceof ActorDirectory).map(w => w.element)]) {
    const root = el?.[0] ?? el;
    if (root?.querySelectorAll) markFallen(root);
  }
});

for (const ev of ["updateActor", "updateActorDelta", "createItem", "updateItem", "deleteItem", "createToken", "updateToken", "deleteToken",
  "updateScene", "canvasReady", "updateCombat", "deleteCombat", "createChatMessage", "updateChatMessage", `${SYSTEM_ID}.squadrons`]) Hooks.on(ev, () => refreshAwacs());

/* Прежний архетип нужен после обновления, чтобы убрать его Core-триггер. */
Hooks.on("preUpdateActor", (actor, change, options) => {
  if (actor.type === "pilot" && foundry.utils.hasProperty(change, "system.archetype")) options.tbOldArchetype = actor.system.archetype;
});

/* Сторона NPC меняет и сторону его токенов (цвет рамки Foundry), чтобы сцена и система не расходились.
   Правка листа токена доходит сюда через мост delta-bridge.mjs, а правка актёра из «Актёров»
   должна дойти и до уже стоящих несвязанных токенов (getActiveTokens(true) их не возвращает). */
const SIDE_DISPOSITION = { enemy: -1, neutral: 0, ally: 1 };
function sideToTokens(actor, side) {
  const disposition = SIDE_DISPOSITION[side];
  if (actor.isToken) return actor.token.disposition !== disposition && actor.token.update({ disposition });
  if (actor.prototypeToken.disposition !== disposition) actor.update({ "prototypeToken.disposition": disposition });
  // токены на всех сценах, не только на открытой: заготовленная сцена тоже должна сойтись
  for (const scene of game.scenes) for (const t of scene.tokens)
    if (t.actorId === actor.id && t.actor?.system.side === side && t.disposition !== disposition) t.update({ disposition });
}
Hooks.on("updateActor", (actor, change, options, userId) => {
  const side = foundry.utils.getProperty(change, "system.side");
  if (userId !== game.user.id || actor.type !== "npc" || !(side in SIDE_DISPOSITION)) return;
  sideToTokens(actor, side);
});

async function onActorUpdate(actor, change, options, userId) {
  const has = p => foundry.utils.hasProperty(change, p);
  // сваливание: Speed ≤ 0 у летящей машины. Бросает тот, кого назвал конец раунда (владелец пилота), иначе кто менял
  if (has("system.speed") && actor.system.speed <= 0 && (options.tbStallBy ?? userId) === game.user.id) {
    const flying = actor.type === "pilot" || actor.system.kind === "air";
    const hover = actor.system.planeProps?.has?.("vtol") || actor.system.props?.some?.(p => p.key === "vtol" || p.key === "hover");
    if (flying && !hover) R.rollStall(actor);
  }
  if (userId !== game.user.id) return;
  if (has("system.alt")) {
    actor.syncElevation();
  }
  if (actor.type === "pilot" && (has("system.twist") || has("system.markers"))) actor.syncPools();
  clampSpeed(actor);

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
}
Hooks.on("updateActor", (...args) => onActorUpdate(...args).catch(err => console.error("Thunderbolt | обновление актёра", err)));

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
