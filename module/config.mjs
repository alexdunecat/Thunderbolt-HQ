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
  missileDamage: 5
};
