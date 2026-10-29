/* Подкрепления по расписанию: скрытый токен с отметкой «появится» выходит на сцену боя сам — в начале заданного раунда
   или когда сбита (уничтожена, ушла с поля) заданная машина. Ставится импортом миссии из Планшета AWACS или кнопкой
   с часами в меню токена (ведущему, для всех выделенных). Ждущий токен скрыт, в бою не заявляется и не ходит (combat.mjs isOut).
   Вышедший в начале раунда заявляется как все; вышедший посреди раунда в этом раунде пропускает и ходит со следующего.
   AWACS объявляет, кто пришёл и куда. Всё делает главный ведущий. */
import { SYSTEM_ID } from "./config.mjs";
import { esc, resolveActor } from "./utils.mjs";
import { COL_LETTERS } from "./briefing.mjs";
import { PASS } from "./documents/combat.mjs";

const KEY = "arrive";
const lead = () => !!game.user?.isGM && (game.users?.activeGM?.isSelf ?? true);

/** Отметка токена: { round } или { after, afterName } или null. */
export const arriveOf = doc => doc?.getFlag?.(SYSTEM_ID, KEY) ?? null;
/** Ждёт выхода: скрыт и с отметкой. */
export const waiting = doc => !!doc?.hidden && !!arriveOf(doc);

/** Машина сбита, уничтожена или её уже нет на поле. */
export function goneUnit(uuid) {
  const a = uuid ? resolveActor(uuid) : null;
  if (!a) return true;
  if (a.getFlag?.(SYSTEM_ID, "down") || a.statuses?.has?.(CONFIG.specialStatusEffects.DEFEATED)) return true;
  const t = a.isToken ? a.token : null;
  return !!t && !t.parent?.tokens?.get?.(t.id);
}

/** Пора ли выходить: раунд наступил или та машина выбыла. */
export function arriveDue(arrive, round, gone = goneUnit) {
  if (!arrive) return false;
  if (Number(arrive.round) > 0 && round >= Number(arrive.round)) return true;
  return !!arrive.after && gone(arrive.after);
}

/** Строка отметки для подсказок: «в раунде 3» / «когда выбудет «Штаб»». */
export function arriveText(arrive) {
  if (!arrive) return "";
  if (Number(arrive.round) > 0) return `в раунде ${arrive.round}`;
  return arrive.after ? `когда выбудет «${arrive.afterName || "цель"}»` : "";
}

const cellOfDoc = doc => {
  const gs = doc.parent?.grid?.size ?? 100;
  const c = Math.floor((doc.x + (doc.width * gs) / 2) / gs), r = Math.floor((doc.y + (doc.height * gs) / 2) / gs);
  return (COL_LETTERS[c] ?? "?") + (r + 1);
};

/**
 * Выпустить тех, кому пора. midRound — посреди раунда (выбыла машина): в этом раунде пропуск, ходят со следующего.
 * Вызывает главный ведущий: в начале раунда до заявок (combat.mjs) и когда кто-то выбыл.
 */
export async function releaseArrivals(combat, { midRound = false } = {}) {
  if (!lead() || !combat?.started) return [];
  const scene = combat.scene ?? canvas?.scene;
  const docs = (scene?.tokens?.contents ?? [...(scene?.tokens ?? [])]).filter(d => waiting(d) && arriveDue(arriveOf(d), combat.round));
  if (!docs.length) return [];
  await scene.updateEmbeddedDocuments("Token", docs.map(d => ({ _id: d.id, hidden: false, [`flags.${SYSTEM_ID}.-=${KEY}`]: null })));
  // в трекер: кого там ещё нет; посреди раунда — пропуск до следующего
  const missing = docs.filter(d => !combat.combatants.some(c => c.tokenId === d.id));
  if (missing.length) await combat.createEmbeddedDocuments("Combatant", missing.map(d => ({ tokenId: d.id, sceneId: scene.id, actorId: d.actorId, hidden: false, ...(midRound ? { initiative: PASS } : {}) })));
  const stale = combat.combatants.filter(c => docs.some(d => d.id === c.tokenId) && (c.hidden || (midRound && !Number.isFinite(c.initiative))));
  if (stale.length) await combat.updateEmbeddedDocuments("Combatant", stale.map(c => ({ _id: c.id, hidden: false, ...(midRound && !Number.isFinite(c.initiative) ? { initiative: PASS } : {}) })));
  await announce(docs, midRound);
  return docs;
}

async function announce(docs, midRound) {
  const side = d => d.actor?.system?.side ?? "enemy";
  const enemy = docs.filter(d => side(d) === "enemy"), friends = docs.filter(d => side(d) === "ally");
  const list = ds => {
    const by = new Map();
    for (const d of ds) { const k = cellOfDoc(d); by.set(k, [...(by.get(k) ?? []), d.name]); }
    return [...by].map(([k, ns]) => `${ns.join(", ")} в ${k}`).join("; ");
  };
  const when = midRound ? " Вступают в бой со следующего раунда." : "";
  const { sendRadio } = await import("./radio.mjs");
  if (enemy.length) await sendRadio({ text: `Всем бортам: новые цели! ${list(enemy)}.${when}`, caution: { title: "CAUTION", sub: "Подкрепление противника" } });
  if (friends.length) await sendRadio({ text: `Подошли свои: ${list(friends)}.${when}` });
}

/* ---------- окно ведущего ---------- */

/** Отметить выделенные токены подкреплением: скрыть до раунда N или до выбытия машины. */
export async function arriveDialog(tokens) {
  tokens = tokens.filter(t => ["npc", "pilot"].includes(t.actor?.type));
  if (!tokens.length) return ui.notifications.warn("Подкрепление: выделите токены.");
  const { formDialog } = await import("./dice/rolls.mjs");
  const cur = arriveOf(tokens[0].document) ?? {};
  const names = tokens.map(t => t.name).join(", ");
  const round = (game.combat?.started ? game.combat.round : 0) + 1;
  const content = `<p class="tb-hint">${esc(names)}. Токен скрыт до выхода: в бою не заявляется и не ходит. Вышел в начале раунда — заявляется как все; посреди раунда — ходит со следующего. AWACS объявляет подкрепление.</p>
    <div class="form-group"><label>Когда появится</label><select name="kind">
      <option value="round" ${cur.after ? "" : "selected"}>В начале раунда</option><option value="after" ${cur.after ? "selected" : ""}>Когда выбудет машина</option><option value="none">Сразу (снять отметку)</option></select></div>
    <div class="form-group tb-arr-round"><label>Раунд</label><input type="number" name="round" min="1" value="${Number(cur.round) || round}"></div>
    <div class="form-group tb-arr-after"><label>Машина</label><input type="hidden" name="after" value="${esc(cur.after ?? "")}"><input type="hidden" name="afterName" value="${esc(cur.afterName ?? "")}">
      <span class="tb-arr-name">${esc(cur.afterName || "не выбрана")}</span> <button type="button" data-arr-pick><i class="fas fa-crosshairs"></i> На карте</button></div>`;
  const render = root => {
    const f = root.querySelector("form");
    const show = () => {
      root.querySelector(".tb-arr-round").style.display = f.kind.value === "round" ? "" : "none";
      root.querySelector(".tb-arr-after").style.display = f.kind.value === "after" ? "" : "none";
    };
    f.kind.addEventListener("change", show);
    show();
    root.querySelector("[data-arr-pick]").addEventListener("click", async () => {
      const { pickTargetToken } = await import("./pick.mjs");
      const t = await pickTargetToken(tokens[0].actor, { title: "Подкрепление: после какой машины", hint: "Щёлкните по машине: когда её собьют или уничтожат, подкрепление выйдет." });
      if (!t) return;
      f.after.value = t.actor.uuid; f.afterName.value = t.name;
      root.querySelector(".tb-arr-name").textContent = t.name;
    });
  };
  const data = await formDialog("Подкрепление", content, { ok: "Отметить", width: 440, render });
  if (!data) return;
  if (data.kind === "after" && !data.after) return ui.notifications.warn("Подкрепление: не выбрана машина.");
  const arrive = data.kind === "round" ? { round: Math.max(1, Number(data.round) || round) } : data.kind === "after" ? { after: data.after, afterName: data.afterName } : null;
  const scene = tokens[0].document.parent;
  await scene.updateEmbeddedDocuments("Token", tokens.map(t => (arrive
    ? { _id: t.id, hidden: true, [`flags.${SYSTEM_ID}.${KEY}`]: arrive }
    : { _id: t.id, [`flags.${SYSTEM_ID}.-=${KEY}`]: null })));
  ui.notifications.info(arrive ? `Подкрепление: ${names} — появится ${arriveText(arrive)}.` : `Подкрепление: отметка снята (${names}).`);
  // раунд уже наступил или машины уже нет: выйдут сразу
  if (arrive && game.combat?.started) await releaseArrivals(game.combat, { midRound: true });
}

export function registerReinforce() {
  Hooks.on("renderTokenHUD", (hud, html) => {
    const token = hud.object;
    if (!game.user.isGM || !["npc", "pilot"].includes(token?.actor?.type)) return;
    const col = (html[0] ?? html).querySelector(".col.left");
    if (!col) return;
    const a = arriveOf(token.document);
    const b = document.createElement("div");
    b.className = `control-icon tb-arrive${a ? " active" : ""}`;
    b.title = a ? `Подкрепление: появится ${arriveText(a)}` : "Подкрепление: появится позже (всем выделенным)";
    b.innerHTML = `<i class="fas fa-hourglass-half"></i>`;
    b.addEventListener("click", ev => {
      ev.preventDefault(); ev.stopPropagation();
      const list = token.controlled ? canvas.tokens.controlled : [token];
      hud.clear();
      arriveDialog(list).catch(err => console.error(`${SYSTEM_ID} | подкрепление`, err));
    });
    col.append(b);
  });
  // кто-то выбыл посреди раунда: может, кого-то ждали именно после него
  let timer = null;
  const soon = () => {
    if (!lead() || !game.combat?.started) return;
    clearTimeout(timer);
    timer = setTimeout(() => releaseArrivals(game.combat, { midRound: true }).catch(err => console.error(`${SYSTEM_ID} | подкрепление`, err)), 300);
  };
  Hooks.on("updateActor", (actor, change) => { if (foundry.utils.hasProperty(change, `flags.${SYSTEM_ID}.down`)) soon(); });
  Hooks.on("updateActorDelta", (delta, change) => { if (foundry.utils.hasProperty(change, `flags.${SYSTEM_ID}.down`)) soon(); });
  Hooks.on("deleteToken", () => soon());
}
