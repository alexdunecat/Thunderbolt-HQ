// старые и новые силуэты рядом, цвета как в токенах
const fs = require("fs"), vm = require("vm");
function load(file) { const ctx = { window: {} }; vm.runInNewContext(fs.readFileSync(file, "utf8"), ctx); return ctx.window.YK; }
const oldY = load(process.argv[2]), newY = load(process.argv[3]);
const fix = s => s.replace(/var\(--surface\)/g, "#E9E4D2").replace(/var\(--ink\)/g, "#1E2822").replace(/var\(--muted\)/g, "#8a8f86").replace(/var\(--olive-soft\)/g, "#9DAA7A").replace(/var\(--surface-2\)/g, "#d8d2bc");
const names = ["mig21", "mig29", "su27", "su25", "mig31", "su30"];
let html = `<html><body style="margin:0;background:#fff;font:14px sans-serif"><table><tr>${names.map(n => `<th>${n}</th>`).join("")}</tr>`;
for (const Y of [oldY, newY]) html += `<tr>${names.map(n => `<td style="width:220px;height:330px">${fix(Y.silhouette(n)).replace("<svg ", '<svg width="210" height="320" ')}</td>`).join("")}</tr>`;
html += `<tr>${names.map(n => `<td>${fix(newY.silhouette(n)).replace("<svg ", '<svg width="70" height="70" ')}${fix(newY.silhouette(n)).replace("<svg ", '<svg width="40" height="40" ')}</td>`).join("")}</tr>`;
fs.writeFileSync(process.argv[4], html + "</table></body></html>");
