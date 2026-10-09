/* Собирает компендиумы: data/catalog.json + data/memo-pages.json -> packs-src/<pack>/*.json -> packs/<pack> (LevelDB).
   Нужен @foundryvtt/foundryvtt-cli (npm install). Запуск: node tools/build-packs.mjs */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { planeItem, weaponItem, triggerItem, npcActor } from "../module/data/catalog-docs.mjs";

// CLI можно указать путём к index.mjs через FVTT_CLI, если node_modules лежит в другом месте
const { compilePack } = await import(process.env.FVTT_CLI ?? "@foundryvtt/foundryvtt-cli");
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cat = JSON.parse(fs.readFileSync(path.join(ROOT, "data/catalog.json"), "utf8"));
const memo = JSON.parse(fs.readFileSync(path.join(ROOT, "data/memo-pages.json"), "utf8"));
const SYS = "thunderbolt-shtab";

const id = s => crypto.createHash("sha1").update(SYS + ":" + s).digest("base64").replace(/[^A-Za-z0-9]/g, "").slice(0, 16);
const stats = { systemId: SYS, systemVersion: "0.1.0", coreVersion: "12.343" };

const packs = {};
function add(pack, collection, doc) {
  (packs[pack] ??= []).push({ ...doc, _key: `!${collection}!${doc._id}` });
}
const folders = {};
function folder(pack, type, name, sort) {
  const fid = id(`folder:${pack}:${name}`);
  if (!folders[fid]) {
    folders[fid] = true;
    add(pack, "folders", { _id: fid, name, type, sorting: "m", sort: sort * 100, folder: null, color: null, flags: {} });
  }
  return fid;
}

// самолёты: по категориям ангара, шаблоны книги отдельно
const catOrder = ["multi", "fighter", "attack", "bomber", "book"];
cat.planes.concat(cat.book).forEach((p, i) => {
  const d = planeItem(p);
  add("planes", "items", { _id: id("plane:" + p.key), ...d, folder: folder("planes", "Item", p.catName || "Шаблоны книги", catOrder.indexOf(p.cat)),
    sort: (p.tier || 0) * 1000 + i, effects: [], flags: {}, _stats: stats });
});
// спецоружие: по группам
const wGroups = [...new Set(cat.weapons.map(w => w.group))];
cat.weapons.forEach((w, i) => add("weapons", "items", {
  _id: id("weapon:" + w.key), ...weaponItem(w), folder: folder("weapons", "Item", w.group, wGroups.indexOf(w.group)),
  sort: i, effects: [], flags: {}, _stats: stats }));
// триггеры: по архетипам
const archName = Object.fromEntries(cat.archetypes.map(a => [a.key, a.name]));
cat.triggers.forEach((t, i) => add("triggers", "items", {
  _id: id("trigger:" + t.key), ...triggerItem(t), folder: folder("triggers", "Item", archName[t.archetype] || "Общие", cat.archetypes.findIndex(a => a.key === t.archetype)),
  sort: (t.types.includes("Core") ? 0 : 100) + i, effects: [], flags: {}, _stats: stats }));
// NPC и цели: по группам штаба
const grpOrder = [...new Set(cat.npcs.map(n => n.grp))];
cat.npcs.forEach((n, i) => {
  const d = npcActor(n, { tier: "conscript" });
  const aid = id("npc:" + n.key);
  add("npcs", "actors", { _id: aid, ...d, folder: folder("npcs", "Actor", n.grpName, grpOrder.indexOf(n.grp)), sort: i,
    items: [], effects: [], flags: {}, _stats: stats,
    prototypeToken: { ...d.prototypeToken, bar1: { attribute: "hp" }, bar2: { attribute: null }, displayBars: 20, displayName: 30 } });
});
// самолёты ангара игроков тоже бывают противниками или союзниками: отдельная папка в конце
const hangar = cat.planeNpcs.filter(n => n.grp === "player");
hangar.forEach((n, i) => {
  const d = npcActor(n, { tier: "conscript" });
  add("npcs", "actors", { _id: id("npc:player:" + n.key), ...d, folder: folder("npcs", "Actor", "Ангар Юктобании", grpOrder.length), sort: 10000 + i,
    items: [], effects: [], flags: {}, _stats: stats,
    prototypeToken: { ...d.prototypeToken, bar1: { attribute: "hp" }, bar2: { attribute: null }, displayBars: 20, displayName: 30 } });
});
// памятка пилота
const jid = id("journal:memo");
add("rules", "journal", {
  _id: jid, name: "Памятка пилота", folder: null, sort: 0, _stats: stats, ownership: { default: 2 },
  flags: { core: { sheetClass: "thunderbolt-shtab.TBMemoSheet" } },
  pages: memo.map((p, i) => ({
    _id: id("page:" + i + ":" + p.name), _key: `!journal.pages!${jid}.${id("page:" + i + ":" + p.name)}`,
    name: p.name, type: "text", title: { show: true, level: 1 }, text: { format: 1, content: p.html },
    sort: (i + 1) * 100000, ownership: { default: -1 }, flags: {}, _stats: stats
  }))
});

// LevelDB не работает на некоторых сетевых дисках: тогда собирайте в PACKS_TMP и копируйте в packs/
const SRC = path.join(ROOT, "packs-src"), OUT = path.join(ROOT, "packs"), TMP = process.env.PACKS_TMP;
fs.rmSync(SRC, { recursive: true, force: true });
fs.rmSync(OUT, { recursive: true, force: true });
for (const [pack, docs] of Object.entries(packs)) {
  const dir = path.join(SRC, pack);
  fs.mkdirSync(dir, { recursive: true });
  for (const d of docs) fs.writeFileSync(path.join(dir, `${d._key.split("!")[1]}_${d._id}.json`), JSON.stringify(d, null, 1));
  const dest = path.join(TMP ?? OUT, pack);
  fs.rmSync(dest, { recursive: true, force: true });
  await compilePack(dir, dest, { log: false });
  if (TMP) { fs.rmSync(path.join(dest, "LOCK"), { force: true }); fs.cpSync(dest, path.join(OUT, pack), { recursive: true }); }
  console.log(`${pack}: ${docs.length} документов`);
}
