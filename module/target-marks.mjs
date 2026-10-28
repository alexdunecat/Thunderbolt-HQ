/* Метки целей на карте, пока открыт пульт Fox Two! или Guns: кольцо вокруг токена и номер плитки пульта.
   Выбранная цель горит жёлтым, остальные бледные; одинаковые машины в одной зоне различаются номером. */

const AMBER = 0xf2c14e, PALE = 0xd7eee6;
let style = null;

/**
 * entries: [{ token, label }] (token — токен на сцене). Возвращает { select(i), hover(i | null), destroy() }.
 * Без сцены — пустышка.
 */
export function targetMarks(entries) {
  const none = { select() {}, hover() {}, destroy() {} };
  if (!globalThis.canvas?.ready || !canvas.interface || !entries?.length) return none;
  style ??= new PIXI.TextStyle({ fontFamily: "JetBrains Mono, monospace", fontSize: 22, fontWeight: "bold", fill: 0x07141a });
  const box = canvas.interface.addChild(new PIXI.Container());
  box.eventMode = "none";
  let sel = 0, hov = null;
  const draw = () => {
    box.removeChildren().forEach(c => c.destroy({ children: true }));
    entries.forEach((e, i) => {
      const t = e.token;
      if (!t || t.destroyed || !t.visible) return;
      const on = i === sel, lit = on || i === hov;
      const b = t.bounds, cx = b.x + b.width / 2, cy = b.y + b.height / 2, r = Math.max(b.width, b.height) / 2 + 8;
      const g = box.addChild(new PIXI.Graphics());
      g.lineStyle(on ? 5 : 3, lit ? AMBER : PALE, on ? 1 : lit ? 0.9 : 0.55).drawCircle(cx, cy, r);
      if (on) g.lineStyle(2, AMBER, 0.5).drawCircle(cx, cy, r + 7);
      if (!e.label) return;
      const txt = new PIXI.Text(String(e.label), style);
      const w = Math.max(28, txt.width + 12), h = 28, x = cx - r * 0.72 - w / 2, y = cy - r * 0.72 - h / 2;
      g.lineStyle(0).beginFill(lit ? AMBER : PALE, lit ? 1 : 0.8).drawRect(x, y, w, h).endFill();
      txt.position.set(x + (w - txt.width) / 2, y + (h - txt.height) / 2);
      box.addChild(txt);
    });
  };
  draw();
  return {
    select(i) { sel = i; draw(); },
    hover(i) { hov = i; draw(); },
    destroy() { if (!box.destroyed) box.destroy({ children: true }); }
  };
}
