// Запуск: node tests/run.mjs (сверяет вывод со снимком в tests/snapshots)
import { fileURLToPath as __f } from "node:url";
import { tmpdir as __tmp } from "node:os";
import fs from "node:fs";
process.argv[2] ??= __f(new URL("..", import.meta.url)).replace(/\/$/, "");
process.argv[3] ??= __tmp() + "/tb-test-out";
const root = process.argv[2];
const Fd = class { constructor(...a) { this.a = a; } };
Object.assign(globalThis, {
  CONST: { GRID_TYPES: { GRIDLESS: 0 } }, CONFIG: { specialStatusEffects: {} },
  game: { scenes: { viewed: null }, combat: null, settings: { get: () => ({}) } },
  canvas: { ready: false },
  foundry: { utils: { deepClone: x => structuredClone(x) }, abstract: { TypeDataModel: class {} },
    data: { fields: { NumberField: Fd, StringField: Fd, BooleanField: Fd, SchemaField: Fd, ArrayField: Fd, HTMLField: Fd, ObjectField: Fd } } },
  fromUuidSync: () => null, Hooks: { on() {}, once() {} },
  Application: class {}, Combat: class {}, Actor: class {}, Item: class {}, ActorSheet: class {}
});
const { TB } = await import(`${root}/module/config.mjs`);
const { PilotData, TriggerData, isProto } = await import(`${root}/module/data/models.mjs`);
const cat = JSON.parse(fs.readFileSync(`${root}/data/catalog.json`, "utf8"));
// архетипы Foundry и Штаба совпадают, у каждого есть Core-триггер в каталоге
console.log("archetypes:", Object.keys(TB.archetypes).join(" "), "| catalog:", cat.archetypes.map(a => a.key).join(" "));
for (const [k, a] of Object.entries(TB.archetypes)) {
  const core = cat.triggers.find(t => t.key === a.core);
  const list = cat.triggers.filter(t => t.archetype === k);
  console.log(`${k}: ${a.label}, core ${a.core} ${core?.types.includes("Core") ? "ok" : "НЕТ"}, триггеров ${list.length}: ${list.map(t => t.key).join(" ")}`);
}
const missing = Object.keys(TB.triggerEffects).filter(k => !cat.triggers.some(t => t.key === k));
console.log("effects without trigger:", missing.join(" ") || "—", "| toggles without hint:",
  Object.entries(TB.triggerEffects).filter(([k, l]) => l.some(c => c.when === "toggle") && !TB.toggleHints[k]).map(([k]) => k).join(" ") || "—");
// опытная машина
const plane = (system, flag) => ({ system, getFlag: () => flag });
const P = [["Experimental Prototype", plane({ key: "prt", base: "Experimental Prototype", cls: "" })], ["Су-47", plane({ key: "su47", cls: "Опытный истребитель" })],
  ["Falken", plane({ key: "falken", cls: "Экспериментальный истребитель" })], ["МиГ-29А", plane({ key: "mig29a", cls: "Фронтовой истребитель" })],
  ["МиГ-29А + Доводка", plane({ key: "mig29a", cls: "Фронтовой истребитель" }), [{ kind: "tune" }]], ["МиГ-29А + Редкая машина", plane({ key: "mig29a", cls: "" }), [{ kind: "rare" }]],
  ["МиГ-29А, флаг proto", plane({ key: "mig29a", cls: "" }, true)], ["Су-47, флаг serial", plane({ key: "su47", cls: "Опытный истребитель" }, false)], ["без машины", null]];
console.log("proto:", P.map(([n, p, e]) => `${n}=${isProto(p, e ?? [])}`).join(" | "));
// Испытатель: Perk от 3 на опытной, Complication до 2 на серийной; Кодекс включён: Aim/Strafe +1, Evasion +1
function trig(key, extra = {}) {
  const sys = Object.assign(Object.create(TriggerData.prototype), { key, skill: "", skill2: "", skills: 0, active: false, stack: 0, effects: null, ...extra });
  return { type: "trigger", name: cat.triggers.find(t => t.key === key)?.name ?? key, system: sys };
}
function pilot(planeSys, triggers, edges = []) {
  const s = Object.assign(Object.create(PilotData.prototype), {
    skills: { aim: 1, deploy: 0, dodge: 0, lead: 0, push: 0, strafe: 1 }, archetype: "", bonusPoints: 0, twist: false, speed: 3, alt: "med", breakEv: null,
    markers: { grit: false, gritSkill: "", structure: false, sys: "", doom: false }, hp: { value: 3, max: 3 }, strain: { value: 0, max: 0 },
    nerves: 0, onEdge: "", breakdown: "", resolve: 0, fee: 0, downtime: { actions: 2 }, edges, bonds: [], goals: [], debts: [], service: { status: "active" }, questions: {}, dossier: []
  });
  const p = { type: "plane", system: { stats: { spd: 5, ev: 4, aa: 6, ag: 5, hp: 4, str: 8, gun: 3, hard: 2 }, props: [], ...planeSys }, getFlag: () => undefined };
  const items = [p, ...triggers];
  s.parent = { items: Object.assign(items, { filter: Array.prototype.filter, find: Array.prototype.find, some: Array.prototype.some }), getFlag: () => [] };
  Object.defineProperty(s, "plane", { get: () => p });
  s.prepareDerivedData();
  const fmt = o => Object.entries(o).map(([k, v]) => `${k}${v}`).join(",");
  return `proto ${s.proto} perk[${fmt(s.perkOn)}] comp[${fmt(s.compOn)}] ground perk ${s.groundPerkOn.aim} comp ${s.groundCompOn.aim} aim ${s.skillTotal?.aim ?? s.skillsEff?.aim ?? "?"} evasion ${s.evasion} gun ${s.gun ?? "?"} maxSpeed ${s.maxSpeed}`;
}
console.log("tester proto:", pilot({ key: "prt", base: "Experimental Prototype" }, [trig("tester")]));
console.log("tester serial:", pilot({ key: "mig29a", cls: "Фронтовой истребитель" }, [trig("tester")]));
console.log("tester serial + tune:", pilot({ key: "mig29a" }, [trig("tester")], [{ kind: "tune", stat: "aa", used: false }]));
console.log("no tester:", pilot({ key: "prt", base: "Experimental Prototype" }, []));
console.log("code off:", pilot({ key: "mig29a" }, [trig("code")]));
console.log("code on:", pilot({ key: "mig29a" }, [trig("code", { active: true })]));
console.log("code + gauntlet + oldschool:", pilot({ key: "mig29a" }, [trig("code", { active: true }), trig("gauntlet", { active: true }), trig("oldschool", { active: true })]));
console.log("limiter on:", pilot({ key: "mig29a" }, [trig("limiter", { active: true })]));
// предел Связи
const { bondCap } = await import(`${root}/module/downtime.mjs`);
const withTrig = key => ({ items: [{ type: "trigger", system: { key } }] });
console.log("bond cap: pilot", bondCap(withTrig("byside"), false), "| merc", bondCap(withTrig("contract"), false), "| npc", bondCap(withTrig("byside"), true));
