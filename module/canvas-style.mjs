/* Холст в стиле «Брифинга» (вместе с интерфейсом, класс tb-brief-ui): подписи токенов шрифтом Jura,
   рамки токенов в цветах сторон «Брифинга» вместо оранжевой и ярко-зелёной Foundry, прицел (Target) —
   красные уголки захвата с тёмной обводкой. Значения Foundry запоминаются, при выключении возвращаются. */

export const BRIEF_BORDERS = {
  CONTROLLED: 0xd7eee6, PARTY: 0x9be3bf, FRIENDLY: 0x6cc4ff, NEUTRAL: 0xf2c14e, HOSTILE: 0xff6b4a, SECRET: 0xb38cff, INACTIVE: 0x4f6f68
};
export const BRIEF_TARGET = { color: 0xff6b4a, outline: 0x07141a };
const FONT = ["Jura", "Signika", "sans-serif"];

let saved = null, on = false;

/** Включить или выключить стиль холста. Возвращает, поменялось ли что-то (тогда холст надо перерисовать). */
export function applyCanvasStyle(enable) {
  enable = !!enable;
  if (enable === on) return false;
  const style = CONFIG.canvasTextStyle, colors = CONFIG.Canvas?.dispositionColors;
  if (enable) {
    saved = { font: style?.fontFamily, colors: colors ? { ...colors } : null };
    if (style) style.fontFamily = FONT;
    if (colors) for (const [k, v] of Object.entries(BRIEF_BORDERS)) if (k in colors) colors[k] = v;
  } else if (saved) {
    if (style && saved.font !== undefined) style.fontFamily = saved.font;
    if (colors && saved.colors) Object.assign(colors, saved.colors);
  }
  on = enable;
  return true;
}


/** Прицел Foundry (клавиша T): цвет и обводка «Брифинга», когда стиль включён. */
export function patchTargetReticle(TokenClass = CONFIG.Token?.objectClass) {
  const proto = TokenClass?.prototype;
  if (!proto?._drawTarget || proto._drawTarget.tbBrief) return false;
  const orig = proto._drawTarget;
  const drawTarget = function (opts = {}) {
    if (!on) return orig.call(this, opts);
    return orig.call(this, { size: 0.2, ...opts, color: opts.color ?? BRIEF_TARGET.color,
      border: { width: 2, color: BRIEF_TARGET.outline, ...(opts.border ?? {}) } });
  };
  drawTarget.tbBrief = true;
  proto._drawTarget = drawTarget;
  return true;
}
