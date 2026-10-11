/* Заставка АСУ «Тайга» перед брифингом: экран штабной ЭВМ поверх всего у всех игроков сразу.
   Длинная версия: самопроверка и лог подключения к узлам связи, щит ВВС, загрузка, допуск с паузой раздумья, сетка карты.
   Короткая: сразу щит, допуск без паузы. Пять режимов связи: обычная, резерв, автономно, совместно с Осеей (рядом
   выезжает знак OADF), перехват (подмена адресов на осейские, разрыв). Ведущий запускает кнопкой на панели токенов;
   настройки запоминаются во флаге сцены boot, название операции по умолчанию берётся из миссии сцены.
   Звук собран в WebAudio (реле, гул трансформатора, телетайп), громкость — настройка «Громкость звуков» и канал «Интерфейс». */
import { SYSTEM_ID } from "./config.mjs";
import { esc } from "./utils.mjs";

const CHANNEL = `system.${SYSTEM_ID}`;

export const GRIFS = ["Для служебного пользования", "Секретно", "Совершенно секретно", "Особой важности"];
export const LINK_MODES = { main: "Связь в норме", reserve: "Резервные каналы", offline: "Автономно, без связи", joint: "Совместно с Осеей", intercept: "Перехват: подмена адресов" };
export const PHOSPHORS = { mint: "Брифинг (зелёный)", amber: "Янтарь", red: "Тревога (красный)" };
export const BOOT_DEFAULT = { op: "", grif: "Совершенно секретно", link: "main", len: "long", ph: "mint" };

// лог загрузки. Терминал на КОИ-7, поэтому только заглавные. Классы: hd заголовок, code текст программы,
// rem комментарий, warn предупреждение; третий элемент — ответ узла (массив — по очереди, «!» — отказ)
const HEAD = [
  ["hd", "ВВС СОЮЗА ЮКТОБАНСКИХ РЕСПУБЛИК"],
  ["hd", "АСУ «ТАЙГА» · ВЕРСИЯ 4.07 · СИНИГРАД"],
  ["rem", "ЭВМ «ТАЙГА-4М» · ЗАВОД «ВЫЧМАШ», ДРЕЗДЕНЕ · ДОКУМЕНТАЦИЯ ПО ГОСТ 19.101-77"],
  ["", ""],
  ["", "ПИТАНИЕ 380 В · 50 ГЦ", "НОРМА"],
  ["", "ОЗУ НА ФЕРРИТОВЫХ СЕРДЕЧНИКАХ", "4096 К"],
  ["", "ТРОИЧНЫЙ СОПРОЦЕССОР «СЕТУНЬ-Ю»", "+1 0 −1 · ИСПРАВЕН"],
  ["", "НМЛ-1 · ЛЕНТА «КЕДР-07»", "СМОНТИРОВАНА"],
  ["", "МОНИТОР ДИСПАК-Ю 7.2", "ЗАГРУЖЕН"],
  ["", ""],
  ["code", "//ТАЙГА   ЗАДАНИЕ (703,ГРОЗА),'КП ПОЛКА',КЛАСС=А,ПРИОР=15"],
  ["code", "//ШАГ1    ВЫП    ПРОГ=СВЯЗЬ,РЕГИОН=512К,ВРЕМЯ=(0,30)"],
  ["code", "//КАНАЛЫ  ОД     ДИСП=СТАР,ТОМ=СЕР=КЕДР07,МЕТКА=(3,СН)"],
  ["code", "//ВЫВОД   ОД     ВЫВОД=А,ЭКЗ=1"],
  ["code", "АЛГ ПОДКЛЮЧИТЬ (АРГ ЛИТ УЗЕЛ, РЕЗ ЛОГ ГОТОВ)"],
  ["code", "НАЧ ЦЕЛ П"],
  ["code", "  НЦ ДЛЯ П ОТ 1 ДО 3"],
  ["code", "    ЗАПРОС(УЗЕЛ, «ТАЙГА», КЛЮЧ 7-3)"],
  ["code", "    ЕСЛИ ОТВЕТ = «ПРИНЯТО» ТО ГОТОВ := ДА; ВЫХОД ВСЕ"],
  ["code", "  КЦ"],
  ["code", "КОН"],
  ["rem", "|  ТРАНСЛЯЦИЯ: АЛГОЛ-ЮК 3.1 · ОШИБОК 0 · ПРЕДУПРЕЖДЕНИЙ 2 (НЕ ВАЖНО)"],
  ["", ""],
  "LINK",
  ["code", "АЛГ ПУСК; НАЧ ВЫВОД «ПОЕХАЛИ!» КОН"],
  ["", ""],
  ["warn", ""]
];

const LINK = {
  main: [
    ["", "ШИФРАТОР «КЕДР» · КЛЮЧ 7-3", "ПРИНЯТ"],
    ["", "ПОДКЛЮЧИТЬ «БАЙКАЛ» · ШТАБ ВВС", "ПРИНЯТО · 1200 БОД"],
    ["", "ПОДКЛЮЧИТЬ «КУПОЛ» · ДРЛО", "ПРИНЯТО · 2400 БОД"],
    ["", "ПОДКЛЮЧИТЬ «БЕРЁЗА» · РП АЭРОДРОМА", "ПРИНЯТО"],
    ["", "ПОДКЛЮЧИТЬ «ВИСНА» · КРЕПОСТЬ КРУИК", ["ПОВТОР 2", " ПРИНЯТО"]],
    ["", "ПОДКЛЮЧИТЬ «КВАНТ» · ОКЧАБУРСК", "ПРИНЯТО"],
    ["", "ПОДКЛЮЧИТЬ «СКИНФАКСИ» · ВМФ", "!ОТКАЗ: НЕДОСТАТОЧНО ПРАВ"],
    ["", "РЛС ДАЛЬНЕГО ОБНАРУЖЕНИЯ", "ДАННЫЕ ПОСТУПАЮТ"],
    ["", "КАТАЛОГ ОБЛОМКОВ «УЛИСС-1999»", "ОБНОВЛЁН · АРКБЁРД"],
    ["", "СВОДКА ПО СОТОА · ИБИРШ", "ПОЛУЧЕНА"],
    ["", "ЭСКАДРИЛЬЯ «ГРОЗА»", "НА СВЯЗИ"],
    ["", "КАРТА РАЙОНА", "ЗАГРУЖЕНА"]
  ],
  reserve: [
    ["", "ШИФРАТОР «КЕДР» · КЛЮЧ 7-3", "ПРИНЯТ"],
    ["", "ПОДКЛЮЧИТЬ «БАЙКАЛ» · ШТАБ ВВС", ["ПОВТОР 2", " ПОВТОР 3", " !НЕТ ОТВЕТА"]],
    ["", "ПОДКЛЮЧИТЬ «КУПОЛ» · ДРЛО", ["ПОВТОР 2", " ПОВТОР 3", " !НЕТ ОТВЕТА"]],
    ["rem", "|  ОСНОВНЫЕ УЗЛЫ НЕДОСТУПНЫ · ПРОГ=СВЯЗЬ,РЕЖИМ=РЕЗЕРВ"],
    ["code", "ЕСЛИ НЕ ГОТОВ ТО УЗЕЛ := РЕЗЕРВ(УЗЕЛ); ПОДКЛЮЧИТЬ(УЗЕЛ, ГОТОВ) ВСЕ"],
    ["", "ПОДКЛЮЧИТЬ «БАЙКАЛ-2» · ЗКП ОКЧАБУРСК", "ПРИНЯТО · 300 БОД"],
    ["", "ПОДКЛЮЧИТЬ «КУПОЛ-2» · ТРОПОСФЕРНАЯ ЛИНИЯ", ["ПОВТОР 2", " ПРИНЯТО"]],
    ["", "ПОДКЛЮЧИТЬ «БЕРЁЗА» · РП АЭРОДРОМА", "ПРИНЯТО"],
    ["", "ПОДКЛЮЧИТЬ «ВИСНА» · КРЕПОСТЬ КРУИК", "ПРИНЯТО · КВ-РАДИО"],
    ["", "РЛС ДАЛЬНЕГО ОБНАРУЖЕНИЯ", "ЗАДЕРЖКА 40 С"],
    ["", "КАТАЛОГ ОБЛОМКОВ «УЛИСС-1999»", "!НЕ ОБНОВЛЁН"],
    ["", "СВОДКА ПО СОТОА · ИБИРШ", "ВЧЕРАШНЯЯ"],
    ["", "ЭСКАДРИЛЬЯ «ГРОЗА»", "НА СВЯЗИ"],
    ["", "КАРТА РАЙОНА", "ЗАГРУЖЕНА"]
  ],
  offline: [
    ["", "ШИФРАТОР «КЕДР» · КЛЮЧ 7-3", "ПРИНЯТ"],
    ["", "ПОДКЛЮЧИТЬ «БАЙКАЛ» · ШТАБ ВВС", ["ПОВТОР 2", " ПОВТОР 3", " !НЕТ НЕСУЩЕЙ"]],
    ["", "ПОДКЛЮЧИТЬ «БАЙКАЛ-2» · ЗКП ОКЧАБУРСК", ["ПОВТОР 2", " !НЕТ НЕСУЩЕЙ"]],
    ["", "ПОДКЛЮЧИТЬ «КУПОЛ» · ДРЛО", "!НЕТ НЕСУЩЕЙ"],
    ["", "КВ-РАДИО · ДЕЖУРНАЯ ЧАСТОТА", "!ТИШИНА"],
    ["rem", "|  ВНЕШНЕЙ СВЯЗИ НЕТ · ПРОГ=СВЯЗЬ,РЕЖИМ=АВТОНОМНО"],
    ["code", "ИНАЧЕ ДАННЫЕ := ЧИТАТЬ(ЛЕНТА «КЕДР-07»); ВЫВОД «РАБОТА БЕЗ СВЯЗИ» ВСЕ"],
    ["", "ЛЕНТА «КЕДР-07» · ПОСЛЕДНЯЯ ЗАПИСЬ", "ПРОЧИТАНА"],
    ["", "РЛС ДАЛЬНЕГО ОБНАРУЖЕНИЯ", "!НЕТ ДАННЫХ"],
    ["", "ОБСТАНОВКА", "ПО ПОСЛЕДНЕЙ СВОДКЕ"],
    ["", "ЭСКАДРИЛЬЯ «ГРОЗА»", "В ПОМЕЩЕНИИ"],
    ["", "КАРТА РАЙОНА", "С ЛЕНТЫ"]
  ],
  // финальные миссии: Юктобания и Осея воюют вместе, боевые данные идут через общий шлюз
  joint: [
    ["", "ШИФРАТОР «КЕДР» · КЛЮЧ 7-3", "ПРИНЯТ"],
    ["", "ПОДКЛЮЧИТЬ «БАЙКАЛ» · ШТАБ ВВС", "ПРИНЯТО · 1200 БОД"],
    ["rem", "|  ПРОГ=СВЯЗЬ,РЕЖИМ=СОВМЕСТНО · ПРИКАЗ ГЕНШТАБА · ОСНОВАНИЕ: СОГЛАШЕНИЕ"],
    ["", "ШЛЮЗ «МОСТ» · СИЛЫ ОБОРОНЫ ОСЕИ", ["ПОВТОР 2", " ПРИНЯТО"]],
    ["", "ПЕРЕКОДИРОВКА КОИ-7 / ASCII", "ВКЛЮЧЕНА"],
    ["", "ОТВЕТ УЗЛА", "OSEAN DEFENSE FORCES · AUTH OK"],
    ["", "КЛЮЧ СОВМЕСТНОЙ СЕТИ", "ПРИНЯТ · ОБМЕН РАЗРЕШЁН"],
    ["", "АДРЕС УЗЛА «КУПОЛ»", "ОУРЭД · ОСЕЯ"],
    ["code", "ДЛЯ ВСЕХ УЗЛОВ: ЕСЛИ СОЮЗНИК(УЗЕЛ) ТО ОБМЕН(УЗЕЛ, БОЕВЫЕ) ВСЕ"],
    ["", "ДРЛО ОСЕИ · ОБЩАЯ КАРТИНА", "ДАННЫЕ ПОСТУПАЮТ"],
    ["", "ПОЗЫВНЫЕ СОЮЗНИКОВ", "ЗАГРУЖЕНЫ"],
    ["", "ОПОЗНАВАНИЕ «СВОЙ-ЧУЖОЙ»", "ОСЕЯ = СВОЙ"],
    ["", "ЭСКАДРИЛЬЯ «ГРОЗА»", "НА СВЯЗИ"],
    ["", "КАРТА РАЙОНА", "ОБЩАЯ"]
  ],
  // узлы отвечают, но адреса в таблице маршрутов кто-то переписал на осейские
  intercept: [
    ["", "ШИФРАТОР «КЕДР» · КЛЮЧ 7-3", "ПРИНЯТ"],
    ["", "ПОДКЛЮЧИТЬ «БАЙКАЛ» · ШТАБ ВВС", ["ПОВТОР 2", " ПРИНЯТО"]],
    ["", "ПОДКЛЮЧИТЬ «КУПОЛ» · ДРЛО", "ПРИНЯТО"],
    ["rem", "|  ТАБЛИЦА МАРШРУТОВ ИЗМЕНЕНА ИЗВНЕ · 03:12 · ИСТОЧНИК НЕ УКАЗАН"],
    ["", "АДРЕС УЗЛА «БАЙКАЛ»", "!ОУРЭД · ОСЕЯ"],
    ["", "АДРЕС УЗЛА «КУПОЛ»", "!ОУРЭД · ОСЕЯ"],
    ["", "АДРЕС УЗЛА «БЕРЁЗА»", "!ОУРЭД · ОСЕЯ"],
    ["", "ОТВЕТ УЗЛА", "!OSEAN DEFENSE FORCES · AUTH OK"],
    ["rem", "|  ЛАТИНСКИЙ НАБОР В КАНАЛЕ · КОИ-7 Н0 · ТЕРМИНАЛОМ НЕ ПРЕДУСМОТРЕН"],
    ["", "ПРОВЕРКА КЛЮЧА 7-3", "!НЕСОВПАДЕНИЕ"],
    ["code", "ЕСЛИ АДРЕС(УЗЕЛ) НЕ СВОЙ ТО РАЗОРВАТЬ(ВСЕ); ТРЕВОГА(«КЕДР») ВСЕ"],
    ["", "КАНАЛЫ СВЯЗИ", "!РАЗОРВАНЫ"],
    ["", "ДОКЛАД В ОСОБЫЙ ОТДЕЛ", "ПЕРЕДАН НАРОЧНЫМ"],
    ["", "ЛЕНТА «КЕДР-07» · ПОСЛЕДНЯЯ ЗАПИСЬ", "ПРОЧИТАНА"],
    ["", "ЭСКАДРИЛЬЯ «ГРОЗА»", "В ПОМЕЩЕНИИ"],
    ["", "КАРТА РАЙОНА", "С ЛЕНТЫ"]
  ]
};
// [строка СВЯЗЬ под допуском, подпись в углу экрана]
export const LINK_NAME = { main: ["ОСНОВНАЯ", "СВЯЗЬ"], reserve: ["РЕЗЕРВНАЯ · ДАННЫЕ ЗАПАЗДЫВАЮТ", "РЕЗЕРВ"], offline: ["НЕТ · ДАННЫЕ С ЛЕНТЫ", "АВТОНОМНО"],
  joint: ["СОВМЕСТНАЯ · ЮКТОБАНИЯ И ОСЕЯ", "СОВМЕСТНО"], intercept: ["РАЗОРВАНА · ПОДМЕНА АДРЕСОВ", "ПЕРЕХВАТ"] };
const LINK_WARN = { reserve: "ВНИМАНИЕ: РАБОТА ПО РЕЗЕРВНЫМ КАНАЛАМ. ДАННЫЕ МОГУТ ЗАПАЗДЫВАТЬ.", offline: "ВНИМАНИЕ: СВЯЗИ НЕТ. ОБСТАНОВКА НА МОМЕНТ ПОСЛЕДНЕЙ ЗАПИСИ.",
  joint: "ВНИМАНИЕ: СОВМЕСТНЫЙ РЕЖИМ. ДАННЫЕ ПЕРЕДАЮТСЯ СОЮЗНИКУ.", intercept: "ВНИМАНИЕ: ВОЗМОЖЕН ПЕРЕХВАТ. В ЭФИР НЕ ВЫХОДИТЬ ДО РАСПОРЯЖЕНИЯ." };
// у известных степеней грифа своя строка предупреждения в конце самопроверки
const WARN = {
  "ДЛЯ СЛУЖЕБНОГО ПОЛЬЗОВАНИЯ": "ВНИМАНИЕ: ДЛЯ СЛУЖЕБНОГО ПОЛЬЗОВАНИЯ. ВЫНОС ЗАПРЕЩЁН.",
  "СЕКРЕТНО": "ВНИМАНИЕ: ДАННЫЕ СЕКРЕТНЫ. ПОСТОРОННИМ ПОКИНУТЬ ПОМЕЩЕНИЕ.",
  "СОВЕРШЕННО СЕКРЕТНО": "ВНИМАНИЕ: ДАННЫЕ СЕКРЕТНЫ. ПОСТОРОННИМ ПОКИНУТЬ ПОМЕЩЕНИЕ.",
  "ОСОБОЙ ВАЖНОСТИ": "ВНИМАНИЕ: ОСОБАЯ ВАЖНОСТЬ. ДОКЛАД ТОЛЬКО ЛИЧНО КОМАНДИРУ."
};
export const DOTS = 44;   // ширина колонки до ответа

export const grifOf = g => (String(g ?? "").trim() || BOOT_DEFAULT.grif).toUpperCase().replace(/\s+/g, " ");
export const warnOf = g => WARN[g] ?? `ВНИМАНИЕ: ГРИФ «${g}». ПОСТОРОННИМ ПОКИНУТЬ ПОМЕЩЕНИЕ.`;
export const grifLabel = g => g === "ОСОБОЙ ВАЖНОСТИ" ? "СОВ. СЕКРЕТНО · ОСОБОЙ ВАЖНОСТИ" : g;

/** Строки лога для режима связи: блок узлов вместо метки LINK, перед общим предупреждением — предупреждение режима. */
export function linesFor(mode) {
  const link = LINK[mode] ? mode : "main";
  return HEAD.flatMap((l, i) => l === "LINK" ? LINK[link] : i === HEAD.length - 1 && LINK_WARN[link] ? [["warn", LINK_WARN[link]], l] : [l]);
}

/** Строка лога как её печатает терминал: ответ отбит точками до колонки DOTS. */
export const logText = ([cls, label, res], grif) => cls === "warn" && !label ? warnOf(grif) : res ? `${label} `.padEnd(DOTS, ".") : label;

/** Настройки заставки: сохранённые на сцене, иначе по умолчанию с названием миссии сцены. */
export function bootOptions(scene, over = {}) {
  const saved = scene?.getFlag?.(SYSTEM_ID, "boot") ?? {};
  const o = { ...BOOT_DEFAULT, ...saved, ...over };
  o.op = String(o.op ?? "").trim() || String(scene?.getFlag?.(SYSTEM_ID, "mission") || scene?.navName || scene?.name || "Учебный вылет").trim();
  if (!LINK[o.link]) o.link = "main";
  if (!PHOSPHORS[o.ph]) o.ph = "mint";
  o.len = o.len === "short" ? "short" : "long";
  o.grif = String(o.grif ?? "").trim().slice(0, 40) || BOOT_DEFAULT.grif;
  o.op = o.op.slice(0, 40);
  return o;
}

const YUK = `<svg class="yuk" viewBox="-130 -130 260 260" aria-hidden="true"><circle class="back" r="121"/><defs><path id="tb-boot-arc" d="M -103 0 A 103 103 0 1 1 103 0 A 103 103 0 1 1 -103 0"/></defs><circle class="ring draw" r="118" style="--len:742;--dur:1.1s"/><circle class="ring thin draw" r="112" style="--len:704;--dur:1.3s"/><circle class="ring thin draw" r="90" style="--len:566;--dur:1.2s"/><text><textPath href="#tb-boot-arc" startOffset="0">ВОЕННО-ВОЗДУШНЫЕ СИЛЫ · СОЮЗ ЮКТОБАНСКИХ РЕСПУБЛИК ·</textPath></text><g transform="scale(.84)"><g class="embfill"><path class="field" d="M-55 -69 L55 -69 L55 7 Q53 45 0 75 Q-53 45 -55 7 Z"/><path class="gold" d="M-30 -56 L-39 -40.4 L-21 -40.4 Z M-41 -38 L-50 -22.4 L-32 -22.4 Z M-19 -38 L-28 -22.4 L-10 -22.4 Z"/><path class="gold" d="M-27 34 L-12 34 L55 -50 L55 -69 L49 -69 Z"/></g><path class="emb draw" style="--len:560;--dur:1.6s" d="M-64 -70 Q-64 -78 -56 -78 L56 -78 Q64 -78 64 -70 L64 8 Q62 52 0 86 Q-62 52 -64 8 Z"/><path class="emb thin draw" style="--len:480;--dur:1.6s" d="M-55 -69 L55 -69 L55 7 Q53 45 0 75 Q-53 45 -55 7 Z"/><path class="emb draw" style="--len:170;--dur:.9s" d="M-30 -56 L-39 -40.4 L-21 -40.4 Z M-41 -38 L-50 -22.4 L-32 -22.4 Z M-19 -38 L-28 -22.4 L-10 -22.4 Z"/><path class="emb draw" style="--len:290;--dur:1.1s" d="M-27 34 L-12 34 L55 -50 L55 -69 L49 -69 Z"/><text class="embt embfill" x="0" y="57" text-anchor="middle">Y.A.F.</text></g></svg>`;
const OSEA = `<svg class="osea" viewBox="-130 -130 260 260" aria-hidden="true"><g transform="scale(.95)"><g class="embfill"><path class="gold" fill-rule="evenodd" d="M0 -97 A97 97 0 0 1 0 97 Z M0.00 -97.00 L21.78 -29.97 L92.25 -29.97 L35.24 11.45 L57.02 78.47 L0.00 37.05 L-57.02 78.47 L-35.24 11.45 L-92.25 -29.97 L-21.78 -29.97 Z M0.00 37.05 L-8.32 11.45 L-35.24 11.45 L-13.46 -4.37 L-21.78 -29.97 L-0.00 -14.15 L21.78 -29.97 L13.46 -4.37 L35.24 11.45 L8.32 11.45 Z"/></g><circle class="emb draw" r="100" style="--len:628;--dur:1.3s;stroke-width:3.4"/><path class="emb draw" style="--len:705;--dur:1.5s" d="M0.00 -97.00 L21.78 -29.97 L92.25 -29.97 L35.24 11.45 L57.02 78.47 L0.00 37.05 L-57.02 78.47 L-35.24 11.45 L-92.25 -29.97 L-21.78 -29.97 Z"/><path class="emb thin draw" style="--len:269;--dur:.9s" d="M0.00 37.05 L-8.32 11.45 L-35.24 11.45 L-13.46 -4.37 L-21.78 -29.97 L-0.00 -14.15 L21.78 -29.97 L13.46 -4.37 L35.24 11.45 L8.32 11.45 Z"/><path class="emb thin draw" style="--len:194" d="M0 -97 L0 97"/><text class="embt embfill" x="0" y="124" text-anchor="middle">OADF</text></g></svg>`;

/** Разметка экрана. Всё, что ввёл ведущий, экранировано. */
export function bootHtml(o) {
  const grif = grifOf(o.grif), [linkLine, corner] = LINK_NAME[o.link] ?? LINK_NAME.main;
  const joint = o.link === "joint", alarm = !["main", "joint"].includes(o.link);
  const cap = joint ? `АСУ «ТАЙГА» · ШЛЮЗ «МОСТ»<small>ВВС Юктобании · ВВС Осеи · совместный штаб</small>` : `АСУ «ТАЙГА»<small>штаб ВВС · командный пункт</small>`;
  return `<div class="tb-boot-screen"><div class="tb-boot-flicker">
    <div class="tb-boot-layer glow" data-l="log"><div class="tb-boot-log"></div></div>
    <div class="tb-boot-layer glow" data-l="crest"><div class="tb-boot-pair">${YUK}${OSEA}</div><div class="tb-boot-cap">${cap}</div></div>
    <div class="tb-boot-layer glow" data-l="load"><div class="tb-boot-loadrow"><span>ЗАГРУЗКА ДАННЫХ ОПЕРАЦИИ</span><b class="tb-boot-pct">0 %</b></div><div class="tb-boot-bar">${"<i></i>".repeat(40)}</div></div>
    <div class="tb-boot-layer glow" data-l="grant"><div class="tb-boot-stamp"></div>
      <div class="tb-boot-op"><span>ОПЕРАЦИЯ</span> <b>${esc(o.op.toUpperCase())}</b><br><span>ГРИФ</span> ${esc(grifLabel(grif))} · <span>ЭКЗ.</span> 1<br><span>СВЯЗЬ</span> ${esc(linkLine)}</div></div>
    <div class="tb-boot-layer glow" data-l="grid"><div class="tb-boot-gridcap">БРИФИНГ<small>командир эскадрильи, займите место</small></div></div>
    <div class="tb-boot-corner glow">КП «ТАЙГА» · <span${alarm ? ` class="alarm"` : ""}>${esc(corner)}</span> <span class="tb-boot-clock"></span></div>
  </div></div><div class="tb-boot-skip">Esc — пропустить</div>`;
}

/* ---------- звук: аппаратура, а не приставка. Шум и синусы через фильтры ---------- */
class BootAudio {
  constructor(volume) {
    this.vol = volume;
    this.hum = null;
    if (volume <= 0) return;
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.out = this.ctx.createGain(); this.out.gain.value = volume; this.out.connect(this.ctx.destination);
      this.noise = this.ctx.createBuffer(1, this.ctx.sampleRate, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      this.ctx.resume?.().catch(() => null);
    } catch { this.ctx = null; }
  }
  // короткий механический щелчок: шум через полосовой фильтр
  click(freq = 2500, dur = .012, vol = .08, q = 2.5, at = 0) {
    const c = this.ctx; if (!c) return;
    const t = c.currentTime + at, n = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    n.buffer = this.noise; n.playbackRate.value = .8 + Math.random() * .4;
    f.type = "bandpass"; f.frequency.value = freq; f.Q.value = q;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(.0001, t + dur);
    n.connect(f).connect(g).connect(this.out); n.start(t, Math.random() * .5); n.stop(t + dur + .01);
  }
  // реле: два удара, якорь и упор
  relay(vol = .14) { this.click(1800, .02, vol, 1.5); this.click(900, .03, vol * .7, 1.2, .018); this.thump(110, .06, vol * .5); }
  // глухой удар корпуса
  thump(freq = 70, dur = .25, vol = .25, at = 0) {
    const c = this.ctx; if (!c) return;
    const t = c.currentTime + at, o = c.createOscillator(), g = c.createGain();
    o.frequency.setValueAtTime(freq * 1.6, t); o.frequency.exponentialRampToValueAtTime(freq, t + .05);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(.0001, t + dur);
    o.connect(g).connect(this.out); o.start(t); o.stop(t + dur + .02);
  }
  // ровный сигнал аппаратуры: синус с мягким фронтом
  tone(freq = 1000, dur = .2, vol = .04, at = 0) {
    const c = this.ctx; if (!c) return;
    const t = c.currentTime + at, o = c.createOscillator(), g = c.createGain();
    o.frequency.value = freq;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + .015);
    g.gain.setValueAtTime(vol, t + dur - .03); g.gain.linearRampToValueAtTime(0, t + dur);
    o.connect(g).connect(this.out); o.start(t); o.stop(t + dur + .02);
  }
  // гул трансформатора 50 Гц с гармониками; rise — сколько секунд он «раскручивается»
  humOn(rise = 1.2) {
    const c = this.ctx; if (!c || this.hum) return;
    const t = c.currentTime, out = c.createGain(), lp = c.createBiquadFilter();
    lp.type = "lowpass"; lp.frequency.value = 420;
    out.gain.setValueAtTime(0, t); out.gain.linearRampToValueAtTime(.05, t + rise);
    const oscs = [[50, 1], [100, .6], [150, .35], [200, .15]].map(([f, v]) => {
      const o = c.createOscillator(), g = c.createGain();
      o.type = "sawtooth"; o.frequency.setValueAtTime(f * .55, t); o.frequency.exponentialRampToValueAtTime(f, t + rise);
      g.gain.value = v; o.connect(g).connect(lp); o.start(t); return o;
    });
    lp.connect(out).connect(this.out);
    this.hum = { out, oscs };
  }
  humOff(fall = 1.5) {
    const c = this.ctx, h = this.hum; if (!c || !h) return;
    this.hum = null;
    const t = c.currentTime;
    h.out.gain.cancelScheduledValues(t); h.out.gain.setValueAtTime(h.out.gain.value, t); h.out.gain.linearRampToValueAtTime(0, t + fall);
    h.oscs.forEach(o => o.stop(t + fall + .05));
  }
  close(after = 0) { const c = this.ctx; this.ctx = null; if (c) setTimeout(() => c.close().catch(() => null), after); }
}

const setting = (scope, k, d) => { try { return game.settings.get(scope, k); } catch { return d; } };
const volumeNow = () => Number(setting(SYSTEM_ID, "soundVolume", 70)) / 100 * Number(setting("core", "globalInterfaceVolume", 1));

/* ---------- показ ---------- */
let current = null;

/** Убрать заставку у этого клиента (Esc, конец показа, новый запуск). */
export function stopBoot(fade = 0) {
  const c = current; if (!c) return;
  current = null;
  c.stopped = true;
  clearInterval(c.clock);
  document.removeEventListener("keydown", c.onKey, true);
  c.audio.humOff(fade ? fade / 1000 : .2); c.audio.close(fade + 400);
  c.el.classList.add("out");
  setTimeout(() => c.el.remove(), fade || 10);
}

/** Сыграть заставку у этого клиента. */
export async function playBoot(opts = {}) {
  stopBoot();
  const o = bootOptions(null, opts);
  const el = document.createElement("div");
  el.className = "tb-boot";
  el.dataset.ph = o.ph;
  el.innerHTML = bootHtml(o);
  document.body.append(el);
  const audio = new BootAudio(volumeNow());
  const c = current = { el, audio, stopped: false };
  c.onKey = ev => { if (ev.key !== "Escape") return; ev.stopPropagation(); ev.preventDefault(); if (game.user?.isGM) game.socket?.emit(CHANNEL, { type: "bootStop" }); stopBoot(300); };
  document.addEventListener("keydown", c.onKey, true);
  const $ = sel => el.querySelector(sel), layer = n => el.querySelector(`[data-l="${n}"]`);
  const show = (n, on = true) => { layer(n).style.opacity = on ? 1 : 0; };
  const pad = n => String(n).padStart(2, "0");
  const tick = () => { const d = new Date(); $(".tb-boot-clock").textContent = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };
  tick(); c.clock = setInterval(tick, 1000);
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
  const wait = ms => new Promise((res, rej) => setTimeout(() => (c.stopped ? rej("stop") : res()), reduce ? 0 : ms));
  const type = async (node, text, cps) => {
    for (const ch of text) {
      node.textContent += ch;
      if (ch !== " " && (cps < 400 || Math.random() < .3)) audio.click(2200 + Math.random() * 1200, .01, .05 + Math.random() * .03);
      await wait(1000 / cps);
    }
  };
  const short = o.len === "short", joint = o.link === "joint", grif = grifOf(o.grif);
  requestAnimationFrame(() => el.classList.add("on"));
  try {
    // включение: рубильник и разгон трансформатора
    audio.relay(.22); audio.thump(60, .35, .3); audio.humOn(1.4);
    await wait(short ? 300 : 700);
    // 1. самопроверка и подключение; короткая версия начинает сразу с герба
    if (!short) {
      show("log");
      const log = $(".tb-boot-log");
      for (const line of linesFor(o.link)) {
        const [cls, , res] = line;
        const row = document.createElement("div"); if (cls) row.className = cls;
        log.append(row); log.scrollTop = log.scrollHeight;
        await type(row, logText(line, grif), cls === "hd" ? 70 : cls === "code" || cls === "rem" ? 600 : 260);
        for (const part of res ? [res].flat() : []) {
          await wait(part.startsWith(" ") ? 450 : 140);
          const b = document.createElement("span"), bad = part.trim().startsWith("!");
          b.className = bad ? "res bad" : "res"; b.textContent = (part.startsWith(" ") ? " … " : " ") + part.trim().replace(/^!/, "");
          row.append(b);
          if (bad) { audio.thump(90, .12, .2); audio.click(700, .05, .12, 1); } else audio.relay();
        }
        await wait(cls === "warn" ? 300 : cls === "code" ? 40 : 80);
      }
      const cur = document.createElement("span"); cur.className = "tb-boot-cursor"; log.append(cur);
      await wait(900);
      show("log", false);
    }
    // 2. щит ВВС; в совместном режиме из-за него выезжает знак OADF
    show("crest"); $(".tb-boot-corner").style.opacity = 1;
    audio.thump(55, .5, .3);
    el.querySelectorAll(".yuk .draw").forEach((p, i) => setTimeout(() => p.classList.add("on"), i * 160));
    await wait(1900);
    el.querySelectorAll(".yuk .embfill").forEach(e => e.style.opacity = 1);
    if (!joint) $(".tb-boot-cap").style.opacity = 1;
    audio.relay(.18); audio.tone(1000, .35, .035, .08);
    if (joint) {
      await wait(700);
      $(".tb-boot-pair").classList.add("joint"); audio.thump(80, .3, .18);
      el.querySelectorAll(".osea .draw").forEach((p, i) => setTimeout(() => p.classList.add("on"), 300 + i * 110));
      await wait(2000);
      el.querySelectorAll(".osea .embfill").forEach(e => e.style.opacity = 1);
      $(".tb-boot-cap").style.opacity = 1;
      audio.relay(.18); audio.tone(1200, .35, .035, .08);
    }
    await wait(1300);
    // 3. загрузка данных операции
    show("load");
    const cells = el.querySelectorAll(".tb-boot-bar i");
    for (let i = 0; i < cells.length; i++) {
      cells[i].classList.add("on"); $(".tb-boot-pct").textContent = Math.round((i + 1) / cells.length * 100) + " %";
      audio.click(i % 4 === 0 ? 1200 : 3200, .02, i % 4 === 0 ? .1 : .04, 4);
      await wait(i > 30 ? 45 : 28);
    }
    await wait(400);
    // 4. допуск: «ДОСТУП», в длинной версии машина думает, потом «РАЗРЕШЁН»
    show("crest", false); show("load", false); show("grant");
    const st = $(".tb-boot-stamp"), word = document.createElement("span"), cur2 = document.createElement("span");
    cur2.className = "tb-boot-cursor"; st.append(word, cur2);
    await wait(300);
    await type(word, "ДОСТУП", short ? 22 : 14);
    if (!short) {
      for (let k = 0; k < 5; k++) { await wait(200 + Math.random() * 170); if (k % 2) audio.click(1100, .025, .07, 4); }
      await wait(170);
    }
    await type(word, " РАЗРЕШЁН", 22);
    st.classList.add("ok"); audio.relay(.2); audio.tone(1000, .3, .03, .06);
    await wait(350);
    layer("grant").classList.add("on");
    await wait(short ? 900 : 1800);
    // 5. сетка карты, затем экран гаснет и открывается сцена
    show("grant", false); show("grid");
    audio.tone(800, .5, .03); audio.tone(800, .5, .03, .7);
    await wait(2200);
    stopBoot(1200);
  } catch (e) {
    if (e !== "stop") { console.error(`${SYSTEM_ID} | заставка`, e); stopBoot(); }
  }
}

/** Запустить у всех: сохранить настройки на сцене, разослать игрокам, сыграть у себя. */
export async function startBoot(opts = {}, { scene = game.scenes?.viewed, everyone = true } = {}) {
  const o = bootOptions(scene, opts);
  if (game.user?.isGM && scene) await scene.setFlag(SYSTEM_ID, "boot", o).catch(err => console.warn(`${SYSTEM_ID} | заставка: флаг сцены`, err));
  if (everyone) game.socket?.emit(CHANNEL, { type: "boot", opts: o });
  return playBoot(o);
}

export function registerBoot() {
  Hooks.once("ready", () => game.socket.on(CHANNEL, msg => {
    if (msg?.type === "boot") playBoot(msg.opts ?? {});
    else if (msg?.type === "bootStop") stopBoot(300);
  }));
}

/** Окно ведущего: операция, гриф, связь, длина, цвет экрана. */
export function openBootDialog(scene = game.scenes?.viewed) {
  if (!game.user.isGM) return;
  const o = bootOptions(scene);
  const opt = (map, v) => Object.entries(map).map(([k, l]) => `<option value="${k}"${k === v ? " selected" : ""}>${esc(l)}</option>`).join("");
  const content = `<form class="tb-dialog tb-boot-form">
    <div class="form-group"><label>Операция</label><input type="text" name="op" value="${esc(o.op)}" maxlength="40"></div>
    <div class="form-group"><label>Гриф</label><input type="text" name="grif" value="${esc(o.grif)}" maxlength="40" list="tb-boot-grifs">
      <datalist id="tb-boot-grifs">${GRIFS.map(g => `<option value="${esc(g)}"></option>`).join("")}</datalist></div>
    <div class="form-group"><label>Связь</label><select name="link">${opt(LINK_MODES, o.link)}</select></div>
    <div class="form-group"><label>Версия</label><select name="len">${opt({ long: "Длинная: лог подключения, около 25 с", short: "Короткая: сразу щит, около 10 с" }, o.len)}</select></div>
    <div class="form-group"><label>Экран</label><select name="ph">${opt(PHOSPHORS, o.ph)}</select></div>
    <p class="tb-hint">Заставка идёт у всех игроков сразу, поверх стола. Esc пропускает её у себя; у ведущего — у всех. Настройки запоминаются на сцене.</p></form>`;
  const read = html => { const f = html[0].querySelector("form"); return { op: f.op.value, grif: f.grif.value, link: f.link.value, len: f.len.value, ph: f.ph.value }; };
  new Dialog({
    title: "Заставка АСУ «Тайга»", content,
    buttons: {
      all: { icon: '<i class="fas fa-terminal"></i>', label: "Запустить всем", callback: html => startBoot(read(html), { scene }) },
      me: { icon: '<i class="fas fa-eye"></i>', label: "Посмотреть самому", callback: html => startBoot(read(html), { scene, everyone: false }) },
      cancel: { label: "Закрыть" }
    },
    default: "all"
  }, { classes: ["dialog", "thunderbolt"], width: 460 }).render(true);
}
