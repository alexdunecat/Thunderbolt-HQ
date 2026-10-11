// Запуск: node tests/run.mjs (сверяет вывод со снимком в tests/snapshots)
// Справка «Мир на начало 2010» в журнале: страницы, карта, и ничего из того, что справка скрывает от игроков.
import { fileURLToPath as __f } from "node:url";
import fs from "node:fs";
process.argv[2] ??= __f(new URL("..", import.meta.url)).replace(/\/$/, "");
const R = process.argv[2];
const pages = JSON.parse(fs.readFileSync(R + "/data/world-pages.json", "utf8"));
const text = html => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
for (const p of pages) console.log(`${p.name}: ${text(p.html).length > 200 ? "текст есть" : "МАЛО ТЕКСТА"}`);
// карта и обложка компендиума лежат в системе, страница ссылается на карту
const map = R + "/assets/world/map.svg";
console.log("карта", fs.existsSync(map) && fs.readFileSync(map, "utf8").startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox='),
  "· на странице", pages[0].html.includes('src="systems/thunderbolt-shtab/assets/world/map.svg"'),
  "· обложка", fs.existsSync(R + "/assets/banners/world.svg"));
// горизонт знаний: зима 2009/2010, тайны кампании не раскрываются
const SECRET = [/Серы[ехм] люд/i, /Грюндер|Gründer/i, /SOLG/, /Мир без границ/i, /Хримфакси/i, /Разгриз/i, /Кармилл/i, /переворот/i, /Юктобанские замесы/i, /хоумрул/i, /Wardog|Вардог/i];
const all = pages.map(p => text(p.html)).join(" ");
console.log("скрытое:", SECRET.filter(r => r.test(all)).map(String).join(", ") || "нет");
// разметка Штаба не протекает: служебные полосы и якоря справки убраны
console.log("служебное:", ["os-bar", "doc-head", "href=\"#", "aria-"].filter(s => pages.some(p => p.html.includes(s))).join(", ") || "нет");
