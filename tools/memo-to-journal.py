"""Памятка пилота (shtab/src/memo.html) -> страницы журнала Foundry (data/memo-pages.json).
Блоки памятки собираются в разделы; классы оформления сохраняются с префиксом tb-m- (стили в styles/thunderbolt.css, .tb-memo).
Запуск: python3 tools/memo-to-journal.py [путь к memo.html]"""
import json, re, sys, os
from bs4 import BeautifulSoup

src = sys.argv[1] if len(sys.argv) > 1 else "/mnt/project-files/shtab/src/memo.html"
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
soup = BeautifulSoup(open(src, encoding="utf-8").read(), "html.parser")

# раздел журнала -> заголовки блоков памятки в нём
GROUPS = [
    ("Проверки", "d10 + навык против сложности", ["Проверка", "Strain", "Perk и Complication", "Навыки"]),
    ("Раунд и действия", "кто когда ходит и что может", ["Раунд", "Действия"]),
    ("Скорость и атака", "скорость, ракеты, пушка, Break!", ["Скорость", "Ракеты", "Пушка", "Break!"]),
    ("Полёт", "пилотаж, зоны и высота", ["Пилотаж", "Зоны и высота"]),
    ("Урон", "метки и катапульта", ["Урон", "Если всё плохо"]),
    ("Пилот", "архетипы, триггеры, жизнь на земле", ["Архетипы", "Триггеры", "Вне самолёта"]),
    ("Погода", "если объявит AWACS", ["Погода"]),
    ("Радиообмен", "по-русски", ["Радиообмен"]),
]

KEEP_ATTRS = ("colspan", "rowspan")


def clean(blk):
    """Классы памятки -> tb-m-*, обёртки-таблицы убрать, лишние атрибуты снять."""
    for tw in blk.select("div.tw"):
        tw.unwrap()
    for el in blk.find_all(True):
        cls = el.get("class") or []
        for a in list(el.attrs):
            if a not in KEEP_ATTRS:
                del el[a]
        if cls:
            el["class"] = " ".join("tb-m-" + c for c in cls)
    return blk


blocks = {}
for sheet in soup.select("section.sheet"):
    for blk in sheet.select("div.blk"):
        h2 = blk.find("h2")
        small = h2.find("small")
        sub = small.get_text(" ", strip=True) if small else ""
        if small:
            small.extract()
        title = h2.get_text(" ", strip=True)
        h2.extract()
        clean(blk)
        body = "".join(str(c) for c in blk.contents).strip()
        body = re.sub(r"\n\s+", "\n", body)
        head = f'<h2>{title}{f" <small>{sub}</small>" if sub else ""}</h2>'
        blocks[title] = f'<section class="tb-m-blk">\n{head}\n{body}\n</section>'

ledes = [clean(p).decode_contents() for p in soup.select("p.lede")]


def page(name, kicker, html):
    head = f'<p class="tb-m-kicker">{kicker}</p>\n' if kicker else ""
    return {"name": name, "html": f'<div class="tb-memo">\n{head}{html}\n</div>'}


pages = []
intro = f"""<div class="tb-m-cover">
<p class="tb-m-org">ВВС Юктобании · штаб полка</p>
<p class="tb-m-title">Памятка пилота</p>
<p class="tb-m-sub">Thunderbolt v1.3 · основные правила, полёт и эскадрилья</p>
</div>
<p class="tb-m-lede">{ledes[0] if ledes else ""}</p>
{f'<p class="tb-m-lede">{ledes[1]}</p>' if len(ledes) > 1 else ""}
<section class="tb-m-blk"><h2>Разделы</h2>
<ol class="tb-m-toc">{"".join(f"<li><b>{g}</b> <span>{s}</span></li>" for g, s, _ in GROUPS)}<li><b>Лист в Foundry</b> <span>что где нажимать</span></li></ol>
</section>"""
pages.append(page("Содержание", "", intro))

used = set()
total = len(GROUPS) + 1
for n, (name, sub, titles) in enumerate(GROUPS, 1):
    html = "\n".join(blocks[t] for t in titles if t in blocks)
    used.update(titles)
    pages.append(page(name, f"Памятка пилота · раздел {n} из {total}", html))
missing = [t for t in blocks if t not in used]
if missing:
    sys.exit(f"Блоки памятки без раздела: {missing}")

foundry_page = """<section class="tb-m-blk"><h2>Боевая карточка</h2>
<ul>
<li>Кубик слева от навыка: <b>проверка</b> d10 + навык против 7. В окне можно поменять сложность и добавить модификатор.</li>
<li>На карточке броска в чате: <b>+1 Strain</b> докупает результат, пока запас не кончился.</li>
<li>Кнопки под приборами: <b>Lock On!</b>, <b>Fox Two!</b>, <b>Guns</b>, <b>Break!</b>, передышка и сваливание. <b>Lock On!</b> просит щёлкнуть по токену цели, и он же становится целью для Fox Two! и пушки. Другую цель можно выбрать клавишей <b>T</b> над её токеном.</li>
<li>Любую из этих кнопок и кубик навыка можно перетащить на панель макросов внизу экрана. Макрос действует за выделенный токен, а если ничего не выделено, за вашего пилота.</li>
<li>Когда вас берут на захват, приходит сигнал «Облучение!», а на вашем токене загорается красное перекрестие. При пуске ракеты по вам приходит сигнал «Ракета!», если MAWS цел.</li>
<li>Урон наносит AWACS кнопкой на карточке атаки. Когда HP кончается, лист сам спросит, какую метку отметить.</li>
<li>Одна клетка сетки на сцене — одна зона. Захват берётся в своей или соседней зоне и срывается, если цель ушла дальше двух зон. Пушка бьёт только в своей зоне, у спецоружия своя дальность. Если цель дальше, лист спросит, стрелять ли всё равно.</li>
<li>Токен занимает четверть клетки, так что в одной зоне помещаются четыре самолёта. Новый или передвинутый токен сам встаёт в свободный угол зоны, а с зажатым Shift остаётся там, где его отпустили. Размер меняется в настройках мира, а уже стоящие токены перекладывает кнопка «Разложить токены» в панели AWACS.</li>
<li>Большие цели занимают несколько клеток: стратегический бомбардировщик 2×2, летающий крейсер 6×2, подводный авианосец 1×3, корабль крупнее катера 1×2. Они стоят сразу во всех своих зонах, и дальность до них считается до ближайшей.</li>
</ul></section>
<section class="tb-m-blk"><h2>Звено</h2>
<ul>
<li>Кнопка <b>Perk</b> или <b>Complication</b> на карточке броска передаёт +1 или −1 к следующей проверке себе или союзнику. Бонус сам попадёт в следующий бросок.</li>
<li><b>Leadership</b>: выберите союзников, которые послушали, и они прибавят ваш Lead к следующему броску.</li>
<li><b>Вплотную</b>: встать в строй с самолётами своей зоны. Строй сам распадается, когда вы окажетесь в разных зонах, а триггер «В строю» добавляет ваш Lead к Evasion соседей.</li>
<li>Всё, что ждёт следующего броска, видно на боевой карточке; лишнее можно убрать крестиком.</li>
</ul></section>
<section class="tb-m-blk"><h2>После вылета</h2>
<p>AWACS подводит итоги вылета: сбитые, катапультирования и очки навыков попадают в личное дело, а разбор полёта (кто кого сбил, что потрачено, какие задачи выполнены) появляется в журнале в папке «Разбор полётов».</p>
</section>
<section class="tb-m-blk"><h2>Ракеты и конец раунда</h2>
<p>Пущенные ракеты ждут конца раунда. Когда AWACS переходит к следующему раунду, все ракеты долетают залпом: по каждой цели берётся самая точная, остальные добавляют +1 к ней или свой урон, защита считается на этот момент (с Break!). Урон по всем целям наносится одной кнопкой на карточке залпа. Если бой завершить, ракеты последнего раунда тоже долетят.</p>
</section>
<section class="tb-m-blk"><h2>Погода</h2>
<p>Погоду над сценой включает AWACS, а погода из клеток Планшета AWACS приходит с импортом миссии. Она сама попадает в защиту, A-A и A-G без броска, Push и пороги Complication. Значки погоды видны на боевой карточке.</p>
</section>
<section class="tb-m-blk"><h2>Триггеры</h2>
<ul>
<li>Постоянные триггеры (например, «Бронирование» или «Стальное сердце») сами меняют HP, Strain, скорость и навыки.</li>
<li>Ситуативные включаются переключателем на боевой карточке: «Опять ты!» против Nemesis, «Отставить болтовню», пока молчишь, и так далее. Бонус сразу попадает в броски.</li>
<li>Если триггер просит выбрать навык или спецоружие, выберите его на вкладке «Триггеры».</li>
</ul></section>
<section class="tb-m-blk"><h2>Перед вылетом</h2>
<p>Кнопка <b>«Перед вылетом: всё до максимума»</b> на боевой карточке возвращает HP и Strain до максимума, Speed 1, снимает метки, выключает ситуативные триггеры и пополняет спецоружие.</p>
</section>
<section class="tb-m-blk"><h2>После вылета</h2>
<p>AWACS подводит итоги в своей панели: каждому вылетевшему +1 вылет и +1 очко навыков, сбитые и уничтоженные цели записываются в личное дело. Сбитых система считает сама по урону с карточек атак.</p>
</section>"""
pages.append(page("Лист в Foundry", f"Памятка пилота · раздел {total} из {total}", foundry_page))

json.dump(pages, open(os.path.join(root, "data", "memo-pages.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print(len(pages), "pages:", ", ".join(p["name"] for p in pages))
