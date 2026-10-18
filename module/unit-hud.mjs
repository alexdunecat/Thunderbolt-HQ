/* Панели крупных целей на месте HUD пилота: супероружие, флот и наземная техника. У зданий и гражданских панели нет.
   Системы плитками (HP, Occ, оружие, пуск и огонь), механики правил цели (падение, ордер, погружение, засада…),
   шкалы, которые сами растут в конце раунда (scales.mjs), удары по площади этой цели и действия хода. */
import { SYSTEM_ID, TB } from "./config.mjs";
import { esc, resolveActor } from "./utils.mjs";
import { tokenOf, altOf, zoneDistance, flyingBoss, hasRule } from "./scene.mjs";
import { combatantOf, spentOf, declaredOf, allowAction, spendAction } from "./actions.mjs";
import { runAction } from "./macros.mjs";
import { strikesOf, STRIKES } from "./strikes.mjs";
import { SCALES, scalesOf, scaleValue, scaleFull, setScale, sysCount, unitFlag } from "./scales.mjs";
import { roleOf, ENGINE } from "./aim.mjs";
import { hlSwitch } from "./range.mjs";
import { adviceRow } from "./npc-advice.mjs";

const SUPER_RULES = ["boss", "aerialship", "landship", "superdive", "solgfall", "strato"];

/** Какая панель у NPC: super — супероружие и крупные воздушные корабли, fleet — флот, ground — техника; null — без панели. */
export function unitKind(actor) {
  if (actor?.type !== "npc") return null;
  const s = actor.system;
  if (s.grp === "civil" || s.grp === "obj" || hasRule(actor, "civilian")) return null;
  if (s.grp === "boss" || flyingBoss(actor) || SUPER_RULES.some(r => hasRule(actor, r))) return "super";
  if (s.kind === "ship") return "fleet";
  if (s.kind === "ground") return "ground";
  return null;
}

const KIND_LABEL = { super: "Супероружие", fleet: "Флот", ground: "Техника" };
/** Таймер «раз в N раундов»: когда событие было последний раз и можно ли снова. */
function every(actor, key, n, round) {
  const last = unitFlag(actor, "launch", {})?.[key];
  if (last === undefined || last === null || !round) return { ready: true, left: 0 };
  const left = Math.max(0, last + n - round);
  return { ready: left === 0, left };
}
const ready = (t, what) => t.ready ? `${what}: можно в этом раунде` : `${what}: через ${t.left} ${t.left === 1 ? "раунд" : "раунда"}`;

/** Строки механик по правилам цели: { text, tone: ok|warn|bad|info, btn: { attrs, label } }. */
function mechanics(actor, round) {
  const out = [], has = r => hasRule(actor, r), c = re => sysCount(actor, re);
  const add = (text, tone = "info", btn = null) => out.push({ text, tone, btn });
  const shift = (n, what) => { const t = every(actor, "shift", n, round); add(ready(t, what), t.ready ? "ok" : "info", { attrs: `data-u-launch="shift"`, label: "Сместился" }); };
  const sub = !!unitFlag(actor, "sub");
  const dive = () => add(sub ? "Под водой: не атакует и не атакуется оружием воздух-поверхность" : "На поверхности", sub ? "warn" : "info",
    { attrs: `data-u-flag="sub"`, label: sub ? "Всплыть" : "Погрузиться" });

  // ---------- супероружие и воздушные корабли ----------
  if (has("aerialship")) shift(2, "Смещение на соседнюю зону");
  if (has("landship")) shift(2, "Смещение по суше (по воде — каждый раунд)");
  if (has("aerialfall")) {
    const e = c(/двигат/i);
    if (e.total) add(e.alive ? `Двигатели ${e.alive} из ${e.total}` : "ПАДАЕТ к концу следующего раунда: всё под ним получает 10 урона", e.alive ? (e.alive < e.total ? "warn" : "ok") : "bad");
  }
  if (has("pwfallmulti")) {
    const e = c(/двигат|сопл/i);
    if (e.total) add(!e.alive ? "ПАДАЕТ к концу следующего раунда: всё под ним получает 10 урона"
      : e.alive <= e.total / 2 ? `Двигатели ${e.alive} из ${e.total}: опустился на ступень, вверх не поднимается` : `Двигатели ${e.alive} из ${e.total}`,
    !e.alive ? "bad" : e.alive <= e.total / 2 ? "warn" : "ok");
  }
  if (has("strato") || has("engines")) {
    const e = c(ENGINE), dead = e.total - e.alive;
    add(dead >= 5 ? "Все двигатели уничтожены: сбит, падает в океан с грузом" : dead >= 4 ? `Двигатели ${e.alive} из ${e.total}: на Средней, свернул на новую цель («Сброс» не больше 2)`
      : dead >= 2 ? `Двигатели ${e.alive} из ${e.total}: опустился на Высокую` : `Двигатели ${e.alive} из ${e.total}: держится в стратосфере`,
    dead >= 5 ? "bad" : dead >= 2 ? "warn" : "ok");
  }
  if (has("solgfall") && round) add(`Высота по раунду: ${round <= 2 ? "стратосфера" : round <= 4 ? "Высокая" : "Средняя"}; каждый раунд на зону ближе к городу`, "info");
  if (has("solgcores")) {
    const sys = actor.system.systems ?? [], boost = sys.filter(y => /ускорител/i.test(y.name)), cores = sys.filter(y => /^ядр/i.test(y.name) && !/ствол/i.test(y.name));
    const open = cores.map((y, i) => y.value <= 0 ? `№${i + 1} уничтожено` : (round > 3 || (boost[i] && boost[i].value <= 0)) ? `№${i + 1} открыто` : `№${i + 1} закрыто`);
    if (open.length) add(`Ядра: ${open.join(", ")}`, cores.every(y => y.value <= 0) ? "bad" : "info");
    if (round > 3) add("Обломки: в конце раунда 6 против Defense, урон 3 каждому самолёту в зоне SOLG", "warn");
  }
  if (has("solgbarrel")) add("Ствол: действие и Push против 8 (провал — урон, равный Speed), потом пушка по ядру попадает сама", "info");
  if (has("pwqrf")) {
    const h = c(/ангар/i), used = !!unitFlag(actor, "qrf");
    add(!h.alive ? "Ангар уничтожен: звена не будет" : used ? "Дежурное звено выпущено" : "Дежурное звено в ангаре: выпустит пару при первой атаке",
      !h.alive || used ? "info" : "warn", h.alive ? { attrs: `data-u-flag="qrf"`, label: used ? "Вернуть" : "Выпустить" } : null);
  }
  if (has("pwciws")) { const z = c(/ЗАК/); if (z.total) add(z.alive ? `ЗАК целы (${z.alive}): ракеты по системам не из его зоны −1` : "ЗАК уничтожены: штрафа к ракетам нет", z.alive ? "warn" : "ok"); }
  if (has("flakscreen")) { const z = c(/зенитные батареи/i); add(z.total && z.alive === z.total ? "Зенитный заслон: союзные корабли рядом +1 к Occlusion" : "Заслон снят: батарея уничтожена", z.alive === z.total ? "warn" : "ok"); }
  if (has("esmfield")) { const z = c(/радиоэлектрон/i); add(z.alive ? "РЭБ: своя и соседние зоны под помехами" : "Станция РЭБ уничтожена", z.alive ? "warn" : "ok"); }
  if (has("pwhpbc")) { const z = c(/HPBC|энергетическ/i); add(`Лучей за раунд: ${z.alive} (d10 + 2 против Defense, урон 4)`, z.alive ? "warn" : "ok"); }
  if (has("pwreactor")) {
    const n = c(/сопл/i), b = c(/HPBC|энергетическ/i), r = c(/реактор/i);
    const opened = n.total - n.alive >= 2 || (b.total && !b.alive);
    add(r.total && !r.alive ? "Реактор уничтожен: уходит на Высокую и в конце раунда взрывается (6 в зоне, 3 рядом)" : opened ? "Реактор открыт для атаки" : "Реактор закрыт: нужно 2 сопла или все энергетические орудия",
      r.total && !r.alive ? "bad" : opened ? "warn" : "info");
  }
  if (has("pwescort")) add("Ордер: пока рядом цел хоть один корабль сопровождения, захват только из его зоны", "info");
  if (has("capsize")) { const z = c(/гусениц/i); if (z.total) add(z.alive ? `Гусеницы со стабилизаторами ${z.alive} из ${z.total}` : "ОПРОКИДЫВАЕТСЯ в конце раунда", z.alive ? (z.alive < z.total ? "warn" : "ok") : "bad"); }
  if (has("overheat")) { const z = c(/решётк/i); if (z.total) add(z.alive ? `Решётки охлаждения ${z.alive} из ${z.total}` : "Решётки уничтожены: реактор перегревается", z.alive ? (z.alive < z.total ? "warn" : "ok") : "bad"); }
  if (has("railvolley")) { const z = c(/главного калибра/i); add(`Рельсотронный залп: ${z.alive} ${z.alive === 1 ? "зона" : z.alive && z.alive < 5 ? "зоны" : "зон"}`, z.alive ? "warn" : "ok"); }
  if (has("pwrail")) { const z = c(/рельсотрон/i); add(`Рельсотронов целы: ${z.alive}; кто за раунд сменил зону или высоту, увернулся`, z.alive ? "warn" : "ok"); }
  if (has("superdive")) dive();
  if (has("burst")) { const z = c(/шахты/i); add(z.alive ? "Шрапнельные ракеты: до 4 зон за пуск" : "Шахты уничтожены: ракет больше нет", z.alive ? "warn" : "ok"); }
  if (has("boostphase")) add("На разгоне: каждая ракета — воздушная цель в зоне лодки (Defense 6, HP 1)", "info");
  if (has("vtoldeck")) launcher(actor, round, add, /палуба/i, "vtol", 2, "Палуба СВВП: пара «Харриеров» или F-35C", sub);
  if (has("uavbay")) launcher(actor, round, add, /ангар беспилот/i, "uav", 2, "Ангар: пара беспилотников", sub);
  if (has("uavports")) { const z = c(/порты/i); const t = every(actor, "ports", 3, round); add(z.alive ? `${ready(t, `Порты (${z.alive}): по беспилотнику с порта`)}` : "Порты уничтожены", z.alive && t.ready ? "warn" : "info", z.alive ? { attrs: `data-u-launch="ports"`, label: "Выпустили" } : null); }
  if (has("arkturret")) { const z = c(/турель/i); add(z.alive ? "Турель: каждый раунд d10 + 2 против Defense, урон 4" : "Турель уничтожена", z.alive ? "warn" : "ok"); }
  if (has("boss")) add("Финал операции: эскорт, подкрепления и Twist наготове", "info");

  // ---------- флот ----------
  if (has("shipfirst")) {
    const hit = !!unitFlag(actor, "airAttacked");
    add(hit ? "Атакован с воздуха: отвечает самолётам" : "Бьёт по кораблям, пока его не атакуют с воздуха", hit ? "warn" : "info", { attrs: `data-u-flag="airAttacked"`, label: hit ? "Снять" : "Атакован" });
  }
  const paired = (actor.system.systems ?? []).filter(y => /спаренно/i.test(y.note ?? ""));
  if (paired.length > 1) { const alive = paired.filter(y => y.value > 0).length; add(alive >= 2 ? "Спаренные орудия целы: Strafe +2" : alive ? "Одно спаренное орудие: Strafe +0" : "Спаренные орудия уничтожены", alive >= 2 ? "warn" : "info"); }
  if (has("carrierdeck")) {
    const d = c(/палуб|runway/i), n = unitFlag(actor, "deck", 0);
    add(d.alive ? `На палубе: ${n} (действие поставить, действие поднять)` : "Палуба уничтожена: ни взлёта, ни посадки", d.alive ? "info" : "bad",
      d.alive ? { attrs: `data-u-count="deck"`, label: "±", count: n } : null);
  }
  if (has("escort")) add("Ордер: пока эскорт цел, захват только из соседней зоны или ближе", "info");
  if (has("aegis")) { const z = c(/иджис|aegis/i); add(z.alive ? "«Иджис»: помехи на корабли ордера не действуют" : "«Иджис» уничтожен", z.alive ? "warn" : "ok"); }
  if (has("dive") || has("subvariant")) dive();
  if (has("antisubship")) add("ПЛО: видит погружённые подлодки в своей зоне и бьёт их G-G 5", "info");
  if (has("fast")) add("В конце раунда может сместиться на соседний морской участок", "info");
  if (has("landing")) add("Высадка у берега: два действия", "info");
  if (has("convoyship")) add("Груз: если судно тонет, груз потерян", "info");

  // ---------- техника ----------
  if (has("mobile")) add("Подвижная: в конце раунда может сместиться на соседний участок", "info");
  if (has("ambush")) {
    const shot = unitFlag(actor, "launch", {})?.ambush, open = shot !== undefined && shot !== null && round && round - shot <= 1;
    add(open ? "Раскрыта: до конца следующего раунда захват только из её зоны, пушкой можно" : "В засаде: не видна, захватить нельзя", open ? "warn" : "info",
      { attrs: `data-u-launch="ambush"`, label: "Выстрелила" });
  }
  if (has("battery")) {
    const n = unitFlag(actor, "guns", 3);
    add(`Батарея: орудий ${n}, урон залпа ${n > 1 ? `+${n - 1}` : "без прибавки"}`, "info", { attrs: `data-u-count="guns"`, label: "±", count: n });
  }
  if (has("barrage")) add("Залп: действием накрывает соседний участок, атака 7 против Occlusion каждой наземной цели", "info");
  if (has("towed")) add("Буксируемая: сменить позицию — тягач и целый раунд без стрельбы", "info");
  if (has("scoot")) add("После залпа в том же раунде может сместиться на соседний участок", "info");
  if (has("radar")) add("Наведение: ЗРК своей стороны в соседних участках +1 к G-A", "info");
  if (has("jammer")) add("Помехи на две зоны: союзники там скрыты, +2 к Defense, захват только из той же зоны", "info");
  if (has("longsam")) add("Большая дальность: захват на две зоны", "info");
  if (has("shortsam")) add("Малая дальность: только своя зона, только Низкая и Средняя", "info");
  if (has("convoy")) add("Колонна: каждая уехавшая с карты машина засчитывается противнику", "info");
  return out;
}

function launcher(actor, round, add, re, key, n, what, sub) {
  const z = sysCount(actor, re), t = every(actor, key, n, round);
  if (!z.total) return;
  add(!z.alive ? `${what}: уничтожено` : sub ? `${what}: только на поверхности` : ready(t, what), z.alive && !sub && t.ready ? "warn" : "info",
    z.alive && !sub ? { attrs: `data-u-launch="${key}"`, label: "Выпустили" } : null);
}

/** Всё, что показывает панель цели, без разметки (для тестов). */
export function unitData(actor) {
  const s = actor.system, kind = unitKind(actor), tok = tokenOf(actor);
  const round = game.combat?.started ? game.combat.round : 0;
  const c = combatantOf(actor, tok), spent = c ? spentOf(c) : null;
  const target = s.lockUuid ? resolveActor(s.lockUuid) : null, tTok = tokenOf(target);
  const dist = target && tok ? zoneDistance(tok, tTok) : null;
  const alt = tok ? altOf(tok, actor) : s.alt;
  const fly = flyingBoss(actor);
  const systems = (s.systems ?? []).map((y, i) => ({ i, name: y.name, note: y.note ?? "", occ: y.occ, value: Math.max(0, y.value), hp: y.hp,
    ga: y.ga, gg: y.gg, gun: y.gun, dead: y.value <= 0, role: roleOf(y) }));
  const g = s.ground ?? {};
  const mech = mechanics(actor, round);
  return {
    kind, kindLabel: KIND_LABEL[kind] ?? "", name: tok?.name ?? actor.name, cls: s.cls || TB.npcKinds?.[s.kind] || "",
    hp: s.hp, systems, round, mech,
    ground: kind === "ground" ? { occ: g.occ, ga: g.ga, gg: g.gg, gun: g.gun, strafe: g.strafe } : null,
    canSam: kind === "ground" ? !!(g.ga || g.gg) : systems.some(y => (y.ga || y.gg) && !y.dead),
    canGun: kind === "ground" && !!g.gun, indirect: hasRule(actor, "indirect"),
    alt: TB.altitudes?.[alt] ?? alt ?? "", altKey: alt, alts: fly ? fly.slice().reverse() : null,
    scales: scalesOf(actor).map(k => ({ key: k, label: SCALES[k].label, max: SCALES[k].max, value: scaleValue(actor, k), down: SCALES[k].step < 0,
      full: scaleFull(k, scaleValue(actor, k)), fullText: SCALES[k].full, paused: SCALES[k].when ? !SCALES[k].when(actor) : false })),
    strikes: strikesOf(actor).map(k => ({ key: k, label: STRIKES[k].label })),
    lock: s.lockUuid || s.lock ? { name: target?.token?.name ?? tTok?.name ?? target?.name ?? s.lock, gone: !tTok,
      dist: dist === null ? "" : dist === 0 ? "своя зона" : `${dist} ${dist === 1 ? "зона" : dist < 5 ? "зоны" : "зон"}` } : null,
    acts: c ? { declared: declaredOf(c), used: spent.used, rolled: spent.rolled, list: spent.list, turn: c.parent.combatant?.id === c.id } : null,
    alerts: mech.filter(m => m.tone === "bad").map(m => m.text).concat(scalesOf(actor).filter(k => scaleFull(k, scaleValue(actor, k))).map(k => `${SCALES[k].label}: ${SCALES[k].full}`))
  };
}

/** Деления HP: при большом запасе — полоса. */
function hpBar(hp) {
  const max = Math.max(1, hp.max ?? 0), v = Math.max(0, hp.value ?? 0);
  if (max <= 12) return `<span class="tb-hud-pips hp ${v <= 1 ? "low" : ""}">${Array.from({ length: max }, (_, i) => `<i class="${i < v ? "on" : ""}"></i>`).join("")}</span>`;
  return `<span class="tb-unit-bar ${v / max <= .25 ? "low" : ""}"><i style="width:${Math.round(100 * v / max)}%"></i></span>`;
}

function tile(y, owner) {
  const pips = Array.from({ length: Math.min(y.hp, 10) }, (_, k) => `<i class="${k < y.value ? "on" : ""}"></i>`).join("");
  const arms = [y.ga ? `G-A ${y.ga}` : "", y.gg ? `G-G ${y.gg}` : "", y.gun ? `Gun ${y.gun}` : ""].filter(Boolean).join(" · ");
  return `<div class="tb-sys-tile ${y.role} ${y.dead ? "dead" : ""}" title="${esc(y.name)}${y.note ? `: ${esc(y.note)}` : ""}">
      <div class="tb-sys-top"><span class="tb-sys-name">${esc(y.name)}</span>
        ${!y.dead && (y.ga || y.gg) ? `<a data-u-sam="${y.i}" title="Пуск ракеты (${y.ga ? `по воздуху G-A ${y.ga}` : ""}${y.ga && y.gg ? ", " : ""}${y.gg ? `по земле и морю G-G ${y.gg}` : ""})">ПУСК</a>` : ""}
        ${!y.dead && y.gun ? `<a data-u-gun="${y.i}" title="Огонь: Gun ${y.gun}">ОГОНЬ</a>` : ""}</div>
      <div class="tb-sys-row"><span class="tb-sys-pips">${pips}</span><em>${y.value}/${y.hp}</em>
        ${owner ? `<a data-u-hp="${y.i}:-1" title="Снять 1 HP">−</a><a data-u-hp="${y.i}:1" title="Вернуть 1 HP">+</a>` : ""}</div>
      <div class="tb-sys-row tb-sys-stats"><span>Occ ${y.occ}</span>${arms ? `<span>${arms}</span>` : ""}</div>
    </div>`;
}

function scaleRow(sc) {
  const pips = Array.from({ length: sc.max }, (_, k) => `<i class="${k < sc.value ? "on" : ""}" data-u-scale="${sc.key}:${k + 1 === sc.value ? k : k + 1}" title="Поставить ${k + 1 === sc.value ? k : k + 1}"></i>`).join("");
  return `<div class="tb-unit-scale ${sc.full ? "full" : ""} ${sc.paused ? "paused" : ""}" title="${sc.down ? "Отсчёт: −1 в конце каждого раунда" : "+1 в конце каждого раунда"}${sc.paused ? " (сейчас стоит: условие не выполнено)" : ""}. В конце: ${esc(sc.fullText)}">
      <small>${esc(sc.label)}</small><span class="tb-unit-pips">${pips}</span><b>${sc.value}${sc.down ? "" : `/${sc.max}`}</b></div>`;
}

/** Разметка панели цели. */
export function unitHtml(actor, folded = false) {
  const d = unitData(actor), owner = actor.isOwner;
  const actBoxes = d.acts && d.acts.declared !== null
    ? Array.from({ length: Math.max(d.acts.declared, d.acts.used) }, (_, i) => `<span class="${i < d.acts.used ? "used" : ""}" title="${esc(d.acts.list[i] ?? "")}">${esc(d.acts.list[i]?.replace(/ \(заодно\)$/, "") ?? String(i + 1))}</span>`).join("")
    : `<span class="tb-hud-none">${d.acts ? "заявки ещё нет" : "вне боя"}</span>`;
  const mech = d.mech.map(m => `<li class="${m.tone}"><span>${esc(m.text)}</span>${m.btn && owner ? (m.btn.count !== undefined
    ? `<span class="tb-unit-count"><a ${m.btn.attrs.replace(/"$/, ":-1\"")}>−</a><a ${m.btn.attrs.replace(/"$/, ":1\"")}>+</a></span>` : `<a class="tb-unit-btn" ${m.btn.attrs}>${esc(m.btn.label)}</a>`) : ""}</li>`).join("");
  const g = d.ground;
  return `<header data-hud-fold title="Тащите шапку, чтобы передвинуть панель; щелчок сворачивает. Размер — за правый нижний угол">
      <span class="tb-unit-kind ${d.kind}">${esc(d.kindLabel)}</span><b>${esc(d.name)}</b> <small>${esc(d.cls)}</small>
      ${d.acts?.turn ? `<span class="tb-hud-turn">ХОД</span>` : ""}
      ${hlSwitch()}
      <a class="tb-hud-dock" data-hud-dock title="Вернуть панель на место над панелью макросов и к обычному размеру"><i class="fas fa-thumbtack"></i></a>
      <i class="fas fa-chevron-${folded ? "up" : "down"}"></i>
    </header>
    ${d.alerts.map(a => `<div class="tb-hud-alert unit"><span>▲</span><small>${esc(a)}</small></div>`).join("")}
    ${folded ? "" : `<div class="tb-unit-grid ${d.kind}">
      <div class="tb-hud-col tb-hud-stat">
        <div class="tb-hud-row"><small>HP</small>${hpBar(d.hp)}<span class="tb-hud-num">${d.hp.value}/${d.hp.max}</span></div>
        ${g ? `<div class="tb-hud-row"><small>OCC</small><span class="tb-hud-def">${g.occ ?? "—"}</span></div>
          <div class="tb-hud-row tb-unit-stats">${g.ga ? `<span>G-A <b>${g.ga}</b></span>` : ""}${g.gg ? `<span>G-G <b>${g.gg}</b></span>` : ""}${g.gun ? `<span>Gun <b>${g.gun}</b></span><span>Strafe <b>${g.strafe >= 0 ? "+" : ""}${g.strafe}</b></span>` : ""}</div>` : ""}
        ${d.alts ? `<div class="tb-hud-row"><small>ВЫСОТА</small><span>${esc(d.alt)}</span><a class="tb-hud-altbtn" data-hud-alt="1" title="Набрать высоту">▲</a><a class="tb-hud-altbtn" data-hud-alt="-1" title="Снизиться">▼</a></div>` : ""}
        <div class="tb-hud-row"><small>ЗАХВАТ</small>${d.lock ? `<a class="tb-hud-lock ${d.lock.gone ? "gone" : ""}" data-hud-lock title="Показать цель на карте"><i class="fas fa-crosshairs"></i> ${esc(d.lock.name)}${d.lock.dist ? ` · ${d.lock.dist}` : ""}</a>` : `<span class="tb-hud-none">нет</span>`}</div>
      </div>
      ${d.systems.length ? `<div class="tb-hud-col tb-unit-sys">${d.systems.map(y => tile(y, owner)).join("")}</div>` : ""}
      <div class="tb-hud-col tb-unit-mech">
        ${d.scales.map(scaleRow).join("")}
        ${mech ? `<ul>${mech}</ul>` : ""}
        ${d.strikes.length ? `<div class="tb-unit-strikes">${d.strikes.map(s => `<button type="button" class="tb-unit-strike" data-u-strike="${s.key}" title="Отметить зоны удара: сработает в конце раунда"><i class="fas fa-explosion"></i> ${esc(s.label)}</button>`).join("")}</div>` : ""}
      </div>
      <div class="tb-hud-col tb-hud-ctl">
        <div class="tb-hud-btns">
          ${d.canSam ? `<button type="button" data-hud-act="lock"><i class="fas fa-crosshairs"></i> Lock On</button>` : ""}
          ${d.kind === "ground" && d.canSam ? `<button type="button" class="wpn" data-u-sam="" title="${g.ga ? `По воздуху G-A ${g.ga}` : ""}${g.ga && g.gg ? ", " : ""}${g.gg ? `по земле и морю G-G ${g.gg}` : ""}"><i class="fas fa-rocket"></i> Пуск</button>` : ""}
          ${d.canGun ? `<button type="button" class="wpn" data-u-gun="" title="Gun ${g.gun}, Strafe ${g.strafe}"><i class="fas fa-burst"></i> Огонь</button>` : ""}
          ${d.indirect ? `<button type="button" class="wpn" data-u-strike="indirect" title="Отметить участок: удар в конце раунда"><i class="fas fa-explosion"></i> Навесной огонь</button>` : ""}
        </div>
        <div class="tb-hud-btns tb-hud-acts" title="Действия хода${d.acts?.rolled ? " · бросок уже был" : ""}"><small>ХОД</small>${actBoxes}${d.acts?.rolled ? `<i class="fas fa-dice-d10" title="Бросок за ход уже был"></i>` : ""}<button type="button" data-hud-act="end" class="end">Конец хода</button></div>
        ${adviceRow(actor)}
      </div>
    </div>`}`;
}

/** Действие NPC с учётом хода, как кнопки листа. */
async function act(actor, what, rolled, fn) {
  if (!allowAction(actor, what, { rolled })) return;
  const r = await fn();
  if (r?.documentName === "ChatMessage") await spendAction(actor, what, { rolled });
  return r;
}

/** Щелчок по панели цели: true, если разобран здесь. */
export async function onUnitClick(t, actor) {
  const d = t.dataset;
  if (d.uSam !== undefined) { await act(actor, "sam", false, () => d.uSam === "" ? actor.fireSam() : actor.fireSam(Number(d.uSam))); return true; }
  if (d.uGun !== undefined) { await act(actor, "guns", true, () => d.uGun === "" ? actor.fireGuns() : actor.fireGuns({ system: Number(d.uGun) })); return true; }
  if (d.uHp) {
    const [i, delta] = d.uHp.split(":").map(Number), list = foundry.utils.deepClone(actor.system.systems);
    if (!list[i]) return true;
    list[i].value = Math.max(0, Math.min(list[i].hp, list[i].value + delta));
    await actor.update({ "system.systems": list });
    return true;
  }
  if (d.uScale) { const [k, v] = d.uScale.split(":"); await setScale(actor, k, Number(v)); return true; }
  if (d.uFlag) { await actor.update({ [`flags.${SYSTEM_ID}.unit.${d.uFlag}`]: !unitFlag(actor, d.uFlag) }); return true; }
  if (d.uCount) {
    const [k, delta] = d.uCount.split(":"), dflt = k === "guns" ? 3 : 0;
    await actor.update({ [`flags.${SYSTEM_ID}.unit.${k}`]: Math.max(0, unitFlag(actor, k, dflt) + Number(delta)) });
    return true;
  }
  if (d.uLaunch) {
    const round = game.combat?.started ? game.combat.round : null;
    if (round === null) return ui.notifications.warn("Отметка ставится в идущем бою."), true;
    await actor.update({ [`flags.${SYSTEM_ID}.unit.launch.${d.uLaunch}`]: round });
    return true;
  }
  if (d.uStrike) {
    if (!game.user.isGM) return ui.notifications.warn("Удары по площади отмечает ведущий."), true;
    const { markStrike } = await import("./strikes.mjs");
    await markStrike(null, { source: actor.uuid, kind: d.uStrike });
    return true;
  }
  return false;
}

/** Ведущий двигает воздушный или сухопутный корабль по карте в бою: смещение засчитывается само. */
export function registerUnitHud() {
  Hooks.on("updateToken", (doc, ch) => {
    if (!game.user.isGM || !game.combat?.started || !("x" in ch || "y" in ch)) return;
    const a = doc.actor;
    if (a && (hasRule(a, "aerialship") || hasRule(a, "landship")) && unitFlag(a, "launch", {})?.shift !== game.combat.round)
      a.update({ [`flags.${SYSTEM_ID}.unit.launch.shift`]: game.combat.round });
  });
}

