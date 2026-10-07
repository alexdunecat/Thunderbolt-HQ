/* Импорт миссии из Планшета AWACS (кнопка «JSON» в планшете): сцена с клетками местности, токены NPC и журнал брифинга. */
import { SYSTEM_ID, SYS_PATH, TB, footprintOf } from "../config.mjs";
import { npcActor } from "../data/catalog-docs.mjs";
import { esc } from "../utils.mjs";

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
  const effects = new Map(cat.effects.map(e => [e.id, e]));
  const markers = new Map(cat.markers.map(x => [x.id, x]));
  const title = m.name || "Миссия";
  const S = 200;

  const base = terrain.get(m.base) ?? terrain.get("steppe");
  // погода по клеткам: бросок пилота в такой клетке учитывает её сам
  const weatherCells = {};
  for (const [k, h] of Object.entries(m.hexes ?? {})) {
    const ids = (h.fx ?? []).filter(id => TB.weather[id]);
    if (ids.length) weatherCells[k] = ids;
  }
  const scene = await Scene.create({
    flags: { [SYSTEM_ID]: { weatherCells, weather: [] } },
    name: title, width: m.cols * S, height: m.rows * S, padding: 0, backgroundColor: base?.color ?? "#999999",
    grid: { type: CONST.GRID_TYPES.SQUARE, size: S, distance: 1, units: "", color: "#000000", alpha: 0.35 },
    tokenVision: false, fog: { exploration: false }, navigation: true
  });

  // ---- местность, подписи клеток, погода, метки AWACS ----
  const drawings = [];
  const text = (x, y, w, h, t, { size = 22, color = "#1E2822", align } = {}) => ({
    x, y, shape: { type: "r", width: w, height: h }, text: t, fontSize: size, textColor: color, textAlpha: 0.9,
    fillType: CONST.DRAWING_FILL_TYPES.NONE, strokeWidth: 0, locked: true
  });
  for (let r = 0; r < m.rows; r++) for (let c = 0; c < m.cols; c++) {
    const h = m.hexes?.[`${c},${r}`] ?? {};
    const ter = h.t ? terrain.get(h.t) : null;
    if (ter && ter.id !== base?.id) drawings.push({
      x: c * S, y: r * S, shape: { type: "r", width: S, height: S },
      fillType: CONST.DRAWING_FILL_TYPES.SOLID, fillColor: ter.color, fillAlpha: 1, strokeWidth: 0, locked: true
    });
    drawings.push(text(c * S + 4, r * S + 2, 60, 30, cellName(c, r), { size: 18, color: "#3a3f38" }));
    const lines = [];
    if (ter && ter.id !== base?.id) lines.push(ter.name + (ter.note ? ` (${ter.note})` : ""));
    if (h.label) lines.push(h.label);
    for (const fx of h.fx ?? []) { const e = effects.get(fx); if (e) lines.push(`${e.ico} ${e.name}`); }
    if (lines.length) drawings.push(text(c * S + 8, r * S + S - 70, S - 16, 64, lines.join("\n"), { size: 18 }));
  }

  // ---- силы на карте ----
  const folder = await Folder.create({ name: `Миссия: ${title}`, type: "Actor" });
  const tokens = [];
  const roster = [];
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
      drawings.push(text(p.x, p.y, S / 2, S / 2, `${mk.s}\n${u.name || mk.n}`, { size: 16, color: ref === "reinf" ? "#a8281f" : "#1E2822" }));
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
    data.prototypeToken.disposition = SIDE[u.side] ?? CONST.TOKEN_DISPOSITIONS.HOSTILE;
    const actor = await Actor.create(data);
    const elevation = TB.altElevation[actor.system.alt] ?? 1;
    const count = Math.max(1, Number(u.count) || 1);
    const fp = footprintOf(actor.system);
    for (let i = 0; i < count; i++) {
      // большая цель ложится по клеткам вокруг своей, остальные — по местам в клетке
      const p = fp ? { x: (u.c - Math.floor((fp[0] - 1) / 2)) * S, y: (u.r - Math.floor((fp[1] - 1) / 2)) * S } : place(u.c, u.r);
      const size = fp ? { width: fp[0], height: fp[1] } : { width: 0.5, height: 0.5 };
      const td = await actor.getTokenDocument({ x: p.x, y: p.y, ...size, elevation,
        name: count > 1 ? `${actor.name} ${i + 1}` : actor.name });
      tokens.push(td.toObject());
    }
    roster.push({ u, name: actor.name, where, what: `${entry.name} · ${TB.tiers[tier] ?? tier}${count > 1 ? ` ×${count}` : ""}` });
  }
  await scene.createEmbeddedDocuments("Drawing", drawings);
  if (tokens.length) await scene.createEmbeddedDocuments("Token", tokens);

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
  const journal = await JournalEntry.create({ name: `Миссия: ${title}`, pages });
  await scene.update({ journal: journal.id });
  ui.notifications.info(`Миссия «${title}» импортирована: сцена, ${tokens.length} токенов, журнал брифинга.`);
  return { scene, journal, folder };
}
