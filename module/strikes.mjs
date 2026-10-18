/* Удары по площади: супероружие и навесной огонь (стр. 67). Сам удар действий не заявляет и стоит вне очереди ходов.
   В начале раунда AWACS отмечает зоны (и высоту) на карте — их видят все, — а в конце раунда, когда все сходили,
   удар срабатывает сам: урон получают все, кто так и не ушёл. Рельсотрон Арсиона бьёт только тех, кто за раунд
   не сменил ни зону, ни высоту. Корабли теряют систему по кнопке ведущего (какую — решает он).
   Удары живут во флаге боя strikes; зоны рисует каждый клиент сам. */
import { SYSTEM_ID, TB } from "./config.mjs";
import { esc, resolveActor } from "./utils.mjs";
import { altOf, isFlying, hasRule, isBeam, ALT_ORDER, weatherAt, defenseWithWeather } from "./scene.mjs";
import { cellName } from "./briefing.mjs";

const LAYER = "tb-strikes";
const ALL = ["ground", ...ALT_ORDER];
export const ALT_NAMES = { ground: "земля и вода", low: "Низкая", med: "Средняя", high: "Высокая", strat: "стратосфера" };

/**
 * Виды ударов. zones — сколько зон можно отметить; alts — по каким высотам бьёт (one — одну на выбор);
 * attack — бросок d10 + attack против защиты (у наземных — Occlusion); still — бьёт только не сменивших зону и высоту;
 * byAlt — урон по высотам; ring — урон по соседним зонам; ships — что с кораблями; delay — сработает через раунд.
 */
export const STRIKES = {
  pwrail: { label: "Рельсотрон", rule: "pwrail", zones: 1, alts: "one", attack: 3, dmg: 5, still: true, ships: "attack",
    hint: "Зона в пределах 2 зон от корабля и одна высота. d10 + 3 против защиты, урон 5 (усиленный 6). Кто за раунд сменил зону или высоту, увернулся." },
  railvolley: { label: "Рельсотронный залп", rule: "railvolley", zones: 6, alts: ["ground", "low", "med"], dmg: 10, ships: "system",
    hint: "По зоне на каждую целую башню главного калибра. Низкая, Средняя и земля: 10 урона, корабль теряет систему." },
  burst: { label: "Шрапнельные ракеты", rule: "burst", zones: 4, alts: ["ground", "low", "med"], dmg: 10, ships: "system",
    hint: "До 4 зон. Низкая, Средняя и земля: 10 урона, корабль теряет систему. Сбитую на разгоне ракету снимите: «Зоны» и щелчок по её зоне." },
  arklaser: { label: "Противоспутниковый лазер", rule: "arklaser", zones: 3, alts: ALL, dmg: 8, ships: "system",
    hint: "Линия из 3 зон, все высоты: 8 урона. Облака не мешают." },
  solg: { label: "Удар SOLG с орбиты", rule: "solgrelay", zones: 1, alts: ["ground", "low", "med"], byAlt: { ground: "kill", low: 10, med: 5 }, delay: 1, ships: "system",
    hint: "Падает в конце следующего раунда. Наземные цели уничтожены (укреплённые −10), Низкая 10, Средняя 5." },
  indirect: { label: "Навесной огонь", rule: "indirect", zones: 1, alts: ["ground"], attack: "gg", dmg: TB.missileDamage, ships: "attack",
    hint: "Участок в своей зоне или через одну. Каждая наземная цель: d10 + G-G против Occlusion. По самолётам не стреляет." },
  reactor: { label: "Взрыв реактора", rule: "pwreactor", zones: 1, alts: ALT_ORDER, dmg: 6, ring: 3,
    hint: "Отметьте зону корабля: самолёты в ней получают 6 урона, в соседних зонах 3." },
  fall: { label: "Падение корабля", rule: null, zones: 1, alts: ["ground"], dmg: 10, ships: "system",
    hint: "Воздушный корабль без двигателей рушится: всё на земле под ним получает 10 урона, сам он уничтожен." },
  railline: { label: "Выстрел рейлгана", rule: null, zones: 4, alts: ["ground", "low", "med"], dmg: 10, ships: "system",
    hint: "Шкала «Рейлган» заполнена: до 4 зон по линии, спасает уход на Высокую. Урон по книге не задан, поставьте свой." },
  custom: { label: "Свой удар", rule: null, zones: 9, alts: "pick", dmg: 5, ships: "system",
    hint: "Любые зоны и высоты, свой урон." }
};

/** Системы, из которых бьёт удар (кнопка УДАР прямо на плитке системы в панели цели). */
const STRIKE_SYS = { pwrail: /рельсотрон/i, railvolley: /главного калибра|рельсотрон/i, burst: /шахт/i, arklaser: /противоспутник/i };
/** Похоже на оружие супероружия без своих чисел на листе: такой системе — свой удар с её именем. */
const SUPER_SYS = /рельс|рейлган|railgun|лазер|laser|луч|калибр|орудие|пушк|ракет|шахт|излучат/i;

/** Удар, которым бьёт система цели: по правилам листа, иначе «Свой удар» для оружия без G-A, G-G и Gun; null — не бьёт. */
export function strikeOfSys(actor, y) {
  if (!y || y.value <= 0 || y.ga || y.gg || y.gun || isBeam(actor, y)) return null;
  const k = Object.keys(STRIKE_SYS).find(k => STRIKE_SYS[k].test(y.name ?? "") && hasRule(actor, STRIKES[k].rule));
  if (k) return k;
  return hasRule(actor, "boss") && SUPER_SYS.test(y.name ?? "") ? "custom" : null;
}

/** Какие удары есть у NPC (по правилам листа). */
export function strikesOf(actor) {
  return Object.entries(STRIKES).filter(([, s]) => s.rule && hasRule(actor, s.rule)).map(([k]) => k);
}

const zkey = (col, row) => `${col},${row}`;
const near = (a, b) => { const [c1, r1] = a.split(",").map(Number), [c2, r2] = b.split(",").map(Number); return Math.max(Math.abs(c1 - c2), Math.abs(r1 - r2)); };

/**
 * Кого задевает удар. units — [{ uuid, name, zone: "col,row", alt, kind, defense, hardened, hp, start }], start — "zone|alt" в момент отметки.
 * rolls — d10 по uuid (для ударов с броском). Возвращает [{ uuid, name, dmg, roll, total, vs, hit, ship, why }].
 */
export function strikeHits(strike, units, rolls = {}) {
  const S = STRIKES[strike.kind] ?? STRIKES.custom;
  const alts = strike.alts ?? [];
  const out = [];
  for (const u of units) {
    const d = Math.min(...strike.zones.map(z => near(z, u.zone)));
    const inZone = d === 0, inRing = S.ring && d === 1;
    if (!inZone && !inRing) continue;
    if (!alts.includes(u.alt)) continue;
    if (S.still && u.start !== `${u.zone}|${u.alt}`) { out.push({ uuid: u.uuid, name: u.name, hit: false, why: "сменил зону или высоту за раунд" }); continue; }
    if (u.kind === "ship") { out.push({ uuid: u.uuid, name: u.name, ship: true, hit: true, dmg: strike.dmg }); continue; }
    let dmg = inRing ? S.ring : strike.dmg;
    if (S.byAlt) {
      const v = S.byAlt[u.alt];
      dmg = v === "kill" ? (u.hardened ? 10 : Math.max(u.hp ?? 0, 1)) : v ?? 0;
      if (!dmg) continue;
    }
    if (strike.attack !== null && strike.attack !== undefined) {
      const roll = rolls[u.uuid] ?? 0, total = roll + strike.attack, vs = u.defense ?? 0;
      // ничья за атакующим
      out.push({ uuid: u.uuid, name: u.name, roll, total, vs, hit: total >= vs, dmg });
      continue;
    }
    out.push({ uuid: u.uuid, name: u.name, hit: true, dmg });
  }
  return out;
}

/* ---------- где кто стоит ---------- */

/** Зона токена по документу (без открытой сцены): клетка его центра. */
function zoneOfDoc(doc) {
  const gs = doc.parent?.grid?.size;
  if (!gs) return null;
  return zkey(Math.floor((doc.x + (doc.width * gs) / 2) / gs), Math.floor((doc.y + (doc.height * gs) / 2) / gs));
}

/** Все пилоты и NPC на сцене: зона, высота («ground» у наземных и кораблей), защита. */
export function unitsOn(scene) {
  const out = [];
  for (const doc of scene?.tokens ?? []) {
    const a = doc.actor;
    if (!a || !["pilot", "npc"].includes(a.type) || a.statuses?.has?.(CONFIG.specialStatusEffects.DEFEATED)) continue;
    const zone = zoneOfDoc(doc);
    if (!zone) continue;
    const s = a.system, kind = a.type === "pilot" ? "air" : s.kind;
    const alt = isFlying(a) ? altOf(doc.object ?? { document: doc }, a) : "ground";
    // защита на этот момент: Break!, Speed и погода в клетке (у наземных Occlusion)
    let defense = s.defense ?? null;
    try { if (doc.object) defense = defenseWithWeather(a, weatherAt(a, doc.object)) ?? defense; } catch { /* без открытой сцены — с листа */ }
    out.push({ uuid: a.uuid, name: doc.name, zone, alt, kind, defense, hardened: hasRule(a, "hardened"), hp: s.hp?.value ?? 0 });
  }
  return out;
}

/* ---------- флаг боя ---------- */

/**
 * Где кто стоял в момент отметки: пары [uuid, "зона|высота"]. Не объект: uuid с точками («Actor.abc») Foundry во флаге
 * разворачивает во вложенные ключи, и рельсотрон считал увернувшимися даже тех, кто не двигался.
 */
const startNow = scene => unitsOn(scene).map(u => [u.uuid, `${u.zone}|${u.alt}`]);
export const startOf = s => Array.isArray(s.start) ? new Map(s.start)
  : new Map(Object.entries(foundry.utils.flattenObject?.(s.start ?? {}) ?? s.start ?? {}));

export const strikesOfCombat = combat => combat?.getFlag(SYSTEM_ID, "strikes") ?? [];
const saveStrikes = (combat, list) => combat.setFlag(SYSTEM_ID, "strikes", list);

const zonesText = zones => zones.map(z => { const [c, r] = z.split(",").map(Number); return cellName(c, r); }).join(", ");
/** Для панели AWACS: зоны и высоты одной строкой. */
export const strikeWhere = s => `${zonesText(s.zones)}, ${altsText(s.alts)}`;
const altsText = alts => alts.length >= ALL.length ? "все высоты" : alts.map(a => ALT_NAMES[a]).join(", ");

/** Ведущий: отметить новый удар (или поправить зоны имеющегося). */
export async function markStrike(edit = null, preset = null) {
  const combat = game.combat;
  if (!game.user.isGM) return;
  if (!combat?.started) return ui.notifications.warn("Удар по площади отмечают в начале раунда идущего боя.");
  const scene = combat.scene ?? canvas.scene;
  if (!canvas?.ready || canvas.scene !== scene) return ui.notifications.warn("Откройте сцену боя: зоны отмечаются щелчками по карте.");
  if (edit) {
    const zones = await pickZones(new Set(edit.zones), STRIKES[edit.kind]?.zones ?? 9, edit.label);
    if (!zones) return;
    const list = foundry.utils.deepClone(strikesOfCombat(combat));
    const s = list.find(x => x.id === edit.id);
    if (!s) return;
    if (!zones.length) return cancelStrike(edit.id, "все зоны сняты");
    s.zones = zones;
    await saveStrikes(combat, list);
    return ChatMessage.create({ speaker: { alias: "AWACS" }, content: `<div class="tb-card tb-card-round"><div class="tb-note">${esc(s.label)}: теперь ${zonesText(zones)}.</div></div>` });
  }
  const opts = strikeDialogData(scene);
  // с панели цели: источник есть всегда, даже если у него нет удара по правилам («Свой удар» системы)
  if (preset?.source && !opts.sources.some(x => x.uuid === preset.source)) {
    const doc = scene.tokens.find(d => d.actor?.uuid === preset.source), a = doc?.actor;
    if (a) opts.sources.push({ uuid: a.uuid, name: doc.name, kinds: [preset.kind ?? "custom"], gg: a.system.ground?.gg ?? a.system.gg ?? 0 });
  }
  // с панели цели без окна: высоты и урон удара по правилам, одна высота — кнопками на пульте; «Свой удар» — в окне
  const P = preset?.quick && STRIKES[preset.kind];
  let data;
  if (P && P.alts !== "pick") {
    const alt = P.alts === "one" ? await pickAlt(P, preset.label) : null;
    if (P.alts === "one" && !alt) return;
    data = { source: preset.source, kind: preset.kind, dmg: P.dmg, alt, alts: [] };
  } else data = await strikeDialog(opts, preset);
  if (!data) return;
  const S = STRIKES[data.kind];
  const src = opts.sources.find(x => x.uuid === data.source);
  const name = preset?.label && data.kind === preset.kind ? preset.label : S.label;
  const zones = await pickZones(new Set(), S.zones, name);
  if (!zones?.length) return;
  const alts = S.alts === "one" ? [data.alt] : S.alts === "pick" ? data.alts : S.alts;
  if (!alts.length) return ui.notifications.warn("Не выбрано ни одной высоты.");
  const attack = S.attack === "gg" ? (src?.gg ?? 0) : S.attack ?? null;
  const strike = {
    id: foundry.utils.randomID(), kind: data.kind, label: src ? `${name} · ${src.name}` : name, source: src?.name ?? "", sourceUuid: src?.uuid ?? null,
    zones, alts, dmg: Number(data.dmg) || S.dmg, attack, round: combat.round + (S.delay ?? 0), marked: combat.round,
    start: startNow(scene)
  };
  await saveStrikes(combat, [...strikesOfCombat(combat), strike]);
  const when = strike.round === combat.round ? "в конце раунда" : `в конце раунда ${strike.round}`;
  const { sendRadio } = await import("./radio.mjs"); // лениво: radio-log тянет Application
  await sendRadio({ speaker: "AWACS", side: "ally", caution: { level: "warning", title: "WARNING", sub: S.label },
    text: `${S.label}: удар ${when} по ${zones.length > 1 ? "зонам" : "зоне"} ${zonesText(zones)}, ${altsText(alts)}. ${S.still ? "Смените зону или высоту!" : "Уходите из зоны!"}` });
  // выстрел рельсотрона или лазера слышен сразу у всех, взрыв в зонах — в конце раунда
  const { shotOf, cueEveryone } = await import("./sounds.mjs");
  const shot = shotOf(name);
  if (shot) cueEveryone(shot);
}

/** Высота удара кнопками на пульте (рельсотрон бьёт одну высоту). */
async function pickAlt(S, label) {
  const { cockpitDialog } = await import("./aim.mjs");
  const btn = a => `<button type="button" class="tb-ck-big ${a === "strat" || a === "high" ? "imp" : ""}" data-pick="${a}"><b>${{ ground: "ЗЕМЛЯ", low: "LOW", med: "MED", high: "HIGH", strat: "STRAT" }[a]}</b><small>${ALT_NAMES[a]}</small></button>`;
  const r = await cockpitDialog(`${label ?? S.label}: высота`, `<p class="tb-hint">${esc(S.hint)}</p><div class="tb-ck-fire alts">${ALL.map(btn).join("")}</div>`, { width: 520 });
  return r?.pick ?? null;
}

function strikeDialogData(scene) {
  const sources = [];
  for (const doc of scene.tokens) {
    const a = doc.actor;
    if (a?.type !== "npc") continue;
    const kinds = strikesOf(a);
    if (kinds.length) sources.push({ uuid: a.uuid, name: doc.name, kinds, gg: a.system.ground?.gg ?? a.system.gg ?? 0 });
  }
  return { sources };
}

async function strikeDialog({ sources }, preset = null) {
  const { formDialog } = await import("./dice/rolls.mjs");
  const kindOpts = Object.entries(STRIKES).map(([k, s]) => `<option value="${k}">${esc(s.label)}</option>`).join("");
  const srcOpts = `<option value="">— без источника —</option>` + sources.map(s => `<option value="${s.uuid}" data-kinds="${s.kinds.join(" ")}">${esc(s.name)}</option>`).join("");
  const altOpts = ALL.map(a => `<option value="${a}">${ALT_NAMES[a]}</option>`).join("");
  const altChecks = ALL.map(a => `<label class="tb-check"><input type="checkbox" name="alt_${a}" ${a !== "strat" ? "checked" : ""}> ${ALT_NAMES[a]}</label>`).join(" ");
  return formDialog("Удар по площади", `
    <p class="tb-hint">Отметьте в начале раунда: удар сработает в конце, когда все сходят. Зоны потом щёлкаете на карте, Enter — готово.</p>
    <div class="form-group"><label>Кто бьёт</label><select name="source">${srcOpts}</select></div>
    <div class="form-group"><label>Удар</label><select name="kind">${kindOpts}</select></div>
    <p class="tb-hint" data-hint></p>
    <div class="form-group" data-one><label>Высота</label><select name="alt">${altOpts}</select></div>
    <div class="form-group" data-pick><label>Высоты</label><div>${altChecks}</div></div>
    <div class="form-group"><label>Урон</label><input type="number" name="dmg" min="1"></div>`, {
    ok: "Отметить зоны", width: 460,
    render: root => {
      const f = n => root.querySelector(`[name="${n}"]`);
      const sync = () => {
        const S = STRIKES[f("kind").value];
        root.querySelector("[data-hint]").textContent = S.hint;
        root.querySelector("[data-one]").hidden = S.alts !== "one";
        root.querySelector("[data-pick]").hidden = S.alts !== "pick";
        f("dmg").value = S.dmg;
        f("dmg").closest(".form-group").hidden = !!S.byAlt;
      };
      f("source").addEventListener("change", () => {
        const kinds = f("source").selectedOptions[0]?.dataset.kinds?.split(" ") ?? [];
        if (kinds[0]) { f("kind").value = kinds[0]; sync(); }
      });
      f("kind").addEventListener("change", sync);
      // с панели цели: сразу её удар; иначе первый источник на сцене
      const pick = preset?.source && sources.find(x => x.uuid === preset.source);
      if (pick) { f("source").value = pick.uuid; f("kind").value = preset.kind && pick.kinds.includes(preset.kind) ? preset.kind : pick.kinds[0]; }
      else if (sources[0]) { f("source").value = sources[0].uuid; f("kind").value = sources[0].kinds[0]; }
      sync();
    }
  }).then(d => d && { ...d, alts: ALL.filter(a => d[`alt_${a}`]) });
}

/**
 * Удар по зоне самого корабля без окна (взрыв реактора, падение): ставится, когда сработало правило гибели (boss-fate.mjs).
 * destroy — корабль, который уничтожается вместе с ударом. Возвращает id удара.
 */
export async function scheduleStrike(combat, actor, kind, round) {
  const S = STRIKES[kind], scene = combat.scene ?? canvas.scene;
  const doc = scene?.tokens.find(d => d.actor === actor || d.actor?.uuid === actor.uuid);
  const zone = doc && zoneOfDoc(doc);
  if (!zone) return null;
  const name = doc.name ?? actor.name;
  const strike = {
    id: foundry.utils.randomID(), kind, label: `${S.label} · ${name}`, source: name, sourceUuid: actor.uuid, destroy: actor.uuid,
    zones: [zone], alts: Array.isArray(S.alts) ? S.alts : ALL, dmg: S.dmg, attack: null, round, marked: combat.round,
    start: startNow(scene)
  };
  await saveStrikes(combat, [...strikesOfCombat(combat), strike]);
  return strike.id;
}

/** Ведущий отменяет удар (ракету сбили, корабль уничтожен). */
export async function cancelStrike(id, why = "отменён") {
  const combat = game.combat;
  const list = strikesOfCombat(combat);
  const s = list.find(x => x.id === id);
  if (!s) return;
  await saveStrikes(combat, list.filter(x => x.id !== id));
  return ChatMessage.create({ speaker: { alias: "AWACS" }, content: `<div class="tb-card tb-card-round"><div class="tb-note">${esc(s.label)}: удара не будет (${esc(why)}).</div></div>` });
}

/* ---------- щелчки по карте ---------- */

/** Щёлкать по зонам (повторный щелчок снимает). Enter или правая кнопка — готово, Esc — отмена. */
function pickZones(chosen, max, title) {
  const view = canvas.app.view;
  return new Promise(resolve => {
    const prev = view.style.cursor;
    view.style.cursor = "crosshair";
    ui.notifications.info(`${title}: щёлкайте по зонам (до ${max}), повторный щелчок снимает. Enter или правая кнопка — готово, Esc — отмена.`);
    const show = () => draw(chosen);
    const finish = ok => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("contextmenu", onContext, true);
      window.removeEventListener("keydown", onKey, true);
      view.style.cursor = prev;
      draw();
      resolve(ok ? [...chosen] : null);
    };
    const onDown = ev => {
      if (ev.target !== view) return;
      ev.stopImmediatePropagation(); ev.preventDefault();
      if (ev.button === 2) return finish(true);
      if (ev.button !== 0) return;
      const r = view.getBoundingClientRect();
      const p = canvas.canvasCoordinatesFromClient?.({ x: ev.clientX, y: ev.clientY })
        ?? canvas.stage.worldTransform.applyInverse({ x: ev.clientX - r.left, y: ev.clientY - r.top });
      const o = canvas.grid.getOffset(p), k = zkey(o.j, o.i);
      if (chosen.has(k)) chosen.delete(k);
      else if (chosen.size >= max) return ui.notifications.warn(`Не больше ${max} зон: снимите лишнюю повторным щелчком.`);
      else chosen.add(k);
      show();
    };
    const onContext = ev => { if (ev.target === view) { ev.stopImmediatePropagation(); ev.preventDefault(); } };
    const onKey = ev => {
      if (ev.key === "Escape") { ev.stopPropagation(); ev.preventDefault(); finish(false); }
      else if (ev.key === "Enter") { ev.stopPropagation(); ev.preventDefault(); finish(true); }
    };
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("contextmenu", onContext, true);
    window.addEventListener("keydown", onKey, true);
    show();
  });
}

/* ---------- зоны на карте у всех ---------- */

const STYLE = { color: 0xff3030, border: 0xff3030, alpha: 0.28 };
const PICK = { color: 0xffb020, border: 0xffb020, alpha: 0.35 };
let labels = null;

/** Нарисовать отмеченные зоны текущего боя на открытой сцене (picking — зоны, которые ведущий сейчас выбирает). */
function draw(picking = null) {
  const grid = canvas?.ready ? canvas.interface?.grid : null;
  if (!grid) return;
  const layer = grid.addHighlightLayer(LAYER);
  grid.clearHighlightLayer(LAYER);
  if (labels && !labels.destroyed) labels.removeChildren().forEach(c => c.destroy());
  else labels = canvas.interface.addChild(new PIXI.Container());
  const combat = game.combat;
  const list = combat?.started && (combat.scene ?? canvas.scene) === canvas.scene ? strikesOfCombat(combat) : [];
  const text = new Map();
  for (const s of list) for (const z of s.zones) {
    const t = text.get(z) ?? [];
    t.push(`${STRIKES[s.kind]?.label ?? s.label}${s.alts.length >= ALL.length ? "" : ` · ${s.alts.map(a => ALT_NAMES[a]).join(", ")}`}${s.round > combat.round ? ` · раунд ${s.round}` : ""}`);
    text.set(z, t);
  }
  const mark = (z, style) => {
    const [j, i] = z.split(",").map(Number);
    const p = canvas.grid.getTopLeftPoint({ i, j });
    grid.highlightPosition(LAYER, { x: p.x, y: p.y, ...style });
  };
  for (const z of text.keys()) mark(z, STYLE);
  for (const z of picking ?? []) mark(z, PICK);
  const gs = canvas.grid.size;
  for (const [z, lines] of text) {
    const [j, i] = z.split(",").map(Number);
    const p = canvas.grid.getTopLeftPoint({ i, j });
    const t = labels.addChild(new PreciseText(lines.join("\n"), new PIXI.TextStyle({
      fontFamily: "Jura, sans-serif", fontSize: Math.max(12, Math.round(gs / 9)), fill: 0xffd0d0, stroke: 0x200000, strokeThickness: 3, wordWrap: true, wordWrapWidth: gs - 8
    })));
    t.position.set(p.x + 4, p.y + 4);
  }
  layer.visible = true;
}

let timer = null;
function drawSoon() { clearTimeout(timer); timer = setTimeout(() => draw(), 60); }

/* ---------- конец раунда ---------- */

/** Конец раунда round: срабатывают удары, назначенные на него. Вызывает ведущий из конца раунда боя. */
export async function resolveStrikes(combat, round) {
  const list = strikesOfCombat(combat);
  const due = list.filter(s => s.round <= round);
  if (!due.length) return;
  await saveStrikes(combat, list.filter(s => s.round > round));
  const scene = combat.scene ?? canvas.scene;
  const units = unitsOn(scene);
  const { damageUser, hitTarget } = await import("./dice/rolls.mjs");
  for (const s of due) {
    const S = STRIKES[s.kind] ?? STRIKES.custom;
    const rolls = {};
    if (s.attack !== null && s.attack !== undefined) for (const u of units) rolls[u.uuid] = (await new Roll("1d10").evaluate()).total;
    // сам взрывающийся или падающий корабль в своей зоне урона не получает: он уничтожен целиком
    const self = s.destroy ?? (s.kind === "reactor" ? s.sourceUuid : null);
    const start = startOf(s);
    const here = units.filter(u => u.uuid !== self).map(u => ({ ...u, start: start.get(u.uuid) ?? null }));
    const hits = strikeHits(s, here, rolls);
    const key = `${combat.id}:${round}`;
    const rows = hits.map(h => {
      if (h.why) return `<div class="tb-volley-row muted"><b>${esc(h.name)}</b>: увернулся, ${esc(h.why)}.</div>`;
      if (h.ship) return `<div class="tb-volley-row hit"><b>${esc(h.name)}</b>: корабль ${S.ships === "attack" ? `под ударом (${h.dmg} урона по системе, если пробит Occlusion)` : "теряет одну систему"}.</div>`;
      const roll = h.roll !== undefined ? `d10 ${h.roll} + ${s.attack} = ${h.total} против ${h.vs} → ` : "";
      return `<div class="tb-volley-row ${h.hit ? "hit" : "miss"}"><b>${esc(h.name)}</b>: ${roll}${h.hit ? `<b class="ok">${h.dmg} урона</b>` : `<b class="fail">мимо</b>`}</div>`;
    }).join("");
    const ships = hits.filter(h => h.ship);
    const card = { type: "strike", label: s.label, ships: ships.map(h => ({ uuid: h.uuid, name: h.name, dmg: S.ships === "attack" ? h.dmg : 99 })) };
    const btn = ships.length ? `<div class="tb-actions">${ships.map(h => `<button type="button" data-tb-action="strike-ship" data-uuid="${esc(h.uuid)}" class="tb-gm"><i class="fas fa-burst"></i> ${esc(h.name)}: ${S.ships === "attack" ? `${h.dmg} урона` : "снять систему"}</button>`).join("")}</div>` : "";
    await ChatMessage.create({
      speaker: { alias: "AWACS" }, flags: { [SYSTEM_ID]: { card } },
      content: `<div class="tb-card tb-card-volley"><header class="tb-card-head"><span class="tb-card-who">AWACS</span><span class="tb-card-what">Конец раунда ${round}: ${esc(s.label)}</span></header>
        <div class="tb-note">${zonesText(s.zones)}, ${altsText(s.alts)}.</div>${rows || `<div class="tb-note">В отмеченных зонах никого не осталось.</div>`}${btn}</div>`
    });
    // корабль, чей это взрыв или падение, уничтожен (сам он в зоне удара урона не получает)
    try { const { strikeDone } = await import("./boss-fate.mjs"); await strikeDone(s); } catch (err) { console.warn(`${SYSTEM_ID} | гибель цели`, err); }
    for (const h of hits.filter(x => x.hit && !x.ship && x.dmg > 0)) {
      const target = resolveActor(h.uuid);
      if (!target) continue;
      const hit = { uuid: h.uuid, name: h.name, dmg: h.dmg, source: s.source || S.label, sourceUuid: s.sourceUuid };
      const by = damageUser(target);
      if (by === game.user.id) await hitTarget(hit, key);
      else if (by) game.socket.emit(`system.${SYSTEM_ID}`, { type: "hit", to: by, hit });
    }
  }
}

/** Кнопка карточки удара: ведущий снимает систему с корабля или наносит урон по выбранной. */
export async function strikeShip(message, uuid) {
  if (!game.user.isGM) return;
  const card = message.getFlag(SYSTEM_ID, "card");
  const row = card?.ships?.find(x => x.uuid === uuid);
  const ship = row && resolveActor(uuid);
  if (!ship) return;
  // кнопка одна на корабль: после нажатия на карточке остаётся отметка
  const btn = new RegExp(`<button[^>]*data-uuid="${uuid.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^>]*>[\\s\\S]*?</button>`);
  await message.update({ content: message.content.replace(btn, `<span class="tb-small">${esc(row.name)}: отмечено</span>`) });
  await ship.applyDamage(row.dmg, { source: card.label });
}

export function registerStrikes() {
  for (const ev of ["updateCombat", "deleteCombat", "createCombat", "canvasReady"]) Hooks.on(ev, drawSoon);
  Hooks.on("canvasTearDown", () => { labels = null; });
}
