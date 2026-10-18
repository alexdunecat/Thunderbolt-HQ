/* Наведение на систему корабля или крупной цели по схеме и окна пуска в стиле HUD.
   Схема — картинка токена цели с пронумерованными точками систем: двигатели в корме, оружие по бортам, остальное по оси.
   Ведущий перетаскивает точки на нужные места картинки, положение запоминается в флаге unit.spots актёра. */
import { SYSTEM_ID } from "./config.mjs";
import { esc } from "./utils.mjs";
import { tokenOf, zoneDistance, hasRule } from "./scene.mjs";
import { sysCount, unitFlag } from "./scales.mjs";

export const ENGINE = /двигат|сопл|ускорител/i;

/** Роль системы по имени и оружию: двигатель, оружие или прочее. */
export function roleOf(y) {
  if (ENGINE.test(y.name)) return "engine";
  if (y.ga || y.gg || y.gun || /рельсотрон|лазер|орудия|калибр|шахты|турель|пусков/i.test(y.name)) return "weapon";
  return "other";
}

const spread = (n, a, b) => n === 1 ? [(a + b) / 2] : Array.from({ length: n }, (_, k) => a + (b - a) * k / (n - 1));

/** Точки систем на схеме, в процентах картинки: { i: [x, y] }. Сохранённые ведущим точки важнее раскладки по ролям. */
export function spotsOf(actor) {
  const sys = actor?.system?.systems ?? [];
  const groups = { engine: [], weapon: [], other: [] };
  sys.forEach((y, i) => groups[roleOf(y)].push(i));
  const out = {};
  spread(groups.engine.length, 26, 74).forEach((y, k) => { out[groups.engine[k]] = [12, y]; });
  const top = groups.weapon.filter((_, k) => k % 2 === 0), bottom = groups.weapon.filter((_, k) => k % 2 === 1);
  spread(top.length, 32, 86).forEach((x, k) => { out[top[k]] = [x, 24]; });
  spread(bottom.length, 32, 86).forEach((x, k) => { out[bottom[k]] = [x, 76]; });
  spread(groups.other.length, 30, 82).forEach((x, k) => { out[groups.other[k]] = [x, 50]; });
  const saved = unitFlag(actor, "spots", {}) ?? {};
  for (const [i, p] of Object.entries(saved)) if (out[i] && Array.isArray(p)) out[i] = p;
  return out;
}

/**
 * Что мешает бить по системе по правилам цели: ядра SOLG за ускорителями, реактор «Рузвельта» под корпусом,
 * ядро в стволе, системы подводной лодки-авианосца под водой. Возвращает строку или "".
 */
export function sysBlock(actor, i) {
  const y = actor?.system?.systems?.[i];
  if (!y) return "";
  if (hasRule(actor, "solgcores") && /^Ядра/i.test(y.name)) {
    const n = /№\s*(\d+)/.exec(y.name)?.[1];
    const guard = (actor.system.systems ?? []).find(z => /ускорител/i.test(z.name) && /№\s*(\d+)/.exec(z.name)?.[1] === n);
    if (guard && guard.value > 0) return `ядро закрыто ускорителем «${guard.name}»`;
  }
  if (/в стволе/i.test(y.name)) return "ядро в стволе бьют, только влетев в ствол";
  if (hasRule(actor, "pwreactor") && /реактор/i.test(y.name)) {
    const noz = sysCount(actor, /сопл/i), gun = sysCount(actor, /HPBC|энергетическ/i);
    if (noz.total - noz.alive < 2 && !(gun.total && gun.alive === 0)) return "реактор закрыт корпусом: нужно 2 уничтоженных маршевых сопла или все энергетические орудия";
  }
  if (unitFlag(actor, "sub") && /погружени|на поверхности/i.test(y.note ?? "")) return "корабль под водой: система убрана";
  return "";
}

/** Последняя выбранная система по каждой цели: при повторном пуске по той же цели она стоит выбранной. */
const lastPick = new Map();

/** Какая система стоит выбранной: прошлый выбор по этой цели, иначе первая целая и открытая (оружие вперёд). */
export function defaultSys(actor) {
  const sys = actor?.system?.systems ?? [];
  const prev = lastPick.get(actor?.uuid);
  if (prev !== undefined && sys[prev]?.value > 0) return prev;
  const ok = sys.map((y, i) => ({ y, i })).filter(o => o.y.value > 0 && !sysBlock(actor, o.i));
  return (ok.find(o => roleOf(o.y) === "weapon") ?? ok[0] ?? { i: -1 }).i;
}

/** Схема цели: картинка токена с точками систем и легенда. Выбор пишется в скрытое поле name. */
export function schematicHtml(target, { name = "sys", selected = defaultSys(target.actor), hidden = false, key = "" } = {}) {
  const actor = target.actor;
  const sys = actor.system.systems ?? [];
  const img = target.token?.document?.texture?.src ?? target.token?.texture?.src ?? actor.prototypeToken?.texture?.src ?? actor.img ?? "";
  const spots = spotsOf(actor);
  const cls = (y, i) => [roleOf(y), y.value <= 0 ? "dead" : "", sysBlock(actor, i) ? "shut" : "", i === selected ? "sel" : ""].filter(Boolean).join(" ");
  const tip = (y, i) => `${y.name} · Occ ${y.occ} · HP ${Math.max(0, y.value)}/${y.hp}${y.value <= 0 ? " · уничтожена" : sysBlock(actor, i) ? ` · ${sysBlock(actor, i)}` : ""}`;
  return `<div class="tb-aim" data-aim-name="${name}" data-aim-key="${esc(key)}" data-aim-uuid="${esc(actor.uuid)}" ${hidden ? "hidden" : ""}>
    <div class="tb-aim-head"><small>ЦЕЛЕУКАЗАНИЕ</small><b>${esc(target.name)}</b><span class="tb-aim-hint">${game.user?.isGM ? "щелчок — выбрать систему, перетащить точку — поправить схему" : "щелчок по точке или строке — выбрать систему"}</span></div>
    <div class="tb-aim-scope">
      ${img ? `<img src="${esc(img)}" alt="">` : ""}
      <i class="tb-aim-cross"></i>
      ${sys.map((y, i) => `<button type="button" class="tb-aim-spot ${cls(y, i)}" data-aim-sys="${i}" style="left:${spots[i][0]}%;top:${spots[i][1]}%" title="${esc(tip(y, i))}" ${y.value <= 0 ? "disabled" : ""}>${i + 1}</button>`).join("")}
    </div>
    <ol class="tb-aim-legend">
      ${sys.map((y, i) => `<li class="${cls(y, i)}" data-aim-sys="${i}" title="${esc(y.note ?? "")}"><b>${i + 1}</b><span class="nm">${esc(y.name)}</span><span class="occ">OCC ${y.occ}</span><span class="hp">${Math.max(0, y.value)}/${y.hp}</span>${sysBlock(actor, i) ? `<em>${esc(sysBlock(actor, i))}</em>` : ""}</li>`).join("")}
    </ol>
    <input type="hidden" name="${name}" value="${selected}">
  </div>`;
}

/** Оживить схемы в окне: выбор щелчком, у ведущего — перетаскивание точек с сохранением. */
export function bindSchematic(root, onPick) {
  for (const box of root.querySelectorAll(".tb-aim")) {
    const input = box.querySelector(`input[name="${box.dataset.aimName}"]`);
    const pick = i => {
      const btn = box.querySelector(`.tb-aim-spot[data-aim-sys="${i}"]`);
      if (!btn || btn.disabled) return;
      input.value = String(i);
      box.querySelectorAll("[data-aim-sys]").forEach(n => n.classList.toggle("sel", n.dataset.aimSys === String(i)));
      lastPick.set(box.dataset.aimUuid, Number(i));
      onPick?.(Number(i), box);
    };
    box.querySelectorAll(".tb-aim-legend [data-aim-sys]").forEach(li => li.addEventListener("click", () => pick(li.dataset.aimSys)));
    const scope = box.querySelector(".tb-aim-scope");
    box.querySelectorAll(".tb-aim-spot").forEach(btn => btn.addEventListener("pointerdown", ev => {
      ev.preventDefault();
      const start = { x: ev.clientX, y: ev.clientY };
      let moved = false;
      const move = e => {
        if (!game.user?.isGM) return;
        if (!moved && Math.hypot(e.clientX - start.x, e.clientY - start.y) < 4) return;
        moved = true;
        const r = scope.getBoundingClientRect();
        btn.style.left = `${Math.max(2, Math.min(98, 100 * (e.clientX - r.left) / r.width)).toFixed(1)}%`;
        btn.style.top = `${Math.max(2, Math.min(98, 100 * (e.clientY - r.top) / r.height)).toFixed(1)}%`;
      };
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        if (moved) return saveSpot(box.dataset.aimUuid, btn.dataset.aimSys, parseFloat(btn.style.left), parseFloat(btn.style.top));
        pick(btn.dataset.aimSys);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    }));
  }
}

/** Ведущий поправил точку: пишется в актёра из мира (схема общая для всех токенов этого корабля). */
async function saveSpot(uuid, i, x, y) {
  const a = fromUuidSync(uuid);
  const base = a?.isToken ? game.actors?.get(a.id) ?? a : a;
  if (!base?.isOwner) return;
  await base.update({ [`flags.${SYSTEM_ID}.unit.spots.${i}`]: [Math.round(x * 10) / 10, Math.round(y * 10) / 10] });
}

/**
 * Выбранная система цели для атаки: { i, y, occ, parts, problems }. parts — поправки к атаке
 * (ЗАК «Литтории» и 205-го: −1 ракетам не из его зоны), problems — что мешает по правилам цели (ведущий может разрешить).
 */
export function aimAt(attacker, target, i, { missile = false } = {}) {
  const a = target.actor, y = a.system.systems?.[i];
  if (!y) return null;
  const parts = [], problems = [];
  const block = sysBlock(a, i);
  if (block) problems.push(`«${y.name}»: ${block}.`);
  if (y.value <= 0) problems.push(`«${y.name}» уже уничтожена: урон уйдёт на другую систему.`);
  if (missile && hasRule(a, "pwciws") && sysCount(a, /ЗАК/).alive > 0) {
    const d = zoneDistance(tokenOf(attacker), target.token ?? tokenOf(a));
    if (d !== 0) parts.push(["ЗАК цели", -1]);
  }
  return { i, y, occ: y.occ, parts, problems };
}

/**
 * Окно в стиле HUD: содержимое и крупные кнопки выбора (data-pick="значение") вместо «ОК / Отмена».
 * Возвращает значения полей формы и pick или null, если окно закрыли.
 */
export function cockpitDialog(title, content, { width = 520, render } = {}) {
  return new Promise(resolve => {
    let done = false;
    const finish = v => { if (!done) { done = true; resolve(v); } };
    const dlg = new Dialog({
      title,
      content: `<form class="tb-dialog tb-ck">${content}</form>`,
      buttons: {},
      render: html => {
        const root = html[0] ?? html;
        const form = root.querySelector("form") ?? root.closest?.(".app")?.querySelector("form");
        bindSchematic(root);
        form?.addEventListener("submit", ev => ev.preventDefault());
        // у окна нет кнопки по умолчанию: Enter не должен уходить в обработчик Dialog
        form?.addEventListener("keydown", ev => { if (ev.key === "Enter") { ev.preventDefault(); ev.stopPropagation(); } });
        root.querySelectorAll("[data-pick]").forEach(b => b.addEventListener("click", ev => {
          ev.preventDefault();
          if (b.disabled) return;
          const data = { pick: b.dataset.pick };
          for (const el of form.elements) {
            if (!el.name) continue;
            if (el.type === "checkbox") data[el.name] = el.checked;
            else if (el.type === "radio") { if (el.checked) data[el.name] = el.value; }
            else if (el.type === "number") data[el.name] = Number(el.value) || 0;
            else data[el.name] = el.value;
          }
          finish(data);
          dlg.close();
        }));
        render?.(root);
      },
      close: () => finish(null)
    }, { width, classes: ["dialog", "thunderbolt", "tb-cockpit"] });
    dlg.render(true);
  });
}
