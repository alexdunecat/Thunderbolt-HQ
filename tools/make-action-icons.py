#!/usr/bin/env python3
"""Значки действий для панели макросов в стиле «Брифинга»: тёмный экран, уголки, подпись моноширинным.
Цвет по группе: атака красная, манёвр голубой, звено жёлтое, проверки навыков зелёные, конец хода светлый.
Запуск: python3 tools/make-action-icons.py → assets/actions/*.svg"""
import os

OUT = os.path.join(os.path.dirname(__file__), "..", "assets", "actions")
RED, BLUE, AMBER, GREEN, INK = "#ff6b4a", "#6cc4ff", "#f2c14e", "#9be3bf", "#d7eee6"
ICONS = {
    "lock": ("LOCK", "ON", RED), "missile": ("FOX", "TWO", RED), "guns": ("GUNS", "", RED),
    "break": ("BRK!", "", BLUE), "stall": ("STALL", "", BLUE), "recover": ("STR", "+", BLUE),
    "lead": ("LEAD", "ORDER", AMBER), "formup": ("FORM", "UP", AMBER), "end": ("END", "TURN", INK),
    **{f"skill-{k}": (t, "d10", GREEN) for k, t in [("aim", "AIM"), ("deploy", "DEP"), ("dodge", "DODGE"), ("lead", "LEAD"), ("push", "PUSH"), ("strafe", "STRF")]},
}
FONT = "font-family:'JetBrains Mono','DejaVu Sans Mono',Consolas,monospace;font-weight:bold"

def icon(top, sub, c):
    size = 26 if len(top) <= 4 else 21
    y = 52 if sub else 58
    return f"""<svg viewBox="0 0 100 100" width="100" height="100" xmlns="http://www.w3.org/2000/svg">
  <rect x="3" y="3" width="94" height="94" fill="#07141a" stroke="{c}" stroke-opacity=".55" stroke-width="2"/>
  <g stroke="{c}" stroke-opacity=".08">{"".join(f'<path d="M3 {y0} H97"/>' for y0 in range(8, 97, 4))}</g>
  <rect x="3" y="90" width="94" height="7" fill="{c}" fill-opacity=".85"/>
  <path d="M80 9 H91 V20 M9 80 V85 H14 M91 80 V85 H86" fill="none" stroke="{c}" stroke-width="3"/>
  <text x="50" y="{y}" text-anchor="middle" style="{FONT};font-size:{size}px;fill:{INK}">{top}</text>
  {f'<text x="50" y="75" text-anchor="middle" style="{FONT};font-size:15px;fill:{c}">{sub}</text>' if sub else ""}
</svg>
"""

if __name__ == "__main__":
    for name, (top, sub, c) in ICONS.items():
        with open(os.path.join(OUT, f"{name}.svg"), "w") as f:
            f.write(icon(top, sub, c))
    print(len(ICONS), "значков")
