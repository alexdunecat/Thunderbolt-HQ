/* Справочные константы системы. Тексты на русском, как в Штабе. */
export const SYSTEM_ID = "thunderbolt-shtab";
export const SYS_PATH = `systems/${SYSTEM_ID}/`;

export const TB = {
  skills: {
    aim: { label: "Прицел", en: "Aim", hint: "ракеты по воздушным целям" },
    deploy: { label: "Сброс", en: "Deploy", hint: "ракеты и бомбы по земле и морю" },
    dodge: { label: "Уклонение", en: "Dodge", hint: "Break! против входящих атак" },
    lead: { label: "Лидерство", en: "Lead", hint: "команды союзникам, переговоры" },
    push: { label: "Форсаж", en: "Push", hint: "трюки, сваливание, Strain" },
    strafe: { label: "Пушка", en: "Strafe", hint: "атаки пушкой" }
  },
  // системы для метки Structure
  systems: {
    en: { label: "Двигатели", hint: "−1 Max Speed" },
    fl: { label: "Закрылки", hint: "Strain = 0" },
    ma: { label: "MAWS", hint: "ракеты бьют в начале твоего хода" },
    ms: { label: "Ракеты", hint: "стандартные ракеты недоступны" },
    sw: { label: "Спецоружие", hint: "спецоружие недоступно" },
    gu: { label: "Пушка", hint: "пушка недоступна" }
  },
  altitudes: { low: "Low", med: "Medium", high: "High", strat: "Стратосфера" },
  // высота токена: 1 = Low, 2 = Medium, 3 = High, 4 = стратосфера
  altElevation: { low: 1, med: 2, high: 3, strat: 4 },
  /* Сторона NPC (лист NPC, «Заметки AWACS»). Пилоты игроков всегда своя сторона: "player". Союзник и игроки друг по другу не стреляют. */
  sides: { enemy: "Противник", ally: "Союзник", neutral: "Нейтральный" },
  tiers: { conscript: "Конскрипт", duelist: "Дуэлянт", ace: "Ас" },
  // задача по приоритетной цели (панель AWACS и «Заметки AWACS» листа NPC)
  tasks: { "": "без задачи", destroy: "Уничтожить", protect: "Защитить", escort: "Сопроводить", intercept: "Перехватить", mark: "Отметить",
    recon: "Разведать", capture: "Захватить", reach: "Добраться", disable: "Вывести из строя" },
  npcKinds: { air: "Воздушная цель", ground: "Наземная цель", ship: "Корабль или особая цель" },
  weaponTargets: { air: "по воздуху", ground: "по земле и морю", gun: "пушечный", util: "РЭБ", line: "по линии" },
  weaponKinds: { book: "из книги", hb: "из Ace Combat 5", op: "опытное" },
  triggerTypes: {
    Core: "Core", General: "General", Twist: "Twist", Nemesis: "Nemesis", Death: "Death", Passive: "Passive"
  },
  triggerTypeHints: {
    General: "раз за вылет в любой момент", Twist: "раз за вылет после Поворота", Nemesis: "раз за вылет, когда появилась Немезида",
    Death: "после гибели", Passive: "действует всегда", Core: "стартовый триггер архетипа"
  },
  archetypes: {
    oldguard: { label: "Ветеран (Old Guard)", core: "practiced" },
    rookie: { label: "Новичок (Rookie)", core: "mentor" },
    hotshot: { label: "Сорвиголова (Hotshot)", core: "reckless" },
    chatterbox: { label: "Болтун (Chatterbox)", core: "outside" },
    soldier: { label: "Солдат (Soldier)", core: "byside" },
    knight: { label: "Рыцарь (Knight)", core: "code" },
    merc: { label: "Наёмник (Mercenary)", core: "contract" },
    techno: { label: "Технократ (Technocrat)", core: "tester" },
    borderless: { label: "Анархист (Borderless)", core: "noborders" }
  },
  status: {
    active: "В строю, годен к полётам", hospital: "На лечении", ejected: "Катапультировался, ждёт эвакуации",
    pow: "В плену", mia: "Пропал без вести", kia: "Погиб"
  },
  planeStats: {
    spd: ["Max Speed", "макс. скорость"], ev: ["Evasion", "уклонение"], aa: ["Air-Air", "атака по воздуху"], ag: ["Air-Gnd", "атака по земле"],
    hp: ["Max HP", "прочность"], str: ["Max Strain", "перегрузка"], gun: ["Gun DMG", "урон пушки"], hard: ["Hrd Pnt", "узлы подвески"]
  },
  skins: { brief: "Брифинг", shtab: "Штаб", ac5: "ОС AC5", doc: "Документация" },
  difficulty: 7,
  /* Дальность в зонах: 0 своя, 1 соседние, 2 обычная ракета (захват держится до двух зон), 99 вся зона операции. */
  range: { lockOn: 1, lockHold: 2, missile: 2, guns: 0, operation: 99 },
  /** Большие цели: размер токена в клетках [ширина, длина]; [1, 1] — на всю зону, без деления на места. Вид сверху для вытянутых токенов, если значок нарисован сбоку. */
  /* Большие цели: [ширина, длина] в местах зоны (зона — 3×3 места, обычный самолёт занимает одно). */
  footprints: { strategic: [2, 2], large: [2, 2], arkbird: [2, 3], aerialCruiser: [3, 2], superSub: [1, 3], fleet: [1, 2], longVehicle: [1, 2] },
  /* Длинные наземные машины на 2 места: пока только «Тополь-М» (Alex, 08.10). */
  longVehicles: ["tel"],
  topViews: Object.fromEntries(["superSub", "carrier", "battleship", "cruiser", "destroyer", "frigate", "ship", "sub"]
    .map(k => [`assets/targets/${k}.svg`, `assets/targets/${k}-top.svg`])),
  weaponRange: { RCL: 0, MGP: 0, PLSL: 1, XAGM: 1, "4AAM": 1, ESM: 1, XLAA: 99, LAAM: 99, LACM: 99, EMRG: 99 },
  rangeOptions: { "": "по умолчанию для этого оружия", 0: "своя зона", 1: "своя и соседние", 2: "до двух зон", 99: "вся зона операции" },

  /* Погода (как в Планшете AWACS). mods: ev, aa, ag, push, spd; alts: на каких высотах действует; comp2: Complication на 1–2. */
  weather: {
    clouds: { ico: "☁", name: "Облачность", mods: { ev: 1, aa: -1, ag: -1 }, txt: "+1 Evasion, −1 A-A и A-G; импульсный лазер не бьёт" },
    rain: { ico: "☂", name: "Дождь", mods: { aa: -1, ag: -1 }, txt: "−1 A-A и A-G" },
    dust: { ico: "≋", name: "Пыльная буря", mods: { ev: 2, aa: -2, ag: -2 }, alts: ["low", "med"], ownZone: true, txt: "+2 Evasion, −2 A-A и A-G, цели только в своей зоне; до High не доходит" },
    lightning: { ico: "ϟ", name: "Молния", txt: "Complication на d4 = удар молнии (раз в раунд): −1 Evasion и ракеты только с броском до конца следующего хода" },
    wind: { ico: "↝", name: "Сильный ветер", mods: { push: -1 }, txt: "−1 к Push" },
    tornado: { ico: "⌁", name: "Торнадо", txt: "переход в соседнюю зону = 2 Move; выйти: Push против 7; Complication = урон обломками" },
    hurrW: { ico: "↻", name: "Ураган, по ветру", mods: { spd: 2 }, comp2: true, txt: "+2 к Max Speed, Complication на 1–2" },
    hurrA: { ico: "↺", name: "Ураган, против ветра", mods: { push: -2, aa: -1, ag: -1 }, comp2: true, txt: "−2 Push, −1 A-A и A-G, Complication на 1–2" },
    eye: { ico: "◎", name: "Глаз урагана", txt: "нормальные условия полёта" }
  },

  missileDamage: 5,

  /* Что триггер может менять в чарнике. chosen: навык, выбранный на триггере (оба, если выбрано два). */
  effectTargets: {
    hpMax: "Макс. HP", strainMax: "Макс. Strain", maxSpeed: "Макс. Speed", evasion: "Evasion",
    aa: "Air-Air", ag: "Air-Gnd", gun: "Gun", hardpoints: "Подвески", ammo: "Боезапас выбранного спецоружия",
    allRolls: "Все броски навыков",
    "skill.chosen": "Выбранный навык",
    "skill.aim": "Навык Aim", "skill.deploy": "Навык Deploy", "skill.dodge": "Навык Dodge",
    "skill.lead": "Навык Lead", "skill.push": "Навык Push", "skill.strafe": "Навык Strafe",
    "perk.chosen": "Perk у выбранного навыка выпадает от", "comp.chosen": "Complication у выбранного навыка выпадает до",
    "perk.all": "Perk во всех проверках выпадает от", "comp.all": "Complication во всех проверках выпадает до",
    points: "Очки навыков"
  },
  effectWhen: { always: "всегда", twist: "после Поворота", toggle: "пока включён", stack: "× счётчик серии", proto: "на опытной машине", serial: "на серийной машине" },
  /* Встроенные эффекты книжных триггеров (если у триггера не задан свой список). */
  triggerEffects: {
    armor: [{ target: "hpMax", value: 1, when: "always" }],
    heart: [{ target: "strainMax", value: 3, when: "always" }],
    holding: [{ target: "maxSpeed", value: 1, when: "twist" }],
    blessing: [{ target: "ammo", value: 2, when: "always" }],
    reckless: [{ target: "skill.chosen", value: 2, when: "always" }, { target: "comp.chosen", value: 2, when: "always" }],
    cautious_rk: [{ target: "skill.chosen", value: -1, when: "always" }, { target: "perk.chosen", value: 3, when: "always" }],
    cautious_og: [{ target: "perk.chosen", value: 3, when: "always" }],
    notyou: [{ target: "evasion", value: 1, when: "toggle" }],
    handle: [{ target: "allRolls", value: 2, when: "toggle" }],
    cutchatter: [{ target: "allRolls", value: 1, when: "toggle" }],
    tellme: [{ target: "allRolls", value: 1, when: "toggle" }],
    byside: [{ target: "allRolls", value: 1, when: "toggle" }],
    advevasion: [{ target: "skill.dodge", value: 2, when: "toggle" }],
    divebomb: [{ target: "skill.deploy", value: 2, when: "toggle" }],
    guns: [{ target: "skill.strafe", value: 1, when: "stack" }],
    // архетипы Стрэйнджриала
    // Поединок: +1 к атакам (с броском и без) и к Evasion; Перчатка или Венок поднимают его до +2 (вместе не складываются: group)
    code: [{ target: "skill.aim", value: 1, when: "toggle" }, { target: "skill.strafe", value: 1, when: "toggle" }, { target: "aa", value: 1, when: "toggle" }, { target: "evasion", value: 1, when: "toggle" }],
    gauntlet: [{ target: "skill.aim", value: 1, when: "toggle", group: "duel" }, { target: "skill.strafe", value: 1, when: "toggle", group: "duel" }, { target: "aa", value: 1, when: "toggle", group: "duel" }, { target: "evasion", value: 1, when: "toggle", group: "duel" }],
    wreath: [{ target: "skill.aim", value: 1, when: "toggle", group: "duel" }, { target: "skill.strafe", value: 1, when: "toggle", group: "duel" }, { target: "aa", value: 1, when: "toggle", group: "duel" }, { target: "evasion", value: 1, when: "toggle", group: "duel" }],
    oldschool: [{ target: "gun", value: 2, when: "toggle" }],
    finish: [{ target: "skill.aim", value: 1, when: "toggle" }, { target: "skill.deploy", value: 1, when: "toggle" }, { target: "skill.strafe", value: 1, when: "toggle" }, { target: "aa", value: 1, when: "toggle" }, { target: "ag", value: 1, when: "toggle" }],
    expartner: [{ target: "allRolls", value: 1, when: "toggle" }],
    bill: [{ target: "skill.aim", value: 2, when: "toggle" }, { target: "skill.deploy", value: 2, when: "toggle" }, { target: "skill.strafe", value: 2, when: "toggle" }, { target: "aa", value: 2, when: "toggle" }, { target: "ag", value: 2, when: "toggle" }],
    tester: [{ target: "perk.all", value: 3, when: "proto" }, { target: "comp.all", value: 2, when: "serial" }],
    limiter: [{ target: "maxSpeed", value: 2, when: "toggle" }],
    notatthis: [{ target: "allRolls", value: 2, when: "toggle" }]
  },
  /* Подсказка на кнопке включения ситуативных триггеров. */
  toggleHints: {
    notyou: "против Немезиды", handle: "один на один с Немезидой", cutchatter: "пока молчишь", tellme: "союзник даёт Lead после Поворота",
    byside: "защищаешь своего союзника", advevasion: "снизился на уровень высоты", divebomb: "снизился перед атакой",
    code: "Поединок: бьёшь только его, союзники не вмешиваются", gauntlet: "перчатка брошена: Поединок +2", wreath: "первый бой с Немезидой: Поединок +2",
    oldschool: "Guns по цели Поединка", finish: "цель уже отметила метку урона", expartner: "против Немезиды", bill: "по виновному",
    limiter: "до конца хода, в конце Push против 7", notatthis: "мешаешь удару супероружия или по гражданским"
  }
};

/** Размер большой цели [ширина, длина] в местах зоны по данным NPC или null: стратегические бомбардировщики, крупные самолёты, Аркбёрд, летающие крейсеры, подводные авианосцы, корабли крупнее катера. */
export function footprintOf(sys) {
  if (!sys) return null;
  const props = [...(sys.props ?? []), ...(sys.rules ?? [])].map(p => p?.key ?? p);
  if (sys.key === "arkbird" || sys.key === "solg") return TB.footprints.arkbird;
  if (/стратегическ/i.test(sys.cls ?? "") || sys.key === "b2a") return TB.footprints.strategic;
  // крупные самолёты: транспорт, ДРЛО, патрульные и AC-130
  if (sys.kind === "air" && (sys.grp === "support" || ["ac130", "widebody", "cargojet"].includes(sys.key))) return TB.footprints.large;
  if (props.includes("aerialship")) return TB.footprints.aerialCruiser;
  if (props.includes("superdive")) return TB.footprints.superSub;
  if (sys.kind === "ground" && TB.longVehicles.includes(sys.key)) return TB.footprints.longVehicle;
  if (sys.kind === "ship" && ["sea", "civil"].includes(sys.grp) && sys.key !== "patrolboat") return TB.footprints.fleet;
  return null;
}

/** Картинка токена для большой цели: вид сверху вместо вида сбоку, если он есть. */
export function footprintTexture(src) {
  const hit = Object.keys(TB.topViews).find(k => src?.endsWith(k));
  return hit ? src.slice(0, -hit.length) + TB.topViews[hit] : src;
}

/* Даунтайм: проверка на земле, действия между вылетами, Заделы, Связи, Нервы (правила «Даунтайм», 09.10.2026). */
export const DT = {
  // шкала итогов: итог минус сложность (или минус бросок NPC во встречной)
  tiers: { clean: "Чистый успех", cost: "Успех с ценой", fail: "Не вышло, и стало хуже" },
  tierHint: {
    clean: "Пилот получает то, чего хотел.",
    cost: "Цель достигнута, но AWACS выбирает одну цену или даёт выбрать из двух.",
    fail: "Цель не достигнута, AWACS выбирает одну цену."
  },
  // что делают Perk и Complication на каждом итоге
  perkText: {
    clean: "Приятное сверху: полезный слух, благодарность, +1 деление личной цели или улучшенный Задел.",
    cost: "Цена мягче: игрок сам выбирает из двух, или цена откладывается до следующего даунтайма.",
    fail: "Просто не вышло, без ухудшения."
  },
  compText: {
    clean: "Тянется ниточка: кто-то видел, кто-то запомнил. AWACS вправе вернуться к этому позже.",
    cost: "Цена тяжелее: две цены или одна серьёзная.",
    fail: "Серьёзное последствие: гауптвахта, травма, открытый конфликт."
  },
  costs: {
    escalate: { label: "Эскалация", hint: "+1 деление на шкалу угрозы" },
    debt: { label: "Долг", hint: "кому и что пилот должен" },
    time: { label: "Время", hint: "пилот теряет следующее действие" },
    compromise: { label: "Компромисс", hint: "Задел в урезанном виде" },
    quarrel: { label: "Ссора", hint: "−1 Связь с товарищем" },
    fatigue: { label: "Усталость", hint: "−2 к максимальному Strain на следующий вылет" },
    nerves: { label: "Нервы", hint: "+1 к Нервам" },
    trauma: { label: "Травма", hint: "−1 к навыку на следующий вылет; только на 3 и ниже или с Complication" }
  },
  // действия даунтайма: навыки по способу, вид Задела
  actions: {
    hangar: { label: "В ангаре", skills: ["deploy", "lead"], edge: "tune", hint: "работа с техниками над своей машиной" },
    supply: { label: "Снабжение", skills: ["lead", "deploy", "dodge"], edge: "ammo", hint: "уговорить интенданта, «организовать» обменом или взять без спросу" },
    intel: { label: "Разведка", skills: ["aim"], edge: "intel", hint: "плёнки фотоконтроля, радиоперехват, разговор с пленным" },
    training: { label: "Тренировка", skills: ["aim", "deploy", "dodge", "lead", "push", "strafe"], edge: "practice", hint: "тренируемый навык; Push, если это изнурительный облёт" },
    leave: { label: "Увольнение", skills: ["push", "dodge", "lead"], edge: "fresh", hint: "гулять до утра, уйти в самоволку или собрать компанию" },
    personal: { label: "Личное дело", skills: ["aim", "deploy", "dodge", "lead", "push", "strafe"], edge: "", hint: "продвинуть свою цель" },
    custom: { label: "Своя заявка", skills: ["aim", "deploy", "dodge", "lead", "push", "strafe"], edge: "custom", hint: "дело не из списка: навык и Задел называет AWACS" },
    scene: { label: "Сцена с товарищем", skills: [], hint: "разговор один на один вокруг вопроса-крючка, без броска" },
    help: { label: "Помочь товарищу", skills: [], hint: "+Lead к его броску, цена на двоих" },
    breakdown: { label: "Сцена «Срыв»", skills: [], hint: "только на пределе: выговориться, Нервы падают до 2" }
  },
  // Заделы и последствия на следующий вылет
  edges: {
    tune: "Доводка", ammo: "Лишний боекомплект", rare: "Редкая машина", intel: "Разведданные", practice: "Наработка",
    fresh: "Свежая голова", custom: "Задел", memory: "Память", fatigue: "Усталость", trauma: "Травма"
  },
  // не Заделы: последствия и Память в лимит трёх Заделов не входят
  notEdges: ["memory", "fatigue", "trauma"],
  // доводка: параметр → [цель эффекта, прибавка]
  tune: {
    hp: ["hpMax", 1, "HP +1"], gun: ["gun", 1, "Gun DMG +1"], aa: ["aa", 1, "A-A +1"], ag: ["ag", 1, "A-G +1"], str: ["strainMax", 2, "Max Strain +2"],
    ev: ["evasion", 1, "Evasion +1"], spd: ["maxSpeed", 1, "Max Speed +1"]
  },
  // встречная цена у доводки Evasion и Max Speed (и у Компромисса): −1 к параметру
  tuneMinus: { hp: ["hpMax", "HP"], gun: ["gun", "Gun DMG"], aa: ["aa", "A-A"], ag: ["ag", "A-G"], str: ["strainMax", "Max Strain"], ev: ["evasion", "Evasion"], spd: ["maxSpeed", "Max Speed"] },
  breakdowns: {
    stupor: { label: "Ступор", text: "Пропускает свой следующий ход целиком, Speed −2 (возможно сваливание)." },
    rage: { label: "Ярость", text: "До конца вылета атакует только того, кто его подбил, или ближайшего врага. Leadership союзников на него не действует, пока цель жива, он не отступает." },
    panic: { label: "Паника", text: "В следующий ход только уходит от врага (Move, Climb / Dive, Change Speed). Захват сорван, Strain 0." }
  },
  // события на базе (d10): событие, крючок
  // Слава эскадрильи: пороги уровней и что они дают (эффекты накапливаются)
  glory: {
    levels: [
      { key: "none", min: 0, name: "Безымянные", mean: "Одна из многих эскадрилий полка", effects: [] },
      { key: "noticed", min: 20, name: "Замечены", mean: "Свои знают: про эскадрилью пишут в сводках, на базу приезжает корреспондент",
        effects: [["В сводках.", "В «News From The Front» эскадрилью упоминают по имени, ей доверяют задачи поважнее."]] },
      { key: "known", min: 50, name: "На слуху", mean: "Враг говорит о вас в эфире и даёт эскадрилье прозвище",
        effects: [["Это они!", "Раз за вылет любой пилот может назвать прозвище в открытом эфире (Monologue, без броска). Все вражеские Conscripts в его зоне до конца раунда получают Complication на 1–2."],
          ["Цена.", "В каждой операции хотя бы одна именная эскадрилья Duelists или ас приходит именно за вами."]] },
      { key: "terror", min: 90, name: "Гроза", mean: "Ваши эмблемы узнают с первого взгляда, рядовые пилоты врага боятся вас",
        effects: [["Строй дрогнул.", "В начале каждого вылета AWACS снимает каждого четвёртого вражеского Conscript в воздухе."],
          ["За ними!", "Союзные NPC в одной зоне с эскадрильей бросают с +1."],
          ["Цена.", "Против эскадрильи создают отдельное подразделение асов, и раз за операцию AWACS может устроить засаду без предупреждения разведки."]] },
      { key: "legend", min: 130, name: "Легенда", mean: "Уровень легендарных асов: исход войны связывают с вами",
        effects: [["Имя на крыле.", "Раз за вылет, когда эскадрилья входит в зону, все вражеские Conscripts в ней выходят из боя. Кому отступать некуда, до конца вылета получают Complication на 1–3."],
          ["Ведут за собой.", "Раз за вылет союзное NPC-подразделение выполняет приказ ведущего эскадрильи так, будто получило Leadership, без траты действия."],
          ["Цена.", "На вас нацелены лучшие асы и супероружие врага; любая неудача становится пропагандой, гибель пилота станет событием для всей страны."]] }
    ]
  },
  // шкалы боя (кнопка «Шкала боя» в панели AWACS): шаблоны, реплики AWACS на 50 %, 75 %, 90 % и при заполнении
  bossMarks: [["50", "50 %"], ["75", "75 %"], ["90", "90 %"], ["full", "заполнена"]],
  bossClocks: {
    arkbird: { label: "«Аркбёрд»: ядерный сброс", name: "«Аркбёрд»: сброс", size: 6, tick: true,
      note: "Боеголовка V1 сброшена над целью, операция провалена.",
      lines: { 50: "«Аркбёрд» меняет орбиту и идёт к цели. Всем бортам, не отставать!",
        75: "«Аркбёрд» вышел на курс бомбардировки! Бейте по двигателям, пока он не над целью!",
        90: "Отсек боеголовки открывается! Это последний заход, огонь всем, что есть!",
        full: "Сброс… Боеголовка отделилась. Мы не успели." } },
    solg: { label: "SOLG: падение", name: "SOLG: падение", size: 6, tick: true,
      note: "SOLG падает на город.",
      lines: { 50: "SOLG сходит с орбиты, скорость растёт. Держитесь рядом, другого шанса не будет.",
        75: "SOLG вошёл в плотные слои атмосферы! До города считанные минуты!",
        90: "Он уже над пригородами! Ядра, бейте по ядрам!",
        full: "SOLG падает на город. Всем бортам… уходите из зоны." } },
    silo: { label: "Ракетная шахта: залп", name: "Шахта: пуск", size: 4, tick: true,
      note: "Пуск: ракета за раунд проходит High и уходит в стратосферу. Перехватить её можно только там, в следующем раунде.",
      lines: { 50: "Крышка шахты пошла в сторону. Они готовят пуск!",
        75: "Ракета на стартовом столе, отсчёт идёт! Шахту нужно накрыть сейчас!",
        90: "Двигатель запущен! Ещё немного, и её будет не остановить!",
        full: "Пуск! Ракета уходит в стратосферу. Всем, кто может, наверх и перехватить!" } },
    railgun: { label: "Рейлган: зарядка", name: "Рейлган: заряд", size: 5, tick: true,
      note: "Выстрел рейлгана: до 4 зон по линии, спасает High.",
      lines: { 50: "Рейлган заряжен на 50 %. Держитесь подальше от линии огня.",
        75: "Заряд рейлгана 75 %! Не стройтесь в линию!",
        90: "Заряд 90 %! Всем бортам, уходите на High!",
        full: "Выстрел рейлгана!" } },
    alarm: { label: "Тревога (стелс-миссия)", name: "Тревога", size: 6, tick: false, open: true, alarm: true,
      note: "Тревога! Стелс-часть окончена: ЗРК и зенитки открывают огонь, через 2 раунда взлетают перехватчики, цель может начать уходить.",
      lines: { 50: "Внимание, противник насторожился. В эфире патрули, радары просыпаются. Тише, ребята.",
        75: "Они ищут нас. Ещё один промах, и подъём по всей округе.",
        90: "Враг почти у нас на хвосте. Держитесь ниже рельефа и никаких лишних слов в эфире!",
        full: "Тревога! Нас засекли! Всем бортам: тишина окончена, работаем по полной!" } },
    custom: { label: "Своя шкала", name: "", size: 6, tick: false, note: "", lines: { 50: "", 75: "", 90: "", full: "" } }
  },
  events: [
    ["Проверка из политотдела", "Приехал замполит дивизии и задаёт неудобные вопросы.", "Во что ты на самом деле веришь?"],
    ["Письмо из дома", "Одному из пилотов (по жребию) пришло письмо.", "Кто ждёт тебя дома?"],
    ["Концертная бригада", "Или фронтовой корреспондент с камерой.", "Каким ты хочешь остаться в памяти?"],
    ["Новая техника", "На базу пригнали машину или прототип, и все хотят на нём лететь.", "Кто из нас лучший пилот?"],
    ["Тревога", "Ночной налёт, диверсия или ложная тревога. Шкала угрозы +1.", "Кому ты доверяешь прикрывать спину?"],
    ["Пленный", "Сбитый вражеский пилот на базе, его можно навестить.", "Чем мы отличаемся от них?"],
    ["Слухи о враге", "Говорят, что против полка поставили аса.", "Что нужно, чтобы ты мне поверил?"],
    ["Дефицит", "Не хватает топлива или запчастей: «Снабжение» и «В ангаре» в этом даунтайме идут с обстоятельствами −2.", "Ради чего мы терпим?"],
    ["Праздник", "День авиации или чьё-то награждение, застолье до утра.", "Ради кого ты готов умереть?"],
    ["Перемены", "Новый командир, перевод товарища, приказ о переброске.", "Что заставит тебя ослушаться?"]
  ],
  maxEdges: 3, maxResolve: 2, maxBond: 3, maxNpcBond: 2, maxNerves: 5
};
