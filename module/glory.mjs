/* Слава эскадрильи: общий счётчик эскадрильи игроков и копилка рядовых целей до следующей десятки.
   Начисляется на разборе (в «Итогах вылета» или кнопкой в панели AWACS), уровень и его эффекты видны на листе пилота. */
import { SYSTEM_ID, DT } from "./config.mjs";
import { esc } from "./utils.mjs";

const OURS = ["player", "ally"];

export function registerGlory() {
  game.settings.register(SYSTEM_ID, "glory", {
    name: "Слава эскадрильи", scope: "world", config: false, type: Object,
    default: { points: 0, conscripts: 0, nickname: "", log: [] },
    onChange: () => {
      for (const a of game.actors) if (a.type === "pilot" && a.sheet?.rendered) a.sheet.render(false);
      game.thunderbolt?.refreshAwacs?.();
    }
  });
}

export function glory() {
  let g;
  try { g = game.settings.get(SYSTEM_ID, "glory"); } catch { g = null; }
  return { points: 0, conscripts: 0, nickname: "", log: [], ...(g ?? {}) };
}

/** Уровень по очкам: { idx, key, name, mean, next (имя следующего), nextAt, effects (накопленные) }. */
export function gloryLevel(points) {
  const L = DT.glory.levels;
  let idx = 0;
  for (let i = 0; i < L.length; i++) if (points >= L[i].min) idx = i;
  const next = L[idx + 1] ?? null;
  return { idx, key: L[idx].key, name: L[idx].name, mean: L[idx].mean, next: next?.name ?? "", nextAt: next?.min ?? null,
    effects: L.slice(1, idx + 1).flatMap(l => l.effects.map(([title, text]) => ({ level: l.name, title, text }))) };
}

/** Что даёт Слава для листа пилота и панели AWACS. */
export function gloryView() {
  const g = glory(), lv = gloryLevel(g.points);
  return { ...g, ...lv, toNext: lv.nextAt !== null ? lv.nextAt - g.points : null, nickOpen: lv.idx >= 2 };
}

/**
 * Подсказка для начисления по сводке последнего боя на сцене: рядовые (воздух и земля), эскадрильи дуэлянтов,
 * которые сбиты или ушли целиком, асы, корабли, супероружие и летающие крепости. Только противник.
 */
const BIG_SHIP = /эсминец|крейсер|линкор|авианос/i;

export function gloryPrefill(losses = [], survivors = []) {
  const theirs = losses.filter(r => !OURS.includes(r.side) && r.side !== "neutral");
  const down = theirs.filter(r => r.how === "down");
  const p = { cons: 0, duel: 0, ace: 0, ship: 0, boss: 0 };
  for (const r of down) {
    if (r.boss) p.boss++;
    // корабль в зачёт Славы: эсминец и крупнее
    else if (r.kind === "ship") { if (BIG_SHIP.test(r.cls ?? "")) p.ship++; }
    else if (r.tier === "ace") p.ace++;
    else if (r.tier === "conscript" && ["air", "ground"].includes(r.kind) && r.grp !== "obj" && !r.missile) p.cons++;
  }
  const alive = new Set(survivors.map(s => s.squad).filter(Boolean));
  p.duel = new Set(theirs.filter(r => r.tier === "duelist" && r.squad && !alive.has(r.squad)).map(r => r.squad)).size;
  return p;
}

/** Поля начисления Славы для диалога (имена с префиксом g_). */
export function gloryFields(pre = {}) {
  const g = glory();
  const n = (name, label, pts, v = 0, hint = "") => `<tr><td>${label}${hint ? ` <small class="tb-muted">${hint}</small>` : ""}</td><td>${pts}</td><td><input type="number" name="g_${name}" value="${v}" min="0"></td></tr>`;
  return `<table class="tb-results tb-glory-award"><tr><th>За что</th><th>Слава</th><th>Сколько</th></tr>
    <tr><td><label><input type="checkbox" name="g_main"> Главная задача вылета выполнена</label></td><td>+2</td><td></td></tr>
    ${n("second", "Второстепенные задачи выполнены", "+1")}
    ${n("cons", "Рядовые цели (Conscripts) уничтожены", "+1 за 10", pre.cons, `в копилке ${g.conscripts} из 10`)}
    ${n("duel", "Эскадрильи Duelists сбиты или бежали целиком", "+1", pre.duel)}
    ${n("ace", "Асы сбиты", "+2", pre.ace, "Немезиду перенесите в строку ниже")}
    ${n("nem", "Немезида сбита", "+3")}
    ${n("ship", "Корабли потоплены (эсминец и крупнее)", "+1", pre.ship)}
    ${n("boss", "Супероружие или летающая крепость", "+5", pre.boss)}
    <tr><td>Поправка AWACS</td><td>±</td><td><input type="number" name="g_adj" value="0"></td></tr></table>`;
}

/** Сколько Славы даёт заполненная форма: { total, cons (новая копилка), parts: [[строка, очки]] }. */
export function gloryCount(data, pool = glory().conscripts) {
  const v = k => Math.max(0, Number(data[`g_${k}`]) || 0);
  const parts = [];
  if (data.g_main) parts.push(["главная задача", 2]);
  const add = (k, label, per) => { if (v(k)) parts.push([`${label} ×${v(k)}`, v(k) * per]); };
  add("second", "второстепенные задачи", 1);
  add("duel", "эскадрильи дуэлянтов", 1);
  add("ace", "асы", 2);
  add("nem", "Немезида", 3);
  add("ship", "корабли", 1);
  add("boss", "супероружие", 5);
  const heap = pool + v("cons");
  if (heap >= 10) parts.push([`рядовые цели: ${Math.floor(heap / 10) * 10}`, Math.floor(heap / 10)]);
  const adj = Number(data.g_adj) || 0;
  if (adj) parts.push(["поправка AWACS", adj]);
  return { total: parts.reduce((s, [, x]) => s + x, 0), cons: heap % 10, parts, consAdded: v("cons") };
}

/** Начислить Славу по форме и объявить в чате (с новым уровнем, если он сменился). */
export async function applyGlory(data, op = "Вылет") {
  const g = glory(), c = gloryCount(data, g.conscripts);
  if (!c.total && !c.consAdded) return null;
  const before = gloryLevel(g.points), points = Math.max(0, g.points + c.total), after = gloryLevel(points);
  const log = [...(g.log ?? []), { date: new Date().toLocaleDateString("ru-RU"), op, total: c.total, parts: c.parts }].slice(-40);
  await game.settings.set(SYSTEM_ID, "glory", { ...g, points, conscripts: c.cons, log });
  const up = after.idx > before.idx ? DT.glory.levels.slice(before.idx + 1, after.idx + 1) : [];
  const upHtml = up.map(l => `<div class="tb-note tb-glory-up"><b>Эскадрилья теперь: ${esc(l.name)}.</b> ${esc(l.mean)}.${l.effects.length
    ? `<ul>${l.effects.map(([t, x]) => `<li><b>${esc(t)}</b> ${esc(x)}</li>`).join("")}</ul>` : ""}${l.key === "known" ? "<p>AWACS даёт эскадрилье прозвище от врага: впишите его в панели AWACS.</p>" : ""}</div>`).join("");
  return ChatMessage.create({
    speaker: { alias: "AWACS" },
    content: `<div class="tb-card tb-card-glory"><header class="tb-card-head"><span class="tb-card-who">AWACS</span><span class="tb-card-what">Слава эскадрильи: ${c.total >= 0 ? "+" : "−"}${Math.abs(c.total)}</span></header>
      <div class="tb-note">${c.parts.length ? c.parts.map(([t, x]) => `${esc(t)}: ${x >= 0 ? "+" : "−"}${Math.abs(x)}`).join(", ") : "Славы не прибавилось"}. Итого <b>${points}</b>, ${esc(after.name)}${after.nextAt !== null ? `, до уровня «${esc(after.next)}» ${after.nextAt - points}` : ""}. Рядовых в копилке: ${c.cons} из 10.</div>
      ${upHtml}</div>`
  });
}

/** Начислить Славу отдельно от итогов вылета: по сводке последнего боя на открытой сцене. */
export async function gloryDialog() {
  if (!game.user.isGM) return;
  const { formDialog } = await import("./dice/rolls.mjs");
  const scene = game.scenes.viewed, last = scene?.getFlag(SYSTEM_ID, "lastBattle");
  const pre = gloryPrefill(last?.losses ?? [], last?.survivors ?? []);
  const data = await formDialog("Слава эскадрильи", `
    <p class="tb-hint">${last ? `Подсказка по сводке боя «${esc(last.op)}» на этой сцене; поправьте, если нужно.` : "Сводки боя на этой сцене нет: заполните вручную."} Отступление и провал Славу не отнимают.</p>
    ${gloryFields(pre)}
    <div class="form-group"><label>За что</label><input type="text" name="op" value="${esc(last?.op ?? scene?.name ?? "")}"></div>`, { ok: "Начислить", width: 520 });
  if (!data) return;
  return applyGlory(data, data.op || "Вылет");
}

/** Поправить Славу вручную (±) или прозвище. */
export async function setGlory(patch) {
  const g = glory();
  if ("points" in patch) patch.points = Math.max(0, patch.points);
  return game.settings.set(SYSTEM_ID, "glory", { ...g, ...patch });
}
