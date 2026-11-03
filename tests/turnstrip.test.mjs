// Полоска очереди ходов: кто ходит, кто следующие двое, кого не показывать.
import { fileURLToPath as __f } from "node:url";
process.argv[2] ??= __f(new URL("..", import.meta.url)).replace(/\/$/, "");
const R = process.argv[2];
globalThis.Hooks = { on() {}, once() {} };
const S = await import(R + "/module/turn-strip.mjs");
const r = (name, side, o = {}) => ({ id: name, name, side, ...o });
const rows = [r("Гроза", "player"), r("Стрикс-2", "enemy"), r("Засада", "enemy", { hidden: true }), r("Склад", "enemy", { passive: true }), r("Сбитый", "enemy", { out: true }), r("Баклер", "ally"), r("Ас", "enemy")];
const line = s => s ? `${s.now.name} → ${s.next.map(x => x.name).join(", ") || "—"}${s.end ? " · конец раунда" : ""}` : "нет";
console.log("игрок, ход Грозы:", line(S.stripOf(rows, 0)));
console.log("ведущий, ход Грозы:", line(S.stripOf(rows, 0, { isGM: true })));
console.log("игрок, ход Баклера:", line(S.stripOf(rows, 5)));
console.log("игрок, ход скрытой засады:", line(S.stripOf(rows, 2)));
console.log("последний в раунде:", line(S.stripOf(rows, 6)));
console.log("хода нет:", line(S.stripOf(rows, 9)));
