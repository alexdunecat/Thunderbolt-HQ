/* Представление эскадрильи асов, как в Ace Combat 7: у всех на экране эмблема, крупное название, подразделение,
   строка с авиакрылом и девиз. Ведущий открывает окно кнопкой «Асы» в панели AWACS; эскадрильи сохраняются в мире
   (настройка aceSquadrons), чтобы показывать их снова. Показ идёт через радио (radio.mjs, баннер intro) и пишется в журнал. */
import { SYSTEM_ID } from "./config.mjs";
import { esc } from "./utils.mjs";

export function registerAces() {
  game.settings.register(SYSTEM_ID, "aceSquadrons", { scope: "world", config: false, type: Array, default: [] });
}

const saved = () => { try { return foundry.utils.deepClone(game.settings.get(SYSTEM_ID, "aceSquadrons") ?? []); } catch { return []; } };
const EMPTY = { id: "", name: "", unit: "", wing: "", motto: "", emblem: "", side: "enemy", line: "" };

/** Данные эскадрильи из формы: обрезанные строки, сторона enemy или ally. */
export function squadFromForm(get) {
  const s = Object.fromEntries(Object.keys(EMPTY).map(k => [k, String(get(k) ?? "").trim()]));
  s.side = s.side === "ally" ? "ally" : "enemy";
  return s;
}

/** Баннер для радио: { title, sub, level: "intro" или "intro-ally", intro }. */
export function introCaution(s) {
  return { title: s.name, sub: [s.unit, s.wing].filter(Boolean).join(" · "), level: s.side === "ally" ? "intro-ally" : "intro",
    intro: { name: s.name, unit: s.unit, wing: s.wing, motto: s.motto, emblem: s.emblem, side: s.side } };
}

/** Реплика AWACS по умолчанию. */
export const defaultLine = s => s.side === "ally"
  ? `Всем бортам: к нам присоединяется эскадрилья «${s.name}». Работаем вместе.`
  : `Внимание, всем бортам! Эскадрилья «${s.name}» в районе. Это асы, будьте предельно осторожны!`;

/** Эмблема выделенного токена: шильдик NPC или пилота. */
const selectedEmblem = () => canvas?.tokens?.controlled?.map(t => t.actor?.system?.insignia).find(Boolean) ?? "";

/** Окно «Представить асов». */
export function openAceIntro() {
  if (!game.user.isGM) return;
  const list = saved();
  const pick = list[0] ?? { ...EMPTY, emblem: selectedEmblem() };
  const opts = list.map(s => `<option value="${esc(s.id)}">${esc(s.name)}${s.unit ? ` · ${esc(s.unit)}` : ""}</option>`).join("");
  const content = `<form class="tb-dialog tb-ace-form">
    <div class="form-group"><label>Эскадрилья</label><select name="pick"><option value="">— новая —</option>${opts}</select></div>
    <div class="form-group"><label>Название</label><input type="text" name="name" placeholder="LUX LUNAE"></div>
    <div class="form-group"><label>Подразделение</label><input type="text" name="unit" placeholder="55TH UNIT"></div>
    <div class="form-group"><label>Авиакрыло</label><input type="text" name="wing" placeholder="1ST SPECIAL OPERATIONS WING, 11TH TACTICAL SQUADRON"></div>
    <div class="form-group"><label>Девиз</label><input type="text" name="motto" placeholder="Lux Lunae — Fiat Lux! (необязательно)"></div>
    <div class="form-group"><label>Эмблема</label><input type="text" name="emblem" placeholder="картинка">
      <button type="button" data-browse title="Выбрать картинку"><i class="fas fa-file-image"></i></button>
      <button type="button" data-token title="Взять шильдик выделенного токена"><i class="fas fa-user-tag"></i></button></div>
    <div class="form-group"><label>Сторона</label><select name="side"><option value="enemy">Противник (красный)</option><option value="ally">Союзники (синий)</option></select></div>
    <div class="form-group"><label><input type="checkbox" name="say" checked> Реплика AWACS</label></div>
    <div class="form-group stacked"><textarea name="line" rows="2"></textarea></div>
    <div class="tb-ace-preview"></div>
    <p class="tb-hint">Заставка появится у всех игроков на 8 секунд (щелчок убирает) и останется в чате и радиожурнале. Эскадрилья сохраняется в мире при показе.</p></form>`;
  new Dialog({
    title: "Представить асов", content,
    buttons: {
      show: { icon: '<i class="fas fa-jet-fighter"></i>', label: "На экран", callback: html => {
        const f = html[0].querySelector("form");
        const s = squadFromForm(k => f[k]?.value);
        if (!s.name) return ui.notifications.warn("Представить асов: впишите название эскадрильи.");
        const say = f.say.checked;
        s.line = f.line.value.trim();
        s.id = f.pick.value || foundry.utils.randomID();
        saveSquad(s);
        announceAces(s, { text: say ? s.line || defaultLine(s) : "" });
      } },
      del: { icon: '<i class="fas fa-trash"></i>', label: "Удалить", callback: html => {
        const id = html[0].querySelector("form").pick.value;
        if (id) game.settings.set(SYSTEM_ID, "aceSquadrons", saved().filter(s => s.id !== id));
      } },
      cancel: { label: "Закрыть" }
    },
    default: "show",
    render: html => {
      const f = html[0].querySelector("form");
      const fill = s => {
        for (const k of ["name", "unit", "wing", "motto", "emblem", "side"]) f[k].value = s[k] ?? EMPTY[k];
        f.line.value = s.line || "";
        f.line.placeholder = defaultLine({ ...s, name: s.name || "…" });
        preview();
      };
      const preview = () => {
        const s = squadFromForm(k => f[k]?.value);
        f.line.placeholder = defaultLine({ ...s, name: s.name || "…" });
        f.querySelector(".tb-ace-preview").innerHTML = s.name ? introHtml(s, { mini: true }) : "";
      };
      f.pick.value = list[0]?.id ?? "";
      fill(pick);
      f.pick.addEventListener("change", () => fill(list.find(s => s.id === f.pick.value) ?? { ...EMPTY, emblem: selectedEmblem() }));
      f.querySelectorAll("input, select").forEach(i => i.addEventListener("input", preview));
      f.querySelector("[data-browse]").addEventListener("click", () => new FilePicker({ type: "image", current: f.emblem.value,
        callback: path => { f.emblem.value = path; preview(); } }).render(true));
      f.querySelector("[data-token]").addEventListener("click", () => {
        const src = selectedEmblem();
        if (!src) return ui.notifications.info("Выделите токен аса с шильдиком (щиток у портрета в листе NPC).");
        f.emblem.value = src; preview();
      });
    }
  }, { classes: ["dialog", "thunderbolt"], width: 520 }).render(true);
}

async function saveSquad(s) {
  const list = saved();
  const i = list.findIndex(x => x.id === s.id);
  if (i >= 0) list[i] = s; else list.unshift(s);
  await game.settings.set(SYSTEM_ID, "aceSquadrons", list);
}

/** Показать эскадрилью всем (через сообщение радио) и, по желанию, реплику AWACS. */
export async function announceAces(s, { text = "" } = {}) {
  const { sendRadio } = await import("./radio.mjs");
  return sendRadio({ text, caution: introCaution(s) });
}

/** Разметка заставки: эмблема слева, справа название с подразделением, авиакрыло и девиз. mini — превью в окне. */
export function introHtml(i, { mini = false } = {}) {
  return `<div class="tb-intro tb-intro-${i.side === "ally" ? "ally" : "enemy"}${mini ? " mini" : ""}">
    ${i.emblem ? `<img class="tb-intro-emblem" src="${esc(i.emblem)}" alt="">` : ""}
    <div class="tb-intro-text">
      <div class="tb-intro-head"><span class="tb-intro-name">${esc(i.name)}</span>${i.unit ? `<span class="tb-intro-unit">${esc(i.unit)}</span>` : ""}</div>
      ${i.wing ? `<div class="tb-intro-wing">${esc(i.wing)}</div>` : ""}
      ${i.motto ? `<div class="tb-intro-motto">${esc(i.motto)}</div>` : ""}
    </div></div>`;
}
