// Запуск: node tests/run.mjs (сверяет вывод со снимком в tests/snapshots)
import { fileURLToPath as __f } from "node:url";
import { tmpdir as __tmp } from "node:os";
process.argv[2] ??= __f(new URL("..", import.meta.url)).replace(/\/$/, "");
process.argv[3] ??= __tmp() + "/tb-test-out";
const R = process.argv[2];
const log = [], hooks = {};
const users = [{ id: "gm", isGM: true, active: true, isSelf: true }];
users.activeGM = users[0];
Object.assign(globalThis, {
  foundry: { utils: { deepClone: x => structuredClone(x) } },
  Hooks: { on: (n, f) => (hooks[n] ??= []).push(f) },
  CONFIG: { specialStatusEffects: { DEFEATED: "dead" }, statusEffects: [{ id: "dead", img: "skull" }] },
  ChatMessage: { create: async d => { log.push("CHAT " + d.content.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()); return d; } },
  game: { users, user: users[0], actors: [], combats: { has: () => true }, scenes: { viewed: null } },
  Dialog: class { constructor(d) { log.push("DIALOG " + d.title + ": " + (/По сводке боя: <b>([^<]*)<\/b>([^.]*)/.exec(d.content)?.slice(1).join("") ?? "без подсказки")); } render() {} }
});
globalThis.fromUuidSync = u => ({ "Actor.Гроза": { type: "pilot", name: "Гроза" }, "Actor.Ворон": { type: "pilot", name: "Ворон" } })[u];
const L = await import(R + "/module/losses.mjs");
L.registerLosses();
log.push("ICON " + CONFIG.statusEffects.map(e => e.id + ":" + e.img).join(" "));
const tokens = [];
const scene = { name: "Залив", flags: { "thunderbolt-shtab": { mission: "Операция «Гром»", objectives: ["Сбить ДРЛО"] } }, tokens,
  getFlag(s, k) { return this.flags[s]?.[k]; }, async setFlag(s, k, v) { this.flags[s][k] = v; },
  async deleteEmbeddedDocuments(t, ids) { log.push("DELETE " + ids.join(",")); for (const id of ids) tokens.splice(tokens.findIndex(x => x.id === id), 1); } };
const mk = (id, type, sys, flags = {}, statuses = []) => { const a = { type, system: { hp: { value: 2, max: 4 }, kind: "air", ...sys }, flags, statuses: new Set(statuses), getFlag(s, k) { return this.flags[k]; }, async toggleStatusEffect(id) { this.statuses.delete(id); } };
  tokens.push({ id, name: id, actor: a, hidden: false, actorLink: type === "pilot", parent: scene }); return a; };
mk("МиГ-гун", "npc", {}, { down: { combat: "C", round: 2, by: "Гроза", byUuid: "Actor.Гроза" } }, ["dead"]);
mk("Су-ракета", "npc", {}, { down: { combat: "C", round: 3, by: "Ворон", byUuid: "Actor.Ворон" } }, ["dead"]);
mk("Танкер", "npc", { kind: "ship" }, {}, ["retreat"]);
mk("Ворон", "pilot", {}, { down: { combat: "C", round: 3, by: "Су-ракета" } });
mk("Ангар", "npc", { kind: "ground", side: "enemy" });
mk("Союзный", "npc", { side: "ally" });
const combatants = tokens.map(t => ({ id: "c" + t.id, tokenId: t.id, actor: { ...t.actor, id: t.id } }));
const combat = { id: "C", round: 3, scene, flags: {}, combatants, getFlag(s, k) { return this.flags[k]; }, async setFlag(s, k, v) { this.flags[k] = v; },
  async deleteEmbeddedDocuments(t, ids) { log.push("DEL-COMBATANTS " + ids.join(",")); } };
const rows = await L.clearLosses(combat, 2);   // конец раунда 2
log.push("END R2: " + rows.map(L.lossLine).join("; ") + " | left " + tokens.map(t => t.name).join(","));
game.actors = [{ type: "pilot", name: "Гроза", getFlag: () => ({ air: 1, ground: 0 }) }];
for (const f of hooks.deleteCombat) f(combat);
await new Promise(r => setTimeout(r, 1700));
log.push("LAST " + JSON.stringify(scene.flags["thunderbolt-shtab"].lastBattle.losses.map(r => r.name + ":" + r.how)));
console.log(log.join("\n"));
