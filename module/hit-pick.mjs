/* Выбор метки урона в духе кабины: HP до нуля — экран краснеет, по центру стекло с тремя колонками.
   Grit — плитки навыков (с рангами), Structure — плитки систем с тем, что сломается, Doom — большая красная кнопка,
   которую нужно нажать дважды. Закрыть нельзя: попадание уже засчитано. Клавиши 1–6 выбирают систему, Shift+1–6 навык. */
import { TB, SYSTEM_ID } from "./config.mjs";
import { esc } from "./utils.mjs";

export const SYS_SHORT = { en: "ДВГ", fl: "ЗКР", ma: "MAWS", ms: "РКТ", sw: "СПО", gu: "ПШК" };
const SYS_ICON = { en: "fa-fire-flame-curved", fl: "fa-plane", ma: "fa-satellite-dish", ms: "fa-rocket", sw: "fa-burst", gu: "fa-crosshairs" };

/** Разметка окна выбора (отдельно для тестов). */
export function hitPickHtml(actor, { fake = null, tank = null } = {}) {
  const s = actor.system, m = s.markers ?? {};
  const skills = Object.entries(TB.skills).map(([k, v], i) => {
    const rank = Number(s.skillTotal?.[k] ?? s.skills?.[k] ?? 0);
    return `<button type="button" class="tb-hp-tile" data-pick="grit" data-skill="${k}" ${m.grit ? "disabled" : ""} title="Shift+${i + 1}"><b>${esc(v.en)}</b><span>${esc(v.label)}</span><em>${rank > 0 ? `ранг ${rank}` : "—"}</em></button>`;
  }).join("");
  const systems = Object.entries(TB.systems).map(([k, v], i) =>
    `<button type="button" class="tb-hp-tile" data-pick="structure" data-sys="${k}" ${m.structure ? "disabled" : ""} title="${i + 1}"><i class="fas ${SYS_ICON[k] ?? "fa-gear"}"></i><b>${SYS_SHORT[k] ?? k}</b><span>${esc(v.label)}</span><em>${esc(v.hint)}</em></button>`).join("");
  const col = (key, title, sub, body, done) => `<section class="tb-hp-col ${key}${done ? " done" : ""}"><header><b>${title}</b><small>${done ? "уже стоит" : sub}</small></header>${body}</section>`;
  const extra = [fake ? `<button type="button" class="tb-hp-extra" data-pick="fakeout"><i class="fas fa-masks-theater"></i> «${esc(fake.name)}»: отменить попадание</button>` : "",
    tank ? `<button type="button" class="tb-hp-extra" data-pick="tank"><i class="fas fa-shield-halved"></i> «${esc(TB.planeMoves?.tank?.name ?? "Летающий танк")}»: без метки, HP до максимума</button>` : ""].join("");
  return `<div class="tb-hp-glass">
    <div class="tb-hp-head"><span class="tb-hp-alarm">▲ ПОПАДАНИЕ ▲</span><span class="tb-hp-who">${esc(actor.token?.name ?? actor.name)} · HP 0</span>
      <small>Попадание засчитано. Выберите, что приняла машина: HP восстановится до ${Number(s.hp?.max ?? 0)}.</small></div>
    <div class="tb-hp-cols">
      ${col("grit", "GRIT", "пилот ранен: навык недоступен", `<div class="tb-hp-grid">${skills}</div>`, m.grit)}
      ${col("structure", "STRUCTURE", "машина повреждена: система отказала", `<div class="tb-hp-grid">${systems}</div>`, m.structure)}
      ${col("doom", "DOOM", "машина обречена", `<button type="button" class="tb-hp-doom" data-pick="doom" ${m.doom ? "disabled" : ""}><i class="fas fa-skull"></i><b>DOOM</b><span>катапульта или героическая гибель</span></button>`, m.doom)}
    </div>
    ${extra ? `<div class="tb-hp-extras">${extra}</div>` : ""}
  </div>`;
}

const pickOn = () => { try { return game.settings.get(SYSTEM_ID, "hitPick") !== false; } catch { return true; } };
export function registerHitPick() {
  game.settings.register(SYSTEM_ID, "hitPick", {
    name: "Выбор метки в стиле кабины", hint: "HP до нуля: экран краснеет, метка выбирается плитками навыков и систем на стекле, Doom — двойным нажатием. Выключено — обычное окно.",
    scope: "client", config: true, type: Boolean, default: true
  });
}
/**
 * Показать выбор и дождаться ответа: { marker, skill?, sys? }. Окно не закрывается без выбора.
 * Без DOM (тесты, сервер) — null: вызывающий откроет обычное окно.
 */
export function hitPick(actor, opts = {}) {
  if (typeof document === "undefined" || !document.body || !pickOn()) return Promise.resolve(null);
  return new Promise(resolve => {
    const root = document.createElement("div");
    root.id = "tb-hit-pick";
    root.className = "thunderbolt";
    root.innerHTML = hitPickHtml(actor, opts);
    let armed = null;
    const finish = v => {
      if (!root.isConnected) return;
      document.removeEventListener("keydown", onKey, true);
      root.classList.add("out");
      setTimeout(() => root.remove(), 220);
      resolve(v);
    };
    const pick = b => {
      if (!b || b.disabled) return;
      const kind = b.dataset.pick;
      if (kind === "doom") {
        // Doom — только вторым нажатием: случайный щелчок не губит машину
        if (armed !== b) { armed = b; b.classList.add("armed"); b.querySelector("span").textContent = "нажмите ещё раз, чтобы подтвердить"; return; }
        return finish({ marker: "doom" });
      }
      if (kind === "grit") return finish({ marker: "grit", skill: b.dataset.skill });
      if (kind === "structure") return finish({ marker: "structure", sys: b.dataset.sys });
      return finish({ marker: kind });
    };
    const onKey = ev => {
      const n = Number(ev.code?.replace("Digit", "")) || 0;
      if (n < 1 || n > 6) return;
      const list = root.querySelectorAll(ev.shiftKey ? "[data-pick=grit]" : "[data-pick=structure]");
      if (!list[n - 1]) return;
      ev.preventDefault(); ev.stopPropagation();
      pick(list[n - 1]);
    };
    root.addEventListener("click", ev => pick(ev.target.closest("[data-pick]")));
    document.addEventListener("keydown", onKey, true);
    document.body.append(root);
  });
}

/* ---------- метка Doom у пилота: катапульта или героическая гибель, исход катапульты на том же стекле ---------- */

export const FATE_SHORT = { ok: "КАТАПУЛЬТИРОВАЛСЯ", hurt: "РАНЕН · ПОДОБРАН", mia: "ПРОПАЛ БЕЗ ВЕСТИ", kia: "ГИБЕЛЬ" };

/** Разметка выбора судьбы (для тестов отдельно). */
export function fatePickHtml(actor) {
  const s = actor.system, push = Number(s.skillTotal?.push ?? s.skills?.push ?? 0), strain = Number(s.strain?.value ?? 0);
  return `<div class="tb-hp-glass fate">
    <div class="tb-hp-head"><span class="tb-hp-alarm">▲ DOOM ▲</span><span class="tb-hp-who">${esc(actor.token?.name ?? actor.name)}</span>
      <small>Машина обречена. Решите судьбу пилота.</small></div>
    <div class="tb-fate-opts">
      <button type="button" class="tb-fate eject" data-fate="eject"><i class="fas fa-parachute-box"></i><b>КАТАПУЛЬТА</b>
        <span>Push против 7: d10 ${push ? `+ ${push}` : ""}. Не хватит — Strain добавится сам (есть ${strain}).</span><em>Провал решает d4: 4 ранен, 2–3 пропал, 1 гибель</em></button>
      <button type="button" class="tb-fate hero" data-fate="hero"><i class="fas fa-skull"></i><b>ГЕРОИЧЕСКАЯ ГИБЕЛЬ</b>
        <span>Последние слова, без броска.</span><em>Стол решает: «Победа любой ценой» или «Достойное отступление»</em></button>
    </div>
    <div class="tb-fate-later"><button type="button" data-fate="later">Решу позже</button><small>Кнопки останутся в полосе DOOM на HUD и на карточке в чате.</small></div>
  </div>`;
}

/** Что дальше по исходу катапульты: одна короткая строка. */
export const FATE_NEXT = { ok: "Дальше три проверки на земле: Push, Dodge, Aim или Lead.", hurt: "Жив, подобран своими. Госпиталь.", mia: "Пропал или в плену. Спасение становится миссией.", kia: "Последние слова за пилотом." };
const D4_SCALE = [["kia", "1", "гибель"], ["mia", "2–3", "пропал"], ["hurt", "4", "ранен"]];

/**
 * Исход катапульты на стекле в два шага. 1 — рукоятка: d10 + Push (+ Strain) против 7, успех или провал.
 * 2 — только при провале: d4 по шкале 1 гибель · 2–3 пропал · 4 ранен, выпавшее деление подсвечено. Потом штамп.
 */
export function fateResultHtml(actor, r, fate) {
  const ok = fate.key === "ok", bonus = (r.parts ?? []).filter(p => p?.[1]).map(([n, v]) => `<span>${esc(n)} ${v > 0 ? "+" : "−"}${Math.abs(v)}</span>`).join("");
  return `<div class="tb-hp-glass fate result ${fate.key}">
    <div class="tb-hp-head"><span class="tb-hp-alarm"><i class="fas fa-parachute-box"></i> КАТАПУЛЬТА</span><span class="tb-hp-who">${esc(actor.token?.name ?? actor.name)}</span></div>
    <div class="tb-fate-step one ${ok ? "ok" : "bad"}"><small>1 · РУКОЯТКА</small>
      <span class="tb-fate-dice"><i class="d10">${r.d10 ?? "?"}</i></span>
      <span class="tb-fate-parts">${bonus}${r.strain ? `<span class="st">Strain +${r.strain}</span>` : ""}</span>
      <span class="tb-fate-sum"><b>${r.total}</b><em>/ 7</em></span>
      <strong>${ok ? "СРАБОТАЛА" : "НЕ ВЫШЛО"}</strong></div>
    ${ok ? "" : `<div class="tb-fate-step two"><small>2 · ЧТО С ПИЛОТОМ</small>
      <span class="tb-fate-dice"><i class="d4">${r.d4 ?? "?"}</i></span>
      <span class="tb-fate-scale">${D4_SCALE.map(([k, n, w]) => `<span class="${k}${k === fate.key ? " on" : ""}"><b>${n}</b>${w}</span>`).join("")}</span></div>`}
    <div class="tb-fate-stamp ${fate.key}">${FATE_SHORT[fate.key] ?? esc(fate.title)}</div>
    <p class="tb-fate-text">${esc(FATE_NEXT[fate.key] ?? "")}</p>
    <div class="tb-fate-later"><button type="button" data-fate="close">Принято</button></div>
  </div>`;
}

/** Окно судьбы пилота: КАТАПУЛЬТА бросает сразу и показывает исход, ГИБЕЛЬ — вторым нажатием. «Решу позже» закрывает. */
export function fatePick(actor) {
  if (typeof document === "undefined" || !document.body || !pickOn() || actor?.type !== "pilot") return Promise.resolve(null);
  document.getElementById("tb-fate-pick")?.remove();
  return new Promise(resolve => {
    const root = document.createElement("div");
    root.id = "tb-fate-pick";
    root.className = "thunderbolt tb-hit-pick";
    root.innerHTML = fatePickHtml(actor);
    let armed = false, busy = false, timer = null;
    const finish = v => {
      clearTimeout(timer);
      if (!root.isConnected) return resolve(v);
      root.classList.add("out");
      setTimeout(() => root.remove(), 220);
      resolve(v);
    };
    root.addEventListener("click", async ev => {
      const b = ev.target.closest("[data-fate]");
      if (!b || busy) return;
      const what = b.dataset.fate;
      if (what === "later" || what === "close") return finish(what);
      const R = await import("./dice/rolls.mjs");
      if (what === "hero") {
        if (!armed) { armed = true; b.classList.add("armed"); b.querySelector("span").textContent = "Нажмите ещё раз: пилот погибает."; return; }
        busy = true;
        await R.heroNow(actor, { confirmed: true });
        return finish("hero");
      }
      busy = true;
      root.querySelectorAll("[data-fate]").forEach(x => { x.disabled = true; });
      b.classList.add("rolling");
      const msg = await R.ejectNow(actor);
      const card = msg?.getFlag?.(SYSTEM_ID, "card");
      if (!card) return finish(null);
      const r = R.computeCard(card), fate = R.ejectFate(r);
      // пауза на «рывок рукоятки», потом кубик катится и замирает
      await new Promise(ok => setTimeout(ok, 350));
      root.innerHTML = fateResultHtml(actor, r, fate);
      root.classList.add("result");
      // шаг за шагом: d10 рукоятки, вердикт, потом (при провале) d4 по шкале, потом штамп
      const roll = (die, max, ms) => new Promise(done => {
        if (!die) return done();
        const real = die.textContent, t0 = performance.now();
        const spin = now => { if (!die.isConnected) return done(); if (now - t0 > ms) { die.textContent = real; die.classList.add("land"); return done(); } die.textContent = String(1 + Math.floor(Math.random() * max)); requestAnimationFrame(spin); };
        requestAnimationFrame(spin);
      });
      const pause = ms => new Promise(ok => setTimeout(ok, ms));
      const one = root.querySelector(".tb-fate-step.one"), two = root.querySelector(".tb-fate-step.two");
      one?.classList.add("show");
      await roll(one?.querySelector(".d10"), 10, 700);
      one?.classList.add("done");
      if (two) { await pause(500); two.classList.add("show"); await roll(two.querySelector(".d4"), 4, 600); two.classList.add("done"); }
      await pause(250);
      root.querySelector(".tb-fate-stamp")?.classList.add("in");
      root.querySelector(".tb-fate-text")?.classList.add("in");
      busy = false;
      timer = setTimeout(() => finish("eject"), 20000);
    });
    document.body.append(root);
  });
}
