"""Обвести силуэт самолёта по чертежу сверху: маска -> симметрия -> правая половина -> полилиния.
python3 trace.py <name> <rot> <half> [thr] [close] [open]
rot: поворот, чтобы нос смотрел вверх (left|right|up|down); half: какую половину брать (l|r) после поворота."""
import sys, json, cv2, numpy as np

name, rot, half = sys.argv[1], sys.argv[2], sys.argv[3]
thr = int(sys.argv[4]) if len(sys.argv) > 4 else 140
close = int(sys.argv[5]) if len(sys.argv) > 5 else 3
opn = int(sys.argv[6]) if len(sys.argv) > 6 else 3
D = sys.argv[7] if len(sys.argv) > 7 else "."

im = cv2.imread(f"{D}/ref/{name}.png", cv2.IMREAD_UNCHANGED)
if im.ndim == 3 and im.shape[2] == 4:
    a = im[:, :, 3:4] / 255.0
    im = (im[:, :, :3] * a + 255 * (1 - a)).astype(np.uint8)
g = cv2.cvtColor(im, cv2.COLOR_BGR2GRAY) if im.ndim == 3 else im
g = {"left": cv2.rotate(g, cv2.ROTATE_90_CLOCKWISE), "right": cv2.rotate(g, cv2.ROTATE_90_COUNTERCLOCKWISE),
     "up": g, "down": cv2.rotate(g, cv2.ROTATE_180)}[rot]
g = cv2.copyMakeBorder(g, 10, 10, 10, 10, cv2.BORDER_CONSTANT, value=255)
lines = (g < thr).astype(np.uint8) * 255
k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * close + 1, 2 * close + 1))
lines_d = cv2.dilate(lines, k)
ff = lines_d.copy()
mask = np.zeros((ff.shape[0] + 2, ff.shape[1] + 2), np.uint8)
cv2.floodFill(ff, mask, (0, 0), 128)
inside = (ff != 128).astype(np.uint8) * 255
inside = cv2.erode(inside, k)  # вернуть толщину после расширения линий
if opn:
    ko = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * opn + 1, 2 * opn + 1))
    opened = cv2.morphologyEx(inside, cv2.MORPH_OPEN, ko)
    # вернуть мелкие обрезки углов, убрать вытянутые выступы (пилоны, ракеты, штанги)
    res = cv2.subtract(inside, opened)
    nr, lr, sr, _ = cv2.connectedComponentsWithStats(res)
    keep = np.zeros_like(res)
    for i in range(1, nr):
        if sr[i, cv2.CC_STAT_AREA] < opn * opn * 3:
            keep[lr == i] = 255
    inside = cv2.bitwise_or(opened, keep)
n, lab, stats, cent = cv2.connectedComponentsWithStats(inside)
big = 1 + np.argmax(stats[1:, cv2.CC_STAT_AREA])
body = (lab == big).astype(np.uint8)

# ось симметрии: столбец, при котором маска лучше всего совпадает со своим зеркалом
ys, xs = np.nonzero(body)
x0, x1 = xs.min(), xs.max()
best = None
for c2 in range(2 * x0 + (x1 - x0) // 2, 2 * x1 - (x1 - x0) // 2):  # c2 = 2*ось
    c = c2 / 2
    # зеркальное отображение по оси c
    xi = np.arange(body.shape[1])
    src = np.round(c2 - xi).astype(int)
    ok = (src >= 0) & (src < body.shape[1])
    m = np.zeros_like(body)
    m[:, ok] = body[:, src[ok]]
    s = (m & body).sum() / max(1, (m | body).sum())
    if best is None or s > best[0]:
        best = (s, c2)
score, c2 = best
axis = c2 / 2
xi = np.arange(body.shape[1])
src = np.round(c2 - xi).astype(int)
ok = (src >= 0) & (src < body.shape[1])
mir = np.zeros_like(body); mir[:, ok] = body[:, src[ok]]
# взять выбранную половину и отразить
sym = np.zeros_like(body)
if half == "r":
    sym[:, xi >= axis] = body[:, xi >= axis]; sym[:, xi < axis] = mir[:, xi < axis]
else:
    sym[:, xi <= axis] = body[:, xi <= axis]; sym[:, xi > axis] = mir[:, xi > axis]
ys, xs = np.nonzero(sym)
top, bot = ys.min(), ys.max()
halfw = max(xs.max() - axis, axis - xs.min())
L = bot - top
np.save(f"{D}/out/{name}_mask.npy", sym)
cv2.imwrite(f"{D}/out/{name}_mask.png", sym * 255)
cv2.imwrite(f"{D}/out/{name}_gray.png", g)
json.dump({"axis": axis, "top": int(top), "bot": int(bot), "halfw": float(halfw), "score": float(score)}, open(f"{D}/out/{name}_meta.json", "w"))
print(name, "symmetry", round(score, 3), "axis", axis, "len", L, "halfspan", halfw, "ratio", round(halfw / L, 3))
