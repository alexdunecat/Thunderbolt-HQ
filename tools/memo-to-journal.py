"""Памятка пилота (shtab/src/memo.html) -> страницы журнала Foundry (data/memo-pages.json).
Запуск: python3 tools/memo-to-journal.py [путь к memo.html]"""
import json, re, sys, os
from bs4 import BeautifulSoup

src = sys.argv[1] if len(sys.argv) > 1 else "/mnt/project-files/shtab/src/memo.html"
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
soup = BeautifulSoup(open(src, encoding="utf-8").read(), "html.parser")

pages = []
lede = soup.select_one(".lede")
for sheet_i, sheet in enumerate(soup.select("section.sheet"), 1):
    for blk in sheet.select("div.blk"):
        h2 = blk.find("h2")
        small = h2.find("small")
        sub = small.get_text(" ", strip=True) if small else ""
        if small: small.extract()
        title = h2.get_text(" ", strip=True)
        h2.extract()
        for ex in blk.select("div.ex"):
            t = ex.select_one(".t")
            if t: t.replace_with(BeautifulSoup(f"<b>{t.get_text()}.</b> ", "html.parser"))
            ex.name = "blockquote"
        for tw in blk.select("div.tw"):
            tw.unwrap()
        for el in blk.find_all(True):
            for a in list(el.attrs):
                if a not in ("colspan", "rowspan"): del el[a]
        html = "".join(str(c) for c in blk.contents).strip()
        html = re.sub(r"\n\s+", "\n", html)
        if sub: html = f"<p><em>{sub}</em></p>\n" + html
        pages.append({"name": title, "html": html, "sheet": sheet_i})

intro = "<p>Памятка пилота ВВС Юктобании по Thunderbolt v1.3. Листы 1–2 бумажной памятки разбиты по страницам.</p>"
if lede: intro += f"<p>{lede.decode_contents()}</p>"
pages.insert(0, {"name": "Коротко", "html": intro, "sheet": 0})
json.dump(pages, open(os.path.join(root, "data", "memo-pages.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print(len(pages), "pages:", ", ".join(p["name"] for p in pages))
