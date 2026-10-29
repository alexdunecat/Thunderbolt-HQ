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
import { SYSTEM_ID, TB } from "./config.mjs";
import { esc, resolveActor } from "./utils.mjs";

/* ---------- приказ ---------- */

export const TASKS = { hunt: "Свободная охота", attack: "Атаковать цель", route: "Маршрут", hold: "Держать позицию" };
export const MANNERS = {
  rush: { name: "Напролом", hint: "Только задача: по другим не стреляет, от ракет не уходит." },
  push: { name: "Прорыв", hint: "Идёт к задаче и бьёт тех, кто мешает: в своей зоне, на следующем шаге пути и кто держит его на захвате." },
  careful: { name: "Осторожно", hint: "Уходит Break! от ракет, бьёт всё, что достаёт, раненым отходит от врага." }
};
export const AFTER = { hold: "Держать позицию", hunt: "Свободная охота" };

const BLANK = { on: true, task: "hunt", manner: "push", target: "", targetName: "", route: [], step: 0, acts: 2, after: "hold" };
export const orderOf = actor => {
  const f = actor?.getFlag?.(SYSTEM_ID, "autopilot");
  return f?.on ? { ...BLANK, ...f, route: [...(f.route ?? [])] } : null;
};
export const autopilotOn = actor => actor?.type === "npc" && !!orderOf(actor);

/** Задача сейчас: цель сбита или маршрут пройден — то, что в приказе «после». */
export function taskNow(order, { targetGone = false } = {}) {
  if (order.task === "attack" && (targetGone || !order.target)) return order.after;
  if (order.task === "route" && order.step >= order.route.length) return order.after;
  return order.task;
}

/** Строка приказа для сводки и подсказок. */
export function orderLine(order) {
  if (!order) return "";
  const t = order.task === "attack" ? `атаковать «${order.targetName || "цель"}»`
    : order.task === "route" ? `маршрут ${order.route.length ? order.route.map(cellLabel).join(" → ") : "не задан"}`
      : TASKS[order.task].toLowerCase();
  return `${t}, ${MANNERS[order.manner]?.name.toLowerCase() ?? ""}, ${order.acts} д.`;
}

/* ---------- выбор шага (чистая часть, тесты) ---------- */

/**
 * Следующее действие машины на автопилоте.
 * v (что видно с её места): { flying, systems, incoming, broke, hurt, lock, nearest,
 *   cands: [{ uuid, dist, canMissile, canGuns, lockRange, fire, needAlt, blocked, noLock, locksMe, onPath }] — по убыванию ценности,
 *   goal: null | { kind: "target", uuid, dist, want, altStep } | { kind: "cell", reached }, next, away } (next, away — клетки шага или null).
 * failed — UUID целей, по которым это действие в этот ход уже не вышло.
 * Возвращает { act: break | fire | guns | lock | climb | dive | move, uuid?, cell?, why } или null (ход окончен).
 */
export function chooseStep(order, v, failed = new Set()) {
  const task = order.taskNow ?? order.task, manner = order.manner;
  if (v.flying && !v.systems && v.incoming > 0 && !v.broke && manner !== "rush") return { act: "break", why: "уход от ракеты" };
  if (manner === "careful" && v.hurt && v.nearest !== null && v.nearest <= 1 && v.away) return { act: "move", cell: v.away, why: "отход: повреждён" };
  const goalUuid = v.goal?.kind === "target" ? v.goal.uuid : null;
  let pool = v.cands.filter(c => !failed.has(c.uuid));
  if (task === "attack" || task === "route") {
    if (manner === "rush") pool = pool.filter(c => c.uuid === goalUuid);
    else if (manner === "push") pool = pool.filter(c => c.uuid === goalUuid || c.dist === 0 || c.locksMe || c.onPath);
  }
  pool = [...pool.filter(c => c.uuid === goalUuid), ...pool.filter(c => c.uuid !== goalUuid)];
  for (const c of pool) {
    if (c.dist === null) continue;
    const locked = c.noLock || v.lock === c.uuid;
    if (c.canMissile && locked && c.dist <= c.fire && !c.blocked) return { act: "fire", uuid: c.uuid, why: "пуск" };
    if (c.canGuns && c.dist === 0) return { act: "guns", uuid: c.uuid, why: "пушка" };
    if (c.canMissile && !locked && c.dist <= c.lockRange) {
      if (c.needAlt) return { act: c.needAlt > 0 ? "climb" : "dive", uuid: c.uuid, why: "высота для захвата" };
      if (!c.blocked) return { act: "lock", uuid: c.uuid, why: "захват" };
    }
  }
  if (task === "hold" || !v.goal) return null;
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

/** Шаг в соседнюю клетку (8 направлений) к цели: ближе по Чебышёву, при равенстве — по прямой. allowed(c, r) — можно ли туда. */
export function stepToward([c0, r0], [c1, r1], allowed = () => true) {
  if (c0 === c1 && r0 === r1) return null;
  const cheb = (c, r) => Math.max(Math.abs(c1 - c), Math.abs(r1 - r));
  const now = cheb(c0, r0);
  let best = null;
  for (const dc of [-1, 0, 1]) for (const dr of [-1, 0, 1]) {
    if (!dc && !dr) continue;
    const c = c0 + dc, r = r0 + dr;
    const d = cheb(c, r), e = Math.hypot(c1 - c, r1 - r);
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

/** Ракетная система корабля или босса против цели этого вида: { i, lock } или null. */
function sysFor(actor, kind) {
  const list = actor.system.systems ?? [];
  const i = list.findIndex(y => (y.value ?? 0) > 0 && Number.isFinite(kind === "air" ? y.ga : y.gg) && (kind === "air" ? y.ga : y.gg) !== null);
  return i < 0 ? null : { i, lock: /Lock On/i.test(list[i].note ?? "") };
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
  const taskNowV = taskNow(order, { targetGone: order.task === "attack" && !tgtTok });
  // клетка следующего шага пути: нужна, чтобы «Прорыв» знал, кто мешает
  let goal = null, goalCell = null;
  if (taskNowV === "attack" && tgtTok) {
    const c = S.cellOf(tgtTok);
    goalCell = [c.col, c.row];
  } else if (taskNowV === "route") {
    goalCell = parseCell(order.route[order.step]);
  } else if (taskNowV === "hunt" && list.length) {
    const c = S.cellOf(list[0].token);
    goalCell = [c.col, c.row];
  }
  const next = goalCell ? stepToward(here, goalCell, allowed) : null;
  const cands = list.map(x => {
    const air = x.kind === "air", sp = systems ? sysFor(actor, x.kind) : null;
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
    return {
      uuid: x.actor.uuid, dist: x.dist, tok: x.token,
      canMissile: systems ? !!sp : !!x.canMissile, canGuns: !systems && !!x.canGuns, sys: sp?.i ?? null,
      noLock: systems ? !!sp && !sp.lock : false,
      lockRange, fire: TB.range.missile, needAlt, blocked,
      locksMe: !!lockedOn && (lockedOn === actor || lockedOn.uuid === actor.uuid),
      onPath: !!next && !!c && c.col === next[0] && c.row === next[1]
    };
  });
  if (taskNowV === "attack" && tgtTok) {
    const d = S.zoneDistance(token, tgtTok), x = cands.find(c => c.uuid === tgt.uuid);
    const want = x?.canMissile ? Math.min(x.lockRange, TB.range.missile) : 0;
    const tc = S.cellOf(tgtTok);
    const sameCell = tc.col === here[0] && tc.row === here[1];
    const altStep = sameCell && S.isFlying(actor) && S.isAirTarget(R.describeTarget(tgt, tgtTok.name, tgtTok))
      ? Math.sign(S.ALT_ORDER.indexOf(S.altOf(tgtTok, tgt)) - S.ALT_ORDER.indexOf(S.altOf(token, actor))) : 0;
    goal = { kind: "target", uuid: tgt.uuid, dist: d, want, altStep };
  } else if (taskNowV === "hunt" && list.length) {
    const x = cands[0];
    goal = { kind: "target", uuid: x.uuid, dist: x.dist, want: x.canMissile ? Math.min(x.lockRange, TB.range.missile) : 0, altStep: 0 };
  } else if (taskNowV === "route") goal = { kind: "cell", reached: !goalCell || (goalCell[0] === here[0] && goalCell[1] === here[1]) };
  const foes = cands.map(c => { const k = S.cellOf(c.tok); return k ? [k.col, k.row] : null; }).filter(Boolean);
  const hp = s.hp ?? {};
  return {
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
const ACT = { break: "Break!", fire: "Fox Two!", guns: "Guns", lock: "Lock On!", climb: "Climb", dive: "Dive", move: "Move" };

/** Ход машины на автопилоте (клиент ведущего). Возвращает строки сводки. */
export async function runAutopilot(actor, token = null) {
  const S = await import("./scene.mjs"), R = await import("./dice/rolls.mjs");
  token ??= S.tokenOf(actor);
  let order = orderOf(actor);
  if (!order || !token || token.document.hidden || gone(actor) || !canvas?.ready) return [];
  const state = { broke: false }, failed = new Set(), log = [];
  for (let i = 0; i < Math.max(1, Math.min(3, order.acts)); i++) {
    // маршрут: дошёл до точки — следующая
    if (order.task === "route" && order.step < order.route.length) {
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
    let res = null;
    switch (step.act) {
      case "break": res = await R.autoBreak(actor); state.broke = true; break;
      case "lock": res = await R.autoLock(actor, c.tok); break;
      case "fire": res = await R.autoFox(actor, c.tok, { sys: c.sys }); break;
      case "guns": res = await R.autoGuns(actor, c.tok); break;
      case "climb": case "dive": res = await climb(actor, token, step.act === "climb" ? 1 : -1); break;
      case "move": res = await move(token, v.here, step.cell); break;
    }
    const what = step.act === "fire" && actor.system.kind !== "air" ? "Пуск" : ACT[step.act];
    // строка — почему не вышло: эту цель (или этот шаг) больше не пробуем, действие не тратится один раз
    if (typeof res === "string") {
      if (step.uuid) failed.add(step.uuid);
      log.push(`${what}${name ? ` «${name}»` : ""}: не вышло (${res})`);
      if (!step.uuid || failed.size > 4) break;
      i -= 1;
      continue;
    }
    log.push(`${what}${name ? ` «${name}»` : step.cell ? ` → ${cellLabel(cellKey(step.cell))}` : ""}`);
    await wait(step.act === "move" ? 750 : step.act === "fire" ? 1000 : 550);
  }
  await summary(actor, token, order, log);
  return log;
}

async function move(token, from, to) {
  const doc = token.document, gs = canvas.grid.size;
  const r = await doc.update({ x: doc.x + (to[0] - from[0]) * gs, y: doc.y + (to[1] - from[1]) * gs }, { tbAuto: true });
  return r ? null : "переход не прошёл";
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

async function summary(actor, token, order, log) {
  const gms = game.users.filter(u => u.isGM).map(u => u.id);
  await ChatMessage.create({
    speaker: { alias: "Автопилот" }, whisper: gms,
    content: `<div class="tb-card tb-card-round"><header class="tb-card-head"><span class="tb-card-who">${esc(token.name)}</span><span class="tb-card-what">Автопилот</span></header>
      <div class="tb-note">Приказ: ${esc(orderLine(order))}<br>${log.length ? log.map(esc).join("<br>") : "Делать нечего: целей в досягаемости нет."}</div></div>`
  });
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
    <div class="form-group tb-ap-target"><label>Цель</label><input type="hidden" name="target" value="${esc(o.target)}"><input type="hidden" name="targetName" value="${esc(o.targetName)}">
      <span class="tb-ap-tname">${esc(o.targetName || "не выбрана")}</span> <button type="button" data-ap-pick><i class="fas fa-crosshairs"></i> На карте</button></div>
    <div class="form-group tb-ap-route"><label>Маршрут</label><input type="hidden" name="route" value="${esc(o.route.join(";"))}">
      <span class="tb-ap-rname">${esc(o.route.length ? o.route.map(cellLabel).join(" → ") : "не задан")}</span> <button type="button" data-ap-route><i class="fas fa-route"></i> Проложить</button></div>
    <div class="form-group"><label>Характер</label><select name="manner">${opt(MANNERS, o.manner)}</select></div>
    <p class="tb-hint tb-ap-mhint">${esc(MANNERS[o.manner].hint)}</p>
    <div class="form-group"><label>Действий за раунд</label><select name="acts">${[1, 2, 3].map(n => `<option value="${n}" ${n === o.acts ? "selected" : ""}>${n}</option>`).join("")}</select></div>
    <div class="form-group"><label>Когда цель сбита или маршрут пройден</label><select name="after">${opt(AFTER, o.after)}</select></div>`;
  const render = root => {
    const f = root.querySelector("form");
    const show = () => {
      const task = f.task.value;
      root.querySelector(".tb-ap-target").style.display = task === "attack" ? "" : "none";
      root.querySelector(".tb-ap-route").style.display = task === "route" ? "" : "none";
      root.querySelector(".tb-ap-mhint").textContent = MANNERS[f.manner.value].hint;
    };
    f.task.addEventListener("change", show);
    f.manner.addEventListener("change", show);
    show();
    root.querySelector("[data-ap-pick]").addEventListener("click", async () => {
      const { pickTargetToken } = await import("./pick.mjs");
      const t = await pickTargetToken(tokens[0].actor, { title: "Автопилот: цель", hint: "Щёлкните по токену цели задачи." });
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
  if (data.task === "attack" && !data.target) ui.notifications.warn("Автопилот: цель задачи не выбрана, пока машины в свободной охоте.");
  const order = {
    on: !!data.on, task: data.task === "attack" && !data.target ? "hunt" : data.task, manner: data.manner, acts: Number(data.acts) || 2, after: data.after,
    target: data.target, targetName: data.targetName, route: data.route ? data.route.split(";").filter(Boolean) : [], step: 0
  };
  for (const t of tokens) await t.actor.setFlag(SYSTEM_ID, "autopilot", order);
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
    highlight(o?.task === "route" ? o.route.slice(o.step) : null);
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
