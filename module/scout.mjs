/* «Фоторазведка» (свойство NPC, «Стрэйнджриал» 9.2): U-2S, SR-71. Разведчик не атакует. Если в конце 4-го раунда он ещё
   в воздухе (или ушёл за край зоны операции), снимки у его стороны: AWACS решает, что это меняет. Здесь строка ведущему
   в конце 4-го раунда и ход на автопилоте: Max Speed и прямо к ближайшему краю сцены, без выстрелов. */
import { SYSTEM_ID, hasProp } from "./config.mjs";
import { esc } from "./utils.mjs";

const isLead = () => !!game.user?.isGM && (game.users?.activeGM?.isSelf ?? true);
const gone = a => !a || a.statuses?.has?.(CONFIG.specialStatusEffects?.DEFEATED ?? "dead") || !!a.system?.markers?.doom;

/** Разведчики, что к концу 4-го раунда ещё в воздухе на сцене. */
export function scoutsAloft(tokens, isFlying) {
  return tokens.filter(t => t.actor && hasProp(t.actor, "scout") && !gone(t.actor) && isFlying(t.actor));
}

/** Строка ведущему: разведчики ушли со снимками. */
export function scoutLine(names) {
  return `<b>Фоторазведка.</b> ${names.map(n => `«${esc(n)}»`).join(", ")} ещё в воздухе к концу 4-го раунда: снимки ушли к своим. Решите, что это меняет: засада на следующем вылете, удар по аэродрому, сорванная внезапность.`;
}

/** Ближайший край сцены от клетки: клетка на краю. */
export function edgeCell([c, r], b) {
  const opts = [[b.c0, r, c - b.c0], [b.c1, r, b.c1 - c], [c, b.r0, r - b.r0], [c, b.r1, b.r1 - r]];
  opts.sort((x, y) => x[2] - y[2]);
  return [opts[0][0], opts[0][1]];
}

/** Ход разведчика на автопилоте: Speed до Max, до acts шагов к ближайшему краю. Возвращает строки сводки. */
export async function scoutRun(actor, token, acts, { move, bounds, stepToward, cellLabel }) {
  const S = await import("./scene.mjs");
  const log = [];
  const max = actor.system.maxSpeed ?? actor.system.speed ?? 1;
  if ((actor.system.speed ?? 0) < max) { await actor.update({ "system.speed": max }, { tbFree: true }); log.push(`Speed ${max}`); }
  const b = bounds();
  for (let i = 0; i < acts && b; i++) {
    const k = S.cellOf(token);
    if (!k) break;
    const here = [k.col, k.row], edge = edgeCell(here, b);
    const step = stepToward(here, edge);
    if (!step) { log.push("на краю зоны операции: уходит со снимками"); break; }
    const res = await move(token, here, step);
    if (res) { log.push(`Move: ${res}`); break; }
    log.push(`Move → ${cellLabel(`${step[0]},${step[1]}`)}`);
  }
  log.push("Фоторазведка: не атакует");
  return log;
}

export function registerScout() {
  Hooks.on("updateCombat", (combat, change, options) => {
    if (options?.tbUndo || !isLead() || change.round !== 5 || (combat.scene && combat.scene.id !== canvas?.scene?.id)) return;
    import("./scene.mjs").then(S => {
      const list = scoutsAloft(canvas?.tokens?.placeables ?? [], S.isFlying);
      if (!list.length) return;
      return ChatMessage.create({ speaker: { alias: "AWACS" }, whisper: game.users.filter(u => u.isGM).map(u => u.id),
        content: `<div class="tb-card"><div class="tb-note">${scoutLine(list.map(t => t.name))}</div></div>` });
    }).catch(err => console.warn(`${SYSTEM_ID} | фоторазведка`, err));
  });
}

