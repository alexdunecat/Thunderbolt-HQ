// Запуск: node tests/run.mjs (сверяет вывод со снимком в tests/snapshots)
// Заставка АСУ «Тайга»: строки лога по режимам связи, гриф и предупреждения, настройки со сцены, экранирование разметки.
import { fileURLToPath as __f } from "node:url";
process.argv[2] ??= __f(new URL("..", import.meta.url)).replace(/\/$/, "");
const R = process.argv[2];
globalThis.Hooks = { on() {}, once() {} };
const B = await import(R + "/module/boot.mjs");

for (const mode of Object.keys(B.LINK_MODES)) {
  const lines = B.linesFor(mode);
  const bad = lines.filter(l => [l[2]].flat().some(p => String(p ?? "").trim().startsWith("!"))).length;
  const wide = lines.map(l => B.logText(l, "СЕКРЕТНО")).filter(t => t.length > 74);
  console.log(`${mode}: строк ${lines.length}, отказов ${bad}, предупреждений ${lines.filter(l => l[0] === "warn").length}, длинных ${wide.length}`);
  console.log("  " + lines.filter(l => l[0] === "warn").map(l => B.logText(l, B.grifOf("секретно"))).join(" | "));
}
console.log("неизвестный режим = обычный:", JSON.stringify(B.linesFor("x")) === JSON.stringify(B.linesFor("main")));
console.log("точки:", B.logText(["", "ПИТАНИЕ 380 В · 50 ГЦ", "НОРМА"]));
for (const g of ["", "  особой   важности ", "Для служебного пользования", "Литер А"]) console.log(`гриф «${g}» →`, B.grifOf(g), "·", B.grifLabel(B.grifOf(g)), "·", B.warnOf(B.grifOf(g)));

const scene = (flags = {}, name = "Миссия 04") => ({ name, navName: "", getFlag: (s, k) => flags[k] });
console.log(JSON.stringify(B.bootOptions(scene({ mission: "Гроза над Круиком" }))));
console.log(JSON.stringify(B.bootOptions(scene({ boot: { op: "Свой", link: "joint", len: "short", ph: "amber", grif: "Секретно" } }))));
console.log(JSON.stringify(B.bootOptions(scene({}), { link: "??", ph: "blue", len: "x", grif: "   " })));
console.log(JSON.stringify(B.bootOptions(null, {})));

const html = B.bootHtml(B.bootOptions(null, { op: "<script>x</script>", grif: "a&b", link: "intercept" }));
console.log("экранировано:", !html.includes("<script>x") && html.includes("&lt;SCRIPT&gt;") && html.includes("A&amp;B"));
console.log("перехват красный в углу:", /class="alarm">ПЕРЕХВАТ/.test(html), "· знак OADF в разметке:", html.includes('class="osea"'));
console.log("совместно, подпись:", /ШЛЮЗ «МОСТ»/.test(B.bootHtml(B.bootOptions(null, { link: "joint" }))));
