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
