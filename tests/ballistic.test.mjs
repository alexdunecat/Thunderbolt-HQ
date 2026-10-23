// Баллистическая ракета по правилу: раунд пуска — на взлёте (не цель), следующий — стратосфера (можно сбить), потом уходит в космос.
import { fileURLToPath as __f } from "node:url";
process.argv[2] ??= __f(new URL("..", import.meta.url)).replace(/\/$/, "");
const root = process.argv[2];
const radio = [], chat = [];
globalThis.Hooks = { on() {}, once() {} };
globalThis.Application = class {};
globalThis.CONFIG = { specialStatusEffects: {} };
globalThis.foundry = { utils: { getProperty: () => undefined } };
globalThis.canvas = { ready: false };
globalThis.ChatMessage = { create: async d => { chat.push(d.content.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()); }, getWhisperRecipients: () => [] };
const combat = { id: "c1", started: true, round: 1, combatants: [] };
globalThis.game = { combat, user: { isGM: true }, users: { activeGM: { isSelf: true } }, settings: { get: () => true } };
const S = await import(`${root}/module/scene.mjs`);
const flags = {};
const icbm = { type: "npc", uuid: "Actor.icbm", name: "МБР", system: { key: "icbm", props: [{ key: "ballistic" }], rules: [] },
  getFlag: (s, k) => flags[k], setFlag: async (s, k, v) => { flags[k] = v; } };
const doc = { name: "МБР «Гром»", hidden: false, async update(u) { Object.assign(this, u); } };
combat.combatants.push({ actor: icbm, token: doc, name: doc.name, defeated: false, async delete() { combat.combatants.splice(0, 1); chat.push("(убрана из боя)"); } });
const B = await import(`${root}/module/ballistic.mjs`);
const step = async () => {
  const phase = S.ballisticPhase(icbm);
  await B.resolveBallistic(combat, combat.round).catch(e => chat.push("ошибка: " + e.message));
  console.log(`раунд ${combat.round}: ${phase} → после конца раунда: флаг ${JSON.stringify(flags.icbm)}, токен ${doc.hidden ? "скрыт" : "виден"}, в бою ${combat.combatants.length}`);
  combat.round++;
};
await step(); await step(); await step();
console.log("фаза без боя:", S.ballisticPhase(icbm, null), "· не ракета:", S.ballisticPhase({ type: "npc", system: { key: "su27", props: [], rules: [] } }));
console.log("в чат:", chat.join(" | "));
