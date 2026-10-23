// Запуск: node tests/run.mjs (сверяет вывод со снимком в tests/snapshots)
// Линия возврата: рисунок на карте, уход врага за линию (fail, later), прорыв рубежа, выбор пилота, возвращение с перевооружения.
import { fileURLToPath as __f } from "node:url";
import { tmpdir as __tmp } from "node:os";
process.argv[2] ??= __f(new URL("..", import.meta.url)).replace(/\/$/, "");
process.argv[3] ??= __tmp() + "/tb-test-out";
const R = process.argv[2];
const log = [], hooks = {}, S = "thunderbolt-shtab";
const users = [{ id: "gm", isGM: true, active: true }];
users.activeGM = users[0];
const messages = [];
Object.assign(globalThis, {
  Application: class {}, FormApplication: class {}, Dialog: class {},
  foundry: { utils: { deepClone: x => structuredClone(x), randomID: () => "r" + messages.length, hasProperty: (o, k) => k.split(".").reduce((x, p) => x?.[p], o) !== undefined, getProperty: (o, k) => k.split(".").reduce((x, p) => x?.[p], o) } },
  Hooks: { on: (n, f) => (hooks[n] ??= []).push(f), once: (n, f) => (hooks[n] ??= []).push(f) },
  CONFIG: { specialStatusEffects: { DEFEATED: "dead" } },
  CONST: { DRAWING_FILL_TYPES: { NONE: 0, SOLID: 1 }, GRID_TYPES: { SQUARE: 1 }, TOKEN_DISPOSITIONS: { HOSTILE: -1, FRIENDLY: 1, NEUTRAL: 0 } },
  ChatMessage: { create: async d => { const m = { id: "m" + messages.length, ...d, getFlag(s, k) { return this.flags?.[s]?.[k]; }, async update(u) { log.push("CARD → " + u.content.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()); this.flags[S].retline.done = u[`flags.${S}.retline.done`]; } };
    messages.push(m); log.push("CHAT " + (d.content ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()); return m; } },
  ui: { notifications: { info: t => log.push("INFO " + t), warn: t => log.push("WARN " + t) } }
});
const flagsOf = o => ({ getFlag(s, k) { return o.flags[k]; }, async setFlag(s, k, v) { o.flags[k] = structuredClone(v); log.push(`FLAG ${o.name} ${k}=${JSON.stringify(v).slice(0, 90)}`); }, async unsetFlag(s, k) { delete o.flags[k]; log.push(`UNFLAG ${o.name} ${k}`); } });
const scene = { name: "Залив", width: 1400, height: 1000, grid: { size: 200, type: 1 }, padding: 0, flags: {}, tokens: [], tiles: [], drawings: [], async deleteEmbeddedDocuments() {} };
Object.assign(scene, flagsOf(scene), { async update(u) { for (const [k, v] of Object.entries(u)) { const key = k.replace(`flags.${S}.`, ""); if (key.startsWith("-=")) delete scene.flags[key.slice(2)]; else scene.flags[key] = v; } },
  async createEmbeddedDocuments(t, list) { log.push(`CREATE ${t} ${list.map(d => d.name ?? d.texture?.src?.split("/").slice(-2).join("/") ?? d.text).join(", ")}`); return list.map((d, i) => mkTok(d.name, d.x, d.y, actors[d.actorId] ?? null, "new" + i)); } });
scene.tokens.get = id => scene.tokens.find(t => t.id === id);
const actors = {};
function mkActor(name, type, system = {}) {
  const a = { name, type, uuid: "Actor." + name, flags: {}, statuses: new Set(), system: { hp: { value: 1, max: 4 }, ...system }, items: [] };
  Object.assign(a, flagsOf(a), { async toggleStatusEffect(id, { active }) { active ? a.statuses.add(id) : a.statuses.delete(id); log.push(`STATUS ${name} ${id} ${active ? "on" : "off"}`); },
    async refitReturn() { log.push(`REFIT ${name}: HP ${a.system.hp.max}, Strain остаётся ${a.system.strain?.value}`); } });
  return (actors[name] = a);
}
function mkTok(name, x, y, actor, id = name) {
  const t = { id, name, x, y, width: 1, height: 1, hidden: false, actor, parent: scene, uuid: "Scene.s.Token." + id, actorId: actor?.name,
    toObject() { return { name, x: this.x, y: this.y, width: 1, height: 1, hidden: this.hidden, actorId: this.actor?.name }; },
    async update(u) { Object.assign(t, u); log.push(`TOKEN ${name} ${JSON.stringify(u)}`); } };
  scene.tokens.push(t);
  return t;
}
const combat = { id: "C", round: 3, started: true, scene, combatants: [], async createEmbeddedDocuments(t, l) { log.push(`COMBATANT + ${l.map(x => x.tokenId).join(",")}`); } };
globalThis.game = { users, user: users[0], combat, combats: { get: () => combat }, scenes: { viewed: scene }, messages: { contents: messages, get: id => messages.find(m => m.id === id) }, socket: { on() {}, emit() {} } };
globalThis.fromUuidSync = u => scene.tokens.find(t => t.uuid === u) ?? actors[u.replace("Actor.", "")] ?? null;
globalThis.canvas = { scene };

const MI = await import(R + "/module/apps/mission-import.mjs");
const RL = await import(R + "/module/return-line.mjs");
RL.registerReturnLine();
const move = async (t, x, y) => { t.x = x; t.y = y; for (const f of hooks.updateToken) f(t, { x, y }, {}); await new Promise(r => setTimeout(r, 30)); };

// карта 7×5, за линией две правые колонки
const cells = []; for (let r = 0; r < 5; r++) for (const c of [5, 6]) cells.push(`${c},${r}`);
const art = MI.returnArt({ cells, mode: "fail" }, 7, 5);
log.push(`ART tiles ${art.tiles.length} (зона ${art.tiles.filter(t => /zone/.test(t.texture.src)).length}, пунктир ${art.tiles.filter(t => /edge/.test(t.texture.src)).length}, поворот ${[...new Set(art.tiles.filter(t => /edge/.test(t.texture.src)).map(t => t.rotation))]}) · подпись ${art.drawings.map(d => `${d.text} @${d.x},${d.y} rot ${d.rotation ?? 0}`)}`);
log.push("ART border " + MI.returnArt({ cells: ["3,0"], mode: "border" }, 7, 5).drawings.map(d => d.text));
await scene.setFlag(S, "returnLine", { cells, mode: "fail" });

const mig = mkTok("МиГ-29", 600, 200, mkActor("МиГ-29", "npc", { side: "enemy" }));
const tanker = mkTok("Танкер", 800, 600, mkActor("Танкер", "npc", { side: "enemy", priority: true, task: "destroy" }));
const ally = mkTok("Союзник", 800, 0, mkActor("Союзник", "npc", { side: "ally" }));
const pilot = mkTok("Гроза", 400, 400, mkActor("Гроза", "pilot", { strain: { value: 2, max: 5 } }));
for (const f of hooks.canvasReady) f();
log.push(`DIST МиГ ${RL.lineDistance(RL.lineOf(scene), mig)}, Танкер ${RL.lineDistance(RL.lineOf(scene), tanker)} · hint ${RL.lineHint(tanker.actor, tanker)} | ${RL.lineHint(mig.actor, mig) || "(не цель)"}`);

log.push("— fail: цель уходит за линию");
await move(tanker, 1000, 600);
log.push(`статусы Танкер: ${[...tanker.actor.statuses]}`);
log.push("— ведущий вернул МиГ назад тем же ходом");
await move(mig, 1000, 200);
await move(mig, 800, 200);
log.push(`статусы МиГ: ${[...mig.actor.statuses] || "нет"}`);
log.push("— внутри зоны за линией: второй раз не считается");
await move(tanker, 1200, 600);
log.push("— союзник не уходит");
await move(ally, 1200, 0);

log.push(`счёт: ${JSON.stringify(RL.tallyOf(scene, combat))}`);

log.push("— later: МиГ уходит и ждёт в списке");
await RL.setLineSettings(scene, { enemy: "later", failPriority: 0 });
log.push(`настройки: ${JSON.stringify(RL.lineOf(scene))}`);
await move(mig, 1000, 200);
log.push(`ушли: ${RL.escapedOf(scene).map(e => `${e.name} раунд ${e.round}`)}`);
scene.tokens.splice(scene.tokens.indexOf(mig), 1);   // конец раунда убрал с поля
await RL.bringBack(RL.escapedOf(scene)[0].id);
log.push(`после «Вернуть»: ${RL.escapedOf(scene).length} в списке`);

log.push("— пилот за линией выбирает сам: перевооружение");
await move(pilot, 1000, 400);
const card = messages.findLast(m => m.flags?.[S]?.retline?.kind === "pilot");
log.push(`карточка пилота: ${!!card}`);
await move(pilot, 1200, 400);
log.push(`карточек пилота: ${messages.filter(m => m.flags?.[S]?.retline?.kind === "pilot").length}`);
// выбор делает ведущий: через карточку (сокет у игрока)
const btn = { dataset: { tbRet: "rearm" }, remove() {}, addEventListener(ev, f) { this.click = f; } };
for (const f of hooks.renderChatMessage) f(card, { querySelectorAll: () => [btn] });
await btn.click({ preventDefault() {} });
log.push(`rearm ${JSON.stringify(pilot.actor.flags.rearm)}, скрыт ${pilot.hidden}`);
combat.combatants = [{ name: "Гроза", actor: pilot.actor, token: pilot }];
combat.round = 4; await RL.returnRound(combat);
log.push(`раунд 4: ${pilot.actor.flags.rearm ? "ещё на перевооружении" : "вернулся"}`);
combat.round = 5; await RL.returnRound(combat);
log.push(`раунд 5: ${pilot.actor.flags.rearm ? "ещё на перевооружении" : "вернулся"}, скрыт ${pilot.hidden}`);

log.push("— ведущий: пилот сам перевооружается, 0 раундов, Strain восстанавливается");
await RL.setLineSettings(scene, { pilots: "rearm", rearmRounds: 0, rearmStrain: true });
await move(pilot, 800, 400); await move(pilot, 1000, 400);
log.push(`rearm ${JSON.stringify(pilot.actor.flags.rearm)}`);
combat.round = 6; await RL.returnRound(combat);

log.push("— рубеж: провал на втором прорвавшемся, пилот летает свободно");
combat.id = "C2";
await RL.setLineSettings(scene, { enemy: "stay", failEnemies: 2, pilots: "stay" });
const su = mkTok("Су-34", 800, 800, mkActor("Су-34", "npc", { side: "enemy" }));
const su2 = mkTok("Су-34 №2", 800, 0, mkActor("Су-34 №2", "npc", { side: "enemy" }));
for (const f of hooks.createToken) { f(su); f(su2); }
await move(su, 1000, 800);
log.push(`после первого: ${RL.tallyLine(RL.tallyOf(scene, combat))}, итог «${RL.tallyOf(scene, combat).result}»`);
await move(su2, 1000, 0);
const pc = messages.length;
await move(pilot, 800, 400); await move(pilot, 1000, 400);
log.push(`сообщений о пилоте: ${messages.length - pc}`);

log.push("— сопровождение: все союзные цели за линией");
combat.id = "C3";
await RL.setLineSettings(scene, { enemy: "leave", failEnemies: 0, failPriority: 1, escort: "all", pilots: "choice" });
const cv1 = mkTok("Конвой-1", 800, 200, mkActor("Конвой-1", "npc", { side: "ally", priority: true, task: "escort" }));
const cv2 = mkTok("Конвой-2", 800, 400, mkActor("Конвой-2", "npc", { side: "ally", priority: true, task: "escort" }));
for (const f of hooks.createToken) { f(cv1); f(cv2); }
log.push(`цели сопровождения: ${RL.escortTargets(scene).map(t => t.name)} · hint ${RL.lineHint(cv1.actor, cv1)}`);
await move(ally, 800, 0); await move(ally, 1000, 0);
await move(cv1, 1000, 200);
log.push(`после первого: ${RL.tallyLine(RL.tallyOf(scene, combat))}, итог «${RL.tallyOf(scene, combat).result}»`);
await move(cv2, 1000, 400);
log.push(`итог: ${JSON.stringify(RL.tallyOf(scene, combat))}`);

log.push("— неактивен");
const IN = await import(R + "/module/inactive.mjs");
await IN.setInactive(pilot.actor);
log.push(`неактивен ${IN.isInactive(pilot.actor)}`);
await IN.setInactive(pilot.actor);
log.push(`неактивен ${IN.isInactive(pilot.actor)}`);

// итоги: строки потерь, цели, подсказка итога миссии
const L = await import(R + "/module/losses.mjs");
const M = await import(R + "/module/mission.mjs");
log.push("LOSS " + [{ name: "Танкер", how: "retreat", ret: "leave" }, { name: "Конвой", how: "retreat", ret: "safe" }, { name: "МиГ", how: "retreat", ret: "later" }, { name: "Гроза", how: "retreat", ret: "leave", pilot: true }, { name: "Ан", how: "retreat" }].map(L.lossLine).join("; "));
log.push("GOALS " + L.goalRows({ tokens: [] }, [{ name: "Танкер", task: "destroy", how: "retreat", ret: "later" }, { name: "Баржа", task: "destroy", how: "retreat", ret: "fail" }]).map(g => `${g.name}:${g.done}`).join(" "));
log.push("SUGGEST " + JSON.stringify(M.suggestResult({ pilots: 2, losses: [], goals: [], line: { result: "failed", reason: "Цели ушли за линию" } })) + " " + JSON.stringify(M.suggestResult({ pilots: 2, losses: [], goals: [], line: { result: "success", reason: "Сопровождение выполнено" } })));
const B = await import(R + "/module/briefing.mjs");
for (const ret of [{ mode: "fail" }, { mode: "later" }, { mode: "border" }, { mode: "junk" }, { escort: "one", failPriority: 0, pilots: "rearm", rearmRounds: 2 },
  { enemy: "stay", failEnemies: 3, failPriority: 2, escort: "all", pilots: "leave", rearmStrain: "да" }]) {
  const pm = B.publicMission({ name: "Т", cols: 4, rows: 3, hexes: {}, units: [], ret: { cells: ["3,0", "3,1", "9,9"], ...ret } });
  const st = B.buildSteps(pm).find(x => x.ret);
  log.push(`BRIEF ${JSON.stringify(ret)}: ${JSON.stringify(pm.ret)} · ${st?.title}: ${st?.text}`);
}
log.push("BRIEF clean " + JSON.stringify(B.cleanSteps([{ title: "x", text: "y", ret: true }])[0].ret) + " · edges " + JSON.stringify(B.retEdges(["3,0", "3,1"], 4, 3)));
console.log(log.join("\n"));
