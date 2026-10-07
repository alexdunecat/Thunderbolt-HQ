"""Маска -> правая половина контура в координатах SHAPES (нос в (0,0), ось x=0, y вниз).
python3 build.py <name> <H> <vis_area> [erase.json]
Выводит out/<name>_shape.json и картинку сверки out/<name>_chk.png (обводка поверх чертежа + сетка через 20)."""
import sys, json, cv2, numpy as np

name, H, vis = sys.argv[1], float(sys.argv[2]), float(sys.argv[3])
meta = json.load(open(f"out/{name}_meta.json"))
m = np.load(f"out/{name}_mask.npy").astype(np.uint8)
g = cv2.imread(f"out/{name}_gray.png", 0)
axis, top, bot, halfw = meta["axis"], meta["top"], meta["bot"], meta["halfw"]
L = bot - top
s = min(H / L, 104 / halfw)
to_t = lambda x, y: ((x - axis) * s, (y - top) * s)
to_s = lambda X, Y: (X / s + axis, Y / s + top)

# стирание вручную: многоугольники в целевых координатах (правая половина, зеркалятся)
fx = json.load(open("fixes.json")).get(name, {})
for poly in fx.get("erase", []):
    for sign in (1, -1):
        p = np.array([to_s(sign * X, Y) for X, Y in poly], np.int32)
        cv2.fillPoly(m, [p], 0)
for poly in fx.get("add", []):
    for sign in (1, -1):
        p = np.array([to_s(sign * X, Y) for X, Y in poly], np.int32)
        cv2.fillPoly(m, [p], 1)
n, lab, st, _ = cv2.connectedComponentsWithStats(m)
m = (lab == 1 + np.argmax(st[1:, cv2.CC_STAT_AREA])).astype(np.uint8)

cs, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
c = max(cs, key=cv2.contourArea)[:, 0, :].astype(float)
# точки на оси: нос и хвост
near = np.abs(c[:, 0] - axis) <= 1.5
idx = np.nonzero(near)[0]
i_top = idx[np.argmin(c[idx, 1])]
i_bot = idx[np.argmax(c[idx, 1])]
N = len(c)
arc1 = [(i_top + k) % N for k in range((i_bot - i_top) % N + 1)]
arc2 = [(i_bot + k) % N for k in range((i_top - i_bot) % N + 1)]
arc = arc1 if c[arc1, 0].mean() > c[arc2, 0].mean() else arc2[::-1]
pts = np.array([to_t(*c[i]) for i in arc])
pts[0, 0] = 0; pts[-1, 0] = 0
pts[:, 0] = np.maximum(pts[:, 0], 0)

# Дуглас-Пекер на 0.35, затем Висвалингам: выкинуть вершины с малой площадью треугольника
dp = cv2.approxPolyDP(pts.astype(np.float32).reshape(-1, 1, 2), 0.35, False)[:, 0, :].tolist()
def tri(a, b, c):
    return abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2
P = dp[:]
while len(P) > 3:
    areas = [tri(P[i - 1], P[i], P[i + 1]) for i in range(1, len(P) - 1)]
    k = int(np.argmin(areas))
    if areas[k] >= vis: break
    del P[k + 1]
y0 = P[0][1]
P = [[round(x, 1), round(y - y0, 1)] for x, y in P]
h = round(max(y for _, y in P))
out = {"h": h, "pts": P, "scale": s, "y0": y0}
pad = 20 - y0  # чтобы сверка совпадала после сдвига носа в 0
json.dump(out, open(f"out/{name}_shape.json", "w"))

# сверка: чертёж в целевом масштабе (x4), обводка, сетка
Z = 4
W = int((2 * 110) * Z); Ht = int((h + 40) * Z)
M = np.float32([[s * Z, 0, (110 - axis * s) * Z], [0, s * Z, (pad - top * s) * Z]])
bg = cv2.warpAffine(g, M, (W, Ht), borderValue=255)
o = cv2.cvtColor(bg, cv2.COLOR_GRAY2BGR)
for v in range(0, 221, 10):
    cv2.line(o, (v * Z, 0), (v * Z, Ht), (235, 200, 160) if v % 50 else (220, 140, 60), 1)
for v in range(-20, h + 20, 10):
    yy = (v + 20) * Z
    cv2.line(o, (0, yy), (W, yy), (235, 200, 160) if v % 50 else (220, 140, 60), 1)
full = [(110 + x, y + 20) for x, y in P] + [(110 - x, y + 20) for x, y in reversed(P)]
cv2.polylines(o, [np.array([(int(x * Z), int(y * Z)) for x, y in full])], True, (0, 0, 230), 2)
for x, y in P:
    cv2.circle(o, (int((110 + x) * Z), int((y + 20) * Z)), 3, (0, 150, 0), -1)
cv2.imwrite(f"out/{name}_chk.png", o)
print(name, "pts", len(P), "h", h, "halfspan", max(x for x, _ in P), "scale", round(s, 4))
