/* Импорт миссии из Планшета AWACS (кнопка «JSON» в планшете): сцена с клетками местности, токены NPC и журнал брифинга. */
import { SYSTEM_ID, SYS_PATH, TB, footprintOf } from "../config.mjs";
import { squadLayout, setSquadLayout } from "../squadrons.mjs";
import { npcActor } from "../data/catalog-docs.mjs";
import { esc } from "../utils.mjs";
import { zonePacker } from "../tokens.mjs";

const COL_LETTERS = "АБВГДЕЖИКЛМНОПРСТУФХЦЧШЭЮЯ";
const cellName = (c, r) => (COL_LETTERS[c] ?? "?") + (r + 1);
const ALT = { L: "low", M: "med", H: "high" };
const SIDE = {
  enemy: CONST.TOKEN_DISPOSITIONS.HOSTILE, ally: CONST.TOKEN_DISPOSITIONS.FRIENDLY,
  player: CONST.TOKEN_DISPOSITIONS.FRIENDLY, neutral: CONST.TOKEN_DISPOSITIONS.NEUTRAL
};

let CATALOG = null;
export async function catalog() {
  if (!CATALOG) CATALOG = await (await fetch(SYS_PATH + "data/catalog.json")).json();
  return CATALOG;
}

const MAP = SYS_PATH + "assets/map/";
const S = 200;

/** Табличка с текстом: тёмная плашка и белые буквы с обводкой — читается на любой местности и при любом масштабе. */
function plate(x, y, w, h, text, { size = 17, fill = "#1e2822", alpha = 0.78 } = {}) {
  return {
    x, y, shape: { type: "r", width: w, height: h }, text, fontSize: size, fontFamily: "Signika", textColor: "#ffffff", textAlpha: 1,
    fillType: CONST.DRAWING_FILL_TYPES.SOLID, fillColor: fill, fillAlpha: alpha, strokeWidth: 1, strokeColor: "#9daa7a", strokeAlpha: 0.6,
    locked: true, flags: { [SYSTEM_ID]: { map: true } }
  };
}

const tile = (src, x, y, w, h, sort, alpha = 1) => ({
  texture: { src }, x, y, width: w, height: h, sort, alpha, locked: true, elevation: 0, flags: { [SYSTEM_ID]: { map: true } }
});

/** Погода, которая лежит на всех клетках карты, становится погодой всей сцены; остальная остаётся по клеткам. */
function splitWeather(m) {
  const cells = {};
  for (const [k, h] of Object.entries(m.hexes ?? {})) {
    const ids = (h.fx ?? []).filter(id => TB.weather[id]);
    if (ids.length) cells[k] = ids;
  }
  const total = m.cols * m.rows;
  const everywhere = Object.keys(TB.weather).filter(id => Object.values(cells).filter(l => l.includes(id)).length === total);
  for (const k of Object.keys(cells)) {
    cells[k] = cells[k].filter(id => !everywhere.includes(id));
    if (!cells[k].length) delete cells[k];
  }
  return { cells, everywhere };
}

/** Видимая погода Foundry для погоды над всей сценой: самая сильная из включённых. */
const CORE_WEATHER = [["lightning", "rainStorm"], ["hurrA", "rainStorm"], ["hurrW", "rainStorm"], ["rain", "rain"], ["clouds", "fog"]];
export function coreWeatherFor(ids) {
  return CORE_WEATHER.find(([id]) => ids.includes(id))?.[1] ?? "";
}

/**
 * Нарисовать карту миссии на сцене: местность и погода — схематичные рисунки клеток, подписи — читаемые таблички.
 * Погода из Планшета сразу действует на броски: по клеткам, а та, что лежит на всей карте, — над всей сценой.
 * Прежняя карта этой системы на сцене стирается, токены не трогаются.
 */
export async function drawMap(scene, m) {
  const cat = await catalog();
  const terrain = new Map(cat.terrain.map(t => [t.id, t]));
  const effects = new Map(cat.effects.map(e => [e.id, e]));
  const base = terrain.get(m.base) ?? terrain.get("steppe");
  const mine = coll => coll.filter(d => d.getFlag(SYSTEM_ID, "map")).map(d => d.id);
  // сцены, импортированные до 0.4.27: заливки клеток и мелкие подписи старого импорта тоже убираются
  const oldImport = d => d.locked && !d.strokeWidth && (d.text
    ? d.fillType === CONST.DRAWING_FILL_TYPES.NONE && ["#1e2822", "#3a3f38", "#a8281f"].includes(String(d.textColor).toLowerCase())
    : d.fillType === CONST.DRAWING_FILL_TYPES.SOLID && d.shape?.width === S && d.shape?.height === S && d.x % S === 0 && d.y % S === 0);
  const oldT = mine(scene.tiles), oldD = [...new Set([...mine(scene.drawings), ...scene.drawings.filter(oldImport).map(d => d.id)])];
  if (oldT.length) await scene.deleteEmbeddedDocuments("Tile", oldT);
  if (oldD.length) await scene.deleteEmbeddedDocuments("Drawing", oldD);

  const { cells, everywhere } = splitWeather(m);
  const tiles = [], drawings = [];
  const terrainCells = {};   // местность клеток: корабли не выходят на сушу (scene.mjs landBlocked)
  const B = 34;   // значок погоды
  for (let r = 0; r < m.rows; r++) for (let c = 0; c < m.cols; c++) {
    const h = m.hexes?.[`${c},${r}`] ?? {};
    const ter = (h.t && terrain.get(h.t)) || base;
    const x = c * S, y = r * S;
    if (ter) { tiles.push(tile(`${MAP}terrain/${ter.id}.svg`, x, y, S, S, 0)); terrainCells[`${c},${r}`] = ter.id; }
    // погода над всей картой рисуется погодой Foundry и табличкой сцены, в клетке только своя
    const fx = (h.fx ?? []).filter(id => effects.has(id) && !everywhere.includes(id));
    fx.forEach((id, i) => {
      tiles.push(tile(`${MAP}weather/${id}.svg`, x, y, S, S, 10 + i, 0.9));
      tiles.push(tile(`${MAP}weather/${id}-badge.svg`, x + S - 4 - (i + 1) * (B + 3), y + 4, B, B, 50));
    });
    drawings.push(plate(x + 4, y + 4, 40, 24, cellName(c, r), { size: 15 }));
    const lines = [];
    if (h.label) lines.push(h.label);
    if (ter && (ter.id !== base?.id || h.label)) lines.push(ter.name + (ter.note ? ` · ${ter.note}` : ""));
    for (const id of fx) lines.push(`${effects.get(id).ico} ${effects.get(id).name}`);
    if (lines.length) {
      const hh = lines.length * 19 + 8;
      drawings.push(plate(x + 6, y + S - hh - 6, S - 12, hh, lines.join("\n"), { size: 15 }));
    }
  }
  if (tiles.length) await scene.createEmbeddedDocuments("Tile", tiles);
  if (drawings.length) await scene.createEmbeddedDocuments("Drawing", drawings);
  await scene.update({ backgroundColor: base?.color ?? "#999999", weather: coreWeatherFor(everywhere),
    [`flags.${SYSTEM_ID}.weatherCells`]: cells, [`flags.${SYSTEM_ID}.terrainCells`]: terrainCells, [`flags.${SYSTEM_ID}.weather`]: everywhere });
  for (const a of game.actors) if (a.sheet?.rendered) a.sheet.render(false);
  return { cells: Object.keys(cells).length, everywhere };
}

/** Легенда карты: местность и погода, которые есть на этой карте, с рисунками и действием погоды. */
export async function legendHtml(m) {
  const cat = await catalog();
  const used = new Set([m.base ?? "steppe"]), fx = new Set();
  for (const h of Object.values(m.hexes ?? {})) { if (h.t) used.add(h.t); for (const id of h.fx ?? []) fx.add(id); }
  const img = (src, w = 64) => `<img src="${src}" width="${w}" height="${w}" style="border:none;vertical-align:middle">`;
  const ter = cat.terrain.filter(t => used.has(t.id)).map(t => `<tr><td>${img(`${MAP}terrain/${t.id}.svg`)}</td><td><b>${esc(t.name)}</b>${t.note ? `<br>${esc(t.note)}` : ""}</td></tr>`).join("");
  const wx = cat.effects.filter(e => fx.has(e.id)).map(e => `<tr><td>${img(`${MAP}weather/${e.id}-badge.svg`, 40)}</td><td><b>${e.ico} ${esc(e.name)}</b><br>${esc(TB.weather[e.id]?.txt ?? e.txt)}</td></tr>`).join("");
  const all = splitWeather(m).everywhere.map(id => `${TB.weather[id].ico} ${TB.weather[id].name}`);
  return `<h2>Местность</h2><table>${ter}</table>${wx ? `<h2>Погода и эффекты</h2>${all.length ? `<p><b>Над всей картой:</b> ${all.join(", ")}. Это погода всей сцены (панель AWACS), на карте она идёт погодой Foundry.</p>` : ""}<p>Значок погоды клетки стоит в её правом верхнем углу. Погода сама учитывается в бросках и защите тех, кто в этой клетке.</p><table>${wx}</table>` : ""}`;
}

/** Окно «Карта и погода из Планшета»: перерисовать текущую сцену по JSON миссии, не трогая токены. */
export function openMapUpdateDialog() {
  const scene = game.scenes.viewed;
  if (!scene) return ui.notifications.warn("Нет открытой сцены.");
  new Dialog({
    title: "Карта и погода из Планшета AWACS",
    content: `<form class="tb-dialog"><p class="tb-hint">Вставьте JSON миссии из Планшета AWACS (кнопка «JSON»). На сцене «${esc(scene.name)}» перерисуются местность, подписи и погода (подписи прежнего импорта уберутся), а погода сразу начнёт действовать на броски: по клеткам, а погода на всей карте — над всей сценой. Токены не трогаются.</p>
      <textarea name="json" rows="12" style="width:100%;font-family:monospace"></textarea></form>`,
    buttons: {
      ok: {
        icon: '<i class="fas fa-cloud-bolt"></i>', label: "Применить",
        callback: async html => {
          try {
            const m = JSON.parse(html[0].querySelector("textarea").value.trim());
            if (!m?.cols || !m?.rows) throw new Error("в JSON нет размеров карты (cols, rows)");
            const res = await drawMap(scene, m);
            ui.notifications.info(`Карта обновлена. Погода: ${res.everywhere.length ? `над всей сценой ${res.everywhere.map(id => TB.weather[id].name).join(", ")}, ` : ""}в ${res.cells} клетках.`);
          } catch (e) { console.error(e); ui.notifications.error(`Не получилось: ${e.message}`); }
        }
      },
      cancel: { label: "Отмена" }
    },
    default: "ok"
  }, { width: 560, classes: ["dialog", "thunderbolt"] }).render(true);
}

export function openImportDialog() {
  new Dialog({
    title: "Импорт миссии из Планшета AWACS",
    content: `<form class="tb-dialog"><p class="tb-hint">В Планшете AWACS откройте миссию, нажмите «JSON», скопируйте текст и вставьте сюда. Будут созданы сцена, NPC в отдельной папке и журнал брифинга.</p>
      <textarea name="json" rows="14" style="width:100%;font-family:monospace" placeholder='{"name": "…", "cols": 8, "rows": 5, …}'></textarea></form>`,
    buttons: {
      ok: {
        icon: '<i class="fas fa-file-import"></i>', label: "Импортировать",
        callback: async html => {
          const text = html[0].querySelector("textarea").value.trim();
          try { await importMission(text); }
          catch (e) { console.error(e); ui.notifications.error(`Не получилось импортировать миссию: ${e.message}`); }
        }
      },
      cancel: { label: "Отмена" }
    },
    default: "ok"
  }, { width: 560, classes: ["dialog", "thunderbolt"] }).render(true);
}

export async function importMission(input) {
  if (!game.user.isGM) throw new Error("импорт доступен только ведущему");
  const m = typeof input === "string" ? JSON.parse(input) : input;
  if (!m?.cols || !m?.rows) throw new Error("в JSON нет размеров карты (cols, rows)");
  const cat = await catalog();
  const byKey = new Map(cat.npcs.concat(cat.planeNpcs).map(n => [n.key, n]));
  const terrain = new Map(cat.terrain.map(t => [t.id, t]));
  const markers = new Map(cat.markers.map(x => [x.id, x]));
  const title = m.name || "Миссия";

  const scene = await Scene.create({
    flags: { [SYSTEM_ID]: { mission: m.name ?? "", objectives: m.objectives ?? [] } },
    name: title, width: m.cols * S, height: m.rows * S, padding: 0, backgroundColor: (terrain.get(m.base) ?? terrain.get("steppe"))?.color ?? "#999999",
    grid: { type: CONST.GRID_TYPES.SQUARE, size: S, distance: 1, units: "", color: "#000000", alpha: 0.35 },
    tokenVision: false, fog: { exploration: false }, navigation: true
  });
  await drawMap(scene, m);

  // ---- метки AWACS ----
  const drawings = [];
  // ---- силы на карте ----
  const folder = await Folder.create({ name: `Миссия: ${title}`, type: "Actor" });
  const tokens = [];
  const roster = [];
  const pack = zonePacker(scene);
  const perCell = {};
  const place = (c, r) => {
    const k = `${c},${r}`; const i = perCell[k] = (perCell[k] ?? -1) + 1;
    const q = i % 4, ring = Math.floor(i / 4);
    return { x: c * S + (q % 2) * (S / 2) + ring * 10, y: r * S + Math.floor(q / 2) * (S / 2) + ring * 10 };
  };
  for (const u of m.units ?? []) {
    const ref = cat.alias[u.ref] ?? u.ref;
    const mk = markers.get(ref);
    const where = cellName(u.c, u.r);
    if (mk && ref !== "protect") {
      const p = place(u.c, u.r);
      drawings.push(plate(p.x + 4, p.y + 4, S / 2 - 8, 48, `${mk.s}\n${u.name || mk.n}`, { size: 15, fill: ref === "reinf" ? "#7a1d16" : "#1e2822" }));
      roster.push({ u, name: u.name || mk.n, where, what: mk.n });
      continue;
    }
    let entry = byKey.get(ref);
    if (ref === "protect" || ref === "obj" || (!entry && (u.occ || u.hp))) {
      entry = { key: ref, kind: "ground", grp: "obj", grpName: "Объекты", name: u.name || "Объект", nato: "", cls: "Объект",
        t: { occ: u.occ ?? 4, hp: u.hp ?? 5, ga: null, gg: null, gun: null, strafe: 0 }, rules: [], img: SYS_PATH + "assets/targets/building.svg" };
    }
    if (!entry) { roster.push({ u, name: u.name || ref, where, what: `неизвестная ссылка «${ref}»` }); continue; }
    const tier = u.tier || "conscript";
    const data = npcActor(entry, { tier, bonus: Number(u.bonus) || 0, name: u.name || entry.name });
    data.folder = folder.id;
    if (u.alt && ALT[u.alt]) data.system.alt = ALT[u.alt];
    if (u.skills && Object.keys(u.skills).length) data.system.skills = Object.fromEntries(Object.keys(TB.skills).map(k => [k, Number(u.skills[k]) || 0]));
    if (u.notes) data.system.notes = `<p>${esc(u.notes)}</p>`;
    // дуэлянты одной строки миссии — одна эскадрилья с общей раскладкой
    if (tier === "duelist") {
      data.system.squad = data.name;
      if (u.skills || !squadLayout(data.name)) await setSquadLayout(data.name, data.system.skills ?? {});
    }
    data.prototypeToken.disposition = SIDE[u.side] ?? CONST.TOKEN_DISPOSITIONS.HOSTILE;
    data.system.side = ["ally", "player"].includes(u.side) ? "ally" : u.side === "neutral" ? "neutral" : "enemy";
    const actor = await Actor.create(data);
    const elevation = TB.altElevation[actor.system.alt] ?? 1;
    const count = Math.max(1, Number(u.count) || 1);
    const fp = footprintOf(actor.system);
    for (let i = 0; i < count; i++) {
      // каждая машина — на свободные места своей зоны, большая цель — на блок мест
      const spot = pack(fp, u.c, u.r);
      const td = await actor.getTokenDocument({ ...spot, texture: { ...actor.prototypeToken.texture.toObject(), ...spot.texture }, elevation,
        name: count > 1 ? `${actor.name} ${i + 1}` : actor.name });
      tokens.push(td.toObject());
    }
    roster.push({ u, name: actor.name, where, what: `${entry.name} · ${TB.tiers[tier] ?? tier}${count > 1 ? ` ×${count}` : ""}` });
  }
  if (drawings.length) await scene.createEmbeddedDocuments("Drawing", drawings);
  if (tokens.length) await scene.createEmbeddedDocuments("Token", tokens, { tbKeep: true });

  // ---- журнал ----
  const p = s => s ? `<p>${esc(s).replace(/\n/g, "<br>")}</p>` : "";
  const pages = [
    { name: "Брифинг", type: "text", text: { content: `${m.type ? `<p><b>${esc(m.type)}</b>${m.players ? ` · игроков: ${m.players}` : ""}</p>` : ""}${p(m.briefing)}` } },
    { name: "Задачи и поворот", type: "text", text: { content:
      `<h2>Задачи</h2><ol>${(m.objectives ?? []).map(o => `<li>${esc(o)}</li>`).join("")}</ol>` +
      `${m.twistType || m.twist ? `<h2>Поворот${m.twistType ? `: ${esc(m.twistType)}` : ""}</h2>${p(m.twist)}` : ""}` +
      `${m.fail ? `<h2>Если провалят</h2>${p(m.fail)}` : ""}${m.notes ? `<h2>Заметки</h2>${p(m.notes)}` : ""}` } },
    { name: "Силы на карте", type: "text", text: { content: `<table><tr><th>Клетка</th><th>Кто</th><th>Что</th><th>Заметки</th></tr>${roster.map(x =>
      `<tr><td>${x.where}${x.u.alt ? ` · ${x.u.alt}` : ""}</td><td>${esc(x.name)}</td><td>${esc(x.what)}</td><td>${esc(x.u.notes ?? "")}</td></tr>`).join("")}</table>` } }
  ];
  pages.push({ name: "Условные обозначения", type: "text", text: { content: await legendHtml(m) } });
  const journal = await JournalEntry.create({ name: `Миссия: ${title}`, pages });
  await scene.update({ journal: journal.id });
  ui.notifications.info(`Миссия «${title}» импортирована: сцена, ${tokens.length} токенов, журнал брифинга.`);
  return { scene, journal, folder };
}
