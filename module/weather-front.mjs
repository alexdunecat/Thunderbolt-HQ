/* Движущийся погодный фронт: погода, нарисованная кистью по клеткам, раз в N раундов сдвигается на клетку в выбранную сторону.
   Ушедшее за край карты пропадает. Настройка — кнопка «Движение фронта» в окне кисти погоды (флаг сцены weatherDrift:
   { [погода]: { dir, every } }). Сдвиг — в начале раунда, AWACS предупреждает. Делает главный ведущий. */
import { SYSTEM_ID, TB } from "./config.mjs";
import { esc } from "./utils.mjs";

/** Стороны света: смещение клетки [столбец, строка] и как сказать по радио. */
export const DIRS = {
  n: { d: [0, -1], name: "Север", to: "на север" }, ne: { d: [1, -1], name: "Северо-восток", to: "на северо-восток" },
  e: { d: [1, 0], name: "Восток", to: "на восток" }, se: { d: [1, 1], name: "Юго-восток", to: "на юго-восток" },
  s: { d: [0, 1], name: "Юг", to: "на юг" }, sw: { d: [-1, 1], name: "Юго-запад", to: "на юго-запад" },
  w: { d: [-1, 0], name: "Запад", to: "на запад" }, nw: { d: [-1, -1], name: "Северо-запад", to: "на северо-запад" }
};
const lead = () => !!game.user?.isGM && (game.users?.activeGM?.isSelf ?? true);

/** Сдвинуть погоду id во всех клетках на [dc, dr]; за краем карты (cols × rows) пропадает. Возвращает { cells, touched }. */
export function shiftWeather(cells, id, [dc, dr], cols, rows) {
  const out = {}, touched = new Set();
  const moved = [];
  for (const [k, list] of Object.entries(cells ?? {})) {
    const rest = list.filter(x => x !== id);
    if (rest.length !== list.length) { moved.push(k); touched.add(k); }
    if (rest.length) out[k] = rest;
  }
  for (const k of moved) {
    const [c, r] = k.split(",").map(Number), nc = c + dc, nr = r + dr;
    if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
    const nk = `${nc},${nr}`;
    out[nk] = [...new Set([...(out[nk] ?? []), id])];
    touched.add(nk);
  }
  return { cells: out, touched: [...touched] };
}

/** Каким погодам пора сдвигаться в раунде round: every — раз в столько раундов, считая от раунда 1 (сдвиг в раундах 1 + every, 1 + 2·every…). */
export function driftDue(drift, round) {
  return Object.entries(drift ?? {}).filter(([, d]) => DIRS[d?.dir] && Number(d.every) > 0 && round > 1 && (round - 1) % Number(d.every) === 0).map(([id]) => id);
}

/** Сдвинуть фронты сцены боя, которым пора. */
export async function driftFronts(combat) {
  if (!lead() || !combat?.started) return [];
  const scene = combat.scene ?? canvas?.scene;
  const drift = scene?.getFlag(SYSTEM_ID, "weatherDrift") ?? {};
  const due = driftDue(drift, combat.round).filter(id => TB.weather[id]);
  // один раз за раунд: смена раунда туда-обратно не двигает дважды
  const key = `${combat.id}:${combat.round}`;
  if (!due.length || scene.getFlag(SYSTEM_ID, "weatherDriftAt") === key) return [];
  const M = await import("./apps/mission-import.mjs");
  const { cols, rows } = M.sceneCells(scene);
  let cells = foundry.utils.deepClone(scene.getFlag(SYSTEM_ID, "weatherCells") ?? {});
  const touched = new Set(), said = [];
  for (const id of due) {
    const before = Object.values(cells).some(l => l.includes(id));
    if (!before) continue;
    const r = shiftWeather(cells, id, DIRS[drift[id].dir].d, cols, rows);
    cells = r.cells;
    r.touched.forEach(k => touched.add(k));
    const after = Object.values(cells).some(l => l.includes(id));
    said.push(`${TB.weather[id].name} ${after ? `смещается ${DIRS[drift[id].dir].to}` : "уходит за край района"}`);
  }
  await scene.update({ [`flags.${SYSTEM_ID}.-=weatherCells`]: null, [`flags.${SYSTEM_ID}.weatherDriftAt`]: key });
  await scene.update({ [`flags.${SYSTEM_ID}.weatherCells`]: cells });
  for (const k of touched) { const [c, r] = k.split(",").map(Number); await M.redrawWeatherCell(scene, c, r); }
  for (const a of game.actors) if (a.sheet?.rendered) a.sheet.render(false);
  if (said.length) {
    const { sendRadio } = await import("./radio.mjs");
    await sendRadio({ text: `Всем бортам: ${said.join("; ")}. Проверьте свои зоны.`, caution: { title: "WEATHER", sub: "Фронт движется" } });
  }
  return due;
}

/** Окно ведущего: куда и как часто движется каждая погода, нарисованная по клеткам. */
export async function frontDialog(scene = canvas?.scene) {
  if (!game.user.isGM || !scene) return;
  const cells = scene.getFlag(SYSTEM_ID, "weatherCells") ?? {};
  const drift = scene.getFlag(SYSTEM_ID, "weatherDrift") ?? {};
  const ids = Object.keys(TB.weather).filter(id => Object.values(cells).some(l => l.includes(id)) || drift[id]);
  if (!ids.length) return ui.notifications.warn("Движение фронта: сначала нарисуйте погоду по клеткам кистью.");
  const dirOpts = cur => `<option value="">стоит на месте</option>${Object.entries(DIRS).map(([k, d]) => `<option value="${k}" ${cur === k ? "selected" : ""}>${d.name}</option>`).join("")}`;
  const rowsHtml = ids.map(id => { const d = TB.weather[id], cur = drift[id] ?? {};
    return `<div class="form-group"><label>${d.ico} ${esc(d.name)}</label><select name="dir_${id}">${dirOpts(cur.dir)}</select>
      <span>раз в</span><input type="number" name="every_${id}" min="1" max="9" value="${Number(cur.every) || 2}" style="max-width:3.5em"><span>раунда</span></div>`; }).join("");
  const { formDialog } = await import("./dice/rolls.mjs");
  const data = await formDialog("Движение фронта", `<p class="tb-hint">Погода по клеткам сдвигается на клетку в начале раунда: раз в 2 раунда — в раундах 3, 5, 7… Ушедшее за край карты пропадает. AWACS предупреждает.</p>${rowsHtml}`, { ok: "Сохранить", width: 460 });
  if (!data) return;
  const next = {};
  for (const id of ids) if (DIRS[data[`dir_${id}`]]) next[id] = { dir: data[`dir_${id}`], every: Math.max(1, Math.min(9, Number(data[`every_${id}`]) || 2)) };
  await scene.update({ [`flags.${SYSTEM_ID}.-=weatherDrift`]: null });
  if (Object.keys(next).length) await scene.update({ [`flags.${SYSTEM_ID}.weatherDrift`]: next });
  ui.notifications.info(Object.keys(next).length ? `Движение фронта: ${Object.entries(next).map(([id, d]) => `${TB.weather[id].name} — ${DIRS[d.dir].to}, раз в ${d.every}`).join("; ")}.` : "Движение фронта: погода стоит на месте.");
}

export function registerWeatherFront() {
  Hooks.on("updateCombat", (combat, change) => {
    if ("round" in change && combat.started) driftFronts(combat).catch(err => console.error(`${SYSTEM_ID} | фронт`, err));
  });
}
