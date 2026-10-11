"""Справка «Мир на начало 2010» (/mnt/project-files/setting/mir-2010.html) и дополнение data/world-extra.html
-> страницы журнала Foundry (data/world-pages.json) и карта assets/world/map.svg в цветах «Брифинга».
Разметка справки переносится с префиксом tb-m- (стили в styles/thunderbolt.css, .tb-memo и .tb-world).
Запуск: python3 tools/world-to-journal.py [путь к mir-2010.html]"""
import json, os, re, sys
from bs4 import BeautifulSoup

src = sys.argv[1] if len(sys.argv) > 1 else "/mnt/project-files/setting/mir-2010.html"
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
raw = open(src, encoding="utf-8").read()
extra = open(os.path.join(root, "data", "world-extra.html"), encoding="utf-8").read()

# порядок страниц: справка и дополнение вперемешку, по смыслу
ORDER = [
    ("map", "Карта мира"), ("home", "Юктобания"), ("forces", "Наши вооружённые силы"), ("nations", "Страны мира"),
    ("chronicle", "Хроника века"), ("legends", "Войны и легенды неба"), ("ulysses", "Падение Улисса"),
    ("now", "Обстановка на сегодня"), ("sotoa", "Противник: Сотоа"), ("talk", "Разговоры в курилке"), ("words", "Как пишется"),
]
MAP_SRC = "systems/thunderbolt-shtab/assets/world/map.svg"

# ---------- карта: SVG справки как есть (регистр атрибутов важен), стили «Брифинга» внутрь файла ----------
m = re.search(r'<div class="mapbox">\s*(<svg.*?</svg>)', raw, re.S)
if not m:
    sys.exit("В справке нет карты (div.mapbox > svg)")
svg = m.group(1)
svg = re.sub(r'^<svg', '<svg xmlns="http://www.w3.org/2000/svg"', svg, count=1)
svg = re.sub(r'\s(role|aria-labelledby)="[^"]*"', "", svg[:400]) + svg[400:]
STYLE = """<style>
.m-sea { fill: #08171d; }
.m-grid { fill: none; stroke: #2c5a52; stroke-width: .6; opacity: .7; }
.m-land { fill: #0f2a31; }
.m-coast { fill: none; stroke: #4f8c7d; stroke-width: 1; stroke-linejoin: round; }
.m-us { fill: #133f37; stroke: #9be3bf; stroke-width: 1.4; }
.m-war { fill: #33201a; stroke: #ff6b4a; stroke-width: 1.8; stroke-dasharray: 5 4; }
.m-eq { fill: none; stroke: #7fa79d; stroke-width: 1; stroke-dasharray: 3 4; }
.m-impact { fill: url(#hatch); stroke: none; }
.m-hatch { stroke: #ff6b4a; stroke-width: 1.6; opacity: .6; }
.m-t { fill: #d7eee6; font-family: Jura, "Exo 2", "Segoe UI", Arial, sans-serif; font-size: 11px; }
.m-t.cont { font-size: 15px; letter-spacing: .4em; fill: #7fa79d; opacity: .85; }
.m-t.big { font-size: 17px; letter-spacing: .08em; fill: #e9f7f1; text-transform: uppercase; }
.m-t.mid { font-size: 13px; letter-spacing: .04em; fill: #e9f7f1; }
.m-t.small { font-size: 9px; fill: #7fa79d; }
.m-t.sea { fill: #7fa79d; font-style: italic; font-size: 10px; letter-spacing: .06em; paint-order: stroke; stroke: #08171d; stroke-width: 3px; }
.m-t.war { fill: #ff6b4a; font-family: "JetBrains Mono", Consolas, monospace; font-size: 8px; letter-spacing: .14em; font-weight: 600; }
</style>"""
# фон моря: в справке его даёт рамка .mapbox, у отдельного файла своего фона нет
vb = re.search(r'viewBox="([\d.\s-]+)"', svg)
w, h = (vb.group(1).split()[2:4] if vb else ("1000", "575"))
svg = re.sub(r'(<svg[^>]*>)', lambda x: f'{x.group(1)}\n{STYLE}\n<rect class="m-sea" width="{w}" height="{h}"/>', svg, count=1)
os.makedirs(os.path.join(root, "assets", "world"), exist_ok=True)
open(os.path.join(root, "assets", "world", "map.svg"), "w", encoding="utf-8").write(svg + "\n")
# обложка компендиума: та же карта без подписей, полоса через Верусу и Анею, затемнение к краям
banner = re.sub(r"<text\b.*?</text>", "", svg, flags=re.S)
banner = re.sub(r'viewBox="[^"]*"', 'viewBox="380 120 600 140" width="600" height="140" preserveAspectRatio="xMidYMid slice"', banner, count=1)
banner = banner.replace("</svg>", '<defs><linearGradient id="fade" x1="0" x2="1"><stop offset="0" stop-color="#050f13" stop-opacity=".85"/>'
                        '<stop offset=".35" stop-color="#050f13" stop-opacity="0"/><stop offset=".65" stop-color="#050f13" stop-opacity="0"/>'
                        '<stop offset="1" stop-color="#050f13" stop-opacity=".85"/></linearGradient></defs>'
                        '<rect x="380" y="120" width="600" height="140" fill="url(#fade)"/></svg>')
open(os.path.join(root, "assets", "banners", "world.svg"), "w", encoding="utf-8").write(banner + "\n")

# ---------- листы справки -> страницы ----------
KEEP_ATTRS = ("colspan", "rowspan", "src", "alt")


def clean(node):
    for bad in node.select(".os-bar, .doc-head, .stamp, .foot, .mapbox, .blink"):
        bad.decompose()
    for a in node.find_all("a"):   # ссылки на якоря справки в журнале не работают
        a.unwrap()
    for el in node.find_all(True):
        cls = el.get("class") or []
        for at in list(el.attrs):
            if at not in KEEP_ATTRS:
                del el[at]
        if cls:
            el["class"] = " ".join("tb-m-" + c for c in cls)
    return node


def sheets(html):
    soup = BeautifulSoup(html, "html.parser")
    return {s.get("id"): s for s in soup.select("section.sheet")}


found = {**sheets(raw), **sheets(extra)}
missing = [k for k, _ in ORDER if k not in found]
if missing:
    sys.exit(f"Нет листов справки: {missing}")

pages = []
for n, (key, name) in enumerate(ORDER, 1):
    sec = found[key]
    head = sec.select_one("header.sheet-head")
    title = re.sub(r"\s+", " ", head.find(["h1", "h2"]).get_text(" ", strip=True))
    meta = head.select_one(".meta")
    meta_html = clean(meta).decode_contents().replace("<br/>", " ") if meta else ""
    head.decompose()
    body = clean(sec)
    html = re.sub(r"\n\s+", "\n", body.decode_contents()).strip()
    if key == "map":
        # карта первой страницы — картинка из системы; щелчок по ней в журнале открывает её крупно
        html = html.replace('<div class="tb-m-legend">', f'<p class="tb-m-map"><img src="{MAP_SRC}" alt="Карта мира"></p>\n<div class="tb-m-legend">', 1)
    kicker = f'ВВС Юктобании · справка для лётного состава · {n} из {len(ORDER)}'
    cover = (f'<div class="tb-m-cover"><p class="tb-m-org">ВВС Юктобании · политотдел · на январь 2010</p>'
             f'<p class="tb-m-title">{title}</p><p class="tb-m-sub">{meta_html}</p></div>') if key == "map" else \
            f'<p class="tb-m-kicker">{kicker}</p>\n<h2 class="tb-m-head">{title}{f" <small>{meta_html}</small>" if meta_html else ""}</h2>'
    pages.append({"name": name, "html": f'<div class="tb-memo tb-world">\n{cover}\n{html}\n</div>'})

json.dump(pages, open(os.path.join(root, "data", "world-pages.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print(f"{len(pages)} pages: {', '.join(p['name'] for p in pages)}; map {len(svg) // 1024} KB")
