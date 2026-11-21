"""[Alex] Draws listing-style test floor plans (PDF + PNG) and writes their ground truth.

Each plan in PLANS -> apps/api/test/plans/<id>.{pdf,png,truth.json}. The truth file has the true rooms and
openings in meters and a perfect Argon reading on the 0-1000 image grid (what --truth feeds the parser).
Plan meters: x east, y north. Run: python3 apps/api/scripts/make-test-plan.py   (needs Pillow)
"""
import json, math, os, random
from PIL import Image, ImageDraw, ImageFilter, ImageFont

OUT = os.path.join(os.path.dirname(__file__), '..', 'test', 'plans')
FT = 0.3048


def rect(x, y, w, h):
    return [(x, y), (x + w, y), (x + w, y + h), (x, y + h)]


def area(poly):
    return abs(sum(poly[i][0] * poly[(i + 1) % len(poly)][1] - poly[(i + 1) % len(poly)][0] * poly[i][1] for i in range(len(poly)))) / 2


def feet(m):
    total = round(m / FT * 12)
    return f"{total // 12}' {total % 12}\""


PLANS = [
    {
        'id': 'unit-4b', 'title': 'UNIT 4B  ·  2 rooms + kitchen + bath  ·  46.5 m²',
        'rooms': [('Living room', rect(0, 0, 5, 4)), ('Bedroom', rect(5, 0, 3.5, 4)), ('Kitchen', rect(0, 4, 3, 2.5)), ('Bathroom', rect(3, 4, 2, 2.5))],
        'openings': [('door', (1.0, 0), (1.9, 0)), ('door', (5, 1.0), (5, 1.9)), ('door', (1.0, 4), (1.9, 4)), ('door', (3.6, 4), (4.4, 4)),
                     ('window', (3.0, 0), (4.5, 0)), ('window', (6.0, 0), (7.5, 0)), ('window', (8.5, 1.0), (8.5, 2.6)), ('window', (0, 4.8), (0, 5.8))],
        'dims': [((0, 0), (5, 0), 'below'), ((5, 0), (8.5, 0), 'below'), ((8.5, 0), (8.5, 4), 'right'), ((0, 4), (0, 6.5), 'left'), ((0, 6.5), (3, 6.5), 'above'), ((3, 6.5), (5, 6.5), 'above')],
        'units': 'm',
    },
    {
        # US-style listing: feet and inches, studio with a bath and a walk-in closet.
        'id': 'studio-ft', 'title': 'STUDIO 2R  ·  approx. 432 sq ft',
        'rooms': [('Studio', rect(0, 0, 16 * FT, 18 * FT)), ('Bath', rect(16 * FT, 0, 8 * FT, 9 * FT)), ('Closet', rect(16 * FT, 9 * FT, 8 * FT, 9 * FT))],
        'openings': [('door', (3 * FT, 0), (6 * FT, 0)), ('door', (16 * FT, 3 * FT), (16 * FT, 5.5 * FT)), ('door', (16 * FT, 12 * FT), (16 * FT, 14.5 * FT)),
                     ('window', (0, 6 * FT), (0, 12 * FT)), ('window', (5 * FT, 18 * FT), (11 * FT, 18 * FT))],
        'dims': [((0, 0), (16 * FT, 0), 'below'), ((16 * FT, 0), (24 * FT, 0), 'below'), ((0, 0), (0, 18 * FT), 'left'), ((24 * FT, 0), (24 * FT, 9 * FT), 'right'), ((24 * FT, 9 * FT), (24 * FT, 18 * FT), 'right')],
        'units': 'ft',
    },
    {
        # Two bedrooms off a hallway: many doors on shared walls.
        'id': 'two-bed-hall', 'title': 'APT 12  ·  2 bed / 1 bath  ·  73.5 m²',
        'rooms': [('Living room', rect(0, 0, 5, 4.5)), ('Kitchen', rect(0, 4.5, 3, 3)), ('Hall', rect(5, 0, 1.2, 7.5)), ('Bedroom 1', rect(6.2, 0, 3.6, 3.5)),
                  ('Bedroom 2', rect(6.2, 3.5, 3.6, 4)), ('Bath', rect(3, 4.5, 2, 3))],
        'openings': [('door', (5, 0.6), (5, 1.5)), ('door', (6.2, 1.0), (6.2, 1.9)), ('door', (6.2, 5.0), (6.2, 5.9)), ('door', (5, 5.6), (5, 6.4)),
                     ('door', (1.0, 4.5), (2.0, 4.5)), ('door', (5.2, 0), (6.0, 0)),
                     ('window', (1.5, 0), (3.5, 0)), ('window', (9.8, 1.0), (9.8, 2.5)), ('window', (9.8, 4.5), (9.8, 6.5)), ('window', (0, 5.3), (0, 6.6))],
        'dims': [((0, 0), (5, 0), 'below'), ((5, 0), (6.2, 0), 'below'), ((6.2, 0), (9.8, 0), 'below'), ((9.8, 0), (9.8, 3.5), 'right'), ((9.8, 3.5), (9.8, 7.5), 'right'), ((0, 0), (0, 4.5), 'left'), ((0, 4.5), (0, 7.5), 'left')],
        'units': 'm',
    },
    {
        # A non-rectangular L-shaped living room wrapping a bedroom.
        'id': 'l-living', 'title': 'LOFT B  ·  1 bed  ·  48 m²',
        'rooms': [('Living room', [(0, 0), (7, 0), (7, 3), (3.5, 3), (3.5, 6), (0, 6)]), ('Bedroom', [(3.5, 3), (7, 3), (7, 6), (3.5, 6)]), ('Bath', rect(7, 3, 2, 3))],
        'openings': [('door', (2.0, 0), (2.9, 0)), ('door', (4.5, 3), (5.4, 3)), ('door', (7, 3.6), (7, 4.4)),
                     ('window', (4.5, 0), (6.5, 0)), ('window', (0, 2.0), (0, 4.0)), ('window', (4.3, 6), (6.3, 6))],
        'dims': [((0, 0), (7, 0), 'below'), ((0, 0), (0, 6), 'left'), ((0, 6), (3.5, 6), 'above'), ((3.5, 6), (7, 6), 'above'), ((7, 6), (9, 6), 'above'), ((9, 3), (9, 6), 'right')],
        'units': 'm',
    },
]
# Messy input: the two-bed plan, printed, scanned crooked, low quality.
# The conference room we filmed (video/IMG_0022.MOV move-in, IMG_0023.MOV move-out). Sizes are estimated from the
# video (12-seat table plus chairs and walkway), not measured: the title and footer say so.
PLANS.append({
    'id': 'conference-room', 'title': 'CONFERENCE ROOM  ·  approx. 33 m²', 'label_at': (3.0, 1.35),
    'rooms': [('Conference room', rect(0, 0, 4.6, 7.2))],
    'openings': [('door', (1.2, 0), (2.2, 0)),                              # glass door to the hallway (south)
                 ('window', (0.6, 7.2), (1.9, 7.2)), ('window', (2.7, 7.2), (4.0, 7.2))],  # two windows (north)
    'dims': [((0, 0), (4.6, 0), 'below'), ((0, 0), (0, 7.2), 'left')],
    'units': 'm',
    # Furniture and landmarks, drawn thin (not walls): what the camera sees on each wall.
    'extras': [
        ('box', (0.5, 6.7), (4.1, 7.1), 'CABINET'),                     # wood credenza under the windows
        ('table', (1.55, 1.9), (3.05, 5.7), 'TABLE'),                   # 12-seat conference table
        ('column', (0.0, 0.7), (0.45, 1.25), ''),                       # concrete column, west wall by the door
        ('art', (4.6, 3.1), (4.6, 4.3), 'PORTRAIT'),                    # framed portrait, east wall
        ('note', (0.6, 1.0), 'column'),
        ('note', (1.55, 6.4), 'two windows + dark curtains'),
        ('note', (1.7, 0.45), 'glass door'),
    ],
    'footer': 'Drawn by LEDGER from the walkthrough video. Sizes are estimates.',
})
PLANS.append({**PLANS[2], 'id': 'scan-2b', 'title': 'APT 12  ·  2 bed / 1 bath  ·  73.5 m²  (scan)', 'scan': True})


def font(size):
    for f in ['/System/Library/Fonts/Helvetica.ttc', '/System/Library/Fonts/Supplemental/Arial.ttf']:
        if os.path.exists(f):
            return ImageFont.truetype(f, size)
    return ImageFont.load_default()


def draw(plan):
    xs = [p[0] for _, poly in plan['rooms'] for p in poly]
    ys = [p[1] for _, poly in plan['rooms'] for p in poly]
    w_m, h_m = max(xs) - min(xs), max(ys) - min(ys)
    S = min(1100 / w_m, 850 / h_m)  # px per meter
    M = 170
    W, H = max(int(w_m * S + 2 * M), 1300), int(h_m * S + 2 * M + 60)
    MX = (W - w_m * S) / 2  # center narrow plans on the page
    x0, y0 = min(xs), min(ys)
    wall = int(0.14 * S)
    px = lambda x, y: (MX + (x - x0) * S, M + 60 + (h_m - (y - y0)) * S)
    grid = lambda x, y: [round(px(x, y)[0] / W * 1000, 1), round(px(x, y)[1] / H * 1000, 1)]

    img = Image.new('RGB', (W, H), 'white')
    d = ImageDraw.Draw(img)
    F, FS, FT_ = font(30), font(24), font(38)
    for _, poly in plan['rooms']:
        for i in range(len(poly)):
            d.line([px(*poly[i]), px(*poly[(i + 1) % len(poly)])], fill='black', width=wall)
    for _, poly in plan['rooms']:  # square off corners
        for x, y in poly:
            X, Y = px(x, y)
            d.rectangle([X - wall / 2, Y - wall / 2, X + wall / 2, Y + wall / 2], fill='black')
    for kind, a, b in plan['openings']:
        (ax, ay), (bx, by) = px(*a), px(*b)
        d.line([(ax, ay), (bx, by)], fill='white', width=wall + 2)
        if kind == 'window':
            off = wall / 3
            for o in (-off, 0, off):
                d.line([(ax, ay + o), (bx, by + o)] if ay == by else [(ax + o, ay), (bx + o, by)], fill='black', width=2)
        else:
            r = math.hypot(bx - ax, by - ay)
            if ay == by:
                d.line([(ax, ay), (ax, ay - r)], fill='black', width=3)
                d.arc([ax - r, ay - r, ax + r, ay + r], 270, 360, fill='black', width=2)
            else:
                d.line([(ax, ay), (ax - r, ay)], fill='black', width=3)
                d.arc([ax - r, ay - r, ax + r, ay + r], 180, 270, fill='black', width=2)
    for name, poly in plan['rooms']:
        # label at the middle of the largest axis-aligned piece (works for the L shape)
        cx = sum(p[0] for p in poly) / len(poly)
        cy = sum(p[1] for p in poly) / len(poly)
        if len(poly) > 4:  # the L-shaped room: put the label in its lower-left arm
            cx, cy = 1.75, 1.5
        if plan.get('label_at'):  # furniture in the middle: put the label where the floor is free
            cx, cy = plan['label_at']
        X, Y = px(cx, cy)
        a = area(poly)
        sub = f'{a / FT / FT:.0f} sq ft' if plan['units'] == 'ft' else f'{a:.1f} m²'
        d.text((X, Y - 16), name.upper(), font=F, fill='black', anchor='mm')
        d.text((X, Y + 20), sub, font=FS, fill='#444444', anchor='mm')
    labels = []
    for a, b, side in plan['dims']:
        meters = math.dist(a, b)
        text = feet(meters) if plan['units'] == 'ft' else f'{meters:.2f} m'
        labels.append((text, meters, a, b))
        o = 0.55
        (ax, ay), (bx, by) = px(*a), px(*b)
        dx, dy = {'below': (0, o * S), 'above': (0, -o * S), 'left': (-o * S, 0), 'right': (o * S, 0)}[side]
        p1, p2 = (ax + dx, ay + dy), (bx + dx, by + dy)
        d.line([p1, p2], fill='#555555', width=2)
        for p in (p1, p2):
            d.line([(p[0] - 8, p[1] - 8), (p[0] + 8, p[1] + 8)], fill='#555555', width=2)
        mx, my = (p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2
        if side in ('left', 'right'):
            t = Image.new('RGBA', (180, 40), (255, 255, 255, 0))
            ImageDraw.Draw(t).text((90, 20), text, font=FS, fill='#333333', anchor='mm')
            t = t.rotate(90, expand=True)
            img.paste(t, (int(mx - 20 + (18 if side == 'right' else -18)), int(my - 90)), t)
        else:
            d.text((mx, my + (22 if side == 'below' else -22)), text, font=FS, fill='#333333', anchor='mm')
    for ex in plan.get('extras', []):
        kind = ex[0]
        if kind in ('box', 'table'):
            (ex0, ey0), (ex1, ey1), lab = ex[1], ex[2], ex[3]
            a, b = px(ex0, ey1), px(ex1, ey0)
            if kind == 'table':
                d.rounded_rectangle([a, b], radius=int(0.25 * S), outline='#555555', width=2)
                for k in range(6):  # chairs along both long sides
                    cy = ey0 + (ey1 - ey0) * (k + 0.5) / 6
                    for cx in (ex0 - 0.35, ex1 + 0.35):
                        c = px(cx, cy)
                        r = 0.2 * S
                        d.rounded_rectangle([c[0] - r, c[1] - r, c[0] + r, c[1] + r], radius=6, outline='#999999', width=1)
            else:
                d.rectangle([a, b], outline='#555555', width=2)
            if lab:
                d.text(((a[0] + b[0]) / 2, (a[1] + b[1]) / 2), lab, font=FS, fill='#777777', anchor='mm')
        elif kind == 'column':
            (ex0, ey0), (ex1, ey1) = ex[1], ex[2]
            a, b = px(ex0, ey1), px(ex1, ey0)
            d.rectangle([a, b], fill='#3a3a3a')
        elif kind == 'art':
            (ex0, ey0), (ex1, ey1), lab = ex[1], ex[2], ex[3]
            a, b = px(ex0, ey0), px(ex1, ey1)
            d.line([(a[0] - wall, a[1]), (b[0] - wall, b[1])], fill='#a47b3f', width=8)  # inner face of the wall
            t = Image.new('RGBA', (220, 40), (255, 255, 255, 0))
            ImageDraw.Draw(t).text((110, 20), lab, font=FS, fill='#a47b3f', anchor='mm')
            t = t.rotate(90, expand=True)
            img.paste(t, (int(a[0] - wall - 50), int((a[1] + b[1]) / 2 - 110)), t)
        elif kind == 'note':
            (x, y), lab = ex[1], ex[2]
            d.text(px(x, y), lab, font=font(20), fill='#999999', anchor='lm')

    nx, ny = W - 110, 120
    d.polygon([(nx, ny - 50), (nx - 18, ny + 10), (nx + 18, ny + 10)], fill='black')
    d.text((nx, ny + 38), 'N', font=F, fill='black', anchor='mm')
    d.text((M, 60), plan['title'], font=FT_, fill='black', anchor='lm')
    d.text((M, H - 40), plan.get('footer', 'Test plan drawn by LEDGER for parser checks.'), font=FS, fill='#777777', anchor='lm')

    if plan.get('scan'):
        # The truth grid stays valid for small rotations about the center only approximately, so we rotate the
        # truth points too (see below) and keep the canvas size.
        random.seed(7)
        img = img.rotate(-1.5, resample=Image.BICUBIC, fillcolor='white')
        paper = Image.new('RGB', img.size, (236, 233, 224))
        img = Image.blend(img, paper, 0.18)
        noise = Image.effect_noise(img.size, 22).convert('RGB')
        img = Image.blend(img, noise, 0.10).filter(ImageFilter.GaussianBlur(1.1))
        ang = math.radians(1.5)  # PIL rotates counter-clockwise for positive angles; we used -1.5 => clockwise
        cx, cy = W / 2, H / 2

        def grid(x, y, _px=px):
            X, Y = _px(x, y)
            dx, dy = X - cx, Y - cy
            Xr = cx + dx * math.cos(ang) - dy * math.sin(ang)
            Yr = cy + dx * math.sin(ang) + dy * math.cos(ang)
            return [round(Xr / W * 1000, 1), round(Yr / H * 1000, 1)]

    os.makedirs(OUT, exist_ok=True)
    base = os.path.join(OUT, plan['id'])
    if plan.get('scan'):
        img.save(base + '.png')
        small = img.resize((W * 2 // 3, H * 2 // 3))
        small.save(base + '.jpg', quality=55)
        Image.open(base + '.jpg').save(base + '.pdf', resolution=133)
    else:
        img.save(base + '.png')
        img.save(base + '.pdf', resolution=200)

    total = sum(area(p) for _, p in plan['rooms'])
    truth = {
        'unitId': plan['id'], 'imageSize': [W, H], 'totalAreaM2': round(total, 2), 'units': plan['units'],
        'rooms': [{'name': n, 'polygon': [list(p) for p in poly], 'areaM2': round(area(poly), 3)} for n, poly in plan['rooms']],
        'openings': [{'kind': k, 'a': list(a), 'b': list(b), 'widthM': round(math.dist(a, b), 3)} for k, a, b in plan['openings']],
        'argon': {
            'rooms': [{'name': n, 'polygon': [grid(*p) for p in poly]} for n, poly in plan['rooms']],
            'openings': [{'kind': k, 'a': grid(*a), 'b': grid(*b)} for k, a, b in plan['openings']],
            'dimensionLabels': [{'text': t, 'meters': round(m, 4), 'a': grid(*a), 'b': grid(*b)} for t, m, a, b in labels],
            'fixtures': [],  # none are drawn
            'printedTotalAreaM2': None,
            'northArrowDeg': 0,
        },
    }
    with open(base + '.truth.json', 'w') as f:
        json.dump(truth, f, indent=1)
    print(f"{plan['id']:14} {W}x{H}  {len(plan['rooms'])} rooms  {len(plan['openings'])} openings  {total:.1f} m²")


import sys
wanted = set(sys.argv[1:])
for p in PLANS:
    if not wanted or p['id'] in wanted:
        draw(p)
