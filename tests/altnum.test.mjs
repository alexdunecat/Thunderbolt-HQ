// Цифра высоты: новый летающий токен встаёт на высоту листа, старые без высоты ведущий выставляет при загрузке сцены,
// цифра над летающими видна всегда; наземка и корабли остаются на 0.
import { fileURLToPath as __f } from "node:url";
process.argv[2] ??= __f(new URL("..", import.meta.url)).replace(/\/$/, "");
const root = process.argv[2];
const hooks = {};
globalThis.Hooks = { on: (n, f) => (hooks[n] ??= []).push(f), once: (n, f) => (hooks[n] ??= []).push(f) };
globalThis.CONST = { GRID_TYPES: { GRIDLESS: 0 } };
globalThis.CONFIG = { specialStatusEffects: {} };
globalThis.foundry = { utils: { getProperty: (o, p) => p.split(".").reduce((a, k) => a?.[k], o), setProperty() {} } };
const updates = [];
const scene = { getFlag: () => null, tokens: { contents: [] }, async updateEmbeddedDocuments(t, list) { updates.push(...list); } };
globalThis.game = { scenes: { viewed: scene }, combat: null, users: { activeGM: { isSelf: true } }, settings: { register() {}, get: () => true }, keybindings: { register() {} } };
globalThis.canvas = { ready: false, scene };
globalThis.ui = {};
const { TB } = await import(`${root}/module/config.mjs`);
const A = await import(`${root}/module/altitude.mjs`);
A.registerAltitude();
const actor = (name, type, sys) => ({ name, type, system: { alt: "med", props: [], rules: [], kind: "air", ...sys }, getFlag: () => null });
const doc = (a, elevation = 0) => ({ id: a.name, actor: a, elevation, isSecret: false, updateSource(d) { Object.assign(this, d); } });
const list = [doc(actor("Пилот", "pilot", { alt: "high" })), doc(actor("МиГ NPC", "npc", { alt: "low" })), doc(actor("Танк", "npc", { kind: "ground", alt: "low" })),
  doc(actor("Фрегат", "npc", { kind: "ship" })), doc(actor("Аркбёрд", "npc", { kind: "ship", key: "arkbird", rules: [{ key: "strato" }] }))];
for (const d of list) for (const f of hooks.preCreateToken ?? []) f(d);
console.log("новые токены:", list.map(d => `${d.id} ${d.elevation}`).join(", "));
const old = [doc(actor("Старый пилот", "pilot", { alt: "low" })), doc(actor("Старый NPC", "npc", { alt: "high" }), 2), doc(actor("Старый танк", "npc", { kind: "ground" }))];
scene.tokens.contents = old;
for (const f of hooks.canvasReady ?? []) f();
await new Promise(r => setTimeout(r, 10));
console.log("при загрузке сцены:", updates.map(u => `${u._id} → ${u.elevation}`).join(", ") || "ничего");
const tok = d => ({ actor: d.actor, document: d, visible: true, tooltip: { visible: false } });
const shown = list.map(tok);
for (const t of shown) for (const f of hooks.refreshToken ?? []) { try { f(t, {}); } catch { /* тень требует канваса */ } }
console.log("цифра высоты видна:", shown.map(t => `${t.actor.name} ${t.tooltip.visible ? "да" : "нет"}`).join(", "));
