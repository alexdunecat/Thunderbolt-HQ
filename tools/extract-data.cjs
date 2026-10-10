/* Собирает data/catalog.json и SVG-картинки токенов из общего справочника Штаба.
   Запуск: node tools/extract-data.cjs [путь к shtab/src] */
const fs = require("fs"), path = require("path");
const SRC = process.argv[2] || "/mnt/project-files/shtab/src";
const ROOT = path.resolve(__dirname, "..");
const SYS = "systems/thunderbolt-shtab/";

global.window = {};
eval(fs.readFileSync(path.join(SRC, "data.js"), "utf8"));
const Y = window.YK;

// триггеры и архетипы берём из досье (блок справочных данных до состояния страницы)
const ds = fs.readFileSync(path.join(SRC, "dossier.js"), "utf8");
const refBlock = ds.slice(ds.indexOf("const SKILLS="), ds.indexOf("/* ---------------- state"));
const D = new Function("window", refBlock.replace(/const PLANES=\(\(\)=>\{[\s\S]*?\n\}\)\(\);/, "") +
  "\nreturn {SKILLS, ARCH, STATUS, TT, T, SYS, ALTS};")(window);

// awacs: местность, эффекты, метки, старые ссылки
const aw = fs.readFileSync(path.join(SRC, "awacs.js"), "utf8");
const grab = name => {
  const i = aw.indexOf("const " + name + " = ");
  const j = aw.indexOf(";\n", i);
  return new Function("return " + aw.slice(i + ("const " + name + " = ").length, j))();
};
const TERRAIN = grab("TERRAIN"), EFFECTS = grab("EFFECTS"), MARKERS = grab("MARKERS"), ALIAS = grab("ALIAS");
const TUNNEL = grab("TUNNEL"), TUNNEL_ART = grab("TUNNEL_ART");
// цвета местности берём из бумажного скина планшета (первый блок --t-* в awacs.css)
const css = fs.readFileSync(path.join(SRC, "awacs.css"), "utf8");
const tcol = {};
for (const m of css.slice(0, css.indexOf("}")).matchAll(/--t-([a-z]+):(#[0-9A-Fa-f]{6})/g)) tcol[m[1]] = m[2];
TERRAIN.forEach(t => t.color = tcol[t.id] || "#cccccc");

/* ---------- SVG токенов ---------- */
const COLORS = { "--surface": "#E9E4D2", "--surface-2": "#C9C3AE", "--ink": "#1E2822", "--muted": "#6B7468", "--olive-soft": "#9DAA7A" };
const fix = s => s.replace(/var\((--[a-z0-9-]+)\)/g, (_, v) => COLORS[v] || "#888");
const shapes = new Set();
const icons = new Set();
function planeImg(shape) { if (!shape || !Y.SHAPES[shape]) shape = "mig29"; shapes.add(shape); return SYS + "assets/planes/" + shape + ".svg"; }
function targetImg(icon) {
  if (Y.SHAPES[icon]) return planeImg(icon);
  if (!Y.ICONS[icon]) icon = "ship";
  icons.add(icon); return SYS + "assets/targets/" + icon + ".svg";
}
const BOOK_SHAPE = { fb: "su27", fa: "mig29", mra: "su35", mrd: "su30", ga: "su25", gs: "a10", hsi: "mig31", prt: "su47" };

const rulesOf = keys => (keys || []).map(k => Y.RULES[k] ? { key: k, name: Y.RULES[k][0], text: Y.RULES[k][1] } : (Y.NPC_PROPS[k] ? { key: k, name: Y.NPC_PROPS[k].name, text: Y.NPC_PROPS[k].text } : null)).filter(Boolean);
const propsOf = keys => (keys || []).map(k => Y.PROPS[k] ? { key: k, name: Y.PROPS[k].name, text: Y.PROPS[k].text } : (Y.NPC_PROPS[k] ? { key: k, name: Y.NPC_PROPS[k].name, text: Y.NPC_PROPS[k].text } : null)).filter(Boolean);
const catName = Object.fromEntries(Y.CATS);
const grpName = Object.fromEntries(Y.NPC_GROUPS);

const planes = Y.PLANES.filter(p => !p.npc).map(p => ({
  key: p.id, name: p.name, nato: p.nato, cls: p.cls, cat: p.cat, catName: catName[p.cat] || "", tier: p.tier, tierName: Y.TIERS[p.tier],
  base: p.base, seats: p.seats || 1, carrier: !!p.carrier, est: !!p.est,
  stats: { spd: p.tb.spd, ev: p.tb.ev, aa: p.tb.aa, ag: p.tb.ag, hp: p.tb.hp, str: p.tb.str, gun: p.tb.gun, hard: p.tb.hard },
  props: propsOf(p.props), sig: p.sig || [], ac5: p.ac5 || null, desc: p.desc || "", service: p.service || "", img: planeImg(p.shape)
}));
const book = Y.BOOK.map(b => ({
  key: b.id, name: b.name, nato: b.ex, cls: "Шаблон книги", cat: "book", catName: "Шаблоны книги", tier: 0, tierName: "",
  base: b.name, seats: 1, carrier: false, est: false,
  stats: { spd: b.s[0], ev: b.s[1], aa: b.s[2], ag: b.s[3], hp: b.s[4], str: b.s[5], gun: b.s[6], hard: b.s[7] },
  props: propsOf(b.props), sig: [], ac5: null, desc: "", service: "", img: planeImg(BOOK_SHAPE[b.id])
}));
const wgroup = {}; Y.GROUPS.forEach(([g, keys]) => keys.forEach(k => wgroup[k] = g));
const weapons = Object.entries(Y.WEAPONS).map(([k, w]) => ({
  key: k, name: w.name, ammo: w.ammo, dmg: w.dmg, aa: w.aa, ag: w.ag, aim: w.aim, dep: w.dep, kind: w.kind, target: w.target, fx: w.fx, group: wgroup[k] || ""
}));
const npcs = Y.NPCS.map(n => {
  const base = { key: n.id, kind: n.kind, grp: n.grp, grpName: grpName[n.grp] || "", side: n.side || "enemy", name: n.name, nato: n.nato, cls: n.cls, desc: n.desc || "", service: n.service || "", short: n.short };
  if (n.kind === "air") return Object.assign(base, {
    seats: n.seats || 1, carrier: !!n.carrier,
    stats: { spd: n.tb.spd, ev: n.tb.ev, aa: n.tb.aa, ag: n.tb.ag, hp: n.tb.hp, gun: n.tb.gun },
    props: propsOf(n.props), sig: n.sig || [], img: planeImg(n.shape) });
  if (n.kind === "ground") return Object.assign(base, {
    t: { occ: n.t.occ, hp: n.t.hp, ga: n.t.ga, gg: n.t.gg, gun: n.t.gun, strafe: n.t.strafe || 0 },
    rules: rulesOf(n.rules), img: targetImg(n.icon) });
  const systems = [];
  n.systems.forEach(s => { for (let i = 1; i <= s.x; i++) systems.push({ name: s.n + (s.x > 1 ? " №" + i : ""), occ: s.occ, hp: s.hp, ga: s.ga, gg: s.gg, gun: s.gun, note: s.note || "" }); });
  return Object.assign(base, { systems, rules: rulesOf(n.rules), img: targetImg(n.icon) });
});
// игроковские машины и шаблоны книги тоже могут лететь против игроков: даём им «воздушный» вид NPC для импорта миссий
const airFromPlane = p => ({ key: p.key, kind: "air", grp: p.cat === "book" ? "book" : "player", grpName: p.cat === "book" ? "Шаблоны книги" : "Ангар игроков",
  name: p.name, nato: p.nato, cls: p.cls, desc: p.desc, service: p.service, seats: p.seats, carrier: p.carrier,
  stats: { spd: p.stats.spd, ev: p.stats.ev, aa: p.stats.aa, ag: p.stats.ag, hp: p.stats.hp, gun: p.stats.gun }, props: p.props, sig: p.sig, img: p.img });

const triggers = Object.entries(D.T).filter(([k]) => k !== "custom").map(([k, t]) => ({
  key: k, archetype: t.a, name: t.n, en: t.en, types: t.ty, text: t.t, skills: t.sk || 0, mod: t.mod || 0, slot: !!t.slot }));
const archetypes = Object.entries(D.ARCH).map(([k, a]) => ({ key: k, name: a.n, core: a.core }));

const out = {
  generated: new Date().toISOString().slice(0, 10),
  planes, book, weapons, npcs, planeNpcs: planes.concat(book).map(airFromPlane),
  triggers, archetypes, triggerTypes: D.TT, status: Object.fromEntries(Object.entries(D.STATUS).map(([k, s]) => [k, s.n])),
  terrain: TERRAIN, effects: EFFECTS, markers: MARKERS, alias: ALIAS, tunnel: TUNNEL, tunnelArt: TUNNEL_ART
};
fs.writeFileSync(path.join(ROOT, "data/catalog.json"), JSON.stringify(out, null, 1));

/* Пропорции поля силуэтов неквадратных токенов [ширина, длина], по TB.footprints в module/config.mjs
   (Гигес и Коттос занимают одну зону, но сами шире, чем длиннее). */
const FRAME = { aerial: [3, 2], arkbird: [2, 3], solg: [2, 3], scinfaxi: [1, 3], topol: [1, 2] };
// корабли флота крупнее катера (TB.footprints.fleet)
for (const k of ["ferry", "nimitz", "kuznetsov", "iowa", "kirov", "ticonderoga", "burke", "sovremenny", "udaloy", "krivak", "perry", "ropucha", "tanker", "la688"]) FRAME[k] = [1, 2];
/* Токены в стиле «Брифинг» (стекло): белые линии, цвет стороны даёт тонировка в Foundry (module/sidecolor.mjs).
   Пишем все силуэты и все старые мишени: на них могут ссылаться актёры старых миров. */
const { tokenIcon } = require("./token-icon.cjs");
// старые иконки мишеней (вид сбоку) -> силуэт сверху той же машины
const TARGETS = { aa: "zu23", apc: "btr80", battleship: "iowa", boat: "molniya", bridge: "bridge", building: "bunker", carrier: "nimitz",
  cruiser: "ticonderoga", destroyer: "burke", frigate: "perry", howitzer: "m198", landship: "tarpan", launcher: "mlrs", manpads: "manpads",
  radar: "p18", sam: "s75", samMobile: "osa", ship: "tanker", spg: "msta", sub: "la688", superSub: "scinfaxi", "tank-farm": "fuel",
  tank: "t80u", tel: "topol", truck: "ural" };
// виды сверху для токенов в несколько клеток: поле в пропорциях токена
for (const k of ["battleship", "carrier", "cruiser", "destroyer", "frigate", "ship", "sub", "superSub"]) TARGETS[k + "-top"] = TARGETS[k];
const TOP_FRAME = { "superSub-top": [1, 3] };
const token = (shape, frame) => tokenIcon(Y.SHAPES, shape, { side: "white", variant: "glass", frame });
for (const s of Object.keys(Y.SHAPES)) fs.writeFileSync(path.join(ROOT, "assets/planes", s + ".svg"), token(s, FRAME[s] ?? [1, 1]));
for (const [i, s] of Object.entries(TARGETS)) {
  if (!Y.SHAPES[s]) throw new Error("нет силуэта " + s);
  const frame = i.endsWith("-top") ? TOP_FRAME[i] ?? [1, 2] : [1, 1];
  fs.writeFileSync(path.join(ROOT, "assets/targets", i + ".svg"), token(s, frame));
}
console.log(`catalog: ${planes.length} planes, ${book.length} book, ${weapons.length} weapons, ${npcs.length} npcs, ${triggers.length} triggers; ${shapes.size} silhouettes, ${icons.size} icons`);
