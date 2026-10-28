/* Справочные константы системы. Тексты на русском, как в Штабе. */
export const SYSTEM_ID = "thunderbolt-shtab";
export const SYS_PATH = `systems/${SYSTEM_ID}/`;

/** Система машины не работает: сломана меткой Structure или заглушена РЭБ противника (ESM). */
export const sysOff = (s, key) => !!s && (s.off ? s.off.has(key) : s.broken === key);
/** Почему система не работает: для предупреждений. */
export const offWhy = (s, key) => s?.jam === key && s?.broken !== key ? "заглушена РЭБ противника (ESM)" : "сломана (метка Structure)";

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
  altitudes: { low: "Низкая", med: "Средняя", high: "Высокая", strat: "Стратосфера" },
  // в тексте: «всегда на Средней», «не ниже Высокой»
  altOn: { low: "на Низкой", med: "на Средней", high: "на Высокой", strat: "в стратосфере" },
  altGen: { low: "Низкой", med: "Средней", high: "Высокой", strat: "стратосферы" },
  /* Потолок машины по ключу самолёта (лист пилота) или воздушного NPC: выше Climb не поднимает, а если что-то выносит выше,
     машина остаётся на своём потолке. Машина без ключа (собранная игроками) не ограничена. Источник: aircraft-templates/altitude-ceilings.md. */
  maxAlt: {
    mig21bis: "strat", mig29a: "strat", "mig21-93": "strat", su27: "strat", su25: "high", mig31: "strat", su32: "high", mig31m: "strat", su35: "strat",
    su37: "strat", su47: "strat", mig144: "strat", falken: "strat", wyvern: "strat", adler: "strat", mig23: "strat", mig25: "strat", su33: "strat",
    mig29k: "strat", yak141: "high", mig29m: "strat", su30: "strat", mig35: "strat", yak38: "high", su22: "high", mig27: "high", su24: "high",
    fb: "strat", fa: "strat", mra: "strat", mrd: "strat", ga: "high", gs: "high", hsi: "strat", prt: "strat", f5e: "high", f20a: "high", x29a: "high",
    f4e: "strat", f4x: "strat", f16c: "high", f14a: "strat", f14d: "strat", f15c: "strat", f15smtd: "strat", yf23: "strat", f22: "strat",
    mirage2000: "strat", typhoon: "strat", tornadof3: "high", f16b60: "high", f16xl: "high", fa18c: "high", fa18e: "high", ea18g: "high", f35c: "high",
    f2a: "high", rafalem: "high", rafaleb: "high", jas39c: "high", f4g: "high", f15e: "high", a6e: "high", ea6b: "high", a10a: "high", ya10b: "high",
    f117a: "high", mirage2000d: "high", tornadogr1: "high", tornadogr4: "high", tornadoecr: "high", hawk: "high", tu22m: "high", tu95: "high",
    tu160: "high", b1b: "high", b2a: "high", b52h: "high", vulcan: "high", ac130: "med", a50: "high", e767: "high", il76: "high", an124: "high",
    c130: "high", c5: "high", nimrod: "high", ah64a: "med", ch47: "med", mh60: "med", uh60: "med", mi24: "med", mi28: "med", mi8: "med", ka52: "med",
    uav: "high", airliner: "high", widebody: "high", bizjet: "high", an2: "med", cargojet: "high", bookbomber: "high", booktransport: "high",
    bookpatrol: "high"
  },
  // высота токена: 1 = Низкая, 2 = Средняя, 3 = Высокая, 4 = стратосфера
  altElevation: { low: 1, med: 2, high: 3, strat: 4 },
  /* Сторона NPC (лист NPC, «Заметки AWACS»). Пилоты игроков всегда своя сторона: "player". Союзник и игроки друг по другу не стреляют. */
  sides: { enemy: "Противник", ally: "Союзник", neutral: "Нейтральный" },
  tiers: { conscript: "Конскрипт", duelist: "Дуэлянт", ace: "Ас" },
  staffStatus: { active: "Жив, здоров", hospital: "Ранен, в госпитале", away: "Уехал, эвакуирован", pow: "В плену", mia: "Пропал без вести", kia: "Погиб" },
  staffRoles: { staff: "Штаб", tech: "Техник", crew: "Наземная служба", civil: "Гражданский", kin: "Близкий пилота", other: "Другое" },
  // задача по приоритетной цели (панель AWACS и «Заметки AWACS» листа NPC)
  tasks: { "": "без задачи", destroy: "Уничтожить", protect: "Защитить", escort: "Сопроводить", intercept: "Перехватить", mark: "Отметить",
    recon: "Разведать", capture: "Захватить", reach: "Добраться", disable: "Вывести из строя" },
  npcKinds: { air: "Воздушная цель", ground: "Наземная цель", ship: "Корабль или особая цель" },
  weaponTargets: { air: "по воздуху", ground: "по земле и морю", gun: "пушечный", util: "РЭБ", line: "по линии" },
  weaponKinds: { book: "из книги", hb: "из Ace Combat 5", op: "опытное" },
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
    pow: "В плену", mia: "Пропал без вести", kia: "Погиб", retired: "Выбыл из кампании"
  },
  planeStats: {
    spd: ["Max Speed", "макс. скорость"], ev: ["Evasion", "уклонение"], aa: ["Air-Air", "атака по воздуху"], ag: ["Air-Gnd", "атака по земле"],
    hp: ["Max HP", "прочность"], str: ["Max Strain", "перегрузка"], gun: ["Gun DMG", "урон пушки"], hard: ["Hrd Pnt", "узлы подвески"]
  },
  difficulty: 7,
  /* Дальность в зонах: 0 своя, 1 соседние, 2 обычная ракета (захват держится до двух зон), 99 вся зона операции. */
  range: { lockOn: 1, lockHold: 2, missile: 2, guns: 0, operation: 99 },
  /** Большие цели: размер токена в клетках [ширина, длина]; [1, 1] — на всю зону, без деления на места. Вид сверху для вытянутых токенов, если значок нарисован сбоку. */
  /* Большие цели: [ширина, длина] в местах зоны (зона — 3×3 места, обычный самолёт занимает одно). */
  footprints: { strategic: [2, 2], large: [2, 2], arkbird: [2, 3], aerialCruiser: [3, 2], superSub: [1, 3], landship: [1, 3], fleet: [1, 2], longVehicle: [1, 2] },
  /* Длинные наземные машины на 2 места: пока только «Тополь-М» (Alex, 08.10). */
  longVehicles: ["tel"],
  topViews: Object.fromEntries(["superSub", "landship", "carrier", "battleship", "cruiser", "destroyer", "frigate", "ship", "sub"]
    .map(k => [`assets/targets/${k}.svg`, `assets/targets/${k}-top.svg`])),
  weaponRange: { RCL: 0, MGP: 0, PLSL: 1, XAGM: 1, "4AAM": 1, ESM: 1, XLAA: 99, LAAM: 99, LACM: 99, EMRG: 99 },
  /* Черты спецоружия (Стрэйнджриал 8.2): название, трафарет для станции HUD (tag) и строка для карточки пуска. */
  weaponTraits: {
    QAAM: { name: "Собачья свалка", tag: "DGF", text: "Цель в своей зоне при пуске: её Break! против этой ракеты не работает, защита Evasion + Speed." },
    HPAA: { name: "Неконтактный взрыватель", tag: "PROX", text: "Итог меньше защиты на 1–2: ракета рвётся рядом, 4 урона." },
    HVAA: { name: "От неё не уйти", tag: "HYPR", text: "Бьёт в начале хода цели; Speed цели в защиту только вполовину, вниз." },
    SAAM: { name: "Ведение (Fox One)", tag: "FOX1", text: "Летит по захвату: захват сорван до удара — ракета потеряна. Промах при удержанном захвате — повторный заход в конце следующего раунда." },
    GPB: { name: "Бронебойная", tag: "AP", text: "Occlusion цели −2, укрытие туннеля (+2) не спасает." },
    UGB: { name: "Свободное падение", tag: "DROP", text: "Без захвата: цель на своём участке, сброс с Низкой или Средней. На Perk: двойной урон цели или обычный урон всем соседним." },
    "4AAM": { name: "Залп", tag: "×4", text: "Lock On берёт до 4 целей; один пуск, 1 Ammo, ракета в каждую, бросок один на всех." },
    XLAA: { name: "Залп", tag: "×4", text: "Lock On берёт до 4 целей в любой точке зоны операции; один пуск, 1 Ammo, ракета в каждую." },
    XAGM: { name: "Залп", tag: "×4", text: "Lock On берёт до 4 наземных или морских целей; один пуск, 1 Ammo, ракета в каждую." },
    EMRG: { name: "Линия", tag: "LINE", text: "Без захвата: линия до края карты на своей высоте, d10 + Aim (по земле Deploy) − Speed; все на линии с защитой не выше броска сразу получают 12." },
    ESM: { name: "РЭБ", tag: "ECM", text: "Глушит систему из списка Structure у вражеских самолётов и вертолётов в своей и соседних зонах до конца следующего раунда." }
  },
  salvoWeapons: ["4AAM", "XLAA", "XAGM"],
  /* Роли машин (Стрэйнджриал 8.5): у роли одна черта. tag — лампа HUD. Действуют у пилотов и асов-NPC. */
  planeRoles: {
    heavy: { name: "Тяжёлый истребитель", trait: "Мощный радар", tag: "RDR", text: "Lock On! по воздушной цели берёт её на 2 зоны от себя. Такой захват не срывается, пока цель не дальше 3 зон." },
    light: { name: "Лёгкий истребитель", trait: "Вираж", tag: "TURN", text: "Ракета врага по тебе промахнулась: в конце раунда бесплатный захват на стрелявшего, если он в твоей или соседней зоне." },
    icpt: { name: "Перехватчик", trait: "Взлёт по тревоге", tag: "SCRM", text: "Вылет начинается на Speed, равной Max Speed, а не 1." },
    multi: { name: "Многоцелевой", trait: "Универсал", tag: "MULT", text: "Improved Fox Two! бросается с большим из Aim и Deploy по воздушной или наземной цели; Aim Mod и Deploy Mod спецоружия по типу цели." },
    attack: { name: "Штурмовик", trait: "Штурмовой заход", tag: "CAS", text: "На Низкой атаки Guns и RCL по наземным и морским целям своей зоны не вычитают Speed стрелка." },
    bomber: { name: "Фронтовой бомбардировщик", trait: "Прицельный комплекс", tag: "TGP", text: "С Высокой можно захватывать и атаковать наземные и морские цели ракетами (обычными и спецоружием) и GPB. UGB, RCL и пушка с Высокой по земле не работают." },
    proto: { name: "Опытная машина", trait: "", tag: "", text: "Без черты роли: у опытных машин свои свойства и по два порога min-max." },
    ew: { name: "РЭБ", trait: "", tag: "", text: "Без черты роли: её работа это Станция РЭБ." }
  },
  /* Кому какая роль: ключи машин авиапарка и шаблонов книги. */
  roleOf: Object.fromEntries(Object.entries({
    heavy: "su27 su33 su35 su37 f15c f14a f22 tornadof3 fb", light: "mig21bis mig21-93 mig29a mig23 yak141 f5e f20a f16c mirage2000 typhoon fa",
    icpt: "mig25 mig31 mig31m f4x f14d hsi", multi: "mig29m mig29k mig35 su30 fa18c fa18e f16b60 f16xl rafalem rafaleb f35c f2a jas39c f4e mra mrd",
    attack: "su25 su22 mig27 yak38 a10a ya10b hawk f4g tornadoecr ga", bomber: "su24 su32 f15e tornadogr1 tornadogr4 mirage2000d a6e f117a",
    proto: "su47 mig144 x29a f15smtd yf23 falken wyvern adler prt", ew: "ea18g ea6b"
  }).flatMap(([r, keys]) => keys.split(" ").map(k => [k, r]))),
  /* Фирменные приёмы (Стрэйнджриал 8.6): раз за вылет, не тратят действие и проверку хода, если не сказано иное. */
  planeMoves: {
    cobra: { name: "Кобра Пугачёва", planes: "su35 su37", text: "Когда по тебе пущена ракета, даже не в свой ход: все ракеты в тебя в этом раунде промахиваются, все захваты на тебя срываются, Speed сразу 1 без сваливания. Нужен рабочий MAWS." },
    supermano: { name: "Сверхманёвренность", planes: "su47 adler", text: "В этот ход можно сделать вторую проверку с броском." },
    dash: { name: "Бросок на рубеж", planes: "mig31m mig144", text: "Одним действием Move до 3 зон, Speed сразу равна Max Speed. В конце броска бесплатный Lock On! по цели в зоне прибытия или соседней." },
    hmd: { name: "Нашлемный прицел", planes: "mig35", text: "Lock On! и Fox Two! по цели в своей зоне одним действием." },
    tank: { name: "Летающий танк", planes: "su25 a10a", text: "Когда должен получить метку урона, не получай её: HP просто восстанавливается до максимума." },
    phoenix: { name: "Феникс", planes: "f14a f14d", text: "Lock On! по воздушной цели в любой точке зоны операции. Этот захват не срывается из-за расстояния, пока цель в зоне операции." },
    ace104: { name: "104:0", planes: "f15c", text: "Твоя ракета по воздушной цели промахнулась на 1 или 2: она всё равно попадает. Объявляется после сравнения атаки с защитой." },
    ghost: { name: "Удар из ниоткуда", planes: "f22 f117a", text: "Объяви при пуске: цель не получает предупреждения о ракете и не может сделать Break! против неё." },
    g12: { name: "Перегрузка 12g", planes: "falken", text: "Break! без броска, как будто на d10 выпало 10. Не тратит проверку хода, и Speed после него не падает." },
    salvo: { name: "Ракетный шквал", planes: "wyvern", text: "Fox Two! пускает две ракеты по захваченной цели: две обычных или две одного спецоружия (на 2 Ammo). Вторая даёт +1 к атаке или добавляет свой урон." }
  },
  rangeOptions: { "": "по умолчанию для этого оружия", 0: "своя зона", 1: "своя и соседние", 2: "до двух зон", 99: "вся зона операции" },

  /* Погода (как в Планшете AWACS). mods: ev, aa, ag, push, spd; alts: на каких высотах действует; comp2: Complication на 1–2. */
  weather: {
    clouds: { ico: "☁", name: "Облачность", mods: { ev: 1, aa: -1, ag: -1 }, txt: "+1 Evasion, −1 A-A и A-G; импульсный лазер не бьёт" },
    rain: { ico: "☂", name: "Дождь", mods: { aa: -1, ag: -1 }, txt: "−1 A-A и A-G" },
    dust: { ico: "≋", name: "Пыльная буря", mods: { ev: 2, aa: -2, ag: -2 }, alts: ["low", "med"], ownZone: true, txt: "+2 Evasion, −2 A-A и A-G, цели только в своей зоне; до Высокой не доходит" },
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
  effectWhen: { always: "всегда", twist: "после Поворота", toggle: "пока включён", twisttoggle: "после Поворота, пока включён", nemesis: "против Немезиды, после «Задействовать»",
    duel: "в Поединке, считается в атаке", attack: "когда условие выполнено, считается само", stack: "× счётчик серии", proto: "на опытной машине", serial: "на серийной машине" },
  /* Встроенные эффекты книжных триггеров (если у триггера не задан свой список). */
  triggerEffects: {
    armor: [{ target: "hpMax", value: 1, when: "always" }],
    heart: [{ target: "strainMax", value: 3, when: "always" }],
    holding: [{ target: "maxSpeed", value: 1, when: "twist" }],
    blessing: [{ target: "ammo", value: 2, when: "always" }],
    reckless: [{ target: "skill.chosen", value: 2, when: "always" }, { target: "comp.chosen", value: 2, when: "always" }],
    cautious_rk: [{ target: "skill.chosen", value: -1, when: "always" }, { target: "perk.chosen", value: 3, when: "always" }],
    cautious_og: [{ target: "perk.chosen", value: 3, when: "always" }],
    // триггеры Немезиды: считаются в атаке и защите против неё (nemesis.mjs), в листе не суммируются
    notyou: [{ target: "evasion", value: 1, when: "nemesis" }],
    handle: [{ target: "allRolls", value: 2, when: "nemesis" }],
    cutchatter: [{ target: "allRolls", value: 1, when: "twisttoggle" }],
    // боевые триггеры (combat-triggers.mjs): условие проверяется в самой атаке или Break!
    tellme: [{ target: "allRolls", value: 1, when: "attack" }],
    byside: [{ target: "allRolls", value: 1, when: "attack" }],
    advevasion: [{ target: "skill.dodge", value: 2, when: "attack" }],
    divebomb: [{ target: "skill.deploy", value: 2, when: "attack" }],
    guns: [{ target: "skill.strafe", value: 1, when: "stack" }],
    // архетипы Стрэйнджриала
    // Поединок: +1 к атакам (с броском и без) и к Evasion; Перчатка или Венок поднимают его до +2 (вместе не складываются: group)
    code: [{ target: "allRolls", value: 1, when: "duel" }, { target: "evasion", value: 1, when: "duel" }],
    gauntlet: [{ target: "allRolls", value: 2, when: "duel" }, { target: "evasion", value: 2, when: "duel" }],
    wreath: [{ target: "allRolls", value: 2, when: "duel" }, { target: "evasion", value: 2, when: "duel" }],
    oldschool: [{ target: "gun", value: 2, when: "duel" }],
    finish: [{ target: "allRolls", value: 1, when: "attack" }],
    expartner: [{ target: "allRolls", value: 1, when: "nemesis" }],
    bill: [{ target: "allRolls", value: 2, when: "attack" }],
    tester: [{ target: "perk.all", value: 3, when: "proto" }, { target: "comp.all", value: 2, when: "serial" }],
    limiter: [{ target: "maxSpeed", value: 2, when: "toggle" }],
    notatthis: [{ target: "allRolls", value: 2, when: "twisttoggle" }]
  },
  /* Подсказка на кнопке включения ситуативных триггеров. */
  toggleHints: {
    notyou: "против Немезиды", handle: "один на один с Немезидой", cutchatter: "пока молчишь, после Поворота", tellme: "союзник даёт Lead после Поворота",
    byside: "защищаешь своего союзника", advevasion: "снизился на уровень высоты", divebomb: "снизился перед атакой",
    code: "Поединок: бьёшь только его, союзники не вмешиваются", gauntlet: "перчатка брошена: Поединок +2", wreath: "первый бой с Немезидой: Поединок +2",
    oldschool: "Guns по цели Поединка", finish: "цель уже отметила метку урона", expartner: "против Немезиды", bill: "по виновному",
    limiter: "до конца хода, в конце Push против 7", notatthis: "мешаешь удару супероружия или по гражданским, после Поворота"
  }
};

/** Фирменный приём по ключу машины. */
/* Асы (Стрэйнджриал 9.5): лист в полную силу, «Чутьё аса» и личные триггеры, каждый раз за вылет.
   how: auto — срабатывает сам, gm — кнопкой ведущего (HUD аса или карточка). */
TB.aceTriggers = {
  again: { name: "Не уйдёшь", how: "auto", text: "Ракета аса промахнулась: в конце следующего раунда она атакует ту же цель снова с той же атакой, если захват ещё держится." },
  back: { name: "Удар в спину", how: "auto", text: "Атака аса по пилоту, который держит на захвате кого-то другого, получает +2." },
  prey: { name: "Добыча", how: "gm", text: "Ас объявляет пилота своей добычей. До конца вылета, пока ас держит его на захвате, этот пилот не получает бонусов от Lead." },
  psy: { name: "Психическая атака", how: "gm", text: "Ас говорит монолог пилоту (действие без броска, у Немезиды свободное), и тот теряет 2 Strain." },
  last: { name: "Последний заход", how: "auto", text: "Получив Doom, ас перед катапультированием сразу делает ещё один ход: до трёх действий, одно из них с броском." },
  bugout: { name: "Ещё встретимся", how: "gm", text: "С двумя метками ас в конце раунда уходит из зоны операции. Он не сбит и вернётся в другом вылете." },
  shake: { name: "Сорвать захват", how: "gm", text: "Пилот взял аса на захват: встречная проверка Push, ничья за пилотом. Если ас выиграл, захват сорван." },
  remember: { name: "Я тебя помню", how: "gm", text: "Весь вылет атаки аса получают +2 против пилота, который в этой кампании уже ставил ему метку или сбивал его." },
  wing: { name: "Звено", how: "gm", text: "Ведомый аса (ас или дуэлянт его эскадрильи) попал по цели: ас бесплатно берёт эту цель на захват, если она в досягаемости." },
  trap: { name: "Ловушка", how: "gm", text: "Пилот пошёл за асом в соседнюю зону: ЗРК или зенитная установка стороны аса в этой зоне сразу атакует его, без захвата и вне своего хода." }
};
TB.aceInstinct = { name: "Чутьё аса", text: "Раз в раунд, когда по асу пущена ракета, он может сделать Break! вне своего хода. Это не тратит действие и не считается проверкой хода; Strain тратить можно, Speed падает на 2. Нужен рабочий MAWS." };
TB.moveOf = Object.fromEntries(Object.entries(TB.planeMoves).flatMap(([m, d]) => d.planes.split(" ").map(k => [k, m])));

/* ---------- роли, приёмы и свойства машины (Стрэйнджриал 8.4–8.6) ---------- */

/** Ключ машины: у пилота — его самолёт, у NPC — сам самолёт из сводки. */
export function planeKeyOf(actor) {
  if (actor?.type === "pilot") return actor.system.plane?.system?.key ?? "";
  return actor?.type === "npc" && actor.system.kind === "air" ? actor.system.key ?? "" : "";
}
/** Роли и приёмы есть у пилотов и асов-NPC (конскрипты и дуэлянты летают без них). */
const withRole = actor => actor?.type === "pilot" || (actor?.type === "npc" && actor.system.kind === "air" && actor.system.tier === "ace");
/** Роль машины: ключ TB.planeRoles или "". На самолёте пилота роль можно переписать полем role. */
export function roleOf(actor) {
  if (!withRole(actor)) return "";
  const r = (actor.type === "pilot" ? actor.system.plane?.system?.role : "") || TB.roleOf[planeKeyOf(actor)] || "";
  return TB.planeRoles[r] ? r : "";
}
/** Черта роли (у опытных машин и РЭБ её нет): { name, trait, tag, text } или null. */
export const roleTrait = actor => { const r = TB.planeRoles[roleOf(actor)]; return r?.trait ? r : null; };
/** Фирменный приём машины: ключ TB.planeMoves или "". */
export function moveOf(actor) {
  if (!withRole(actor)) return "";
  const m = (actor.type === "pilot" ? actor.system.plane?.system?.move : "") || TB.moveOf[planeKeyOf(actor)] || "";
  return TB.planeMoves[m] ? m : "";
}
/** Свойство машины (TB catalog props): у пилота с самолёта, у NPC из сводки. */
export function hasProp(actor, key) {
  if (!actor) return false;
  if (actor.type === "pilot") return !!actor.system.planeProps?.has?.(key);
  return !!actor.system?.props?.some?.(p => p.key === key);
}
/** Разовая отметка вылета (приём, броня кабины): у пилота стоит до «К вылету», у NPC — до конца этого боя. */
export function sortieUsed(actor, key) {
  const v = actor?.getFlag?.(SYSTEM_ID, "sortie")?.[key];
  if (!v) return false;
  return actor.type === "pilot" || v === (globalThis.game?.combat?.id ?? true);
}
export const sortieMark = actor => (actor?.type === "pilot" ? true : (globalThis.game?.combat?.id ?? true));
/** Приём есть и в этом вылете ещё не использован (key — нужен именно этот приём). */
export const moveReady = (actor, key = null) => { const m = moveOf(actor); return !!m && (!key || m === key) && !sortieUsed(actor, "move"); };

/** Размер большой цели [ширина, длина] в местах зоны по данным NPC или null: стратегические бомбардировщики, крупные самолёты, Аркбёрд, летающие крейсеры, подводные авианосцы, сухопутный линкор, корабли крупнее катера. */
export function footprintOf(sys) {
  if (!sys) return null;
  const props = [...(sys.props ?? []), ...(sys.rules ?? [])].map(p => p?.key ?? p);
  if (sys.key === "arkbird" || sys.key === "solg") return TB.footprints.arkbird;
  if (/стратегическ/i.test(sys.cls ?? "") || sys.key === "b2a") return TB.footprints.strategic;
  // крупные самолёты: транспорт, ДРЛО, патрульные и AC-130
  if (sys.kind === "air" && (sys.grp === "support" || ["ac130", "widebody", "cargojet"].includes(sys.key))) return TB.footprints.large;
  // «Анура» и «Арсион» компактнее остальных летающих крейсеров
  if (["anura", "arcion"].includes(sys.key)) return TB.footprints.large;
  if (props.includes("aerialship")) return TB.footprints.aerialCruiser;
  if (props.includes("superdive")) return TB.footprints.superSub;
  // сухопутный линкор «Тарпан» длиной во всю зону
  if (props.includes("landship")) return TB.footprints.landship;
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
      note: "Пуск: ракета за раунд проходит Высокую и уходит в стратосферу. Перехватить её можно только там, в следующем раунде.",
      lines: { 50: "Крышка шахты пошла в сторону. Они готовят пуск!",
        75: "Ракета на стартовом столе, отсчёт идёт! Шахту нужно накрыть сейчас!",
        90: "Двигатель запущен! Ещё немного, и её будет не остановить!",
        full: "Пуск! Ракета уходит в стратосферу. Всем, кто может, наверх и перехватить!" } },
    railgun: { label: "Рейлган: зарядка", name: "Рейлган: заряд", size: 5, tick: true,
      note: "Выстрел рейлгана: до 4 зон по линии, спасает уход на Высокую.",
      lines: { 50: "Рейлган заряжен на 50 %. Держитесь подальше от линии огня.",
        75: "Заряд рейлгана 75 %! Не стройтесь в линию!",
        90: "Заряд 90 %! Всем бортам, уходите на Высокую!",
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

/** Пилот ещё в кампании: выбывший («Выбыл из кампании») остаётся в журнале, но не в списках звена. */
export const inCampaign = a => a?.type === "pilot" && a.system?.service?.status !== "retired";
