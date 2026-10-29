/* Автопилот: отмеченные ведущим машины NPC ходят сами в конце раунда, без заявки и без окон.
   Приказ (кнопка с роботом в меню токена, для всех выделенных сразу):
   - задача: свободная охота (лучшая цель по совету на ход), атаковать цель (щелчок по карте), маршрут (зоны по порядку),
     держать позицию (не двигаться, бить всё, что достаёт);
   - характер: «Напролом» — только задача, без Break!; «Прорыв» — по пути бить тех, кто мешает (своя зона, следующая зона маршрута,
     кто держит на захвате), но не всех подряд; «Осторожно» — Break! от ракет, бить всё, что достаёт, раненым отходить;
   - действий за раунд (1–3) и что делать, когда цель сбита или маршрут пройден.
   Ход: машина в очереди после всех (заявка «авто»), действия идут одно за другим с паузой, чтобы на карте было видно поворот,
   ход, захват и пуск. Ракеты автопилота бьют залпом следующего раунда: цель успевает Break!. Пушка бьёт сразу.
   Ведущему в чат (шёпотом) — сводка хода; на токене у ведущего значок АП, у выделенного — маршрут на сетке. */
import { SYSTEM_ID, TB, sysOff, hasProp } from "./config.mjs";
import { esc, resolveActor } from "./utils.mjs";

/* ---------- приказ ---------- */

export const TASKS = { hunt: "Свободная охота", advance: "Наступление", attack: "Атаковать цель", escort: "Охранять", route: "Маршрут", hold: "Держать позицию" };
/** Задачи с целью, выбранной на карте: атаковать её или охранять. */
const withTarget = task => task === "attack" || task === "escort";
/** Задачи с путём по зонам: маршрут (точно по клеткам) и наступление (общее направление, каждая машина держит своё место в строю). */
export const isRoute = task => task === "route" || task === "advance";
export const MANNERS = {
  rush: { name: "Напролом", hint: "Только задача: по другим не стреляет, от ракет не уходит." },
  push: { name: "Прорыв", hint: "Идёт к задаче и бьёт тех, кто мешает: в своей зоне, на следующем шаге пути и кто держит его на захвате." },
  careful: { name: "Осторожно", hint: "Уходит Break! от ракет, бьёт всё, что достаёт, раненым отходит от врага." }
};
export const AFTER = { hold: "Держать позицию", hunt: "Свободная охота" };
/** Стиль боя: чем бьёт и на какой дистанции держится. «По типу машины»: истребитель — ракетчик, штурмовик и вертолёт — пушкарь, остальные — смешанный. */
export const STYLES = {
  auto: { name: "По типу машины", short: "" },
  missile: { name: "Ракетчик: держит дистанцию, бьёт ракетами", short: "ракетчик" },
  guns: { name: "Пушкарь: сближается и бьёт пушкой", short: "пушкарь" },
  mixed: { name: "Смешанный: ракеты издали, пушка вблизи", short: "смешанный" },
  random: { name: "Случайно: у каждой машины свой", short: "" }
};
/** Какие цели первыми. «По типу машины»: истребитель и ПВО — воздух, штурмовик, бомбардировщик, вертолёт, танк и артиллерия — земля. */
export const PREFS = { auto: "По типу машины", air: "Воздух", ground: "Земля и море", any: "Любые" };

/** Стиль боя машины w ({ kind, grp }) по приказу. */
export function styleOf(order, w) {
  if (["missile", "guns", "mixed"].includes(order?.style)) return order.style;
  if (w?.kind === "air") return w.grp === "fighter" ? "missile" : ["attack", "heli"].includes(w.grp) ? "guns" : "mixed";
  return "mixed";
}
/** Предпочтение целей машины w по приказу: air, ground или any. */
export function preferOf(order, w) {
  if (["air", "ground", "any"].includes(order?.prefer)) return order.prefer;
  if (w?.kind === "air") return w.grp === "fighter" ? "air" : ["attack", "heavy", "heli"].includes(w.grp) ? "ground" : "any";
  if (w?.kind === "ground") return w.grp === "ad" ? "air" : ["armor", "art"].includes(w.grp) ? "ground" : "any";
  return "any";
}

const BLANK = { on: true, task: "hunt", manner: "push", target: "", targetName: "", route: [], step: 0, acts: 0, after: "hold", style: "auto", prefer: "auto" };
export const orderOf = actor => {
  const f = actor?.getFlag?.(SYSTEM_ID, "autopilot");
  return f?.on ? { ...BLANK, ...f, route: [...(f.route ?? [])] } : null;
};
export const autopilotOn = actor => actor?.type === "npc" && !!orderOf(actor);

/** Задача сейчас: цель сбита или маршрут пройден — то, что в приказе «после». */
export function taskNow(order, { targetGone = false } = {}) {
  if (withTarget(order.task) && (targetGone || !order.target)) return order.after;
  if (isRoute(order.task) && order.step >= order.route.length) return order.after;
  return order.task;
}

/** Строка приказа для сводки и подсказок. */
export function orderLine(order) {
  if (!order) return "";
  const t = withTarget(order.task) ? `${order.task === "escort" ? "охранять" : "атаковать"} «${order.targetName || "цель"}»`
    : isRoute(order.task) ? `${order.task === "advance" ? "наступление на" : "маршрут"} ${order.route.length ? order.route.map(cellLabel).join(" → ") : "не задан"}`
      : TASKS[order.task].toLowerCase();
  const style = STYLES[order.style]?.short, pref = PREFS[order.prefer] && !["auto", undefined].includes(order.prefer) ? `цели: ${PREFS[order.prefer].toLowerCase()}` : "";
  return [t, MANNERS[order.manner]?.name.toLowerCase() ?? "", style, pref, order.acts ? `${order.acts} д.` : "действия по совету"].filter(Boolean).join(", ");
}

/* ---------- выбор шага (чистая часть, тесты) ---------- */

/**
 * Следующее действие машины на автопилоте.
 * v (что видно с её места): { flying, systems, incoming, broke, hurt, lock, nearest,
 *   style: missile | guns | mixed (по умолчанию missile); охрана: у кандидатов threat (бьёт или держит на захвате охраняемого, рядом с ним),
 *   goal { kind: "escort", far, icpt } — далеко ли от охраняемого и шаг на перехват угрозы, не отходя от него дальше соседней зоны,
 *   cands: [{ uuid, dist, canMissile, canGuns, gunReach, gunnable, gunship, lockRange, fire, needAlt, blocked, noLock, locksMe, onPath }] — по убыванию ценности,
 *   goal: null | { kind: "target", uuid, dist, want, altStep } | { kind: "cell", reached }, next, away (клетки шага или null),
 *   rail: null | { uuids } (линия EMRG с врагами и без своих), carpet: null | { uuids } (наземка противника под бомбардировщиком) }.
 * failed — UUID целей, по которым это действие в этот ход уже не вышло.
 * Возвращает { act: break | rail | carpet | fire | guns | gunship | lock | climb | dive | move, uuid?, cell?, why } или null (ход окончен).
 */
export function chooseStep(order, v, failed = new Set()) {
  const task = order.taskNow ?? order.task, manner = order.manner;
  if (v.flying && !v.systems && v.incoming > 0 && !v.broke && manner !== "rush") return { act: "break", why: "уход от ракеты" };
  if (manner === "careful" && v.hurt && v.nearest !== null && v.nearest <= 1 && v.away) return { act: "move", cell: v.away, why: "отход: повреждён" };
  // прорыв держит темп: последнее действие хода — шаг вперёд, если за ход ещё не сдвинулся
  if (v.mustMove && v.next) return { act: "move", cell: v.next, why: "держит темп" };
  const goalUuid = v.goal?.kind === "target" ? v.goal.uuid : null;
  let pool = v.cands.filter(c => !failed.has(c.uuid));
  if (task === "attack" || isRoute(task)) {
    if (manner === "rush") pool = pool.filter(c => c.uuid === goalUuid);
    else if (manner === "push") pool = pool.filter(c => c.uuid === goalUuid || c.dist === 0 || c.locksMe || c.onPath);
  }
  // охрана: сначала те, кто угрожает охраняемому; «Напролом» — только они, «Прорыв» — ещё кто рядом и кто держит на захвате
  if (task === "escort") {
    if (manner === "rush") pool = pool.filter(c => c.threat);
    else if (manner === "push") pool = pool.filter(c => c.threat || c.dist === 0 || c.locksMe);
    pool = [...pool.filter(c => c.threat), ...pool.filter(c => !c.threat)];
  }
  pool = [...pool.filter(c => c.uuid === goalUuid), ...pool.filter(c => c.uuid !== goalUuid)];
  // по площади — только если там есть кого бить по характеру приказа
  const worth = area => !!area?.uuids?.some(u => pool.some(c => c.uuid === u));
  if (worth(v.rail)) return { act: "rail", why: "линия" };
  if (worth(v.carpet)) return { act: "carpet", why: "ковёр" };
  const style = v.style ?? "missile";
  for (const c of pool) {
    if (c.dist === null) continue;
    const locked = c.noLock || v.lock === c.uuid;
    // смешанный и пушкарь вблизи бьют пушкой; пушкарь по цели, которую пушка достанет, ракеты не тратит — сближается
    if (style !== "missile" && c.canGuns && c.dist <= (c.gunReach ?? 0) && c.gunFresh !== false) return { act: "guns", uuid: c.uuid, why: "пушка" };
    if (style === "guns" && c.gunnable) continue;
    if (c.canMissile && locked && c.dist <= c.fire && !c.blocked) return { act: "fire", uuid: c.uuid, why: "пуск" };
    if (c.canGuns && c.dist <= (c.gunReach ?? 0)) return { act: "guns", uuid: c.uuid, why: "пушка" };
    if (c.gunship) return { act: "gunship", uuid: c.uuid, why: "бортовые орудия" };
    if (c.canMissile && !locked && c.dist <= c.lockRange) {
      if (c.needAlt) return { act: c.needAlt > 0 ? "climb" : "dive", uuid: c.uuid, why: "высота для захвата" };
      if (!c.blocked) return { act: "lock", uuid: c.uuid, why: "захват" };
    }
  }
  if (task === "hold" || !v.goal) return null;
  if (v.goal.kind === "escort") {
    if (v.goal.far && v.next) return { act: "move", cell: v.next, why: "к охраняемому" };
    if (!v.goal.far && v.goal.icpt) return { act: "move", cell: v.goal.icpt, why: "на перехват" };
    return null;
  }
  if (v.goal.kind === "target") {
    if (v.goal.dist === null || v.goal.dist > v.goal.want) {
      if (v.next) return { act: "move", cell: v.next, why: "к цели" };
      if (v.goal.altStep) return { act: v.goal.altStep > 0 ? "climb" : "dive", why: "к цели по высоте" };
      return null;
    }
    if (manner === "careful" && v.goal.dist === 0 && v.away) return { act: "move", cell: v.away, why: "держит дистанцию" };
    return null;
  }
  if (!v.goal.reached && v.next) return { act: "move", cell: v.next, why: "по маршруту" };
  return null;
}

/**
 * Шаг в соседнюю клетку (8 направлений) к цели: ближе по Чебышёву, при равенстве — по прямой.
 * allowed(c, r) — можно ли туда; cost(c, r) — надбавка к пути (теснота: свои в зоне), чтобы машины не сбивались в кучу.
 */
export function stepToward([c0, r0], [c1, r1], allowed = () => true, cost = () => 0) {
  if (c0 === c1 && r0 === r1) return null;
  const cheb = (c, r) => Math.max(Math.abs(c1 - c), Math.abs(r1 - r));
  const now = cheb(c0, r0);
  let best = null;
  for (const dc of [-1, 0, 1]) for (const dr of [-1, 0, 1]) {
    if (!dc && !dr) continue;
    const c = c0 + dc, r = r0 + dr;
    const d = cheb(c, r), e = Math.hypot(c1 - c, r1 - r) + cost(c, r);
    if (d >= now || !allowed(c, r)) continue;
    if (!best || d < best.d || (d === best.d && e < best.e)) best = { c, r, d, e };
  }
  return best ? [best.c, best.r] : null;
}

/** Шаг прочь от врагов: соседняя клетка, где ближайший враг дальше всего. */
export function stepAway([c0, r0], foes, allowed = () => true) {
  if (!foes.length) return null;
  const near = (c, r) => Math.min(...foes.map(([fc, fr]) => Math.max(Math.abs(fc - c), Math.abs(fr - r))));
  let best = null;
  const now = near(c0, r0);
  for (const dc of [-1, 0, 1]) for (const dr of [-1, 0, 1]) {
    if (!dc && !dr) continue;
    const c = c0 + dc, r = r0 + dr, d = near(c, r);
    if (d <= now || !allowed(c, r)) continue;
    if (!best || d > best.d) best = { c, r, d };
  }
  return best ? [best.c, best.r] : null;
}

/* ---------- что видно с места машины ---------- */

const DEAD = () => CONFIG.specialStatusEffects?.DEFEATED ?? "dead";
const gone = a => !a || a.statuses?.has?.(DEAD()) || a.statuses?.has?.("retreat") || !!a.system?.markers?.doom;
const cellKey = ([c, r]) => `${c},${r}`;
const parseCell = k => String(k).split(",").map(Number);

function cellLabel(k) {
  try {
    const [c, r] = parseCell(k), b = bounds();
    return b ? `${"АБВГДЕЖЗИКЛМНОПРСТУФХЦЧШЭЮЯ"[c - b.c0] ?? "?"}${r - b.r0 + 1}` : k;
  } catch { return k; }
}
function bounds() {
  const r = canvas?.dimensions?.sceneRect, gs = canvas?.grid?.size;
  if (!r || !gs) return null;
  return { c0: Math.floor(r.x / gs), r0: Math.floor(r.y / gs), c1: Math.floor((r.x + r.width - 1) / gs), r1: Math.floor((r.y + r.height - 1) / gs) };
}

/** Ракеты в воздухе по этой машине (отложенные карточки текущего боя). */
function incoming(actor) {
  const c = game.combat;
  if (!c?.started) return 0;
  return (game.messages?.contents ?? []).slice(-300).filter(m => {
    const card = m.getFlag?.(SYSTEM_ID, "card");
    return card?.delayed && card.targetUuid === actor.uuid && card.combatKey === `${c.id}:${c.round}` && !card.resolved && !card.dmgApplied;
  }).length;
}

/** Кто пустил ракеты, что ещё летят в эту машину (UUID стрелков). */
function shootersAt(uuid) {
  const c = game.combat, out = new Set();
  if (!c?.started) return out;
  for (const m of (game.messages?.contents ?? []).slice(-300)) {
    const card = m.getFlag?.(SYSTEM_ID, "card");
    if (card?.delayed && card.targetUuid === uuid && String(card.combatKey).startsWith(`${c.id}:`) && !card.resolved && !card.dmgApplied) out.add(card.actorUuid);
  }
  return out;
}

/** Ракетная система корабля или босса против цели этого вида: { i, lock } или null. */
function sysFor(actor, kind, used = new Set()) {
  const list = actor.system.systems ?? [];
  const ok = list.map((y, i) => i).filter(i => (list[i].value ?? 0) > 0 && Number.isFinite(kind === "air" ? list[i].ga : list[i].gg));
  const i = ok.find(i => !used.has(i)) ?? ok[0];
  return i === undefined ? null : { i, lock: /Lock On/i.test(list[i].note ?? "") };
}

/** Пушечная система корабля или босса против цели этого вида на dist зон: { i, reach } (сначала не стрелявшая в этот ход, потом сильнейшая) или null. */
function gunFor(S, actor, kind, dist, used = new Set()) {
  if (dist === null) return null;
  const opts = (actor.system.systems ?? []).map((y, i) => ({ y: S.gunSys(actor, y), i }))
    .filter(o => (o.y.value ?? 0) > 0 && (o.y.gun ?? 0) > 0 && [kind, "any"].includes(S.gunVs(actor, o.y)) && dist <= S.sysGunReach(o.y))
    .sort((a, b) => (used.has(a.i) - used.has(b.i)) || b.y.gun - a.y.gun);
  return opts.length ? { i: opts[0].i, reach: S.sysGunReach(opts[0].y) } : null;
}

/** Лучшая линия EMRG: больше всего врагов (цель задачи — с запасом), своих на линии нет. { id, pick, uuids } или null. */
async function railFor(S, R, actor, token, goalUuid) {
  if (sysOff(actor.system, "sw")) return null;
  const w = actor.items.find(i => i.type === "weapon" && i.system.target === "line" && R.weaponReady(i));
  if (!w) return null;
  const SW = await import("./special-weapons.mjs");
  let best = null;
  for (const [pick, ln] of Object.entries(SW.railLines(actor, token) ?? {})) {
    const foes = ln.units.filter(u => { const a = resolveActor(u.uuid); return a && !gone(a) && S.canFireAt(actor, a); });
    if (!foes.length || foes.length < ln.units.length) continue;
    const score = foes.length + (foes.some(u => u.uuid === goalUuid) ? 2 : 0);
    if (!best || score > best.score) best = { id: w.id, pick, uuids: foes.map(u => u.uuid), score };
  }
  return best;
}

async function viewOf(actor, token, order, state) {
  const S = await import("./scene.mjs"), R = await import("./dice/rolls.mjs"), A = await import("./npc-advice.mjs");
  const s = actor.system, me = S.cellOf(token);
  if (!me) return null;
  const here = [me.col, me.row];
  const systems = (s.systems?.length ?? 0) > 0;
  const b = bounds();
  const doc = token.document, gs = canvas.grid.size;
  const allowed = (c, r) => (!b || (c >= b.c0 && c <= b.c1 && r >= b.r0 && r <= b.r1))
    && !S.landBlocked(doc, { x: doc.x + (c - here[0]) * gs, y: doc.y + (r - here[1]) * gs });
  // цели: совет на ход NPC плюс цель приказа, даже если это здание или гражданский
  const list = A.candidates(actor, token).filter(x => !x.ban.length);
  const tgt = order.target ? resolveActor(order.target) : null;
  const tgtTok = tgt && !gone(tgt) ? S.tokenOf(tgt) : null;
  if (order.task === "attack" && tgtTok && !list.some(x => x.actor.uuid === tgt.uuid) && S.canFireAt(actor, tgt)) {
    const info = R.describeTarget(tgt, tgtTok.name, tgtTok), kind = S.isAirTarget(info) ? "air" : "ground", dist = S.zoneDistance(token, tgtTok);
    list.unshift({ token: tgtTok, actor: tgt, info, kind, dist, canMissile: R.strikeMeans(actor, kind).length > 0, canGuns: dist === 0 && !systems, score: 0 });
  }
  // предпочтение целей: подходящие по виду первыми (порядок совета внутри сохраняется)
  const w = { kind: s.kind, grp: s.grp }, pref = preferOf(order, w), style = styleOf(order, w);
  if (pref !== "any") list.sort((a, b) => (b.kind === pref) - (a.kind === pref));
  const gunsVs = systems ? null : S.gunVs(actor, null), gunsOk = !systems && !sysOff(s, "gu") && ((s.kind === "ground" ? s.ground?.gun : s.gun) ?? 0) > 0;
  const taskNowV = taskNow(order, { targetGone: withTarget(order.task) && !tgtTok });
  // охрана: кто бьёт охраняемого (ракеты в воздухе по нему) или держит его на захвате, и кто рядом с ним
  const ward = taskNowV === "escort" && tgtTok ? tgtTok : null;
  const wardFoes = ward ? shootersAt(tgt.uuid) : new Set();
  // клетка следующего шага пути: нужна, чтобы «Прорыв» знал, кто мешает
  let goal = null, goalCell = null;
  if ((taskNowV === "attack" || taskNowV === "escort") && tgtTok) {
    const c = S.cellOf(tgtTok);
    goalCell = [c.col, c.row];
  } else if (isRoute(taskNowV)) {
    goalCell = parseCell(order.route[order.step]);
  } else if (taskNowV === "hunt" && list.length) {
    const c = S.cellOf(list[0].token);
    goalCell = [c.col, c.row];
  }
  // теснота: сколько своих уже в зоне (кроме самой машины)
  const crowd = new Map();
  for (const t of canvas.tokens?.placeables ?? []) {
    if (t === token || !t.actor || gone(t.actor) || S.canFireAt(actor, t.actor)) continue;
    const k = S.cellOf(t);
    if (k) crowd.set(`${k.col},${k.row}`, (crowd.get(`${k.col},${k.row}`) ?? 0) + 1);
  }
  const next = goalCell ? stepToward(here, goalCell, allowed, (c, r) => 0.35 * (crowd.get(`${c},${r}`) ?? 0)) : null;
  const used = state.used ?? new Set();
  const gunshipAt = hasProp(actor, "gunship") ? new Set(R.groundTargets(actor, 1)) : new Set();
  const cands = list.map(x => {
    const air = x.kind === "air", sp = systems ? sysFor(actor, x.kind, used) : null;
    const gs = systems ? gunFor(S, actor, x.kind, x.dist, used) : null;
    const lockRange = R.lockRangeOf(actor, x.kind).range;
    // высота мешает захвату: шаг Climb / Dive к цели (как в совете на ход)
    let needAlt = 0, blocked = false;
    if (S.isFlying(actor) && !S.flyingBoss(actor)) {
      const { problems } = S.reachProblems(actor, x.info, 99, { strike: true });
      const altBad = problems.filter(p => /Высок|Низк|стратосфер/.test(p));
      if (altBad.length) {
        const mine = S.ALT_ORDER.indexOf(S.altOf(token, actor)), want = air ? S.ALT_ORDER.indexOf(S.altOf(x.token, x.actor)) : S.ALT_ORDER.indexOf("med");
        needAlt = Math.sign(want - mine);
        if (needAlt > 0 && S.climbProblem(actor, S.ALT_ORDER[mine + 1])) { needAlt = 0; blocked = true; }
      }
      if (problems.length > altBad.length && problems.some(p => !/Высок|Низк|стратосфер|зон/.test(p))) blocked = true;
    }
    const c = S.cellOf(x.token);
    const lockedOn = x.actor.system?.lockUuid ? resolveActor(x.actor.system.lockUuid) : null;
    // ЗРК и корабли — по описанию системы; G-G наземки по наземной цели — без захвата
    const noLock = systems ? !!sp && !sp.lock : s.kind === "ground" && x.kind === "ground";
    return {
      uuid: x.actor.uuid, dist: x.dist, tok: x.token,
      // корабль: ракетная система уже стреляла в этот ход, а пушка ещё нет — сначала пушка
      canMissile: systems ? !!sp && (!used.has(sp.i) || !gs || used.has(gs.i)) : !!x.canMissile, canGuns: systems ? !!gs : !!x.canGuns, sys: sp?.i ?? null,
      gunSys: gs?.i ?? null, gunReach: gs?.reach ?? TB.range.guns, gunship: gunshipAt.has(x.actor.uuid), gunFresh: !gs || !used.has(gs.i),
      gunnable: gunsOk && x.info.kind !== "ship" && x.info.defense !== null && x.info.defense !== undefined && [x.kind, "any"].includes(gunsVs),
      noLock,
      // прямой выстрел без захвата — на дальность захвата; спецоружие бьёт дальше стандартной ракеты: дальность того, что пойдёт в пуск
      lockRange, fire: noLock ? lockRange : !systems && R.autoWeapon(actor, x.kind, x.dist) ? Math.max(x.dist ?? 0, TB.range.missile) : TB.range.missile, needAlt, blocked,
      locksMe: !!lockedOn && (lockedOn === actor || lockedOn.uuid === actor.uuid),
      threat: !!ward && ((!!lockedOn && (lockedOn === tgt || lockedOn.uuid === tgt.uuid)) || wardFoes.has(x.actor.uuid) || (S.zoneDistance(x.token, ward) ?? 99) <= 1),
      onPath: !!next && !!c && c.col === next[0] && c.row === next[1]
    };
  });
  if (taskNowV === "attack" && tgtTok) {
    const d = S.zoneDistance(token, tgtTok), x = cands.find(c => c.uuid === tgt.uuid);
    const want = x?.canMissile && !(style === "guns" && x.gunnable) ? Math.min(x.lockRange, TB.range.missile) : 0;
    const tc = S.cellOf(tgtTok);
    const sameCell = tc.col === here[0] && tc.row === here[1];
    const altStep = sameCell && S.isFlying(actor) && S.isAirTarget(R.describeTarget(tgt, tgtTok.name, tgtTok))
      ? Math.sign(S.ALT_ORDER.indexOf(S.altOf(tgtTok, tgt)) - S.ALT_ORDER.indexOf(S.altOf(token, actor))) : 0;
    goal = { kind: "target", uuid: tgt.uuid, dist: d, want, altStep };
  } else if (taskNowV === "hunt" && list.length) {
    const x = cands[0];
    goal = { kind: "target", uuid: x.uuid, dist: x.dist, want: x.canMissile && !(style === "guns" && x.gunnable) ? Math.min(x.lockRange, TB.range.missile) : 0, altStep: 0 };
  } else if (ward) {
    // перехват: шаг к ближайшей угрозе вне досягаемости, если он не уводит дальше соседней с охраняемым зоны
    const cheb = ([c1, r1], [c2, r2]) => Math.max(Math.abs(c1 - c2), Math.abs(r1 - r2));
    const far = cheb(here, goalCell) > 1;
    const th = cands.filter(c => c.threat && c.dist !== null && c.dist > Math.max(c.canMissile ? c.lockRange : 0, c.gunReach ?? 0)).sort((a, b) => a.dist - b.dist)[0];
    const tc = th ? S.cellOf(th.tok) : null;
    const icpt = tc && !far ? stepToward(here, [tc.col, tc.row], (c, r) => allowed(c, r) && cheb([c, r], goalCell) <= 1) : null;
    goal = { kind: "escort", far, icpt };
  } else if (isRoute(taskNowV)) goal = { kind: "cell", reached: !goalCell || (goalCell[0] === here[0] && goalCell[1] === here[1]) };
  const foes = cands.map(c => { const k = S.cellOf(c.tok); return k ? [k.col, k.row] : null; }).filter(Boolean);
  const hp = s.hp ?? {};
  const rail = used.has("rail") ? null : await railFor(S, R, actor, token, goal?.uuid ?? null);
  const carpet = !used.has("carpet") && hasProp(actor, "carpet") ? { uuids: R.groundTargets(actor, 0) } : null;
  return {
    rail, carpet: carpet?.uuids.length ? carpet : null, style,
    mustMove: isRoute(taskNowV) && order.manner === "push" && !state.moved && state.left === 1,
    flying: S.isFlying(actor), systems, incoming: incoming(actor), broke: state.broke, lock: s.lockUuid || null,
    hurt: !!s.markers?.structure || (hp.max > 1 && hp.value <= Math.ceil(hp.max / 2)),
    nearest: cands.length ? Math.min(...cands.map(c => c.dist ?? 99)) : null,
    cands, goal, next, away: stepAway(here, foes, allowed), taskNow: taskNowV, here
  };
}

/* ---------- ход ---------- */

/** Пауза между действиями (доля): чтобы на карте было видно каждое; тесты ставят 0. */
export const pace = { k: 1 };
const wait = ms => new Promise(r => setTimeout(r, ms * pace.k));
const ACT = { break: "Break!", fire: "Fox Two!", guns: "Guns", lock: "Lock On!", climb: "Climb", dive: "Dive", move: "Move", rail: "EMRG", carpet: "Ковровая бомбардировка", gunship: "Бортовые орудия" };
/** Действия, у которых результат — карточка: пустой ответ значит, что не вышло. */
const SHOTS = new Set(["break", "fire", "guns", "gunship", "rail", "carpet"]);
/** Перед этими действиями самолёт перестраивается в своей зоне: заход на цель, уход от ракеты. */
const JINK = new Set(["break", "lock", "fire", "guns", "gunship", "rail", "carpet"]);

/** Ход машины на автопилоте (клиент ведущего). Возвращает строки сводки. */
export async function runAutopilot(actor, token = null) {
  const S = await import("./scene.mjs"), R = await import("./dice/rolls.mjs");
  token ??= S.tokenOf(actor);
  let order = orderOf(actor);
  if (!order || !token || token.document.hidden || gone(actor) || !canvas?.ready) return [];
  const state = { broke: false, used: new Set(), side: 1, moved: false, left: 0 }, failed = new Set(), log = [];
  const acts = order.acts ? Math.max(1, Math.min(3, order.acts)) : await adviceActs(actor, token, order);
  for (let i = 0; i < acts; i++) {
    state.left = acts - i;
    // маршрут: дошёл до точки — следующая
    if (isRoute(order.task) && order.step < order.route.length) {
      const k = S.cellOf(token);
      if (k && cellKey([k.col, k.row]) === order.route[order.step]) {
        order.step += 1;
        await actor.setFlag(SYSTEM_ID, "autopilot", { ...actor.getFlag(SYSTEM_ID, "autopilot"), step: order.step });
      }
    }
    const v = await viewOf(actor, token, order, state);
    if (!v) break;
    const step = chooseStep({ ...order, taskNow: v.taskNow }, v, failed);
    if (!step) break;
    const c = step.uuid ? v.cands.find(x => x.uuid === step.uuid) : null;
    const name = c?.tok?.name ?? "";
    // самолёт не стоит на месте: перед выстрелом заходит на цель по своей зоне, от ракеты уходит в дальний угол
    if (JINK.has(step.act) && !v.systems && (v.flying || step.act === "guns")) await jink(token, c?.tok ?? null, state, step.act === "break");
    let res = null;
    switch (step.act) {
      case "break": res = await R.autoBreak(actor); state.broke = true; break;
      case "lock": res = await R.autoLock(actor, c.tok); break;
      case "fire": res = await R.autoFox(actor, c.tok, { sys: c.sys }); if (c.sys !== null) state.used.add(c.sys); break;
      case "guns":
        res = c.gunSys !== null ? await R.autoSysGun(actor, c.tok, c.gunSys) : await R.autoGuns(actor, c.tok);
        if (c.gunSys !== null) state.used.add(c.gunSys);
        break;
      case "gunship": res = await R.autoGunship(actor, c.tok); break;
      case "rail": res = await R.autoRail(actor, actor.items.get(v.rail.id), v.rail.pick); state.used.add("rail"); break;
      case "carpet": res = await R.autoCarpet(actor); state.used.add("carpet"); break;
      case "climb": case "dive": res = await climb(actor, token, step.act === "climb" ? 1 : -1); break;
      case "move": res = await move(token, v.here, step.cell); if (!res) { state.moved = true; await regainSpeed(actor); } break;
    }
    if (!res && SHOTS.has(step.act)) res = "не прошло";
    const card = typeof res === "object" ? res?.getFlag?.(SYSTEM_ID, "card") : null;
    const what = card?.label && step.act !== "break" ? card.label : step.act === "fire" && actor.system.kind !== "air" ? "Пуск" : ACT[step.act];
    // строка — почему не вышло: эту цель (или этот шаг) больше не пробуем, действие не тратится один раз
    if (typeof res === "string") {
      if (step.uuid) failed.add(step.uuid);
      log.push(`${what}${name ? ` «${name}»` : ""}: не вышло (${res})`);
      if ((!step.uuid && !["rail", "carpet"].includes(step.act)) || failed.size > 4) break;
      i -= 1;
      continue;
    }
    log.push(`${what}${name ? ` «${name}»` : step.cell ? ` → ${cellLabel(cellKey(step.cell))}` : ""}`);
    await wait(step.act === "move" ? 750 : step.act === "fire" ? 1000 : 550);
  }
  await summary(actor, token, order, log);
  return log;
}

/**
 * Манёвр в своей зоне (по правилам бесплатно): на свободное место сбоку от цели — заход по кругу, раз в одну сторону, раз в другую;
 * evade — в самое дальнее место (Break!). Курс токен берёт сам по движению.
 */
async function jink(token, target, state, evade = false) {
  const { freeSlots } = await import("./tokens.mjs");
  const doc = token.document, slots = freeSlots(doc);
  if (!slots.length) return;
  const gs = canvas.grid.size, hw = (doc.width * gs) / 2, hh = (doc.height * gs) / 2;
  const c0 = { x: doc.x + hw, y: doc.y + hh }, tc = target?.center;
  const u = tc ? { x: tc.x - c0.x, y: tc.y - c0.y } : null, ul = u ? Math.hypot(u.x, u.y) : 0;
  state.side = -(state.side ?? 1);
  let best = null;
  for (const p of slots) {
    const d = { x: p.x + hw - c0.x, y: p.y + hh - c0.y }, len = Math.hypot(d.x, d.y) || 1;
    // поперёк линии на цель, чуть к ней; без цели и от ракеты — подальше
    const score = evade || ul < 1 ? len
      : ((d.x * -u.y + d.y * u.x) * state.side) / (ul * len) + (0.3 * (d.x * u.x + d.y * u.y)) / (ul * len);
    if (!best || score > best.score) best = { p, score };
  }
  await doc.update({ x: best.p.x, y: best.p.y }, { tbAuto: true });
  await wait(450);
}

/** Действий за ход по совету на ход NPC (как в заявке ведущего); на пути — не меньше двух: шаг и выстрел. */
async function adviceActs(actor, token, order) {
  let n = null;
  try { n = (await import("./npc-advice.mjs")).adviseNpc(actor, token)?.declare ?? null; } catch { n = null; }
  n = Number.isInteger(n) && n >= 1 && n <= 3 ? n : 2;
  return isRoute(taskNow(order)) && n < 2 ? 2 : n;
}

/**
 * Наступление строем: путь группы (клетки) для каждой машины сдвигается на её место относительно середины группы.
 * cells — клетки машин [[c, r]], route — общий путь ["c,r"], bounds — края сцены { c0, r0, c1, r1 } или null.
 */
export function formationRoutes(cells, route, bounds = null) {
  if (!cells.length) return [];
  const mc = Math.round(cells.reduce((s, [c]) => s + c, 0) / cells.length), mr = Math.round(cells.reduce((s, [, r]) => s + r, 0) / cells.length);
  const clamp = (v, a, b) => (bounds ? Math.max(a, Math.min(b, v)) : v);
  return cells.map(([c, r]) => route.map(k => {
    const [rc, rr] = parseCell(k);
    return `${clamp(rc + c - mc, bounds?.c0, bounds?.c1)},${clamp(rr + r - mr, bounds?.r0, bounds?.r1)}`;
  }));
}

async function move(token, from, to) {
  const doc = token.document, gs = canvas.grid.size;
  const r = await doc.update({ x: doc.x + (to[0] - from[0]) * gs, y: doc.y + (to[1] - from[1]) * gs }, { tbAuto: true });
  return r ? null : "переход не прошёл";
}
/** После Break! Speed падает до сваливания; смена скорости при Move бесплатна — самолёт на автопилоте с переходом выходит на Speed 1. */
async function regainSpeed(actor) {
  if (actor.system.kind === "air" && (actor.system.speed ?? 0) < 1) await actor.update({ "system.speed": 1 }, { tbFree: true });
}
async function climb(actor, token, dir) {
  const S = await import("./scene.mjs");
  const cur = S.ALT_ORDER.indexOf(S.altOf(token, actor)), to = S.ALT_ORDER[cur + dir];
  if (!to) return "дальше некуда";
  const p = S.climbProblem(actor, to);
  if (p) return p;
  await token.document.update({ elevation: TB.altElevation[to] }, { tbAuto: true });
  return null;
}

/** Сводка ведущему: одна карточка на раунд боя, машины дописываются в неё по очереди (вне боя — карточка на машину). */
async function summary(actor, token, order, log) {
  const c = game.combat, key = c?.started ? `${c.id}:${c.round}` : null, msg = key ? lastSummary(key) : null;
  const rows = [...(msg?.getFlag(SYSTEM_ID, "apSummary").rows ?? []),
    { name: token.name, order: orderLine(order), log: log.length ? log : ["Делать нечего: целей в досягаемости нет."] }];
  const content = `<div class="tb-card tb-card-round"><header class="tb-card-head"><span class="tb-card-who">Автопилот</span><span class="tb-card-what">${key ? `Раунд ${c.round}` : esc(token.name)}</span></header>
    ${rows.map(r => `<div class="tb-note"><b>${esc(r.name)}</b> · ${esc(r.order)}<br>${r.log.map(esc).join("<br>")}</div>`).join("")}</div>`;
  if (msg) return msg.update({ content, [`flags.${SYSTEM_ID}.apSummary.rows`]: rows });
  await ChatMessage.create({
    speaker: { alias: "Автопилот" }, whisper: game.users.filter(u => u.isGM).map(u => u.id), content,
    flags: { [SYSTEM_ID]: { apSummary: { key, rows } } }
  });
}
/** Карточка сводки этого раунда, если она последняя из сводок в недавнем чате. */
function lastSummary(key) {
  const m = game.messages.contents.slice(-60).reverse().find(x => x.getFlag(SYSTEM_ID, "apSummary"));
  return m?.getFlag(SYSTEM_ID, "apSummary").key === key ? m : null;
}

/* ---------- окно приказа ---------- */

/** Окно приказа для токенов (все выделенные NPC). */
export async function orderDialog(tokens) {
  tokens = tokens.filter(t => t.actor?.type === "npc");
  if (!tokens.length) return ui.notifications.warn("Автопилот: выделите машины NPC.");
  const { formDialog } = await import("./dice/rolls.mjs");
  const o = orderOf(tokens[0].actor) ?? { ...BLANK, on: false };
  const opt = (obj, cur) => Object.entries(obj).map(([k, v]) => `<option value="${k}" ${k === cur ? "selected" : ""}>${esc(v.name ?? v)}</option>`).join("");
  const names = tokens.map(t => t.name).join(", ");
  const content = `
    <p class="tb-hint">${esc(names)}. Машины на автопилоте не заявляются и ходят сами в конце раунда.</p>
    <div class="form-group"><label>Автопилот</label><input type="checkbox" name="on" ${o.on || !orderOf(tokens[0].actor) ? "checked" : ""}></div>
    <div class="form-group"><label>Задача</label><select name="task">${opt(TASKS, o.task)}</select></div>
    <div class="form-group tb-ap-target"><label class="tb-ap-tlabel">Цель</label><input type="hidden" name="target" value="${esc(o.target)}"><input type="hidden" name="targetName" value="${esc(o.targetName)}">
      <span class="tb-ap-tname">${esc(o.targetName || "не выбрана")}</span> <button type="button" data-ap-pick><i class="fas fa-crosshairs"></i> На карте</button></div>
    <div class="form-group tb-ap-route"><label class="tb-ap-rlabel">Маршрут</label><input type="hidden" name="route" value="${esc(o.route.join(";"))}">
      <span class="tb-ap-rname">${esc(o.route.length ? o.route.map(cellLabel).join(" → ") : "не задан")}</span> <button type="button" data-ap-route><i class="fas fa-route"></i> Проложить</button></div>
    <div class="form-group"><label>Характер</label><select name="manner">${opt(MANNERS, o.manner)}</select></div>
    <p class="tb-hint tb-ap-mhint">${esc(MANNERS[o.manner].hint)}</p>
    <p class="tb-hint tb-ap-advhint">Наступление: щёлкните, куда идти группе (можно несколько точек). Каждая машина держит своё место в строю и бьёт по пути по характеру приказа.</p>
    <div class="form-group"><label>Стиль боя</label><select name="style">${opt(STYLES, o.style)}</select></div>
    <div class="form-group"><label>Цели первыми</label><select name="prefer">${opt(PREFS, o.prefer)}</select></div>
    <div class="form-group"><label>Действий за раунд</label><select name="acts"><option value="0" ${!o.acts ? "selected" : ""}>По совету на ход</option>${[1, 2, 3].map(n => `<option value="${n}" ${n === o.acts ? "selected" : ""}>${n}</option>`).join("")}</select></div>
    <div class="form-group"><label>Когда цель сбита или маршрут пройден</label><select name="after">${opt(AFTER, o.after)}</select></div>`;
  const render = root => {
    const f = root.querySelector("form");
    const show = () => {
      const task = f.task.value;
      root.querySelector(".tb-ap-target").style.display = withTarget(task) ? "" : "none";
      root.querySelector(".tb-ap-tlabel").textContent = task === "escort" ? "Кого охранять" : "Цель";
      root.querySelector(".tb-ap-route").style.display = isRoute(task) ? "" : "none";
      root.querySelector(".tb-ap-advhint").style.display = task === "advance" ? "" : "none";
      root.querySelector(".tb-ap-rlabel").textContent = task === "advance" ? "Направление" : "Маршрут";
      root.querySelector(".tb-ap-mhint").textContent = MANNERS[f.manner.value].hint;
    };
    f.task.addEventListener("change", show);
    f.manner.addEventListener("change", show);
    show();
    root.querySelector("[data-ap-pick]").addEventListener("click", async () => {
      const { pickTargetToken } = await import("./pick.mjs");
      const t = await pickTargetToken(tokens[0].actor, f.task.value === "escort"
        ? { title: "Автопилот: кого охранять", hint: "Щёлкните по токену машины, которую охранять." }
        : { title: "Автопилот: цель", hint: "Щёлкните по токену цели задачи." });
      if (!t) return;
      f.target.value = t.actor.uuid; f.targetName.value = t.name;
      root.querySelector(".tb-ap-tname").textContent = t.name;
    });
    root.querySelector("[data-ap-route]").addEventListener("click", async () => {
      const route = await pickRoute(f.route.value ? f.route.value.split(";") : []);
      if (!route) return;
      f.route.value = route.join(";");
      root.querySelector(".tb-ap-rname").textContent = route.length ? route.map(cellLabel).join(" → ") : "не задан";
    });
  };
  const data = await formDialog("Автопилот: приказ", content, { ok: "Отдать приказ", width: 460, render });
  if (!data) return;
  if (withTarget(data.task) && !data.target) ui.notifications.warn(data.task === "escort" ? "Автопилот: не выбрано, кого охранять, пока машины держат позицию." : "Автопилот: цель задачи не выбрана, пока машины в свободной охоте.");
  const order = {
    on: !!data.on, task: withTarget(data.task) && !data.target ? (data.task === "escort" ? "hold" : "hunt") : data.task, manner: data.manner, acts: Number(data.acts) || 0, after: data.after,
    target: data.target, targetName: data.targetName, route: data.route ? data.route.split(";").filter(Boolean) : [], step: 0,
    style: STYLES[data.style] ? data.style : "auto", prefer: PREFS[data.prefer] ? data.prefer : "auto"
  };
  // случайный стиль: у каждой машины свой, раз и до нового приказа
  const pickStyle = () => (order.style === "random" ? ["missile", "guns", "mixed"][Math.floor(Math.random() * 3)] : order.style);
  // наступление: у каждой машины свой путь — общий, сдвинутый на её место в строю
  const S = await import("./scene.mjs");
  const routes = order.task === "advance" ? formationRoutes(tokens.map(t => { const k = S.cellOf(t); return k ? [k.col, k.row] : [0, 0]; }), order.route, bounds()) : null;
  for (const [n, t] of tokens.entries()) await t.actor.setFlag(SYSTEM_ID, "autopilot", { ...order, style: pickStyle(), ...(routes ? { route: routes[n] } : {}) });
  ui.notifications.info(order.on ? `Автопилот: ${names} — ${orderLine(order)}.` : `Автопилот выключен: ${names}.`);
}

/** Маршрут: щелчки по зонам по порядку; правая кнопка — убрать последнюю; Enter или «Готово» — конец, Esc — отмена. */
export async function pickRoute(start = []) {
  const { showModeBar } = await import("./mode-bar.mjs");
  const route = [...start], view = canvas.app.view;
  const paint = () => highlight(route);
  paint();
  return new Promise(resolve => {
    const mb = showModeBar({ title: "Автопилот: маршрут", text: "Щёлкайте по зонам по порядку. Правая кнопка — убрать последнюю.",
      buttons: [{ label: "Очистить", icon: "fa-eraser", onClick: () => { route.length = 0; paint(); } },
        { label: "Готово", icon: "fa-check", primary: true, onClick: () => finish(route) }, { label: "Отмена", icon: "fa-xmark", onClick: () => finish(null) }] });
    const finish = r => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("contextmenu", onCtx, true);
      window.removeEventListener("keydown", onKey, true);
      mb.close(); highlight(null);
      resolve(r ? [...r] : null);
    };
    const onDown = ev => {
      if (ev.target !== view) return;
      ev.stopImmediatePropagation(); ev.preventDefault();
      if (ev.button === 2) { route.pop(); return paint(); }
      if (ev.button !== 0) return;
      const rect = view.getBoundingClientRect();
      const p = canvas.canvasCoordinatesFromClient?.({ x: ev.clientX, y: ev.clientY }) ?? canvas.stage.worldTransform.applyInverse({ x: ev.clientX - rect.left, y: ev.clientY - rect.top });
      const o = canvas.grid.getOffset(p), k = `${o.j},${o.i}`;
      if (route.at(-1) !== k) route.push(k);
      paint();
    };
    const onCtx = ev => { if (ev.target === view) { ev.stopImmediatePropagation(); ev.preventDefault(); } };
    const onKey = ev => {
      if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); finish(null); }
      else if (ev.key === "Enter") { ev.preventDefault(); ev.stopPropagation(); finish(route); }
    };
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("contextmenu", onCtx, true);
    window.addEventListener("keydown", onKey, true);
  });
}

const LAYER = "tb-autoroute";
/** Подсветить маршрут на сетке (null — убрать). */
function highlight(route) {
  const grid = canvas?.ready ? canvas.interface?.grid : null;
  if (!grid) return;
  grid.addHighlightLayer(LAYER);
  grid.clearHighlightLayer(LAYER);
  (route ?? []).forEach((k, i) => {
    const [j, r] = parseCell(k), p = canvas.grid.getTopLeftPoint({ i: r, j });
    const k2 = i / Math.max(1, route.length - 1);
    grid.highlightPosition(LAYER, { x: p.x, y: p.y, color: 0x7fd8ff, border: 0x7fd8ff, alpha: 0.18 + 0.2 * k2 });
  });
}

/* ---------- меню токена, значок и маршрут выделенного ---------- */

export function registerAutopilot() {
  Hooks.on("renderTokenHUD", (hud, html) => {
    const token = hud.object;
    if (!game.user.isGM || token?.actor?.type !== "npc") return;
    const col = (html[0] ?? html).querySelector(".col.left");
    if (!col) return;
    const b = document.createElement("div");
    b.className = `control-icon tb-autopilot${autopilotOn(token.actor) ? " active" : ""}`;
    b.title = autopilotOn(token.actor) ? `Автопилот: ${orderLine(orderOf(token.actor))}` : "Автопилот: приказ машине (всем выделенным)";
    b.innerHTML = `<i class="fas fa-robot"></i>`;
    b.addEventListener("click", ev => {
      ev.preventDefault(); ev.stopPropagation();
      const list = token.controlled ? canvas.tokens.controlled : [token];
      hud.clear();
      orderDialog(list).catch(err => console.error(`${SYSTEM_ID} | автопилот`, err));
    });
    col.append(b);
  });
  Hooks.on("refreshToken", (t, flags) => { if (!flags || flags.refreshState || flags.redraw || flags.refreshSize) badge(t); });
  for (const ev of ["updateActor", "updateActorDelta"]) Hooks.on(ev, () => refreshSoon());
  Hooks.on("canvasReady", () => refreshSoon());
  Hooks.on("controlToken", (t, on) => {
    if (!game.user.isGM) return;
    const o = on ? orderOf(t.actor) : null;
    highlight(isRoute(o?.task) ? o.route.slice(o.step) : null);
  });
}
let timer = null;
function refreshSoon() { clearTimeout(timer); timer = setTimeout(() => { for (const t of canvas?.tokens?.placeables ?? []) badge(t); }, 80); }

/** Значок АП в углу токена: только ведущему. */
function badge(t) {
  let g = t.tbAutoBadge;
  const on = game.user.isGM && autopilotOn(t.actor);
  if (!on) { if (g && !g.destroyed) g.visible = false; return; }
  if (!g || g.destroyed) {
    g = t.tbAutoBadge = t.addChild(new PIXI.Container());
    g.eventMode = "none";
    const bg = g.addChild(new PIXI.Graphics());
    const txt = g.addChild(new PIXI.Text("АП", { fontFamily: "JetBrains Mono, monospace", fontSize: 13, fontWeight: "bold", fill: 0x07141a }));
    g.tbBg = bg; g.tbTxt = txt;
  }
  const s = Math.max(0.6, Math.min(t.w, t.h) / 70);
  g.tbBg.clear().beginFill(0x7fd8ff, 0.95).drawRoundedRect(0, 0, 26, 17, 4).endFill();
  g.tbTxt.position.set(4, 0);
  g.scale.set(s);
  g.position.set(0, 0);
  g.visible = true;
}
