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
  /* Дальность в зонах: 0 своя, 1 соседние, 2 обычная ракета (захват держится до двух зон), 99 вся зона операции. */
  range: { lockOn: 1, lockHold: 2, missile: 2, guns: 0, operation: 99 },
  /** Большие цели: размер токена в клетках [ширина, длина]. Вид сверху для вытянутых токенов, если значок нарисован сбоку. */
  footprints: { strategic: [2, 2], large: [2, 2], arkbird: [2, 3], aerialCruiser: [6, 2], superSub: [1, 3], fleet: [1, 2] },
  topViews: Object.fromEntries(["superSub", "carrier", "battleship", "cruiser", "destroyer", "frigate", "ship", "sub"]
    .map(k => [`assets/targets/${k}.svg`, `assets/targets/${k}-top.svg`])),
  weaponRange: { RCL: 0, MGP: 0, PLSL: 1, XAGM: 1, "4AAM": 1, ESM: 1, XLAA: 99, LAAM: 99, LACM: 99 },
  rangeOptions: { "": "по умолчанию для этого оружия", 0: "своя зона", 1: "своя и соседние", 2: "до двух зон", 99: "вся зона операции" },

  /* Погода (как в Планшете AWACS). mods: ev, aa, ag, push, spd; alts: на каких высотах действует; comp2: Complication на 1–2. */
  weather: {
    clouds: { ico: "☁", name: "Облачность", mods: { ev: 1, aa: -1, ag: -1 }, txt: "+1 Evasion, −1 A-A и A-G; импульсный лазер не бьёт" },
    rain: { ico: "☂", name: "Дождь", mods: { aa: -1, ag: -1 }, txt: "−1 A-A и A-G" },
    dust: { ico: "≋", name: "Пыльная буря", mods: { ev: 2, aa: -2, ag: -2 }, alts: ["low", "med"], ownZone: true, txt: "+2 Evasion, −2 A-A и A-G, цели только в своей зоне; до High не доходит" },
    lightning: { ico: "ϟ", name: "Молния", txt: "раз в раунд удар: −1 Evasion и ракеты только с броском до конца следующего хода" },
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

/** Размер токена большой цели [ширина, длина] по данным NPC или null: стратегические бомбардировщики, крупные самолёты, Аркбёрд, летающие крейсеры, подводные авианосцы, корабли крупнее катера. */
export function footprintOf(sys) {
  if (!sys) return null;
  const props = [...(sys.props ?? []), ...(sys.rules ?? [])].map(p => p?.key ?? p);
  if (sys.key === "arkbird") return TB.footprints.arkbird;
  if (/стратегическ/i.test(sys.cls ?? "") || sys.key === "b2a") return TB.footprints.strategic;
  // крупные самолёты: транспорт, ДРЛО, патрульные и AC-130
  if (sys.kind === "air" && (sys.grp === "support" || sys.key === "ac130")) return TB.footprints.large;
  if (props.includes("aerialship")) return TB.footprints.aerialCruiser;
  if (props.includes("superdive")) return TB.footprints.superSub;
  if (sys.kind === "ship" && sys.grp === "sea" && sys.key !== "patrolboat") return TB.footprints.fleet;
  return null;
}

/** Картинка токена для большой цели: вид сверху вместо вида сбоку, если он есть. */
export function footprintTexture(src) {
  const hit = Object.keys(TB.topViews).find(k => src?.endsWith(k));
  return hit ? src.slice(0, -hit.length) + TB.topViews[hit] : src;
}
