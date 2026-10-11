#!/usr/bin/env python3
"""Портреты по умолчанию вместо пустого силуэта Foundry: бюст на экране «Брифинга».
pilot — пилот в шлеме с маской (зелёный), enemy — пилот противника (красный),
staff — офицер штаба в фуражке (голубой), civil — гражданский (жёлтый).
Запуск: python3 tools/make-portraits.py → assets/portraits/*.svg"""
import os

OUT = os.path.join(os.path.dirname(__file__), "..", "assets", "portraits")
BG, BG2 = "#07141a", "#10272f"

SHOULDERS = "M20 256 C26 206 66 188 98 182 L158 182 C190 188 230 206 236 256 Z"
NECK = '<path d="M110 150 L110 186 L146 186 L146 150 Z"/>'
HEAD = '<ellipse cx="128" cy="112" rx="40" ry="50"/>'

def mix(c, a, base="#0c2028"):
    """Непрозрачная заливка: цвет c поверх фона с долей a (силуэты перекрывают друг друга без просвечивания)."""
    h = lambda x: [int(x[i:i + 2], 16) for i in (1, 3, 5)]
    return "#" + "".join(f"{round(cc * a + bb * (1 - a)):02x}" for cc, bb in zip(h(c), h(base)))

def helmet(c, visor):
    return f"""
  <g fill="{mix(c, .16)}" stroke="{c}" stroke-width="3" stroke-linejoin="round">
    <path d="{SHOULDERS}"/>
    <path d="M58 256 L74 206 M198 256 L182 206" fill="none" stroke-opacity=".5"/>
    {NECK}
    <path d="M72 116 C70 62 98 42 128 42 C158 42 186 62 184 116 L180 150 C168 160 150 164 128 164 C106 164 88 160 76 150 Z"/>
    <path d="M128 44 L128 82" fill="none" stroke-opacity=".55"/>
    <path d="M84 98 Q128 80 172 98 L168 124 Q128 136 88 124 Z" fill="{visor}"/>
    <path d="M94 102 Q128 90 160 101" fill="none" stroke="#ffffff" stroke-opacity=".45" stroke-width="2"/>
    <path d="M106 130 Q128 122 150 130 L154 158 Q128 174 102 158 Z" fill="{mix(c, .3)}"/>
    <path d="M114 166 C110 190 92 200 84 226" fill="none" stroke-width="5" stroke-opacity=".7"/>
  </g>"""

def officer(c):
    return f"""
  <g fill="{mix(c, .16)}" stroke="{c}" stroke-width="3" stroke-linejoin="round">
    <path d="{SHOULDERS}"/>
    <path d="M98 182 L128 230 L158 182" fill="none"/>
    <path d="M128 230 L128 256" fill="none" stroke-opacity=".5"/>
    <path d="M36 214 L84 198 L88 210 L42 226 Z M220 214 L172 198 L168 210 L214 226 Z" fill="{mix(c, .45)}"/>
    {NECK}
    {HEAD}
    <path d="M74 78 Q128 30 182 78 L178 92 L78 92 Z" fill="{mix(c, .3)}"/>
    <path d="M80 92 L176 92 L176 104 L80 104 Z" fill="{mix(c, .55)}"/>
    <path d="M84 104 Q128 124 172 104" fill="none" stroke-width="4"/>
    <circle cx="128" cy="84" r="6" fill="{c}" fill-opacity=".9"/>
  </g>"""

def civil(c):
    return f"""
  <g fill="{mix(c, .16)}" stroke="{c}" stroke-width="3" stroke-linejoin="round">
    <path d="{SHOULDERS}"/>
    <path d="M100 182 L128 210 L156 182 M100 182 L92 204 L116 198 M156 182 L164 204 L140 198" fill="none"/>
    {NECK}
    {HEAD}
    <path d="M86 116 C78 70 100 54 130 54 C160 54 182 72 170 118 C166 98 160 86 150 80 C130 92 104 92 94 86 C90 94 88 104 86 116 Z" fill="{mix(c, .45)}"/>
    <path d="M150 80 C140 70 124 64 108 66" fill="none" stroke-opacity=".6" stroke-width="2"/>
  </g>"""

def frame(c, body):
    grid = "".join(f'<path d="M{x} 0 V256" />' for x in range(16, 256, 16)) + "".join(f'<path d="M0 {y} H256" />' for y in range(16, 256, 16))
    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="512" height="512">
  <defs>
    <radialGradient id="bg" cx="50%" cy="42%" r="70%"><stop offset="0" stop-color="{BG2}"/><stop offset="1" stop-color="{BG}"/></radialGradient>
    <pattern id="scan" width="4" height="4" patternUnits="userSpaceOnUse"><rect width="4" height="1" fill="#000" fill-opacity=".35"/></pattern>
  </defs>
  <rect width="256" height="256" fill="url(#bg)"/>
  <g stroke="{c}" stroke-opacity=".07" stroke-width="1">{grid}</g>
  <circle cx="128" cy="112" r="92" fill="none" stroke="{c}" stroke-opacity=".18" stroke-width="1.5" stroke-dasharray="3 6"/>
  {body}
  <rect width="256" height="256" fill="url(#scan)"/>
  <g fill="none" stroke="{c}" stroke-width="4" stroke-opacity=".9">
    <path d="M10 40 V10 H40 M216 10 H246 V40 M246 216 V246 H216 M40 246 H10 V216"/>
  </g>
  <g fill="{c}" fill-opacity=".7"><rect x="18" y="226" width="4" height="12"/><rect x="25" y="226" width="2" height="12"/><rect x="30" y="226" width="6" height="12"/><rect x="39" y="226" width="2" height="12"/></g>
</svg>
"""

PORTRAITS = {
    "pilot": ("#9be3bf", helmet("#9be3bf", "#0e3b30")),
    "enemy": ("#ff6b4a", helmet("#ff6b4a", "#4a1208")),
    "staff": ("#6cc4ff", officer("#6cc4ff")),
    "civil": ("#f2c14e", civil("#f2c14e")),
}

if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    for name, (c, body) in PORTRAITS.items():
        with open(os.path.join(OUT, f"{name}.svg"), "w") as f:
            f.write(frame(c, body))
        print(f"assets/portraits/{name}.svg")
