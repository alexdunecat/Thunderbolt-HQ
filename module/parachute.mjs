/* Купол на карте: катапультировавшийся пилот висит над своей клеткой до конца следующего раунда, потом исчезает.
   Пилот игрока — когда бросок на катапультирование удался (статус «катапультировался»). NPC — когда его сбили, с вероятностью
   по уровню: конскрипт 5 из 10, дуэлянт 6, ас 8. Парашютов нет у бомбардировщиков, транспортников, самолётов ДРЛО,
   вертолётов и беспилотников, гражданских, боссов, ракет, наземной техники и кораблей.
   Ас или дуэлянт противника (NPC в той же или соседней клетке) может расстрелять купол: Strafe против 6, вне броска хода.
   Попал — купол исчезает, пилот игрока погибает. Купол — плитка сцены (Tile), без актёра; всё делает главный ведущий. */
import { SYSTEM_ID, SYS_PATH } from "./config.mjs";
import { esc, resolveActor } from "./utils.mjs";
import { COL_LETTERS } from "./briefing.mjs";

const KEY = "parachute";
/** Купол в стиле карты: контур цвета стороны пилота (игрок, союзник, враг, нейтрал). */
export const chuteImg = side => `${SYS_PATH}assets/status/parachute-${["player", "ally", "enemy", "neutral"].includes(side) ? side : "enemy"}.svg`;
/** Шанс катапультироваться NPC: из 10 на d10 (выпало не больше). */
export const EJECT_CHANCE = { conscript: 5, duelist: 6, ace: 8 };
/** Расстрел купола: Strafe против этого числа. */
export const SHOOT_DC = 6;
/** Купол живёт до конца следующего раунда: снимается в начале раунда «создан + 2». */
export const CHUTE_ROUNDS = 2;
const NO_CHUTE_GRP = new Set(["heavy", "support", "heli", "civil", "boss"]);
const NO_CHUTE_KEY = new Set(["ac130", "widebody", "cargojet", "icbm"]);
const RULES_NO_CHUTE = ["ballistic", "boss", "aerialship", "strato", "solgfall"];

const lead = () => !!game.user?.isGM && (game.users?.activeGM?.isSelf ?? true);
const rulesOf = a => [...(a?.system?.props ?? []), ...(a?.system?.rules ?? [])].map(p => p?.key ?? p);

/** Есть ли у NPC катапульта: истребители, штурмовики, многоцелевые, книжные самолёты без экипажа большого борта. */
export function canEject(actor) {
  if (actor?.type !== "npc") return false;
  const s = actor.system ?? {};
  if (s.kind !== "air" || NO_CHUTE_GRP.has(s.grp) || NO_CHUTE_KEY.has(s.key)) return false;
  return !rulesOf(actor).some(k => RULES_NO_CHUTE.includes(k));
}

/** Шанс NPC (из 10). */
export const ejectChance = actor => EJECT_CHANCE[actor?.system?.tier] ?? EJECT_CHANCE.conscript;

/** Может ли стрелять по куполу: ас или дуэлянт NPC, самолёт, не сбит. */
export function canShootChutes(actor) {
  if (actor?.type !== "npc" || actor.system?.kind !== "air" || !["ace", "duelist"].includes(actor.system?.tier)) return false;
  if (actor.hasPlayerOwner) return false;
  return !actor.getFlag?.(SYSTEM_ID, "down") && !actor.statuses?.has?.(CONFIG.specialStatusEffects.DEFEATED);
}

/** Пора ли снять купол в раунде round. */
export const chuteExpired = (f, round) => !!f && round >= Number(f.round) + CHUTE_ROUNDS;

const team = s => (s === "player" ? "ally" : s ?? "enemy");
const sideOfActor = a => (a?.type === "pilot" ? "player" : a?.system?.side ?? "enemy");

/** Клетка документа (центр). */
export function cellOfDoc(doc, gs = doc.parent?.grid?.size ?? 100) {
  return [Math.floor((doc.x + ((doc.width ?? 1) * gs) / 2) / gs), Math.floor((doc.y + ((doc.height ?? 1) * gs) / 2) / gs)];
}
const cellName = ([c, r]) => (COL_LETTERS[c] ?? "?") + (r + 1);

/** Куполы сцены (плитки с отметкой). */
export const chutesOf = scene => (scene?.tiles?.contents ?? [...(scene?.tiles ?? [])]).filter(t => t.getFlag?.(SYSTEM_ID, KEY));

/** Купол в клетке: квадрат в 0.3 клетки в правом верхнем углу, следующие левее и ниже, чтобы не лечь друг на друга. */
export function chutePlace(cell, gs, taken = 0) {
  const s = Math.round(gs * 0.3), k = taken % 4;
  return { x: cell[0] * gs + gs - s - (k % 2) * s, y: cell[1] * gs + Math.floor(k / 2) * s, width: s, height: s };
}

/** Асы и дуэлянты противника рядом с куполом (своя или соседняя клетка). tokens — документы токенов сцены. */
export function shootersFor(chute, tokens, gs) {
  const f = chute.getFlag(SYSTEM_ID, KEY);
  const at = [Math.floor((chute.x + chute.width / 2) / gs), Math.floor((chute.y + chute.height / 2) / gs)];
  return tokens.filter(t => {
    const a = t.actor;
    if (!canShootChutes(a) || t.hidden) return false;
    if (team(sideOfActor(a)) === team(f.side)) return false;
    const c = cellOfDoc(t, gs);
    return Math.max(Math.abs(c[0] - at[0]), Math.abs(c[1] - at[1])) <= 1;
  });
}

/* ---------- купол появляется и исчезает ---------- */

const made = new Set(), rolled = new Set();
/** Где стоял токен, ушедший с поля (сбитый пилот мог бросить катапульту уже после конца раунда). */
const lastSeen = new Map();

function tokenDocOf(actor, scene) {
  if (actor?.isToken) return actor.token;
  return scene?.tokens?.find?.(t => t.actorId === actor?.id) ?? null;
}

/** Поставить купол над токеном актёра. Только главный ведущий, в начатом бою. */
export async function dropChute(actor, { combat = game.combat, doc = null } = {}) {
  if (!lead() || !combat?.started || !actor) return null;
  const k = `${combat.id}:${actor.uuid}`;
  if (made.has(k)) return null;
  const scene = combat.scene ?? canvas?.scene;
  if (!scene) return null;
  doc ??= tokenDocOf(actor, scene);
  const gs = scene.grid?.size ?? 100;
  const seen = doc ? null : lastSeen.get(actor.uuid);
  const cell = doc ? cellOfDoc(doc, gs) : seen?.scene === scene.id ? seen.cell : null;
  if (!cell) return null;
  made.add(k);
  const here = chutesOf(scene).filter(t => { const f = t.getFlag(SYSTEM_ID, KEY); return f.cell?.[0] === cell[0] && f.cell?.[1] === cell[1]; }).length;
  const name = doc?.name ?? actor.name;
  const flag = { combat: combat.id, round: combat.round, uuid: actor.uuid, name, side: sideOfActor(actor), pilot: actor.type === "pilot", cell };
  const [tile] = await scene.createEmbeddedDocuments("Tile", [{ ...chutePlace(cell, gs, here), texture: { src: chuteImg(flag.side) }, elevation: 0, flags: { [SYSTEM_ID]: { [KEY]: flag } } }]);
  await announce(flag, tile, scene);
  return tile;
}

async function announce(f, tile, scene) {
  const where = cellName(f.cell);
  const btn = `<div class="tb-actions"><button type="button" data-tb-chute="${esc(tile?.id ?? "")}" data-scene="${esc(scene.id)}" class="tb-gm"><i class="fas fa-crosshairs"></i> Расстрелять купол (ас или дуэлянт)</button></div>`;
  await ChatMessage.create({
    speaker: { alias: "AWACS" },
    content: `<div class="tb-card tb-card-chute"><header class="tb-card-head"><span class="tb-card-who">${esc(f.name)}</span><span class="tb-card-what">Купол над ${where}</span></header>
      <div class="tb-note">Пилот катапультировался. Купол на карте до конца следующего раунда. Ас или дуэлянт противника в той же или соседней клетке может его расстрелять: Strafe против ${SHOOT_DC}${f.pilot ? ", попадание убивает пилота" : ""}.</div>${btn}</div>`,
    flags: { [SYSTEM_ID]: { chute: { tile: tile?.id ?? "", scene: scene.id } } }
  });
  if (f.pilot) {
    const { sendRadio } = await import("./radio.mjs");
    await sendRadio({ text: `Вижу купол над ${where}! ${f.name} катапультировался. Поисковая группа в курсе.` });
  }
}

/** Снять куполы, которым пора (all — все куполы этого боя). */
export async function clearChutes(combat, { all = false } = {}) {
  if (!lead()) return;
  const scene = combat?.scene ?? canvas?.scene;
  const ids = chutesOf(scene).filter(t => { const f = t.getFlag(SYSTEM_ID, KEY); return f.combat === combat.id && (all || chuteExpired(f, combat.round)); }).map(t => t.id);
  if (ids.length) await scene.deleteEmbeddedDocuments("Tile", ids);
}

/** NPC сбит: катапульта по шансу уровня. */
async function npcDown(actor) {
  if (!lead() || !game.combat?.started || !canEject(actor)) return;
  const d = actor.getFlag(SYSTEM_ID, "down");
  if (d?.combat !== game.combat.id) return;
  const k = `${game.combat.id}:${actor.uuid}`;
  if (rolled.has(k)) return;
  rolled.add(k);
  const r = await new Roll("1d10").evaluate();
  if (r.total > ejectChance(actor)) return;
  await dropChute(actor);
}

/* ---------- расстрел купола ---------- */

/** Выбрать стрелка (или купол) из нескольких. */
async function pickOne(title, label, list) {
  if (list.length <= 1) return list[0] ?? null;
  const { formDialog } = await import("./dice/rolls.mjs");
  const opts = list.map((x, i) => `<option value="${i}">${esc(x.label)}</option>`).join("");
  const d = await formDialog(title, `<div class="form-group"><label>${esc(label)}</label><select name="i">${opts}</select></div>`, { ok: "Огонь" });
  return d ? list[Number(d.i)] ?? null : null;
}

/** Ас или дуэлянт стреляет по куполу. shooter — документ токена, chute — плитка. */
export async function shootChute(chute, shooter) {
  if (!game.user.isGM) return;
  const f = chute?.getFlag(SYSTEM_ID, KEY);
  if (!f || !shooter?.actor) return;
  const R = await import("./dice/rolls.mjs");
  const msg = await R.rollSideCheck(shooter.actor, "strafe", { dc: SHOOT_DC, label: `По куполу «${f.name}»: Strafe против ${SHOOT_DC}`,
    notes: ["Тратит действие стрелка."], extra: { strainable: false } });
  const card = msg?.getFlag?.(SYSTEM_ID, "card");
  if (!card) return;
  const hit = R.computeCard(card).success;
  const victim = f.uuid ? resolveActor(f.uuid) : null;
  const who = shooter.name;
  if (!hit) return ChatMessage.create({ speaker: { alias: "AWACS" }, content: `<div class="tb-card tb-card-chute"><div class="tb-note"><b>${esc(who)}</b> бьёт по куполу «${esc(f.name)}» и промахивается.</div></div>` });
  if (chute.parent?.tiles?.get?.(chute.id)) await chute.parent.deleteEmbeddedDocuments("Tile", [chute.id]);
  if (f.pilot && victim) await victim.update({ "system.service.status": "kia" });
  await ChatMessage.create({ speaker: { alias: "AWACS" }, content: `<div class="tb-card tb-card-chute"><div class="tb-note"><b>${esc(who)}</b> расстреливает купол «${esc(f.name)}».${f.pilot ? " Пилот погиб." : ""}</div></div>` });
  if (f.pilot) {
    const { sendRadio } = await import("./radio.mjs");
    await sendRadio({ text: `Они стреляют по куполу! ${f.name}... нет сигнала маяка. Всем бортам: ${who} расстрелял нашего пилота.`, caution: { title: "CAUTION", sub: "Расстрел купола" } });
  }
}

/** Кнопка в карточке: найти стрелков рядом с куполом. */
async function fromCard(tileId, sceneId) {
  const scene = game.scenes.get(sceneId);
  const chute = scene?.tiles?.get(tileId);
  if (!chute) return ui.notifications.warn("Купола уже нет на карте.");
  const list = shootersFor(chute, [...scene.tokens], scene.grid.size);
  if (!list.length) return ui.notifications.warn("Рядом с куполом нет аса или дуэлянта противника (своя или соседняя клетка).");
  const pick = await pickOne("Расстрелять купол", "Кто стреляет", list.map(t => ({ label: t.name, t })));
  if (pick) await shootChute(chute, pick.t);
}

/** Кнопка в меню токена аса или дуэлянта: куполы рядом. */
async function fromToken(token) {
  const scene = token.document.parent, gs = scene.grid.size;
  const list = chutesOf(scene).filter(c => shootersFor(c, [token.document], gs).length);
  if (!list.length) return ui.notifications.warn("Рядом нет вражеских куполов.");
  const pick = await pickOne("Расстрелять купол", "Купол", list.map(c => ({ label: `${c.getFlag(SYSTEM_ID, KEY).name} (${cellName(c.getFlag(SYSTEM_ID, KEY).cell)})`, c })));
  if (pick) await shootChute(pick.c, token.document);
}

export function registerParachute() {
  // сбитый NPC: катапульта по шансу; пилот игрока: удачный бросок на катапультирование
  const onChange = (actor, change) => {
    if (!actor || !lead()) return;
    if (actor.type === "npc" && foundry.utils.getProperty(change, `flags.${SYSTEM_ID}.down`)) npcDown(actor).catch(err => console.error(`${SYSTEM_ID} | купол`, err));
    if (actor.type === "pilot" && foundry.utils.getProperty(change, "system.service.status") === "ejected" && game.combat?.started)
      dropChute(actor).catch(err => console.error(`${SYSTEM_ID} | купол`, err));
  };
  Hooks.on("updateActor", (actor, change) => onChange(actor, change));
  Hooks.on("updateActorDelta", (delta, change) => onChange(delta.parent?.actor, change));
  Hooks.on("deleteToken", doc => {
    if (doc.actor && game.combat?.started) lastSeen.set(doc.actor.uuid, { scene: doc.parent?.id, cell: cellOfDoc(doc) });
  });
  Hooks.on("updateCombat", (combat, change) => {
    if ("round" in change && combat.started) clearChutes(combat).catch(err => console.error(`${SYSTEM_ID} | купол`, err));
  });
  Hooks.on("deleteCombat", combat => {
    clearChutes(combat, { all: true }).catch(err => console.error(`${SYSTEM_ID} | купол`, err));
    made.clear(); rolled.clear(); lastSeen.clear();
  });
  Hooks.on("renderChatMessage", (message, html) => {
    const root = html?.[0] ?? html;
    for (const b of root?.querySelectorAll?.("[data-tb-chute]") ?? []) {
      if (!game.user.isGM) { b.remove(); continue; }
      b.addEventListener("click", ev => { ev.preventDefault(); fromCard(b.dataset.tbChute, b.dataset.scene).catch(err => console.error(`${SYSTEM_ID} | купол`, err)); });
    }
  });
  Hooks.on("renderTokenHUD", (hud, html) => {
    const token = hud.object;
    if (!game.user.isGM || !canShootChutes(token?.actor)) return;
    const scene = token.document.parent;
    if (!chutesOf(scene).some(c => shootersFor(c, [token.document], scene.grid.size).length)) return;
    const col = (html[0] ?? html).querySelector(".col.left");
    if (!col) return;
    const b = document.createElement("div");
    b.className = "control-icon tb-chute-shoot";
    b.title = `Расстрелять купол рядом: Strafe против ${SHOOT_DC}`;
    b.innerHTML = `<i class="fas fa-parachute-box"></i>`;
    b.addEventListener("click", ev => { ev.preventDefault(); ev.stopPropagation(); hud.clear(); fromToken(token).catch(err => console.error(`${SYSTEM_ID} | купол`, err)); });
    col.append(b);
  });
}
