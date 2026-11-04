// Запуск: node tests/run.mjs (сверяет вывод со снимком в tests/snapshots)
// Боевой экран, огни ночью, кильватер и пыль, щелчок рации, штриховка погоды под анимацией
import { fileURLToPath as __f } from "node:url";
process.argv[2] ??= __f(new URL("..", import.meta.url)).replace(/\/$/, "");
const R = process.argv[2];
Object.assign(globalThis, {
  foundry: { utils: { deepClone: x => structuredClone(x), hasProperty: () => false }, abstract: { TypeDataModel: class {} }, data: { fields: {} } },
  Hooks: { on() {}, once() {} }, CONFIG: {}, game: { settings: { get: () => { throw new Error("нет"); } } }
});
const r1 = x => Math.round(x * 10) / 10;
const C = await import(R + "/module/combat-screen.mjs");
const cases = [{ inCombat: true }, { inCombat: true, isGM: true }, { inCombat: true, isGM: true, mode: "all" }, { inCombat: true, override: false }, { inCombat: true, isGM: true, override: true }, { inCombat: false, override: true }, { inCombat: false }, { inCombat: true, mode: "off" }];
console.log("боевой экран:", cases.map(c => `${JSON.stringify(c)}=${C.screenWanted(c) ? "прячет" : "нет"}`).join("\n  "));

const actor = (type, system, flags = {}) => ({ type, system, getFlag: (ns, k) => flags[k] });
const N = await import(R + "/module/night-lights.mjs");
const list = [["пилот", actor("pilot", { alt: "high" })], ["истребитель NPC", actor("npc", { kind: "air", alt: "med" })], ["корабль", actor("npc", { kind: "ship" })],
  ["подлодка под водой", actor("npc", { kind: "ship" }, { unit: { sub: true } })], ["ЗРК", actor("npc", { kind: "ground", grp: "ad" })], ["танк", actor("npc", { kind: "ground", grp: "armor" })], ["завод", actor("npc", { kind: "ground", grp: "obj" })], ["вертолёт", actor("npc", { kind: "air", grp: "heli", alt: "low" })], ["штаб", actor("staff", {})]];
console.log("огни:", list.map(([n, a]) => `${n}=${N.lightsOf(a) ?? "—"}`).join(", "));
{ // форма по картинке: крестик-самолёт 20×20, крылья в строке 8, хвост внизу
  const w = 20, h = 20, px = new Uint8ClampedArray(w * h * 4), put = (x, y) => { px[(y * w + x) * 4 + 3] = 255; };
  for (let y = 2; y < 18; y++) put(10, y); for (let x = 3; x < 18; x++) put(x, 8); for (let x = 7; x < 14; x++) put(x, 16);
  const g = N.shapeFromAlpha(px, w, h);
  console.log("форма:", `левый ${r1(g.left.u * 20)},${r1(g.left.v * 20)} правый ${r1(g.right.u * 20)},${r1(g.right.v * 20)} нос ${r1(g.top * 20)} хвост ${r1(g.bottom * 20)}`);
  const cnt = l => Object.entries(l.reduce((m, x) => ({ ...m, [x.k + (x.c ? ":" + x.c : "")]: (m[x.k + (x.c ? ":" + x.c : "")] ?? 0) + 1 }), {})).map(([k, n]) => `${k}×${n}`).join(" ");
  for (const k of ["plane", "heli", "ship", "vehicle", "building"]) console.log(`огни ${k}:`, cnt(N.layoutFor(k, g, { seed: 3, tall: true })));
  console.log("огни авианосца:", N.layoutFor("ship", g, { carrier: true }).length, "· пустая картинка:", N.shapeFromAlpha(new Uint8ClampedArray(16), 2, 2));
  for (const t of ["city", "village", "industry", "port", "base", "sea"]) console.log(`клетка ${t}:`, N.settlementLights(t, 0, 5).length);
  const pr = N.settlementLights("port", 90, 5)[1], p0 = N.settlementLights("port", 0, 5)[1];
  console.log("порт повёрнут:", `${r1(p0.x)},${r1(p0.y)} → ${r1(pr.x)},${r1(pr.y)}`);
  const run = Array.from({ length: 14 }, (_, k) => N.settlementLights("base").filter(l => l.k === "rabbit").map(l => N.lightLevel(l, k * 90)).join("")).join(" ");
  console.log("бегущий огонь:", run);
}
let on = 0; for (let t = 0; t < 1400; t += 10) if (N.strobeOn(t)) on++;
console.log("проблесковый: горит", on * 10, "мс из 1400 · сдвиг меняет:", N.strobeOn(0, 0) !== N.strobeOn(0, 300));
const angs = Array.from({ length: 40 }, (_, i) => N.beamAngle(i * 500));
console.log("прожектор: от", r1(Math.min(...angs) * 180 / Math.PI), "до", r1(Math.max(...angs) * 180 / Math.PI), "градусов (−90 — вверх)");

const Fx = await import(R + "/module/fx.mjs");
console.log("след по земле:", list.map(([n, a]) => `${n}=${Fx.groundTrailOf(a) ?? "—"}`).join(", "), "· объект", Fx.groundTrailOf(actor("npc", { kind: "ground", grp: "obj" })) ?? "—");
{ const tarpan = actor("npc", { kind: "ship", grp: "boss", props: [{ key: "landship" }] });
  console.log("Тарпан:", ["plains", "coast", "sea", null].map(t => `${t ?? "без карты"}=${Fx.groundTrailOf(tarpan, t)}`).join(", "));
  const m = Fx.treadMarks({ x: 0, y: 0 }, { x: 100, y: 0 }, 100);
  console.log("колея: отпечатков", m.length, "· полосы по y", [...new Set(m.map(o => r1((o.y1 + o.y2) / 2)))].join(" "), "· длина отпечатка", r1(Math.hypot(m[0].x2 - m[0].x1, m[0].y2 - m[0].y1)), "· стоит на месте", Fx.treadMarks({ x: 5, y: 5 }, { x: 5, y: 6 }, 100).length); }
const pts = Fx.surfPoints({ x: 0, y: 0 }, { x: 100, y: 0 }, 100);
console.log("точки кильватера на восток:", pts.length, "· первая", r1(pts[0].x), "· последняя", r1(pts.at(-1).x), "· направление", pts[0].ux, pts[0].uy, "· на месте:", Fx.surfPoints({ x: 0, y: 0 }, { x: 1, y: 0 }, 100).length);

const S = await import(R + "/module/sounds.mjs");
console.log("щелчок рации:", [[70, 1, false], [100, 0.5, false], [0, 1, false], [70, 1, true]].map(([o, c, m]) => `${o}×${c}${m ? " выкл" : ""}=${r1(S.squelchVolume(o, c, m))}`).join(" "), "· файл:", S.SRC("squelch").split("/").pop());

const W = await import(R + "/module/weather-fx.mjs");
console.log("штриховка под анимацией:", ["systems/x/map/weather/rain.svg", "systems/x/map/weather/rain-badge.svg", "systems/x/map/weather/clouds.svg", "systems/x/map/weather/eye.svg", "systems/x/map/weather/tornado.svg", "systems/x/map/terrain/city.svg", null]
  .map(s => `${s?.split("/").slice(-2).join("/") ?? "—"}=${W.hatchOf(s) ?? "остаётся"}`).join(", "));

// вспышки ночью: кривые яркости и затемнение машин молнией
console.log("вспышка boom:", [0, 0.03, 0.06, 0.3, 0.6, 0.99, 1].map(k => N.flashLevel(k, "boom").toFixed(2)).join(" "));
console.log("вспышка steady:", [0, 0.025, 0.5, 0.9, 1].map(k => N.flashLevel(k, "steady").toFixed(2)).join(" "));
console.log("молния:", [0.05, 0.2, 0.5, 0.9].map(k => N.flashLevel(k, "bolt").toFixed(2)).join(" "));
const fire = [0.1, 0.5, 0.9].map(k => N.flashLevel(k, "fire", 1234, 1));
console.log("пожар гаснет:", fire.every((v, i) => !i || v < fire[i - 1] + 0.3), fire.every(v => v > 0 && v <= 1));
console.log("силуэт:", N.mixColor(0xffffff, 0x10141f, 0).toString(16), N.mixColor(0xffffff, 0x10141f, 1).toString(16), N.mixColor(0xffffff, 0x000000, 0.5).toString(16));

// выбор метки в стиле кабины: плитки навыков и систем, занятые метки выключены
const HP = await import(R + "/module/hit-pick.mjs");
const pilotA = { name: "Тсой", system: { hp: { max: 4 }, skills: { aim: 2, dodge: 1 }, skillTotal: { aim: 3, dodge: 1, push: 0 }, markers: { grit: true } } };
const hp = HP.hitPickHtml(pilotA, { fake: { name: "Обманный манёвр" } });
console.log("выбор метки:", (hp.match(/data-pick="grit"/g) ?? []).length, "навыков,", (hp.match(/data-pick="structure"/g) ?? []).length, "систем,",
  "Grit выключен:", /tb-hp-col grit done/.test(hp), "· Doom есть:", /data-pick="doom"/.test(hp), "· манёвр:", /data-pick="fakeout"/.test(hp), "· ранг Aim:", /ранг 3/.test(hp));
console.log("без DOM — обычное окно:", await HP.hitPick(pilotA));

// решение стола после героической гибели: большинство, ничья, голос меняется
const V = await import(R + "/module/verdict.mjs");
const show = t => `победа ${t.win} · отступление ${t.retreat} · нужно ${t.need}/${t.total} · ${t.decided ?? (t.tie ? "ничья" : "ждём")}`;
console.log("голоса:", [
  [{}, ["a", "b", "c"]], [{ a: "win" }, ["a", "b", "c"]], [{ a: "win", b: "win" }, ["a", "b", "c"]], [{ a: "win", b: "retreat" }, ["a", "b"]],
  [{ a: "retreat", b: "retreat", c: "win" }, ["a", "b", "c", "d"]], [{ a: "retreat", b: "retreat", c: "win", d: "win" }, ["a", "b", "c", "d"]], [{ e: "win" }, []], [{}, []]
].map(([v, u]) => show(V.tally(v, u))).join("\n  "));
const vs = { name: "Тсой", call: "Кино", img: "", voters: [{ id: "a", name: "Саша" }, { id: "b", name: "Женя" }], votes: { a: "win" }, result: null };
const vh = V.verdictHtml(vs, { me: "a" });
console.log("окно игрока:", /tb-vd-opt win picked/.test(vh), "· чужой голос скрыт:", !/<em>1<\/em>/.test(vh), "· лампы:", (vh.match(/tb-vd-chip cast/g) ?? []).length);
console.log("окно ведущего:", /data-vd-force="win"/.test(V.verdictHtml(vs, { me: "gm", gm: true })), "· итог:", /tb-vd-stamp retreat/.test(V.verdictHtml({ ...vs, result: "retreat" }, { me: "a" })));

// судьба пилота при Doom: катапульта или гибель, исход на стекле
const fh = HP.fatePickHtml({ name: "Тсой", system: { skillTotal: { push: 2 }, strain: { value: 3 } } });
console.log("судьба:", /data-fate="eject"/.test(fh), /data-fate="hero"/.test(fh), "отложить:", /data-fate="later"/.test(fh), /d10 \+ 2/.test(fh), /есть 3/.test(fh));
console.log("исход:", ["ok", "hurt", "mia", "kia"].map(k => { const h = HP.fateResultHtml({ name: "Тсой", system: {} }, { d10: 5, d4: 2, total: 7, strain: 1, parts: [["Push", 1]] }, { key: k }); return `${h.match(/tb-fate-stamp \w+">([^<]+)/)?.[1]} (шаг 2: ${/tb-fate-step two/.test(h) ? h.match(/class="(\w+) on"/)?.[1] : "нет"})`; }).join(" · "));

// заявка действий у игрока: плитки 1/2/3/ПАС с местом в очереди против врага, скрытые и выбывшие не видны
const DP = await import(R + "/module/declare-pick.mjs");
const foesD = [{ name: "Кобра", v: 2 }, { name: "Гюрза", v: 1 }, { name: "Контакт 3", v: 3, unknown: true }, { name: "Ту-22М", v: 20 }];
console.log("очередь:", [1, 2, 3, 10].map(n => DP.orderLine(n, foesD)).join(" · "), "| без врага:", [1, 2, 3].map(n => DP.orderLine(n, [])).join(" · "));
const cb = (id, name, init, { npc = false, hidden = false, out = false } = {}) => ({ id, name, initiative: init, hidden, out, npc, token: { hidden: false, getFlag: () => (name.startsWith("Контакт") ? {} : null) },
  actor: { type: npc ? "npc" : "pilot", system: { plane: { name: "F-14D" }, hp: { value: 2, max: 3 }, strain: { value: 1, max: 4 } } } });
const me = cb("m", "Тсой", null), all = [me, cb("e1", "Кобра", 2, { npc: true }), cb("e2", "Контакт 1", 3, { npc: true }), cb("e3", "Призрак", 1, { npc: true, hidden: true }), cb("e4", "Сбитый", 1, { npc: true, out: true }), cb("p2", "Шершень", 1)];
const dd = DP.declareData({ round: 4, combatants: all }, [me], { npcSide: c => c.npc, declared: c => Number.isFinite(c.initiative), passive: () => false, isOut: c => c.out, hasWso: () => true });
console.log("стекло заявки:", JSON.stringify(dd.foes), JSON.stringify(dd.mates), dd.rows[0].plane, dd.rows[0].wso);
const dh = DP.declarePickHtml(dd);
console.log("плитки:", (dh.match(/class="tb-dp-tile[ "]/g) ?? []).length, "· одна машина без кнопки ЗАЯВИТЬ:", !/data-go/.test(dh), "· две:", /data-go/.test(DP.declarePickHtml({ ...dd, rows: [...dd.rows, { ...dd.rows[0], id: "x" }] })), "· без DOM:", await DP.declarePick(dd));

// эффекты одной настройкой: уровни и «свои»
const FQ = await import(R + "/module/fx-quality.mjs");
console.log("эффекты:", ["high", "medium", "low", "off"].map(l => `${l}=${Object.values(FQ.presetValues(l)).filter(Boolean).length}/${FQ.FX_LIST.length}→${FQ.presetOf(FQ.presetValues(l))}`).join(" · "),
  "| свои:", FQ.presetOf({ ...FQ.presetValues("medium"), fxVapor: true }));

// задачи на экране: группы целей, скрытые не называются, лимит времени; камера своего хода
const MH = await import(R + "/module/mission-hud.mjs");
const gv = MH.goalsView({ objectives: ["Разрушить РЛС у перевала", ""], timers: [{ name: "Лимит времени", value: 3, size: 6 }],
  goals: [{ name: "РЛС «Купол»", task: "destroy", out: "down" }, { name: "ЗРК-1", task: "destroy", out: null }, { name: "ЗРК-2", task: "destroy", out: "retreat" },
    { name: "Скрытый", task: "destroy", out: null, hidden: true }, { name: "Конвой", task: "protect", out: null }, { name: "Танкер", task: "escort", out: "down" }] });
console.log("задачи:", gv.groups.map(g => `${g.task} ${g.done}/${g.total} ${g.state} [${g.items.map(x => x.mark).join(",")}]`).join(" · "), "| текст:", gv.text.length, "| время:", JSON.stringify(gv.clocks), "| итог", `${gv.done}/${gv.total}`);
const gh = MH.goalsHtml(gv);
console.log("панель:", /ЗАДАЧИ/.test(gh), !/Скрытый/.test(gh), /1 из 3/.test(gh), /провалено/.test(gh), "| свёрнута:", MH.goalsHtml(gv, { collapsed: true }).includes("<ul>") ? "список" : "строка", "| пусто:", MH.goalsHtml(MH.goalsView()) === "");
console.log("камера:", [{ mine: true }, { mine: true, isGM: true }, { mine: false }, { mine: true, sinceTouch: 500 }, { mine: true, on: false }].map(o => MH.wantCamera(o) ? "едет" : "нет").join(" "));

// масштаб окон системы: высота окна браузера к 1080 × «Размер шрифта» Foundry к 14 px, или постоянный процент
const UI = await import(R + "/module/ui-scale.mjs");
console.log("масштаб окон:", [[720, 14], [900, 14], [1080, 14], [1440, 14], [2160, 14], [1080, 16], [1080, 12], [1440, 18], [600, 10]].map(([h, f]) => `${h}p/${f}px=${UI.uiScaleOf({ height: h, rootPx: f })}`).join(" · "),
  "| постоянный:", UI.uiScaleOf({ mode: "1.25", height: 720 }), UI.uiScaleOf({ mode: "мусор", height: 1080 }), "| сейчас:", UI.uiScale());
