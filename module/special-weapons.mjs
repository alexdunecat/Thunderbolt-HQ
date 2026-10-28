/* Черты спецоружия (Стрэйнджриал 8.2), которым нужно своё: линия EMRG по карте и РЭБ ESM.
   EMRG: линия от самолёта по стороне или диагонали до края карты на его высоте (Низкая — вместе с землёй и водой).
   ESM: одним действием глушит систему из списка Structure у вражеских самолётов и вертолётов в своей и соседних зонах
   до конца следующего раунда. Флаг esm на машине ставит и снимает ведущий: кто вышел из зон, снова пользуется системой.
   Сами пуски, карточки и урон — в dice/rolls.mjs. */
import { SYSTEM_ID, TB, sysOff, offWhy } from "./config.mjs";
import { esc, resolveActor } from "./utils.mjs";
import { tokenOf, altOf, isFlying, canFireAt, ALT_ORDER } from "./scene.mjs";
import { unitsOn } from "./strikes.mjs";
import { cellName } from "./briefing.mjs";
import { cockpitDialog } from "./aim.mjs";

const CHANNEL = `system.${SYSTEM_ID}`;
const DEFEATED = () => CONFIG.specialStatusEffects.DEFEATED;
const isLead = () => !!game.user?.isGM && (game.users?.activeGM?.isSelf ?? true);

/* ---------- EMRG: линия ---------- */

/** Клетки сцены: границы по прямоугольнику сцены (без полей). */
function sceneCells() {
  const r = canvas.dimensions?.sceneRect, gs = canvas.grid?.size;
  if (!r || !gs) return null;
  return { c0: Math.floor(r.x / gs), r0: Math.floor(r.y / gs), c1: Math.floor((r.x + r.width - 1) / gs), r1: Math.floor((r.y + r.height - 1) / gs) };
}

/** Кто на линии: { uuid, name, vs, gnd, ship, sys, sysName } — защита (у наземных Occlusion), у корабля Occlusion самой уязвимой целой системы. */
function onLine(u, actor) {
  const a = resolveActor(u.uuid);
  if (!a) return null;
  const gnd = !isFlying(a);
  if (u.kind === "ship") {
    const live = (a.system.systems ?? []).map((y, i) => ({ y, i })).filter(o => (o.y.value ?? 0) > 0);
    if (!live.length) return null;
    const o = live.reduce((m, x) => (x.y.occ < m.y.occ ? x : m));
    return { uuid: u.uuid, name: u.name, vs: o.y.occ, gnd, ship: true, sys: o.i, sysName: o.y.name };
  }
  if (u.defense === null || u.defense === undefined) return null;
  return { uuid: u.uuid, name: u.name, vs: u.defense, gnd };
}

/**
 * Восемь линий EMRG от самолёта: { "dx,dy": { cells: ["col,row"], units, where } } или null (сцена без сетки).
 * На своей высоте; с Низкой — и всё на земле и воде. Своя клетка не входит: линия начинается от самолёта.
 */
export function railLines(actor, tok = tokenOf(actor)) {
  if (!tok || !canvas?.ready || canvas.grid.type === CONST.GRID_TYPES.GRIDLESS) return null;
  const b = sceneCells();
  if (!b) return null;
  const o = canvas.grid.getOffset(tok.center), alt = altOf(tok, actor);
  const units = unitsOn(canvas.scene).filter(u => u.uuid !== actor.uuid && (u.alt === alt || (alt === "low" && u.alt === "ground")));
  const out = {};
  for (const dx of [-1, 0, 1]) for (const dy of [-1, 0, 1]) {
    if (!dx && !dy) continue;
    const cells = [];
    for (let c = o.j + dx, r = o.i + dy; c >= b.c0 && c <= b.c1 && r >= b.r0 && r <= b.r1; c += dx, r += dy) cells.push(`${c},${r}`);
    const set = new Set(cells);
    const hit = units.filter(u => set.has(u.zone)).map(u => onLine(u, actor)).filter(Boolean);
    const ends = cells.length ? [cells[0], cells.at(-1)].map(z => { const [c, r] = z.split(",").map(Number); return cellName(c - b.c0, r - b.r0); }) : [];
    out[`${dx},${dy}`] = { cells, units: hit, where: ends.length ? (ends[0] === ends[1] ? ends[0] : `${ends[0]}–${ends[1]}`) : "" };
  }
  return out;
}

const LINE = "tb-rail";
/** Подсветить клетки линии, пока ведущий или игрок наводит EMRG (null — убрать). */
export function showLine(cells) {
  const grid = canvas?.ready ? canvas.interface?.grid : null;
  if (!grid) return;
  grid.addHighlightLayer(LINE);
  grid.clearHighlightLayer(LINE);
  for (const z of cells ?? []) {
    const [j, i] = z.split(",").map(Number);
    const p = canvas.grid.getTopLeftPoint({ i, j });
    grid.highlightPosition(LINE, { x: p.x, y: p.y, color: 0x6fd3ff, border: 0x6fd3ff, alpha: 0.3 });
  }
}

/* ---------- ESM: РЭБ ---------- */

/** Самолёты и вертолёты противника в своей и соседних зонах стрелка (соседняя высота тоже соседняя зона). */
export function esmVictims(actor, tok) {
  const me = canvas.grid.getOffset(tok.center), ma = ALT_ORDER.indexOf(altOf(tok, actor));
  return canvas.tokens.placeables.filter(t => {
    const a = t.actor;
    if (!a || t === tok || a === actor || !isFlying(a) || a.type === "staff" || a.statuses?.has(DEFEATED())) return false;
    if (a.type === "npc" && a.system.kind !== "air") return false;
    if (!canFireAt(actor, a) || (!game.user.isGM && t.document.hidden)) return false;
    const o = canvas.grid.getOffset(t.center);
    return Math.max(Math.abs(o.j - me.j), Math.abs(o.i - me.i), Math.abs(ALT_ORDER.indexOf(altOf(t, a)) - ma)) <= 1;
  });
}

/** Зона глушения: клетка и высота стрелка в момент включения. Цель вне своей и соседних зон от неё — система снова работает. */
const inJam = (f, t) => {
  if (!f?.at || !t) return false;
  const o = canvas.grid.getOffset(t.center);
  return Math.max(Math.abs(o.j - f.at.col), Math.abs(o.i - f.at.row), Math.abs(ALT_ORDER.indexOf(altOf(t, t.actor)) - ALT_ORDER.indexOf(f.at.alt))) <= 1;
};

/**
 * ESM: одно действие, без броска. Выбрать систему из списка Structure; до конца следующего раунда она не работает
 * у всех вражеских самолётов и вертолётов в своей и соседних зонах. Тратит 1 Ammo.
 */
export async function fireEsm(actor, w) {
  const combat = game.combat;
  if (!combat?.started) return ui.notifications.warn(`${w.name}: РЭБ включают в бою (до конца следующего раунда).`);
  const tok = tokenOf(actor);
  if (!tok || canvas.grid.type === CONST.GRID_TYPES.GRIDLESS) return ui.notifications.warn(`${w.name}: нужен самолёт на сцене с сеткой.`);
  if (sysOff(actor.system, "sw")) return ui.notifications.warn(`Спецоружие ${offWhy(actor.system, "sw")}.`);
  const victims = esmVictims(actor, tok);
  const code = w.name.split(" · ")[0];
  const content = `
    <div class="tb-ck-tgt"><small>РЭБ</small><b>${victims.length ? `под глушением ${victims.length}` : "в зонах рядом врагов нет"}</b><span class="tb-ck-def">до конца раунда ${combat.round + 1}</span></div>
    <div class="tb-ck-trait"><b>${esc(w.system.trait?.name ?? "РЭБ")}.</b> ${esc(w.system.trait?.text ?? "")}</div>
    ${victims.length ? `<p class="tb-hint">${victims.map(t => esc(t.name)).join(", ")}</p>` : ""}
    <div class="tb-esm-sys">${Object.entries(TB.systems).map(([k, v]) => `<button type="button" data-pick="${k}" title="${esc(v.hint)}"><b>${esc(v.label)}</b><small>${esc(v.hint)}</small></button>`).join("")}</div>`;
  const data = await cockpitDialog(`${code} · ${actor.token?.name ?? actor.name}`, content, { width: 460 });
  if (!data?.pick || !TB.systems[data.pick]) return;
  const sys = data.pick, label = TB.systems[sys].label;
  const ammo = w.system.ammo;
  if (!w.system.unlimited) await w.update({ "system.ammo.value": Math.max(0, (ammo.value ?? 0) - 1) });
  const o = canvas.grid.getOffset(tok.center);
  const f = { sys, by: actor.uuid, byName: actor.token?.name ?? actor.name, combat: combat.id, until: combat.round + 1, at: { col: o.j, row: o.i, alt: altOf(tok, actor) } };
  const uuids = victims.map(t => t.actor.uuid);
  if (uuids.length) await toGm("esm-set", { f, uuids });
  return ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<div class="tb-card tb-card-esm"><header class="tb-card-head"><span class="tb-card-who">${esc(actor.name)}</span><span class="tb-card-what">${esc(code)}: РЭБ</span></header>
      <div class="tb-note">Глушение: <b>${esc(label)}</b> (${esc(TB.systems[sys].hint)}) до конца раунда ${f.until}.</div>
      <div class="tb-note">${victims.length ? `Под глушением: ${victims.map(t => `<b>${esc(t.name)}</b>`).join(", ")}. Кто выйдет из своей и соседних зон от точки включения, снова может пользоваться системой.` : "В своей и соседних зонах вражеских самолётов и вертолётов нет: заряд ушёл впустую."}</div></div>`
  });
}

/** Сделать на клиенте ведущего: флаги чужих машин игрок сам не пишет. */
function toGm(op, data) {
  if (game.user.isGM) return run(op, data);
  if (!game.users.activeGM) return ui.notifications.warn("РЭБ: ведущего нет в сети, глушение не записано.");
  game.socket.emit(CHANNEL, { type: "esm", op, data });
}

async function run(op, d) {
  if (op === "esm-set") for (const u of d.uuids ?? []) { const a = resolveActor(u); if (a) await a.setFlag(SYSTEM_ID, "esm", d.f); }
}

/** Машины текущей сцены под глушением: [{ actor, token, f }]. */
function jammed() {
  if (!canvas?.ready) return [];
  return canvas.tokens.placeables.map(t => ({ actor: t.actor, token: t, f: t.actor?.getFlag?.(SYSTEM_ID, "esm") })).filter(x => x.f);
}

/** Снять глушение и сказать в чат. */
async function release(x, why) {
  await x.actor.unsetFlag(SYSTEM_ID, "esm");
  return ChatMessage.create({ speaker: { alias: "AWACS" },
    content: `<div class="tb-card tb-card-esm"><div class="tb-note"><b>${esc(x.token?.name ?? x.actor.name)}</b>: ${esc(TB.systems[x.f.sys]?.label ?? x.f.sys)} снова работает (${esc(why)}).</div></div>` });
}

/** Конец раунда: глушение, которое длилось до него, кончается (и любое от другого боя). Вызывает ведущий из конца раунда. */
export async function endJam(combat, round) {
  for (const x of jammed()) if (x.f.combat !== combat.id || (x.f.until ?? 0) <= round) await release(x, "РЭБ кончилась");
}

let moveTimer = null;
/** Машина вышла из своей и соседних зон от точки включения: система снова работает. */
async function checkJam() {
  for (const x of jammed()) if (!inJam(x.f, x.token)) await release(x, "вышел из зоны глушения");
}

/* ---------- старые тексты на листах ---------- */

/** Тексты эффекта спецоружия на листах пилотов и NPC — по каталогу (раз за версию системы). */
async function refreshFx() {
  const v = game.system?.version;
  if (!v || game.settings.get(SYSTEM_ID, "weaponFxFor") === v) return;
  const { catalog } = await import("./apps/mission-import.mjs");
  const fx = new Map((await catalog()).weapons?.map(w => [w.key, w.fx]) ?? []);
  for (const a of game.actors) {
    const upd = a.items.filter(i => i.type === "weapon" && fx.has(i.system.key) && fx.get(i.system.key) !== i.system.fx).map(i => ({ _id: i.id, "system.fx": fx.get(i.system.key) }));
    if (upd.length) await a.updateEmbeddedDocuments("Item", upd, { tbDossier: true });
  }
  await game.settings.set(SYSTEM_ID, "weaponFxFor", v);
}

export function registerSpecialWeapons() {
  game.settings.register(SYSTEM_ID, "weaponFxFor", { scope: "world", config: false, type: String, default: "" });
  Hooks.once("ready", () => {
    game.socket.on(CHANNEL, msg => { if (msg?.type === "esm" && isLead()) run(msg.op, msg.data ?? {}).catch(err => console.error(`${SYSTEM_ID} | РЭБ`, err)); });
    if (isLead()) refreshFx().catch(err => console.warn(`${SYSTEM_ID} | тексты спецоружия`, err));
  });
  Hooks.on("updateToken", (doc, change, options) => {
    if (options?.tbUndo || !isLead() || !("x" in change || "y" in change || "elevation" in change)) return;
    clearTimeout(moveTimer);
    moveTimer = setTimeout(() => checkJam().catch(err => console.warn(`${SYSTEM_ID} | РЭБ`, err)), 120);
  });
  Hooks.on("deleteCombat", () => { if (isLead()) for (const x of jammed()) release(x, "бой окончен").catch(() => {}); });
}
