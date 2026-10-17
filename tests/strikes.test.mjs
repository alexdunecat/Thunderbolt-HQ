// Удары по площади: кого задевает в конце раунда (зоны, высоты, уход за раунд, бросок, кольцо реактора, SOLG по высотам).
const root = process.argv[2];
globalThis.Hooks = { on() {}, once() {} };
globalThis.Application = class {};
globalThis.foundry = { utils: { mergeObject: Object.assign, deepClone: o => JSON.parse(JSON.stringify(o)) } };
globalThis.game = { settings: { get: () => true }, user: { isGM: true } };
globalThis.CONFIG = { specialStatusEffects: { DEFEATED: "dead" } };
const S = await import(`${root}/module/strikes.mjs`);
const U = (name, zone, alt, extra = {}) => ({ uuid: name, name, zone, alt, kind: alt === "ground" ? "ground" : "air", defense: 7, hp: 4, start: `${zone}|${alt}`, ...extra });
const units = [
  U("Гроза", "3,3", "low"), U("Ворон", "3,3", "high"), U("Сокол", "4,3", "low"), U("Беркут", "3,3", "med", { start: "2,3|med" }),
  U("Гаубица", "3,3", "ground", { defense: 4 }), U("Бункер", "3,3", "ground", { hardened: true, defense: 5, hp: 6 }), U("Эсминец", "3,3", "ground", { kind: "ship" })
];
const show = (label, strike, rolls) => console.log(label + ":", S.strikeHits(strike, units, rolls).map(h => `${h.name}${h.ship ? " корабль" : ""} ${h.why ? "увернулся" : h.hit ? h.dmg : "мимо"}${h.total !== undefined ? ` (${h.total}/${h.vs})` : ""}`).join("; ") || "никого");
show("залп Низкая+Средняя", { kind: "railvolley", zones: ["3,3"], alts: ["ground", "low", "med"], dmg: 10 });
show("рельсотрон Средняя", { kind: "pwrail", zones: ["3,3"], alts: ["med"], dmg: 5, attack: 3 }, { Беркут: 9 });
show("рельсотрон Низкая", { kind: "pwrail", zones: ["3,3"], alts: ["low"], dmg: 6, attack: 3 }, { Гроза: 4 });
show("рельсотрон Низкая, промах", { kind: "pwrail", zones: ["3,3"], alts: ["low"], dmg: 6, attack: 3 }, { Гроза: 3 });
show("лазер линия", { kind: "arklaser", zones: ["2,3", "3,3", "4,3"], alts: ["ground", "low", "med", "high", "strat"], dmg: 8 });
show("SOLG", { kind: "solg", zones: ["3,3"], alts: ["ground", "low", "med"], dmg: 0 });
show("навес", { kind: "indirect", zones: ["3,3"], alts: ["ground"], dmg: 5, attack: 7 }, { Гаубица: 1, Бункер: 1, Эсминец: 1 });
show("реактор", { kind: "reactor", zones: ["3,3"], alts: ["low", "med", "high", "strat"], dmg: 6 });
console.log("у Арсиона:", S.strikesOf({ system: { props: ["aerialship", "pwrail"] }, items: [] }).join(","));
