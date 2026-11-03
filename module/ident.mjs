/* Неопознанные контакты («Стрэйнджриал» 9.6, хоумрул 17). Вылет «с опознанием»: часть машин игроки видят как отметку «?»:
   «Контакт N», зона и высота, больше ничего. Под контактом враг, гражданский, свой из соседнего полка или ложная цель.
   Пока контакт не опознан, у токена другое имя («Контакт N», и у несвязанного актёра тоже) и картинка радарной отметки,
   поэтому карточки, HUD, эфир, трекер и подсказки сами показывают «Контакт N». Настоящее хранится во флаге unknown
   и возвращается при опознании. Ведущий у себя видит настоящий силуэт со значком «?».
   Опознание: визуально (машина игрока в той же зоне на той же или соседней высоте), по радару (Aim против 7 по захвату,
   проверка хода, кнопка «ОПОЗН» в HUD) и своим ДРЛО (в начале раунда ближайший к игрокам контакт). Сбитый раскрывается сам.
   Огонь игрока по гражданскому или своему под «?» — карточка нарушения и строка в разборе; Нервы и шкалу угрозы ставит ведущий. */
import { SYSTEM_ID } from "./config.mjs";
import { esc, resolveActor } from "./utils.mjs";
import { altOf, ALT_ORDER, zoneDistance, tokenOf, hasRule, isFlying, sideOf, UNKNOWN_KEY } from "./scene.mjs";

export const CONTACT_ICON = `systems/${SYSTEM_ID}/assets/targets/contact.svg`;
export const CONTACT_TINT = 0xb8c2c8;
const CHANNEL = `system.${SYSTEM_ID}`;

/* ---------- чистая часть (тесты) ---------- */

/** Что под контактом: decoy — ложная цель, civil — гражданский или нейтрал, own — свой, enemy — противник. */
export function identKind(actor) {
  if (!actor) return "enemy";
  if (actor.system?.key === "decoy" || hasRule(actor, "decoy")) return "decoy";
  if (hasRule(actor, "civilian") || actor.system?.grp === "civil") return "civil";
  const side = sideOf(actor);
  if (side === "ally" || side === "player") return "own";
  if (side === "neutral") return "civil";
  return "enemy";
}

/** Строка AWACS при опознании. what — тип машины (противник) или позывной (свои). */
export function identLine(n, kind, what = "") {
  const c = `Контакт ${n}`;
  if (kind === "decoy") return `${c} — ложная цель, имитатор. Не тратьте ракеты.`;
  if (kind === "civil") return `${c} — гражданский борт! Огонь не открывать!`;
  if (kind === "own") return `${c} — свои${what ? `, ${what}` : ""}. Не стрелять.`;
  return `${c} — противник${what ? `, ${what}` : ""}. Огонь разрешаю.`;
}

/** Видно ли глазами: одна зона, высоты одинаковые или соседние (наземное — как Низкая). */
export function seesVisually(dist, altA, altB) {
  if (dist !== 0) return false;
  const i = ALT_ORDER.indexOf(altA), j = ALT_ORDER.indexOf(altB);
  return i >= 0 && j >= 0 && Math.abs(i - j) <= 1;
}

/** Нарушение: игрок попал по контакту, под которым гражданский или свой. Тип карточки или null. */
export const violationOf = kind => (kind === "civil" ? "civil" : kind === "own" ? "own" : null);

/* ---------- флаг ---------- */

const docOf = t => t?.document ?? t;
/** Данные контакта токена { n, name, src, bars, delta } или null. */
export const unknownOf = t => docOf(t)?.getFlag?.(SYSTEM_ID, UNKNOWN_KEY) ?? null;
export const isUnknown = t => !!unknownOf(t);
const isPlayerUnit = a => a?.type === "pilot" || !!a?.hasPlayerOwner;
const gone = a => !a || a.statuses?.has?.(CONFIG.specialStatusEffects.DEFEATED) || !!a.system?.markers?.doom;
const lead = () => !!game.user?.isGM && !!game.users?.activeGM?.isSelf;
const sceneOf = () => game.combat?.scene ?? canvas?.scene ?? null;

/** Поля токена «Контакт N» (для импорта миссии: сразу в данные создаваемого токена). */
export function contactData(data, n) {
  const keep = { n, name: data.name ?? "", src: data.texture?.src ?? "", bars: data.displayBars ?? null, delta: data.delta?.name ?? null };
  const out = { name: `Контакт ${n}`, texture: { ...(data.texture ?? {}), src: CONTACT_ICON }, displayBars: CONST.TOKEN_DISPLAY_MODES.OWNER,
    flags: { ...(data.flags ?? {}), [SYSTEM_ID]: { ...(data.flags?.[SYSTEM_ID] ?? {}), [UNKNOWN_KEY]: keep } } };
  if (!data.actorLink) out.delta = { ...(data.delta ?? {}), name: `Контакт ${n}` };
  return out;
}

async function nextNumber(scene) {
  const n = (scene.getFlag(SYSTEM_ID, "contactSeq") ?? 0) + 1;
  await scene.setFlag(SYSTEM_ID, "contactSeq", n);
  return n;
}

/** Сделать токен контактом «?» (ведущий). n — вернуть прежний номер (отмена опознания). */
export async function markUnknown(doc, n = null) {
  doc = docOf(doc);
  if (!game.user.isGM || !doc || isUnknown(doc)) return;
  n ??= await nextNumber(doc.parent);
  const keep = { n, name: doc.name, src: doc.texture?.src ?? "", bars: doc.displayBars, delta: doc.actorLink ? null : doc.delta?.name ?? null };
  const upd = { name: `Контакт ${n}`, "texture.src": CONTACT_ICON, displayBars: CONST.TOKEN_DISPLAY_MODES.OWNER, [`flags.${SYSTEM_ID}.${UNKNOWN_KEY}`]: keep };
  if (!doc.actorLink) upd["delta.name"] = `Контакт ${n}`;
  await doc.update(upd, { tbKeep: true });
}

/** Опознать (ведущий): вернуть имя и картинку; строка AWACS в эфир, если не silent. Возвращает { n, kind } или null. */
export async function reveal(doc, { why = "", silent = false } = {}) {
  doc = docOf(doc);
  const u = unknownOf(doc);
  if (!game.user.isGM || !u) return null;
  const actor = doc.actor, kind = identKind(actor);
  const upd = { name: u.name, "texture.src": u.src || doc.texture?.src, displayBars: u.bars ?? doc.displayBars, [`flags.${SYSTEM_ID}.-=${UNKNOWN_KEY}`]: null };
  if (!doc.actorLink) upd["delta.name"] = u.delta ?? null;
  await doc.update(upd, { tbKeep: true });
  if (!silent) {
    const base = game.actors.get(doc.actorId)?.name ?? "";
    const what = kind === "own" ? u.name : kind === "enemy" ? [base, u.name !== base ? `«${u.name}»` : ""].filter(Boolean).join(" ") : "";
    const { sendRadio } = await import("./radio.mjs");
    await sendRadio({ text: identLine(u.n, kind, what) });
  }
  if (why) console.info(`${SYSTEM_ID} | опознан контакт ${u.n} (${why})`);
  return { n: u.n, kind };
}

/** Попросить ведущего опознать (игрок не может менять чужой токен). */
export function requestReveal(uuid, why = "") {
  if (game.user.isGM) { const d = fromUuidSync(uuid); return d ? reveal(d, { why }) : null; }
  game.socket?.emit(CHANNEL, { type: "ident", op: "reveal", uuid, why });
  return null;
}

/* ---------- опознание ---------- */

/** Визуально: ведущий проверяет каждый контакт против машин игроков на сцене. */
async function checkVisual(scene = sceneOf()) {
  if (!lead() || !scene || scene.id !== canvas?.scene?.id) return;
  const toks = canvas.tokens.placeables;
  const players = toks.filter(t => !t.document.hidden && isPlayerUnit(t.actor) && !gone(t.actor));
  if (!players.length) return;
  for (const c of toks.filter(t => isUnknown(t) && !t.document.hidden)) {
    const near = players.some(p => seesVisually(zoneDistance(p, c), altOf(p), altOf(c)));
    if (near) await reveal(c.document, { why: "визуально" });
  }
}

/** Свой ДРЛО в воздухе: в начале раунда — один контакт, ближайший к машинам игроков. Ведущему карточка с отменой. */
async function awacsSweep(combat) {
  if (!lead() || !combat?.started || (combat.scene && combat.scene.id !== canvas?.scene?.id)) return;
  const toks = canvas.tokens.placeables;
  const radar = toks.find(t => t.actor?.type === "npc" && ["ally", "player"].includes(sideOf(t.actor)) && hasRule(t.actor, "awacs") && isFlying(t.actor) && !gone(t.actor) && !isUnknown(t) && !t.document.hidden);
  if (!radar) return;
  const players = toks.filter(t => isPlayerUnit(t.actor) && !gone(t.actor) && !t.document.hidden);
  const list = toks.filter(t => isUnknown(t) && !t.document.hidden)
    .map(t => ({ t, d: Math.min(...players.map(p => zoneDistance(p, t) ?? 99), 99) }))
    .sort((a, b) => a.d - b.d || unknownOf(a.t).n - unknownOf(b.t).n);
  if (!list.length) return;
  const c = list[0].t, n = unknownOf(c).n;
  const res = await reveal(c.document, { why: "ДРЛО" });
  if (!res) return;
  await ChatMessage.create({
    speaker: { alias: "AWACS" }, whisper: game.users.filter(u => u.isGM).map(u => u.id),
    content: `<div class="tb-card"><div class="tb-note">ДРЛО «${esc(radar.name)}» опознал <b>Контакт ${n}</b> (${esc(c.document.name)}), ближайший к звену.</div>
      <div class="tb-actions"><button type="button" data-tb-ident-undo="${c.document.uuid}" data-n="${n}"><i class="fas fa-question"></i> Вернуть «?» (опознать вручную другой)</button></div></div>`
  });
}

/** Опознание по радару (действие игрока): Aim против 7 по захваченному контакту, проверка хода. */
export async function identify(actor) {
  const target = actor.system.lockUuid ? resolveActor(actor.system.lockUuid) : null, tok = tokenOf(target);
  if (!tok || !isUnknown(tok)) { ui.notifications.warn("Опознание: держите на захвате неопознанный контакт «?»."); return null; }
  const u = unknownOf(tok);
  const { rollSideCheck, onCardAction } = await import("./dice/rolls.mjs");
  const msg = await rollSideCheck(actor, "aim", {
    dc: 7, turnRoll: true, label: `Опознание: Aim против 7 · Контакт ${u.n}`,
    notes: ["«Стрэйнджриал» 9.6: по захвату, ничья за пилотом, Strain можно."], extra: { ident: { uuid: tok.document.uuid, n: u.n } }
  });
  if (msg) await onCardAction(msg, "ident");
  return msg;
}

/* ---------- огонь по контакту ---------- */

/** Попадание по машине, которая была контактом «?» (u — его данные до раскрытия): стрелял игрок, а под «?» гражданский
    или свой — нарушение. Пишет ведущий; у игрока запрос уходит ему по сокету. */
export async function onHitUnknown(actor, sourceUuid, u) {
  if (!u) return;
  if (!game.user.isGM) { game.socket?.emit(CHANNEL, { type: "ident", op: "hit", uuid: actor.uuid, by: sourceUuid ?? "", u }); return; }
  const shooter = sourceUuid ? resolveActor(sourceUuid) : null;
  if (!isPlayerUnit(shooter)) return;
  const v = violationOf(identKind(actor));
  if (!v) return;
  const who = shooter.system?.callsign || tokenOf(shooter)?.name || shooter.name;
  const scene = sceneOf();
  const list = foundry.utils.deepClone(scene?.getFlag(SYSTEM_ID, "violations") ?? []);
  list.push({ kind: v, who, target: u.name, n: u.n, round: game.combat?.round ?? null, uuid: actor.uuid });
  await scene?.setFlag(SYSTEM_ID, "violations", list);
  await ChatMessage.create({
    speaker: { alias: "AWACS" },
    content: `<div class="tb-card tb-card-damage"><header class="tb-card-head"><span class="tb-card-who">AWACS</span><span class="tb-card-what">${v === "civil" ? "Огонь по гражданскому борту" : "Огонь по своим"}</span></header>
      <div class="tb-note"><b>${esc(who)}</b> попал по Контакту ${u.n}: это ${v === "civil" ? "гражданский борт" : "свои"}, ${esc(u.name)}.</div></div>`
  });
  await ChatMessage.create({
    speaker: { alias: "AWACS" }, whisper: game.users.filter(x => x.isGM).map(x => x.id),
    content: `<div class="tb-card"><div class="tb-note">Нарушение (9.6): <b>+1 на шкалу угрозы</b>, <b>+1 Нервы</b> пилоту ${esc(who)}. Ставится на разборе, строка уже в «Разборе полёта».</div></div>`
  });
}

/** Нарушения последнего боя на сцене: строки для «Разбора полётов». */
export function violationLines(scene) {
  return (scene?.getFlag?.(SYSTEM_ID, "violations") ?? []).map(v => {
    const a = v.uuid ? resolveActor(v.uuid) : null, down = !!(a && gone(a));
    return `${v.who}: ${v.kind === "civil" ? "огонь по гражданскому борту" : "огонь по своим"} — ${v.target}${down ? ", сбит" : ""}${v.round ? ` (раунд ${v.round})` : ""}`;
  });
}

/* ---------- вид у ведущего: настоящий силуэт и значок «?» ---------- */

const texCache = new Map();
function gmLook(t) {
  const u = unknownOf(t);
  if (t.tbIdentBadge && (!u || t.tbIdentBadge.destroyed)) { if (!t.tbIdentBadge.destroyed) t.tbIdentBadge.destroy(); t.tbIdentBadge = null; }
  if (!u || !game.user.isGM || !t.mesh) return;
  const src = u.src;
  if (src && t.tbIdentSrc !== src) {
    t.tbIdentSrc = src;
    const p = texCache.get(src) ?? loadTexture(src).catch(() => null);
    texCache.set(src, p);
    p.then(tex => { if (!tex || t.destroyed || !t.mesh || !isUnknown(t)) return; t.mesh.texture = tex; try { t.renderFlags?.set?.({ refreshSize: true }); } catch { /* старая версия без флага */ } });
  }
  let b = t.tbIdentBadge;
  if (!b || b.destroyed) {
    b = t.tbIdentBadge = t.addChild(new PIXI.Text("?", { fontFamily: "monospace", fontSize: 22, fontWeight: "700", fill: 0xffd27a, stroke: 0x000000, strokeThickness: 4 }));
    b.eventMode = "none";
  }
  b.text = `?${u.n}`;
  b.position.set(2, 0);
}

/* ---------- регистрация ---------- */

export function registerIdent() {
  Hooks.once("ready", () => game.socket?.on(CHANNEL, msg => {
    if (msg?.type !== "ident" || !lead()) return;
    if (msg.op === "reveal") { const d = fromUuidSync(msg.uuid); if (d) reveal(d, { why: msg.why }).catch(err => console.warn(`${SYSTEM_ID} | опознание`, err)); }
    if (msg.op === "hit") { const a = resolveActor(msg.uuid); if (a) onHitUnknown(a, msg.by, msg.u).catch(err => console.warn(`${SYSTEM_ID} | опознание`, err)); }
  }));
  // визуальное опознание: кто-то сдвинулся или сменил высоту
  let timer = null;
  const soon = () => { if (!lead()) return; clearTimeout(timer); timer = setTimeout(() => checkVisual().catch(err => console.warn(`${SYSTEM_ID} | опознание`, err)), 250); };
  Hooks.on("updateToken", (doc, change) => { if (["x", "y", "elevation", "hidden"].some(k => k in change)) soon(); });
  Hooks.on("createToken", () => soon());
  Hooks.on("updateCombat", (combat, change) => {
    if ("round" in change && lead()) awacsSweep(combat).catch(err => console.warn(`${SYSTEM_ID} | ДРЛО`, err));
  });
  // сбитый контакт раскрывается сразу
  Hooks.on("createActiveEffect", (effect, options) => {
    if (!lead() || options?.tbUndo || !effect.statuses?.has?.(CONFIG.specialStatusEffects.DEFEATED)) return;
    const a = effect.parent, tok = a?.isToken ? a.token : tokenOf(a)?.document;
    if (tok && isUnknown(tok)) reveal(tok, { why: "сбит", silent: true }).catch(err => console.warn(`${SYSTEM_ID} | опознание`, err));
  });
  // кнопка ведущего «Вернуть «?»» на карточке ДРЛО
  Hooks.on("renderChatMessage", (message, html) => {
    const root = html[0] ?? html;
    root.querySelectorAll?.("[data-tb-ident-undo]").forEach(b => {
      if (!game.user.isGM) { b.remove(); return; }
      b.addEventListener("click", async ev => {
        ev.preventDefault();
        const d = fromUuidSync(b.dataset.tbIdentUndo);
        if (d && !isUnknown(d)) { await markUnknown(d, Number(b.dataset.n) || null); b.disabled = true; }
      });
    });
  });
  // ведущий: настоящий силуэт под «?»
  Hooks.on("drawToken", t => { t.tbIdentSrc = null; gmLook(t); });
  Hooks.on("refreshToken", t => gmLook(t));
  // меню токена у ведущего: сделать контактом «?» или опознать (всем выделенным)
  Hooks.on("renderTokenHUD", (hud, html) => {
    const token = hud.object;
    if (!game.user.isGM || !["npc"].includes(token?.actor?.type)) return;
    const col = (html[0] ?? html).querySelector(".col.left");
    if (!col) return;
    const on = isUnknown(token);
    const b = document.createElement("div");
    b.className = `control-icon tb-ident${on ? " active" : ""}`;
    b.title = on ? `Контакт ${unknownOf(token).n}: опознать (снять «?»)` : "Неопознанный контакт «?» (всем выделенным)";
    b.innerHTML = `<i class="fas fa-question"></i>`;
    b.addEventListener("click", async ev => {
      ev.preventDefault(); ev.stopPropagation();
      const list = token.controlled ? canvas.tokens.controlled.filter(t => t.actor?.type === "npc") : [token];
      hud.clear();
      for (const t of list) await (on ? reveal(t.document, { why: "ведущий" }) : markUnknown(t.document));
    });
    col.append(b);
  });
}
