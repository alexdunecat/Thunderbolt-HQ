/* Шкалы и отметки крупных целей: «Падение» SOLG, «Сброс» Аркбёрда, «Над целью» Рузвельта, перегрев Тарпана, отсчёт до пуска.
   Значения живут во флаге актёра unit.scales; в конце раунда ведущий двигает их сам (combat.mjs → advanceScales). */
import { SYSTEM_ID } from "./config.mjs";
import { esc } from "./utils.mjs";
import { hasRule } from "./scene.mjs";

/** Сколько систем с таким именем всего и сколько целы. */
export function sysCount(actor, re) {
  const list = (actor?.system?.systems ?? []).filter(y => re.test(y.name));
  return { total: list.length, alive: list.filter(y => y.value > 0).length };
}

/**
 * Шкалы по правилам цели. step — сдвиг в конце раунда; when — растёт только при условии; start — значение по умолчанию;
 * full — что случилось, когда шкала дошла до конца (у обратного отсчёта — до нуля).
 */
export const SCALES = {
  solgfall: { label: "Падение", rule: "solgfall", max: 6, step: 1, full: "SOLG падает на город" },
  nukecargo: { label: "Сброс", rule: "nukecargo", max: 6, step: 1, full: "боеголовка V1 сброшена, операция провалена" },
  pwscorch: { label: "Над целью", rule: "pwscorch", max: 6, step: 1, when: a => sysCount(a, /нижние орудия/i).alive > 0,
    full: "объект под кораблём уничтожен, задача вылета провалена" },
  overheat: { label: "Перегрев", rule: "overheat", max: 2, step: 1, when: a => { const v = sysCount(a, /решётк/i); return v.total > 0 && v.alive === 0; },
    full: "экипаж гибнет, главный калибр взрывается" },
  countdown: { label: "До пуска", rule: "countdown", max: 6, step: -1, start: 3, full: "пуск баллистической ракеты" }
};

export const unitFlag = (actor, key, dflt = null) => actor?.getFlag?.(SYSTEM_ID, "unit")?.[key] ?? dflt;
export const scaleValue = (actor, key) => unitFlag(actor, "scales", {})?.[key] ?? SCALES[key].start ?? 0;
export const scaleFull = (key, v) => SCALES[key].step < 0 ? v <= 0 : v >= SCALES[key].max;
export const scalesOf = actor => Object.keys(SCALES).filter(k => hasRule(actor, SCALES[k].rule));

/** Поставить шкалу (в пределах 0…max). */
export function setScale(actor, key, v) {
  const S = SCALES[key];
  return actor.update({ [`flags.${SYSTEM_ID}.unit.scales.${key}`]: Math.max(0, Math.min(S.max, v)) });
}

/** Конец раунда: шкалы всех целей боя на шаг; в чат — что сдвинулось и что заполнилось. */
export async function advanceScales(combat, round) {
  if (!game.user.isGM) return;
  const lines = [], seen = new Set();
  for (const c of combat.combatants) {
    const a = c.actor;
    if (!a || seen.has(a.uuid)) continue;
    seen.add(a.uuid);
    for (const key of scalesOf(a)) {
      const S = SCALES[key];
      if (S.when && !S.when(a)) continue;
      const was = scaleValue(a, key);
      if (scaleFull(key, was)) continue;
      const v = Math.max(0, Math.min(S.max, was + S.step));
      await setScale(a, key, v);
      // «Перегрев» дошёл до конца: экипаж гибнет, главный калибр взрывается — линкор уничтожен
      if (key === "overheat" && scaleFull(key, v)) import("./boss-fate.mjs").then(m => m.bossDown(a, "реактор перегрелся: экипаж погиб, главный калибр взорвался")).catch(err => console.warn(`${SYSTEM_ID} | перегрев`, err));
      lines.push(scaleFull(key, v) ? `<b>${esc(c.name)}: шкала «${S.label}» дошла до конца — ${S.full}.</b>`
        : `${esc(c.name)}: «${S.label}» ${v}${S.step > 0 ? ` из ${S.max}` : ""}.`);
    }
  }
  if (lines.length) await ChatMessage.create({ speaker: { alias: "AWACS" },
    content: `<div class="tb-card tb-card-round"><header class="tb-card-head"><span class="tb-card-what">Конец раунда ${round}: шкалы</span></header><div class="tb-note">${lines.join("<br>")}</div></div>` });
}
