"""Клетки карты в стиле схемы «Брифинг» Штаба: тёмная заливка местности и тонкие мятные условные знаки,
погода — прозрачный слой линиями и значок в углу. Местность у воды бывает в нескольких вариантах:
побережье «край» (вода справа) и «угол» (вода в правом верхнем углу), порт (вода снизу), озеро закрытое и открытое;
импорт миссии поворачивает их к соседней воде.
Запуск: python3 tools/map-icons.py -> assets/map/terrain/<id>[-variant].svg, assets/map/weather/<id>.svg и <id>-badge.svg"""
import json, os, random

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
cat = json.load(open(os.path.join(ROOT, "data", "catalog.json"), encoding="utf-8"))
OUT = os.path.join(ROOT, "assets", "map")
W = 200

# палитра «Брифинга»: тёмная бирюза, мятные линии, голубая вода
BG = {
    "steppe": "#0f2420", "meadow": "#10261c", "desert": "#211f14", "oasis": "#0f2a1a", "snow": "#1a2a31",
    "forest": "#0b2418", "taiga": "#09211a", "swamp": "#10211a", "hills": "#1b2117", "mount": "#1b2226",
    "canyon": "#2a1a12", "lake": "#07233a", "coast": "#1d1e14", "sea": "#08233a", "village": "#1e1b16",
    "city": "#171b21", "industry": "#16171c", "port": "#0e1d27", "base": "#0d2619",
}
MINT = "#9be3bf"
WATER = "#6cc4ff"
SAND = "#e0c27a"
WARN = "#f2c14e"
HOT = "#ff6b4a"

def svg(body, bg=None):
    rect = f'<rect width="{W}" height="{W}" fill="{bg}"/>' if bg else ""
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {W}" width="400" height="400">{rect}{body}</svg>'

def grid(step, jitter, seed):
    rnd = random.Random(seed)
    pts = []
    for y in range(step // 2, W, step):
        for x in range(step // 2 + (step // 2 if (y // step) % 2 else 0), W + step // 2, step):
            if x > W - 8: continue
            pts.append((x + rnd.uniform(-jitter, jitter), y + rnd.uniform(-jitter, jitter)))
    return pts

def g(body, color=MINT, op=.55, w=1.6):
    return f'<g fill="none" stroke="{color}" stroke-width="{w}" stroke-linecap="round" stroke-linejoin="round" opacity="{op}">{body}</g>'

def waves(seed, step=30, op=.55, color=WATER, area=None):
    pts = grid(step, 4, seed)
    if area: pts = [p for p in pts if area(*p)]
    return g("".join(f'<path d="M{x-12:.1f} {y:.1f}q6-5 12 0t12 0"/>' for x, y in pts), color, op)

def t_steppe():
    return g("".join(f'<path d="M{x-5:.1f} {y+3:.1f}l3-7M{x:.1f} {y+3:.1f}v-8M{x+5:.1f} {y+3:.1f}l-3-7"/>' for x, y in grid(44, 6, 1)), op=.35)
def t_meadow():
    rows = "".join(f'<path d="M8 {y}H192" stroke-dasharray="1 8"/>' for y in range(22, 200, 24))
    tufts = "".join(f'<path d="M{x-4:.1f} {y+3:.1f}l2-6M{x+4:.1f} {y+3:.1f}l-2-6"/>' for x, y in grid(46, 6, 2))
    return g(rows, op=.25) + g(tufts, op=.4)
def t_desert():
    return g("".join(f'<path d="M{x-16:.1f} {y:.1f}q16-11 32 0"/>' for x, y in grid(42, 5, 3)), SAND, .45)
def t_oasis():
    return t_desert() + f'<ellipse cx="100" cy="114" rx="34" ry="15" fill="{WATER}" fill-opacity=".12" stroke="{WATER}" stroke-width="1.6" opacity=".8"/>' + \
        g('<path d="M86 100V72M86 72q-14-6-22 4M86 72q14-6 22 4M86 72q-6-12-18-12M86 72q6-12 18-12"/><path d="M118 100V80M118 80q-12-5-18 3M118 80q12-5 18 3M118 80q-5-10-14-10M118 80q5-10 14-10"/>', op=.7, w=1.8)
def t_snow():
    return g("".join(f'<path d="M{x-6:.1f} {y:.1f}h12M{x-3:.1f} {y-5.2:.1f}l6 10.4M{x+3:.1f} {y-5.2:.1f}l-6 10.4"/>' for x, y in grid(40, 7, 5)), "#d7eee6", .4)
def t_forest():
    return g("".join(f'<path d="M{x:.1f} {y+11:.1f}v-5"/><circle cx="{x:.1f}" cy="{y-2:.1f}" r="8"/>' for x, y in grid(34, 4, 6)), op=.5)
def t_taiga():
    return g("".join(f'<path d="M{x:.1f} {y-13:.1f}l8 12h-4l6 10h-20l6-10h-4z"/>' for x, y in grid(32, 4, 7)), op=.5)
def t_swamp():
    out = ""
    for x, y in grid(38, 5, 8):
        out += g(f'<path d="M{x-12:.1f} {y+6:.1f}h24M{x-7:.1f} {y+10:.1f}h14"/>', WATER, .45)
        out += g(f'<path d="M{x-5:.1f} {y+5:.1f}v-8M{x:.1f} {y+5:.1f}v-11M{x+5:.1f} {y+5:.1f}v-8"/>', op=.45)
    return out
def t_hills():
    return g("".join(f'<path d="M{x-20:.1f} {y+8:.1f}q20-28 40 0"/><path d="M{x-8:.1f} {y+8:.1f}q8-12 16 0" opacity=".6"/>' for x, y in grid(48, 5, 9)), op=.45)
def t_mount():
    peaks = [(52, 92, 40), (128, 76, 50), (90, 150, 38), (162, 160, 30), (30, 170, 26)]
    out = ""
    for x, y, h in peaks:
        out += f'<path d="M{x-h} {y+h*0.6}L{x} {y-h*0.7}L{x+h} {y+h*0.6}"/>'
        out += f'<path d="M{x-h*0.3} {y-h*0.25}L{x-h*0.1} {y-h*0.12}L{x+h*0.05} {y-h*0.3}L{x+h*0.3} {y-h*0.22}" opacity=".7"/>'
        out += "".join(f'<path d="M{x+h*k:.1f} {y-h*0.7+h*1.3*k:.1f}l{-h*0.18:.1f} {h*0.3:.1f}" opacity=".45"/>' for k in (0.25, 0.45, 0.65))
    return g(out, op=.6, w=1.8)
def t_canyon():
    left = "M62 0L70 30L58 60L72 95L60 130L74 165L64 200"
    right = "M138 0L130 30L144 60L128 95L140 130L126 165L136 200"
    hatch = "".join(f'<path d="M{x} {y}l-10 6"/>' for x in (54, 46, 38) for y in range(10, 200, 22))
    hatch += "".join(f'<path d="M{x} {y}l10 6"/>' for x in (146, 154, 162) for y in range(10, 200, 22))
    return g(f'<path d="{left}"/><path d="{right}"/>', SAND, .7, 2) + g(hatch, SAND, .35) + \
        g('<path d="M100 22V178" stroke-dasharray="6 6"/><path d="M92 34l8-12 8 12M92 166l8 12 8-12"/>', op=.6)
def t_lake():
    return f'<ellipse cx="100" cy="100" rx="82" ry="68" fill="{WATER}" fill-opacity=".08" stroke="{WATER}" stroke-width="1.8" opacity=".75"/>' + \
        waves(11, 30, .45, area=lambda x, y: ((x - 100) / 72) ** 2 + ((y - 100) / 58) ** 2 < 1)
def t_lake_open():
    return waves(15, 30, .45)
def t_sea():
    return waves(12, 26, .5)
# побережье «край»: вода справа, берег неровной линией
SHORE = "M150 0Q138 22 128 44T110 100Q126 150 104 200"
def t_coast():
    water = SHORE + "H200V0z"
    return f'<path d="{water}" fill="{WATER}" fill-opacity=".1"/>' + g(f'<path d="{SHORE}"/>', WATER, .8, 2) + \
        g(f'<path d="{SHORE}" transform="translate(-9 0)" stroke-dasharray="2 6"/>', SAND, .5) + \
        waves(13, 28, .45, area=lambda x, y: x > 150 + (y - 100) ** 2 / 400)
# побережье «угол»: вода в правом верхнем углу
CORNER = "M70 0Q90 40 120 60T200 128"
def t_coast_corner():
    water = CORNER + "V0z"
    return f'<path d="{water}" fill="{WATER}" fill-opacity=".1"/>' + g(f'<path d="{CORNER}"/>', WATER, .8, 2) + \
        g(f'<path d="{CORNER}" transform="translate(-7 7)" stroke-dasharray="2 6"/>', SAND, .5) + \
        waves(14, 26, .45, area=lambda x, y: y < (x - 80) * 1.0 - 10)
def t_port():
    out = f'<path d="M0 116H200V200H0z" fill="{WATER}" fill-opacity=".1"/>' + g('<path d="M0 116H200"/>', WATER, .8, 2)
    out += waves(16, 28, .4, area=lambda x, y: y > 130)
    out += g('<path d="M40 116V176M100 116V166M160 116V176" stroke-width="5"/>', op=.45)
    out += g('<path d="M120 104V44H170M150 44V62M110 104h20"/><rect x="22" y="76" width="30" height="18"/><rect x="58" y="76" width="30" height="18"/>', op=.6, w=1.8)
    return out
def house(x, y, s):
    return f'<path d="M{x-s} {y}V{y-s*1.1}L{x} {y-s*2}L{x+s} {y-s*1.1}V{y}z"/>'
def t_village():
    hs = [(40, 96, 9), (66, 92, 8), (122, 96, 9), (150, 84, 8), (60, 150, 9), (130, 150, 8), (96, 70, 8)]
    return g('<path d="M0 120Q60 100 100 110T200 92"/>', SAND, .35, 5) + g("".join(house(x, y, s) for x, y, s in hs), op=.6)
def t_city():
    out = g('<path d="M0 66H200M0 134H200M66 0V200M134 0V200"/>', op=.18, w=7)
    rnd = random.Random(14)
    blocks = ""
    for bx in (0, 68, 136):
        for by in (0, 68, 136):
            for i in range(3):
                w, h = rnd.randint(14, 26), rnd.randint(14, 26)
                blocks += f'<rect x="{bx + 6 + (i % 2) * 30}" y="{by + 6 + (i // 2) * 30}" width="{w}" height="{h}"/>'
    return out + g(blocks, op=.5)
def t_industry():
    out = ""
    for ox, oy in ((20, 70), (110, 150)):
        out += f'<path d="M{ox} {oy}V{oy-24}l14 10v-10l14 10v-10l14 10v-10l14 10v24z"/><rect x="{ox+58}" y="{oy-46}" width="8" height="46"/>'
        out += f'<path d="M{ox+62} {oy-52}q6-8 14-6t12-8" opacity=".5"/>'
    out += '<circle cx="150" cy="70" r="20"/><circle cx="50" cy="160" r="16"/>'
    return g(out, op=.55, w=1.8)
def t_base():
    out = g('<g transform="rotate(-20 100 100)"><rect x="18" y="86" width="164" height="28"/><path d="M26 100H174" stroke-dasharray="10 8"/></g>', op=.6, w=1.8)
    out += g('<path d="M40 170v-18q18-16 36 0v18z"/><path d="M120 50v-14q14-12 28 0v14z"/>', op=.5)
    return out

TERRAIN = {"steppe": t_steppe, "meadow": t_meadow, "desert": t_desert, "oasis": t_oasis, "snow": t_snow, "forest": t_forest,
           "taiga": t_taiga, "swamp": t_swamp, "hills": t_hills, "mount": t_mount, "canyon": t_canyon, "lake": t_lake,
           "coast": t_coast, "sea": t_sea, "village": t_village, "city": t_city, "industry": t_industry, "port": t_port, "base": t_base}
VARIANTS = {"coast-corner": ("coast", t_coast_corner), "lake-open": ("lake", t_lake_open)}

# ---------- погода: линии поверх местности и значок ----------
def bolt(x, y, s, fill=WARN, stroke="#5a4300"):
    return f'<path d="M{x+s*0.15} {y-s}L{x-s*0.45} {y+s*0.1}H{x}L{x-s*0.2} {y+s}L{x+s*0.5} {y-s*0.2}H{x+s*0.05}z" fill="{fill}" stroke="{stroke}" stroke-width="{max(1.2, s*0.08):.1f}" stroke-linejoin="round"/>'
def cloud_path(x, y, s):
    return (f'M{x-s} {y+s*0.35}a{s*0.38} {s*0.38} 0 0 1 {s*0.1}-{s*0.72}a{s*0.5} {s*0.5} 0 0 1 {s*0.86}-{s*0.2}'
            f'a{s*0.42} {s*0.42} 0 0 1 {s*0.74} {s*0.36}a{s*0.3} {s*0.3} 0 0 1 {s*0.06} {s*0.56}z')
def cloud(x, y, s, fill="#ffffff", stroke="#7d8a92", op=1):
    return f'<path d="{cloud_path(x, y, s)}" fill="{fill}" stroke="{stroke}" stroke-width="{max(1.2, s*0.07):.1f}" opacity="{op}"/>'
def spiral(x, y, r, color, w):
    return (f'<path d="M{x+r} {y}A{r} {r} 0 1 1 {x-r*0.2} {y-r*0.98}M{x+r*0.62} {y}A{r*0.62} {r*0.62} 0 1 1 {x-r*0.1} {y-r*0.6}'
            f'M{x+r*0.26} {y}A{r*0.26} {r*0.26} 0 1 1 {x} {y-r*0.26}" stroke="{color}" stroke-width="{w}" fill="none" stroke-linecap="round"/>')

def w_clouds(badge):
    if badge: return cloud(32, 30, 20) + cloud(20, 40, 12, op=.9)
    return "".join(f'<path d="{cloud_path(x, y, 30)}" fill="#d7eee6" fill-opacity=".12" stroke="#d7eee6" stroke-width="1.6" opacity=".7"/>' for x, y in [(56, 50), (150, 70), (90, 130), (170, 160), (30, 175)])
def w_rain(badge):
    if badge: return cloud(32, 24, 18, "#d9e2e8") + "".join(f'<path d="M{x} 40l-4 10" stroke="#5fa8e0" stroke-width="3" stroke-linecap="round"/>' for x in (22, 32, 42))
    return g("".join(f'<path d="M{x:.1f} {y:.1f}l-5 12"/>' for x, y in grid(20, 5, 21)), WATER, .5)
def w_dust(badge):
    if badge: return "".join(f'<path d="M10 {y}q8-7 16 0t16 0t16 0" stroke="#e0b46a" stroke-width="3.2" fill="none" stroke-linecap="round"/>' for y in (22, 34, 46))
    return f'<rect width="200" height="200" fill="{SAND}" opacity=".08"/>' + g("".join(f'<path d="M-10 {y}q12-9 24 0t24 0t24 0t24 0t24 0t24 0t24 0t24 0t24 0"/>' for y in range(18, 200, 26)), SAND, .5, 2)
def w_lightning(badge):
    if badge: return cloud(32, 22, 18, "#59646b", "#2b3237") + bolt(32, 42, 13)
    return (f'<path d="{cloud_path(60, 46, 32)}" fill="#7d8a92" fill-opacity=".2" stroke="#d7eee6" stroke-width="1.6" opacity=".6"/>'
            f'<path d="{cloud_path(150, 60, 28)}" fill="#7d8a92" fill-opacity=".2" stroke="#d7eee6" stroke-width="1.6" opacity=".6"/>'
            + bolt(64, 100, 30) + bolt(150, 120, 26) + bolt(110, 170, 18))
def w_wind(badge):
    if badge:
        return '<g stroke="#9cd2ff" stroke-width="3.2" fill="none" stroke-linecap="round"><path d="M8 22H40a7 7 0 1 0-7-7"/><path d="M8 34H50"/><path d="M8 46H36a7 7 0 1 1-7 7"/></g>'
    return g("".join(f'<path d="M{x-30} {y}H{x+20}a9 9 0 1 0-9-9"/><path d="M{x+20} {y}l-8-6M{x+20} {y}l-8 6"/>' for x, y in [(60, 40), (140, 80), (70, 120), (150, 170), (40, 180)]), "#9cd2ff", .6, 2)
def w_tornado(badge):
    if badge:
        return '<g stroke="#d6d9db" stroke-width="3" fill="none" stroke-linecap="round"><path d="M10 12H54M16 22H48M22 32H42M27 42H38M31 52H35"/></g>'
    return g('<path d="M30 30H170L120 110L104 170L96 170L88 110z"/>', "#d7eee6", .35) + \
        g("".join(f'<path d="M{100-w} {y}H{100+w}"/>' for y, w in [(36, 66), (60, 52), (84, 38), (108, 24), (132, 14), (156, 8)]), "#d7eee6", .6, 2.4)
def w_hurrW(badge):
    if badge: return spiral(32, 34, 20, "#7fd0ff", 3.2)
    return spiral(100, 104, 80, WATER, 3) + g('<path d="M168 40l14-8-2 16"/>', WATER, .7, 3)
def w_hurrA(badge):
    if badge: return '<g transform="translate(64 0) scale(-1 1)">' + spiral(32, 34, 20, "#ff9a7a", 3.2) + '</g>'
    return '<g transform="translate(200 0) scale(-1 1)">' + spiral(100, 104, 80, HOT, 3) + g('<path d="M168 40l14-8-2 16"/>', HOT, .7, 3) + '</g>'
def w_eye(badge):
    if badge: return f'<circle cx="32" cy="32" r="20" fill="none" stroke="{MINT}" stroke-width="3"/><circle cx="32" cy="32" r="6" fill="{MINT}"/>'
    return g('<circle cx="100" cy="100" r="80" stroke-dasharray="10 8"/><circle cx="100" cy="100" r="14"/>', MINT, .55, 2.4)
def w_tunnel(badge):
    if badge: return '<path d="M10 52V30a22 22 0 0 1 44 0v22" fill="none" stroke="#e9e4d2" stroke-width="4"/><path d="M20 52V32a12 12 0 0 1 24 0v20" fill="#0e1612" stroke="#e9e4d2" stroke-width="2"/>'
    return g('<path d="M40 190V100a60 60 0 0 1 120 0v90"/><path d="M64 190V104a36 36 0 0 1 72 0v86" stroke-dasharray="4 5"/>', MINT, .6, 2.4)
def w_strike(badge):
    if badge: return f'<circle cx="32" cy="32" r="20" fill="none" stroke="{HOT}" stroke-width="3"/><circle cx="32" cy="32" r="9" fill="none" stroke="{HOT}" stroke-width="3"/><path d="M32 6v12M32 46v12M6 32h12M46 32h12" stroke="{HOT}" stroke-width="3"/>'
    hatch = "".join(f'<path d="M{x} 0L{x-200} 200"/>' for x in range(0, 420, 22))
    return g(hatch, HOT, .18, 2) + g('<circle cx="100" cy="100" r="70"/><circle cx="100" cy="100" r="36"/>', HOT, .6, 2.6)

WEATHER = {k[2:]: v for k, v in globals().items() if k.startswith("w_")}

def badge(body):
    # уголки «Брифинга» и тёмная подложка
    return ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="128" height="128">'
            '<rect x="3" y="3" width="58" height="58" fill="#07141a" fill-opacity=".88" stroke="#9be3bf" stroke-opacity=".5" stroke-width="1.5"/>'
            '<path d="M3 13V3h10M51 3h10v10M61 51v10H51M13 61H3V51" fill="none" stroke="#9be3bf" stroke-width="2.5"/>' + body + '</svg>')

for t in cat["terrain"]:
    fn = TERRAIN.get(t["id"])
    if not fn: raise SystemExit(f"нет рисунка местности {t['id']}")
    open(os.path.join(OUT, "terrain", f"{t['id']}.svg"), "w").write(svg(fn(), BG[t["id"]]))
for name, (base, fn) in VARIANTS.items():
    open(os.path.join(OUT, "terrain", f"{name}.svg"), "w").write(svg(fn(), BG[base]))
for e in cat["effects"]:
    fn = WEATHER.get(e["id"])
    if not fn: raise SystemExit(f"нет рисунка погоды {e['id']}")
    open(os.path.join(OUT, "weather", f"{e['id']}.svg"), "w").write(svg(fn(False)))
    open(os.path.join(OUT, "weather", f"{e['id']}-badge.svg"), "w").write(badge(fn(True)))
print(f"terrain {len(cat['terrain'])} + {len(VARIANTS)} variants, weather {len(cat['effects'])}")
