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
  const base = { key: n.id, kind: n.kind, grp: n.grp, grpName: grpName[n.grp] || "", name: n.name, nato: n.nato, cls: n.cls, desc: n.desc || "", service: n.service || "", short: n.short };
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
  terrain: TERRAIN, effects: EFFECTS, markers: MARKERS, alias: ALIAS
};
fs.writeFileSync(path.join(ROOT, "data/catalog.json"), JSON.stringify(out, null, 1));

/* Рамка силуэтов неквадратных токенов [ширина, длина] в клетках, как TB.footprints в module/config.mjs. */
const FRAME = { aerial: [6, 2], arkbird: [2, 3], scinfaxi: [1, 3] };
for (const s of shapes) {
  let svg = fix(Y.silhouette(s)).replace(' role="img" aria-label="Силуэт сверху"', ' xmlns="http://www.w3.org/2000/svg"');
  // поле в пропорциях токена (у больших целей — по их клеткам, у остальных квадрат), чтобы силуэт заполнял рамку
  const [fw, fh] = FRAME[s] ?? [1, 1], a = fw / fh, h = Y.SHAPES[s].h + 20;
  const bw = Math.max(220, h * a), bh = bw / a, dx = (bw - 220) / 2, dy = (bh - h) / 2;
  const px = a >= 1 ? [512, Math.round(512 / a)] : [Math.round(512 * a), 512];
  svg = svg.replace(/viewBox="0 0 220 \d+"/, `viewBox="${+(-dx).toFixed(2)} ${+(-dy).toFixed(2)} ${+bw.toFixed(2)} ${+bh.toFixed(2)}" width="${px[0]}" height="${px[1]}"`)
    .replace(/<line x1="110" y1="4"[^>]*\/>/, "");
  fs.writeFileSync(path.join(ROOT, "assets/planes", s + ".svg"), svg);
}
for (const i of icons) {
  const svg = fix(Y.targetIcon(i)).replace(' role="img" aria-label="Схема сбоку"', ' xmlns="http://www.w3.org/2000/svg"')
    .replace('viewBox="0 0 320 160"', 'viewBox="0 -80 320 320" width="512" height="512"');
  fs.writeFileSync(path.join(ROOT, "assets/targets", i + ".svg"), svg);
}
console.log(`catalog: ${planes.length} planes, ${book.length} book, ${weapons.length} weapons, ${npcs.length} npcs, ${triggers.length} triggers; ${shapes.size} silhouettes, ${icons.size} icons`);
