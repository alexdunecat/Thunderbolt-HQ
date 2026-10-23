/* Брифинг в духе Ace Combat: тактическая карта миссии на экране штабной ЭВМ поверх стола у всех игроков сразу.
   Камера ездит по этапам, значки сил появляются и мигают, цели берутся в скобки, маршрут звена прорисовывается,
   внизу по центру субтитры КП. Карта рисуется SVG из данных миссии (клетки, местность, подписи, погода, силы),
   а не холстом Foundry. Этапы собираются при импорте миссии из Планшета AWACS и лежат во флаге сцены briefing
   вместе с открытой частью миссии (без поворота, заметок и подкреплений). Ведущий правит их в окне «Брифинг»,
   запускает показ (можно сразу после заставки) и листает; указка (рука, метка клетки, линия-стрелка) у всех синхронно. */
import { SYSTEM_ID } from "./config.mjs";
import { esc } from "./utils.mjs";
import { bootOptions, startBoot } from "./boot.mjs";

const CHANNEL = `system.${SYSTEM_ID}`;
export const CELL = 100, ASP = 16 / 9;
// буквы столбцов как у импорта миссии и подписей клеток на сцене (без Ё, З, Й)
export const COL_LETTERS = "АБВГДЕЖИКЛМНОПРСТУФХЦЧШЭЮЯ";
export const cellName = (c, r) => (COL_LETTERS[c] ?? "?") + (r + 1);
const ctr = (c, r) => [c * CELL + CELL / 2, r * CELL + CELL / 2];
/** Линия возврата: отрезки границы между клетками «за линией» и остальной картой, в клетках [c1, r1, c2, r2]. */
export function retEdges(cells, cols, rows) {
  const set = new Set(cells), out = [];
  for (const k of set) {
    const [c, r] = k.split(",").map(Number);
    if (!(c >= 0 && r >= 0 && c < cols && r < rows)) continue;
    if (r > 0 && !set.has(`${c},${r - 1}`)) out.push([c, r, c + 1, r]);
    if (r < rows - 1 && !set.has(`${c},${r + 1}`)) out.push([c, r + 1, c + 1, r + 1]);
    if (c > 0 && !set.has(`${c - 1},${r}`)) out.push([c, r, c, r + 1]);
    if (c < cols - 1 && !set.has(`${c + 1},${r}`)) out.push([c + 1, r, c + 1, r + 1]);
  }
  return out;
}
/** Отрезок для подписи RETURN LINE: средний по положению. */
export const retLabelEdge = edges => edges.slice().sort((p, q) => (p[1] + p[3]) - (q[1] + q[3]) || (p[0] + p[2]) - (q[0] + q[2]))[Math.floor(edges.length / 2)];
/** Линия возврата миссии: клетки за линией и что значит уход врага (fail — задача провалена, later — вернётся позже). */
export function retOf(m, cols, rows) {
  const inside = (c, r) => Number.isInteger(c) && Number.isInteger(r) && c >= 0 && r >= 0 && c < cols && r < rows;
  const cells = [...new Set((Array.isArray(m?.ret?.cells) ? m.ret.cells : []).map(String))].filter(k => { const [c, r] = k.split(",").map(Number); return inside(c, r); });
  return cells.length ? { cells, mode: ["later", "border"].includes(m.ret.mode) ? m.ret.mode : "fail" } : null;
}

/* ---------- открытая часть миссии ---------- */
const MARKER_KIND = { entry: "flight", goal: "goal", protect: "convoy", reinf: "hidden", note: "hidden" };
const AA_GUNS = ["aagun", "shilka", "m163"];
// радиус зоны поражения ПВО на карте брифинга, в сотых клетки
const THREAT = { s300: 135, patriot: 135, samsite: 115, osa: 85, tunguska: 80, manpads: 65, aagun: 65, shilka: 60, m163: 60 };
const SIDES = ["player", "ally", "enemy", "neutral"];
const KINDS = ["flight", "goal", "convoy", "air", "ship", "sam", "aa", "jam", "radar", "armor", "art", "obj", "unk"];

/** Вид силы для значка: звено игроков, цель, защищаемый объект, самолёт, ЗРК, зенитки, РЭБ, РЛС, корабль, бронетехника, артиллерия, объект. */
export function unitKind(ref, u = {}, entry = null) {
  if (MARKER_KIND[ref]) return MARKER_KIND[ref];
  if (!entry) return u.alt ? "air" : "obj";
  if (entry.kind === "air") return "air";
  if (entry.kind === "ship") return "ship";
  if (entry.grp === "ad") return ref === "jammer" ? "jam" : ref === "radar" ? "radar" : AA_GUNS.includes(ref) ? "aa" : "sam";
  if (entry.grp === "armor") return "armor";
  if (entry.grp === "art") return "art";
  return "obj";
}

/**
 * Миссия из Планшета AWACS без того, что игрокам знать рано: поворот, «если провалят», заметки ведущего,
 * подкрепления и заметки AWACS на карте, заметки к силам. Это и сохраняется на сцене, и уходит игрокам.
 */
export function publicMission(m, cat = {}) {
  const byKey = new Map([...(cat.npcs ?? []), ...(cat.planeNpcs ?? [])].map(n => [n.key, n]));
  const markers = new Map((cat.markers ?? []).map(x => [x.id, x]));
  const fxName = new Map((cat.effects ?? []).map(e => [e.id, e.name]));
  const cols = Math.max(1, Math.min(40, Math.round(Number(m?.cols) || 1))), rows = Math.max(1, Math.min(40, Math.round(Number(m?.rows) || 1)));
  const inside = (c, r) => Number.isInteger(c) && Number.isInteger(r) && c >= 0 && r >= 0 && c < cols && r < rows;
  const hexes = {}, wx = {};
  for (const [key, h] of Object.entries(m?.hexes ?? {})) {
    const [c, r] = String(key).split(",").map(n => Number(n.trim()));
    if (!h || !inside(c, r)) continue;
    const x = {};
    if (h.t) x.t = String(h.t);
    const fx = (Array.isArray(h.fx) ? h.fx : []).map(String).filter(id => id !== "tunnel");
    if (fx.length) { x.fx = fx; for (const id of fx) wx[id] = fxName.get(id) ?? id; }
    if (h.label) x.label = String(h.label);
    if (Object.keys(x).length) hexes[`${c},${r}`] = x;
  }
  const units = [], seen = new Set();
  (m?.units ?? []).forEach((u, i) => {
    const ref = cat.alias?.[u?.ref] ?? u?.ref, entry = byKey.get(ref) ?? null, k = unitKind(ref, u ?? {}, entry);
    const c = Number(u?.c), r = Number(u?.r);
    if (k === "hidden" || !inside(c, r)) return;
    let id = String(u.id ?? `u${i}`);
    if (seen.has(id)) id = `${id}_${i}`;
    seen.add(id);
    const x = { id, k, side: SIDES.includes(u.side) ? u.side : markers.get(ref)?.side ?? "enemy",
      name: String(u.name || markers.get(ref)?.n || entry?.name || ref || "Объект"), count: Math.max(1, Math.round(Number(u.count) || 1)), c, r };
    if (["L", "M", "H", "S"].includes(u.alt)) x.alt = u.alt;
    if (k === "sam" || k === "aa") x.rng = THREAT[ref] ?? (k === "sam" ? 115 : 65);
    units.push(x);
  });
  return {
    name: String(m?.name ?? ""), type: String(m?.type ?? ""), cols, rows, base: String(m?.base ?? "steppe"), hexes, wx, units,
    objectives: (m?.objectives ?? []).map(o => String(o).trim()).filter(Boolean), briefing: String(m?.briefing ?? ""),
    ...(retOf(m, cols, rows) ? { ret: retOf(m, cols, rows) } : {})
  };
}

/* ---------- этапы ---------- */
const sentences = t => (String(t).match(/[^.!?…]+(?:[.!?…]+»?|$)/g) ?? []).map(s => s.trim()).filter(Boolean);
const boards = n => n % 10 === 1 && n % 100 !== 11 ? "борт" : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? "борта" : "бортов";
const fromSide = (u, pm) => {
  const d = [[u.c, "с запада"], [pm.cols - 1 - u.c, "с востока"], [u.r, "с севера"], [pm.rows - 1 - u.r, "с юга"]];
  return d.sort((a, b) => a[0] - b[0])[0][1];
};

/**
 * Этапы из миссии: район операции, каждая задача с наведением на её цели, авиация противника, свои силы,
 * погода и местность, маршрут звена, вылет. Цели задачи: наземный противник достаётся задаче, с текстом которой
 * у его имени больше общих корней; при равенстве или без совпадений — задаче, чей маркер «ЦЕЛЬ» ближе (не дальше соседней клетки).
 */
export function buildSteps(pm) {
  const us = pm.units ?? [];
  const S = sentences(pm.briefing ?? ""), used = new Set();
  const take = re => { const i = S.findIndex((s, k) => !used.has(k) && re.test(s)); if (i < 0) return ""; used.add(i); return S[i]; };
  const box = list => { const cs = list.map(u => u.c), rs = list.map(u => u.r); return { c0: Math.min(...cs), c1: Math.max(...cs), r0: Math.min(...rs), r1: Math.max(...rs) }; };
  const ids = list => list.map(u => u.id);
  const steps = [];
  const intro = S.slice(0, 2); intro.forEach((_, k) => used.add(k));
  steps.push({ title: "РАЙОН ОПЕРАЦИИ", focus: "all", show: ids(us), text: intro.join(" ") || `Операция «${pm.name}».` });

  const goals = us.filter(u => u.k === "goal");
  const objs = pm.objectives ?? [];
  const goalOf = i => goals.find(u => new RegExp(`(задача|цель)\\s*${i + 1}(?!\\d)`, "i").test(u.name)) ?? goals[i];
  const roots = objs.map(o => o.toLowerCase().split(/[^а-яё]+/).filter(w => w.length > 4).map(w => w.slice(0, 5)));
  const dist = (a, b) => b ? Math.max(Math.abs(a.c - b.c), Math.abs(a.r - b.r)) : 99;
  const owner = new Map();
  for (const u of us.filter(u => u.side === "enemy" && !["air", "goal", "flight"].includes(u.k))) {
    const name = u.name.toLowerCase(), hits = roots.map(ws => ws.filter(w => name.includes(w)).length), best = Math.max(0, ...hits);
    const cand = objs.map((_, i) => i).filter(i => best ? hits[i] === best : dist(u, goalOf(i)) <= 1);
    if (cand.length) owner.set(u.id, cand.sort((a, b) => dist(u, goalOf(a)) - dist(u, goalOf(b)))[0]);
  }
  const entry = us.find(u => u.k === "flight");
  const route = entry ? [[entry.c, entry.r]] : [];
  objs.forEach((obj, i) => {
    const g = goalOf(i);
    let tg = us.filter(u => owner.get(u.id) === i);
    if (!tg.length && g) tg = [g];
    if (tg.length) {
      const p = [tg.reduce((s, u) => s + u.c, 0) / tg.length, tg.reduce((s, u) => s + u.r, 0) / tg.length].map(v => Math.round(v * 100) / 100);
      const last = route.at(-1);
      if (!last || last[0] !== p[0] || last[1] !== p[1]) route.push(p);
    }
    steps.push({ title: `ЗАДАЧА ${i + 1}`, focus: tg.length ? box(tg) : "all", show: ids(tg), targets: ids(tg),
      threat: tg.some(u => u.k === "sam" || u.k === "aa"), text: /[.!?…»]$/.test(obj) ? obj : `${obj}.` });
  });
  const air = us.filter(u => u.side === "enemy" && u.k === "air");
  if (air.length) steps.push({ title: "АВИАЦИЯ ПРОТИВНИКА", focus: box(air), show: ids(air), blink: ids(air),
    text: `В районе авиация противника: ${air.map(u => `${u.name}${u.count > 1 ? `, ${u.count} ${boards(u.count)}` : ""}`).join("; ")}. Держите высоту.` });
  // противник на земле и на море, который ни к одной задаче не относится: ПВО по пути, корабли охранения
  const rest = us.filter(u => u.side === "enemy" && !["air", "goal", "flight"].includes(u.k) && !owner.has(u.id));
  if (rest.length) steps.push({ title: "ПРОТИВНИК В РАЙОНЕ", focus: box(rest), show: ids(rest), blink: ids(rest), threat: rest.some(u => u.k === "sam" || u.k === "aa"),
    text: `Также в районе: ${rest.map(u => `${u.name}${u.count > 1 ? ` (${u.count})` : ""}`).join("; ")}.${rest.some(u => u.k === "sam" || u.k === "aa") ? " Обходите зоны ПВО." : ""}` });
  const allies = us.filter(u => u.side === "ally");
  if (allies.length) steps.push({ title: "СВОИ СИЛЫ", focus: box(allies), show: ids(allies), blink: ids(allies),
    text: take(/колонн|свои|союз|прикры|наши/i) || `Свои: ${allies.map(u => u.name).join(", ")}.` });
  const wxCells = Object.entries(pm.hexes ?? {}).filter(([, h]) => h.fx?.length).map(([k]) => k.split(",").map(Number));
  const lines = [take(/буря|туман|облач|дожд|гроз|ветер|видно|ураган|снег/i), take(/ущель|каньон|высот|гор[аыу ]|рельеф|туннел/i)].filter(Boolean);
  if (wxCells.length || lines.length) {
    const cs = wxCells.length ? wxCells : [[0, 0], [pm.cols - 1, pm.rows - 1]];
    steps.push({ title: "ПОГОДА И МЕСТНОСТЬ", focus: { c0: Math.min(...cs.map(x => x[0])), c1: Math.max(...cs.map(x => x[0])), r0: Math.min(...cs.map(x => x[1])), r1: Math.max(...cs.map(x => x[1])) },
      show: [], wx: true, text: lines.join(" ") || `Погода в районе: ${Object.values(pm.wx ?? {}).join(", ").toLowerCase() || "сложная"}.` });
  }
  if (pm.ret?.cells?.length) {
    const cs = pm.ret.cells.map(k => k.split(",").map(Number));
    steps.push({ title: pm.ret.mode === "border" ? "РУБЕЖ ОБОРОНЫ" : "ЛИНИЯ ВОЗВРАТА", focus: { c0: Math.min(...cs.map(x => x[0])), c1: Math.max(...cs.map(x => x[0])), r0: Math.min(...cs.map(x => x[1])), r1: Math.max(...cs.map(x => x[1])) },
      show: [], ret: true, text: pm.ret.mode === "border" ? "За пунктиром — рубеж обороны. Если противник прорвётся за него, задание провалено."
        : `За пунктиром — линия возврата. ${pm.ret.mode === "later" ? "Кто из противника уйдёт за неё, вернётся с подкреплением." : "Не дайте целям уйти за неё: ушедшая цель — проваленная задача."} Сами за ней можете выйти из боя или перевооружиться и вернуться.` });
  }
  const path = route.length > 1 ? route : null;
  if (entry) steps.push({ title: "МАРШРУТ", focus: "all", show: ids(us), blink: [entry.id], route: path,
    text: [take(/./), `${entry.name}, вход ${fromSide(entry, pm)}. Вылет по готовности. Конец связи.`].filter(Boolean).join(" ") });
  // последний слайд: общий вид карты, текст правится, как у остальных
  steps.push({ title: "ВЫЛЕТ", focus: "all", show: ids(us), route: path, final: true, text: "Брифинг окончен. По машинам." });
  return steps;
}

/** Этапы из флага сцены в порядке: строки и списки на своих местах, мусор отброшен. */
export function cleanSteps(list) {
  const num = v => Number.isFinite(Number(v)) ? Number(v) : 0;
  const focusOf = f => {
    if (f?.cam && ["x", "y", "w", "h"].every(k => Number.isFinite(Number(f.cam[k]))) && f.cam.w > 0) return { cam: { x: num(f.cam.x), y: num(f.cam.y), w: num(f.cam.w), h: num(f.cam.h) } };
    if (f && typeof f === "object" && ["c0", "c1", "r0", "r1"].every(k => Number.isFinite(Number(f[k])))) return { c0: num(f.c0), c1: num(f.c1), r0: num(f.r0), r1: num(f.r1) };
    return "all";
  };
  const strs = a => Array.isArray(a) ? a.map(String) : [];
  return (Array.isArray(list) ? list : []).filter(s => s && typeof s === "object").map(s => {
    const x = { title: String(s.title ?? "ЭТАП"), text: String(s.text ?? ""), focus: focusOf(s.focus), show: strs(s.show) };
    if (s.targets?.length) x.targets = strs(s.targets);
    if (s.blink?.length) x.blink = strs(s.blink);
    // фон этапа из конструктора: ровно show ∪ dim, dim всегда приглушены, без накопления прошлых этапов
    if (Array.isArray(s.dim)) x.dim = strs(s.dim);
    // кольца ПВО: true — все, список — только у этих сил
    if (Array.isArray(s.threat)) { if (s.threat.length) x.threat = strs(s.threat); } else if (s.threat) x.threat = true;
    if (s.wx) x.wx = true;
    if (s.ret) x.ret = true;
    if (Array.isArray(s.route) && s.route.length > 1) x.route = s.route.map(p => [num(p?.[0]), num(p?.[1])]);
    // пометки этапа: подсвеченные клетки и стрелки, заготовленные в конструкторе
    const marks = (Array.isArray(s.marks) ? s.marks : []).map(String).filter(k => /^\d+,\d+$/.test(k));
    if (marks.length) x.marks = [...new Set(marks)];
    const lines = (Array.isArray(s.lines) ? s.lines : []).filter(l => Array.isArray(l) && l.length === 4 && l.every(v => Number.isFinite(Number(v)))).map(l => l.map(Number));
    if (lines.length) x.lines = lines;
    // фото во врезке: картинка data:, ссылка или путь в папке мира; подпись по желанию
    if (s.img && /^(data:image\/(png|jpe?g|webp|gif|svg\+xml)[;,]|https?:\/\/|[\w-]+\/)/i.test(String(s.img.src ?? ""))) x.img = { src: String(s.img.src), cap: String(s.img.cap ?? "") };
    if (s.final) x.final = true;
    return x;
  });
}

/** Силы, уже показанные к этапу i: значок однажды появился и дальше остаётся на карте. */
export const knownUpTo = (steps, i) => [...new Set(steps.slice(0, i + 1).flatMap(s => s.show ?? []))];

/** Камера (видимая область карты) для фокуса этапа: весь район, рамка клеток или запомненный вид. */
export function fitCam(f, cols, rows) {
  const W = cols * CELL, H = rows * CELL;
  if (f?.cam) return { ...f.cam };
  if (!f || f === "all") { const h = Math.max(H + 16, (W + 16) / ASP), w = h * ASP; return { x: W / 2 - w / 2, y: H / 2 - h / 2, w, h }; }
  let x0 = f.c0 * CELL - CELL * .6, x1 = (f.c1 + 1) * CELL + CELL * .6;
  const y0 = f.r0 * CELL - CELL * .5, y1 = (f.r1 + 1) * CELL + CELL * .5;
  // не ближе, чем четыре с половиной клетки по ширине: одиночная цель не раздувается на весь экран
  const minW = CELL * 4.6, mx = (x0 + x1) / 2;
  if (x1 - x0 < minW) { x0 = mx - minW / 2; x1 = mx + minW / 2; }
  // свободная часть экрана: от шапки до субтитров по высоте, почти вся ширина
  const TOP = .15, FH = .58, FW = .94, bw = x1 - x0, bh = y1 - y0;
  let h = bh / FH, w = h * ASP;
  if (bw / FW > w) { w = bw / FW; h = w / ASP; }
  return { x: (x0 + x1) / 2 - w / 2, y: y0 - TOP * h - (h * FH - bh) / 2, w, h };
}

/** Открытая часть миссии из конструктора брифингов: числа, строки и списки на своих местах. */
export function cleanMission(pm) {
  if (!pm || typeof pm !== "object") return null;
  const cols = Math.round(Number(pm.cols)), rows = Math.round(Number(pm.rows));
  if (!(cols >= 1 && cols <= 40 && rows >= 1 && rows <= 40)) return null;
  const hexes = {};
  for (const [k, h] of Object.entries(pm.hexes ?? {})) {
    const [c, r] = String(k).split(",").map(Number);
    if (!(c >= 0 && r >= 0 && c < cols && r < rows) || !h) continue;
    const x = {};
    if (h.t) x.t = String(h.t);
    if (Array.isArray(h.fx) && h.fx.length) x.fx = h.fx.map(String);
    if (h.label) x.label = String(h.label);
    if (Object.keys(x).length) hexes[`${c},${r}`] = x;
  }
  const units = (Array.isArray(pm.units) ? pm.units : []).filter(u => u && Number(u.c) >= 0 && Number(u.r) >= 0 && Number(u.c) < cols && Number(u.r) < rows).map((u, i) => {
    const x = { id: String(u.id ?? `u${i}`), k: KINDS.includes(u.k) ? u.k : "obj", side: SIDES.includes(u.side) ? u.side : "enemy", name: String(u.name ?? ""), count: Math.max(1, Math.round(Number(u.count) || 1)), c: Number(u.c), r: Number(u.r) };
    if (["L", "M", "H", "S"].includes(u.alt)) x.alt = u.alt;
    if (Number(u.rng) > 0) x.rng = Number(u.rng);
    return x;
  });
  return { name: String(pm.name ?? ""), type: String(pm.type ?? ""), cols, rows, base: String(pm.base ?? "steppe"), hexes,
    wx: Object.fromEntries(Object.entries(pm.wx ?? {}).map(([k, v]) => [k, String(v)])), units,
    objectives: (Array.isArray(pm.objectives) ? pm.objectives : []).map(String), briefing: String(pm.briefing ?? ""),
    ...(retOf(pm, cols, rows) ? { ret: retOf(pm, cols, rows) } : {}) };
}

/**
 * Разобрать вставленный или загруженный JSON: брифинг из конструктора ({ format: "tb-briefing", mission, steps, op? })
 * или миссия из Планшета AWACS (этапы тогда собираются сами). Возвращает { mission, steps, op, from }.
 */
export function readBriefingJson(obj, cat = {}) {
  if (obj?.format === "tb-briefing" || (obj?.mission && Array.isArray(obj?.steps))) {
    const mission = cleanMission(obj.mission);
    if (!mission) throw new Error("в брифинге нет карты миссии (mission.cols, mission.rows)");
    const steps = cleanSteps(obj.steps);
    if (!steps.length) throw new Error("в брифинге нет ни одного этапа");
    return { mission, steps, op: String(obj.op ?? "").trim(), from: "editor" };
  }
  if (!obj?.cols || !obj?.rows) throw new Error("это не брифинг из конструктора и не миссия из Планшета (нет cols, rows)");
  const mission = publicMission(obj, cat);
  return { mission, steps: buildSteps(mission), op: "", from: "tablet" };
}

/** Брифинг сцены: открытая часть миссии, этапы и название операции на экране (если задано в конструкторе). */
export function briefingOf(scene) {
  const b = scene?.getFlag?.(SYSTEM_ID, "briefing") ?? {};
  const mission = b.mission?.cols && b.mission?.rows ? b.mission : null;
  const steps = cleanSteps(b.steps);
  return { mission, steps: steps.length || !mission ? steps : buildSteps(mission), op: String(b.op ?? ""), from: b.from === "editor" ? "editor" : "" };
}

/** Записать брифинг на сцену целиком: объекты флагов при update сливаются, поэтому прежний сначала снимается. */
export async function saveBriefing(scene, { mission, steps, op = "", from = "" }) {
  await scene.update({ [`flags.${SYSTEM_ID}.-=briefing`]: null });
  await scene.update({ [`flags.${SYSTEM_ID}.briefing`]: { mission, steps: cleanSteps(steps), ...(op ? { op } : {}), ...(from === "editor" ? { from } : {}) } });
}

/* ---------- экран ---------- */
const NS = "http://www.w3.org/2000/svg";
const ALT_NAME = { L: "МАЛАЯ", M: "СРЕДНЯЯ", H: "ВЫСОКАЯ", S: "СТРАТОСФЕРА" };
const SUB = { sam: "ЗРК", aa: "ЗЕНИТНАЯ АРТ.", jam: "РЭБ", radar: "РЛС", obj: "ОБЪЕКТ", convoy: "ПОД ЗАЩИТОЙ", flight: "ВХОД", ship: "КОРАБЛЬ", armor: "БРОНЕТЕХНИКА", art: "АРТИЛЛЕРИЯ", unk: "НЕОПОЗНАН" };
const sideCls = s => s === "player" ? "own" : s === "ally" ? "ally" : s === "neutral" ? "neutral" : "enemy";
const WATER = ["sea", "lake"];
// псевдослучайность от координат, чтобы карта не менялась между показами
const rnd = (c, r, k) => { const x = Math.sin(c * 127.1 + r * 311.7 + k * 74.7) * 43758.5453; return x - Math.floor(x); };
const setting = (scope, k, d) => { try { return game.settings.get(scope, k); } catch { return d; } };
const volumeNow = () => Number(setting(SYSTEM_ID, "soundVolume", 70)) / 100 * Number(setting("core", "globalInterfaceVolume", 1));
const reduceMotion = () => !!globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;

/** Звук экрана: тон и щелчок телетайпа, громкость — настройка «Громкость звуков» и канал «Интерфейс». */
class BriefAudio {
  constructor(on = true) { this.on = on; this.ctx = null; }
  get vol() { return this.on ? volumeNow() : 0; }
  ensure() {
    if (this.ctx || this.vol <= 0) return this.ctx;
    try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); this.ctx.resume?.().catch(() => null); } catch { this.ctx = null; }
    return this.ctx;
  }
  tone(freq, dur, vol = .03, at = 0) {
    const c = this.ensure(), v = this.vol; if (!c || v <= 0) return;
    const t = c.currentTime + at, o = c.createOscillator(), g = c.createGain();
    o.frequency.value = freq; g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol * v, t + .01); g.gain.linearRampToValueAtTime(0, t + dur);
    o.connect(g).connect(c.destination); o.start(t); o.stop(t + dur + .02);
  }
  tick() {
    const c = this.ensure(), v = this.vol; if (!c || v <= 0) return;
    const n = c.createBufferSource(), b = c.createBuffer(1, 800, c.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / 90);
    const f = c.createBiquadFilter(); f.type = "bandpass"; f.frequency.value = 2600; const g = c.createGain(); g.gain.value = .25 * v;
    n.buffer = b; n.connect(f).connect(g).connect(c.destination); n.start(c.currentTime);
  }
  close() { const c = this.ctx; this.ctx = null; c?.close().catch(() => null); }
}

let UID = 0;

/**
 * Экран брифинга в элементе host. interactive — ведущий: тянет карту, колесо меняет масштаб, метка и линия по инструменту;
 * on.cam / on.mark / on.line / on.ping получают его действия для рассылки игрокам.
 */
export class BriefScreen {
  constructor(host, { pm, op = "", interactive = false, sound = true, hint = "ВЕДУЩИЙ ЛИСТАЕТ ЭТАПЫ", on = {} } = {}) {
    this.pm = pm; this.on = on; this.uid = ++UID; this.hint = hint;
    this.audio = new BriefAudio(sound);
    this.anim = 0; this.typing = 0; this.shown = 0; this.marks = new Map(); this.tool = "pan"; this.step = null; this.timers = new Set();
    const u = this.uid;
    host.innerHTML = `<div class="tb-br-screen">
      <svg class="tb-br-map" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
        <defs>
          <pattern id="tb-br-dots-${u}" width="14" height="14" patternUnits="userSpaceOnUse"><circle cx="3" cy="4" r=".8" fill="#1d4148"/><circle cx="10" cy="11" r=".6" fill="#1d4148"/></pattern>
          <pattern id="tb-br-hatch-${u}" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(-30)"><line x1="0" y1="0" x2="0" y2="8" stroke="#f2c14e" stroke-width=".8" opacity=".35"/></pattern>
          <marker id="tb-br-arr-${u}" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 Z" fill="#9be3bf"/></marker>
          <marker id="tb-br-pen-${u}" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0 L10 5 L0 10 Z" fill="#f2c14e"/></marker>
        </defs>
        <g class="tb-br-world"></g><g class="tb-br-marks"></g><g class="tb-br-pen"></g>
      </svg>
      <div class="tb-br-hud tl"><div class="k">ВВС ЮКТОБАНИИ · АСУ «ТАЙГА» · БРИФИНГ</div><div class="big">ОПЕРАЦИЯ «${esc(String(op || pm.name).toUpperCase())}»</div><div class="rule"></div>
        <div class="mid">${esc([pm.type.toUpperCase(), `ЗАДАЧ: ${pm.objectives.length}`].filter(Boolean).join(" · "))}</div></div>
      <div class="tb-br-hud tr"><div class="k">ЭТАП</div><div class="num" data-r="num">00/00</div><div class="k" data-r="cell">КВ —</div></div>
      <figure class="tb-br-photo" data-r="photo" hidden><div class="k">РАЗВЕДДАННЫЕ</div><img alt=""><figcaption></figcaption></figure>
      <div class="tb-br-subs"><div class="say" data-r="say"></div></div>
      <div class="tb-br-hint" data-r="hint">${esc(hint)}</div>
    </div>`;
    this.el = host.querySelector(".tb-br-screen");
    this.svg = host.querySelector(".tb-br-map");
    this.world = host.querySelector(".tb-br-world");
    this.pen = host.querySelector(".tb-br-pen");
    this.stepMarks = host.querySelector(".tb-br-marks");
    this.W = pm.cols * CELL; this.H = pm.rows * CELL;
    this.drawMap();
    this.setCam(fitCam("all", pm.cols, pm.rows));
    if (interactive) this.bind();
  }
  r(name) { return this.el.querySelector(`[data-r="${name}"]`); }
  later(fn, ms) { const t = setTimeout(() => { this.timers.delete(t); fn(); }, ms); this.timers.add(t); }
  node(tag, attrs = {}, parent) { const n = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); parent?.append(n); return n; }

  /* карта */
  terrain(g, c, r, t) {
    const [x, y] = ctr(c, r), R = k => rnd(c, r, k), el = (tag, a) => this.node(tag, a, g);
    const scatter = (n, fn) => { for (let k = 0; k < n; k++) fn(x - 38 + R(k) * 76, y - 36 + R(k + 31) * 72, k); };
    if (t === "mount" || t === "hills") {
      for (let k = 0; k < (t === "mount" ? 4 : 2); k++) {
        const rad = 12 + k * 9, pts = [];
        for (let a = 0; a < 14; a++) { const ang = a / 14 * Math.PI * 2, rr = rad * (0.82 + R(a + k * 20) * .36); pts.push(`${(x + Math.cos(ang) * rr * 1.25).toFixed(1)} ${(y + Math.sin(ang) * rr).toFixed(1)}`); }
        el("path", { d: `M${pts.join(" L")} Z`, class: `ink${k === 0 ? " hi" : ""}` });
      }
    } else if (t === "canyon") {
      el("path", { d: `M${x - 50} ${y - 6} C${x - 20} ${y - 22} ${x} ${y + 12} ${x + 50} ${y - 4}`, class: "ink hi" });
      el("path", { d: `M${x - 50} ${y + 8} C${x - 20} ${y - 8} ${x} ${y + 26} ${x + 50} ${y + 10}`, class: "ink hi" });
    } else if (t === "city" || t === "village") {
      for (let k = 0; k < (t === "city" ? 9 : 4); k++) el("rect", { x: x - 26 + (k % 3) * 18 + R(k) * 4, y: y - 24 + Math.floor(k / 3) * 16, width: 11 + R(k + 9) * 5, height: 9, class: "ink fill" });
    } else if (t === "industry") {
      for (let k = 0; k < 4; k++) el("rect", { x: x - 30 + (k % 2) * 32, y: y - 22 + Math.floor(k / 2) * 22, width: 24, height: 14, class: "ink fill" });
      el("path", { d: `M${x + 22} ${y - 22} v-14 M${x + 28} ${y - 22} v-10`, class: "ink hi" });
    } else if (t === "base") {
      el("rect", { x: x - 34, y: y - 6, width: 68, height: 12, class: "ink fill", transform: `rotate(-18 ${x} ${y})` });
      el("line", { x1: x - 28, y1: y, x2: x + 28, y2: y, class: "ink hi", "stroke-dasharray": "5 4", transform: `rotate(-18 ${x} ${y})` });
    } else if (t === "port") {
      for (let k = 0; k < 3; k++) el("path", { d: `M${x - 30 + k * 22} ${y - 30} v34`, class: "ink hi" });
      for (let k = 0; k < 2; k++) el("path", { d: `M${x - 40} ${y + 16 + k * 14} q10 -5 20 0 t20 0 t20 0 t20 0`, class: "ink" });
    } else if (t === "steppe" || t === "meadow") {
      scatter(t === "steppe" ? 7 : 9, (px, py) => el("path", { d: t === "steppe" ? `M${px} ${py} l6 -3` : `M${px} ${py} l-2 -5 M${px + 3} ${py} l1 -6`, class: "ink" }));
    } else if (t === "desert") {
      scatter(5, (px, py) => el("path", { d: `M${px - 8} ${py} q8 -7 16 0`, class: "ink" }));
    } else if (t === "oasis") {
      el("ellipse", { cx: x, cy: y + 4, rx: 16, ry: 9, class: "ink water" });
      scatter(5, (px, py) => el("circle", { cx: px, cy: py, r: 3, class: "ink" }));
    } else if (t === "snow") {
      scatter(7, (px, py) => el("path", { d: `M${px - 3} ${py} h6 M${px} ${py - 3} v6`, class: "ink" }));
    } else if (t === "forest") {
      scatter(9, (px, py) => el("circle", { cx: px, cy: py, r: 4 + R(px) * 2, class: "ink" }));
    } else if (t === "taiga") {
      scatter(9, (px, py) => el("path", { d: `M${px} ${py - 6} l4 8 h-8 Z`, class: "ink" }));
    } else if (t === "swamp") {
      scatter(6, (px, py) => el("path", { d: `M${px - 6} ${py + 2} h12 M${px - 3} ${py} l-1 -6 M${px} ${py} v-7 M${px + 3} ${py} l1 -6`, class: "ink" }));
    } else if (t === "coast") {
      for (let k = 0; k < 3; k++) el("path", { d: `M${x - 40} ${y + k * 14} q10 -5 20 0 t20 0 t20 0 t20 0`, class: "ink" });
    } else if (WATER.includes(t)) {
      for (let k = 0; k < 5; k++) el("path", { d: `M${x - 40} ${y - 30 + k * 15} q10 -5 20 0 t20 0 t20 0 t20 0`, class: "ink" });
    }
  }
  drawMap() {
    const { pm, W, H, uid } = this, el = (tag, a, p = this.world) => this.node(tag, a, p);
    this.world.innerHTML = "";
    // за границей района та же суша, темнее и с бледной сеткой: при любом наезде камеры экран заполнен картой
    const E = 1600;
    el("rect", { x: -E, y: -E, width: W + 2 * E, height: H + 2 * E, class: "outer" });
    el("rect", { x: -E, y: -E, width: W + 2 * E, height: H + 2 * E, fill: `url(#tb-br-dots-${uid})`, opacity: .5 });
    const og = el("g", { opacity: .35 });
    for (let c = -16; c <= pm.cols + 16; c++) el("line", { x1: c * CELL, y1: -E, x2: c * CELL, y2: H + E, class: "gridl" }, og);
    for (let r = -16; r <= pm.rows + 16; r++) el("line", { x1: -E, y1: r * CELL, x2: W + E, y2: r * CELL, class: "gridl" }, og);
    el("rect", { x: 0, y: 0, width: W, height: H, class: WATER.includes(pm.base) ? "sea" : "land" });
    for (const [k, h] of Object.entries(pm.hexes)) {
      const [c, r] = k.split(",").map(Number);
      if (WATER.includes(h.t)) el("rect", { x: c * CELL, y: r * CELL, width: CELL, height: CELL, class: "sea" });
      else if (h.t && WATER.includes(pm.base)) el("rect", { x: c * CELL, y: r * CELL, width: CELL, height: CELL, class: "land" });
    }
    el("rect", { x: 0, y: 0, width: W, height: H, fill: `url(#tb-br-dots-${uid})` });
    const g = el("g", {});
    for (let c = 0; c <= pm.cols; c++) el("line", { x1: c * CELL, y1: 0, x2: c * CELL, y2: H, class: "gridl" }, g);
    for (let r = 0; r <= pm.rows; r++) el("line", { x1: 0, y1: r * CELL, x2: W, y2: r * CELL, class: "gridl" }, g);
    el("rect", { x: 0, y: 0, width: W, height: H, class: "ao" }, g);
    for (let c = 0; c < pm.cols; c++) for (let r = 0; r < pm.rows; r++) el("text", { x: c * CELL + 5, y: r * CELL + 12, class: "coord" }, g).textContent = cellName(c, r);
    const ter = el("g", {});
    for (let c = 0; c < pm.cols; c++) for (let r = 0; r < pm.rows; r++) {
      const t = pm.hexes[`${c},${r}`]?.t;
      if (t) this.terrain(ter, c, r, t);
      else if (WATER.includes(pm.base) && rnd(c, r, 99) < .5) this.terrain(ter, c, r, pm.base);
    }
    // погода: штрихованные клетки, подпись первого явления
    this.wx = el("g", { opacity: .35 });
    for (const [k, h] of Object.entries(pm.hexes)) {
      if (!h.fx?.length) continue;
      const [c, r] = k.split(",").map(Number);
      el("rect", { x: c * CELL + 4, y: r * CELL + 4, width: CELL - 8, height: CELL - 8, class: "wx", fill: `url(#tb-br-hatch-${uid})` }, this.wx);
      el("text", { x: c * CELL + 10, y: r * CELL + CELL - 10, class: "wxlab" }, this.wx).textContent = `≋ ${String(pm.wx?.[h.fx[0]] ?? h.fx[0]).toUpperCase()}`;
    }
    // линия возврата: штриховка клеток за линией и пунктир по границе, ярко на этапе с ret
    this.retG = el("g", { opacity: .4 });
    if (pm.ret?.cells?.length) {
      for (const k of pm.ret.cells) { const [c, r] = k.split(",").map(Number); el("rect", { x: c * CELL, y: r * CELL, width: CELL, height: CELL, class: "retz", fill: `url(#tb-br-hatch-${uid})` }, this.retG); }
      const edges = retEdges(pm.ret.cells, pm.cols, pm.rows);
      for (const [a, b, c2, d] of edges) el("line", { x1: a * CELL, y1: b * CELL, x2: c2 * CELL, y2: d * CELL, class: "retl" }, this.retG);
      if (edges.length) {
        const [a, b, c2, d] = retLabelEdge(edges), x = (a + c2) / 2 * CELL, y = (b + d) / 2 * CELL;
        el("text", { x, y, dy: -6, "text-anchor": "middle", class: "retlab", ...(a === c2 ? { transform: `rotate(-90 ${x} ${y})` } : {}) }, this.retG).textContent = pm.ret.mode === "border" ? "DEFENSE LINE" : "RETURN LINE";
      }
    }
    for (const [k, h] of Object.entries(pm.hexes)) {
      if (!h.label) continue;
      const [c, r] = k.split(",").map(Number), [x, y] = ctr(c, r);
      el("text", { x, y: y + 40, "text-anchor": "middle", class: "place" }).textContent = h.label.toUpperCase();
    }
    // зоны поражения ПВО
    const thr = el("g", {});
    for (const u of pm.units) if (u.side === "enemy" && u.rng) {
      const [x, y] = ctr(u.c, u.r);
      el("circle", { cx: x, cy: y, r: u.rng, class: "threat", "data-id": u.id }, thr);
    }
    this.routeG = el("g", {});
    // силы
    const ug = el("g", {});
    const offsetOf = u => {
      const same = pm.units.filter(v => v.c === u.c && v.r === u.r && v.k !== "goal");
      const i = same.indexOf(u);
      return same.length < 2 ? [0, -10] : [[-24, -22], [24, -22], [-24, 14], [24, 14]][i % 4].map((v, k) => v + (k ? Math.floor(i / 4) * 8 : 0));
    };
    for (const u of pm.units) {
      const [x, y] = ctr(u.c, u.r), off = u.k === "goal" ? [0, 0] : offsetOf(u);
      const g2 = el("g", { class: `u ${sideCls(u.side)} off`, "data-id": u.id, transform: `translate(${x + off[0]} ${y + off[1]})` }, ug);
      this.icon(this.node("g", { transform: "scale(1.25)" }, g2), u);
      if (u.k !== "goal") {
        // подпись под значком, длинное имя в две строки: соседние клетки не наезжают друг на друга
        const name = u.name.toUpperCase(), cut = name.length > 15 ? name.lastIndexOf(" ", Math.ceil(name.length / 2) + 3) : -1;
        const rows = cut > 0 ? [name.slice(0, cut), name.slice(cut + 1)] : [name];
        rows.forEach((t, k) => { el("text", { x: 0, y: 24 + k * 11, "text-anchor": "middle", class: "lab" }, g2).textContent = t; });
        const sub = u.k === "air" ? ALT_NAME[u.alt] ?? "" : u.k === "unk" ? [SUB.unk, ALT_NAME[u.alt]].filter(Boolean).join(" · ") : SUB[u.k] ?? "";
        el("text", { x: 0, y: 24 + rows.length * 11, "text-anchor": "middle", class: "sub" }, g2).textContent = [u.count > 1 ? `×${u.count}` : "", sub].filter(Boolean).join(" · ");
      }
      el("path", { d: "M-20 -12 V-20 H-12 M12 -20 H20 V-12 M20 12 V20 H12 M-12 20 H-20 V12", class: "bracket" }, g2);
      el("text", { x: 0, y: -24, "text-anchor": "middle", class: "tgtlab" }, g2).textContent = "ЦЕЛЬ";
    }
  }
  icon(g, u) {
    const el = (tag, a) => this.node(tag, { class: "ico", ...a }, g), n = Math.min(u.count || 1, 4), k = u.k;
    if (k === "air" || k === "flight") {
      const dir = u.side === "player" || u.side === "ally" ? 1 : -1;
      for (let i = 0; i < Math.min(n, 2); i++) el("path", { d: "M10 0 L-7 -7 L-3 0 L-7 7 Z", transform: `translate(${-i * 7} ${i * 7 - (n > 1 ? 3 : 0)}) scale(${dir} 1)` });
    } else if (k === "sam") { el("circle", { r: 9 }); el("path", { d: "M-4 3 L0 -5 L4 3" }); }
    else if (k === "aa") { el("circle", { r: 9 }); el("path", { d: "M-4 4 L-2 -4 M0 4 L0 -5 M4 4 L2 -4" }); }
    else if (k === "jam") { el("circle", { r: 9 }); el("path", { d: "M-6 1 L-3 -3 L0 3 L3 -3 L6 1" }); }
    else if (k === "radar") { el("circle", { r: 9 }); el("path", { d: "M-5 2 A6 6 0 0 1 5 2 M0 2 V-4" }); }
    else if (k === "ship") { el("path", { d: "M-12 -1 H12 L8 6 H-8 Z" }); el("path", { d: "M-2 -1 V-8 H3" }); }
    else if (k === "armor") { el("rect", { x: -11, y: -7, width: 22, height: 14 }); el("ellipse", { rx: 7, ry: 3.5 }); }
    else if (k === "art") { el("rect", { x: -11, y: -7, width: 22, height: 14 }); el("circle", { r: 2.6, class: "ico dot" }); }
    else if (k === "convoy") { el("rect", { x: -10, y: -6, width: 20, height: 12, rx: 5 }); el("path", { d: "M-5 0 h0.1 M0 0 h0.1 M5 0 h0.1", "stroke-width": 3, "stroke-linecap": "round" }); }
    else if (k === "goal") el("path", { d: "M0 -14 L14 0 L0 14 L-14 0 Z", "stroke-dasharray": "3 3" });
    else if (k === "unk") { el("circle", { r: 10, "stroke-dasharray": "3 2.4" }); el("path", { d: "M-3.4 -3.2 Q-3.4 -6.4 0 -6.4 Q3.6 -6.4 3.6 -3.4 Q3.6 -1 0 0.4 V2.6 M0 5.2 V5.4", "stroke-linecap": "round" }); }
    else { el("rect", { x: -8, y: -8, width: 16, height: 16 }); el("path", { d: "M-8 -8 L8 8 M8 -8 L-8 8" }); }
  }

  /* камера */
  setCam(c, stopAnim = false) {
    if (stopAnim) this.anim++;
    this.cam = { x: c.x, y: c.y, w: c.w, h: c.h };
    this.svg.setAttribute("viewBox", `${c.x.toFixed(1)} ${c.y.toFixed(1)} ${c.w.toFixed(1)} ${c.h.toFixed(1)}`);
    const cc = Math.floor((c.x + c.w / 2) / CELL), rr = Math.floor((c.y + c.h * .4) / CELL);
    this.r("cell").textContent = `КВ ${cc >= 0 && cc < this.pm.cols && rr >= 0 && rr < this.pm.rows ? cellName(cc, rr) : "—"} · М 1:${Math.round(c.w * 280).toLocaleString("ru-RU")}`;
  }
  moveCam(to, ms = 1500) {
    const from = { ...this.cam }, t0 = performance.now(), id = ++this.anim;
    if (reduceMotion() || !ms) return this.setCam(to);
    const ease = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    const step = now => {
      if (id !== this.anim || !this.el.isConnected) return;
      const t = Math.min(1, (now - t0) / ms), e = ease(t);
      this.setCam({ x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e, w: from.w + (to.w - from.w) * e, h: from.h + (to.h - from.h) * e });
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
  focusCam(step = this.step) { this.moveCam(fitCam(step?.focus ?? "all", this.pm.cols, this.pm.rows), 900); }

  /* субтитры */
  async say(text) {
    const id = ++this.typing, say = this.r("say"), fast = reduceMotion();
    say.textContent = "";
    for (const ch of String(text ?? "")) {
      if (id !== this.typing || !this.el.isConnected) return;
      say.textContent += ch;
      if (ch !== " " && Math.random() < .25) this.audio.tick();
      if (!fast) await new Promise(r => setTimeout(r, 24));
    }
  }

  /** Показать этап: { step, i, n, known } — known: силы, уже появившиеся к этому этапу. */
  show({ step, i = 0, n = 1, known = null, quiet = false }) {
    const s = step ?? { focus: "all", text: "" };
    this.step = s;
    this.r("num").textContent = `${String(i + 1).padStart(2, "0")}/${String(n).padStart(2, "0")}`;
    this.moveCam(fitCam(s.focus, this.pm.cols, this.pm.rows), quiet ? 0 : 1500);
    // dim из конструктора: на карте ровно show ∪ dim, dim приглушены; иначе всё, что уже появлялось, и фокус по show
    const showSet = new Set(s.show ?? []), tg = new Set(s.targets ?? []), bl = new Set(s.blink ?? []), dimSet = new Set(s.dim ?? []);
    const kn = s.dim ? new Set([...showSet, ...dimSet]) : new Set(known ?? s.show ?? []);
    const at = ++this.shown;
    this.el.querySelectorAll(".u").forEach(g => {
      const id = g.dataset.id;
      g.classList.toggle("off", !kn.has(id));
      g.classList.toggle("dim", kn.has(id) && (s.dim ? dimSet.has(id) && !showSet.has(id) : !showSet.has(id) && s.focus !== "all"));
      g.classList.toggle("blink", bl.has(id) || tg.has(id));
      g.classList.remove("on");
      if (tg.has(id)) this.later(() => { if (this.shown === at) g.classList.add("on"); }, quiet ? 0 : 700);
    });
    const rings = Array.isArray(s.threat) ? new Set(s.threat) : null;
    // в явном режиме круг виден, только если его сила на карте
    this.el.querySelectorAll(".threat").forEach(c => c.classList.toggle("on", (rings ? rings.has(c.dataset.id) : !!s.threat || (s.focus === "all" && i > 0 && !s.dim)) && (!s.dim || kn.has(c.dataset.id))));
    // пометки этапа из конструктора и фото во врезке
    this.stepMarks.innerHTML = "";
    for (const k of s.marks ?? []) { const [c, r] = k.split(",").map(Number); this.node("rect", { x: c * CELL + 3, y: r * CELL + 3, width: CELL - 6, height: CELL - 6, class: "mark" }, this.stepMarks); }
    for (const [x1, y1, x2, y2] of s.lines ?? []) this.node("line", { x1, y1, x2, y2, class: "penline", "marker-end": `url(#tb-br-pen-${this.uid})` }, this.stepMarks);
    const ph = this.r("photo");
    ph.hidden = !s.img;
    ph.classList.remove("in");
    if (s.img) { ph.querySelector("img").src = s.img.src; ph.querySelector("figcaption").textContent = s.img.cap ?? ""; if (!quiet) { void ph.offsetWidth; ph.classList.add("in"); } }
    this.wx.setAttribute("opacity", s.wx ? 1 : .35);
    this.retG?.setAttribute("opacity", s.ret ? 1 : .4);
    this.drawRoute(s.route, !s.final && !quiet);
    if (!quiet) {
      if (s.final) { this.audio.tone(800, .4, .03); this.audio.tone(800, .4, .03, .55); }
      else { this.audio.tone(1000, .12, .03); this.audio.tone(1300, .12, .025, .14); }
      if (tg.size) this.later(() => this.audio.tone(1500, .08, .03), 700);
    }
    this.r("hint").textContent = s.final ? "ДАЛЬШЕ — СЦЕНА МИССИИ" : this.hint;
    this.say(s.text);
  }
  // маршрут звена: пунктир виден сквозь маску, сплошная линия маски растёт от входа к целям
  drawRoute(route, animate) {
    this.routeG.innerHTML = "";
    if (!Array.isArray(route) || route.length < 2) return;
    const pts = route.map(([c, r], i) => { const [x, y] = ctr(c, r); return i ? [x, y - 18] : [x + 26, y]; });
    const d = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
    const mid = `tb-br-route-${this.uid}`;
    const mask = this.node("mask", { id: mid, maskUnits: "userSpaceOnUse", x: -800, y: -800, width: this.W + 1600, height: this.H + 1600 }, this.routeG);
    const draw = this.node("path", { d, fill: "none", stroke: "#fff", "stroke-width": 26, "stroke-linecap": "round", "stroke-linejoin": "round" }, mask);
    this.node("path", { d, class: "route", "marker-end": `url(#tb-br-arr-${this.uid})`, mask: `url(#${mid})` }, this.routeG);
    if (!animate || reduceMotion()) return;
    const len = draw.getTotalLength?.() ?? 2000;
    draw.style.strokeDasharray = `${len + 30} ${len + 30}`; draw.style.strokeDashoffset = len + 30;
    draw.getBoundingClientRect();
    draw.style.transition = "stroke-dashoffset 2.6s ease-in-out .8s"; draw.style.strokeDashoffset = 0;
  }

  /* указка */
  toggleMark(c, r) {
    const k = `${c},${r}`;
    if (this.marks.has(k)) { this.marks.get(k).remove(); this.marks.delete(k); return; }
    this.marks.set(k, this.node("rect", { x: c * CELL + 3, y: r * CELL + 3, width: CELL - 6, height: CELL - 6, class: "mark" }, this.pen));
  }
  ping(x, y) { const c = this.node("circle", { cx: x, cy: y, r: 4, class: "ping" }, this.pen); this.later(() => c.remove(), 1200); this.audio.tone(1500, .07, .03); }
  addLine([x1, y1, x2, y2]) { this.node("line", { x1, y1, x2, y2, class: "penline", "marker-end": `url(#tb-br-pen-${this.uid})` }, this.pen); this.audio.tone(1200, .06, .03); }
  clearPen() { this.pen.innerHTML = ""; this.marks.clear(); }
  setTool(t) { this.tool = t; this.svg.dataset.tool = t; }
  bind() {
    const svg = this.svg;
    this.setTool("pan");
    const toWorld = ev => { const p = svg.createSVGPoint(); p.x = ev.clientX; p.y = ev.clientY; return p.matrixTransform(svg.getScreenCTM().inverse()); };
    let drag = null;
    svg.addEventListener("pointerdown", ev => {
      if (ev.button !== 0) return;
      const p = toWorld(ev);
      svg.setPointerCapture?.(ev.pointerId);
      if (this.tool === "pan") { drag = { kind: "pan", sx: ev.clientX, sy: ev.clientY, cam: { ...this.cam } }; svg.classList.add("drag"); this.anim++; }
      else if (this.tool === "line") drag = { kind: "line", x: p.x, y: p.y, el: this.node("line", { x1: p.x, y1: p.y, x2: p.x, y2: p.y, class: "penline draft" }, this.pen) };
      else if (this.tool === "mark") {
        const c = Math.floor(p.x / CELL), r = Math.floor(p.y / CELL);
        this.ping(p.x, p.y); this.on.ping?.(Math.round(p.x), Math.round(p.y));
        if (c >= 0 && r >= 0 && c < this.pm.cols && r < this.pm.rows) { this.toggleMark(c, r); this.on.mark?.(c, r); }
      }
    });
    svg.addEventListener("pointermove", ev => {
      if (!drag) return;
      if (drag.kind === "pan") {
        const k = this.cam.w / svg.getBoundingClientRect().width;
        this.setCam({ ...drag.cam, x: drag.cam.x - (ev.clientX - drag.sx) * k, y: drag.cam.y - (ev.clientY - drag.sy) * k });
        this.on.cam?.(this.cam);
      } else { const p = toWorld(ev); drag.el.setAttribute("x2", p.x); drag.el.setAttribute("y2", p.y); }
    });
    const end = () => {
      if (drag?.kind === "line") {
        const l = drag.el, x2 = l.x2.baseVal.value, y2 = l.y2.baseVal.value;
        l.remove();
        if (Math.hypot(x2 - drag.x, y2 - drag.y) >= 12) { const line = [drag.x, drag.y, x2, y2].map(Math.round); this.addLine(line); this.on.line?.(line); }
      }
      drag = null; svg.classList.remove("drag");
    };
    svg.addEventListener("pointerup", end); svg.addEventListener("pointercancel", end);
    // колесо: масштаб вокруг курсора, в любом режиме указки
    svg.addEventListener("wheel", ev => {
      ev.preventDefault(); ev.stopPropagation(); this.anim++;
      const p = toWorld(ev), f = Math.exp(ev.deltaY * .0012), w = Math.max(220, Math.min(Math.max(this.W, this.H * ASP) * 2.2, this.cam.w * f)), k = w / this.cam.w;
      this.setCam({ x: p.x - (p.x - this.cam.x) * k, y: p.y - (p.y - this.cam.y) * k, w, h: w / ASP });
      this.on.cam?.(this.cam);
    }, { passive: false });
  }
  destroy() { this.typing++; this.anim++; this.timers.forEach(clearTimeout); this.timers.clear(); this.audio.close(); }
}

/* ---------- показ у всех ---------- */
let view = null;   // экран брифинга у этого клиента: { el, screen, gm }
let live = null;   // показ, который ведёт этот ведущий: { sceneId, pm, op, steps, i, marks, lines, cam }
const emit = msg => game.socket?.emit(CHANNEL, msg);

function closeView(fade = 0) {
  const v = view; if (!v) return;
  view = null;
  document.removeEventListener("keydown", v.onKey, true);
  v.screen.destroy();
  v.pill?.remove();
  v.el.classList.add("out");
  setTimeout(() => v.el.remove(), fade || 10);
}

function openView({ pm, op, gm = false }) {
  closeView();
  const el = document.createElement("div");
  el.className = "tb-br-overlay";
  el.innerHTML = `<div class="tb-br-host"></div>${gm ? `<div class="tb-br-gm" role="toolbar" aria-label="Пульт брифинга">
      <button type="button" data-a="prev" title="Предыдущий этап"><i class="fas fa-backward-step"></i></button>
      <span class="n" data-r="n">01/01</span>
      <button type="button" data-a="next" class="main">Далее <i class="fas fa-forward-step"></i></button>
      <span class="tools">
        <button type="button" data-tool="pan" aria-pressed="true" title="Тянуть карту; колесо мыши — масштаб"><i class="fas fa-hand"></i></button>
        <button type="button" data-tool="mark" aria-pressed="false" title="Метка: щелчок подсвечивает клетку, повторный снимает"><i class="fas fa-crosshairs"></i></button>
        <button type="button" data-tool="line" aria-pressed="false" title="Линия: протяните от точки до точки — стрелка"><i class="fas fa-arrow-trend-up"></i></button>
      </span>
      <button type="button" data-a="clear" title="Стереть метки и линии у всех"><i class="fas fa-eraser"></i></button>
      <button type="button" data-a="focus" title="Вернуть камеру этапа у всех"><i class="fas fa-crop-simple"></i></button>
      <button type="button" data-a="hide" title="Свернуть у себя: брифинг у игроков идёт дальше, окно «Брифинг» снова доступно"><i class="fas fa-window-minimize"></i></button>
      <button type="button" data-a="stop" title="Закончить брифинг у всех (Esc)"><i class="fas fa-xmark"></i></button>
    </div>` : ""}`;
  document.body.append(el);
  const on = gm ? {
    cam: cam => { if (!live) return; live.cam = { ...cam }; sendCam(); },
    mark: (c, r) => { if (!live) return; const k = `${c},${r}`; live.marks.has(k) ? live.marks.delete(k) : live.marks.add(k); emit({ type: "brief", op: "mark", c, r }); },
    line: l => { live?.lines.push(l); emit({ type: "brief", op: "line", l }); },
    ping: (x, y) => emit({ type: "brief", op: "ping", x, y })
  } : {};
  const screen = new BriefScreen(el.querySelector(".tb-br-host"), { pm, op, interactive: gm, on });
  view = { el, screen, gm };
  view.onKey = ev => {
    if (ev.key !== "Escape" || el.hidden) return;
    ev.stopPropagation(); ev.preventDefault();
    if (gm) stopBriefing(); else closeView(600);
  };
  document.addEventListener("keydown", view.onKey, true);
  if (gm) {
    const bar = el.querySelector(".tb-br-gm");
    bar.addEventListener("click", ev => {
      const b = ev.target.closest("button"); if (!b) return;
      if (b.dataset.tool) {
        screen.setTool(b.dataset.tool);
        bar.querySelectorAll("[data-tool]").forEach(x => x.setAttribute("aria-pressed", x === b));
        return;
      }
      const a = b.dataset.a;
      if (a === "prev") goStep(live.i - 1);
      else if (a === "next") goStep(live.i + 1);
      else if (a === "clear") { screen.clearPen(); live.marks.clear(); live.lines = []; emit({ type: "brief", op: "clear" }); }
      else if (a === "focus") { live.cam = null; screen.focusCam(); emit({ type: "brief", op: "focus" }); }
      else if (a === "hide") hideView(true);
      else if (a === "stop") stopBriefing();
    });
  }
  requestAnimationFrame(() => el.classList.add("on"));
  return view;
}

/** Свернуть экран у ведущего: показ у игроков идёт, внизу кнопка «Брифинг идёт» возвращает его. */
function hideView(hide) {
  if (!view?.gm) return;
  view.el.hidden = hide;
  view.pill?.remove(); view.pill = null;
  if (!hide) return;
  const p = view.pill = document.createElement("button");
  p.type = "button"; p.className = "tb-br-pill";
  p.innerHTML = `<i class="fas fa-map"></i> Брифинг идёт · вернуть экран`;
  p.addEventListener("click", () => hideView(false));
  document.body.append(p);
}

let camTimer = null, camAt = 0;
function sendCam() {
  // камера ведущего у игроков: не чаще раза в 80 мс, последнее положение всегда доходит
  const now = Date.now(), wait = 80 - (now - camAt);
  clearTimeout(camTimer);
  const go = () => { camAt = Date.now(); if (live?.cam) emit({ type: "brief", op: "cam", cam: live.cam }); };
  if (wait <= 0) go(); else camTimer = setTimeout(go, wait);
}

function stepMsg(i) { return { i, n: live.steps.length, step: live.steps[i], known: knownUpTo(live.steps, i) }; }

function updateBar() {
  const bar = view?.el.querySelector(".tb-br-gm"); if (!bar || !live) return;
  bar.querySelector('[data-r="n"]').textContent = `${String(live.i + 1).padStart(2, "0")}/${String(live.steps.length).padStart(2, "0")}`;
  bar.querySelector('[data-a="prev"]').disabled = live.i <= 0;
  const next = bar.querySelector('[data-a="next"]');
  next.disabled = live.i >= live.steps.length - 1;
  next.innerHTML = live.steps[live.i + 1]?.final ? `Конец брифинга <i class="fas fa-forward-step"></i>` : `Далее <i class="fas fa-forward-step"></i>`;
}

/** Ведущий: показать этап i у всех. */
export function goStep(i) {
  if (!live) return;
  live.i = Math.max(0, Math.min(live.steps.length - 1, i));
  live.cam = null;
  const m = stepMsg(live.i);
  emit({ type: "brief", op: "step", ...m });
  view?.screen.show(m);
  updateBar();
  Hooks.callAll("thunderboltBriefingStep", live.i);
}

/** Запустить брифинг сцены у всех. from — с какого этапа. */
export async function startBriefing(scene = game.scenes?.viewed, { from = 0 } = {}) {
  if (!game.user?.isGM) return;
  const { mission, steps } = briefingOf(scene);
  if (!mission) { openBriefing(scene); return ui.notifications.warn("Брифинг: на этой сцене нет данных миссии. Вставьте JSON из Планшета AWACS в окне «Брифинг»."); }
  if (!steps.length) return ui.notifications.warn("Брифинг: нет ни одного этапа.");
  const op = briefingOf(scene).op || bootOptions(scene).op;
  live = { sceneId: scene.id, pm: mission, op, steps, i: -1, marks: new Set(), lines: [], cam: null };
  emit({ type: "brief", op: "start", pm: mission, title: op });
  openView({ pm: mission, op, gm: true });
  goStep(from);
}

/** Сначала заставка АСУ «Тайга» у всех (настройки со сцены), потом брифинг. */
export async function bootThenBriefing(scene = game.scenes?.viewed) {
  if (!briefingOf(scene).mission) return startBriefing(scene);
  await startBoot({}, { scene });
  return startBriefing(scene);
}

/** Закончить брифинг у всех. */
export function stopBriefing() {
  if (game.user?.isGM && live) emit({ type: "brief", op: "stop" });
  live = null;
  closeView(1000);
  Hooks.callAll("thunderboltBriefingStep", -1);
}


function onMessage(msg) {
  if (msg?.type === "briefHello") {
    // игрок зашёл посреди показа: отвечает тот ведущий, который его ведёт
    if (!live || !game.user.isGM) return;
    const m = stepMsg(live.i);
    emit({ type: "brief", op: "start", to: msg.user, pm: live.pm, title: live.op, sync: { ...m, marks: [...live.marks], lines: live.lines, cam: live.cam } });
    return;
  }
  if (msg?.type !== "brief" || (msg.to && msg.to !== game.user.id)) return;
  if (msg.op === "start") {
    if (live) live = null;   // запустил другой ведущий: этот только смотрит
    openView({ pm: msg.pm, op: msg.title, gm: false });
    const s = msg.sync;
    if (s?.step) {
      view.screen.show({ ...s, quiet: true });
      for (const k of s.marks ?? []) view.screen.toggleMark(...k.split(",").map(Number));
      for (const l of s.lines ?? []) view.screen.addLine(l);
      if (s.cam) view.screen.setCam(s.cam, true);
    }
    return;
  }
  const sc = view?.screen;
  if (msg.op === "stop") return closeView(1000);
  if (!sc) return;
  if (msg.op === "step") sc.show(msg);
  else if (msg.op === "cam" && msg.cam) sc.setCam(msg.cam, true);
  else if (msg.op === "focus") sc.focusCam();
  else if (msg.op === "mark") sc.toggleMark(msg.c, msg.r);
  else if (msg.op === "line" && Array.isArray(msg.l)) sc.addLine(msg.l);
  else if (msg.op === "ping") sc.ping(msg.x, msg.y);
  else if (msg.op === "clear") sc.clearPen();
}

export function registerBriefing() {
  Hooks.once("ready", () => {
    game.socket.on(CHANNEL, onMessage);
    if (!game.user.isGM) emit({ type: "briefHello", user: game.user.id });
  });
}

/* ---------- окно ведущего ---------- */
let EditorClass = null;
function editorClass() {
  return EditorClass ??= class BriefingEditor extends Application {
    static get defaultOptions() {
      return foundry.utils.mergeObject(super.defaultOptions, {
        id: "tb-briefing", title: "Брифинг", classes: ["thunderbolt", "tb-bred-app"], width: 960, height: 900, resizable: true
      });
    }
    constructor(scene, options = {}) {
      super(options);
      this.scene = scene;
      this.cur = 0;
      this.load();
      this.saveNow = () => this.scene.update({ [`flags.${SYSTEM_ID}.briefing.steps`]: cleanSteps(this.steps) });
      this.save = foundry.utils.debounce(this.saveNow, 500);
    }
    get title() { return `Брифинг · ${this.scene?.name ?? ""}`; }
    load() { const b = briefingOf(this.scene); this.pm = b.mission; this.steps = b.steps; }
    async _renderInner() {
      if (!this.pm) return $(`<div class="tb-bred"><div class="tb-bred-empty">
        <p class="tb-hint">На сцене «${esc(this.scene?.name ?? "")}» нет данных миссии для брифинга: сцена создана раньше, чем брифинг появился в системе, или не импортом. Загрузите файл брифинга из конструктора брифингов или вставьте его текст сюда. Подойдёт и JSON миссии из Планшета AWACS (кнопка «JSON»): тогда этапы соберутся сами. Сцена и токены не изменятся.</p>
        <input type="file" name="file" accept=".json,application/json">
        <textarea name="json" rows="14" placeholder='{"name": "…", "cols": 8, "rows": 5, …}'></textarea>
        <div class="tb-bred-bar"><span class="sp"></span><button type="button" data-a="json-save" class="main"><i class="fas fa-file-import"></i> Загрузить брифинг</button></div></div></div>`);
      return $(`<div class="tb-bred">
        <div class="tb-bred-prev"></div>
        <div class="tb-bred-bar">
          <button type="button" data-a="pv-prev" title="Предыдущий этап (только у вас)"><i class="fas fa-backward-step"></i></button>
          <button type="button" data-a="pv-next" title="Следующий этап (только у вас)"><i class="fas fa-forward-step"></i></button>
          <span class="tb-hint">Предпросмотр только у вас: тяните карту, колесо — масштаб, «Взять вид» запоминает камеру этапа.</span>
          <span class="sp"></span>
          <button type="button" data-a="boot" title="Сначала заставка АСУ «Тайга» у всех (настройки с этой сцены), сразу за ней брифинг"><i class="fas fa-terminal"></i> Заставка и брифинг</button>
          <button type="button" data-a="start" class="main" title="Брифинг поверх стола у всех игроков, с текущего этапа"><i class="fas fa-play"></i> Начать у всех</button>
        </div>
        <div class="tb-bred-steps"></div>
        <div class="tb-bred-bar foot">
          <button type="button" data-a="add" title="Новый этап после текущего, с камерой как сейчас в предпросмотре"><i class="fas fa-plus"></i> Этап</button>
          <button type="button" data-a="rebuild" title="Собрать этапы заново из миссии; ваши правки текста пропадут"><i class="fas fa-rotate"></i> Пересобрать из миссии</button>
          <button type="button" data-a="json" title="Заменить брифинг файлом из конструктора брифингов или JSON миссии из Планшета AWACS"><i class="fas fa-file-import"></i> Загрузить брифинг</button>
          <span class="sp"></span>
          <span class="tb-hint">Правки сохраняются на сцене сами. Поворот и заметки ведущего игрокам не показываются.</span>
        </div></div>`);
    }
    activateListeners(html) {
      super.activateListeners(html);
      const root = html[0] ?? html;
      root.addEventListener("click", ev => {
        const b = ev.target.closest("[data-a]"); if (!b || b.closest(".tb-bred-st")) return;
        this.act(b.dataset.a, root);
      });
      if (!this.pm) return;
      this.screen?.destroy();
      this.screen = new BriefScreen(root.querySelector(".tb-bred-prev"), { pm: this.pm, op: briefingOf(this.scene).op || bootOptions(this.scene).op, interactive: true, hint: "ПРЕДПРОСМОТР" });
      this.renderSteps();
      this.preview(Math.min(this.cur, this.steps.length - 1), true);
    }
    preview(i, quiet = false) {
      if (!this.steps.length) return;
      this.cur = Math.max(0, Math.min(this.steps.length - 1, i));
      // во время показа «Показать» ведёт брифинг у всех
      if (live && live.sceneId === this.scene.id) { live.steps = this.steps; goStep(this.cur); }
      this.screen?.show({ step: this.steps[this.cur], i: this.cur, n: this.steps.length, known: knownUpTo(this.steps, this.cur), quiet });
      this.element?.[0]?.querySelectorAll(".tb-bred-st").forEach((x, k) => x.classList.toggle("cur", k === this.cur));
    }
    changed() { this.save(); if (live && live.sceneId === this.scene.id) live.steps = this.steps; }
    renderSteps() {
      const box = this.element?.[0]?.querySelector(".tb-bred-steps") ?? document.querySelector("#tb-briefing .tb-bred-steps");
      if (!box) return;
      box.innerHTML = this.steps.map((s, k) => `<div class="tb-bred-st${k === this.cur ? " cur" : ""}" data-i="${k}">
        <div class="n">${String(k + 1).padStart(2, "0")}</div>
        <input type="text" class="title" value="${esc(s.title)}" aria-label="Название этапа ${k + 1} (видно только вам)">
        <span class="acts">
          <a data-a="view" title="Камера этого этапа встанет так, как сейчас в предпросмотре">Взять вид</a>
          <a data-a="show" title="${live ? "Показать этот этап у всех" : "Показать в предпросмотре"}">Показать</a>
          <a data-a="up" title="Выше"><i class="fas fa-arrow-up"></i></a><a data-a="down" title="Ниже"><i class="fas fa-arrow-down"></i></a>
          <a data-a="del" title="Удалить этап"><i class="fas fa-trash"></i></a>
        </span>
        <textarea rows="2" aria-label="Текст этапа ${k + 1}">${esc(s.text)}</textarea></div>`).join("");
      box.querySelectorAll(".tb-bred-st").forEach(row => {
        const k = Number(row.dataset.i), s = this.steps[k];
        row.querySelector("textarea").addEventListener("input", ev => { s.text = ev.target.value; this.changed(); });
        row.querySelector("input.title").addEventListener("input", ev => { s.title = ev.target.value; this.changed(); });
        row.querySelector(".acts").addEventListener("click", ev => {
          const a = ev.target.closest("[data-a]")?.dataset.a; if (!a) return;
          if (a === "show") return this.preview(k);
          if (a === "view") { s.focus = { cam: { ...this.screen.cam } }; this.changed(); ev.target.closest("a").textContent = "Вид запомнен"; setTimeout(() => this.renderSteps(), 1200); return; }
          if (a === "up" || a === "down") {
            const j = a === "up" ? k - 1 : k + 1; if (j < 0 || j >= this.steps.length) return;
            [this.steps[k], this.steps[j]] = [this.steps[j], this.steps[k]];
            if (this.cur === k) this.cur = j; else if (this.cur === j) this.cur = k;
          } else if (a === "del") {
            this.steps.splice(k, 1);
            if (this.cur >= this.steps.length) this.cur = Math.max(0, this.steps.length - 1);
          }
          this.changed(); this.renderSteps();
        });
      });
    }
    async act(a, root) {
      if (a === "pv-prev") return this.preview(this.cur - 1);
      if (a === "pv-next") return this.preview(this.cur + 1);
      // правка, отложенная на полсекунды, должна попасть в брифинг до запуска
      if (a === "start") { await this.saveNow(); return startBriefing(this.scene, { from: this.cur }); }
      if (a === "boot") return bootThenBriefing(this.scene);
      if (a === "add") {
        const at = Math.min(this.cur + 1, this.steps.findIndex(s => s.final) >= 0 ? this.steps.findIndex(s => s.final) : this.steps.length);
        // этап из конструктора (явный фон): новый этап берёт на фон всё, что видно на текущем
        const now = this.steps[this.cur], bg = now?.dim ? { dim: [...new Set([...(now.show ?? []), ...now.dim])] } : {};
        this.steps.splice(at, 0, { title: "ЭТАП", text: "", focus: { cam: { ...this.screen.cam } }, show: [], ...bg });
        this.cur = at; this.changed(); this.renderSteps();
        this.element?.[0]?.querySelector(`.tb-bred-st[data-i="${at}"] textarea`)?.focus();
        return;
      }
      if (a === "rebuild") {
        const ok = await Dialog.confirm({ title: "Пересобрать брифинг", content: "<p>Собрать этапы заново из миссии? Ваши правки текста, камеры и добавленные этапы пропадут.</p>" });
        if (!ok) return;
        this.steps = buildSteps(this.pm); this.cur = 0; this.changed(); this.renderSteps(); this.preview(0);
        return;
      }
      if (a === "json") return this.askJson();
      if (a === "json-save") return this.applyJson(root.querySelector(".tb-bred-empty"));
    }
    askJson() {
      new Dialog({
        title: "Загрузить брифинг",
        content: `<form class="tb-dialog"><p class="tb-hint">Файл брифинга из конструктора брифингов (или его текст) либо JSON миссии из Планшета AWACS (кнопка «JSON»), тогда этапы соберутся сами. Текущий брифинг сцены заменится целиком, сцена и токены не изменятся.</p>
          <input type="file" name="file" accept=".json,application/json">
          <textarea name="json" rows="10" style="width:100%;font-family:monospace" placeholder="или вставьте текст"></textarea></form>`,
        buttons: { ok: { icon: '<i class="fas fa-file-import"></i>', label: "Загрузить", callback: html => this.applyJson(html[0].querySelector("form")) }, cancel: { label: "Отмена" } },
        default: "ok"
      }, { width: 560, classes: ["dialog", "thunderbolt"] }).render(true);
    }
    /** form — где лежат поле файла и текст; файл важнее текста. */
    async applyJson(form) {
      try {
        const file = form?.querySelector("input[type=file]")?.files?.[0];
        const text = file ? await file.text() : String(form?.querySelector("textarea")?.value ?? "");
        if (!text.trim()) throw new Error("выберите файл или вставьте текст");
        const { catalog } = await import("./apps/mission-import.mjs");
        const b = readBriefingJson(JSON.parse(text.trim()), await catalog());
        await saveBriefing(this.scene, b);
        // название операции из конструктора идёт и в заставку, если там своё не задано
        if (b.op && !this.scene.getFlag(SYSTEM_ID, "boot")?.op) await this.scene.setFlag(SYSTEM_ID, "boot", { ...bootOptions(this.scene), op: b.op });
        this.cur = 0; this.load(); this.render(true);
        ui.notifications.info(`${b.from === "editor" ? "Брифинг загружен" : "Брифинг собран из миссии"}: этапов ${this.steps.length}.`);
      } catch (e) { console.error(e); ui.notifications.error(`Не получилось: ${e.message}`); }
    }
    async close(options) { this.screen?.destroy(); this.screen = null; return super.close(options); }
  };
}

/** Окно «Брифинг» для сцены (по умолчанию открытой): предпросмотр, этапы, запуск. */
export function openBriefing(scene = game.scenes?.viewed) {
  if (!game.user?.isGM) return;
  if (!scene) return ui.notifications.warn("Нет открытой сцены.");
  const open = Object.values(ui.windows).find(w => w.id === "tb-briefing");
  if (open && open.scene === scene) { open.render(true); open.bringToTop?.(); return open; }
  open?.close();
  return new (editorClass())(scene).render(true);
}
