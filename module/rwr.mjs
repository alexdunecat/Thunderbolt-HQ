/* Предупреждение об облучении: значок захвата на токене цели и сигнал её владельцу.
   Значок видят ведущий, владелец цели и тот, кто держит захват. Сигнал «Ракета!» молчит, если у цели сломан MAWS. */
import { SYSTEM_ID } from "./config.mjs";
import { resolveActor } from "./utils.mjs";

export function registerRwr() {
  Hooks.on("refreshToken", t => drawBadge(t));
  Hooks.on("canvasReady", () => refreshAll());
  // у NPC без связи с актёром захват живёт в дельте токена: её обновление приходит отдельным хуком
  for (const ev of ["updateActor", "updateActorDelta", "updateToken", "createToken", "deleteToken", "targetToken"]) Hooks.on(ev, refreshSoon);
  Hooks.on("createChatMessage", alertOwner);
}

let timer = null;
function refreshSoon() {
  clearTimeout(timer);
  timer = setTimeout(refreshAll, 60);
}
function refreshAll() {
  if (canvas?.ready) for (const t of canvas.tokens.placeables) drawBadge(t);
}

/** Токены, которые держат этот токен на захвате. */
export function lockersOf(token) {
  const uuid = token.actor?.uuid;
  if (!uuid) return [];
  return canvas.tokens.placeables.filter(t => t !== token && t.actor?.system?.lockUuid === uuid);
}

function drawBadge(token) {
  const seen = lockersOf(token).filter(l => game.user.isGM || token.actor?.isOwner || l.actor?.isOwner);
  let g = token.tbLockBadge;
  if (!seen.length) {
    if (g && !g.destroyed) g.destroy({ children: true });
    token.tbLockBadge = null;
    return;
  }
  if (!g || g.destroyed) {
    g = token.tbLockBadge = token.addChild(new PIXI.Graphics());
    g.eventMode = "none";
  }
  // красное кольцо с перекрестием в левом верхнем углу токена, рядом число захватов
  const r = Math.max(7, Math.min(token.w, token.h) * 0.16);
  g.clear();
  g.lineStyle(Math.max(2, r * 0.22), 0xff3b2f, 1).beginFill(0x1e0a08, 0.75).drawCircle(0, 0, r).endFill();
  g.moveTo(-r * 1.35, 0).lineTo(-r * 0.45, 0).moveTo(r * 0.45, 0).lineTo(r * 1.35, 0)
    .moveTo(0, -r * 1.35).lineTo(0, -r * 0.45).moveTo(0, r * 0.45).lineTo(0, r * 1.35);
  g.position.set(r * 0.9, r * 0.9);
  g.removeChildren().forEach(c => c.destroy());
  if (seen.length > 1) {
    const txt = new PIXI.Text(String(seen.length), { fontFamily: "monospace", fontSize: Math.round(r * 1.3), fontWeight: "bold", fill: 0xffffff, stroke: 0x000000, strokeThickness: 3 });
    txt.anchor.set(0, 0.5);
    txt.position.set(r * 1.2, r * 0.9);
    g.addChild(txt);
  }
}

/** Сигнал владельцу цели: захват (флаг rwr на карточке Lock On!) или пуск по нему (card.maws). */
function alertOwner(message) {
  if (game.user.isGM) return;
  const rwr = message.getFlag(SYSTEM_ID, "rwr");
  const card = message.getFlag(SYSTEM_ID, "card");
  const uuid = rwr?.target ?? (card?.maws ? card.targetUuid : null);
  const target = uuid ? resolveActor(uuid) : null;
  if (!target?.isOwner) return;
  if (rwr) ui.notifications.warn(`Облучение! ${rwr.from} держит «${target.name}» на захвате.`);
  else ui.notifications.error(`Ракета! ${card.actorName}: ${card.label} по «${target.name}». Самое время для Break!`);
  foundry.audio.AudioHelper.play({ src: CONFIG.sounds.notification, volume: 0.8, autoplay: true, loop: false }, false);
}
