/* Боевые триггеры: условия проверяет система, эффекты считаются сами.
   Одни работают сами (Поединок «Кодекса», «Добить», «Удар с пикирования», «Огонь из всех стволов», «Общая частота» и т. п.),
   другие предлагаются в нужный момент (окно метки урона: «Обманный манёвр»; Doom аса или дуэлянта: «Пощада»;
   окно пуска: «Форсированный выстрел»), остальные задействуются кнопкой на листе или в HUD с проверкой условия
   (Поворот, метка Structure, своя очередь хода, подходящая цель).
   General и Twist — раз за вылет (отметка «исп.»), Twist только после Поворота. Пишет в чужих актёров и в бой ведущий:
   игроки шлют ему просьбы по сокету. */
import { SYSTEM_ID, TB } from "./config.mjs";
import { esc, resolveActor } from "./utils.mjs";
import { sideOf, tokenOf, zoneDistance, ALT_ORDER, hasRule } from "./scene.mjs";
import { cockpitDialog } from "./aim.mjs";
import { giveNext } from "./squad.mjs";
import { isNemesisFor } from "./nemesis.mjs";

const CHANNEL = `system.${SYSTEM_ID}`;
/* Флаги пилота: ctSure — «Один на миллион» (следующий выстрел попадёт), ctFired — уже атаковал в этом вылете,
   ctDove — снизился в этот ход, ctAdvEv — «Продвинутое уклонение» в этом раунде, ctLimiter — ограничитель снят в этом ходу,
   ctGuns — последняя проверка Strafe для серии, ctBypass — какая сломанная система снова работает,
   ctCover — чужой навык от «Прикрываю», ctGuard — кого прикрывает «Рядом с тобой», ctBill — виновный «Счёта к оплате», ctRear — «Арьергард».
   У NPC: ctWeak — «Уязвимость» (вся цель или система), ctTurn — «Свои среди чужих» (прежняя сторона).
   У боя: ctAtk — кто кого атаковал по раундам, ctFreq — «Общая частота» в раунде, ctTrash — «Трёп в эфире» по раундам. */
const F = {
  sure: "ctSure", fired: "ctFired", dove: "ctDove", advev: "ctAdvEv", limiter: "ctLimiter", guns: "ctGuns", bypass: "ctBypass",
  cover: "ctCover", guard: "ctGuard", bill: "ctBill", rear: "ctRear", weak: "ctWeak", turn: "ctTurn", atk: "ctAtk", freq: "ctFreq", trash: "ctTrash", follow: "ctFollow"
};

/**
 * Боевые триггеры по ключам. use — подпись кнопки «задействовать» (нет — работает сам), action — тратит действие хода,
 * twist — только после Поворота, once — раз за вылет (General, Twist), fx — подсказка, что делает.
 */
export const CT = {
  million: { use: "Задействовать", once: true, fx: "следующий выстрел попадает; уже промахнувшийся — кнопкой на карточке" },
  skies: { use: "Сбить", once: true, action: true, fx: "действием сбить вражеского конскрипта или дуэлянта, он не вернётся" },
  fakeout: { once: true, fx: "предлагается сам в окне метки урона: отменить попадание" },
  mercy: { once: true, fx: "предлагается сам, когда ваша атака заставит аса или дуэлянта отметить Doom" },
  overcharge: { once: true, fx: "переключатель в окне пуска спецоружия: +2 к атаке и урону, потом это оружие не работает" },
  bypass: { use: "Починить", once: true, action: true, fx: "действием вернуть в строй систему, сломанную меткой Structure" },
  weakspot: { use: "Назвать цель", once: true, twist: true, fx: "Defense или Occlusion цели −2 для всей эскадрильи до конца вылета" },
  oldfriends: { use: "Вызвать звено", once: true, fx: "наёмное звено: 5 урона цели без броска, плата −1 Гонорар" },
  trash: { use: "Трёп в эфире", action: true, fx: "Complication 1–2 у всех врагов, пока каждый ход тратите на это действие" },
  nicejob: { fx: "союзник сбил врага: +1 к его следующему броску, само" },
  sharedfreq: { fx: "раз за раунд союзник под ракетой получает +1 к Break!, само; захваты союзников видны всегда" },
  nomarks: { fx: "конскрипты не выбирают вас целью, пока вы не атаковали первым или не начался Поворот" },
  rearguard: { use: "Прикрыть отход", once: true, twist: true, fx: "конскрипты и дуэлянты атакуют только вас" },
  formup: { use: "Сомкнуть строй", once: true, twist: true, fx: "эскадрилья вплотную к вам и + ваш Lead к следующему броску" },
  shotfirst: { use: "Выстрелить первым", once: true, twist: true, fx: "лишний ход перед первым раундом после Поворота" },
  gotsix: { use: "Прикрыть союзника", once: true, fx: "союзник берёт ваш навык вместо своего, пока вы в одной зоне" },
  turncoat: { use: "Переманить", once: true, twist: true, fx: "вражеский конскрипт или дуэлянт переходит на вашу сторону до конца вылета" },
  noborders: { use: "Без границ", action: true, fx: "действием Lead против 7 (дуэлянт против 9): враг выходит из боя" },
  code: { use: "Нарушил кодекс", fx: "Поединок считается сам: +1 к атакам по нему и к Evasion против него" },
  gauntlet: { use: "Бросить перчатку", once: true, twist: true, fx: "Поединок +2 до конца вылета, кодекс не действует" },
  wreath: { use: "Первый бой с ней", once: true, fx: "Поединок +2 против Немезиды в первом бою с ней" },
  oldschool: { fx: "Guns по цели Поединка: +2 урона, само" },
  finish: { fx: "+1 к атакам по цели, которая в этом вылете отметила метку урона, само" },
  bill: { use: "Назвать виновного", fx: "+2 к атакам по виновному, за его гибель +2 Гонорара сверх лимита" },
  byside: { use: "Назвать союзника", fx: "+1 к атакам по тому, кто держит его на захвате; удар по нему можно принять на себя" },
  cutchatter: { twist: true, toggle: true, fx: "переключатель работает только после Поворота" },
  tellme: { twist: true, fx: "после Поворота +1 к броску с бонусом Lead союзника, само" },
  advevasion: { use: "Уклонение", action: true, fx: "действием +2 к Dodge до конца раунда, снижение на уровень высоты" },
  divebomb: { fx: "+2 к Deploy, если в этот ход снизились на уровень, само" },
  limiter: { use: "Снять ограничитель", once: true, fx: "Max Speed +2 до конца хода, в конце хода Push против 7" },
  notatthis: { twist: true, toggle: true, fx: "переключатель работает только после Поворота" },
  guns: { fx: "серия Strafe считается сама: успех +1, промах или пропуск хода — сброс" },
  noquestions: { use: "Тяжёлое решение", life: true, fx: "тяжёлое решение или увиденное военное преступление: вместо Нервов деление на шкалу «Репутация» (6)" },
  renegotiate: { use: "Пересмотр условий", once: true, twist: true, life: true, fx: "доплата (+1 Гонорар сверх лимита, если задача выполнена) или «ухожу»: выход из зоны операции без проверок" },
  mentor: { use: "Урок", life: true, fx: "наставник и урок на вылет; выполненный урок сам отмечается в «Итогах вылета» (+1 очко). Гибель наставника меняет триггер на «Всё, чему я научился»" },
  everything: { use: "Ученик", life: true, fx: "впишите ученика; при гибели пилота кнопка в чате создаёт его новым пилотом" },
  legacy: { life: true, fx: "при гибели союзника в чате кнопка: взять его раскладку навыков, свои ранги выше остаются" },
  projlegacy: { life: true, fx: "при гибели пилота в чате кнопка: союзник навсегда получает +1 к параметру самолёта" },
  voice: { life: true, fx: "при гибели пилота в начале следующего боя ведущему приходит выбор аса или дуэлянта, который отказывается воевать или переходит к эскадрилье" },
  follow: { once: true, fx: "на карточке удачного броска кнопка «За мной!»: союзники в этом раунде могут взять тот же бросок (галочка в окне броска того же навыка)" }
};

/* ---------- мелочи ---------- */

const team = a => (sideOf(a) === "player" ? "ally" : sideOf(a));
export const enemies = (a, b) => !!a && !!b && team(a) !== team(b);
export const callsign = a => (a?.type === "pilot" ? a.system.callsign || a.name : a?.isToken ? a.token?.name ?? a.name : tokenOf(a)?.name ?? a?.name ?? "");
const dead = a => !!a?.statuses?.has?.(CONFIG.specialStatusEffects?.DEFEATED) || !!a?.system?.markers?.doom;
const same = (uuid, a) => !!uuid && !!a && (uuid === a.uuid || resolveActor(uuid) === a);
const baseId = a => (a?.isToken ? a.token?.actorId ?? a.id : a?.id);
const isLead = () => !!game.user?.isGM && (game.users?.activeGM?.isSelf ?? true);
export const trig = (a, key) => a?.items?.find?.(i => i.type === "trigger" && i.system.key === key) ?? null;
const ready = (a, key) => { const t = trig(a, key); return t && !t.system.used ? t : null; };
const on = (a, key) => !!trig(a, key)?.system.active;
const flag = (a, k) => a?.getFlag?.(SYSTEM_ID, k);
const cmb = () => (game.combat?.started ? game.combat : null);
/** Отметка «сейчас» для флагов на ход и раунд. */
const now = () => { const c = cmb(); return c ? { combat: c.id, round: c.round, turn: c.turn } : null; };
const thisRound = f => { const c = cmb(); return !!f && !!c && f.combat === c.id && f.round === c.round; };
const thisTurn = f => { const c = cmb(); return thisRound(f) && f.turn === c.turn; };
/** Вражеский «пилот» для Поединка: самолёт, а не ракета, корабль или наземка. */
const isFlier = a => a?.type === "pilot" || (a?.type === "npc" && a.system.kind === "air" && !hasRule(a, "ballistic"));
const tierOf = a => (a?.type === "npc" ? a.system.tier : "pilot");
/** Пилоты игроков в бою или на сцене (живые). */
function squad() {
  const c = cmb();
  const list = c ? c.combatants.map(x => x.actor) : (canvas?.scene?.tokens ?? []).map(t => t.actor);
  return [...new Set(list.filter(a => a?.type === "pilot" && !dead(a)))];
}

/* ---------- ведущему по сокету ---------- */

/** Сделать на клиенте того, кто наносит урон актёру: игрок-владелец в сети (у него выбор метки), иначе ведущий. */
function viaOwner(actor, op, data) {
  const user = game.users.find(u => u.active && !u.isGM && actor.testUserPermission(u, "OWNER")) ?? game.users.activeGM;
  if (!user) { ui.notifications.warn("Триггер: ни владельца, ни ведущего нет в сети."); return null; }
  if (user.isSelf ?? user.id === game.user.id) return run(op, data);
  game.socket.emit(CHANNEL, { type: "ct", op, data, to: user.id });
  return null;
}

/** Сделать на клиенте ведущего: у ведущего сразу, у игрока — просьба по сокету. */
export function gm(op, data) {
  if (game.user.isGM) return run(op, data);
  if (!game.users.activeGM) { ui.notifications.warn("Триггер: ведущего нет в сети, на чужой лист не записать."); return null; }
  game.socket.emit(CHANNEL, { type: "ct", op, data, user: game.user.id });
  return null;
}

async function run(op, d) {
  const a = d.uuid ? resolveActor(d.uuid) : null;
  const c = game.combat;
  if (op === "flag" && a) return d.value === null ? a.unsetFlag(SYSTEM_ID, d.key) : a.setFlag(SYSTEM_ID, d.key, d.value);
  if (op === "doom" && a) return a.markDoom(d.reason ?? "", { sourceUuid: d.by });
  if (op === "retreat" && a) { await a.toggleStatusEffect("retreat", { active: true }); return d.note ? say(d.note) : null; }
  if (op === "dmg" && a) return a.applyDamage(d.dmg, { source: d.source, sourceUuid: d.by || undefined, roundKey: d.round ?? undefined, system: d.sys, guard: !!d.guard });
  if (op === "side" && a) {
    await a.setFlag(SYSTEM_ID, F.turn, { was: a.system.side, by: d.by });
    return a.update({ "system.side": "ally" });
  }
  if (op === "combat" && c) {
    const cur = foundry.utils.deepClone(c.getFlag(SYSTEM_ID, d.key) ?? {});
    cur[d.id] = d.value;
    return c.setFlag(SYSTEM_ID, d.key, cur);
  }
  if (op === "end-limiter") return limiterCheck(a);
  // «Голос в эфире»: враг переходит к эскадрилье насовсем (не до конца боя, как «Свои среди чужих»)
  if (op === "defect" && a) return a.update({ "system.side": "ally" });
  // «Всё, чему я научился»: игрок без права создавать актёров просит ведущего
  if (op === "student" && a && d.name) { const { createStudent } = await import("./career-triggers.mjs"); return createStudent(a, d.name); }
  return null;
}

export function say(note, actor = null, what = "Триггер") {
  return ChatMessage.create({ speaker: actor ? ChatMessage.getSpeaker({ actor }) : { alias: "AWACS" },
    content: `<div class="tb-card tb-card-ctrig"><header class="tb-card-head"><span class="tb-card-who">${esc(actor?.name ?? "AWACS")}</span><span class="tb-card-what"><i class="fas fa-bolt"></i> ${esc(what)}</span></header><div class="tb-note">${note}</div></div>` });
}

/* ---------- состояние для листа и HUD ---------- */

/** Состояние триггера: auto (работает сам), ready, wait (условие не выполнено), on (действует), used, broken (кодекс нарушен). */
export function ctState(pilot, item) {
  const s = item.system, def = CT[s.key];
  if (!def) return null;
  if (s.key === "code") return s.used ? "broken" : "auto";
  if (!def.use) return def.twist && !pilot.system.twist ? "wait" : "auto";
  if (s.active) return "on";
  if (def.once && s.used) return "used";
  return waitReason(pilot, item) ? "wait" : "ready";
}

/** Почему сейчас нельзя задействовать, или "". */
export function waitReason(pilot, item) {
  const key = item.system.key, def = CT[key] ?? {}, s = pilot.system;
  if (def.twist && !s.twist) return "только после Поворота (отметка «Поворот» на листе)";
  if (key === "bypass" && !(s.markers.structure && s.markers.sys && !flag(pilot, F.bypass))) return "нужна метка Structure со сломанной системой";
  if (key === "advevasion" && s.alt === "low") return "ниже Низкой снижаться некуда";
  if (key === "limiter" && !cmb()) return "только в бою, в свой ход";
  if (key === "wreath" && !squadNemesis(pilot)) return "Немезиды пилота на сцене нет";
  return "";
}

export const STATE_TEXT = { auto: "работает сам", ready: "можно задействовать", wait: "условие не выполнено", on: "действует", used: "уже использован в этом вылете", broken: "кодекс нарушен: Поединок не работает до конца вылета" };

/** Для листа: подсказка и подпись кнопки. */
export function ctView(pilot, item) {
  const def = CT[item.system.key];
  if (!def) return null;
  const st = ctState(pilot, item), why = st === "wait" ? waitReason(pilot, item) : "";
  return { state: st, use: def.use ?? "", on: st === "on", waiting: st === "wait", hint: `${def.fx}. ${why || STATE_TEXT[st]}`, chip: chipOf(pilot, item) };
}

/** Что сейчас действует (подпись на листе и в HUD), или "". */
function chipOf(pilot, item) {
  const k = item.system.key;
  if (k === "guns" && item.system.stack) return `серия +${item.system.stack}`;
  if (k === "million" && flag(pilot, F.sure)) return "следующий попадёт";
  if (k === "advevasion" && thisRound(flag(pilot, F.advev))) return "Dodge +2";
  if (k === "divebomb" && thisTurn(flag(pilot, F.dove))) return "Deploy +2";
  if (k === "limiter" && item.system.active) return "Max Speed +2";
  if (k === "byside" && flag(pilot, F.guard)) return `за ${flag(pilot, F.guard).name}`;
  if (k === "bill" && flag(pilot, F.bill)) return `виновный: ${flag(pilot, F.bill).name}`;
  if (k === "rearguard" && flag(pilot, F.rear)) return "арьергард";
  if (k === "trash" && trashOn(pilot)) return "в эфире";
  if (k === "code") { const f = duelFoe(pilot); return f ? `Поединок: ${callsign(f)}` : ""; }
  if (k === "mentor") { const m = flag(pilot, "mentor"); return m?.name ? `${m.name}${m.done ? " · урок выполнен" : m.lesson ? ` · урок: ${m.lesson}` : ""}` : ""; }
  if (k === "everything") { const st = flag(pilot, "student"); return st ? `ученик: ${st}` : ""; }
  return "";
}

/* ---------- атака и защита ---------- */

const atkList = (c = cmb()) => c?.getFlag?.(SYSTEM_ID, F.atk) ?? [];

/**
 * Поединок «Кодекса»: в раунде пилот атакует только этого вражеского пилота, союзники его не атакуют и не держат в захвате.
 * Возвращает { value, label } или null. round — какой раунд смотреть (по умолчанию текущий).
 */
export function duelBonus(pilot, foe, { round } = {}) {
  const code = trig(pilot, "code");
  if (!code || !isFlier(foe) || !enemies(pilot, foe)) return null;
  const gauntlet = on(pilot, "gauntlet");
  if (code.system.used && !gauntlet) return null;
  const c = cmb(), r = round ?? c?.round;
  const list = atkList(c);
  if (c && list.some(x => same(x.by, pilot) && x.r === r && !same(x.t, foe))) return null;
  if (c && list.some(x => same(x.t, foe) && x.r === r && !same(x.by, pilot) && team(resolveActor(x.by)) === "ally")) return null;
  for (const t of canvas?.scene?.tokens ?? []) {
    const a = t.actor;
    if (!a || a === pilot || same(pilot.uuid, a) || team(a) !== "ally" || dead(a)) continue;
    if (same(a.system?.lockUuid, foe)) return null;
  }
  const wreath = on(pilot, "wreath") && isNemesisFor(foe, pilot);
  const v = gauntlet || wreath ? 2 : 1;
  return { value: v, label: `Поединок (${trig(pilot, gauntlet ? "gauntlet" : wreath ? "wreath" : "code").name})` };
}

/** С кем у пилота Поединок сейчас: единственная цель его атак в этом раунде (или в прошлом, если в этом он ещё не стрелял). */
export function duelFoe(pilot) {
  if (!trig(pilot, "code")) return null;
  const c = cmb();
  if (!c) return null;
  const list = atkList(c);
  for (const r of [c.round, c.round - 1]) {
    const mine = [...new Set(list.filter(x => same(x.by, pilot) && x.r === r).map(x => x.t))];
    if (!mine.length) continue;
    if (mine.length > 1) return null;
    const foe = resolveActor(mine[0]);
    return foe && !dead(foe) && duelBonus(pilot, foe, { round: r }) ? foe : null;
  }
  return null;
}

/**
 * Что боевые триггеры меняют в атаке: { parts, notes, problems, forceHit, dmg, take }.
 * rolled — с броском, skill — навык броска, guns — «Guns, Guns, Guns!». problems — запреты (ведущий может разрешить),
 * take() — списать разовое после выстрела.
 */
export function triggerAttack(attacker, target, { rolled = false, skill = "", guns = false } = {}) {
  const out = { parts: [], notes: [], problems: [], forceHit: false, dmg: 0, take: async () => {} };
  const ta = target?.actor ?? target;
  if (!attacker) return out;
  const later = [];
  if (attacker.type === "pilot") {
    const sure = flag(attacker, F.sure);
    if (sure && ta) {
      out.forceHit = true;
      out.notes.push(`«${trig(attacker, "million")?.name ?? "Один на миллион"}»: этот выстрел попадает.`);
      later.push(() => attacker.unsetFlag?.(SYSTEM_ID, F.sure));
    }
    if (!flag(attacker, F.fired)) later.push(() => attacker.setFlag?.(SYSTEM_ID, F.fired, true));
    if (ta && enemies(attacker, ta)) {
      const d = duelBonus(attacker, ta);
      if (d) {
        out.parts.push([d.label, d.value]);
        if (guns && trig(attacker, "oldschool")) { out.dmg += 2; out.notes.push(`«${trig(attacker, "oldschool").name}»: Guns по цели Поединка +2 урона.`); }
      } else if (trig(attacker, "code") && isFlier(ta) && !trig(attacker, "code").system.used) out.notes.push("Поединка нет: в этом раунде вы били другую цель, или союзник бьёт эту либо держит её в захвате.");
      if (trig(attacker, "finish") && (ta.system?.markerCount ?? 0) > 0) out.parts.push([trig(attacker, "finish").name, 1]);
      const bill = flag(attacker, F.bill);
      if (bill && same(bill.uuid, ta)) out.parts.push([`${trig(attacker, "bill")?.name ?? "Счёт к оплате"}: ${bill.name}`, 2]);
      const guard = flag(attacker, F.guard);
      if (rolled && guard && same(ta.system?.lockUuid, resolveActor(guard.uuid))) out.parts.push([`${trig(attacker, "byside")?.name ?? "Рядом с тобой"}: защита ${guard.name}`, 1]);
      if (rolled && skill === "deploy" && trig(attacker, "divebomb") && thisTurn(flag(attacker, F.dove))) out.parts.push([trig(attacker, "divebomb").name, 2]);
    }
  }
  // враги: «Без опознавательных знаков» и «Арьергард» запрещают выбирать цель (ведущий может разрешить)
  if (attacker.type === "npc" && ta?.type === "pilot" && enemies(attacker, ta)) {
    const tier = tierOf(attacker);
    const nm = trig(ta, "nomarks");
    if (tier === "conscript" && nm && !flag(ta, F.fired) && !ta.system.twist)
      out.problems.push(`«${nm.name}»: конскрипты не выбирают целью ${callsign(ta)}, пока он не атаковал первым или не начался Поворот.`);
    if (tier === "conscript" || tier === "duelist") {
      const rear = squad().find(p => p !== ta && !same(p.uuid, ta) && flag(p, F.rear));
      if (rear) out.problems.push(`«${trig(rear, "rearguard")?.name ?? "Арьергард"}»: конскрипты и дуэлянты атакуют только ${callsign(rear)}.`);
    }
  }
  out.take = async () => { for (const f of later) await f(); };
  return out;
}

/** «Уязвимость» цели для стрелка эскадрильи: 2 (вся цель или эта система) или 0. */
export function weakOf(attacker, target, sys = null) {
  const ta = target?.actor ?? target;
  const w = flag(ta, F.weak);
  if (!w || !attacker || team(attacker) !== "ally") return 0;
  if (w.all) return 2;
  return sys !== null && sys !== undefined && Number(w.sys) === Number(sys) ? 2 : 0;
}

/** Поправка к защите цели: Поединок (+Evasion против соперника), «Уязвимость» (−2). */
export function triggerDefense(attacker, target) {
  const ta = target?.actor ?? target;
  if (!attacker || !ta) return 0;
  let mod = -weakOf(attacker, ta) || 0;
  if (ta.type === "pilot" && trig(ta, "code")) {
    const foe = duelFoe(ta);
    if (foe && (foe === attacker || same(foe.uuid, attacker))) mod += duelBonus(ta, foe)?.value ?? 0;
  }
  return mod;
}

/** «Трёп в эфире»: этот пилот в этом или прошлом раунде тратил действие на трёп. */
export function trashOn(pilot, c = cmb()) {
  const r = c?.getFlag?.(SYSTEM_ID, F.trash)?.[baseId(pilot)];
  return !!c && Number.isFinite(r) && r >= c.round - 1;
}

/** Complication на 1–2 у врага, пока кто-то из эскадрильи треплется в эфире. */
export function trashComp(actor) {
  const c = cmb();
  if (!c || actor?.type !== "npc" || team(actor) === "ally") return false;
  return squad().some(p => trig(p, "trash") && trashOn(p, c));
}

/** Под ракетой: в воздухе есть пуск по этому актёру. */
function underMissile(actor) {
  const c = cmb();
  if (!c) return false;
  return game.messages.contents.slice(-120).some(m => {
    const card = m.getFlag?.(SYSTEM_ID, "card");
    return card?.delayed && !card.resolved && !card.dmgApplied && card.combatKey?.startsWith(`${c.id}:`) && same(card.targetUuid, actor);
  });
}

/** Что триггеры дают Break!: «Продвинутое уклонение», «Общая частота» союзника, «Скажи, что делать». { parts, take }. */
export function triggerBreak(actor, { lead = 0 } = {}) {
  const out = { parts: [], take: async () => {} };
  if (actor?.type !== "pilot") return out;
  const later = [];
  if (trig(actor, "advevasion") && thisRound(flag(actor, F.advev))) out.parts.push([trig(actor, "advevasion").name, 2]);
  if (lead > 0 && trig(actor, "tellme") && actor.system.twist) out.parts.push([trig(actor, "tellme").name, 1]);
  const c = cmb();
  if (c && underMissile(actor)) {
    const used = c.getFlag(SYSTEM_ID, F.freq) ?? {};
    const f = squad().find(p => p !== actor && !same(p.uuid, actor) && trig(p, "sharedfreq") && used[baseId(p)] !== c.round);
    if (f) {
      out.parts.push([`${trig(f, "sharedfreq").name}: ${callsign(f)}`, 1]);
      later.push(() => gm("combat", { key: F.freq, id: baseId(f), value: c.round }));
    }
  }
  out.take = async () => { for (const fn of later) await fn(); };
  return out;
}

/** «Скажи, что делать»: среди бонусов к броску есть Lead союзника — ещё +1 после Поворота. */
export function tellMe(actor, mods) {
  const t = trig(actor, "tellme");
  if (!t || !actor.system.twist || !mods.some(m => /^Lead\b/.test(m.label ?? m[0] ?? ""))) return null;
  return [t.name, 1];
}

/** «Прикрываю»: навык союзника вместо своего, пока он в одной зоне. Строка-разница для карточки или null. */
export function coverPart(actor, skill) {
  const cv = flag(actor, F.cover);
  if (!cv || cv.skill !== skill) return null;
  const by = resolveActor(cv.uuid);
  if (!by || dead(by)) return null;
  const d = zoneDistance(tokenOf(actor), tokenOf(by));
  if (d !== 0 && d !== null) return null;
  const mine = actor.system.skills?.[skill] ?? 0, theirs = by.system.skills?.[skill] ?? 0;
  return theirs > mine ? [`${cv.label}: ${TB.skills[skill]?.label ?? skill} ${callsign(by)} ${theirs}`, theirs - mine] : null;
}

/* ---------- урон: «Обманный манёвр», «Пощада», «Рядом с тобой» ---------- */

/** «Обманный манёвр», если его можно предложить в окне метки. */
export const fakeoutReady = (pilot, { guard = false } = {}) => (pilot?.type === "pilot" && !guard ? ready(pilot, "fakeout") : null);

/**
 * «Пощада»: удар заставит вражеского аса или дуэлянта отметить Doom, а у стрелка триггер не использован.
 * Спрашивает того, кто наносит урон (обычно ведущий: решение называет игрок). true — отпустили, Doom не ставить.
 */
export async function offerMercy(target, sourceUuid) {
  const by = sourceUuid ? resolveActor(sourceUuid) : null;
  const t = ready(by, "mercy");
  if (!t || target?.type !== "npc" || !["ace", "duelist"].includes(target.system.tier) || !enemies(by, target)) return false;
  const name = callsign(target), who = callsign(by);
  const r = await cockpitDialog(`${t.name} · ${name}`, `<p class="tb-hint">Атака ${esc(who)} заставляет «${esc(name)}» отметить Doom. У ${esc(who)} есть «${esc(t.name)}»: отпустить? Решает игрок.</p>
    <div class="tb-ck-fire"><button type="button" class="tb-ck-big fox" data-pick="spare"><b>ОТПУСТИТЬ</b><small>выходит из вылета</small></button><button type="button" class="tb-ck-big" data-pick="doom"><b>DOOM</b><small>сбит</small></button></div>`, { width: 440 });
  if (r?.pick !== "spare") return false;
  if (t.isOwner) await t.update({ "system.used": true });
  await target.update({ "system.hp.value": Math.max(1, target.system.hp.value) });
  await target.toggleStatusEffect("retreat", { active: true });
  await target.setFlag(SYSTEM_ID, "spared", { by: who });
  await say(`«${esc(t.name)}»: ${esc(who)} отпускает «${esc(name)}». Он выпускает шасси, отворачивает или прыгает и выбывает из вылета, «на уровень выше» в этом бою не вернётся. Как он вернёт долг, решает AWACS.`, by, t.name);
  return true;
}

/** «Рядом с тобой»: пилот, готовый принять удар по этому союзнику (в той же зоне), или null. */
export function guardOf(pilot) {
  for (const p of squad()) {
    if (p === pilot || same(p.uuid, pilot)) continue;
    const g = flag(p, F.guard);
    if (!g || !same(g.uuid, pilot) || !trig(p, "byside")) continue;
    const d = zoneDistance(tokenOf(p), tokenOf(pilot));
    if (d === 0) return p;
  }
  return null;
}

/** Предложить принять удар на себя. true — урон ушёл защитнику. */
export async function offerGuard(pilot, amount, opts) {
  if (pilot?.type !== "pilot" || opts.guard) return false;
  const g = guardOf(pilot);
  if (!g) return false;
  const t = trig(g, "byside");
  const r = await cockpitDialog(`${t.name} · ${callsign(g)}`, `<p class="tb-hint">${esc(callsign(pilot))} получает ${amount} урона. ${esc(callsign(g))} рядом («${esc(t.name)}»): принять удар на себя? Если удар заставит отметить Doom, ${esc(callsign(g))} гибнет сразу, без последних слов. Решает игрок ${esc(callsign(g))}.</p>
    <div class="tb-ck-fire"><button type="button" class="tb-ck-big fox" data-pick="take"><b>НА СЕБЯ</b><small>${esc(callsign(g))}</small></button><button type="button" class="tb-ck-big" data-pick="no"><b>НЕТ</b></button></div>`, { width: 440 });
  if (r?.pick !== "take") return false;
  await say(`${esc(callsign(g))} закрывает собой ${esc(callsign(pilot))} («${esc(t.name)}»): ${amount} урона достаются ему.`, g, t.name);
  viaOwner(g, "dmg", { uuid: g.uuid, dmg: amount, source: opts.source ?? "", by: opts.sourceUuid ?? "", round: opts.roundKey ?? null, guard: true });
  return true;
}

/* ---------- сбитые: «Отличная работа!», «Счёт к оплате» ---------- */

/** Пилот сбил врага (клиент, который нанёс урон). */
export async function afterKill(victim, shooter) {
  if (shooter?.type !== "pilot" || !enemies(shooter, victim)) return;
  for (const p of squad()) {
    if (p === shooter || same(p.uuid, shooter)) continue;
    const t = trig(p, "nicejob");
    if (!t) continue;
    await giveNext(shooter, { label: `${t.name} (${callsign(p)})`, value: 1 });
    await say(`${esc(callsign(p))}: «Отличная работа, ${esc(callsign(shooter))}!» +1 к его следующему броску.`, p, t.name);
  }
}

/** Сбит виновный «Счёта к оплате»: +2 Гонорара сверх лимита, отметка снимается. Вызывается на любом сбитом. */
export async function billPaid(victim) {
  for (const p of game.actors?.contents ?? [...(game.actors ?? [])]) {
    const b = p.type === "pilot" ? flag(p, F.bill) : null;
    if (!b || !(same(b.uuid, victim) || (b.base && b.base === baseId(victim) && !victim.isToken))) continue;
    const fee = (p.system.fee ?? 0) + 2;
    if (p.isOwner) await p.update({ "system.fee": Math.min(5, fee), [`flags.${SYSTEM_ID}.-=${F.bill}`]: null });
    else gm("flag", { uuid: p.uuid, key: F.bill, value: null });
    await say(`«${esc(trig(p, "bill")?.name ?? "Счёт к оплате")}»: ${esc(b.name)} сбит. ${esc(callsign(p))} получает +2 Гонорара сверх лимита.`, p, "Счёт к оплате");
  }
}

/* ---------- «Задействовать» ---------- */

/** Выбрать токен на сцене с проверкой. ok(actor) — "" или почему нельзя. */
export async function pickToken(pilot, title, ok) {
  const { pickTargetToken } = await import("./pick.mjs");
  const tok = await pickTargetToken(pilot, { title });
  if (!tok) return null;
  const why = ok(tok.actor);
  if (why) { ui.notifications.warn(`${title}: ${why}`); return null; }
  return tok;
}

const enemyFlier = (pilot, tiers) => a => {
  if (!enemies(pilot, a)) return "это не противник.";
  if (dead(a)) return "цель уже сбита.";
  if (a.type !== "npc" || a.system.kind !== "air") return "нужен вражеский самолёт.";
  if (!tiers.includes(a.system.tier)) return `только ${tiers.map(t => ({ conscript: "конскрипт", duelist: "дуэлянт", ace: "ас" }[t])).join(" или ")}.`;
  return "";
};

/** Тратит ли действие и можно ли сейчас: проверка хода (в бою). */
async function spend(pilot, label, { rolled = false } = {}) {
  const { actionProblem, spendAction } = await import("./actions.mjs");
  const p = actionProblem(pilot, label, { rolled });
  if (p) { ui.notifications.warn(p); return false; }
  return () => spendAction(pilot, label, { rolled });
}

/** Союзник-пилот для «Прикрываю», «Рядом с тобой»: окно со списком. */
export async function pickAlly(pilot, title, intro) {
  const list = (game.actors?.contents ?? [...(game.actors ?? [])]).filter(a => a.type === "pilot" && a.id !== pilot.id && a.hasPlayerOwner);
  if (!list.length) { ui.notifications.warn(`${title}: других пилотов нет.`); return null; }
  const r = await cockpitDialog(title, `<p class="tb-hint">${intro}</p><div class="tb-ck-fire tb-ct-pick">${list.map(a => `<button type="button" class="tb-ck-big" data-pick="${a.id}"><b>${esc(callsign(a))}</b><small>${esc(a.name)}</small></button>`).join("")}</div>`, { width: 460 });
  return r ? list.find(a => a.id === r.pick) ?? null : null;
}

/** Немезида пилота на сцене (для «Венка над морем»). */
function squadNemesis(pilot) {
  return (canvas?.scene?.tokens ?? []).map(t => t.actor).find(a => a && isNemesisFor(a, pilot) && !dead(a)) ?? null;
}

/**
 * Кнопка «задействовать» на листе или в HUD: проверка условия, эффект, отметка «исп.».
 */
export async function useCombatTrigger(pilot, item) {
  if (!pilot?.isOwner || !item) return null;
  const key = item.system.key, def = CT[key];
  if (!def?.use) return null;
  const name = item.name, who = callsign(pilot);
  if (key === "code") {
    if (item.system.used) return item.update({ "system.used": false });
    if (!(await Dialog.confirm({ title: name, content: `<p>${esc(who)} нарушил кодекс? Поединок не работает до конца вылета, на разборе +1 Нервы.</p>` }))) return null;
    await item.update({ "system.used": true });
    return say(`${esc(who)} нарушил кодекс: Поединок не работает до конца вылета. На разборе +1 Нервы.`, pilot, name);
  }
  if (def.once && item.system.used) return ui.notifications.warn(`«${name}» в этом вылете уже использован.`);
  const why = waitReason(pilot, item);
  if (why) return ui.notifications.warn(`«${name}»: ${why}.`);
  const once = () => (def.once ? item.update({ "system.used": true }) : null);
  if (def.life) return (await import("./career-triggers.mjs")).useLifeTrigger(pilot, item);

  switch (key) {
    case "million": {
      await once();
      await pilot.setFlag(SYSTEM_ID, F.sure, true);
      return say(`${esc(who)}: «${esc(name)}». Следующий выстрел попадает. Уже промахнувшийся выстрел можно сделать попаданием кнопкой на его карточке.`, pilot, name);
    }
    case "skies": {
      const pay = await spend(pilot, name);
      if (!pay) return null;
      const tok = await pickToken(pilot, name, enemyFlier(pilot, ["conscript", "duelist"]));
      if (!tok) return null;
      await pay(); await once();
      gm("doom", { uuid: tok.actor.uuid, by: pilot.uuid, reason: `«${name}»: ${who}` });
      gm("flag", { uuid: tok.actor.uuid, key: "skies", value: { by: who } });
      return say(`${esc(who)}: «${esc(name)}». «${esc(tok.name)}» сбит действием и больше никогда не вернётся.`, pilot, name);
    }
    case "bypass": {
      const pay = await spend(pilot, name);
      if (!pay) return null;
      const sys = pilot.system.markers.sys, label = TB.systems[sys]?.label ?? sys;
      await pay(); await once();
      await pilot.setFlag(SYSTEM_ID, F.bypass, sys);
      return say(`${esc(who)}: «${esc(name)}». «${esc(label)}» снова работает, метка Structure остаётся отмеченной.`, pilot, name);
    }
    case "weakspot": {
      const tok = await pickToken(pilot, name, a => (enemies(pilot, a) ? (dead(a) ? "цель уже уничтожена." : "") : "это не противник."));
      if (!tok) return null;
      const a = tok.actor, systems = a.system.systems ?? [];
      let value = { all: true, by: who };
      if (systems.length) {
        const r = await cockpitDialog(`${name} · ${tok.name}`, `<p class="tb-hint">AWACS называет систему: её Occlusion −2 для всей эскадрильи до конца вылета.</p>
          <div class="tb-ck-fire tb-ct-pick">${systems.map((y, i) => `<button type="button" class="tb-ck-big" data-pick="${i}" ${y.value > 0 ? "" : "disabled"}><b>${esc(y.name)}</b><small>Occ ${y.occ} → ${y.occ - 2}</small></button>`).join("")}</div>`, { width: 480 });
        if (!r) return null;
        value = { sys: Number(r.pick), name: systems[Number(r.pick)]?.name ?? "", by: who };
      }
      await once();
      gm("flag", { uuid: a.uuid, key: F.weak, value });
      return say(`${esc(who)}: «${esc(name)}». ${value.all ? `Защита «${esc(tok.name)}»` : `Occlusion «${esc(value.name)}» (${esc(tok.name)})`} −2 для всей эскадрильи до конца вылета.`, pilot, name);
    }
    case "oldfriends": {
      const tok = await pickToken(pilot, name, a => (enemies(pilot, a) ? (dead(a) ? "цель уже уничтожена." : "") : "это не противник."));
      if (!tok) return null;
      await once();
      const fee = pilot.system.fee ?? 0;
      if (fee > 0) await pilot.update({ "system.fee": fee - 1 });
      else await reputation(pilot);
      await say(`${esc(who)} вызывает старых знакомых («${esc(name)}»): наёмное звено проходит через зону операции и бьёт «${esc(tok.name)}», 5 урона без броска. ${fee > 0 ? "Плата: −1 Гонорар." : "Гонорара нет: +1 на шкалу «Репутация»."}`, pilot, name);
      return viaOwner(tok.actor, "dmg", { uuid: tok.actor.uuid, dmg: 5, source: "Наёмное звено" });
    }
    case "trash": {
      const c = cmb();
      if (!c) return ui.notifications.warn(`«${name}»: только в бою.`);
      const pay = await spend(pilot, name);
      if (!pay) return null;
      await pay(); await once();
      gm("combat", { key: F.trash, id: baseId(pilot), value: c.round });
      const { sendRadio } = await import("./radio.mjs");
      await sendRadio({ speaker: who, text: "Эй, на той стороне! Вас там собирали по объявлению?", side: "ally" });
      return say(`${esc(who)} треплется на открытой частоте («${esc(name)}»): все враги получают Complication на 1–2. Держится, пока каждый ход тратите на это действие.`, pilot, name);
    }
    case "rearguard": {
      await once();
      await pilot.setFlag(SYSTEM_ID, F.rear, true);
      return say(`${esc(who)}: «${esc(name)}». Все конскрипты и дуэлянты атакуют только ${esc(who)}, пока он не покинет зону операции.`, pilot, name);
    }
    case "formup": {
      await once();
      const lead = pilot.system.skillTotal?.lead ?? pilot.system.skills?.lead ?? 0;
      const mates = squad().filter(p => p !== pilot && !same(p.uuid, pilot));
      for (const p of mates) if (lead > 0) await giveNext(p, { label: `Lead ${callsign(pilot)} (${name})`, value: lead });
      return say(`${esc(who)}: «${esc(name)}». Эскадрилья начинает следующий раунд вплотную к ${esc(who)}${lead > 0 ? ` и прибавляет его Lead (+${lead}) к следующему броску: ${mates.map(p => esc(callsign(p))).join(", ") || "некому"}` : ""}. Поставьте токены рядом.`, pilot, name);
    }
    case "shotfirst": {
      await once();
      return say(`${esc(who)}: «${esc(name)}». Подкрепление прибыло, а ${esc(who)} ломает порядок ходов: один дополнительный ход перед первым раундом после Поворота. Ведущий даёт ему ход сейчас.`, pilot, name);
    }
    case "gotsix": {
      const ally = await pickAlly(pilot, name, "Кого прикрываете? Он временно берёт ваш навык вместо своего, пока вы в одной зоне.");
      if (!ally) return null;
      const r = await cockpitDialog(`${name} · ${callsign(ally)}`, `<p class="tb-hint">Какой навык ${esc(callsign(ally))} заменить вашим?</p>
        <div class="tb-ck-fire tb-ct-pick">${Object.entries(TB.skills).map(([k, sk]) => `<button type="button" class="tb-ck-big" data-pick="${k}" ${(pilot.system.skills[k] ?? 0) > (ally.system.skills?.[k] ?? 0) ? "" : "disabled"}><b>${esc(sk.label)}</b><small>${ally.system.skills?.[k] ?? 0} → ${pilot.system.skills[k] ?? 0}</small></button>`).join("")}</div>`, { width: 480 });
      if (!r) return null;
      await once();
      const value = { uuid: pilot.uuid, skill: r.pick, label: name };
      if (ally.isOwner) await ally.setFlag(SYSTEM_ID, F.cover, value);
      else gm("flag", { uuid: ally.uuid, key: F.cover, value });
      return say(`${esc(who)} прикрывает ${esc(callsign(ally))} («${esc(name)}»): ${esc(TB.skills[r.pick].label)} ${pilot.system.skills[r.pick]} вместо ${ally.system.skills?.[r.pick] ?? 0}, пока они в одной зоне.`, pilot, name);
    }
    case "turncoat": {
      const tok = await pickToken(pilot, name, enemyFlier(pilot, ["conscript", "duelist"]));
      if (!tok) return null;
      await once();
      gm("side", { uuid: tok.actor.uuid, by: who });
      return say(`${esc(who)}: «${esc(name)}». «${esc(tok.name)}» переходит на сторону эскадрильи до конца вылета. Им управляет AWACS, но он выполняет команды Leadership ${esc(who)}.`, pilot, name);
    }
    case "noborders": {
      const tok = await pickToken(pilot, name, a => {
        if (a.type === "npc" && a.system.tier === "ace") return "аса так не уговорить: нужен другой триггер.";
        return enemyFlier(pilot, ["conscript", "duelist"])(a);
      });
      if (!tok) return null;
      const dc = tok.actor.system.tier === "duelist" ? 9 : 7;
      if (pilot.system.skillBlocked?.lead) return ui.notifications.warn("Lead недоступен: метка Grit.");
      const pay = await spend(pilot, name, { rolled: true });
      if (!pay) return null;
      const { rollSideCheck } = await import("./dice/rolls.mjs");
      const msg = await rollSideCheck(pilot, "lead", { dc, label: `${name}: Lead против ${dc}`, turnRoll: true,
        notes: [`По открытому каналу. Успех: «${tok.name}» выходит из боя и покидает зону операции.`], onWin: { uuid: tok.actor.uuid, name: tok.name } });
      if (msg) await pay();
      return msg;
    }
    case "gauntlet":
    case "wreath": {
      await item.update({ "system.used": true, "system.active": true });
      return say(key === "gauntlet"
        ? `${esc(who)} бросает перчатку («${esc(name)}»): до конца вылета кодекс не действует, бонус Поединка +2. На разборе допишите в досье, что вы сделали в этот день.`
        : `${esc(who)}: «${esc(name)}». Первый бой с Немезидой: бонус Поединка против неё +2, кодекс в этом бою можно не соблюдать.`, pilot, name);
    }
    case "bill": {
      const tok = await pickToken(pilot, name, a => (dead(a) ? "он уже мёртв." : ""));
      if (!tok) return null;
      const value = { uuid: tok.actor.uuid, base: tok.actor.isToken ? "" : tok.actor.id, name: tok.name };
      await pilot.setFlag(SYSTEM_ID, F.bill, value);
      return say(`${esc(who)} называет виновного («${esc(name)}»): ${esc(tok.name)}. Пока он жив, +2 к атакам по нему, за его гибель +2 Гонорара сверх лимита.`, pilot, name);
    }
    case "byside": {
      const ally = await pickAlly(pilot, name, "За кого вы готовы умереть? +1 к атакам по тому, кто держит его на захвате, а удар по нему в вашей зоне можно принять на себя.");
      if (!ally) return null;
      await pilot.setFlag(SYSTEM_ID, F.guard, { uuid: ally.uuid, name: callsign(ally) });
      return say(`${esc(who)} готов умереть за ${esc(callsign(ally))} («${esc(name)}»).`, pilot, name);
    }
    case "advevasion": {
      const pay = await spend(pilot, name);
      if (!pay) return null;
      const down = ALT_ORDER[Math.max(0, ALT_ORDER.indexOf(pilot.system.alt) - 1)];
      await pay();
      await pilot.update({ "system.alt": down, [`flags.${SYSTEM_ID}.${F.advev}`]: now() }, { tbFree: true });
      await pilot.syncElevation?.();
      return say(`${esc(who)}: «${esc(name)}». Снижение на ${esc(TB.altitudes[down]?.label ?? down)}, Dodge +2 до конца раунда.`, pilot, name);
    }
    case "limiter": {
      const { combatantOf } = await import("./actions.mjs");
      const cb = combatantOf(pilot);
      if (!cb || cb.parent.combatant?.id !== cb.id) return ui.notifications.warn(`«${name}»: только в свой ход.`);
      await item.update({ "system.used": true, "system.active": true });
      await pilot.setFlag(SYSTEM_ID, F.limiter, now());
      const max = pilot.system.maxSpeed;
      const r = await cockpitDialog(name, `<p class="tb-hint">Max Speed ${max} до конца хода. Поднять Speed сразу до ${max}? В конце хода Push против 7, провал: Structure (Engines) вместо урона.</p>
        <div class="tb-ck-fire"><button type="button" class="tb-ck-big fox" data-pick="max"><b>SPEED ${max}</b></button><button type="button" class="tb-ck-big" data-pick="keep"><b>КАК ЕСТЬ</b><small>Speed ${pilot.system.speed}</small></button></div>`, { width: 420 });
      if (r?.pick === "max") await pilot.update({ "system.speed": max }, { tbFree: true });
      return say(`${esc(who)}: «${esc(name)}». Max Speed +2 до конца хода${r?.pick === "max" ? `, Speed ${max}` : ""}. В конце хода Push против 7.`, pilot, name);
    }
    default: return null;
  }
}

/** Шкала «Репутация» (6) в личных целях: +1 деление. */
export async function reputation(pilot) {
  const goals = foundry.utils.deepClone(pilot.system.goals ?? []);
  const g = goals.find(x => /репутац/i.test(x.name));
  if (g) g.value = Math.min(g.size, g.value + 1);
  else goals.push({ name: "Репутация", size: 6, value: 1 });
  return pilot.update({ "system.goals": goals });
}

/** «Снять ограничитель»: конец хода — Push против 7 у владельца пилота, ограничитель снова на месте. */
async function limiterCheck(pilot) {
  if (!pilot) return null;
  const t = trig(pilot, "limiter");
  if (t?.system.active) await t.update({ "system.active": false });
  await pilot.unsetFlag(SYSTEM_ID, F.limiter);
  if (pilot.system.speed > pilot.system.maxSpeed) await pilot.update({ "system.speed": pilot.system.maxSpeed }, { tbFree: true });
  const { rollSideCheck } = await import("./dice/rolls.mjs");
  return rollSideCheck(pilot, "push", { dc: 7, label: `${t?.name ?? "Снять ограничитель"}: Push против 7`, onFail: "engines",
    notes: ["Конец хода: ограничитель снова на месте. Провал: отметьте Structure (Engines) вместо урона."] });
}

/* ---------- «Один на миллион» на карточке промаха ---------- */

/** Можно ли сделать этот промах попаданием: атака пилота с триггером, ещё не учтённая. */
export function millionFor(card) {
  if (!card?.attack || card.forceHit || card.resolved || card.dmgApplied || card.dc === null || card.dc === undefined) return null;
  const a = resolveActor(card.actorUuid);
  return a?.type === "pilot" ? ready(a, "million") : null;
}

/** «За мной!»: на карточке удачного броска пилота в бою, пока триггер не использован. */
export function followFor(card) {
  if (!card?.rolled || !card.success || !card.skill || card.follow || card.followOf || !cmb()) return null;
  const a = resolveActor(card.actorUuid);
  return a?.type === "pilot" ? ready(a, "follow") : null;
}

/** Нажали «За мной!»: бросок с карточки предлагается союзникам до конца раунда. */
export async function offerFollow(actor, card) {
  const t = followFor(card), c = cmb();
  if (!t || !c) return false;
  await t.update({ "system.used": true });
  gm("combat", { key: F.follow, id: "offer", value: { by: baseId(actor), name: callsign(actor), skill: card.skill, d10: card.d10, d4: card.d4, round: c.round } });
  const sk = TB.skills[card.skill]?.label ?? card.skill;
  await say(`${esc(callsign(actor))}: «За мной!» Союзники до конца раунда могут повторить манёвр: в окне броска «${esc(sk)}» галочка «За мной!» даёт d10 = ${card.d10}, d4 = ${card.d4}.`, actor, t.name);
  return true;
}

/** Бросок ведущего «За мной!», который этот пилот ещё может взять: { name, skill, d10, d4 } или null. */
export function followOffer(actor, skill) {
  const c = cmb(), f = c?.getFlag?.(SYSTEM_ID, F.follow);
  const o = f?.offer;
  if (!o || o.round !== c.round || o.skill !== skill || actor?.type !== "pilot" || o.by === baseId(actor) || f[baseId(actor)] === c.round) return null;
  return o;
}

/** Взять бросок «За мной!»: отметить, что этот пилот его уже использовал. */
export function takeFollow(actor) {
  const c = cmb();
  if (c) gm("combat", { key: F.follow, id: baseId(actor), value: c.round });
}

/* ---------- учёт по ходу боя ---------- */

/** Атака записана в чат (ведущий): кто кого бил в каком раунде — для Поединка. */
async function trackAttack(message) {
  const c = message.getFlag?.(SYSTEM_ID, "card");
  const combat = cmb();
  if (!combat || !c?.attack || !c.actorUuid || !c.targetUuid) return;
  const list = atkList(combat);
  if (list.some(x => x.by === c.actorUuid && x.t === c.targetUuid && x.r === combat.round)) return;
  await combat.setFlag(SYSTEM_ID, F.atk, [...list.filter(x => x.r >= combat.round - 1), { by: c.actorUuid, t: c.targetUuid, r: combat.round }]);
}

/** «Огонь из всех стволов»: проверка Strafe — серия +1 при успехе, сброс при промахе (у автора карточки). */
async function gunsStreak(message, created) {
  const c = message.getFlag?.(SYSTEM_ID, "card");
  if (!c?.rolled || c.skill !== "strafe" || c.dc === null || c.dc === undefined) return;
  const a = resolveActor(c.actorUuid), t = trig(a, "guns");
  if (!t || !a.isOwner || !message.isAuthor) return;
  const { computeCard } = await import("./dice/rolls.mjs");
  const ok = computeCard(c).success, mark = flag(a, F.guns);
  let base;
  if (created) {
    base = t.system.stack;
    const n = now();
    await a.setFlag(SYSTEM_ID, F.guns, { msg: message.id, base, round: n?.round ?? null, combat: n?.combat ?? null });
  } else if (mark?.msg === message.id) base = mark.base;
  else return;
  const stack = ok ? base + 1 : 0;
  if (stack !== t.system.stack) await t.update({ "system.stack": stack });
}

/** Конец хода (ведущий): серия Strafe без Strafe в этот ход сгорает, ограничитель — проверка Push, трёп кончается. */
async function turnEnded(combat, prev) {
  const a = prev?.actor;
  if (a?.type !== "pilot") return;
  const round = combat.previous?.round ?? combat.round;
  const g = trig(a, "guns");
  if (g?.system.stack && (flag(a, F.guns)?.round ?? -1) < round) {
    await g.update({ "system.stack": 0 });
    await say(`${esc(callsign(a))}: ход без Strafe, серия «${esc(g.name)}» сброшена.`, a, g.name);
  }
  if (trig(a, "limiter")?.system.active || thisRound(flag(a, F.limiter)) || flag(a, F.limiter)?.round === round) {
    const owner = game.users.find(u => u.active && !u.isGM && a.testUserPermission(u, "OWNER"));
    if (owner) game.socket.emit(CHANNEL, { type: "ct", op: "end-limiter", data: { uuid: a.uuid }, to: owner.id });
    else await limiterCheck(a);
  }
}

/** Снижение на уровень в бою: отметка для «Удара с пикирования». Вызывается до записи высоты. */
function markDive(actor, change) {
  const to = foundry.utils.getProperty(change, "system.alt");
  const n = now();
  if (!n || actor.type !== "pilot" || !to || !trig(actor, "divebomb")) return;
  if (ALT_ORDER.indexOf(to) < ALT_ORDER.indexOf(actor.system.alt)) foundry.utils.setProperty(change, `flags.${SYSTEM_ID}.${F.dove}`, n);
}

/** Сброс к вылету (подготовка пилота). Остаются: кого прикрывает «Рядом с тобой», виновный «Счёта к оплате». */
export async function resetCombatTriggers(pilot) {
  const keys = [F.sure, F.fired, F.dove, F.advev, F.limiter, F.guns, F.bypass, F.cover, F.rear];
  const upd = {};
  for (const k of keys) if (flag(pilot, k) !== undefined) upd[`flags.${SYSTEM_ID}.-=${k}`] = null;
  if (Object.keys(upd).length) await pilot.update(upd);
}

/** Бой кончился: «Свои среди чужих» возвращаются на свою сторону, «Уязвимость» снимается. */
async function combatOver(combat) {
  for (const t of combat.scene?.tokens ?? []) {
    const a = t.actor;
    if (!a || a.type !== "npc") continue;
    const tc = flag(a, F.turn);
    if (tc) { await a.update({ "system.side": tc.was || "enemy" }); await a.unsetFlag(SYSTEM_ID, F.turn); }
    if (flag(a, F.weak)) await a.unsetFlag(SYSTEM_ID, F.weak);
  }
}

/** Успех «Без границ»: враг выходит из боя (кнопка на карточке проверки). */
export function letGo(pilot, win) {
  return gm("retreat", { uuid: win.uuid, note: `${esc(callsign(pilot))} по открытому каналу: «${esc(win.name)}» выходит из боя и покидает зону операции.` });
}

export function registerCombatTriggers() {
  Hooks.once("ready", () => {
    game.socket.on(CHANNEL, msg => {
      if (msg?.type !== "ct") return;
      if (msg.to) { if (msg.to === game.user.id) run(msg.op, msg.data ?? {}).catch(err => console.error(`${SYSTEM_ID} | триггеры`, err)); return; }
      if (isLead()) run(msg.op, msg.data ?? {}).catch(err => console.error(`${SYSTEM_ID} | триггеры`, err));
    });
  });
  Hooks.on("createChatMessage", message => {
    if (isLead()) trackAttack(message).catch(err => console.warn(`${SYSTEM_ID} | триггеры`, err));
    gunsStreak(message, true).catch(err => console.warn(`${SYSTEM_ID} | серия Strafe`, err));
  });
  Hooks.on("updateChatMessage", message => gunsStreak(message, false).catch(err => console.warn(`${SYSTEM_ID} | серия Strafe`, err)));
  Hooks.on("preUpdateActor", (actor, change) => markDive(actor, change));
  Hooks.on("updateCombat", async (combat, change, options) => {
    const { endedTurn } = await import("./turns.mjs");
    const prev = endedTurn(combat, change, options);
    if (prev) turnEnded(combat, prev).catch(err => console.error(`${SYSTEM_ID} | триггеры`, err));
  });
  Hooks.on("deleteCombat", combat => { if (isLead()) combatOver(combat).catch(err => console.warn(`${SYSTEM_ID} | триггеры`, err)); });
}

/** Для HUD: триггеры, которые можно задействовать, и что действует. { trig: [{id, name, use}], chips: [] }. */
export function hudTriggers(pilot) {
  if (pilot?.type !== "pilot") return null;
  const trigs = [], chips = [];
  for (const t of pilot.items.filter(i => i.type === "trigger" && CT[i.system.key])) {
    const st = ctState(pilot, t), chip = chipOf(pilot, t);
    if (st === "ready" && t.system.key !== "code" && !["bill", "byside"].includes(t.system.key) && !CT[t.system.key].life) trigs.push({ id: t.id, name: t.name, hint: CT[t.system.key].fx });
    if (chip) chips.push(chip);
  }
  return trigs.length || chips.length ? { trig: trigs, chips } : null;
}
