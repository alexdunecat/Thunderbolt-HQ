/* Настоящая максимальная скорость машин (км/ч, у земли или на высоте, как в справочниках) для приборов HUD.
   Игровая Speed — шкала: на приборе она переводится в км/ч долей от максимума машины. Вымышленные машины — на глаз. */
export const VMAX = {
  // самолёты пилотов
  mig21bis: 2175, "mig21-93": 2175, mig29a: 2450, mig29k: 2200, mig29m: 2400, mig35: 2400, su27: 2500, su30: 2120, su33: 2300,
  su35: 2500, su37: 2500, su47: 2600, mig144: 2600, mig31: 3000, mig31m: 3000, mig25: 3000, mig23: 2500, mig27: 1885, su32: 1900,
  su25: 975, yak141: 1800, yak38: 1280, su22: 1860, su24: 1700, falken: 3100, wyvern: 2900, adler: 2700,
  // NPC
  f5e: 1700, f20a: 2120, x29a: 1770, f4e: 2370, f4x: 2650, f16c: 2120, f14a: 2485, f14d: 2485, f15c: 2650, f15smtd: 2650, yf23: 2340,
  f22: 2410, mirage2000: 2530, typhoon: 2495, tornadof3: 2400, f16b60: 2120, f16xl: 2120, fa18c: 1915, fa18e: 1915, ea18g: 1900,
  f35c: 1930, f2a: 2120, rafalem: 1912, rafaleb: 1912, jas39c: 2200, f4g: 2370, f15e: 2650, a6e: 1040, ea6b: 1050, a10a: 706,
  ya10b: 706, f117a: 993, mirage2000d: 2330, tornadogr1: 2400, tornadogr4: 2400, tornadoecr: 2400, hawk: 1028, tu22m: 2300,
  tu95: 920, tu160: 2220, b1b: 1335, b2a: 1010, b52h: 1047, vulcan: 1040, ac130: 480, a50: 800, e767: 850, il76: 850, an124: 865,
  c130: 590, c5: 920, nimrod: 925, ah64a: 293, ch47: 315, mh60: 295, uh60: 295, mi24: 335, mi28: 300, mi8: 250, ka52: 310,
  uav: 480, airliner: 900, widebody: 950, bizjet: 900, an2: 258, cargojet: 900, bookbomber: 1000, booktransport: 850, bookpatrol: 900
};

/** Ключ машины: у пилота — его самолёт, у NPC — свой. */
export const planeKey = actor => actor?.type === "pilot" ? actor.system.plane?.system?.key ?? "" : actor?.system?.key ?? "";

/** Максимум машины в км/ч: из таблицы, иначе прикидка по игровой Speed машины. */
export function vmaxOf(actor) {
  const v = VMAX[planeKey(actor)];
  if (v) return v;
  const spd = actor?.system?.stats?.spd ?? actor?.system?.plane?.system?.stats?.spd ?? 3;
  return 400 + spd * 550;
}

/** Скорость на приборе: доля максимума машины по Speed из её максимальной Speed, с округлением до 10 км/ч. */
export function kmhOf(actor, speed, maxSpeed) {
  if (speed <= 0) return 0;
  const v = vmaxOf(actor);
  return Math.round((v * Math.min(speed, Math.max(1, maxSpeed)) / Math.max(1, maxSpeed)) / 10) * 10;
}
