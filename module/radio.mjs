/* Радиообмен AWACS: реплики субтитрами вверху экрана, как в Ace Combat, и баннер CAUTION, как в Project Wingman.
   Реплики выводит каждый клиент сам из сообщений чата: у сообщения флаг radio (свободная реплика ведущего, молния,
   подкрепления) или карточка, по которой реплику можно составить (захват, пуск по игроку, залп конца раунда).
   Реплики идут строго по очереди; если их скопилось много (конец раунда), лишние сворачиваются в одну строку. */
import { SYSTEM_ID, TB } from "./config.mjs";
import { esc, resolveActor } from "./utils.mjs";

const MAX_QUEUE = 4;
const queue = [], banners = [];
let showing = false, bannerOn = false;

export function registerRadio() {
  game.settings.register(SYSTEM_ID, "radioSubtitles", {
    name: "Радиообмен AWACS субтитрами", hint: "Реплики AWACS (захват, пуск по вам, итоги залпа, подкрепления) вверху экрана. Всё остаётся и в чате.",
    scope: "client", config: true, type: Boolean, default: true
  });
  Hooks.on("createChatMessage", message => { try { fromMessage(message); } catch (err) { console.warn(`${SYSTEM_ID} | радио`, err); } });
  Hooks.on("updateScene", (scene, change) => weatherCall(scene, change));
  Hooks.on("createToken", (doc, options, userId) => reinforcements(doc, userId));
}

/* ---------- откуда берутся реплики ---------- */

const mine = uuid => { const a = uuid ? resolveActor(uuid) : null; return a?.isOwner && !game.user.isGM ? a : null; };
const myPilots = () => game.actors.filter(a => a.type === "pilot" && a.isOwner && !game.user.isGM);

function fromMessage(message) {
  const f = message.flags?.[SYSTEM_ID] ?? {};
  const r = f.radio;
  if (r) {
    if (r.to && !mine(r.to) && !(game.user.isGM && r.gm)) return;
    if (r.text) say(r.speaker ?? "AWACS", r.text, r.tone);
    if (r.caution) caution(r.caution);
    return;
  }
  // захват: владелец цели слышит предупреждение (без звука)
  if (f.rwr) {
    const t = mine(f.rwr.target);
    if (t) say("AWACS", `${callsign(t)}, тебя взяли на захват: ${f.rwr.from}.`, "warn");
    return;
  }
  const c = f.card;
  if (!c) return;
  if (c.maws && !c.delayedResolved) {
    const t = mine(c.targetUuid);
    if (t) say("AWACS", `${callsign(t)}, ракета по тебе! Break!`, "danger");
    return;
  }
  if (c.type === "volley") return volleyCall(c);
}

/** Итоги залпа одной строкой на клиента: что с его ракетами и что с ракетами по нему. */
function volleyCall(c) {
  const parts = [];
  const pilots = myPilots(), names = new Set(pilots.flatMap(p => [p.name, p.system?.callsign, p.prototypeToken?.name]).filter(Boolean));
  for (const r of c.targets ?? []) {
    if (r.missing || r.ship) continue;
    const target = mine(r.uuid);
    if (target) parts.push(r.hit ? `попадание по тебе, ${r.dmg} урона` : `ракеты по тебе прошли мимо`);
    const shooters = String(r.shooters ?? r.source ?? "").split(", ").filter(n => names.has(n));
    if (shooters.length) parts.push(r.hit ? `${r.name}: попадание` : `${r.name}: ракета прошла мимо цели`);
  }
  if (game.user.isGM) {
    const hits = (c.targets ?? []).filter(r => r.hit).length, all = (c.targets ?? []).filter(r => !r.missing && !r.ship).length;
    if (all) parts.push(`залп: попаданий ${hits} из ${all}`);
  }
  if (parts.length) say("AWACS", cap(parts.join(". ")) + ".", parts.some(p => p.includes("по тебе, ")) ? "danger" : "info");
}

/** Смена погоды над всей сценой. */
function weatherCall(scene, change) {
  const next = foundry.utils.getProperty(change, `flags.${SYSTEM_ID}.weather`);
  if (!next || scene.id !== game.scenes.viewed?.id) return;
  const names = next.map(id => TB.weather[id]?.name).filter(Boolean);
  say("AWACS", names.length ? `Внимание, меняется погода над районом: ${names.join(", ").toLowerCase()}.` : "Погода над районом проясняется.", "info");
}

/* Подкрепления: ведущий объявляет вражеского аса, эскадрилью или супероружие, появившиеся на сцене во время боя. */
let pending = [], pendTimer = null;
function reinforcements(doc, userId) {
  if (userId !== game.user.id || !game.user.isGM || !game.combat?.started || doc.parent?.id !== game.combat.scene?.id) return;
  const a = doc.actor;
  if (a?.type !== "npc" || (a.system.side ?? "enemy") !== "enemy") return;
  const boss = a.system.grp === "boss", ace = a.system.tier === "ace", squad = a.system.tier === "duelist" && a.system.squad;
  if (!boss && !ace && !squad) return;
  pending.push({ name: doc.name, base: a.name, boss, ace, squad: squad || "" });
  clearTimeout(pendTimer);
  pendTimer = setTimeout(announce, 400);
}
async function announce() {
  const list = pending; pending = [];
  const boss = list.find(x => x.boss), squads = [...new Set(list.map(x => x.squad).filter(Boolean))], aces = list.filter(x => x.ace && !x.boss);
  let caution, text;
  if (boss) { caution = { level: "warning", title: "WARNING", sub: `Супероружие: ${boss.base}` }; text = `Всем бортам: в районе ${boss.base}. Повторяю, ${boss.base}!`; }
  else if (squads.length) { caution = { title: "CAUTION", sub: `Вражеская эскадрилья «${squads[0]}»` }; text = `Приближается эскадрилья противника «${squads[0]}». Это не новички, будьте внимательны.`; }
  else if (aces.length) { caution = { title: "CAUTION", sub: `Вражеский ас: ${aces[0].name}` }; text = `Внимание, вражеский ас: ${aces[0].name}. Не дайте ему зайти в хвост.`; }
  else return;
  await sendRadio({ text, caution });
}

/** Реплика AWACS всем (и в чат): ведущий из панели, подкрепления и т. п. */
export function sendRadio({ speaker = "AWACS", text = "", caution = null, tone = caution ? "warn" : "info" }) {
  const body = [caution ? `<div class="tb-radio-caution-line">-- ${esc(caution.title)} -- ${esc(caution.sub ?? "")}</div>` : "", text ? `<div class="tb-note"><b>${esc(speaker)}:</b> «${esc(text)}»</div>` : ""].join("");
  return ChatMessage.create({ speaker: { alias: speaker }, content: `<div class="tb-card tb-card-radio">${body}</div>`,
    flags: { [SYSTEM_ID]: { radio: { speaker, text, caution, tone } } } });
}

/* ---------- вывод ---------- */

const callsign = a => a.system?.callsign || a.token?.name || a.name;
const plural = (n, one, few, many) => n % 10 === 1 && n % 100 !== 11 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? few : many;
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const enabled = () => { try { return game.settings.get(SYSTEM_ID, "radioSubtitles"); } catch { return true; } };

export function say(speaker, text, tone = "info") {
  if (!enabled() || !text) return;
  const last = queue.at(-1);
  if (last && last.text === text) return;
  queue.push({ speaker, text, tone });
  // конец раунда: не больше MAX_QUEUE реплик, остальное одной строкой
  if (queue.length > MAX_QUEUE) {
    const extra = queue.splice(MAX_QUEUE - 1);
    const n = extra.reduce((s, x) => s + (x.count ?? 1), 0);
    queue.push({ speaker: "AWACS", text: `И ещё ${n} ${plural(n, "сообщение", "сообщения", "сообщений")}, подробности в чате.`, tone: extra.some(x => x.tone === "danger") ? "danger" : "info", count: n });
  }
  if (!showing) next();
}

function box(id) {
  let el = document.getElementById(id);
  if (!el) { el = document.createElement("div"); el.id = id; el.setAttribute("aria-live", "polite"); document.body.append(el); }
  return el;
}

function next() {
  const item = queue.shift();
  const el = box("tb-radio");
  if (!item) { showing = false; el.classList.remove("on"); return; }
  showing = true;
  el.className = `tb-radio-${item.tone}`;
  el.innerHTML = `<div class="tb-radio-who">${esc(item.speaker)}</div><div class="tb-radio-line"><span class="q">«</span> ${esc(item.text)} <span class="q">»</span></div>`;
  void el.offsetWidth;
  el.classList.add("on");
  const ms = Math.min(7000, 2200 + item.text.length * 45);
  setTimeout(() => { el.classList.remove("on"); setTimeout(next, 350); }, ms);
}

export function caution({ title = "CAUTION", sub = "", level = "caution" } = {}) {
  if (!enabled()) return;
  banners.push({ title, sub, level });
  if (!bannerOn) nextBanner();
}

function nextBanner() {
  const b = banners.shift();
  const el = box("tb-caution");
  if (!b) { bannerOn = false; el.classList.remove("on"); return; }
  bannerOn = true;
  el.className = `tb-caution-${b.level}`;
  el.innerHTML = `<div class="tb-caution-frame"><div class="tb-caution-title">-- ${esc(b.title)} --</div><div class="tb-caution-sub">${esc(b.sub)}</div></div>`;
  void el.offsetWidth;
  el.classList.add("on");
  setTimeout(() => { el.classList.remove("on"); setTimeout(nextBanner, 500); }, 4200);
}

/* ---------- радио ведущего ---------- */

const PRESETS = {
  custom: { label: "Свой текст", text: "", banner: "", sub: "" },
  reinf: { label: "Подкрепление противника", text: "Радар засёк подкрепление противника. Ожидайте контакт.", banner: "CAUTION", sub: "Подкрепление противника" },
  squad: { label: "Эскадрилья противника", text: "Приближается эскадрилья противника. Это не новички, будьте внимательны.", banner: "CAUTION", sub: "Вражеская эскадрилья" },
  ace: { label: "Вражеский ас", text: "Внимание, в районе вражеский ас. Не дайте ему зайти в хвост.", banner: "CAUTION", sub: "Вражеский ас" },
  weapon: { label: "Супероружие", text: "Всем бортам: в районе супероружие противника. Держитесь вне зоны поражения!", banner: "WARNING", sub: "Супероружие противника" },
  weather: { label: "Смена погоды", text: "Внимание, погода над районом меняется.", banner: "", sub: "" },
  sam: { label: "Пуски ЗРК", text: "Фиксирую пуски ЗРК с земли. Снижайтесь и маневрируйте!", banner: "CAUTION", sub: "Активность ПВО" },
  ally: { label: "Союзное подкрепление", text: "Союзное подкрепление на подходе. Держитесь!", banner: "", sub: "" },
  escape: { label: "Цель уходит", text: "Цель уходит из района! Не дайте ей скрыться.", banner: "", sub: "" },
  rtb: { label: "Возврат на базу", text: "Задание выполнено. Всем бортам, возвращайтесь на базу.", banner: "", sub: "" }
};

/** Окно «Радио» для ведущего: заготовка или свой текст, по желанию баннер CAUTION или WARNING. */
export function openRadioDialog() {
  if (!game.user.isGM) return;
  const opts = Object.entries(PRESETS).map(([k, p]) => `<option value="${k}">${esc(p.label)}</option>`).join("");
  const content = `<form class="tb-dialog tb-radio-form">
    <div class="form-group"><label>Заготовка</label><select name="preset">${opts}</select></div>
    <div class="form-group"><label>Кто говорит</label><input type="text" name="speaker" value="AWACS"></div>
    <div class="form-group stacked"><label>Реплика</label><textarea name="text" rows="3"></textarea></div>
    <div class="form-group"><label>Баннер</label><select name="banner"><option value="">Без баннера</option><option value="CAUTION">CAUTION (жёлтый)</option><option value="WARNING">WARNING (красный)</option></select></div>
    <div class="form-group"><label>Подпись баннера</label><input type="text" name="sub"></div>
    <p class="tb-hint">Реплика появится вверху экрана у всех игроков и останется в чате.</p></form>`;
  new Dialog({
    title: "Радио AWACS", content,
    buttons: {
      ok: { icon: '<i class="fas fa-tower-broadcast"></i>', label: "В эфир", callback: html => {
        const f = html[0].querySelector("form");
        const text = f.text.value.trim(), banner = f.banner.value, sub = f.sub.value.trim();
        if (!text && !banner) return;
        sendRadio({ speaker: f.speaker.value.trim() || "AWACS", text,
          caution: banner ? { title: banner, sub, level: banner === "WARNING" ? "warning" : "caution" } : null });
      } },
      cancel: { label: "Отмена" }
    },
    default: "ok",
    render: html => {
      const f = html[0].querySelector("form");
      f.preset.addEventListener("change", () => {
        const p = PRESETS[f.preset.value];
        f.text.value = p.text; f.banner.value = p.banner; f.sub.value = p.sub;
      });
    }
  }, { classes: ["dialog", "thunderbolt"], width: 420 }).render(true);
}
