"""Схематичные клетки карты для импорта миссии: местность (заливка + условные знаки) и погода (прозрачный слой + значок).
Запуск: python3 tools/map-icons.py -> assets/map/terrain/<id>.svg, assets/map/weather/<id>.svg, assets/map/weather/<id>-badge.svg"""
import json, os, random

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
cat = json.load(open(os.path.join(ROOT, "data", "catalog.json"), encoding="utf-8"))
OUT = os.path.join(ROOT, "assets", "map")
W = 200  # одна клетка; рисуем в 200, отдаём 400 px

def shade(hex_, k):
    h = hex_.lstrip("#"); r, g, b = (int(h[i:i + 2], 16) for i in (0, 2, 4))
    f = lambda v: max(0, min(255, int(v * k)))
    return "#%02x%02x%02x" % (f(r), f(g), f(b))

def svg(body, bg=None):
    rect = f'<rect width="{W}" height="{W}" fill="{bg}"/>' if bg else ""
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {W}" width="400" height="400">{rect}{body}</svg>'

def grid(step, jitter, seed, skip_center=False):
    rnd = random.Random(seed)
    pts = []
    for y in range(step // 2, W, step):
        for x in range(step // 2 + (step // 2 if (y // step) % 2 else 0), W + step // 2, step):
            if x > W - 8: continue
            pts.append((x + rnd.uniform(-jitter, jitter), y + rnd.uniform(-jitter, jitter)))
    return pts

INK = "#2a332c"
WATER = "#5f8fa8"

def t_steppe(c):
    d = shade(c, .72)
    return "".join(f'<path d="M{x-5:.1f} {y+3:.1f}l3-7M{x:.1f} {y+3:.1f}v-8M{x+5:.1f} {y+3:.1f}l-3-7" stroke="{d}" stroke-width="1.8" fill="none" stroke-linecap="round"/>' for x, y in grid(40, 6, 1))
def t_meadow(c):
    d = shade(c, .7)
    rows = "".join(f'<path d="M6 {y}H194" stroke="{d}" stroke-width="1.4" stroke-dasharray="2 7" opacity=".7"/>' for y in range(20, 200, 22))
    return rows + "".join(f'<path d="M{x-4:.1f} {y+3:.1f}l2-6M{x+4:.1f} {y+3:.1f}l-2-6" stroke="{d}" stroke-width="1.8" fill="none" stroke-linecap="round"/>' for x, y in grid(44, 6, 2))
def t_desert(c):
    d = shade(c, .78)
    return "".join(f'<path d="M{x-16:.1f} {y:.1f}q16-12 32 0" stroke="{d}" stroke-width="2.2" fill="none" stroke-linecap="round"/>' for x, y in grid(42, 5, 3))
def t_oasis(c):
    return t_desert(c) + (f'<ellipse cx="100" cy="112" rx="34" ry="16" fill="{WATER}" opacity=".75"/>'
        '<g stroke="#4c6a37" stroke-width="3" fill="none" stroke-linecap="round"><path d="M86 100V70M86 70q-14-6-22 4M86 70q14-6 22 4M86 70q-6-12-18-12M86 70q6-12 18-12"/>'
        '<path d="M118 100V78M118 78q-12-5-18 3M118 78q12-5 18 3M118 78q-5-10-14-10M118 78q5-10 14-10"/></g>')
def t_snow(c):
    d = "#9fb3bd"
    out = ""
    for x, y in grid(40, 7, 5):
        out += f'<g stroke="{d}" stroke-width="1.6" stroke-linecap="round"><path d="M{x-6:.1f} {y:.1f}h12M{x-3:.1f} {y-5.2:.1f}l6 10.4M{x+3:.1f} {y-5.2:.1f}l-6 10.4"/></g>'
    return out
def t_forest(c):
    d, k = shade(c, .62), shade(c, .45)
    return "".join(f'<path d="M{x:.1f} {y+12:.1f}v-6" stroke="{k}" stroke-width="2.4"/><circle cx="{x:.1f}" cy="{y-2:.1f}" r="9" fill="{d}" stroke="{k}" stroke-width="1.5"/>' for x, y in grid(34, 4, 6))
def t_taiga(c):
    d, k = shade(c, .6), shade(c, .42)
    return "".join(f'<path d="M{x:.1f} {y-14:.1f}l9 13h-5l7 11h-22l7-11h-5z" fill="{d}" stroke="{k}" stroke-width="1.3" stroke-linejoin="round"/>' for x, y in grid(32, 4, 7))
def t_swamp(c):
    d = shade(c, .6)
    out = ""
    for x, y in grid(38, 5, 8):
        out += f'<path d="M{x-12:.1f} {y+6:.1f}h24M{x-7:.1f} {y+10:.1f}h14" stroke="{WATER}" stroke-width="1.8" stroke-linecap="round"/>'
        out += f'<path d="M{x-5:.1f} {y+5:.1f}v-9M{x:.1f} {y+5:.1f}v-12M{x+5:.1f} {y+5:.1f}v-9" stroke="{d}" stroke-width="1.8" stroke-linecap="round"/>'
    return out
def t_hills(c):
    d, l = shade(c, .66), shade(c, 1.08)
    return "".join(f'<path d="M{x-20:.1f} {y+8:.1f}q20-30 40 0z" fill="{l}" stroke="{d}" stroke-width="2"/><path d="M{x+2:.1f} {y-5:.1f}q8 4 12 12" stroke="{d}" stroke-width="1.4" fill="none"/>' for x, y in grid(48, 5, 9))
def t_mount(c):
    d, l = shade(c, .55), shade(c, .82)
    peaks = [(52, 92, 40), (128, 76, 50), (90, 150, 38), (162, 160, 30), (30, 170, 26)]
    out = ""
    for x, y, h in peaks:
        out += f'<path d="M{x-h} {y+h*0.6}L{x} {y-h*0.7}L{x+h} {y+h*0.6}z" fill="{l}" stroke="{d}" stroke-width="2.4" stroke-linejoin="round"/>'
        out += f'<path d="M{x} {y-h*0.7}L{x+h} {y+h*0.6}H{x+h*0.15}z" fill="{d}" opacity=".45"/>'
        out += f'<path d="M{x-h*0.32} {y-h*0.2}L{x} {y-h*0.7}L{x+h*0.32} {y-h*0.2}l-{h*0.12} {h*0.08}-{h*0.1}-{h*0.1}-{h*0.1} {h*0.12}z" fill="#f4f6f4" stroke="{d}" stroke-width="1.2"/>'
    return out
def t_canyon(c):
    d, k = shade(c, .62), shade(c, .45)
    left = "M0 0H62L70 30L58 60L72 95L60 130L74 165L64 200H0z"
    right = "M200 0H138L130 30L144 60L128 95L140 130L126 165L136 200H200z"
    hatch = "".join(f'<path d="M{8+i*12} 0V200" stroke="{k}" stroke-width="1" opacity=".35"/>' for i in range(5))
    hatch += "".join(f'<path d="M{142+i*12} 0V200" stroke="{k}" stroke-width="1" opacity=".35"/>' for i in range(5))
    return (f'<path d="{left}" fill="{d}"/><path d="{right}" fill="{d}"/>{hatch}<path d="{left}" fill="none" stroke="{k}" stroke-width="2.5"/>'
            f'<path d="{right}" fill="none" stroke="{k}" stroke-width="2.5"/><path d="M100 20V180" stroke="{k}" stroke-width="2" stroke-dasharray="6 6"/>'
            f'<path d="M92 34l8-12 8 12M92 166l8 12 8-12" stroke="{k}" stroke-width="2" fill="none"/>')
def waves(color, step=26, seed=10, w=2):
    return "".join(f'<path d="M{x-14:.1f} {y:.1f}q7-6 14 0t14 0" stroke="{color}" stroke-width="{w}" fill="none" stroke-linecap="round"/>' for x, y in grid(step + 8, 4, seed))
def t_lake(c):
    return f'<ellipse cx="100" cy="100" rx="84" ry="70" fill="{shade(c, .9)}" stroke="{WATER}" stroke-width="3"/>' + waves(WATER, 26, 11)
def t_sea(c):
    return waves(WATER, 24, 12, 2.2)
def t_coast(c):
    water = "M200 0V200H90Q120 150 100 110T130 40Q140 20 150 0z"
    return f'<path d="{water}" fill="#b8d1de"/><path d="M150 0Q140 20 130 40T100 110Q120 150 90 200" fill="none" stroke="{WATER}" stroke-width="3"/>' + \
        "".join(f'<path d="M{x} {y}q6-5 12 0t12 0" stroke="{WATER}" stroke-width="2" fill="none"/>' for x, y in [(150, 50), (160, 100), (140, 150), (165, 180), (172, 20)])
def house(x, y, s, fill, ink):
    return f'<path d="M{x-s} {y}V{y-s*1.1}L{x} {y-s*2}L{x+s} {y-s*1.1}V{y}z" fill="{fill}" stroke="{ink}" stroke-width="1.6" stroke-linejoin="round"/>'
def t_village(c):
    d = shade(c, .55)
    road = f'<path d="M0 120Q60 100 100 110T200 92" stroke="{shade(c, .8)}" stroke-width="7" fill="none"/>'
    hs = [(40, 96, 9), (66, 92, 8), (122, 96, 9), (150, 84, 8), (60, 150, 9), (130, 150, 8), (96, 70, 8)]
    return road + "".join(house(x, y, s, "#f1ece2", d) for x, y, s in hs)
def t_city(c):
    d, k = shade(c, .6), shade(c, .45)
    out = f'<path d="M0 66H200M0 134H200M66 0V200M134 0V200" stroke="#eeeae6" stroke-width="8"/>'
    rnd = random.Random(14)
    for bx in (0, 68, 136):
        for by in (0, 68, 136):
            for i in range(3):
                w, h = rnd.randint(14, 26), rnd.randint(14, 26)
                x, y = bx + 6 + (i % 2) * 30, by + 6 + (i // 2) * 30
                out += f'<rect x="{x}" y="{y}" width="{w}" height="{h}" fill="{d}" stroke="{k}" stroke-width="1.2"/>'
    return out
def t_industry(c):
    d, k = shade(c, .6), shade(c, .42)
    out = ""
    for ox, oy in ((20, 70), (110, 150)):
        out += f'<path d="M{ox} {oy}V{oy-24}l14 10v-10l14 10v-10l14 10v-10l14 10v24z" fill="{d}" stroke="{k}" stroke-width="1.8" stroke-linejoin="round"/>'
        out += f'<rect x="{ox+58}" y="{oy-46}" width="8" height="46" fill="{d}" stroke="{k}" stroke-width="1.6"/>'
        out += f'<path d="M{ox+62} {oy-52}q6-8 14-6t12-8" stroke="{k}" stroke-width="2" fill="none" opacity=".5"/>'
    out += f'<circle cx="150" cy="70" r="20" fill="{d}" stroke="{k}" stroke-width="1.8"/><circle cx="50" cy="160" r="16" fill="{d}" stroke="{k}" stroke-width="1.8"/>'
    return out
def t_port(c):
    k = shade(c, .45)
    out = f'<path d="M0 110H200V200H0z" fill="#b8d1de"/>' + "".join(f'<path d="M{x} {y}q6-5 12 0t12 0" stroke="{WATER}" stroke-width="2" fill="none"/>' for x, y in [(20, 150), (90, 180), (150, 140), (170, 185)])
    out += f'<path d="M40 110V170M100 110V160M160 110V170" stroke="{k}" stroke-width="7"/>'
    out += f'<path d="M120 100V40H170M150 40V60" stroke="{k}" stroke-width="4" fill="none"/><path d="M110 100h20" stroke="{k}" stroke-width="5"/>'
    out += f'<rect x="20" y="70" width="34" height="22" fill="#c96e4b" stroke="{k}" stroke-width="1.5"/><rect x="58" y="70" width="34" height="22" fill="#4f7aa0" stroke="{k}" stroke-width="1.5"/>'
    return out
def t_base(c):
    k = shade(c, .45)
    out = f'<g transform="rotate(-20 100 100)"><rect x="18" y="86" width="164" height="28" fill="#8a8f88" stroke="{k}" stroke-width="2"/>'
    out += f'<path d="M26 100H174" stroke="#f4f4f0" stroke-width="2.5" stroke-dasharray="10 8"/></g>'
    out += f'<path d="M40 170v-18q18-16 36 0v18z" fill="{shade(c, .8)}" stroke="{k}" stroke-width="2"/><path d="M120 50v-14q14-12 28 0v14z" fill="{shade(c, .8)}" stroke="{k}" stroke-width="2"/>'
    return out

TERRAIN = {k[2:]: v for k, v in globals().items() if k.startswith("t_")}

# ---------- погода: прозрачный слой на клетку и значок ----------
def bolt(x, y, s, fill="#ffd23f", stroke="#5a4300"):
    return f'<path d="M{x+s*0.15} {y-s}L{x-s*0.45} {y+s*0.1}H{x}L{x-s*0.2} {y+s}L{x+s*0.5} {y-s*0.2}H{x+s*0.05}z" fill="{fill}" stroke="{stroke}" stroke-width="{max(1.2, s*0.08):.1f}" stroke-linejoin="round"/>'
def cloud(x, y, s, fill="#ffffff", stroke="#7d8a92", op=1):
    return (f'<path d="M{x-s} {y+s*0.35}a{s*0.38} {s*0.38} 0 0 1 {s*0.1}-{s*0.72}a{s*0.5} {s*0.5} 0 0 1 {s*0.86}-{s*0.2}'
            f'a{s*0.42} {s*0.42} 0 0 1 {s*0.74} {s*0.36}a{s*0.3} {s*0.3} 0 0 1 {s*0.06} {s*0.56}z" fill="{fill}" stroke="{stroke}" stroke-width="{max(1.2, s*0.07):.1f}" opacity="{op}"/>')
def spiral(x, y, r, color, w, rev=False):
    sw = 0 if rev else 1
    return (f'<path d="M{x+r} {y}A{r} {r} 0 1 {sw} {x-r*0.2} {y-r*0.98}M{x+r*0.62} {y}A{r*0.62} {r*0.62} 0 1 {sw} {x-r*0.1} {y-r*0.6}'
            f'M{x+r*0.26} {y}A{r*0.26} {r*0.26} 0 1 {sw} {x} {y-r*0.26}" stroke="{color}" stroke-width="{w}" fill="none" stroke-linecap="round"/>')

def w_clouds(badge):
    if badge: return cloud(32, 30, 20) + cloud(20, 40, 12, op=.9)
    return "".join(cloud(x, y, 30, "#ffffff", "#8b98a0", .62) for x, y in [(56, 50), (150, 70), (90, 130), (170, 160), (30, 175)])
def w_rain(badge):
    if badge: return cloud(32, 24, 18, "#d9e2e8") + "".join(f'<path d="M{x} 40l-4 10" stroke="#5fa8e0" stroke-width="3" stroke-linecap="round"/>' for x in (22, 32, 42))
    return "".join(f'<path d="M{x:.1f} {y:.1f}l-6 14" stroke="#3f7fb8" stroke-width="2" stroke-linecap="round" opacity=".55"/>' for x, y in grid(20, 5, 21))
def w_dust(badge):
    col = "#b98a45"
    if badge: return "".join(f'<path d="M10 {y}q8-7 16 0t16 0t16 0" stroke="#e0b46a" stroke-width="3.2" fill="none" stroke-linecap="round"/>' for y in (22, 34, 46))
    return f'<rect width="200" height="200" fill="{col}" opacity=".18"/>' + "".join(f'<path d="M-10 {y}q12-9 24 0t24 0t24 0t24 0t24 0t24 0t24 0t24 0t24 0" stroke="{col}" stroke-width="2.4" fill="none" opacity=".55"/>' for y in range(18, 200, 26))
def w_lightning(badge):
    if badge: return cloud(32, 22, 18, "#59646b", "#2b3237") + bolt(32, 42, 13)
    return cloud(60, 46, 32, "#4c565d", "#2b3237", .55) + cloud(150, 60, 28, "#4c565d", "#2b3237", .55) + bolt(64, 100, 34) + bolt(150, 120, 28) + bolt(110, 170, 20)
def w_wind(badge):
    col = "#4a6d8c"
    if badge:
        return '<g stroke="#9cd2ff" stroke-width="3.2" fill="none" stroke-linecap="round"><path d="M8 22H40a7 7 0 1 0-7-7"/><path d="M8 34H50"/><path d="M8 46H36a7 7 0 1 1-7 7"/></g>'
    return "".join(f'<g stroke="{col}" stroke-width="2.6" fill="none" stroke-linecap="round" opacity=".6"><path d="M{x-30} {y}H{x+20}a9 9 0 1 0-9-9"/><path d="M{x+20} {y}l-8-6M{x+20} {y}l-8 6"/></g>' for x, y in [(60, 40), (140, 80), (70, 120), (150, 170), (40, 180)])
def w_tornado(badge):
    if badge:
        return '<g stroke="#d6d9db" stroke-width="3" fill="none" stroke-linecap="round"><path d="M10 12H54M16 22H48M22 32H42M27 42H38M31 52H35"/></g>'
    return f'<path d="M30 30H170L120 110L104 170L96 170L88 110z" fill="#6b7177" opacity=".28"/>' + \
        "".join(f'<path d="M{100-w} {y}H{100+w}" stroke="#3d4248" stroke-width="3" stroke-linecap="round" opacity=".6"/>' for y, w in [(36, 66), (60, 52), (84, 38), (108, 24), (132, 14), (156, 8)])
def w_hurrW(badge):
    if badge: return spiral(32, 34, 20, "#7fd0ff", 3.2)
    return spiral(100, 104, 80, "#2f6fa8", 4) + '<path d="M168 40l14-8-2 16" stroke="#2f6fa8" stroke-width="4" fill="none" opacity=".7"/>'
def w_hurrA(badge):
    # против ветра: та же спираль, зеркально
    if badge: return '<g transform="translate(64 0) scale(-1 1)">' + spiral(32, 34, 20, "#ff9a7a", 3.2) + '</g>'
    return '<g transform="translate(200 0) scale(-1 1)">' + spiral(100, 104, 80, "#a8402f", 4) + '<path d="M168 40l14-8-2 16" stroke="#a8402f" stroke-width="4" fill="none" opacity=".7"/></g>'
def w_eye(badge):
    if badge: return '<circle cx="32" cy="32" r="20" fill="none" stroke="#9be3bf" stroke-width="3"/><circle cx="32" cy="32" r="6" fill="#9be3bf"/>'
    return '<circle cx="100" cy="100" r="80" fill="none" stroke="#3f8f6f" stroke-width="4" stroke-dasharray="10 8" opacity=".6"/><circle cx="100" cy="100" r="14" fill="#3f8f6f" opacity=".35"/>'
def w_tunnel(badge):
    if badge: return '<path d="M10 52V30a22 22 0 0 1 44 0v22" fill="none" stroke="#e9e4d2" stroke-width="4"/><path d="M20 52V32a12 12 0 0 1 24 0v20" fill="#0e1612" stroke="#e9e4d2" stroke-width="2"/>'
    return '<path d="M40 190V100a60 60 0 0 1 120 0v90" fill="none" stroke="#2a332c" stroke-width="6" opacity=".55"/><path d="M64 190V104a36 36 0 0 1 72 0v86" fill="#1e2822" opacity=".35"/>'
def w_strike(badge):
    if badge: return '<circle cx="32" cy="32" r="20" fill="none" stroke="#ff6b4a" stroke-width="3"/><circle cx="32" cy="32" r="9" fill="none" stroke="#ff6b4a" stroke-width="3"/><path d="M32 6v12M32 46v12M6 32h12M46 32h12" stroke="#ff6b4a" stroke-width="3"/>'
    hatch = "".join(f'<path d="M{x} 0L{x-200} 200" stroke="#c0392b" stroke-width="3" opacity=".22"/>' for x in range(0, 420, 22))
    return hatch + '<circle cx="100" cy="100" r="70" fill="none" stroke="#c0392b" stroke-width="5" opacity=".6"/><circle cx="100" cy="100" r="36" fill="none" stroke="#c0392b" stroke-width="5" opacity=".6"/>'

WEATHER = {k[2:]: v for k, v in globals().items() if k.startswith("w_")}

def badge(body):
    return ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="128" height="128">'
            '<rect x="2" y="2" width="60" height="60" rx="9" fill="#1e2822" stroke="#9daa7a" stroke-width="2.5"/>' + body + '</svg>')

for t in cat["terrain"]:
    fn = TERRAIN.get(t["id"])
    if not fn: raise SystemExit(f"нет рисунка местности {t['id']}")
    open(os.path.join(OUT, "terrain", f"{t['id']}.svg"), "w").write(svg(fn(t["color"]), t["color"]))
for e in cat["effects"]:
    fn = WEATHER.get(e["id"])
    if not fn: raise SystemExit(f"нет рисунка погоды {e['id']}")
    open(os.path.join(OUT, "weather", f"{e['id']}.svg"), "w").write(svg(fn(False)))
    open(os.path.join(OUT, "weather", f"{e['id']}-badge.svg"), "w").write(badge(fn(True)))
print(f"terrain {len(cat['terrain'])}, weather {len(cat['effects'])}")
