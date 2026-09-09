#!/usr/bin/env python3
"""Render a piece of a score big enough to be sure about it.

Every ambiguous bar gets looked at, and looking means a crop at a magnification
where the question answers itself: is that notehead on the ledger line or in the
space under it, is that arc a tie or an accent, does that beam group have two
beams or three. A page-sized render answers none of those; a 600-1600 dpi crop of
four bars answers all of them.

    # a system, by the geometry score-geom.py reported
    python3 score-crop.py score.pdf --page 3 --rect 86,110,300,180 --dpi 600 --out /tmp/b30.png

    # the same, said in bars: system 2 of page 3, bars 2..3 of that system
    python3 score-crop.py score.pdf --page 3 --system 2 --bars 2-3 --dpi 900 --out /tmp/b35.png

    # a photo or a scan -- no vectors, so upscale hard and crop by fraction
    python3 score-crop.py page.jpg --frac 0.05,0.30,0.95,0.45 --scale 4 --out /tmp/sys3.png

--rect/--frac take x0,y0,x1,y1 (points for a PDF, pixels for an image; --frac is
0..1 of the page). --system/--bars ask score-geom.py's own staff and barline
detection where to cut, which is usually what you want on a vector PDF.

Needs PyMuPDF:  pip install pymupdf
"""
import argparse
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "lib"))
from scoregeom import (classify, find_staves, group_systems,  # noqa: E402
                       pymupdf, segments)


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("file", help="PDF, PNG or JPG")
    ap.add_argument("--page", type=int, default=1, help="1-based page number (PDF)")
    ap.add_argument("--rect", help="x0,y0,x1,y1 in page units")
    ap.add_argument("--frac", help="x0,y0,x1,y1 as fractions of the page, 0..1")
    ap.add_argument("--system", type=int, help="crop this system (needs staff lines)")
    ap.add_argument("--bars", help="with --system: bars of that system, e.g. 2 or 2-3")
    ap.add_argument("--pad", type=float, default=14, help="margin around the crop, in page units")
    ap.add_argument("--dpi", type=int, default=600, help="render resolution for a PDF")
    ap.add_argument("--scale", type=float, help="magnification for an image (overrides --dpi)")
    ap.add_argument("--out", required=True, help="PNG to write")
    a = ap.parse_args()

    doc = pymupdf.open(a.file)
    pno = min(max(a.page - 1, 0), len(doc) - 1)
    page = doc[pno]
    R = page.rect

    if a.rect:
        x0, y0, x1, y1 = (float(v) for v in a.rect.split(","))
        clip = pymupdf.Rect(x0, y0, x1, y1)
    elif a.frac:
        f = [float(v) for v in a.frac.split(",")]
        clip = pymupdf.Rect(R.x0 + f[0] * R.width, R.y0 + f[1] * R.height,
                            R.x0 + f[2] * R.width, R.y0 + f[3] * R.height)
    elif a.system:
        segs = classify(segments(page))
        systems = group_systems(find_staves(segs), segs)
        if not 1 <= a.system <= len(systems):
            sys.exit(f"page {a.page} has {len(systems)} systems")
        s = systems[a.system - 1]
        bl = s["barlines"]
        if a.bars and len(bl) >= 2:
            lo, _, hi = a.bars.partition("-")
            lo, hi = int(lo), int(hi or lo)
            x0 = bl[max(0, min(lo - 1, len(bl) - 1))]
            x1 = bl[max(0, min(hi, len(bl) - 1))]
        else:
            x0, x1 = bl[0], bl[-1]
        # more room above and below than beside: stems, beams, ledgers and tuplet
        # brackets all live outside the staff, and cropping them off is the one way
        # to make a crop lie
        clip = pymupdf.Rect(x0 - a.pad, s["top"] - 1.6 * a.pad, x1 + a.pad, s["bottom"] + 1.6 * a.pad)
    else:
        clip = R

    clip = clip & R
    zoom = a.scale if a.scale else a.dpi / 72
    pm = page.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom), clip=clip)
    pm.save(a.out)
    print(f"{a.out}: {pm.width}x{pm.height}px from {tuple(round(v, 1) for v in clip)} "
          f"of {a.file} page {a.page} (x{zoom:.2f})")


if __name__ == "__main__":
    main()
