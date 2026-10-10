"""Сигналы для assets/sounds (WAV, 22 кГц, моно): захват, облучение, ракета, сваливание, малая высота,
пуск, пушка, итог миссии и тревога по приоритетной цели.
Синтез без внешних файлов, в духе тонов Ace Combat. Запуск: python3 tools/make-sounds.py"""
import math, os, random, struct, wave

SR = 22050
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "assets", "sounds")

def tone(freq, ms, amp=0.35, to=None):
    """Тон с мягким нарастанием и спадом; to — частота в конце (свип)."""
    n = int(SR * ms / 1000)
    fade = min(int(SR * 0.006), n // 4)
    out, ph = [], 0.0
    for i in range(n):
        f = freq if to is None else freq + (to - freq) * i / n
        ph += 2 * math.pi * f / SR
        v = math.sin(ph) + 0.25 * math.sin(3 * ph) + 0.1 * math.sin(5 * ph)
        env = min(1, i / fade if fade else 1, (n - i) / fade if fade else 1)
        out.append(v * amp * env / 1.35)
    return out

def gap(ms):
    return [0.0] * int(SR * ms / 1000)

def noise(ms, amp=0.5, decay=8.0, lp=0.15, seed=1, start=None):
    """Шум с экспоненциальным спадом и простым фильтром нижних частот (lp от 0 до 1: чем меньше, тем глуше)."""
    rnd = random.Random(seed)
    n = int(SR * ms / 1000)
    out, y = [], 0.0
    for i in range(n):
        k = lp if start is None else start + (lp - start) * i / n
        y += k * (rnd.uniform(-1, 1) - y)
        out.append(y * amp * math.exp(-decay * i / n) * min(1, i / 40))
    return out

def mix(*parts):
    n = max(len(p) for p in parts)
    return [sum(p[i] for p in parts if i < len(p)) for i in range(n)]

def chord(freqs, ms, amp=0.18):
    return mix(*(tone(f, ms, amp=amp) for f in freqs))

def beeps(freq, on, off, count, **kw):
    out = []
    for i in range(count):
        out += tone(freq, on, **kw) + (gap(off) if i < count - 1 else [])
    return out

SOUNDS = {
    # свой захват: три коротких тона и ровный высокий
    "lock": beeps(1100, 60, 40, 3) + gap(40) + tone(1320, 520),
    # тебя взяли на захват: редкие тревожные тоны
    "locked": beeps(880, 120, 120, 4),
    # ракета на подлёте: частый писк
    "missile": beeps(1500, 50, 40, 11, amp=0.32),
    # сваливание: трель двух тонов
    "stall": sum((tone(520 if i % 2 == 0 else 700, 80, amp=0.3) for i in range(15)), []),
    # малая высота: три нисходящих свипа, «Pull up»
    "lowAlt": sum((tone(950, 260, to=600) + gap(110) for _ in range(3)), []),
    # пуск ракеты игроком: щелчок пиропатрона и уходящий рёв двигателя
    "fire": mix(noise(60, amp=0.4, decay=10, lp=0.6, seed=2), gap(30) + noise(900, amp=1.0, decay=3.2, start=0.5, lp=0.05, seed=3)),
    # очередь из пушки: 18 коротких хлопков
    "guns": sum((noise(28, amp=2.2, decay=6, lp=0.35, seed=10 + i) + gap(14) for i in range(18)), []),
    # миссия выполнена или завершена: восходящая мажорная фанфара
    "missionWin": tone(523, 140, amp=0.25) + tone(659, 140, amp=0.25) + tone(784, 140, amp=0.25) + chord([523, 659, 784, 1047], 900),
    # миссия провалена или отменена: нисходящий минор
    "missionFail": tone(587, 260, amp=0.25) + tone(523, 260, amp=0.25) + tone(466, 260, amp=0.25) + chord([392, 466, 587], 1100, amp=0.16),
    # приоритетная цель союзников или гражданских подбита: ревун из двух тонов и резкий высокий сигнал
    "priority": sum((tone(740, 170, amp=0.34) + tone(554, 170, amp=0.34) for _ in range(3)), []) + gap(60) + beeps(1760, 70, 50, 3, amp=0.3),
}

os.makedirs(OUT, exist_ok=True)
for name, data in SOUNDS.items():
    with wave.open(os.path.join(OUT, f"{name}.wav"), "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes(b"".join(struct.pack("<h", int(max(-1, min(1, v)) * 32767)) for v in data))
    print(f"{name}.wav: {len(data) / SR:.2f} с")
