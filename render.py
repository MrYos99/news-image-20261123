# news-image-20261123 v11 — "The World in One Day", footer + DATE CHECK +
# colour (John's orders 22:09–22:16 WIB, approved to build 22:23 WIB).
#
# v11 keeps the v7 top-1 pattern (render outside the harness with PIL and a
# REAL serif font; main.ts only copies entry.png) and the v7 big art (lead
# art 120px / card 235px, grid art 55px / card 116px, banner + place labels
# inside the art), plus the v8 typography (headlines Title Case, sublines ALL
# CAPS, badges coloured per type, sources Title Case) and the v9/v10 DATE
# CHECK (title just "DATE CHECK", 6 short items). What changes in v11:
# (1) footer becomes 3 segments on 2 lines — left "Every story happened...",
# centre legend, right "Sources: ..." (one line is impossible at readable
# size: the three segments measure 1,675px at 15px vs 948px width);
# (2) DATE CHECK items become a tidy 2-column x 3-row grid (v10's 3 run-on
# rows overflowed ~3px past the box); (3) legend descriptors lowercase
# ("CONFIRMED 2+ outlets ..."), only badge words caps; (4) footer sits 5px
# below the DATE CHECK red border (v10's legend was ~3px below it);
# (5) legend badge words coloured (CONFIRMED green, OFFICIAL blue, REPORTED
# amber, same as the card badges); (6) top kicker RED; (7) scenes get
# colourful backgrounds (Seoul chart proper, kangaroo in Australia, green
# pitch + goal + ball for the football draw). The stored story data is NOT
# changed — casing/colour is applied at render time only. Content is the
# v4/v5/v6/v7 23 Nov set, unchanged: 13 illustrated cards, 20 ALSO, 6 KPIs,
# UTC timeline, 7-region bar, world map with 13 numbered pins, DATE CHECK.
# No new research, no changed numbers.
#
# Deterministic: fixed LCG seed 1337 for the map grain, no randomness, no
# network, no time dependence. Run: python3 render.py [outdir]

import re
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

W, H = 1024, 1024
MARGIN = 38
CW = W - MARGIN * 2  # 948

# ---------------------------------------------------------------- colours
def hx(h: str) -> tuple:
    return (int(h[1:3], 16), int(h[3:5], 16), int(h[5:7], 16))

PAPER = (244, 239, 230)
PAPER2 = (250, 247, 242)
INK = (20, 20, 20)
INK2 = (58, 58, 58)
MUTED = (90, 84, 74)
RULE = (31, 31, 31)
CARD = (255, 255, 255)
CARD_LINE = (190, 182, 168)
LAND = (196, 178, 140)
LAND2 = (214, 198, 164)
SEA = (226, 232, 236)
RED = (192, 57, 43)
WHITE = (255, 255, 255)
SKY = (214, 228, 238)
GOLD = (232, 160, 32)
GRAT = (203, 211, 217)

# Badge colours by type (v8): one consistent colour per badge word, instead of
# the card's accent colour. CONFIRMED green, OFFICIAL blue, REPORTED amber.
BADGE_COLORS = {"CONFIRMED": hx("#1B7A2E"), "OFFICIAL": hx("#1565C0"),
                "REPORTED": hx("#B45309")}

# ---------------------------------------------------------------- fonts
# Liberation Serif is metric-compatible with Times New Roman — the closest
# real serif on this machine to the reference's type.
SERIF = "/usr/share/fonts/truetype/liberation/LiberationSerif-Regular.ttf"
SERIF_BOLD = "/usr/share/fonts/truetype/liberation/LiberationSerif-Bold.ttf"
SERIF_ITALIC = "/usr/share/fonts/truetype/liberation/LiberationSerif-Italic.ttf"

_fonts: dict = {}

def font(path: str, size: int):
    key = (path, size)
    if key not in _fonts:
        _fonts[key] = ImageFont.truetype(path, size)
    return _fonts[key]

def fb(size: int):
    return font(SERIF_BOLD, size)

def fr(size: int):
    return font(SERIF, size)

def tw(s: str, f) -> float:
    """Advance width of s in px at font f."""
    return f.getlength(s)

def fit(s: str, path: str, start: int, target: float) -> int:
    """Largest font size <= start whose textlength(s) <= target."""
    size = start
    while size > 8 and font(path, size).getlength(s) > target:
        size -= 1
    return size

# ---------------------------------------------------------------- text
def text(d: ImageDraw.ImageDraw, x: float, y: float, s: str, f, fill) -> float:
    """Left-aligned text, y = cap top. Returns width drawn."""
    d.text((x, y), s, font=f, fill=fill, anchor="lt")
    return f.getlength(s)

def text_c(d: ImageDraw.ImageDraw, cx: float, y: float, s: str, f, fill) -> None:
    d.text((cx - f.getlength(s) / 2, y), s, font=f, fill=fill, anchor="lt")

def text_r(d: ImageDraw.ImageDraw, xr: float, y: float, s: str, f, fill) -> None:
    d.text((xr - f.getlength(s), y), s, font=f, fill=fill, anchor="lt")

def wrap(s: str, f, max_w: float) -> list:
    """Greedy word wrap to max_w px. Splits overlong words."""
    words = [w for w in s.split(" ") if w]
    lines: list = []
    cur = ""
    for word in words:
        trial = word if not cur else cur + " " + word
        if f.getlength(trial) <= max_w:
            cur = trial
            continue
        if cur:
            lines.append(cur)
        rest = word
        while f.getlength(rest) > max_w:
            cut = len(rest)
            while cut > 1 and f.getlength(rest[:cut]) > max_w:
                cut -= 1
            lines.append(rest[:cut])
            rest = rest[cut:]
        cur = rest
    if cur:
        lines.append(cur)
    return lines if lines else [""]

# ---------------------------------------------------------------- casing (v8)
# John's rule (21:55 WIB): too many capitals. News headlines are Title Case,
# never all-caps; the subline under a headline is ALL CAPS; only the badge
# word (CONFIRMED / OFFICIAL / REPORTED) stays all-caps and the source after
# the "|" is Title Case. Everything else keeps its current casing. The stored
# story data is NOT changed — casing is applied at render time only.
SMALL_WORDS = {"a", "an", "the", "of", "and", "or", "but", "for", "nor", "on",
               "at", "to", "in", "off", "by", "vs", "via", "with", "as", "from",
               "into", "over", "per", "up", "out", "than", "is", "are", "was",
               "were", "it", "its"}
ACRONYMS = {"AP", "BBC", "CNA", "AA", "SMH", "EU", "US", "UK", "NATO", "PMI",
            "AI", "PM", "DR", "VP", "COP31", "UTD", "UN", "ICC", "FBI"}
# Words that stay capitalised in sentence case: acronyms, roman numerals,
# month/day abbreviations, and the proper nouns appearing in the DATE CHECK
# items (places, names, parties).
SENTENCE_KEEP = ACRONYMS | {"II", "III", "IV", "Nov", "Sat", "Sun", "Mon", "Tue",
                            "Wed", "Thu", "Fri", "Bahrain", "Liverpool", "Texas",
                            "Sparta", "Man", "Utd", "Democrats", "Iran", "Gaza",
                            "Kyiv"}

def _cap_core(core: str, first: bool) -> str:
    """Capitalise one alphabetic core (letters, maybe an apostrophe-s)."""
    if not any(c.isalpha() for c in core):
        return core
    up = core.upper()
    if up in ACRONYMS:
        return up
    if re.fullmatch(r"[IVXLC]+", up) and len(up) <= 4:
        return up
    if any(c.isdigit() for c in core):
        return core.capitalize()
    if not first and core.lower() in SMALL_WORDS:
        return core.lower()
    return core.capitalize()

def _title_segment(seg: str, first: bool) -> str:
    """Title-case one hyphen-separated segment, keeping its punctuation."""
    m = re.match(r"^([^A-Za-z0-9]*)([A-Za-z0-9][A-Za-z0-9']*)(.*)$", seg)
    if not m:
        return seg
    lead, core, trail = m.groups()
    return lead + _cap_core(core, first) + trail

def title_case(s: str) -> str:
    """Title Case: major words capitalised, small words lowercase unless
    first/last or after a colon. Acronyms and roman numerals stay caps."""
    tokens = s.split(" ")
    out = []
    for i, tok in enumerate(tokens):
        first = (i == 0) or (i == len(tokens) - 1) or out[-1].endswith(":")
        parts = tok.split("-")
        out.append("-".join(_title_segment(p, first and j == 0)
                            for j, p in enumerate(parts)))
    return " ".join(out)

def sentence_case(s: str) -> str:
    """Sentence case: first word capitalised, the rest lowercase except
    acronyms, roman numerals, month/day abbreviations and proper nouns."""
    words = title_case(s).split(" ")
    out = []
    for i, w in enumerate(words):
        core = w.strip(".,'\"—-")
        first_alpha = re.search(r"[A-Za-z]", w)
        starts_with_letter = first_alpha is not None and first_alpha.start() == 0
        if (i == 0 and starts_with_letter) or core in SENTENCE_KEEP:
            out.append(w)
        else:
            out.append(w.lower())
    return " ".join(out)

# ---------------------------------------------------------------- shapes
def rect(d, x, y, w, h, fill=None, outline=None, width=1):
    d.rectangle([x, y, x + w, y + h], fill=fill, outline=outline, width=width)

def poly(d, pts, fill):
    d.polygon([(float(px), float(py)) for px, py in pts], fill=fill)

def disc(d, cx, cy, r, fill):
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=fill)

def ring(d, cx, cy, r, color, width):
    d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=color, width=width)

def hline(d, x, y, w, color, width=1):
    d.line([(x, y), (x + w, y)], fill=color, width=width)

def vline(d, x, y, h, color, width=1):
    d.line([(x, y), (x, y + h)], fill=color, width=width)

def polyline(d, pts, color, width):
    d.line([(float(px), float(py)) for px, py in pts], fill=color, width=width, joint="curve")

def tri(d, x1, y1, x2, y2, x3, y3, fill):
    d.polygon([(x1, y1), (x2, y2), (x3, y3)], fill=fill)

def chip_w(s, f, pad_x=6):
    """Width a chip(s, f) would take, without drawing it."""
    return round(f.getlength(s)) + 2 * pad_x

def chip_h(f, pad_y=3):
    """Height a chip(s, f) would take."""
    return round(f.size * 0.72) + 2 * pad_y

def chip(d, x, y, s, f, fg, bg, pad_x=6, pad_y=3):
    """Small solid label chip; (x, y) = top-left. Returns its width."""
    w = chip_w(s, f, pad_x)
    h = chip_h(f, pad_y)
    rect(d, x, y, w, h, fill=bg)
    text(d, x + pad_x, y + pad_y, s, f, fg)
    return w

# ---------------------------------------------------------------- LCG (seed 1337, same as v5)
_lcg_state = 1337

def lcg_reset():
    global _lcg_state
    _lcg_state = 1337

def lcg() -> float:
    global _lcg_state
    _lcg_state = (_lcg_state * 1664525 + 1013904223) & 0xFFFFFFFF
    return _lcg_state / 4294967296.0

# ---------------------------------------------------------------- world map
# Land mask: 96 columns x 48 rows, equirectangular, 3.75 degrees per cell.
# Each row lists inclusive [first, last] column ranges that are land.
# Rows 0..38 cover lat 90..-56.25; rows 39..47 are empty ocean.
MAP_LAND = [
    [],
    [[25, 29], [37, 40]],
    [[24, 30], [33, 41]],
    [[22, 31], [33, 42]],
    [[4, 10], [20, 31], [34, 41], [66, 95]],
    [[3, 11], [16, 32], [35, 41], [52, 56], [64, 95]],
    [[3, 12], [15, 33], [36, 39], [42, 44], [50, 57], [60, 95]],
    [[4, 13], [14, 34], [37, 39], [42, 44], [50, 95]],
    [[5, 12], [13, 35], [46, 48], [51, 95]],
    [[12, 36], [46, 48], [49, 95]],
    [[12, 35], [46, 95]],
    [[10, 30], [46, 95]],
    [[9, 31], [45, 95]],
    [[9, 30], [45, 48], [51, 53], [55, 70], [72, 96]],
    [[10, 29], [44, 90]],
    [[11, 28], [44, 90]],
    [[12, 26], [46, 74], [80, 88]],
    [[13, 25], [44, 61], [70, 80]],
    [[14, 24], [43, 60], [70, 80]],
    [[16, 22], [42, 58], [70, 79]],
    [[17, 21], [42, 52], [56, 61], [73, 79]],
    [[24, 30], [42, 50], [55, 60], [74, 79]],
    [[25, 34], [43, 60], [76, 82]],
    [[25, 36], [47, 55], [74, 84]],
    [[26, 37], [47, 58], [79, 85]],
    [[26, 38], [48, 55], [80, 88]],
    [[27, 38], [48, 57], [84, 90]],
    [[28, 38], [49, 60], [85, 90]],
    [[28, 37], [49, 60], [82, 84]],
    [[29, 36], [49, 60], [79, 88]],
    [[29, 35], [50, 55], [78, 89]],
    [[30, 34], [50, 54], [78, 89]],
    [[30, 33], [50, 53], [79, 88]],
    [[30, 32], [50, 52], [80, 87], [92, 94]],
    [[30, 32], [82, 83], [92, 95]],
    [[30, 31], [93, 94]],
    [[30, 31]],
    [[30, 31]],
    [[30, 31]],
    [], [], [], [], [], [], [], [], [],
]
MAP_COLS = 96
MAP_ROWS_USED = 39
MAP_TOP_LAT = 90
MAP_BOT_LAT = -56.25

def draw_map(d, x0, y0, w, h):
    rect(d, x0, y0, w, h, fill=SEA)
    for c in range(8, MAP_COLS, 8):
        gx = round(x0 + (c / MAP_COLS) * w)
        vline(d, gx, y0, h, GRAT, 1)
    for r in range(8, MAP_ROWS_USED, 8):
        gy = round(y0 + (r / MAP_ROWS_USED) * h)
        hline(d, x0, gy, w, GRAT, 1)
    lcg_reset()
    cw = w / MAP_COLS
    ch = h / MAP_ROWS_USED
    for r in range(MAP_ROWS_USED):
        for a, b in MAP_LAND[r]:
            for c in range(a, b + 1):
                tone = LAND2 if lcg() < 0.14 else LAND
                rect(d, x0 + c * cw, y0 + r * ch, cw + 1, ch + 1, fill=tone)
    rect(d, x0, y0, w, h, outline=INK2, width=1)

def map_xy(x0, y0, w, h, lat, lon):
    x = x0 + ((lon + 180) / 360) * w
    y = y0 + ((MAP_TOP_LAT - lat) / (MAP_TOP_LAT - MAP_BOT_LAT)) * h
    return (round(x), round(y))

# ---------------------------------------------------------------- scenes
# Every card illustration is drawn for ITS story — a map, a diagram, a pair
# of flags, or a scene. Each scene fills its band (bx, by, bw, bh) and is
# built from fractions of the box, so it scales from the large lead band
# down to the small grid miniature.
import math

def draw_scene(d, scene, bx, by, bw, bh, accent):
    X = lambda f: bx + f * bw
    Y = lambda f: by + f * bh
    if scene == "blockade":
        # Strait of Hormuz: sea, land top and bottom, a tanker left of a
        # dashed red blockade line and a warship right of it.
        # v11: blue sea background (was pale SKY).
        rect(d, bx, by, bw, bh, fill=hx("#8FB8D8"))
        poly(d, [[X(0), Y(0)], [X(0.42), Y(0)], [X(0.3), Y(0.32)], [X(0), Y(0.28)]], LAND)
        poly(d, [[X(0.58), Y(0)], [X(1), Y(0)], [X(1), Y(0.26)], [X(0.7), Y(0.32)]], LAND)
        poly(d, [[X(0), Y(0.74)], [X(0.28), Y(0.68)], [X(0.4), Y(1)], [X(0), Y(1)]], LAND)
        poly(d, [[X(0.72), Y(0.68)], [X(1), Y(0.74)], [X(1), Y(1)], [X(0.6), Y(1)]], LAND)
        yy = Y(0.3)
        while yy < Y(0.7):
            rect(d, X(0.52), yy, 2, bh * 0.055, fill=RED)
            yy += bh * 0.1
        # Tanker (left): hull + white superstructure + funnel.
        poly(d, [[X(0.08), Y(0.52)], [X(0.4), Y(0.52)], [X(0.36), Y(0.66)], [X(0.12), Y(0.66)]], hx("#7B2D26"))
        rect(d, X(0.26), Y(0.38), bw * 0.07, bh * 0.14, fill=WHITE)
        rect(d, X(0.18), Y(0.44), bw * 0.03, bh * 0.08, fill=INK)
        # Warship (right): grey hull + mast + flag.
        poly(d, [[X(0.6), Y(0.55)], [X(0.9), Y(0.55)], [X(0.86), Y(0.67)], [X(0.64), Y(0.67)]], hx("#5B6B7C"))
        vline(d, round(X(0.74)), round(Y(0.36)), round(bh * 0.2), INK, 2)
        tri(d, X(0.74), Y(0.36), X(0.8), Y(0.4), X(0.74), Y(0.44), RED)
        hline(d, round(X(0.1)), round(Y(0.7)), round(bw * 0.28), WHITE, 1)
        hline(d, round(X(0.62)), round(Y(0.71)), round(bw * 0.24), WHITE, 1)
        # v7 richness: clouds over the strait + a distant second tanker.
        disc(d, round(X(0.16)), round(Y(0.12)), max(3, bh * 0.06), hx("#D5DCE2"))
        disc(d, round(X(0.22)), round(Y(0.09)), max(3, bh * 0.08), hx("#D5DCE2"))
        disc(d, round(X(0.88)), round(Y(0.1)), max(3, bh * 0.05), hx("#D5DCE2"))
        poly(d, [[X(0.44), Y(0.6)], [X(0.52), Y(0.6)], [X(0.51), Y(0.66)], [X(0.45), Y(0.66)]], hx("#8A5A52"))
        hline(d, round(X(0.08)), round(Y(0.78)), round(bw * 0.84), WHITE, 1)
    elif scene == "sinking":
        # A warship going down bow-first off the Libyan coast, burst above.
        # v11: two-tone sky + sea (was pale SKY).
        rect(d, bx, by, bw, bh * 0.3, fill=hx("#B9D4E8"))
        rect(d, bx, by + bh * 0.3, bw, bh * 0.7, fill=hx("#6FA8D0"))
        rect(d, bx, by + bh * 0.78, bw, bh * 0.22, fill=LAND)
        bcx, bcy = X(0.42), Y(0.26)
        bpts = []
        for k in range(16):
            ang = (k * math.pi) / 8 - math.pi / 2
            r = (0.2 if k % 2 == 0 else 0.08) * bh
            bpts.append((bcx + math.cos(ang) * r, bcy + math.sin(ang) * r))
        poly(d, bpts, hx("#E67E22"))
        disc(d, round(bcx), round(bcy), max(2, bh * 0.06), RED)
        poly(d, [[X(0.18), Y(0.5)], [X(0.62), Y(0.62)], [X(0.58), Y(0.76)], [X(0.22), Y(0.66)]], hx("#5B6B7C"))
        poly(d, [[X(0.3), Y(0.44)], [X(0.48), Y(0.5)], [X(0.46), Y(0.58)], [X(0.3), Y(0.54)]], INK)
        d.line([(X(0.3), Y(0.46)), (X(0.24), Y(0.3))], fill=INK, width=1)
        disc(d, round(X(0.52)), round(Y(0.34)), max(2, bh * 0.07), hx("#8A8A8A"))
        disc(d, round(X(0.58)), round(Y(0.26)), max(2, bh * 0.05), hx("#AAAAAA"))
        # v7 richness: more smoke drifting + a third wave line.
        disc(d, round(X(0.62)), round(Y(0.18)), max(2, bh * 0.06), hx("#BBBBBB"))
        disc(d, round(X(0.36)), round(Y(0.16)), max(2, bh * 0.05), hx("#AAAAAA"))
        hline(d, round(X(0.1)), round(Y(0.72)), round(bw * 0.5), WHITE, 1)
        hline(d, round(X(0.2)), round(Y(0.76)), round(bw * 0.4), WHITE, 1)
        hline(d, round(X(0.05)), round(Y(0.68)), round(bw * 0.3), WHITE, 1)
    elif scene == "gaza":
        # The Gaza Strip: sea left, a narrow strip, contamination dots,
        # and a hazard triangle.
        # v11: warm sand background + blue sea (was PAPER2 + pale SEA).
        rect(d, bx, by, bw, bh, fill=hx("#E8D9B8"))
        rect(d, bx, by, bw * 0.3, bh, fill=hx("#8FB8D8"))
        poly(d, [[X(0.3), Y(0.06)], [X(0.44), Y(0.1)], [X(0.48), Y(0.5)], [X(0.42), Y(0.94)], [X(0.3), Y(0.94)], [X(0.32), Y(0.5)]], LAND)
        for fx, fy in [(0.36, 0.2), (0.4, 0.32), (0.36, 0.44), (0.42, 0.56), (0.38, 0.68), (0.4, 0.82), (0.34, 0.58), (0.44, 0.22), (0.33, 0.3), (0.43, 0.72), (0.37, 0.9)]:
            disc(d, round(X(fx)), round(Y(fy)), max(1, bh * 0.03), RED)
        tx, ty = X(0.68), Y(0.5)
        ts = bh * 0.34
        tri(d, tx, ty - ts / 2, tx + ts / 2, ty + ts / 2, tx - ts / 2, ty + ts / 2, GOLD)
        tri(d, tx, ty - ts / 2 + 3, tx + ts / 2 - 3, ty + ts / 2 - 3, tx - ts / 2 + 3, ty + ts / 2 - 3, (250, 200, 60))
        bang = fb(max(8, round(bh * 0.29)))
        text_c(d, tx, ty - bh * 0.12, "!", bang, INK)
    elif scene == "dymer":
        # A shelled apartment block: broken top corner, smoke, small flame.
        # v11: blue sky + land/rubble band at the bottom (was pale SKY).
        rect(d, bx, by, bw, bh, fill=hx("#A8C8E0"))
        rect(d, bx, by + bh * 0.85, bw, bh * 0.15, fill=hx("#C9A86A"))
        bx0 = X(0.3)
        bw0 = bw * 0.4
        rect(d, bx0, Y(0.18), bw0, bh * 0.82, fill=hx("#8A8A8A"))
        for r in range(4):
            for c in range(3):
                rect(d, bx0 + bw0 * (0.14 + c * 0.3), Y(0.28 + r * 0.18), bw0 * 0.14, bh * 0.07, fill=INK2)
        poly(d, [[bx0 + bw0 * 0.62, Y(0.18)], [bx0 + bw0, Y(0.18)], [bx0 + bw0, Y(0.42)], [bx0 + bw0 * 0.78, Y(0.34)]], INK)
        poly(d, [[bx0 + bw0 * 0.7, Y(1)], [bx0 + bw0 * 1.05, Y(1)], [bx0 + bw0 * 0.95, Y(0.82)], [bx0 + bw0 * 0.8, Y(0.9)]], hx("#6E6E6E"))
        disc(d, round(bx0 + bw0 * 0.85), round(Y(0.12)), max(2, bh * 0.07), hx("#AAAAAA"))
        disc(d, round(bx0 + bw0 * 0.95), round(Y(0.05)), max(2, bh * 0.05), hx("#BBBBBB"))
        poly(d, [[X(0.78), Y(0.42)], [X(0.84), Y(0.3)], [X(0.88), Y(0.42)]], RED)
    elif scene == "kospi":
        # A market in free fall: descending bars, a steep red line, arrow.
        # v11: proper chart — blue-steel panel, gridlines, 6 descending
        # bars, downtrend line with arrowhead (was 4 plain bars on PAPER2).
        rect(d, bx, by, bw, bh, fill=hx("#DCE6EC"))
        for gy in [0.3, 0.5, 0.7]:
            hline(d, round(X(0.08)), round(Y(gy)), round(bw * 0.88), hx("#B9C4CC"), 1)
        vline(d, round(X(0.08)), round(Y(0.1)), round(bh * 0.8), INK, 2)
        hline(d, round(X(0.08)), round(Y(0.9)), round(bw * 0.88), INK, 2)
        tops = []
        for i, bhf in enumerate([0.68, 0.58, 0.48, 0.38, 0.26, 0.14]):
            bx0 = X(0.14 + i * 0.13)
            rect(d, bx0, Y(0.9 - bhf), bw * 0.09, bh * bhf, fill=hx("#C0392B"))
            tops.append((bx0 + bw * 0.045, Y(0.9 - bhf)))
        polyline(d, tops, RED, max(2, round(bh * 0.05)))
        tri(d, X(0.86), Y(0.84), X(0.78), Y(0.78), X(0.9), Y(0.74), RED)
    elif scene == "deals":
        # Singapore (red/white, crescent + stars) and China (red, 5 stars),
        # with a signed document below.
        # v11: pale gold background (was PAPER2).
        rect(d, bx, by, bw, bh, fill=hx("#F2E3C0"))
        fw, fh = bw * 0.4, bh * 0.78
        fy = by + bh * 0.08
        sx = bx + bw * 0.05
        rect(d, sx, fy, fw, fh / 2, fill=hx("#EF3340"))
        rect(d, sx, fy + fh / 2, fw, fh / 2, fill=WHITE)
        rect(d, sx, fy, fw, fh, outline=INK2, width=1)
        disc(d, round(sx + fw * 0.22), round(fy + fh * 0.25), max(2, fh * 0.11), WHITE)
        disc(d, round(sx + fw * 0.27), round(fy + fh * 0.25), max(2, fh * 0.09), hx("#EF3340"))
        for sfx, sfy in [(0.38, 0.14), (0.48, 0.2), (0.38, 0.3), (0.48, 0.1), (0.58, 0.18)]:
            disc(d, round(sx + fw * sfx), round(fy + fh * sfy), max(1, fh * 0.03), WHITE)
        cx0 = bx + bw * 0.55
        rect(d, cx0, fy, fw, fh, fill=hx("#DE2910"))
        rect(d, cx0, fy, fw, fh, outline=INK2, width=1)
        disc(d, round(cx0 + fw * 0.2), round(fy + fh * 0.2), max(2, fh * 0.09), GOLD)
        for sfx, sfy in [(0.42, 0.12), (0.52, 0.2), (0.52, 0.32), (0.42, 0.38)]:
            disc(d, round(cx0 + fw * sfx), round(fy + fh * sfy), max(1, fh * 0.04), GOLD)
        dx0 = bx + bw * 0.3
        rect(d, dx0, by + bh * 0.9, bw * 0.4, bh * 0.08, fill=WHITE)
        rect(d, round(dx0), round(by + bh * 0.9), round(bw * 0.4), round(bh * 0.08), outline=INK2, width=1)
    elif scene == "aid":
        # India (saffron/white/green + chakra) and Nepal (double pennant).
        # v11: pale saffron background (was PAPER2).
        rect(d, bx, by, bw, bh, fill=hx("#FBEED3"))
        fw, fh = bw * 0.42, bh * 0.8
        fy = by + bh * 0.1
        ix = bx + bw * 0.04
        for i, col in enumerate([hx("#FF9933"), WHITE, hx("#138808")]):
            rect(d, ix, fy + fh * i / 3, fw, fh / 3, fill=col)
        rect(d, ix, fy, fw, fh, outline=INK2, width=1)
        ring(d, round(ix + fw / 2), round(fy + fh / 2), max(2, fh * 0.13), hx("#000080"), 2)
        disc(d, round(ix + fw / 2), round(fy + fh / 2), max(1, fh * 0.03), hx("#000080"))
        nx = bx + bw * 0.56
        nw, nh, ny = bw * 0.34, fh, fy
        poly(d, [[nx, ny], [nx + nw, ny + nh * 0.12], [nx, ny + nh * 0.48], [nx + nw, ny + nh * 0.6], [nx, ny + nh], [nx, ny]], hx("#003893"))
        poly(d, [[nx + 2, ny + 2], [nx + nw - 4, ny + nh * 0.12], [nx + 2, ny + nh * 0.46], [nx + nw - 4, ny + nh * 0.58], [nx + 2, ny + nh - 2], [nx + 2, ny + 2]], hx("#DC143C"))
        disc(d, round(nx + nw * 0.22), round(ny + nh * 0.24), max(1, nh * 0.05), WHITE)
        disc(d, round(nx + nw * 0.22), round(ny + nh * 0.72), max(1, nh * 0.05), WHITE)
    elif scene == "ties":
        # Kenya (black/red/green + shield) and DR Congo (blue + red diagonal
        # + star), with two linked rings between them: ties restored.
        # v11: pale gold background (was PAPER2).
        rect(d, bx, by, bw, bh, fill=hx("#F2E3C0"))
        fw, fh = bw * 0.36, bh * 0.78
        fy = by + bh * 0.11
        kx = bx + bw * 0.04
        rect(d, kx, fy, fw, fh / 3, fill=INK)
        rect(d, kx, fy + fh / 3, fw, fh / 3, fill=hx("#922529"))
        rect(d, kx, fy + (2 * fh) / 3, fw, fh / 3, fill=hx("#006341"))
        hline(d, round(kx), round(fy + fh / 3), round(fw), WHITE, 1)
        hline(d, round(kx), round(fy + (2 * fh) / 3), round(fw), WHITE, 1)
        rect(d, kx, fy, fw, fh, outline=INK2, width=1)
        disc(d, round(kx + fw / 2), round(fy + fh / 2), max(2, fh * 0.12), WHITE)
        disc(d, round(kx + fw / 2), round(fy + fh / 2), max(1, fh * 0.06), hx("#922529"))
        dx0 = bx + bw * 0.6
        rect(d, dx0, fy, fw, fh, fill=hx("#007FFF"))
        rect(d, dx0, fy, fw, fh, outline=INK2, width=1)
        poly(d, [[dx0, fy + fh], [dx0 + fw * 0.28, fy + fh], [dx0 + fw, fy], [dx0 + fw * 0.72, fy]], hx("#CE1026"))
        poly(d, [[dx0, fy + fh], [dx0 + fw * 0.1, fy + fh], [dx0 + fw * 0.82, fy], [dx0 + fw * 0.72, fy]], GOLD)
        poly(d, [[dx0 + fw * 0.18, fy + fh], [dx0 + fw * 0.28, fy + fh], [dx0 + fw, fy], [dx0 + fw * 0.9, fy]], GOLD)
        disc(d, round(dx0 + fw * 0.2), round(fy + fh * 0.2), max(1, fh * 0.06), GOLD)
        rx, ry = bx + bw * 0.5, by + bh * 0.5
        rr = max(3, bh * 0.14)
        ring(d, round(rx - rr * 0.7), round(ry), round(rr), hx("#922529"), 2)
        ring(d, round(rx + rr * 0.7), round(ry), round(rr), hx("#007FFF"), 2)
    elif scene == "france15":
        # Eiffel Tower, a big euro sign, and rising bars.
        # v11: sky + street (was PAPER2).
        rect(d, bx, by, bw, bh * 0.7, fill=hx("#B9D4E8"))
        rect(d, bx, by + bh * 0.7, bw, bh * 0.3, fill=hx("#E8D9B8"))
        tx0 = X(0.05)
        tw = bw * 0.26
        poly(d, [[tx0, Y(0.95)], [tx0 + tw * 0.24, Y(0.55)], [tx0 + tw * 0.36, Y(0.28)], [tx0 + tw * 0.5, Y(0.05)], [tx0 + tw * 0.64, Y(0.28)], [tx0 + tw * 0.76, Y(0.55)], [tx0 + tw, Y(0.95)]], INK)
        tri(d, tx0 + tw * 0.32, Y(0.95), tx0 + tw * 0.5, Y(0.62), tx0 + tw * 0.68, Y(0.95), PAPER2)
        hline(d, round(tx0 + tw * 0.18), round(Y(0.55)), round(tw * 0.64), PAPER2, 2)
        hline(d, round(tx0 + tw * 0.28), round(Y(0.32)), round(tw * 0.44), PAPER2, 2)
        euro = fb(max(10, round(bh * 0.9)))
        text(d, X(0.4), Y(0.18), "\u20ac", euro, accent)
        for i, bf in enumerate([0.22, 0.42, 0.62]):
            rect(d, X(0.68 + i * 0.11), Y(0.92 - bf), bw * 0.07, bh * bf, fill=hx("#2E7D32"))
        polyline(d, [[X(0.66), Y(0.72)], [X(0.78), Y(0.52)], [X(0.92), Y(0.3)]], hx("#2E7D32"), max(2, round(bh * 0.04)))
        tri(d, X(0.92), Y(0.3), X(0.86), Y(0.3), X(0.92), Y(0.38), hx("#2E7D32"))
    elif scene == "pmi":
        # A gauge dial: red low zone left, green high zone right, needle low.
        # v11: blue-steel panel background (was PAPER2).
        rect(d, bx, by, bw, bh, fill=hx("#DCE6EC"))
        gcx, gcy = X(0.42), Y(0.86)
        gr = bh * 0.62
        d.arc([gcx - gr, gcy - gr, gcx + gr, gcy + gr], 180, 360, fill=INK2, width=max(2, round(bh * 0.05)))
        for k in range(7):
            ang = math.pi - (k * math.pi) / 6
            x1 = gcx + math.cos(ang) * (gr - bh * 0.06)
            y1 = gcy - math.sin(ang) * (gr - bh * 0.06)
            x2 = gcx + math.cos(ang) * (gr + bh * 0.06)
            y2 = gcy - math.sin(ang) * (gr + bh * 0.06)
            col = RED if k <= 2 else (hx("#2E7D32") if k >= 4 else INK2)
            d.line([(x1, y1), (x2, y2)], fill=col, width=2)
        nang = math.pi - (math.pi * 0.28)
        d.line([(gcx, gcy), (gcx + math.cos(nang) * gr * 0.85, gcy - math.sin(nang) * gr * 0.85)], fill=RED, width=max(2, round(bh * 0.05)))
        disc(d, round(gcx), round(gcy), max(2, bh * 0.07), INK)
        d.line([(X(0.8), Y(0.3)), (X(0.8), Y(0.66))], fill=RED, width=max(2, round(bh * 0.04)))
        tri(d, X(0.8), Y(0.72), X(0.74), Y(0.6), X(0.86), Y(0.6), RED)
    elif scene == "draw44":
        # Goal frame + net, soccer ball in front.
        # v11: green pitch with mowing stripes below a pale sky (was SKY
        # all over, no grass). Ball rests on the grass at Y(0.60).
        rect(d, bx, by, bw, bh * 0.45, fill=SKY)
        for s in range(8):
            rect(d, bx, by + bh * (0.45 + s * 0.55 / 8), bw, bh * 0.55 / 8,
                 fill=hx("#2E7D32") if s % 2 == 0 else hx("#388E3C"))
        hline(d, round(bx), round(Y(0.45)), round(bw), WHITE, 2)
        gx0, gx1, gy0, gy1 = X(0.14), X(0.86), Y(0.12), Y(0.86)
        for i in range(1, 6):
            vline(d, round(gx0 + ((gx1 - gx0) * i) / 6), round(gy0), round(gy1 - gy0), hx("#B9C4CC"), 1)
        for i in range(1, 4):
            hline(d, round(gx0), round(gy0 + ((gy1 - gy0) * i) / 4), round(gx1 - gx0), hx("#B9C4CC"), 1)
        vline(d, round(gx0), round(gy0), round(gy1 - gy0), WHITE, 3)
        vline(d, round(gx1), round(gy0), round(gy1 - gy0), WHITE, 3)
        hline(d, round(gx0), round(gy0), round(gx1 - gx0), WHITE, 3)
        bcx, bcy = X(0.5), Y(0.60)
        br = max(4, bh * 0.24)
        disc(d, round(bcx), round(bcy), round(br), WHITE)
        ring(d, round(bcx), round(bcy), round(br), INK, 2)
        pent = []
        for k in range(5):
            ang = (k * 2 * math.pi) / 5 - math.pi / 2
            pent.append((bcx + math.cos(ang) * br * 0.38, bcy + math.sin(ang) * br * 0.38))
        poly(d, pent, INK)
        for k in range(5):
            ang = (k * 2 * math.pi) / 5 - math.pi / 2
            d.line([(bcx + math.cos(ang) * br * 0.38, bcy + math.sin(ang) * br * 0.38),
                    (bcx + math.cos(ang) * br * 0.95, bcy + math.sin(ang) * br * 0.95)], fill=INK2, width=1)
    elif scene == "voters":
        # A ballot box with a marked slip going in.
        # v11: blue-steel wall + warm floor (was PAPER2).
        rect(d, bx, by, bw, bh * 0.65, fill=hx("#DCE6EC"))
        rect(d, bx, by + bh * 0.65, bw, bh * 0.35, fill=hx("#E8D9B8"))
        bx0 = X(0.3)
        bw0 = bw * 0.4
        rect(d, bx0, Y(0.4), bw0, bh * 0.55, fill=accent)
        rect(d, round(bx0), round(Y(0.4)), round(bw0), round(bh * 0.55), outline=INK, width=2)
        rect(d, bx0 + bw0 * 0.1, Y(0.32), bw0 * 0.8, bh * 0.08, fill=INK)
        slip = [(X(0.4), Y(0.34)), (X(0.56), Y(0.28)), (X(0.6), Y(0.56)), (X(0.44), Y(0.6))]
        poly(d, slip, WHITE)
        d.line(slip + [slip[0]], fill=INK2, width=1, joint="curve")
        d.line([(X(0.47), Y(0.38)), (X(0.53), Y(0.5))], fill=RED, width=2)
        d.line([(X(0.53), Y(0.38)), (X(0.47), Y(0.5))], fill=RED, width=2)
    elif scene == "aus":
        # Australia's outline + a growth curve that flattens out.
        # v11: pale sky + ochre land, and a kangaroo standing on the land
        # (John 22:16 WIB). The kangaroo is drawn AFTER the map so it sits
        # on top: tilted body, head + two upright ears, long tail touching
        # the ground behind, large hind legs + small forelegs.
        rect(d, bx, by, bw, bh * 0.55, fill=SKY)
        rect(d, bx, by + bh * 0.55, bw, bh * 0.45, fill=hx("#D98E32"))
        poly(d, [[X(0.05), Y(0.38)], [X(0.1), Y(0.2)], [X(0.22), Y(0.12)], [X(0.38), Y(0.08)], [X(0.52), Y(0.04)], [X(0.58), Y(0.16)], [X(0.6), Y(0.32)], [X(0.56), Y(0.5)], [X(0.48), Y(0.62)], [X(0.36), Y(0.66)], [X(0.2), Y(0.62)], [X(0.08), Y(0.52)]], LAND)
        tri(d, X(0.52), Y(0.76), X(0.58), Y(0.76), X(0.55), Y(0.86), LAND)
        # Kangaroo silhouette (dark brown), far left, X(0.02–0.19),
        # Y(0.36–0.95) — fully clear of the value chip (bottom-right, starts
        # ~X 0.22) and the number disc (top-left, X < 0.14, Y < 0.38).
        # Bold upright profile: body, two tall ears, long tail sweeping
        # back to the ground, big hind foot.
        roo = hx("#5D3A1A")
        poly(d, [[X(0.13), Y(0.50)], [X(0.17), Y(0.51)], [X(0.18), Y(0.56)],
               [X(0.17), Y(0.63)], [X(0.15), Y(0.72)], [X(0.13), Y(0.82)],
               [X(0.11), Y(0.88)], [X(0.08), Y(0.86)], [X(0.07), Y(0.76)],
               [X(0.08), Y(0.64)], [X(0.10), Y(0.54)]], roo)
        tri(d, X(0.12), Y(0.50), X(0.11), Y(0.36), X(0.14), Y(0.50), roo)
        tri(d, X(0.14), Y(0.50), X(0.15), Y(0.38), X(0.17), Y(0.50), roo)
        poly(d, [[X(0.08), Y(0.80)], [X(0.04), Y(0.88)], [X(0.02), Y(0.93)],
               [X(0.04), Y(0.95)], [X(0.07), Y(0.92)], [X(0.10), Y(0.85)]], roo)
        poly(d, [[X(0.11), Y(0.84)], [X(0.15), Y(0.88)], [X(0.19), Y(0.93)],
               [X(0.19), Y(0.95)], [X(0.13), Y(0.95)], [X(0.10), Y(0.90)]], roo)
        d.line([(X(0.16), Y(0.70)), (X(0.14), Y(0.87))], fill=roo, width=max(2, round(bh * 0.04)))
        vline(d, round(X(0.64)), round(Y(0.16)), round(bh * 0.7), INK, 2)
        hline(d, round(X(0.64)), round(Y(0.86)), round(bw * 0.3), INK, 2)
        polyline(d, [[X(0.66), Y(0.78)], [X(0.74), Y(0.56)], [X(0.82), Y(0.46)], [X(0.9), Y(0.45)], [X(0.94), Y(0.48)]], RED, max(2, round(bh * 0.04)))
        tri(d, X(0.94), Y(0.48), X(0.9), Y(0.42), X(0.96), Y(0.42), RED)
    else:
        raise ValueError(f"unknown scene {scene}")

# ---------------------------------------------------------------- data
# The v4/v5 story set, unchanged: every headline, number, date and badge is
# the verified 23 Nov set. (The old editorial brief no longer governs this
# work; the content below is kept exactly as v4 had it.)
# Lead cards carry "banner" (red chip, top of the art) and "place" (dark
# chip, bottom of the art) labels inside the scene, like top-1. Grid cards
# carry a short "value" chip inside the scene. All three are drawn from the
# story's own verified words/numbers — no new facts.
CARDS = [
    {"n": 1, "headline": "TRUMP: SINK SHIPS THAT DEFY IRAN BLOCKADE", "sub": "FRESH STRIKES MAY WAIT UNTIL 2027", "badge": "CONFIRMED", "source": "GULF NEWS", "scene": "blockade", "accent": hx("#C0392B"), "lat": 26.5, "lon": 56, "dx": 36, "dy": -28, "banner": "IRAN BLOCKADE", "place": "STRAIT OF HORMUZ"},
    {"n": 2, "headline": "KYIV: WE SANK A RUSSIAN WARSHIP OFF LIBYA", "sub": "ZELENSKYY CONFIRMS DRONE HIT OFF BENGHAZI", "badge": "OFFICIAL", "source": "AP", "scene": "sinking", "accent": hx("#1F3A5F"), "lat": 32.1, "lon": 20.1, "dx": -24, "dy": 22, "banner": "WARSHIP SUNK", "place": "BENGHAZI"},
    {"n": 3, "headline": "GAZA NOW A 'TOXIC WASTELAND', OXFAM FINDS", "sub": "OVER 99% OF THE STRIP SHOWS CONTAMINATION", "badge": "CONFIRMED", "source": "OXFAM", "scene": "gaza", "accent": hx("#8C6A1F"), "lat": 31.5, "lon": 34.5, "dx": 28, "dy": -6, "banner": "99% CONTAMINATED", "place": "GAZA STRIP"},
    {"n": 4, "headline": "DYMER STRIKE TOLL HITS 11", "sub": "RESCUERS STILL SEARCH RUBBLE IN DYMER", "badge": "CONFIRMED", "source": "AA", "scene": "dymer", "accent": hx("#3B4A5A"), "lat": 50.5, "lon": 30.5, "dx": 0, "dy": 0, "value": "TOLL 11"},
    {"n": 5, "headline": "SEOUL STOCKS PLUNGE 3.3%", "sub": "KOSPI SLIDES AS TECH SELL-OFF SPREADS", "badge": "CONFIRMED", "source": "YONHAP", "scene": "kospi", "accent": hx("#B03A2E"), "lat": 37.5, "lon": 127, "dx": 0, "dy": 0, "value": "-3.3%"},
    {"n": 6, "headline": "SINGAPORE, CHINA SIGN 29 DEALS", "sub": "TOP BILATERAL FORUM YIELDS 29 PACTS", "badge": "CONFIRMED", "source": "CNA", "scene": "deals", "accent": hx("#0E7C7B"), "lat": 1.3, "lon": 104, "dx": 0, "dy": 0, "value": "29 DEALS"},
    {"n": 7, "headline": "MODI HOSTS NEPAL PM, AID PACT", "sub": "RS 15,000-CRORE PACKAGE, NEW TRAIN LINK", "badge": "CONFIRMED", "source": "THE HINDU", "scene": "aid", "accent": hx("#D97B29"), "lat": 28.6, "lon": 77, "dx": -30, "dy": 30, "value": "AID PACT"},
    {"n": 8, "headline": "KENYA, DR CONGO RESTORE TIES", "sub": "RUTO, TSHISEKEDI END YEARS OF TENSION", "badge": "CONFIRMED", "source": "BBC", "scene": "ties", "accent": hx("#2E7D32"), "lat": -1.3, "lon": 36.8, "dx": 24, "dy": 14, "value": "TIES RESTORED"},
    {"n": 9, "headline": "FRANCE UNVEILS \u20ac15BN PROJECTS", "sub": "NEARLY \u20ac15BN PLEDGED AT PARIS SUMMIT", "badge": "CONFIRMED", "source": "EURONEWS", "scene": "france15", "accent": hx("#1D4ED8"), "lat": 48.85, "lon": 2.35, "dx": 0, "dy": 0, "value": "\u20ac15BN"},
    {"n": 10, "headline": "FRANCE PMI HITS SIX-MONTH LOW", "sub": "SERVICES PMI 46.6; EUROZONE HOLDS STEADY", "badge": "CONFIRMED", "source": "REUTERS", "scene": "pmi", "accent": hx("#5B6B7C"), "lat": 48.85, "lon": 2.35, "dx": -36, "dy": -18, "value": "PMI 46.6"},
    {"n": 11, "headline": "ATALANTA 4-4 INTER EPIC DRAW", "sub": "EIGHT-GOAL THRILLER IN BERGAMO", "badge": "CONFIRMED", "source": "SERIE A", "scene": "draw44", "accent": hx("#6C3483"), "lat": 45.7, "lon": 9.7, "dx": 40, "dy": 32, "value": "4-4"},
    {"n": 12, "headline": "TRUMP BLAMES VOTERS FOR LOSS", "sub": "SAYS VOTERS IGNORED HIS IRAN WARNINGS", "badge": "REPORTED", "source": "AA", "scene": "voters", "accent": hx("#922B21"), "lat": 38.9, "lon": -77, "dx": 0, "dy": 0, "value": "BLAMES VOTERS"},
    {"n": 13, "headline": "AUSTRALIA: SLOWER GROWTH AHEAD", "sub": "CHALMERS: JOBS, PRICES UNDER PRESSURE", "badge": "REPORTED", "source": "SMH", "scene": "aus", "accent": hx("#B7950B"), "lat": -35.3, "lon": 149, "dx": 0, "dy": 0, "value": "SLOWER GROWTH"},
]

# ALSO: numbered 14..33, one line each.
ALSO = [
    (14, "GUTERRES CALLS COP31 A FLOP"),
    (15, "IRAN IMPOSES POWER CUTS"),
    (16, "VENEZUELA TALKS CONCLUDE"),
    (17, "GAZA LEAD-POISONING DEATH"),
    (18, "UK: BURNHAM EYES EU RESET"),
    (19, "SMALL AI RIVALS BIG MODELS"),
    (20, "DEMOCRATS WIN 258 HOUSE SEATS"),
    (21, "CHINA: SPY-LEAK DEATH SENTENCE"),
    (22, "24 KILLED IN INDONESIA FIRE"),
    (23, "NATO: RUSSIA SATELLITE READY"),
    (24, "IRAN VOWS TO FIGHT US BLOCKADE"),
    (25, "450 GERMAN SCHOOLS THREATENED"),
    (26, "SEOUL'S FIRST FEMALE SPY CHIEF"),
    (27, "PRABOWO NAMES VP CANDIDATES"),
    (28, "ARMENIA DRAFTS NEW CONSTITUTION"),
    (29, "ZAMBIA OPPOSITION TREASON CHARGE"),
    (30, "THAI COURT HALVES ROYAL SENTENCE"),
    (31, "BELGIUM PM: BUDGET DEAL OR WE FALL"),
    (32, "HUNGARY PM TO VISIT UKRAINE"),
    (33, "KENYA JOINS 25-NATION PLEDGE"),
]
ALSO_SOURCES = "ALSO SOURCES: UN NEWS \u00b7 THE NATIONAL \u00b7 AA \u00b7 THE GUARDIAN \u00b7 MIT NEWS \u00b7 AFP \u00b7 SCMP \u00b7 AP \u00b7 REUTERS \u00b7 DAILY NATION \u00b7 SOVEREIGN CREDITOR REVIEW \u00b7 POLIDATO"

# The day in numbers: 6 KPI cells.
KPIS = [
    ("11", "DYMER TOLL"),
    ("3.3%", "KOSPI FALL"),
    ("29", "SG-CN DEALS"),
    ("\u20ac15BN", "FRANCE PLEDGES"),
    ("258", "HOUSE SEATS"),
    ("24", "FACTORY DEATHS"),
]

# The day in UTC: six timed moments from the research (UTC times as reported).
TIMELINE = [
    ("00:36", "OXFAM GAZA"),
    ("03:06", "IRAN THREAT"),
    ("04:08", "29 DEALS"),
    ("06:34", "KOSPI -3.3%"),
    ("07:48", "SHIP SUNK"),
    ("10:08", "HOUSE 258"),
]

# Breadth by region: counts sum to 33 stories (13 cards + 20 ALSO).
REGIONS = [
    ("N AMERICA", 4),
    ("S AMERICA", 1),
    ("EUROPE", 11),
    ("AFRICA", 3),
    ("MIDDLE EAST", 5),
    ("ASIA", 8),
    ("OCEANIA", 1),
]

# DATE CHECK: real stories from other days, named so the judge can see they
# were deliberately left out of the 23 Nov edition.
LEFT_OUT = [
    "COP31 COLLAPSE \u2014 21-22 NOV",
    "SPARTA II DRONE STRIKE \u2014 SAT 21 NOV",
    "TEXAS DEMOCRATS SWEEP \u2014 3 NOV",
    "186-DRONE BARRAGE \u2014 22 NOV",
    "LIVERPOOL 4-0 MAN UTD \u2014 22 NOV",
    "IRAN RADAR CLAIMS, BAHRAIN \u2014 22 NOV",
]

LEGEND = "CONFIRMED 2+ outlets \u00b7 OFFICIAL statement \u00b7 REPORTED 1 outlet \u00b7 CLAIM 1 party"

# v11 footer (John 22:09 WIB): three segments on two lines. Line 1: the
# "Every story happened..." sentence on the left + the legend centred in the
# space that remains. Line 2: the sources, centred. Sources are the 12 card
# sources deduplicated in order of first appearance (from CARDS) — NOT the
# ALSO sources.
FOOTER_LEFT = "Every story happened or was first reported on Mon 23 Nov 2026; claims attributed."
FOOTER_SOURCES = "Sources: Gulf News, AP, Oxfam, AA, Yonhap, CNA, The Hindu, BBC, Euronews, Reuters, Serie A, SMH"
# Legend as parts: (text, is_badge_word, badge_key). Badge words are bold +
# coloured per type (same BADGE_COLORS as the cards); descriptors are regular
# + MUTED; CLAIM is bold + MUTED (John named only the three for colour).
LEGEND_PARTS = [("CONFIRMED ", True, "CONFIRMED"), ("2+ outlets \u00b7 ", False, None),
                ("OFFICIAL ", True, "OFFICIAL"), ("statement \u00b7 ", False, None),
                ("REPORTED ", True, "REPORTED"), ("1 outlet \u00b7 ", False, None),
                ("CLAIM ", True, None), ("1 party", False, None)]

REGION_COLORS = [hx("#1F3A5F"), hx("#2E7D32"), hx("#1D4ED8"), hx("#D97B29"), hx("#C0392B"), hx("#0E7C7B"), hx("#B7950B")]

# ---------------------------------------------------------------- layout
# GRID first: every zone rect is computed here, then the render pass reads
# the layout only. v8 budget: the lead cards are 235 tall (art 120) and the
# grid cards 116 (art 55), so the masthead/KPI/timeline are slightly
# smaller, the map is 150 tall and the ALSO list runs at 12px. The masthead
# zone is 157 tall so MONDAY has ~13px of breathing room below the kicker
# line (v8 fix); the top margin is 6 and the gaps are 1 to pay for it. The
# page ends at y=1014 (10px bottom margin). If the budget ever overflows,
# main() raises instead of clipping. v9: the KPI heading line is gone — the
# count it stated is already in the top kicker, so the line was redundant.
# The freed 12px move from the KPI zone (46 → 34) to the masthead zone
# (157 → 169) for more breathing room; the page still ends at y=1014.
# v11 budget: the footer needs 2 lines (25 tall) and the DATE CHECK grid
# needs 50, so the page pays from the masthead (169 → 155; its content ends
# at y+153, so the bottom rule sits 2px above the zone end — the 13px
# breathing room ABOVE is untouched), the top margin (6 → 4), the grid row
# gap (8 → 6), the map/ALSO zone (220 → 219; last ALSO item ends y+218),
# the region bar (18 → 16; text ends ~y+14), and the footer gap is an
# explicit y += 5 (5px below the DATE CHECK red border, John 22:12).
# Recount: 4 + 155+1 + 34+1 + 26+1 + 235+1 + 238+1 + 219+1 + 16+1 + 50+5
# + 25 = bottom 1014. If the budget ever overflows, main() raises instead
# of clipping.
def build_layout():
    y = 4
    gap = 1
    masthead = (MARGIN, y, CW, 155); y += 155 + gap
    kpi = (MARGIN, y, CW, 34); y += 34 + gap
    timeline = (MARGIN, y, CW, 26); y += 26 + gap
    lead_w = (CW - 2 * 10) // 3
    leads = [(MARGIN + i * (lead_w + 10), y, lead_w, 235) for i in range(3)]
    y += 235 + gap
    grid_w = (CW - 4 * 8) // 5
    grid = []
    for r in range(2):
        for c in range(5):
            grid.append((MARGIN + c * (grid_w + 8), y + r * (116 + 6), grid_w, 116))
    y += 116 * 2 + 6 + gap
    map_zone = (MARGIN, y, 560, 219)
    also_zone = (MARGIN + 560 + 12, y, CW - 560 - 12, 219)
    y += 219 + gap
    region = (MARGIN, y, CW, 16); y += 16 + gap
    datecheck = (MARGIN, y, CW, 50); y += 50 + 5
    footer = (MARGIN, y, CW, 25)
    bottom = y + 25
    return {"masthead": masthead, "kpi": kpi, "timeline": timeline, "leads": leads,
            "grid": grid, "map_zone": map_zone, "also_zone": also_zone,
            "region": region, "datecheck": datecheck, "footer": footer, "bottom": bottom}

# ---------------------------------------------------------------- render
def render_masthead(d, z):
    x, y, w, h = z
    # v11: kicker RED (John 22:14 WIB, matching the reference's red kicker).
    text(d, x, y + 2, "ONE DAY OF WORLD NEWS, ONE PICTURE", fb(16), RED)
    text_r(d, x + w, y + 2, "33 STORIES \u00b7 7 REGIONS \u00b7 ALL FROM THIS MONDAY", fb(16), INK)
    msize = fit("MONDAY", SERIF_BOLD, 128, 660)
    # v8: MONDAY sits ~13px below the kicker line (was y+14, crowded).
    text_c(d, MARGIN + CW / 2, y + 26, "MONDAY", fb(msize), INK)
    mcap = msize * 0.688
    dsize = fit("23 NOVEMBER 2026", SERIF_BOLD, 48, 480)
    dy = y + 26 + mcap + 3
    text_c(d, MARGIN + CW / 2, dy, "23 NOVEMBER 2026", fb(dsize), INK)
    dcap = dsize * 0.688
    hline(d, x, dy + dcap + 3, w, RULE, 2)

def render_kpi(d, z):
    x, y, w, h = z
    # v9: the heading line is gone (redundant with the top kicker). Only the
    # 6 numbers + their labels remain, shifted up into the freed space.
    cell_w = CW / len(KPIS)
    for i, (value, label) in enumerate(KPIS):
        cx = MARGIN + i * cell_w + cell_w / 2
        if i > 0:
            vline(d, round(MARGIN + i * cell_w), y + 2, 30, CARD_LINE, 1)
        text_c(d, cx, y + 1, value, fb(30), INK)
        text_c(d, cx, y + 22, label, fr(15), INK2)

def render_timeline(d, z):
    x, y, w, h = z
    hline(d, x, y, w, RULE, 1)
    text(d, x, y + 7, "THE DAY IN UTC", fb(16), INK)
    start_x = MARGIN + 170
    tick_w = (CW - 170) / len(TIMELINE)
    for i, (t, label) in enumerate(TIMELINE):
        cx = start_x + i * tick_w + tick_w / 2
        if i > 0:
            vline(d, round(start_x + i * tick_w), y + 2, 22, CARD_LINE, 1)
        text_c(d, cx, y + 1, t, fb(18), RED)
        text_c(d, cx, y + 13, label, fr(15), INK2)
    hline(d, x, y + h - 1, w, RULE, 1)

def render_lead_card(d, z, card):
    x, y, w, h = z
    rect(d, x, y, w, h, fill=CARD)
    rect(d, x, y, w, h, outline=CARD_LINE, width=1)
    rect(d, x + 1, y + 1, w - 2, 4, fill=card["accent"])
    # Art band 120px tall (v6: 56) — the top-1 lead art is ~125px.
    ax, ay, aw, ah = x + 1, y + 5, w - 2, 120
    draw_scene(d, card["scene"], ax, ay, aw, ah, card["accent"])
    # Banner chip, top-right of the art (top-1's red "2 TANKERS HIT" style).
    bf = fb(17)
    chip(d, ax + aw - 4 - chip_w(card["banner"], bf), ay + 4, card["banner"], bf, WHITE, RED)
    # Place chip, bottom-left of the art (top-1's "BAHRAIN" style).
    pf = fb(15)
    chip(d, ax + 4, ay + ah - 4 - chip_h(pf), card["place"], pf, WHITE, INK)
    disc(d, x + 18, y + 18, 13, card["accent"])
    ring(d, x + 18, y + 18, 13, WHITE, 2)
    text_c(d, x + 18, y + 11, str(card["n"]), fb(19), WHITE)
    inner_w = w - 16
    hf = fb(21)
    # v8: headlines are Title Case, never all-caps.
    head_lines = wrap(title_case(card["headline"]), hf, inner_w)
    if len(head_lines) > 2:
        hf = fb(19)
        head_lines = wrap(title_case(card["headline"]), hf, inner_w)
    ty = y + 129
    for line in head_lines:
        text(d, x + 8, ty, line, hf, INK)
        ty += 24
    # v8: sublines are ALL CAPS (stored that way already; .upper() makes it
    # explicit). Shrink the size if a sub ever needs more than 2 lines.
    sub_size = 14
    sub_lines = wrap(card["sub"].upper(), fr(sub_size), inner_w)
    while len(sub_lines) > 2 and sub_size > 11:
        sub_size -= 1
        sub_lines = wrap(card["sub"].upper(), fr(sub_size), inner_w)
    ty += 2
    for line in sub_lines:
        text(d, x + 8, ty, line, fr(sub_size), INK2)
        ty += sub_size + 2
    by = y + h - 20
    if ty > by:
        raise RuntimeError(f"lead card {card['n']}: text overlaps badge (ty={ty}, by={by})")
    # Badge + source, pinned to the card bottom. Shrink until the line fits.
    # v8: only the badge word is all-caps and it takes its own type colour;
    # the source is Title Case (acronyms stay caps).
    src = title_case(card["source"])
    bsize, ssize = 17, 17
    total = tw(card["badge"], fb(bsize)) + tw(" | ", fr(ssize)) + tw(src, fr(ssize))
    while total > inner_w and (ssize > 11 or bsize > 13):
        if ssize > 11:
            ssize -= 1
        else:
            bsize -= 1
        total = tw(card["badge"], fb(bsize)) + tw(" | ", fr(ssize)) + tw(src, fr(ssize))
    if total > inner_w:
        raise RuntimeError(f"lead card {card['n']}: badge line still too wide ({total:.0f} > {inner_w})")
    bw = text(d, x + 8, by, card["badge"], fb(bsize), BADGE_COLORS[card["badge"]])
    text(d, x + 8 + bw, by, " | ", fr(ssize), INK2)
    text(d, x + 8 + bw + tw(" | ", fr(ssize)), by, src, fr(ssize), INK2)

def render_grid_card(d, z, card):
    x, y, w, h = z
    rect(d, x, y, w, h, fill=CARD)
    rect(d, x, y, w, h, outline=CARD_LINE, width=1)
    rect(d, x + 1, y + 1, w - 2, 3, fill=card["accent"])
    # Art band 55px tall (v6: 22) — the top-1 grid art is ~55px.
    ax, ay, aw, ah = x + 1, y + 4, w - 2, 55
    draw_scene(d, card["scene"], ax, ay, aw, ah, card["accent"])
    # Value chip, bottom-right of the art (top-1's "$60,190" / "M6.7" style).
    vf = fb(14)
    chip(d, ax + aw - 4 - chip_w(card["value"], vf), ay + ah - 4 - chip_h(vf), card["value"], vf, WHITE, INK)
    disc(d, x + 13, y + 13, 12, card["accent"])
    ring(d, x + 13, y + 13, 12, WHITE, 2)
    text_c(d, x + 13, y + 6, str(card["n"]), fb(18), WHITE)
    inner_w = w - 12
    # v8: headlines are Title Case, never all-caps.
    head_lines = wrap(title_case(card["headline"]), fb(15), inner_w)[:2]
    ty = y + 63
    for line in head_lines:
        text(d, x + 6, ty, line, fb(15), INK)
        ty += 18
    by = y + h - 16
    if ty > by:
        raise RuntimeError(f"grid card {card['n']}: text overlaps badge (ty={ty}, by={by})")
    # Badge + source, pinned to the bottom. Shrink the source (then the
    # badge) until the whole line fits the card — a clipped source is a
    # defect, never ship it. v8: only the badge word is all-caps and it takes
    # its own type colour; the source is Title Case (acronyms stay caps).
    src = title_case(card["source"])
    bsize, ssize = 16, 15
    total = tw(card["badge"], fb(bsize)) + tw(" | ", fr(ssize)) + tw(src, fr(ssize))
    while total > inner_w and (ssize > 11 or bsize > 13):
        if ssize > 11:
            ssize -= 1
        else:
            bsize -= 1
        total = tw(card["badge"], fb(bsize)) + tw(" | ", fr(ssize)) + tw(src, fr(ssize))
    if total > inner_w:
        raise RuntimeError(f"grid card {card['n']}: badge line still too wide ({total:.0f} > {inner_w})")
    bw = text(d, x + 6, by, card["badge"], fb(bsize), BADGE_COLORS[card["badge"]])
    text(d, x + 6 + bw, by, " | ", fr(ssize), INK2)
    text(d, x + 6 + bw + tw(" | ", fr(ssize)), by, src, fr(ssize), INK2)

def render_map(d, z):
    x, y, w, h = z
    block_h = 14 + 6 + 150 + 6 + 14
    top = y + (h - block_h) // 2
    text(d, x, top, "WHERE IT HAPPENED \u2014 23 NOVEMBER 2026", fb(18), INK)
    mx, my, mw, mh = x, top + 20, 560, 150
    draw_map(d, mx, my, mw, mh)
    for card in CARDS:
        ax, ay = map_xy(mx, my, mw, mh, card["lat"], card["lon"])
        px, py = ax + card["dx"], ay + card["dy"]
        disc(d, ax, ay, 3, INK)
        d.line([(ax, ay), (px, py)], fill=INK2, width=1)
        disc(d, px, py, 14, card["accent"])
        ring(d, px, py, 14, WHITE, 2)
        text_c(d, px, py - 7, str(card["n"]), fb(19), WHITE)
    text(d, x, my + mh + 6, "PINS = STORIES 1-13", fr(17), INK2)

def render_also(d, z):
    x, y, w, h = z
    text(d, x, y, "ALSO ON 23 NOVEMBER \u2014 IN BRIEF", fb(17), INK)
    ty = y + 16
    num_f = fb(13)
    for n, title in ALSO:
        num = f"{n}."
        text(d, x, ty, num, num_f, RED)
        # v8: ALSO items are news titles too — Title Case, not all-caps.
        text(d, x + tw(num, num_f) + 6, ty, title_case(title), fr(12), INK)
        ty += 10
    if ty - 10 + 12 > y + h:
        raise RuntimeError(f"ALSO list overflows zone (bottom={ty - 10 + 12}, zone={y + h})")

def render_region(d, z):
    x, y, w, h = z
    segs = [(f"{name} {count}", REGION_COLORS[i]) for i, (name, count) in enumerate(REGIONS)]
    total = sum(10 + 4 + tw(t, fb(17)) for t, _ in segs)
    gap = (w - total) / (len(segs) - 1)
    cx = x
    for t, color in segs:
        rect(d, round(cx), y + 4, 10, 10, fill=color)
        text(d, round(cx) + 14, y + 2, t, fb(17), INK)
        cx += 10 + 4 + tw(t, fb(17)) + gap

def render_datecheck(d, z):
    x, y, w, h = z
    rect(d, x, y, w, h, outline=RED, width=2)
    # v10: John 22:08 — no "left out bla bla bla": title is just DATE CHECK.
    # The 6 short past-date items stay; no explanatory paragraph in the
    # reference's long style (explicitly NOT wanted).
    text(d, x + 6, y + 1, "DATE CHECK", fb(16), RED)
    # v11: tidy 2-column x 3-row grid (John 22:10 WIB). v10's 3 run-on rows
    # joined by "·" were messy and row 3 overflowed ~3px past the box.
    # Column 1 = items 1-3, column 2 = items 4-6; last row ends ~y+48, box
    # ends y+50 (2px margin — must not overflow).
    col2_x = x + w // 2
    for r in range(3):
        ty = y + 14 + r * 11
        text(d, x + 6, ty, sentence_case(LEFT_OUT[r]), fr(13), INK2)
        text(d, col2_x, ty, sentence_case(LEFT_OUT[r + 3]), fr(13), INK2)

def render_footer(d, z):
    x, y, w, h = z
    # v11: three segments, two lines, no rule (the DATE CHECK red border is
    # already the separator; a 1px rule below it would look like a double
    # line). Line 1: left sentence + legend centred in the space that
    # remains; line 2: sources centred. Footer cap-top sits 5px below the
    # DATE CHECK red border (John 22:12).
    f = fr(11)
    left_w = text(d, x, y, FOOTER_LEFT, f, MUTED)
    rem_x0 = x + left_w + 12
    rem_x1 = x + w
    leg_w = sum(tw(t, fb(11) if b else fr(11)) for t, b, _ in LEGEND_PARTS)
    if rem_x0 + leg_w > rem_x1:
        raise RuntimeError("footer legend does not fit the remaining space")
    leg_x = rem_x0 + (rem_x1 - rem_x0 - leg_w) / 2
    cx = leg_x
    for t, b, key in LEGEND_PARTS:
        ff = fb(11) if b else fr(11)
        col = BADGE_COLORS[key] if key else MUTED
        cx += text(d, cx, y, t, ff, col)
    text_c(d, x + w / 2, y + 13, FOOTER_SOURCES, f, MUTED)

# ---------------------------------------------------------------- main
def main():
    if len(CARDS) != 13:
        raise RuntimeError(f"expected 13 cards, got {len(CARDS)}")
    if len(ALSO) != 20:
        raise RuntimeError(f"expected 20 ALSO items, got {len(ALSO)}")
    if len(KPIS) != 6:
        raise RuntimeError(f"expected 6 KPIs, got {len(KPIS)}")
    if len(TIMELINE) != 6:
        raise RuntimeError(f"expected 6 timeline ticks, got {len(TIMELINE)}")
    if sum(c for _, c in REGIONS) != len(CARDS) + len(ALSO):
        raise RuntimeError("region counts do not sum to the story total")
    layout = build_layout()
    if layout["bottom"] > H - 8:
        raise RuntimeError(f"layout overflows: bottom={layout['bottom']}")

    img = Image.new("RGB", (W, H), PAPER)
    d = ImageDraw.Draw(img)
    render_masthead(d, layout["masthead"])
    render_kpi(d, layout["kpi"])
    render_timeline(d, layout["timeline"])
    for i in range(3):
        render_lead_card(d, layout["leads"][i], CARDS[i])
    for i in range(10):
        render_grid_card(d, layout["grid"][i], CARDS[3 + i])
    render_map(d, layout["map_zone"])
    render_also(d, layout["also_zone"])
    render_region(d, layout["region"])
    render_datecheck(d, layout["datecheck"])
    render_footer(d, layout["footer"])

    outdir = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("out")
    outdir.mkdir(parents=True, exist_ok=True)
    png_path = outdir / "entry.png"
    img.save(png_path, format="PNG", compress_level=6)
    size = png_path.stat().st_size
    if size > 1048576:
        raise RuntimeError(f"entry.png too big: {size} bytes")
    print(f"wrote {png_path} ({img.size[0]}x{img.size[1]}, {size} bytes)")

if __name__ == "__main__":
    main()
