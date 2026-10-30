/* Позывные безымянных звеньев по нации и типу машины: «Шункар-2», «Адлер 1», «триста пятый» («305-й»).
   Нация стороны задаётся у сцены (Планшет AWACS при импорте или окно «Позывные» в панели AWACS). Асам и именным эскадрильям
   позывных не раздаётся: их называет ведущий. Позывной лежит во флаге токена radioCall; в эфире (реплики NPC, задачи AWACS)
   он заменяет имя токена, само имя на карте не меняется. Таблицы правятся в том же окне (настройка мира callsignBank). */
import { SYSTEM_ID } from "./config.mjs";
import { esc } from "./utils.mjs";
import { NATIONS, KINDS, BANK } from "./data/callsign-bank.mjs";

export { NATIONS, KINDS };
const AWACS_KEYS = ["a50", "e767", "nimrod", "bookpatrol"];
const AIR = ["fighter", "attack", "heavy", "awacs", "transport", "heli"];

/** Тип позывного по листу NPC: null — позывной не нужен (ас, босс, корабль, объект, гражданская наземка). */
export function callKind(sys) {
  if (!sys || sys.tier === "ace" || sys.grp === "boss") return null;
  if (sys.kind === "air") {
    if (["fighter", "multi", "player"].includes(sys.grp)) return "fighter";
    if (sys.grp === "book") return ["ga", "gs"].includes(sys.key) ? "attack" : "fighter";
    if (sys.grp === "support") return AWACS_KEYS.includes(sys.key) ? "awacs" : "transport";
    if (["attack", "heavy", "heli", "civil"].includes(sys.grp)) return sys.grp;
    return null;
  }
  if (sys.kind === "ground" && ["ad", "armor", "art"].includes(sys.grp)) return sys.grp;
  return null;
}

/** «Кумыс | 100» → { name: "Кумыс", rare: 100 }; обычное имя — rare 0. */
export function parseEntry(line) {
  const [name, n] = String(line).split("|").map(s => s.trim());
  return { name, rare: Math.max(0, Number(n) || 0) };
}

/** Таблицы нации с правками ведущего. */
export function bankOf(nation, edits = savedEdits()) {
  const base = BANK[nation];
  if (!base) return null;
  return Object.fromEntries(Object.keys(KINDS).map(k => [k, (edits?.[nation]?.[k] ?? base[k] ?? []).map(parseEntry).filter(e => e.name)]));
}
function savedEdits() { try { return game.settings.get(SYSTEM_ID, "callsignBank") ?? {}; } catch { return {}; } }

/** Имя из списка: каждый редкий выпадает с шансом 1/rare, иначе случайное обычное; занятые пропускаются, пока есть свободные. */
export function pickName(entries, used = new Set(), rnd = Math.random) {
  for (const e of entries.filter(x => x.rare > 0 && !used.has(x.name))) if (rnd() < 1 / e.rare) return e.name;
  const common = entries.filter(x => !x.rare);
  const free = common.filter(x => !used.has(x.name));
  const list = free.length ? free : common;
  return list.length ? list[Math.floor(rnd() * list.length)].name : null;
}

/**
 * Позывные звена из count машин. used — уже занятые слова и номера сцены (дополняется).
 * Конскрипты в воздухе примерно в половине случаев летают под номерами («305-й», «306-й»), дуэлянты — под словом
 * (элита нации, если есть), гражданские — рейс авиакомпании нации.
 */
export function flightCalls({ nation, kind, tier = "conscript", count = 1, used = new Set(), rnd = Math.random, edits }) {
  const N = NATIONS[nation], bank = bankOf(nation, edits);
  if (!N || !bank || !kind) return [];
  if (kind === "civil") return Array.from({ length: count }, () => {
    let no;
    do no = 100 + Math.floor(rnd() * 9800); while (used.has(`#${no}`));
    used.add(`#${no}`);
    return `${N.airline} ${no}`;
  });
  if (tier === "conscript" && AIR.includes(kind) && rnd() < 0.5) {
    let start, tries = 0;
    const busy = s => Array.from({ length: count }, (_, i) => s + i).some(n => used.has(`#${n}`));
    do start = N.hundreds + 1 + Math.floor(rnd() * Math.max(1, 90 - count)); while (busy(start) && ++tries < 50);
    return Array.from({ length: count }, (_, i) => { used.add(`#${start + i}`); return `${start + i}-й`; });
  }
  const list = tier === "duelist" && bank.elite.length ? bank.elite : kind === "transport" ? [...bank.transport, ...bank.tanker] : bank[kind];
  const name = pickName(list ?? [], used, rnd);
  if (!name) return [];
  used.add(name);
  return Array.from({ length: count }, (_, i) => `${name}${N.sep}${i + 1}`);
}

/** Занятые на сцене слова и номера (по флагам токенов). */
export function usedCalls(tokens) {
  const used = new Set();
  for (const t of tokens) {
    const c = String(t.getFlag?.(SYSTEM_ID, "radioCall") ?? t.flags?.[SYSTEM_ID]?.radioCall ?? "");
    if (!c) continue;
    const num = c.match(/^(\d+)-й$/) ?? c.match(/ (\d+)$/);
    if (num && (/-й$/.test(c) || Object.values(NATIONS).some(n => c.startsWith(n.airline + " ")))) used.add(`#${num[1]}`);
    else used.add(c.replace(/[- ]\d+$/, ""));
  }
  return used;
}

/** Позывной токена в эфире или "" (не выдан). */
export const radioCallOf = doc => String(doc?.getFlag?.(SYSTEM_ID, "radioCall") ?? "");
/** Имя в эфире по документу токена: позывной, иначе имя токена. */
export const radioName = doc => radioCallOf(doc) || doc?.name || "";

/** Нации сторон сцены: { enemy, ally, neutral } (пустая строка — без позывных). */
export const nationsOf = scene => ({ enemy: "", ally: "", neutral: "", ...(scene?.getFlag?.(SYSTEM_ID, "nations") ?? {}) });
const sideKey = s => (s === "ally" || s === "player" ? "ally" : s === "neutral" ? "neutral" : "enemy");

/** Безымянная машина: имя листа как в каталоге (ведущий его не менял), не ас. */
export function unnamed(actor, catalogName) {
  return actor?.type === "npc" && !!catalogName && actor.name === catalogName && !actor.getFlag?.(SYSTEM_ID, "callsign");
}

async function catalogNames() {
  const { hangarCatalog } = await import("./hangar.mjs");
  const cat = await hangarCatalog();
  return new Map([...(cat.npcs ?? []), ...(cat.planeNpcs ?? [])].map(n => [n.key, n.name]));
}

/** Раздать позывные безымянным токенам сцены: звено — токены одного листа, по четыре. all — переназначить и выданные. */
export async function assignScene(scene, { all = false } = {}) {
  if (!game.user.isGM || !scene) return 0;
  const names = await catalogNames(), nations = nationsOf(scene);
  const tokens = [...scene.tokens];
  const used = all ? new Set() : usedCalls(tokens);
  const groups = new Map();
  for (const t of tokens) {
    const a = t.actor, sys = a?.system;
    const nation = nations[sideKey(sys?.side)];
    if (!nation || (!all && radioCallOf(t)) || !unnamed(t.baseActor ?? game.actors.get(t.actorId) ?? a, names.get(sys?.key))) continue;
    const kind = callKind(sys);
    if (!kind) continue;
    const key = `${t.actorId}|${nation}|${kind}|${sys.tier}`;
    (groups.get(key) ?? groups.set(key, []).get(key)).push(t);
  }
  const updates = [];
  for (const [key, list] of groups) {
    const [, nation, kind, tier] = key.split("|");
    list.sort((a, b) => a.name.localeCompare(b.name, "ru", { numeric: true }));
    for (let i = 0; i < list.length; i += 4) {
      const flight = list.slice(i, i + 4);
      const calls = flightCalls({ nation, kind, tier, count: flight.length, used });
      flight.forEach((t, j) => calls[j] && updates.push({ _id: t.id, [`flags.${SYSTEM_ID}.radioCall`]: calls[j] }));
    }
  }
  if (updates.length) await scene.updateEmbeddedDocuments("Token", updates);
  return updates.length;
}

/** Снять выданные позывные со сцены. */
export async function clearScene(scene) {
  const updates = [...(scene?.tokens ?? [])].filter(t => radioCallOf(t)).map(t => ({ _id: t.id, [`flags.${SYSTEM_ID}.-=radioCall`]: null }));
  if (updates.length) await scene.updateEmbeddedDocuments("Token", updates);
  return updates.length;
}

const nationSelect = (name, cur) => `<select name="${name}"><option value="">без позывных</option>${Object.entries(NATIONS).map(([k, n]) => `<option value="${k}" ${k === cur ? "selected" : ""}>${esc(n.name)}</option>`).join("")}</select>`;

/** Окно ведущего: нации сторон сцены, раздать или снять позывные, правка таблиц. */
export async function openCallsigns(scene = game.scenes?.viewed) {
  if (!game.user.isGM || !scene) return;
  const cur = nationsOf(scene);
  const { formDialog } = await import("./dice/rolls.mjs");
  const given = [...scene.tokens].filter(t => radioCallOf(t)).length;
  const data = await formDialog("Позывные", `
    <p class="tb-hint">Безымянным звеньям раздаются позывные по нации и типу машины; в эфире они звучат вместо имени токена. Асов, именные эскадрильи и машины, которые ведущий переименовал, не трогает. На сцене выдано: ${given}.</p>
    <div class="form-group"><label>Противник</label>${nationSelect("enemy", cur.enemy)}</div>
    <div class="form-group"><label>Союзники</label>${nationSelect("ally", cur.ally)}</div>
    <div class="form-group"><label>Нейтралы</label>${nationSelect("neutral", cur.neutral)}</div>
    <div class="form-group"><label>Что сделать</label><select name="act">
      <option value="give">Раздать тем, у кого нет</option><option value="all">Раздать всем заново</option><option value="clear">Снять все</option><option value="none">Только сохранить нации</option></select></div>
    <div class="form-group"><label>Правка таблиц</label>${Object.entries(NATIONS).map(([k, n]) => `<button type="button" data-cs-edit="${k}">${esc(n.name)}</button>`).join(" ")}</div>`,
  { ok: "Готово", width: 440, render: root => root.querySelectorAll("[data-cs-edit]").forEach(b => b.addEventListener("click", () => editBank(b.dataset.csEdit))) });
  if (!data) return;
  await scene.setFlag(SYSTEM_ID, "nations", { enemy: data.enemy, ally: data.ally, neutral: data.neutral });
  if (data.act === "clear") return ui.notifications.info(`Позывные сняты: ${await clearScene(scene)}.`);
  if (data.act === "none") return;
  const n = await assignScene(scene, { all: data.act === "all" });
  ui.notifications.info(n ? `Позывные выданы: ${n}.` : "Позывные: раздавать некому (нет безымянных машин или у сторон не выбрана нация).");
}

/** Правка таблиц нации: строка — позывной, «Имя | N» — редкий, примерно раз из N раздач. */
export async function editBank(nation) {
  const N = NATIONS[nation];
  if (!N || !game.user.isGM) return;
  const edits = savedEdits(), bank = bankOf(nation, edits);
  const { formDialog } = await import("./dice/rolls.mjs");
  const data = await formDialog(`Позывные: ${N.name}`, `
    <p class="tb-hint">Один позывной на строку. «Имя | 100» — редкий, выпадает примерно раз из 100 раздач. Транспорт берёт имена и из заправщиков. Цифровые позывные рядовых полков: ${N.hundreds + 1}–${N.hundreds + 99}, рейсы «${esc(N.airline)}».</p>
    ${Object.entries(KINDS).map(([k, label]) => `<div class="form-group stacked"><label>${esc(label)}</label><textarea name="k_${k}" rows="2">${esc(bank[k].map(e => e.rare ? `${e.name} | ${e.rare}` : e.name).join("\n"))}</textarea></div>`).join("")}
    <div class="form-group"><label><input type="checkbox" name="reset"> Вернуть заготовку</label></div>`, { ok: "Сохранить", width: 460 });
  if (!data) return;
  const next = foundry.utils.deepClone(edits);
  if (data.reset) delete next[nation];
  else next[nation] = Object.fromEntries(Object.keys(KINDS).map(k => [k, String(data[`k_${k}`] ?? "").split("\n").map(s => s.trim()).filter(Boolean)]));
  await game.settings.set(SYSTEM_ID, "callsignBank", next);
  ui.notifications.info(`Позывные: таблицы «${N.name}» ${data.reset ? "вернулись к заготовке" : "сохранены"}.`);
}

export function registerCallsigns() {
  game.settings.register(SYSTEM_ID, "callsignBank", { scope: "world", config: false, type: Object, default: {} });
}
