/* Качество эффектов, как в компьютерных играх: одна настройка «Эффекты» (Высокие, Средние, Низкие, Выключены)
   и кнопка «Эффекты по отдельности» — окно с галочкой у каждого эффекта. Сменили галочку — качество становится «Своими».
   Отдельные настройки эффектов (fxOn, fxNight…) остаются как были, просто не стоят в общем списке. */
import { SYSTEM_ID } from "./config.mjs";

/** Эффекты в порядке окна: ключ настройки, название, что делает. */
export const FX_LIST = [
  ["fxOn", "Анимация ракет и попаданий", "пуски, трассеры, взрывы на карте; без неё остальные эффекты боя тоже не рисуются"],
  ["fxCallouts", "Надписи HIT / MISS / DESTROYED", "над целью после выстрела"],
  ["hitFlash", "Удар по своей машине", "HUD краснеет, рябит и вздрагивает при попадании"],
  ["fxNight", "Огни ночью", "бортовые огни, огни городов, вспышки взрывов на ночной карте"],
  ["fxWeather", "Осадки и молнии", "дождь, снег, песок и молнии в клетках с погодой"],
  ["fxBurn", "Дым и огонь у повреждённых", "дым за машиной со Structure, огонь у Doom"],
  ["fxBurner", "Форсаж", "пламя из сопел на Max Speed"],
  ["fxTrail", "Инверсионные следы", "белые следы за самолётами на высоте"],
  ["fxWake", "Кильватер, пыль и колея", "след за кораблями и наземной техникой"],
  ["fxVapor", "Пар и вихри", "конус пара на разгоне, вихри с крыльев на Break!"],
  ["fxCraters", "Воронки после ударов", "подпалины на земле, тают за три раунда"]
];
const ALL = FX_LIST.map(([k]) => k);
/** Что включено на каждом уровне (остальное выключено). */
export const FX_PRESETS = {
  high: ALL,
  medium: ["fxOn", "fxCallouts", "hitFlash", "fxNight", "fxWeather", "fxBurn", "fxBurner"],
  low: ["fxOn", "fxCallouts", "hitFlash"],
  off: []
};
export const FX_LEVELS = { high: "Высокие", medium: "Средние", low: "Низкие (слабый компьютер)", off: "Выключены", custom: "Свои (выбраны по отдельности)" };

/** Значения всех эффектов на уровне: { key: bool }. */
export const presetValues = level => Object.fromEntries(ALL.map(k => [k, (FX_PRESETS[level] ?? ALL).includes(k)]));
/** Какому уровню соответствуют значения, или "custom". */
export function presetOf(values) {
  for (const level of Object.keys(FX_PRESETS)) if (ALL.every(k => !!values[k] === FX_PRESETS[level].includes(k))) return level;
  return "custom";
}

const get = k => { try { return game.settings.get(SYSTEM_ID, k) !== false; } catch { return true; } };
const current = () => Object.fromEntries(ALL.map(k => [k, get(k)]));
let applying = false;
async function apply(values) {
  applying = true;
  try { for (const [k, v] of Object.entries(values)) if (get(k) !== v) await game.settings.set(SYSTEM_ID, k, v); }
  finally { applying = false; }
}

const fxMenu = () => class FxMenu extends FormApplication {
  render() {
    const now = current();
    const level = presetOf(now);
    const rows = FX_LIST.map(([k, label, hint]) => `<div class="form-group"><label><input type="checkbox" name="${k}" ${now[k] ? "checked" : ""}> ${label}</label><p class="notes">${hint}</p></div>`).join("");
    const presets = Object.keys(FX_PRESETS).map(l => `<button type="button" data-tb-fx-level="${l}" class="${l === level ? "active" : ""}">${FX_LEVELS[l].replace(/ \(.*\)/, "")}</button>`).join("");
    new Dialog({
      title: "Эффекты по отдельности",
      content: `<form class="tb-dialog tb-fx-menu"><div class="tb-fx-levels">${presets}</div>${rows}</form>`,
      render: html => {
        const root = html[0] ?? html;
        root.querySelectorAll("[data-tb-fx-level]").forEach(b => b.addEventListener("click", ev => {
          ev.preventDefault();
          const v = presetValues(b.dataset.tbFxLevel);
          for (const el of root.querySelectorAll("input[type=checkbox]")) el.checked = !!v[el.name];
          root.querySelectorAll("[data-tb-fx-level]").forEach(x => x.classList.toggle("active", x === b));
        }));
        root.addEventListener("change", () => {
          const v = Object.fromEntries([...root.querySelectorAll("input[type=checkbox]")].map(el => [el.name, el.checked])), l = presetOf(v);
          root.querySelectorAll("[data-tb-fx-level]").forEach(x => x.classList.toggle("active", x.dataset.tbFxLevel === l));
        });
      },
      buttons: { ok: { label: "Сохранить", callback: async html => {
        const root = html[0] ?? html;
        const v = Object.fromEntries([...root.querySelectorAll("input[type=checkbox]")].map(el => [el.name, el.checked]));
        await apply(v);
        await game.settings.set(SYSTEM_ID, "fxQuality", presetOf(v));
      } } }, default: "ok"
    }, { width: 460, height: "auto", resizable: true, classes: ["dialog", "thunderbolt"] }).render(true);
    return this;
  }
};

export function registerFxQuality() {
  game.settings.register(SYSTEM_ID, "fxQuality", {
    name: "Эффекты", hint: "Качество эффектов на карте, как в играх. Высокие — всё; Средние — без следов, кильватера, пара и воронок; Низкие — только ракеты, надписи попаданий и удар по HUD; Выключены — ничего. Каждый эффект по отдельности — кнопка «Эффекты по отдельности» выше. Только у себя.",
    scope: "client", config: true, type: String, default: "high", choices: FX_LEVELS,
    onChange: level => { if (!applying && FX_PRESETS[level]) apply(presetValues(level)).catch(err => console.warn(`${SYSTEM_ID} | эффекты`, err)); }
  });
  try {
    game.settings.registerMenu(SYSTEM_ID, "fxMenu", {
      name: "Эффекты по отдельности", label: "Выбрать эффекты", hint: "Включить или выключить каждый эффект у себя: анимацию ракет, огни ночью, осадки, дым, следы, пар, воронки.",
      icon: "fas fa-sliders", type: fxMenu(), restricted: false
    });
  } catch (err) { console.warn(`${SYSTEM_ID} | окно эффектов`, err); }
  // уже настроенные раньше по отдельности: уровень показывает, что выбрано на самом деле
  Hooks.once("ready", () => {
    const l = presetOf(current());
    try { if (game.settings.get(SYSTEM_ID, "fxQuality") !== l) { applying = true; game.settings.set(SYSTEM_ID, "fxQuality", l).finally(() => { applying = false; }); } } catch { /* без настроек */ }
  });
}
