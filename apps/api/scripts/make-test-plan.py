"""[Alex] Draws a simple listing-style floor plan (PNG + PDF) and writes its ground truth.

Unit 4B: L-shaped, 4 rooms, 46.5 m2. Plan meters: x east, y north. Output in apps/api/test/plans/:
  unit-4b.pdf / unit-4b.png   the drawing
  unit-4b.truth.json          true rooms/openings in meters, plus the same drawing read on Argon's
                              0-1000 grid (what a perfect Argon answer looks like), for grading parses.
Run: python3 apps/api/scripts/make-test-plan.py   (needs Pillow)
"""
import json, math, os
from PIL import Image, ImageDraw, ImageFont

OUT = os.path.join(os.path.dirname(__file__), '..', 'test', 'plans')
S, M = 120, 170            # pixels per meter, margin in pixels
W_M, H_M = 8.5, 6.5        # unit extent in meters
W, H = int(W_M * S + 2 * M), int(H_M * S + 2 * M + 60)
WALL = 0.14                # wall thickness in meters (drawn)

def px(x, y):              # plan meters -> image pixels (y flips: north is up)
    return (M + x * S, M + 60 + (H_M - y) * S)

def grid(x, y):            # plan meters -> Argon 0-1000 grid over the whole image
    X, Y = px(x, y)
    return [round(X / W * 1000, 1), round(Y / H * 1000, 1)]

ROOMS = [
    ('Living room', [(0, 0), (5, 0), (5, 4), (0, 4)]),
    ('Bedroom', [(5, 0), (8.5, 0), (8.5, 4), (5, 4)]),
    ('Kitchen', [(0, 4), (3, 4), (3, 6.5), (0, 6.5)]),
    ('Bathroom', [(3, 4), (5, 4), (5, 6.5), (3, 6.5)]),
]
# (kind, a, b) as the two ends of the gap in the wall
OPENINGS = [
    ('door', (1.0, 0), (1.9, 0)),        # entry, living south wall
    ('door', (5, 1.0), (5, 1.9)),        # living <-> bedroom
    ('door', (1.0, 4), (1.9, 4)),        # living <-> kitchen
    ('door', (3.6, 4), (4.4, 4)),        # living <-> bathroom
    ('window', (3.0, 0), (4.5, 0)),      # living south
    ('window', (6.0, 0), (7.5, 0)),      # bedroom south
    ('window', (8.5, 1.0), (8.5, 2.6)),  # bedroom east
    ('window', (0, 4.8), (0, 5.8)),      # kitchen west
]
DIMS = [('5.00 m', (0, 0), (5, 0), 'below'), ('3.50 m', (5, 0), (8.5, 0), 'below'), ('4.00 m', (8.5, 0), (8.5, 4), 'right'),
        ('2.50 m', (0, 4), (0, 6.5), 'left'), ('3.00 m', (0, 6.5), (3, 6.5), 'above'), ('2.00 m', (3, 6.5), (5, 6.5), 'above')]
FIXTURES = [('Kitchen', 'stove'), ('Kitchen', 'sink'), ('Bathroom', 'toilet'), ('Bathroom', 'tub'), ('Bedroom', 'closet')]

img = Image.new('RGB', (W, H), 'white')
d = ImageDraw.Draw(img)
def font(size):
    for f in ['/System/Library/Fonts/Helvetica.ttc', '/System/Library/Fonts/Supplemental/Arial.ttf']:
        if os.path.exists(f):
            return ImageFont.truetype(f, size)
    return ImageFont.load_default()
F, FS, FT = font(30), font(24), font(40)

# walls: every room edge, thick black
for _, poly in ROOMS:
    for i in range(len(poly)):
        a, b = poly[i], poly[(i + 1) % len(poly)]
        d.line([px(*a), px(*b)], fill='black', width=int(WALL * S))
# openings: clear the gap, then door swing or window lines
for kind, a, b in OPENINGS:
    d.line([px(*a), px(*b)], fill='white', width=int(WALL * S) + 2)
    (ax, ay), (bx, by) = px(*a), px(*b)
    if kind == 'window':
        off = WALL * S / 3
        if ay == by:
            for o in (-off, 0, off): d.line([(ax, ay + o), (bx, by + o)], fill='black', width=2)
        else:
            for o in (-off, 0, off): d.line([(ax + o, ay), (bx + o, by)], fill='black', width=2)
    else:
        r = math.hypot(bx - ax, by - ay)
        d.arc([ax - r, ay - r, ax + r, ay + r], 0, 360, fill='#bbbbbb', width=1) if False else None
        # leaf + quarter swing into the room above/right of the wall
        if ay == by:
            d.line([(ax, ay), (ax, ay - r)], fill='black', width=3)
            d.arc([ax - r, ay - r, ax + r, ay + r], 270, 360, fill='black', width=2)
        else:
            d.line([(ax, ay), (ax - r, ay)], fill='black', width=3)
            d.arc([ax - r, ay - r, ax + r, ay + r], 180, 270, fill='black', width=2)
# room names and areas
for name, poly in ROOMS:
    xs, ys = [p[0] for p in poly], [p[1] for p in poly]
    area = (max(xs) - min(xs)) * (max(ys) - min(ys))
    cx, cy = px(sum(xs) / 4, sum(ys) / 4)
    d.text((cx, cy - 16), name.upper(), font=F, fill='black', anchor='mm')
    d.text((cx, cy + 20), f'{area:.1f} m²', font=FS, fill='#444444', anchor='mm')
# dimension lines with ticks
for text, a, b, side in DIMS:
    o = 0.55
    (ax, ay), (bx, by) = px(*a), px(*b)
    dx, dy = {'below': (0, o * S), 'above': (0, -o * S), 'left': (-o * S, 0), 'right': (o * S, 0)}[side]
    p1, p2 = (ax + dx, ay + dy), (bx + dx, by + dy)
    d.line([p1, p2], fill='#555555', width=2)
    for p in (p1, p2):
        d.line([(p[0] - 8, p[1] - 8), (p[0] + 8, p[1] + 8)], fill='#555555', width=2)
    mx, my = (p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2
    if side in ('left', 'right'):
        t = Image.new('RGBA', (160, 40), (255, 255, 255, 0)); ImageDraw.Draw(t).text((80, 20), text, font=FS, fill='#333333', anchor='mm')
        t = t.rotate(90, expand=True); img.paste(t, (int(mx - 20 + (18 if side == 'right' else -18)), int(my - 80)), t)
    else:
        d.text((mx, my + (22 if side == 'below' else -22)), text, font=FS, fill='#333333', anchor='mm')
# north arrow, title
nx, ny = W - 110, 120
d.polygon([(nx, ny - 50), (nx - 18, ny + 10), (nx + 18, ny + 10)], fill='black'); d.text((nx, ny + 38), 'N', font=F, fill='black', anchor='mm')
d.text((M, 60), 'UNIT 4B  ·  2 rooms + kitchen + bath  ·  46.5 m²', font=FT, fill='black', anchor='lm')
d.text((M, H - 40), 'Simple test plan drawn by LEDGER for parser checks. Not to scale for construction.', font=FS, fill='#777777', anchor='lm')

os.makedirs(OUT, exist_ok=True)
img.save(os.path.join(OUT, 'unit-4b.png'))
img.save(os.path.join(OUT, 'unit-4b.pdf'), resolution=200)

truth = {
    'unitId': 'unit-4b', 'imageSize': [W, H], 'totalAreaM2': 46.5, 'ceilingHeightM': None,
    'rooms': [{'name': n, 'polygon': [list(p) for p in poly], 'areaM2': (max(p[0] for p in poly) - min(p[0] for p in poly)) * (max(p[1] for p in poly) - min(p[1] for p in poly))} for n, poly in ROOMS],
    'openings': [{'kind': k, 'a': list(a), 'b': list(b), 'widthM': round(math.dist(a, b), 2)} for k, a, b in OPENINGS],
    # What a perfect Argon reading of this image looks like (0-1000 grid, y down). Used when no API key is set.
    'argon': {
        'rooms': [{'name': n, 'polygon': [grid(*p) for p in poly]} for n, poly in ROOMS],
        'openings': [{'kind': k, 'a': grid(*a), 'b': grid(*b)} for k, a, b in OPENINGS],
        'dimensionLabels': [{'text': t, 'meters': float(t.split()[0]), 'a': grid(*a), 'b': grid(*b)} for t, a, b, _ in DIMS],
        'fixtures': [],  # none are drawn on the plan, so a correct reading has none (Argon agreed, live)
        'printedTotalAreaM2': 46.5,
        'northArrowDeg': 0,
    },
}
with open(os.path.join(OUT, 'unit-4b.truth.json'), 'w') as f:
    json.dump(truth, f, indent=1)
print('wrote', W, 'x', H, 'to', os.path.abspath(OUT))
