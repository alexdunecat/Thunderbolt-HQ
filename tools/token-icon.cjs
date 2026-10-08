/* ---------- token icons in the "Briefing" style (same geometry as silhouette()) ----------
   tokenIcon(SHAPES, shape, { side, variant, frame, px }) -> standalone SVG for a map token.
   side: player | ally | enemy | neutral | priority | ink; variant: glass (default) | dark | solid;
   frame: [width, length] of the token field (default square); px: longer side in pixels. */
const TOKEN_SIDES = {
  player: { line: "#8ee6a0" }, ally: { line: "#6cc4ff" }, enemy: { line: "#ff6b4a" },
  neutral: { line: "#f2c14e" }, priority: { line: "#ffffff", outer: "#ff6b4a" }, ink: { line: "#d7eee6" },
  // в файлах токенов цвет стороны не зашит: белые линии, Foundry тонирует токен по system.side
  white: { line: "#ffffff" }
};
function tokenIcon(SHAPES, shape, { side = "ink", variant = "glass", frame = [1, 1], px = 512 } = {}) {
  const s = SHAPES[shape] || SHAPES.mig29, c = TOKEN_SIDES[side] || TOKEN_SIDES.ink, L = c.line, PANEL = "#0b1d24";
  const a = frame[0] / frame[1], h = s.h + 20;
  let bw = Math.max(220, h * a), bh = bw / a;
  // лопасти вертолётов могут выходить за силуэт: расширяем поле симметрично, чтобы центр поворота остался в центре машины
  for (const [cy, r] of s.rotors || []) { const k = Math.max(1, (Math.abs(cy + 10 - h / 2) + r + 4) / (bh / 2), (r + 4) / (bw / 2)); bw *= k; bh *= k; }
  const dx = (bw - 220) / 2, dy = (bh - h) / 2;
  const out = a >= 1 ? [px, Math.round(px / a)] : [Math.round(px * a), px];
  const u = (a >= 1 ? bw : bh) / 512;          // line widths are set in pixels of a 512 px token
  const W = { body: 7 * u, det: 3.4 * u, fin: 6 * u, outer: 9 * u, halo: 5 * u, axis: 1.6 * u, dash: `${(10 * u).toFixed(1)} ${(7 * u).toFixed(1)}` };
  const f = n => n.toFixed(2);
  const side2 = s.asym ? [1] : [1, -1];
  const P = (x, y, k = 1) => `${(110 + k * x).toFixed(1)},${(y + 10).toFixed(1)}`;
  const body = s.pts.map(([x, y]) => P(x, y)).concat(s.asym ? [] : s.pts.slice().reverse().map(([x, y]) => P(x, y, -1))).join(" ");
  const polys = !s.turret ? [] : Array.isArray(s.turret[0][0]) ? s.turret : [s.turret];
  const ring = Q => !s.asym && Q[0][0] === 0 && Q[Q.length - 1][0] === 0
    ? [Q.map(([x, y]) => P(x, y)).concat(Q.slice().reverse().map(([x, y]) => P(x, y, -1)))] : side2.map(k => Q.map(([x, y]) => P(x, y, k)));
  // glass: light fill in the side colour; dark: dark plate like AWACS chips; solid: side colour with dark details
  const solid = variant === "solid", DL = solid ? PANEL : L;
  const fill = variant === "dark" ? `fill="${PANEL}" fill-opacity=".92"` : solid ? `fill="${L}" fill-opacity=".92"` : `fill="${L}" fill-opacity=".22"`;
  const line = (col, w) => `fill="none" stroke="${col}" stroke-width="${f(w)}" stroke-linejoin="round" stroke-linecap="round"`;
  const det = line(DL, W.det), ext = line(L, W.det);
  const id = "tk-" + shape.replace(/\W/g, "") + "-" + side;
  // dark halo keeps the outline readable over terrain lines
  let g = `<polygon points="${body}" fill="${PANEL}" fill-opacity="${variant === "glass" ? .6 : .9}" stroke="#07141a" stroke-opacity=".75" stroke-width="${f(W.body + 2 * W.halo + (c.outer ? 2 * W.outer : 0))}" stroke-linejoin="round"/>`;
  if (c.outer) g += `<mask id="${id}"><rect x="${f(-dx - 5)}" y="${f(-dy - 5)}" width="${f(bw + 10)}" height="${f(bh + 10)}" fill="#fff"/><polygon points="${body}" fill="#000"/></mask>` +
    `<polygon points="${body}" fill="none" stroke="${c.outer}" stroke-width="${f(2 * W.outer + W.body)}" stroke-linejoin="round" mask="url(#${id})"/>`;
  g += `<polygon points="${body}" ${fill} stroke="${L}" stroke-width="${f(W.body)}" stroke-linejoin="round"/>`;
  if (!s.asym) g += `<line x1="110" y1="${(10 + s.h * .04).toFixed(1)}" x2="110" y2="${(10 + s.h * .96).toFixed(1)}" stroke="${DL}" stroke-width="${f(W.axis)}" stroke-dasharray="${W.dash}" opacity=".4"/>`;
  g += s.fins.map(([x1, y1, x2, y2]) => side2.map(k => `<line x1="${110 + k * x1}" y1="${y1 + 10}" x2="${110 + k * x2}" y2="${y2 + 10}" stroke="${DL}" stroke-width="${f(W.fin)}" stroke-linecap="round" opacity=".85"/>`).join("")).join("");
  g += (s.props || []).map(([x, y, r]) => [1, -1].map(k => `<ellipse cx="${110 + k * x}" cy="${y + 10}" rx="${r}" ry="3" ${ext} stroke-dasharray="${W.dash}" opacity=".7"/>`).join("")).join("");
  g += (s.rotors || []).map(([cy, r]) => `<circle cx="110" cy="${cy + 10}" r="${r}" ${ext} stroke-dasharray="${W.dash}" opacity=".6"/>`).join("");
  if (s.dome) g += `<ellipse cx="110" cy="${s.dome[0] + 10}" rx="${s.dome[1]}" ry="${s.dome[1] * (s.dome[2] || 0.55)}" ${det} opacity=".75"/>`;
  g += polys.map(q => ring(q).map(r => `<polygon points="${r.join(" ")}" ${det} opacity=".7"/>`).join("")).join("");
  g += (s.tubes || []).map(([x, y, r]) => (x && !s.asym ? [1, -1] : [1]).map(k => `<circle cx="${110 + k * x}" cy="${y + 10}" r="${r}" ${det} opacity=".7"/>`).join("")).join("");
  const [cx, cy, rx, ry] = s.canopy;
  if (rx && ry) g += `<ellipse cx="${110 + cx}" cy="${cy + 10 + ry}" rx="${rx}" ry="${ry}" fill="${DL}" fill-opacity=".35" stroke="${DL}" stroke-width="${f(W.det)}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${f(-dx)} ${f(-dy)} ${f(bw)} ${f(bh)}" width="${out[0]}" height="${out[1]}">${g}</svg>`;
}

module.exports = { tokenIcon, TOKEN_SIDES };
