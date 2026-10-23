/* Панель AWACS для ведущего: пилоты, цели на сцене, погода сцены, подготовка и итоги вылета. */
import { SYSTEM_ID, SYS_PATH, TB, inCampaign } from "../config.mjs";
import { esc } from "../utils.mjs";
import { formDialog } from "../dice/rolls.mjs";
import { tokenOf, weatherAt, defenseWithWeather, altOf, sideOf } from "../scene.mjs";
import { openMapUpdateDialog, coreWeatherFor } from "./mission-import.mjs";
import { targetGoals } from "../losses.mjs";
import { gloryView, gloryDialog, gloryFields, gloryPrefill, applyGlory, setGlory } from "../glory.mjs";
import { openRadioDialog } from "../radio.mjs";
import { openChatterEditor, openSquadChatter } from "../chatter.mjs";
import { openMissionDialog } from "../mission.mjs";
import { openAceIntro } from "../aces.mjs";
import { openBriefing } from "../briefing.mjs";
import { openDossierExchange } from "../dossier-sync.mjs";
import { specialSections, setSectionState } from "../tunnel.mjs";
import { campaignDate, campaignDateRaw, setCampaignDate, todayDate } from "../campaign-date.mjs";
import { lessonDone, lessonReset } from "../career-triggers.mjs";
import { threats, addThreat, stepThreat, deleteThreat, bossClockDialog, bossMarkAt, baseEvent, clockPips, nervesHint, afterSortieUpdate, edgeLabel } from "../downtime.mjs";
import { DT } from "../config.mjs";
import { squadBudget, pointsText, operationsDone, setOperationsDone, allSquads, squadPoints, setSquadLayout, deleteSquad, squadFromSelection, numberSquad } from "../squadrons.mjs";
import { openMedals } from "../medals.mjs";
import { openHangarAdmin } from "../hangar.mjs";
import { undo, redo, openUndoLog } from "../undo.mjs";
import { markStrike, cancelStrike, strikesOfCombat, strikeWhere } from "../strikes.mjs";
import { lineOf, lineHint, escapedOf, bringBack, forgetEscaped, setLineSettings, tallyOf, tallyLine } from "../return-line.mjs";
import { RET_ENEMY, RET_ESCORT, RET_PILOTS, rearmText } from "../return-rules.mjs";
import { openBrush, clearReturnLine } from "../cell-brush.mjs";
import { setInactive } from "../inactive.mjs";

let panel = null;
let timer = null;
const TABS = ["fight", "enemy", "air", "mission", "campaign"];
const TAB_KEY = `${SYSTEM_ID}.awacsTab`;

export function openAwacs() {
  if (!game.user.isGM) return ui.notifications.warn("Панель AWACS доступна ведущему.");
  panel ??= new AwacsPanel();
  panel.render(true);
}

/** Перерисовать открытую панель (с небольшой задержкой, чтобы пачка обновлений дала одну перерисовку). */
/** Начался бой: открытая панель сама переходит на вкладку «Бой». */
Hooks.on("combatStart", () => { if (panel?.rendered) panel.activateTab("fight", { group: "awacs" }); });

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
      classes: ["thunderbolt", "tb-awacs"], width: 860, height: 640, resizable: true, scrollY: [".tb-awacs-body"],
      tabs: [{ navSelector: ".tb-awacs-tabs", contentSelector: ".tb-awacs-body", initial: "fight", group: "awacs" }]
    });
  }

  constructor(options) {
    super(options);
    // панель помнит последнюю вкладку в этом браузере
    let last = null;
    try { last = localStorage.getItem(TAB_KEY); } catch (err) { /* хранилище недоступно */ }
    if (last && TABS.includes(last)) this._tabs[0].active = last;
    /** Свёрнутые таблицы сторон (goal, enemy, ally, neutral). */
    this.folded = new Set();
  }

  _onChangeTab(event, tabs, active) {
    super._onChangeTab?.(event, tabs, active);
    try { localStorage.setItem(TAB_KEY, active); } catch (err) { /* хранилище недоступно */ }
  }

  getData() {
    const scene = game.scenes.viewed;
    const pilots = game.actors.filter(a => inCampaign(a) || (a.type === "pilot" && tokenOf(a))).sort((a, b) => a.name.localeCompare(b.name, "ru")).map(a => {
      const s = a.system, tok = tokenOf(a), w = weatherAt(a, tok);
      const kills = a.getFlag(SYSTEM_ID, "kills") ?? {};
      return {
        id: a.id, name: a.name, img: a.img, plane: s.plane?.name ?? "без самолёта", onScene: !!tok, inactive: a.statuses?.has("inactive"),
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
        markers: markerList(s), down: a.statuses?.has(dead) || s.markers.doom, hidden: t.hidden, line: lineHint(a, t),
        side: sideOf(a), priority: !!s.priority, task: s.task ?? ""
      };
    });
    // приоритетные цели отдельно (с задачей), остальные NPC по сторонам
    const SIDE_TITLE = { enemy: "Противники", ally: "Союзники", neutral: "Нейтральные" };
    const groups = [{ title: "Цели", cls: "goal", goal: true, rows: targets.filter(t => t.priority) },
      ...Object.entries(SIDE_TITLE).map(([k, title]) => ({ title, cls: k, rows: targets.filter(t => !t.priority && t.side === k) }))]
      .filter(g => g.rows.length);
    for (const g of groups) g.folded = this.folded.has(g.cls);
    for (const t of targets) t.taskOptions = Object.entries(TB.tasks).map(([k, v]) => ({ k, v, sel: k === t.task }));
    const sceneWeather = new Set(scene?.getFlag(SYSTEM_ID, "weather") ?? []);
    const cells = Object.keys(scene?.getFlag(SYSTEM_ID, "weatherCells") ?? {}).length;
    const combat = game.combat;
    let queued = 0;
    if (combat?.started) {
      const key = `${combat.id}:${combat.round}`;
      // ход идёт сейчас: его карточки среди последних сообщений, весь журнал не перебирать
      queued = game.messages.contents.slice(-300).filter(m => { const c = m.getFlag(SYSTEM_ID, "card"); return c?.delayed && c.combatKey === key && !c.resolved && !c.dmgApplied; }).length;
    }
    const budget = squadBudget();
    const squads = Object.entries(allSquads()).sort(([a], [b]) => a.localeCompare(b, "ru")).map(([name, l]) => {
      const used = squadPoints(l);
      return { name, tag: l.tag ?? "", used, over: used > budget, members: (scene?.tokens ?? []).filter(t => t.actor?.type === "npc" && t.actor.system.tier === "duelist" && t.actor.system.squad === name).map(t => t.name).join(", "),
        skills: Object.keys(TB.skills).map(k => ({ key: k, value: l[k] ?? 0 })) };
    });
    // в панели только эскадрильи, чьи машины стоят на этой сцене; остальные одной строкой
    const elsewhere = squads.filter(q => !q.members).map(q => q.name).join(", ");
    const strikeList = strikesOfCombat(combat), allThreats = threats();
    const line = lineOf(scene);
    const badge = { fight: strikeList.length + queued, campaign: allThreats.filter(t => t.kind !== "boss" && t.value >= t.size).length };
    return {
      badge,
      sceneName: scene?.name ?? "сцена не выбрана", pilots, targets, groups, cells, squads: squads.filter(q => q.members), squadsElsewhere: elsewhere, squadBudget: budget, squadBudgetText: pointsText(budget), opsDone: operationsDone(),
      skillHeads: Object.values(TB.skills).map(v => ({ label: v.label, en: v.en })),
      weather: Object.entries(TB.weather).map(([id, d]) => ({ id, ...d, on: sceneWeather.has(id) })),
      round: combat?.started ? combat.round : null, queued, campaignDate: campaignDateRaw(), today: todayDate(),
      glory: (() => { const g = gloryView(); return { ...g, pct: g.nextAt !== null ? Math.round(100 * g.points / g.nextAt) : 100,
        recent: (g.log ?? []).slice(-3).reverse().map(x => `${x.date} · ${x.op}: ${x.total >= 0 ? "+" : "−"}${Math.abs(x.total)}`) }; })(),
      tunnel: specialSections(scene),
      retLine: line ? (() => {
        const opts = (map, cur) => Object.entries(map).map(([k, v]) => ({ k, v, sel: k === cur }));
        const t = combat?.started ? tallyOf(scene, combat) : null;
        return { count: line.cells.length, ...line, enemyOpts: opts(RET_ENEMY, line.enemy), escortOpts: opts(RET_ESCORT, line.escort), pilotOpts: opts(RET_PILOTS, line.pilots),
          rearm: rearmText(line), tally: t ? `${tallyLine(t)}${t.result ? ` · ${t.result === "success" ? "задание выполнено" : "задание провалено"}` : ""}` : "" };
      })() : null,
      escaped: escapedOf(scene).map(e => ({ id: e.id, name: e.name, round: e.round, priority: e.priority })),
      brushWx: Object.entries(TB.weather).filter(([id]) => !sceneWeather.has(id)).map(([id, d]) => ({ id, name: `${d.ico} ${d.name}` })),
      strikes: strikeList.map(s => ({ ...s, where: strikeWhere(s), when: s.round === combat.round ? "в конце раунда" : `в конце раунда ${s.round}` })),
      threats: allThreats.filter(t => t.kind !== "boss").map(t => ({ ...t, pips: clockPips(t.value, t.size), full: t.value >= t.size })),
      bossClocks: allThreats.filter(t => t.kind === "boss").map(t => ({ ...t, pips: clockPips(t.value, t.size), full: t.value >= t.size,
        pct: Math.round(100 * t.value / t.size),
        marks: DT.bossMarks.filter(([k]) => k !== "full" && (t.lines?.[k] ?? "").trim()).map(([k, label]) => `${label} на ${bossMarkAt(k, t.size)}`).join(", ") })),
      ground: game.actors.filter(inCampaign).sort((a, b) => a.name.localeCompare(b.name, "ru")).map(a => {
        const s = a.system;
        return { id: a.id, name: a.name, nerves: s.nerves, nervesCls: s.nerves >= 5 ? "edge" : s.nerves >= 3 ? "high" : "", edgeFly: s.edgeFly,
          resolve: s.resolve, actions: s.downtime.actions, edges: s.edges.map(e => edgeLabel(e, a)).join("; "), bonds: s.bonds.filter(b => !b.dead && b.value).map(b => `${b.name} ${b.value}`).join(", ") };
      })
    };
  }

  activateListeners(html) {
    super.activateListeners(html);
    const el = html[0];
    const on = (sel, fn) => el.querySelectorAll(sel).forEach(n => n.addEventListener("click", ev => { ev.preventDefault(); fn(n.dataset, n); }));
    on("[data-open]", d => game.actors.get(d.open)?.sheet.render(true));
    on("[data-inactive]", d => setInactive(game.actors.get(d.inactive)));
    on("[data-fold]", (d, n) => {
      if (this.folded.has(d.fold)) this.folded.delete(d.fold); else this.folded.add(d.fold);
      n.closest(".tb-fold")?.classList.toggle("folded", this.folded.has(d.fold));
    });
    on("[data-pool]", async d => {
      const a = game.actors.get(d.id);
      if (!a) return;
      const pool = a.system[d.pool];
      await a.update({ [`system.${d.pool}.value`]: Math.max(0, Math.min(pool.max, pool.value + Number(d.delta))) });
    });
    el.querySelectorAll("[data-task]").forEach(n => n.addEventListener("change", () =>
      game.scenes.viewed?.tokens.get(n.dataset.task)?.actor?.update({ "system.task": n.value })));
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
      // видимая погода Foundry над сценой: дождь, гроза или облачность
      await scene.update({ [`flags.${SYSTEM_ID}.weather`]: ids, weather: coreWeatherFor(ids) });
      for (const a of game.actors) if (a.sheet?.rendered) a.sheet.render(false);
    }));
    on("[data-map-update]", () => openMapUpdateDialog());
    on("[data-brush-ret]", () => openBrush({ kind: "ret" }));
    on("[data-brush-wx]", () => { const id = el.querySelector("[data-brush-wx-id]")?.value; if (id) openBrush({ kind: "wx", id }); });
    on("[data-ret-clear]", async () => { if (await Dialog.confirm({ title: "Линия возврата", content: "<p>Стереть линию возврата с этой сцены?</p>" })) await clearReturnLine(game.scenes.viewed); });
    on("[data-ret-back]", d => bringBack(d.retBack));
    on("[data-ret-forget]", d => forgetEscaped(d.retForget));
    // настройки линии: селекты, числа, галочка
    el.querySelectorAll("[data-ret-set]").forEach(n => n.addEventListener("change", () => {
      const v = n.type === "checkbox" ? n.checked : n.type === "number" ? Number(n.value) || 0 : n.value;
      setLineSettings(game.scenes.viewed, { [n.dataset.retSet]: v });
    }));
    on("[data-sortie-all]", async () => {
      const pilots = game.actors.filter(inCampaign);
      if (!(await Dialog.confirm({ title: "Все к вылету", content: `<p>Подготовить к вылету всех пилотов (${pilots.length}): HP и Strain до максимума, Speed 1, метки сняты, спецоружие пополнено?</p>` }))) return;
      for (const a of pilots) await a.prepareSortie();
    });
    on("[data-results]", () => sortieResults());
    on("[data-hangar]", () => openHangarAdmin());
    on("[data-undo-step]", () => undo());
    on("[data-redo-step]", () => redo());
    on("[data-undo-log]", () => openUndoLog());
    on("[data-radio]", () => openRadioDialog());
    on("[data-chatter]", () => openChatterEditor());
    on("[data-briefing]", () => openBriefing());
    on("[data-aces]", () => openAceIntro());
    on("[data-mission]", () => openMissionDialog({ op: game.scenes.viewed?.getFlag(SYSTEM_ID, "mission") || game.scenes.viewed?.name || "" }));
    on("[data-shtab]", () => openDossierExchange());
    on("[data-medals]", () => openMedals());
    on("[data-base-event]", () => baseEvent());
    on("[data-threat-add]", () => addThreat());
    on("[data-boss-add]", () => bossClockDialog());
    on("[data-strike-add]", () => markStrike());
    on("[data-strike-edit]", d => { const s = strikesOfCombat(game.combat).find(x => x.id === d.strikeEdit); if (s) markStrike(s); });
    on("[data-strike-del]", d => cancelStrike(d.strikeDel));
    el.querySelector("[data-ops-done]")?.addEventListener("change", ev => setOperationsDone(ev.target.value));
    on("[data-glory-add]", () => gloryDialog());
    on("[data-glory-step]", d => setGlory({ points: gloryView().points + Number(d.gloryStep) }));
    el.querySelectorAll("[data-tun-state]").forEach(n => n.addEventListener("change", () => setSectionState(game.scenes.viewed, n.dataset.tunState, n.value)));
    el.querySelector("[data-glory-nick]")?.addEventListener("change", ev => setGlory({ nickname: ev.target.value.trim() }));
    on("[data-boss-edit]", d => { const t = threats().find(x => x.id === d.bossEdit); if (t) bossClockDialog(t); });
    on("[data-threat-step]", d => stepThreat(d.threatStep, Number(d.delta)));
    on("[data-threat-del]", async d => {
      if (await Dialog.confirm({ title: "Шкала угрозы", content: "<p>Убрать эту шкалу?</p>" })) deleteThreat(d.threatDel);
    });
    on("[data-all-fight]", () => allToCombat());
    el.querySelector("[data-campaign-date]")?.addEventListener("change", ev => setCampaignDate(ev.target.value));
    on("[data-squad-form]", () => squadFromSelection());
    on("[data-squad-num]", d => numberSquad(d.squadNum));
    on("[data-squad-talk]", d => openSquadChatter(d.squadTalk));
    on("[data-squad-del]", async d => {
      if (await Dialog.confirm({ title: "Распустить эскадрилью", content: `<p>Распустить «${esc(d.squadDel)}»? Машины останутся дуэлянтами со своими навыками.</p>` })) deleteSquad(d.squadDel);
    });
    el.querySelectorAll("[data-squad-key]").forEach(n => n.addEventListener("change", () =>
      setSquadLayout(n.dataset.squad, { [n.dataset.squadKey]: Number(n.value) || 0 })));
  }
}

/** Состояние пилота к концу вылета для разбора: метки, HP, Strain, потраченный боезапас. */
function pilotState(a) {
  const s = a.system, m = s.markers, out = [];
  if (m.grit) out.push(`Grit: ${TB.skills[m.gritSkill]?.label ?? "навык"}`);
  if (m.structure) out.push(`Structure: ${TB.systems[m.sys]?.label ?? "система"}`);
  if (m.doom) out.push("Doom");
  const ammo = a.items.filter(i => i.type === "weapon" && i.system.ammo.max !== null).map(w => {
    const max = w.system.ammo.max + (s.ammoBonus?.[w.id] ?? 0);
    return { name: w.system.key || w.name, spent: Math.max(0, max - (w.system.ammo.value ?? 0)), max };
  }).filter(x => x.spent);
  return { markers: out, hp: `${s.hp.value}/${s.hp.max}`, strain: `${s.strain.value}/${s.strain.max}`, ammo, plane: s.plane?.name ?? "" };
}

/** Цели открытой сцены: уничтоженные, отступившие и уцелевшие (скрытые и не появившиеся не считаются),
    плюс те, кого бой уже убрал с поля (сводка последнего боя), и потери своих. */
function sceneTargets() {
  const dead = CONFIG.specialStatusEffects.DEFEATED;
  const down = [], alive = [], retreat = [], ours = [];
  const last = game.scenes.viewed?.getFlag(SYSTEM_ID, "lastBattle");
  for (const r of last?.losses ?? []) {
    const line = `${r.name}${r.by ? ` (${r.by})` : ""}`;
    if (["player", "ally"].includes(r.side)) ours.push(`${r.name}: ${r.how === "retreat" ? "отступил" : r.pilot ? "сбит, катапульта" : "сбит"}`);
    else (r.how === "retreat" ? retreat : down).push(line);
  }
  for (const t of game.scenes.viewed?.tokens ?? []) {
    const a = t.actor;
    if (a?.type !== "npc") continue;
    const killed = a.statuses?.has(dead) || a.system.markers.doom;
    if (killed) down.push(t.name);
    else if (!t.hidden) alive.push(`${t.name}${a.system.hp ? ` (HP ${a.system.hp.value}/${a.system.hp.max})` : ""}`);
  }
  return { down, alive, retreat, ours };
}

/** Журнал «Разбор полёта» в папке «Разбор полётов»; игроки могут его читать. */
async function writeDebrief({ op, objectives, rows, targets, date = campaignDate() }) {
  const L = CONST.DOCUMENT_OWNERSHIP_LEVELS;
  const folderName = "Разбор полётов";
  const folder = game.folders.find(f => f.type === "JournalEntry" && f.name === folderName)
    ?? await Folder.create({ name: folderName, type: "JournalEntry", color: "#4c6a37" });
  const li = list => list.length ? `<ul>${list.map(x => `<li>${x}</li>`).join("")}</ul>` : `<p>—</p>`;
  const pilots = rows.map(r => `<h3>${esc(r.name)}${r.plane ? ` <small>${esc(r.plane)}</small>` : ""}</h3><ul>
    <li>Сбито в воздухе: <b>${r.air}</b>${r.airNames.length ? ` (${r.airNames.map(esc).join(", ")})` : ""}</li>
    <li>Уничтожено на земле и на море: <b>${r.gnd}</b>${r.gndNames.length ? ` (${r.gndNames.map(esc).join(", ")})` : ""}</li>
    <li>К концу вылета: HP ${r.hp}, Strain ${r.strain}${r.markers.length ? `, метки: ${r.markers.map(esc).join(", ")}` : ", без меток"}${r.eject ? ", <b>катапультировался</b>" : ""}</li>
    <li>Спецоружие: ${r.ammo.length ? r.ammo.map(x => `${esc(x.name)} ${x.spent} из ${x.max}`).join(", ") : "не тратил"}</li>
    ${r.pts ? `<li>Очки навыков: +${r.pts}</li>` : ""}</ul>`).join("");
  const goals = objectives.length ? `<h2>Задачи</h2><ul>${objectives.map(o => `<li>${o.done ? "✔" : "✘"} ${esc(o.text)}</li>`).join("")}</ul>` : "";
  const scene = game.scenes.viewed, marks = targetGoals(scene, scene?.getFlag(SYSTEM_ID, "lastBattle")?.losses ?? []);
  const aims = marks.length ? `<h2>Цели</h2>${li(marks)}` : "";
  const html = `<p><b>${esc(op)}</b> · ${esc(game.scenes.viewed?.name ?? "")} · ${esc(date)}${game.combat?.round ? ` · раундов: ${game.combat.round}` : ""}</p>
    ${goals}${aims}<h2>Звено</h2>${pilots}
    <h2>Уничтожено</h2>${li(targets.down.map(esc))}${targets.retreat.length ? `<h2>Отступили</h2>${li(targets.retreat.map(esc))}` : ""}<h2>Уцелело</h2>${li(targets.alive.map(esc))}
    <h2>Потери авиакрыла и союзников</h2>${li(targets.ours.map(esc))}`;
  return JournalEntry.create({
    name: `${date} · ${op}`, folder: folder.id, ownership: { default: L.OBSERVER },
    pages: [{ name: "Разбор полёта", type: "text", text: { content: html } }]
  });
}

/** Итоги вылета: +1 очко навыков, вылеты, сбитые и катапультирования в личное дело, разбор полёта в журнал. */
const noq = a => a.items.some(i => i.type === "trigger" && i.system.key === "noquestions");

export async function sortieResults() {
  if (!game.user.isGM) return;
  const pilots = game.actors.filter(inCampaign).sort((a, b) => a.name.localeCompare(b.name, "ru"));
  if (!pilots.length) return ui.notifications.info("Пилотов пока нет.");
  const scene = game.scenes.viewed;
  const objectives = scene?.getFlag(SYSTEM_ID, "objectives") ?? [];
  const rows = pilots.map(a => {
    const k = a.getFlag(SYSTEM_ID, "kills") ?? {};
    const mentor = a.items.some(i => i.type === "trigger" && i.system.key === "mentor");
    const nh = nervesHint(a);
    return `<tr>
      <td><label><input type="checkbox" name="fly_${a.id}" ${a.hasPlayerOwner ? "checked" : ""}> ${esc(a.name)}</label></td>
      <td><input type="number" name="air_${a.id}" value="${k.air ?? 0}" min="0"></td>
      <td><input type="number" name="gnd_${a.id}" value="${k.ground ?? 0}" min="0"></td>
      <td><input type="checkbox" name="eject_${a.id}" ${a.system.markers.doom ? "checked" : ""}></td>
      <td><input type="number" name="pts_${a.id}" value="1" min="0"></td>
      <td><input type="number" name="nerves_${a.id}" value="${nh.up}" min="0" max="2" title="${esc(nh.why || (noq(a) ? "две метки урона или гибель товарища со Связью; тяжёлые решения у него идут в «Репутацию» (кнопка на листе)" : "две метки урона, гибель товарища со Связью или тяжёлое решение"))}" ${a.system.edgeFly ? "disabled" : ""}> <small>${a.system.nerves}${nh.why ? ` · ${esc(nh.why)}` : ""}</small></td>
      <td>${mentor ? `<label title="Урок наставника выполнен: +1 очко"><input type="checkbox" name="lesson_${a.id}" ${lessonDone(a) ? "checked" : ""}> урок</label>` : ""}</td>
    </tr>`;
  }).join("");
  const last = scene?.getFlag(SYSTEM_ID, "lastBattle");
  const gloryBlock = `<details class="tb-glory-block" open><summary><label><input type="checkbox" name="g_on" checked> Слава эскадрильи</label>
    <small class="tb-muted">${last ? "подсказка по сводке последнего боя на сцене" : "сводки боя нет, заполните вручную"}</small></summary>
    ${gloryFields(gloryPrefill(last?.losses ?? [], last?.survivors ?? []))}</details>`;
  const goals = objectives.length ? `<p class="tb-hint">Задачи миссии: отметьте выполненные.</p>${objectives.map((o, i) =>
    `<div class="form-group"><label><input type="checkbox" name="obj_${i}"> ${esc(o)}</label></div>`).join("")}` : "";
  const data = await formDialog("Итоги вылета", `
    <p class="tb-hint">Сбитые подсчитаны по урону, нанесённому с карточек атак; поправьте, если нужно. Очки навыков добавляются к «Доп. очкам». Катапульта отмечена у тех, кто получил Doom.</p>
    <p class="tb-hint">Нервы: +1 за две метки урона, гибель товарища со Связью или тяжёлое решение, не больше +2 за вылет; на пределе не растут. У летавших Заделы сгорают, начинается даунтайм с двумя действиями.</p>
    <table class="tb-results"><tr><th>Летал</th><th>Сбито в воздухе</th><th>Уничтожено на земле</th><th>Катапульта</th><th>Очки</th><th>Нервы +</th><th></th></tr>${rows}</table>
    ${goals}
    ${gloryBlock}
    <div class="form-group"><label>Операция</label><input type="text" name="op" value="${esc(scene?.getFlag(SYSTEM_ID, "mission") || scene?.name || "")}" placeholder="название вылета"></div>
    <div class="form-group"><label>Дата</label><input type="text" name="date" value="${esc(campaignDate())}" placeholder="${esc(todayDate())}" maxlength="40" title="Игровая дата вылета: попадёт в личные дела, разбор полёта и Славу и станет датой кампании"></div>
    <div class="form-group"><label><input type="checkbox" name="journal" checked> Записать разбор полёта в журнал</label></div>`, { ok: "Записать в личные дела", width: 640 });
  if (!data) return;
  const op = data.op || "Вылет";
  // дату поменяли в форме: она становится датой кампании для следующих записей
  const date = String(data.date ?? "").trim() || campaignDate();
  if (date !== campaignDate()) await setCampaignDate(date);
  const lines = [], report = [];
  for (const a of pilots) {
    if (!data[`fly_${a.id}`]) { await a.unsetFlag(SYSTEM_ID, "kills"); continue; }
    const sv = a.system.service, k = a.getFlag(SYSTEM_ID, "kills") ?? {};
    const air = Math.max(0, data[`air_${a.id}`] ?? 0), gnd = Math.max(0, data[`gnd_${a.id}`] ?? 0);
    const pts = Math.max(0, data[`pts_${a.id}`] ?? 0) + (data[`lesson_${a.id}`] ? 1 : 0);
    await lessonReset(a);
    const eject = !!data[`eject_${a.id}`];
    const sortie = sv.sorties + 1;
    const names = kind => (k.list ?? []).filter(x => x.kind === kind).map(x => x.name);
    report.push({ name: a.name, air, gnd, airNames: names("air"), gndNames: names("ground"), eject, pts, ...pilotState(a) });
    // в личное дело: в какой операции был вылет; новая операция прибавляет счётчик операций
    const log = [...(sv.log ?? []), { op, date, air, ground: gnd, eject }];
    const newOp = !(sv.log ?? []).some(x => x.op === op);
    const dt = afterSortieUpdate(a, data[`nerves_${a.id}`] ?? 0);
    await a.update({
      ...dt.upd,
      "system.service.log": log, "system.service.ops": sv.ops + (newOp ? 1 : 0),
      "system.service.sorties": sortie, "system.service.air": sv.air + air, "system.service.ground": sv.ground + gnd,
      "system.service.eject": sv.eject + (eject ? 1 : 0), "system.bonusPoints": a.system.bonusPoints + pts,
      [`flags.${SYSTEM_ID}.-=kills`]: null
    });
    lines.push(`<b>${esc(a.name)}</b>: вылет ${sortie}${air ? `, сбито ${air}` : ""}${gnd ? `, на земле ${gnd}` : ""}${eject ? ", катапультировался" : ""}${pts ? `, +${pts} ${pts === 1 ? "очко" : "очка"} навыков` : ""}${dt.notes.length ? `, ${dt.notes.map(esc).join(", ")}` : ""}`);
  }
  if (data.g_on) await applyGlory(data, op, date);
  if (!lines.length) return;
  const entry = data.journal ? await writeDebrief({ op, rows: report, targets: sceneTargets(), date,
    objectives: objectives.map((text, i) => ({ text, done: !!data[`obj_${i}`] })) }) : null;
  return ChatMessage.create({
    speaker: { alias: "AWACS" },
    content: `<div class="tb-card tb-card-results"><header class="tb-card-head"><span class="tb-card-who">AWACS</span><span class="tb-card-what">Итоги вылета: ${esc(op)}</span></header><div class="tb-note">${lines.join("<br>")}</div>${entry ? `<div class="tb-note">@UUID[${entry.uuid}]{Разбор полёта}</div>` : ""}</div>`
  });
}

/** «Все в бой»: все пилоты и NPC сцены в трекер боя (бой создаётся сам). Здания и объекты отсеивает preCreateCombatant, сбитые и отступившие не идут. */
export async function allToCombat() {
  const scene = game.scenes.viewed;
  if (!game.user.isGM || !scene) return;
  const dead = CONFIG.specialStatusEffects.DEFEATED;
  const tokens = scene.tokens.filter(t => ["pilot", "npc"].includes(t.actor?.type) && !t.inCombat
    && !t.actor.statuses?.has(dead) && !t.actor.statuses?.has("retreat"));
  if (!tokens.length) return ui.notifications.info("Все на сцене уже в бою.");
  const before = game.combat?.combatants.size ?? 0;
  await TokenDocument.implementation.createCombatants(tokens);
  const added = (game.combat?.combatants.size ?? 0) - before;
  ui.combat?.renderPopout?.();
  ui.sidebar?.activateTab?.("combat");
  ui.notifications.info(`В бой: ${added}. ${game.combat?.started ? "" : "Начните бой кнопкой «Begin Combat» в трекере."}`);
}
