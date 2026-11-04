/* Заявка действий у игрока в стиле кабины: в начале раунда над картой (карта видна и не закрыта) стекло
   «РАУНД N · ЗАЯВКА». Сверху контакты врага с их заявками и уже заявившееся звено, ниже у каждой машины игрока
   четыре плитки: 1, 2, 3 действия и ПАС. На каждой плитке — место в очереди против врага: «раньше всех врагов»,
   «после 2 врагов». Одна машина: щелчок или клавиша 1/2/3/0 сразу заявляет. Несколько: выбрать у каждой и «ЗАЯВИТЬ».
   «Позже» (Esc) закрывает: заявку открывает снова кнопка ЗАЯВКА на HUD (или трекер). У ведущего и без DOM — обычная форма. */
import { SYSTEM_ID } from "./config.mjs";
import { esc } from "./utils.mjs";

/** Значения как в combat.mjs: PASS пропуск, AUTO автопилот. */
const PASS = 10, AUTO = 20;
const plural = (n, one, few, many) => {
  const a = Math.abs(n) % 100, b = a % 10;
  return a > 10 && a < 20 ? many : b === 1 ? one : b >= 2 && b <= 4 ? few : many;
};

/** Сколько врагов ходит раньше при заявке n (при равенстве игрок раньше NPC). Пропуск — в конец. */
export function aheadOf(n, foes) {
  const real = foes.map(f => f.v).filter(v => Number.isFinite(v) && v >= 1 && v <= 3);
  if (n === PASS) return real.length;
  return real.filter(v => v < n).length;
}

/** Строка места в очереди на плитке. */
export function orderLine(n, foes) {
  if (n === PASS) return "в конец очереди";
  const k = aheadOf(n, foes);
  if (!foes.some(f => Number.isFinite(f.v) && f.v >= 1 && f.v <= 3)) return n === 1 ? "ходите раньше" : n === 3 ? "ходите позже" : "в середине";
  return k ? `после ${k} ${plural(k, "врага", "врагов", "врагов")}` : "раньше всех врагов";
}

const chipVal = v => (v === PASS ? "пас" : v >= AUTO ? "авто" : v > PASS ? `${v - PASS}↓` : String(v));

/**
 * Разметка стекла (отдельно для тестов).
 * d = { round, rows: [{ id, name, plane, wso, hp, hpMax, strain, strainMax }], foes: [{ name, v, unknown }], mates: [{ name, v }] }
 */
export function declarePickHtml(d) {
  const many = d.rows.length > 1;
  const foes = d.foes.length
    ? d.foes.map(f => `<span class="tb-dp-chip foe${f.unknown ? " unk" : ""}${f.v >= AUTO ? " auto" : ""}"><i></i>${esc(f.name)}<b>${chipVal(f.v)}</b></span>`).join("")
    : `<span class="tb-dp-none">врага в заявке нет</span>`;
  const mates = d.mates.length ? `<div class="tb-dp-strip mates"><small>ЗВЕНО</small>${d.mates.map(m => `<span class="tb-dp-chip mate"><i></i>${esc(m.name)}<b>${chipVal(m.v)}</b></span>`).join("")}</div>` : "";
  const tile = (row, n) => {
    const pass = n === PASS;
    const pips = pass ? `<span class="tb-dp-pips pass"><i></i><i></i><i></i></span>` : `<span class="tb-dp-pips">${[1, 2, 3].map(k => `<i class="${k <= n ? "on" : ""}"></i>`).join("")}</span>`;
    return `<button type="button" class="tb-dp-tile${pass ? " pass" : ""}" data-row="${row.id}" data-n="${n}" title="клавиша ${pass ? "0" : n}">
      ${pips}<b>${pass ? "ПАС" : n}</b><span>${pass ? "пропуск хода" : plural(n, "действие", "действия", "действий")}</span><em>${esc(orderLine(n, d.foes))}</em></button>`;
  };
  const rows = d.rows.map(r => `<section class="tb-dp-row" data-row="${r.id}">
      <header><b>${esc(r.name)}</b>${r.plane ? `<span>${esc(r.plane)}</span>` : ""}${r.wso ? `<em class="wso" title="WSO во второй кабине: ещё одно действие сверх заявки, место в очереди по заявке пилота; у экипажа две проверки за ход">+1 WSO</em>` : ""}
        <small>${Number.isFinite(r.hp) ? `HP ${r.hp}/${r.hpMax}` : ""}${Number.isFinite(r.strain) ? ` · Strain ${r.strain}${r.strainMax ? `/${r.strainMax}` : ""}` : ""}</small></header>
      <div class="tb-dp-tiles">${[1, 2, 3, PASS].map(n => tile(r, n)).join("")}</div></section>`).join("");
  return `<div class="tb-dp-glass">
    <div class="tb-dp-top"><span class="tb-dp-ch"><i class="fas fa-satellite-dish"></i> РАУНД ${d.round} · ЗАЯВКА</span>
      <span class="tb-dp-rule">Меньше действий — ходите раньше. Равно с врагом — вы первыми.</span></div>
    <div class="tb-dp-strip foes"><small>КОНТАКТЫ</small>${foes}</div>
    ${mates}
    ${rows}
    <div class="tb-dp-foot">${many ? `<button type="button" class="tb-dp-go" data-go disabled>ЗАЯВИТЬ</button>` : ""}
      <button type="button" class="tb-dp-later" data-later>Позже</button><small>${many ? "1/2/3 или 0 — для первой машины без выбора, Enter — заявить" : "Клавиши 1, 2, 3 или 0 (пас). Esc — позже: кнопка ЗАЯВКА на HUD откроет снова"}</small></div>
  </div>`;
}

/** Данные для стекла из боя (только то, что игрок и так видит в трекере). */
export function declareData(combat, list, { npcSide, declared, passive, isOut, hasWso }) {
  const seen = c => !c.hidden && !c.token?.hidden && !passive(c.actor) && !isOut(c) && declared(c);
  const plane = a => a?.system?.plane?.name ?? "";
  return {
    round: combat.round,
    rows: list.map(c => {
      const s = c.actor?.system ?? {};
      return { id: c.id, name: c.name, plane: plane(c.actor), wso: hasWso(c),
        hp: Number(s.hp?.value), hpMax: Number(s.hp?.max), strain: Number(s.strain?.value), strainMax: Number(s.strain?.max) };
    }),
    foes: combat.combatants.filter(c => npcSide(c) && seen(c)).map(c => ({ name: c.name, v: Number(c.initiative), unknown: !!(c.token?.getFlag?.(SYSTEM_ID, "unknown") ?? c.actor?.getFlag?.(SYSTEM_ID, "unknown")) })),
    mates: combat.combatants.filter(c => !npcSide(c) && seen(c) && !list.includes(c)).map(c => ({ name: c.name, v: Number(c.initiative) }))
  };
}

const pickOn = () => { try { return game.settings.get(SYSTEM_ID, "declarePick") !== false; } catch { return true; } };
export function registerDeclarePick() {
  game.settings.register(SYSTEM_ID, "declarePick", {
    name: "Заявка действий в стиле кабины", hint: "У игрока: в начале раунда над картой стекло с контактами врага и плитками 1, 2, 3 и ПАС, на плитках место в очереди. Выключено — обычное окно.",
    scope: "client", config: true, type: Boolean, default: true
  });
}

/**
 * Показать стекло и дождаться заявки: { [combatantId]: n } или null («Позже»).
 * Без DOM, у ведущего или с выключенной настройкой — undefined: вызывающий откроет обычную форму.
 */
export function declarePick(data) {
  if (typeof document === "undefined" || !document.body || !pickOn() || game.user?.isGM) return Promise.resolve(undefined);
  document.getElementById("tb-declare-pick")?.remove();
  return new Promise(resolve => {
    const root = document.createElement("div");
    root.id = "tb-declare-pick";
    root.className = "thunderbolt";
    root.innerHTML = declarePickHtml(data);
    const picked = {}, many = data.rows.length > 1;
    const go = root.querySelector("[data-go]");
    const finish = v => {
      document.removeEventListener("keydown", onKey, true);
      Hooks.off?.("deleteCombat", onGone);
      if (!root.isConnected) return resolve(v);
      if (v) {
        // заявка «встаёт» на выбранной плитке, потом стекло уходит
        root.classList.add("sent");
        setTimeout(() => { root.classList.add("out"); setTimeout(() => root.remove(), 220); }, 380);
      } else { root.classList.add("out"); setTimeout(() => root.remove(), 220); }
      resolve(v);
    };
    const choose = (rowId, n) => {
      if (!rowId || !n) return;
      picked[rowId] = n;
      root.querySelectorAll(`.tb-dp-tile[data-row="${rowId}"]`).forEach(b => b.classList.toggle("on", Number(b.dataset.n) === n));
      root.querySelector(`.tb-dp-row[data-row="${rowId}"]`)?.classList.add("set");
      if (!many) return finish({ ...picked });
      if (go) go.disabled = data.rows.some(r => !picked[r.id]);
    };
    const onKey = ev => {
      if (ev.target?.closest?.("input, textarea, [contenteditable]")) return;
      // поверх открыт выбор метки или судьбы пилота: клавиши его, а не заявки
      if (document.querySelector("#tb-hit-pick, #tb-fate-pick")) return;
      if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); return finish(null); }
      if (ev.key === "Enter" && many && go && !go.disabled) { ev.preventDefault(); return finish({ ...picked }); }
      const k = ev.code?.replace(/^(Digit|Numpad)/, "");
      const n = k === "0" ? PASS : ["1", "2", "3"].includes(k) ? Number(k) : 0;
      if (!n) return;
      const row = data.rows.find(r => !picked[r.id]) ?? data.rows[data.rows.length - 1];
      ev.preventDefault(); ev.stopPropagation();
      choose(row.id, n);
    };
    const onGone = () => finish(null);
    root.addEventListener("click", ev => {
      if (ev.target.closest("[data-later]")) return finish(null);
      if (ev.target.closest("[data-go]")) return go.disabled ? null : finish({ ...picked });
      const t = ev.target.closest(".tb-dp-tile");
      if (t) choose(t.dataset.row, Number(t.dataset.n));
    });
    document.addEventListener("keydown", onKey, true);
    Hooks.on?.("deleteCombat", onGone);
    document.body.append(root);
  });
}
