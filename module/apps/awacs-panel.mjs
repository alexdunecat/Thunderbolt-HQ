/* Панель AWACS для ведущего: пилоты, цели на сцене, погода сцены, подготовка и итоги вылета. */
import { SYSTEM_ID, SYS_PATH, TB } from "../config.mjs";
import { esc } from "../utils.mjs";
import { formDialog } from "../dice/rolls.mjs";
import { tokenOf, weatherAt, defenseWithWeather, altOf } from "../scene.mjs";

let panel = null;
let timer = null;

export function openAwacs() {
  if (!game.user.isGM) return ui.notifications.warn("Панель AWACS доступна ведущему.");
  panel ??= new AwacsPanel();
  panel.render(true);
}

/** Перерисовать открытую панель (с небольшой задержкой, чтобы пачка обновлений дала одну перерисовку). */
export function refreshAwacs() {
  if (!panel?.rendered) return;
  clearTimeout(timer);
  timer = setTimeout(() => panel.render(false), 150);
}

const markerList = s => {
  const m = s.markers, out = [];
  if (m.grit) out.push({ cls: "grit", label: `Grit${m.gritSkill ? `: ${TB.skills[m.gritSkill]?.label ?? m.gritSkill}` : ""}` });
  if (m.structure) out.push({ cls: "structure", label: `Structure${m.sys ? `: ${TB.systems[m.sys]?.label ?? m.sys}` : ""}` });
  if (m.doom) out.push({ cls: "doom", label: "Doom" });
  return out;
};

export class AwacsPanel extends Application {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "tb-awacs-panel", title: "Панель AWACS", template: SYS_PATH + "templates/apps/awacs-panel.hbs",
      classes: ["thunderbolt", "tb-awacs"], width: 860, height: 640, resizable: true, scrollY: [".tb-awacs-body"]
    });
  }

  getData() {
    const scene = game.scenes.viewed;
    const pilots = game.actors.filter(a => a.type === "pilot").sort((a, b) => a.name.localeCompare(b.name, "ru")).map(a => {
      const s = a.system, tok = tokenOf(a), w = weatherAt(a, tok);
      const kills = a.getFlag(SYSTEM_ID, "kills") ?? {};
      return {
        id: a.id, name: a.name, img: a.img, plane: s.plane?.name ?? "без самолёта", onScene: !!tok,
        hp: s.hp, strain: s.strain, hpLow: s.hp.value <= 1, speed: s.speed, maxSpeed: s.maxSpeed + w.spd, stall: s.speed <= 0,
        alt: TB.altitudes[tok ? altOf(tok, a) : s.alt] ?? s.alt, defense: defenseWithWeather(a, w), breakEv: s.breakEv,
        lock: s.lock, markers: markerList(s), twist: s.twist, weather: w.list.map(d => d.ico).join(" "),
        kills: (kills.air || kills.ground) ? `${kills.air ?? 0} / ${kills.ground ?? 0}` : ""
      };
    });
    const dead = CONFIG.specialStatusEffects.DEFEATED;
    const targets = (scene?.tokens.contents ?? []).filter(t => t.actor?.type === "npc").map(t => {
      const a = t.actor, s = a.system, obj = t.object, w = weatherAt(a, obj);
      return {
        id: t.id, name: t.name, kind: TB.npcKinds[s.kind] ?? s.kind, tier: TB.tiers[s.tier] ?? "",
        hp: s.hp, defense: s.kind === "ship" ? "Occ" : defenseWithWeather(a, w), alt: TB.altitudes[obj ? altOf(obj, a) : s.alt] ?? "",
        markers: markerList(s), down: a.statuses?.has(dead) || s.markers.doom, hidden: t.hidden
      };
    });
    const sceneWeather = new Set(scene?.getFlag(SYSTEM_ID, "weather") ?? []);
    const cells = Object.keys(scene?.getFlag(SYSTEM_ID, "weatherCells") ?? {}).length;
    const combat = game.combat;
    let queued = 0;
    if (combat?.started) {
      const key = `${combat.id}:${combat.round}`;
      queued = game.messages.contents.filter(m => { const c = m.getFlag(SYSTEM_ID, "card"); return c?.delayed && c.combatKey === key && !c.resolved && !c.dmgApplied; }).length;
    }
    return {
      sceneName: scene?.name ?? "сцена не выбрана", pilots, targets, cells,
      weather: Object.entries(TB.weather).map(([id, d]) => ({ id, ...d, on: sceneWeather.has(id) })),
      round: combat?.started ? combat.round : null, queued
    };
  }

  activateListeners(html) {
    super.activateListeners(html);
    const el = html[0];
    const on = (sel, fn) => el.querySelectorAll(sel).forEach(n => n.addEventListener("click", ev => { ev.preventDefault(); fn(n.dataset, n); }));
    on("[data-open]", d => game.actors.get(d.open)?.sheet.render(true));
    on("[data-pool]", async d => {
      const a = game.actors.get(d.id);
      if (!a) return;
      const pool = a.system[d.pool];
      await a.update({ [`system.${d.pool}.value`]: Math.max(0, Math.min(pool.max, pool.value + Number(d.delta))) });
    });
    on("[data-target]", d => {
      const t = canvas.tokens?.get(d.target);
      if (!t) return;
      t.control({ releaseOthers: true });
      canvas.animatePan({ x: t.center.x, y: t.center.y, duration: 300 });
      if (d.sheet) t.actor?.sheet.render(true);
    });
    el.querySelectorAll("[data-weather]").forEach(n => n.addEventListener("change", async () => {
      const scene = game.scenes.viewed;
      if (!scene) return;
      const ids = [...el.querySelectorAll("[data-weather]:checked")].map(x => x.dataset.weather);
      await scene.setFlag(SYSTEM_ID, "weather", ids);
      for (const a of game.actors) if (a.sheet?.rendered) a.sheet.render(false);
    }));
    on("[data-sortie-all]", async () => {
      const pilots = game.actors.filter(a => a.type === "pilot");
      if (!(await Dialog.confirm({ title: "Все к вылету", content: `<p>Подготовить к вылету всех пилотов (${pilots.length}): HP и Strain до максимума, Speed 1, метки сняты, спецоружие пополнено?</p>` }))) return;
      for (const a of pilots) await a.prepareSortie();
    });
    on("[data-results]", () => sortieResults());
  }
}

/** Итоги вылета: +1 очко навыков, вылеты, сбитые и катапультирования в личное дело. */
export async function sortieResults() {
  if (!game.user.isGM) return;
  const pilots = game.actors.filter(a => a.type === "pilot").sort((a, b) => a.name.localeCompare(b.name, "ru"));
  if (!pilots.length) return ui.notifications.info("Пилотов пока нет.");
  const rows = pilots.map(a => {
    const k = a.getFlag(SYSTEM_ID, "kills") ?? {};
    const mentor = a.items.some(i => i.type === "trigger" && i.system.key === "mentor");
    return `<tr>
      <td><label><input type="checkbox" name="fly_${a.id}" ${a.hasPlayerOwner ? "checked" : ""}> ${esc(a.name)}</label></td>
      <td><input type="number" name="air_${a.id}" value="${k.air ?? 0}" min="0"></td>
      <td><input type="number" name="gnd_${a.id}" value="${k.ground ?? 0}" min="0"></td>
      <td><input type="checkbox" name="eject_${a.id}"></td>
      <td><input type="number" name="pts_${a.id}" value="1" min="0"></td>
      <td>${mentor ? `<label title="Урок наставника выполнен: +1 очко"><input type="checkbox" name="lesson_${a.id}"> урок</label>` : ""}</td>
    </tr>`;
  }).join("");
  const data = await formDialog("Итоги вылета", `
    <p class="tb-hint">Сбитые подсчитаны по урону, нанесённому с карточек атак; поправьте, если нужно. Очки навыков добавляются к «Доп. очкам».</p>
    <table class="tb-results"><tr><th>Летал</th><th>Сбито в воздухе</th><th>Уничтожено на земле</th><th>Катапульта</th><th>Очки</th><th></th></tr>${rows}</table>
    <div class="form-group"><label>Операция</label><input type="text" name="op" placeholder="название вылета для чата"></div>`, { ok: "Записать в личные дела", width: 620 });
  if (!data) return;
  const lines = [];
  for (const a of pilots) {
    if (!data[`fly_${a.id}`]) { await a.unsetFlag(SYSTEM_ID, "kills"); continue; }
    const sv = a.system.service;
    const air = Math.max(0, data[`air_${a.id}`] ?? 0), gnd = Math.max(0, data[`gnd_${a.id}`] ?? 0);
    const pts = Math.max(0, data[`pts_${a.id}`] ?? 0) + (data[`lesson_${a.id}`] ? 1 : 0);
    const eject = !!data[`eject_${a.id}`];
    await a.update({
      "system.service.sorties": sv.sorties + 1, "system.service.air": sv.air + air, "system.service.ground": sv.ground + gnd,
      "system.service.eject": sv.eject + (eject ? 1 : 0), "system.bonusPoints": a.system.bonusPoints + pts,
      [`flags.${SYSTEM_ID}.-=kills`]: null
    });
    lines.push(`<b>${esc(a.name)}</b>: вылет ${sv.sorties + 1}${air ? `, сбито ${air}` : ""}${gnd ? `, на земле ${gnd}` : ""}${eject ? ", катапультировался" : ""}${pts ? `, +${pts} ${pts === 1 ? "очко" : "очка"} навыков` : ""}`);
  }
  if (!lines.length) return;
  return ChatMessage.create({
    speaker: { alias: "AWACS" },
    content: `<div class="tb-card tb-card-results"><header class="tb-card-head"><span class="tb-card-who">AWACS</span><span class="tb-card-what">Итоги вылета${data.op ? `: ${esc(data.op)}` : ""}</span></header><div class="tb-note">${lines.join("<br>")}</div></div>`
  });
}
