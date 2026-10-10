"""Сигналы кабины для assets/sounds (WAV, 22 кГц, моно): захват, облучение, ракета, сваливание, малая высота.
Синтез без внешних файлов, в духе тонов Ace Combat. Запуск: python3 tools/make-sounds.py"""
import math, os, struct, wave

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
}

os.makedirs(OUT, exist_ok=True)
for name, data in SOUNDS.items():
    with wave.open(os.path.join(OUT, f"{name}.wav"), "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes(b"".join(struct.pack("<h", int(max(-1, min(1, v)) * 32767)) for v in data))
    print(f"{name}.wav: {len(data) / SR:.2f} с")
