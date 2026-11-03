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
