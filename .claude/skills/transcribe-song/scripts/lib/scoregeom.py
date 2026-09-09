"""Score geometry: staves, systems, barlines, glyphs and paths from a vector PDF.

Shared by score-geom.py and score-crop.py. Everything here is measurement, in the
PDF's own points; nothing here decides what a glyph *means* -- glyph ids are
font-private, so naming them is a job for the contact sheet and your eyes.
"""
from collections import Counter, defaultdict

try:
    import pymupdf
except ImportError:  # older wheels
    import fitz as pymupdf


# --------------------------------------------------------------- geometry
FLAT = 0.35          # a segment this close to axis-parallel counts as parallel
STAFF_MIN_W = 60     # a staff line runs the width of the system


def segments(page):
    """Every drawn path item, flattened to typed primitives in page coordinates."""
    out = []
    for p in page.get_drawings():
        w = p.get("width") or 0
        fill = p.get("fill") is not None
        for it in p["items"]:
            kind = it[0]
            if kind == "l":
                (x0, y0), (x1, y1) = it[1], it[2]
                out.append(dict(t="l", x0=x0, y0=y0, x1=x1, y1=y1, w=w, fill=fill))
            elif kind == "re":
                r = it[1]
                out.append(dict(t="re", x0=r.x0, y0=r.y0, x1=r.x1, y1=r.y1, w=w, fill=fill))
            elif kind == "qu":
                q = it[1]
                r = q.rect
                out.append(dict(t="qu", x0=r.x0, y0=r.y0, x1=r.x1, y1=r.y1, w=w, fill=fill))
            elif kind == "c":
                xs = [pt.x for pt in it[1:]]
                ys = [pt.y for pt in it[1:]]
                out.append(dict(t="c", x0=min(xs), y0=min(ys), x1=max(xs), y1=max(ys), w=w,
                                fill=fill, pts=[[round(pt.x, 2), round(pt.y, 2)] for pt in it[1:]]))
    return out


def classify(segs):
    """Label each primitive the way an engraver would name it."""
    for s in segs:
        dx, dy = abs(s["x1"] - s["x0"]), abs(s["y1"] - s["y0"])
        if s["t"] == "c":
            s["kind"] = "curve"          # tie or slur -- same primitive, see traps.md
        elif dy <= FLAT and dx > FLAT:
            s["kind"] = "staffline" if dx >= STAFF_MIN_W else "hline"   # ledger, or a beam edge
        elif dx <= FLAT and dy > FLAT:
            s["kind"] = "vline"          # stem, barline, or a bracket edge
        elif s["t"] in ("re", "qu") and dy <= 3.5 and dx > 3:
            s["kind"] = "beam"           # horizontal beams are filled rectangles
        elif s["t"] in ("re", "qu") and dx <= 2.0 and dy > 3:
            s["kind"] = "vline"
        else:
            s["kind"] = "other"          # slanted beams land here as 4-line filled paths
    return segs


def cluster(vals, tol):
    """1-D single-link clustering, returns sorted list of (mean, members)."""
    out = []
    for v in sorted(vals):
        if out and v - out[-1][-1] <= tol:
            out[-1].append(v)
        else:
            out.append([v])
    return [(sum(g) / len(g), g) for g in out]


def find_staves(segs):
    """Group the long horizontal rules into five-line staves.

    Staff lines are the only rules that run the full width of a system, so the
    grouping is: cluster their y's, then walk the clusters in fives. The spacing
    that comes out is the unit everything else is measured in -- one diatonic step
    is half of it.
    """
    rules = [((s["y0"] + s["y1"]) / 2, min(s["x0"], s["x1"]), max(s["x0"], s["x1"]))
             for s in segs if s["kind"] == "staffline"]
    if not rules:
        return []
    lines = []                                     # (y, x0, x1) per clustered rule
    for y, members in cluster([r[0] for r in rules], 0.8):
        near = [r for r in rules if abs(r[0] - y) <= 0.8]
        lines.append((y, min(r[1] for r in near), max(r[2] for r in near)))
    staves = []
    i = 0
    while i + 4 < len(lines):
        five = lines[i:i + 5]
        gaps = [five[k + 1][0] - five[k][0] for k in range(4)]
        if max(gaps) - min(gaps) <= 0.6 * (sum(gaps) / 4):
            sp = sum(gaps) / 4
            staves.append(dict(lines=[round(l[0], 3) for l in five], spacing=round(sp, 4),
                               top=round(five[0][0], 3), bottom=round(five[4][0], 3),
                               x0=round(min(l[1] for l in five), 2),
                               x1=round(max(l[2] for l in five), 2)))
            i += 5
        else:
            i += 1
    return staves


def group_systems(staves, segs):
    """A system is the staves a barline crosses together (a piano brace: two)."""
    if not staves:
        return []
    gaps = [staves[k + 1]["top"] - staves[k]["bottom"] for k in range(len(staves) - 1)]
    # within a system staves sit closer than systems sit to each other
    split = (min(gaps) + max(gaps)) / 2 if gaps and max(gaps) > 1.6 * min(gaps) else None
    systems, cur = [], [0]
    for k, g in enumerate(gaps):
        if split is not None and g > split:
            systems.append(cur)
            cur = []
        cur.append(k + 1)
    systems.append(cur)
    out = []
    for idx, members in enumerate(systems):
        top = staves[members[0]]["top"]
        bot = staves[members[-1]]["bottom"]
        lo = min(staves[i]["x0"] for i in members) - 0.5
        hi = max(staves[i]["x1"] for i in members) + 0.5
        # a barline crosses the whole brace and stays inside the system's own width,
        # which is what keeps page furniture (a full-height background rect) out
        bars = [round((s["x0"] + s["x1"]) / 2, 2) for s in segs
                if s["kind"] == "vline"
                and min(s["y0"], s["y1"]) <= top + 1 and max(s["y0"], s["y1"]) >= bot - 1
                and abs(s["y1"] - s["y0"]) > (bot - top) * 0.8
                and lo <= (s["x0"] + s["x1"]) / 2 <= hi]
        bars = [x for x, _ in cluster(bars, 1.5)]
        out.append(dict(system=idx + 1, staves=members, top=round(top, 2), bottom=round(bot, 2),
                        barlines=bars, bars=max(0, len(bars) - 1)))
    return out


# ----------------------------------------------------------------- glyphs
def glyphs(page):
    out = []
    for sp in page.get_texttrace():
        for c in sp["chars"]:
            ucs, gid, origin = c[0], c[1], c[2]
            out.append(dict(font=sp["font"], gid=gid, ucs=ucs, size=round(sp["size"], 3),
                            x=round(origin[0], 3), y=round(origin[1], 3)))
    return out


def music_font(gs):
    """The font that carries the notation: the one whose glyphs are unmapped (ucs
    0xfffd) or that simply has the most glyphs on a page of music."""
    unmapped = Counter(g["font"] for g in gs if g["ucs"] in (0xfffd, 0, 0xffff))
    if unmapped:
        return unmapped.most_common(1)[0][0]
    return Counter(g["font"] for g in gs).most_common(1)[0][0] if gs else None


LETTERS = "CDEFGAB"


def pitch_of(step, clef):
    """`step` = diatonic steps above the staff's bottom line. Returns e.g. 'F4'.

    Bottom line is E4 in treble, G2 in bass, so the whole grid is one addition.
    Nothing here knows about the key signature or accidentals -- apply those
    yourself, per bar, in the order the engraver wrote them.
    """
    letter, octave = {"treble": ("E", 4), "bass": ("G", 2),
                      "alto": ("F", 3), "tenor": ("D", 3)}[clef]
    i = LETTERS.index(letter) + step          # LETTERS starts at C, so // 7 counts octaves
    return f"{LETTERS[i % 7]}{octave + i // 7}"


def staff_of(y, staves):
    best, bd = None, 1e9
    for k, s in enumerate(staves):
        h = s["bottom"] - s["top"]
        d = 0 if s["top"] - h <= y <= s["bottom"] + h else min(abs(y - s["top"]), abs(y - s["bottom"]))
        if d < bd:
            best, bd = k, d
    return best


# ------------------------------------------------------------------ sheet
def contact_sheet(doc, pno, gs, font, path, window=1.9, per_row=8, box=150):
    """One labelled, magnified sample of every glyph id, in a single image.

    The point is to spend one image read, not one per bar: after this you know
    which id is a black notehead, which is a sharp, which is a quarter rest.
    """
    ids = defaultdict(list)
    for g in gs:
        if g["font"] == font:
            ids[g["gid"]].append(g)
    order = sorted(ids, key=lambda k: -len(ids[k]))
    page = doc[pno]
    cols = min(per_row, max(1, len(order)))
    rows = (len(order) + cols - 1) // cols
    out = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, cols * box, rows * (box + 16)), False)
    out.clear_with(255)
    labels = []
    for i, gid in enumerate(order):
        g = ids[gid][0]
        # the window scales with the glyph's own font size, so a clef and a notehead
        # both arrive framed rather than one of them cropped to a black smudge
        half = window * g["size"] / 2
        zoom = box / (2 * half)
        clip = pymupdf.Rect(g["x"] - half, g["y"] - half, g["x"] + half, g["y"] + half)
        pm = page.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom), clip=clip)
        cx, cy = (i % cols) * box, (i // cols) * (box + 16)
        pm.set_origin(cx, cy)
        out.copy(pm, pm.irect)
        labels.append((gid, len(ids[gid]), cx, cy + box))
    out.save(path)
    # the labels go on with a second pass through a one-page document, since a
    # Pixmap cannot draw text
    d2 = pymupdf.open()
    p2 = d2.new_page(width=out.width, height=out.height)
    p2.insert_image(pymupdf.Rect(0, 0, out.width, out.height), pixmap=out)
    for gid, n, x, y in labels:
        p2.insert_text((x + 2, y + 12), f"gid {gid} x{n}", fontsize=11, color=(0.8, 0, 0))
        # a crosshair on the glyph's own origin: a cell holds its neighbours too, and
        # the sample is the one under the cross
        cx, cy = x + box / 2, y - box / 2
        for dx, dy in ((10, 0), (-10, 0), (0, 10), (0, -10)):
            p2.draw_line((cx + dx * 0.45, cy + dy * 0.45), (cx + dx, cy + dy),
                         color=(0.85, 0, 0), width=1.2)
    p2.get_pixmap().save(path)
    return order


