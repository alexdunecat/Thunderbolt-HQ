/* Баллистическая ракета по правилу: в раунд пуска проходит Высокую (сбить нельзя), следующий раунд в стратосфере
   (Defense 6, HP 2, можно сбить), в конце этого раунда уходит в космос, и ведущий отмечает удар супероружия.
   Фаза — scene.mjs ballisticPhase; здесь конец раунда у ведущего: раунд пуска, предупреждение и уход. */
import { SYSTEM_ID } from "./config.mjs";
import { esc } from "./utils.mjs";
import { isBallistic } from "./scene.mjs";

const lead = () => !!game.user?.isGM && (game.users?.activeGM?.isSelf ?? true);

/** Конец раунда round: кто пущен в этом раунде — в стратосфере со следующего; кто отлетал раунд в стратосфере — ушёл. */
export async function resolveBallistic(combat, round) {
  if (!lead()) return;
  const seen = new Set(), rising = [], gone = [];
  for (const c of combat.combatants) {
    const a = c.actor;
    if (!isBallistic(a) || seen.has(a.uuid) || c.defeated) continue;
    seen.add(a.uuid);
    const f = a.getFlag(SYSTEM_ID, "icbm");
    if (f?.combat !== combat.id) { await a.setFlag(SYSTEM_ID, "icbm", { combat: combat.id, launch: round }); rising.push(c); continue; }
    if (round === f.launch) rising.push(c);
    else if (round >= f.launch + 1) gone.push(c);
  }
  const { sendRadio } = await import("./radio.mjs");
  if (rising.length) await sendRadio({ caution: { level: "warning", title: "WARNING", sub: "Ракета в стратосфере" },
    text: `${rising.map(c => c.token?.name ?? c.name).join(", ")}: ракета ушла в стратосферу. Это последний раунд, чтобы её сбить: достают только из стратосферы и с Высокой!` });
  for (const c of gone) await leave(combat, c);
}

/** Ракета ушла в космос: токен скрыт и выходит из боя, ведущему — карточка с кнопкой удара. */
async function leave(combat, c) {
  const doc = c.token, a = c.actor, name = doc?.name ?? c.name;
  await a.setFlag(SYSTEM_ID, "icbm", { ...a.getFlag(SYSTEM_ID, "icbm"), gone: true });
  if (doc && !doc.hidden) await doc.update({ hidden: true });
  await c.delete();
  const { sendRadio } = await import("./radio.mjs");
  await sendRadio({ caution: { level: "warning", title: "WARNING", sub: "Ракета ушла" }, text: `${name}: ракета ушла в космос. Перехват сорван.` });
  await ChatMessage.create({
    speaker: { alias: "AWACS" }, whisper: ChatMessage.getWhisperRecipients("GM").map(u => u.id),
    content: `<div class="tb-card tb-card-round"><h3><i class="fas fa-rocket"></i> ${esc(name)} ушла в космос</h3>
      <p class="tb-note">Дальше удар по правилам супероружия книги, по цели, объявленной при пуске. Токен скрыт и убран из боя.</p>
      <div class="tb-actions"><button type="button" class="tb-gm" data-tb-icbm-strike="${esc(a.uuid)}" data-name="${esc(name)}"><i class="fas fa-burst"></i> Отметить удар</button></div></div>`
  });
}

export function registerBallistic() {
  Hooks.on("renderChatMessage", (message, html) => {
    const root = html?.[0] ?? html;
    root?.querySelectorAll?.("[data-tb-icbm-strike]").forEach(b => b.addEventListener("click", async ev => {
      ev.preventDefault();
      if (!game.user.isGM) return;
      const { markStrike } = await import("./strikes.mjs");
      await markStrike(null, { source: b.dataset.tbIcbmStrike, kind: "custom", label: `Удар ${b.dataset.name}` });
    }));
  });
}

