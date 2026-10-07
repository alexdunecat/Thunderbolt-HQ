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
  altitudes: { low: "Low", med: "Medium", high: "High" },
  // высота токена: 1 = Low, 2 = Medium, 3 = High
  altElevation: { low: 1, med: 2, high: 3 },
  tiers: { conscript: "Конскрипт", duelist: "Дуэлянт", ace: "Ас" },
  npcKinds: { air: "Воздушная цель", ground: "Наземная цель", ship: "Корабль или особая цель" },
  weaponTargets: { air: "по воздуху", ground: "по земле и морю", gun: "пушечный", util: "РЭБ", line: "по линии" },
  weaponKinds: { book: "из книги", hb: "из Ace Combat 5", op: "опытное" },
  triggerTypes: {
    Core: "Core", General: "General", Twist: "Twist", Nemesis: "Nemesis", Death: "Death", Passive: "Passive"
  },
  triggerTypeHints: {
    General: "раз за вылет в любой момент", Twist: "раз за вылет после Поворота", Nemesis: "раз за вылет, когда появился Nemesis",
    Death: "после гибели", Passive: "действует всегда", Core: "стартовый триггер архетипа"
  },
  archetypes: {
    oldguard: { label: "Ветеран (Old Guard)", core: "practiced" },
    rookie: { label: "Новичок (Rookie)", core: "mentor" },
    hotshot: { label: "Сорвиголова (Hotshot)", core: "reckless" },
    chatterbox: { label: "Болтун (Chatterbox)", core: "outside" },
    soldier: { label: "Солдат (Soldier)", core: "byside" }
  },
  status: {
    active: "В строю, годен к полётам", hospital: "На лечении", ejected: "Катапультировался, ждёт эвакуации",
    pow: "В плену", mia: "Пропал без вести", kia: "Погиб"
  },
  planeStats: {
    spd: ["Max Speed", "макс. скорость"], ev: ["Evasion", "уклонение"], aa: ["Air-Air", "атака по воздуху"], ag: ["Air-Gnd", "атака по земле"],
    hp: ["Max HP", "прочность"], str: ["Max Strain", "перегрузка"], gun: ["Gun DMG", "урон пушки"], hard: ["Hrd Pnt", "узлы подвески"]
  },
  skins: { shtab: "Штаб", ac5: "ОС AC5", doc: "Документация" },
  difficulty: 7,
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
    points: "Очки навыков"
  },
  effectWhen: { always: "всегда", twist: "после Поворота", toggle: "пока включён", stack: "× счётчик серии" },
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
    guns: [{ target: "skill.strafe", value: 1, when: "stack" }]
  },
  /* Подсказка на кнопке включения ситуативных триггеров. */
  toggleHints: {
    notyou: "против Nemesis", handle: "один на один с Nemesis", cutchatter: "пока молчишь", tellme: "союзник даёт Lead после Поворота",
    byside: "защищаешь своего союзника", advevasion: "снизился на уровень высоты", divebomb: "снизился перед атакой"
  }
};
