// Проверки системы без Foundry: каждый tests/*.test.mjs запускается на заглушках, его вывод сверяется со снимком.
// node tests/run.mjs           — проверить всё
// node tests/run.mjs --update  — записать новые снимки (после намеренных изменений; глазами проверить diff)
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(dir);
const update = process.argv.includes("--update");
const only = process.argv.slice(2).filter(a => !a.startsWith("--"));
fs.mkdirSync(path.join(dir, "snapshots"), { recursive: true });
let failed = 0;
for (const file of fs.readdirSync(dir).filter(f => f.endsWith(".test.mjs")).sort()) {
  const name = file.replace(".test.mjs", "");
  if (only.length && !only.includes(name)) continue;
  let out;
  try {
    out = execFileSync(process.execPath, [path.join(dir, file), root], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 60000 });
  } catch (e) {
    failed++;
    console.log(`✗ ${name}: упал (код ${e.status})\n${(e.stdout ?? "") + (e.stderr ?? "")}`.trimEnd());
    continue;
  }
  const snap = path.join(dir, "snapshots", name + ".txt");
  if (update || !fs.existsSync(snap)) { fs.writeFileSync(snap, out); console.log(`• ${name}: снимок записан`); continue; }
  const want = fs.readFileSync(snap, "utf8");
  if (want === out) { console.log(`✓ ${name}`); continue; }
  failed++;
  const a = want.split("\n"), b = out.split("\n");
  const i = a.findIndex((l, k) => l !== b[k]);
  console.log(`✗ ${name}: вывод изменился со строки ${i + 1}\n  было: ${a[i] ?? "(конец)"}\n  стало: ${b[i] ?? "(конец)"}`);
}
if (failed) { console.log(`\nНе прошло: ${failed}. Если изменение намеренное: node tests/run.mjs --update`); process.exit(1); }
