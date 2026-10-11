/* Мелкие помощники. */
const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ESC[c]);

/** Актёр по UUID, включая синтетических актёров несвязанных токенов (Scene.x.Token.y.Actor.z). */
export function resolveActor(uuid) {
  if (!uuid) return null;
  const m = /^(.*\.Token\.[^.]+)\.Actor\.[^.]+$/.exec(uuid);
  if (m) return fromUuidSync(m[1])?.actor ?? null;
  const d = fromUuidSync(uuid);
  return d?.actor ?? d ?? null;
}

/**
 * Перерисовка токена затронула вид, а не только место: Foundry шлёт refreshToken на каждом кадре движения
 * (refreshPosition), а значкам-детям токена хватает того, что они едут вместе с ним.
 */
const LAYOUT = ["redraw", "refresh", "refreshSize", "refreshShape", "refreshMesh", "refreshState", "refreshVisibility"];
export const layoutChanged = flags => !flags || LAYOUT.some(k => flags[k]);
