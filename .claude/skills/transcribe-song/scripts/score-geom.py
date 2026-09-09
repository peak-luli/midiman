#!/usr/bin/env python3
"""Measure a printed score instead of squinting at it.

A vector PDF (anything exported from MuseScore, Sibelius, Finale, LilyPond) still
carries the engraver's own geometry: every notehead, clef, accidental and rest is a
font glyph with an exact origin, and every stem, beam, ledger line, tie and barline
is a vector path. Read those and a notehead's pitch becomes arithmetic against the
staff-line grid -- no eyeballing, no miscounted ledger lines.

    python3 score-geom.py score.pdf --page 1 --sheet /tmp/glyphs.png
    python3 score-geom.py score.pdf --page 1 --heads 114,113,112 --json /tmp/p1.json

Run it with --sheet first. The music font's glyph ids are font-private numbers, so
the script cannot know which id is a black notehead; the contact sheet renders one
labelled, magnified sample of every id with a crosshair on its origin, so a single
image read tells you the whole alphabet of this score. Note the mapping down, then
pass the notehead ids back in --heads.

With --heads (and --clefs, one per staff of a system, top to bottom) the JSON gains
a `notes` table: every notehead with its system, staff, x, staff step and the
diatonic pitch that step means under that clef -- *before* the key signature and
accidentals, which are yours to apply, per bar, in the order the engraver wrote
them (references/traps.md).

The stdout summary is deliberately short; everything measured lands in --json
(staves, systems, barlines, every glyph, every path classified as stem / beam /
ledger / curve). Query that with node or jq for whatever this script does not say.

Needs PyMuPDF:  pip install pymupdf
"""
import argparse
import json
import os
import sys
from collections import Counter

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "lib"))
from scoregeom import (classify, contact_sheet, find_staves, glyphs, group_systems,  # noqa: E402
                       music_font, pitch_of, pymupdf, segments, staff_of)


# ------------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("file", help="the score (PDF; an image works but carries no vectors)")
    ap.add_argument("--page", type=int, default=1, help="1-based page number")
    ap.add_argument("--json", help="write everything measured here")
    ap.add_argument("--sheet", help="write a labelled contact sheet of the music glyphs here")
    ap.add_argument("--window", type=float, default=1.9,
                    help="contact sheet crop window, in multiples of the glyph font size")
    ap.add_argument("--heads", default="", help="glyph ids that are noteheads, comma separated")
    ap.add_argument("--clefs", default="treble,bass",
                    help="clef per staff of a system, top to bottom (treble,bass)")
    a = ap.parse_args()

    doc = pymupdf.open(a.file)
    pno = a.page - 1
    if not 0 <= pno < len(doc):
        sys.exit(f"{a.file} has {len(doc)} pages, asked for {a.page}")
    page = doc[pno]

    segs = classify(segments(page))
    staves = find_staves(segs)
    systems = group_systems(staves, segs)
    gs = glyphs(page)
    font = music_font(gs)

    print(f"{a.file} page {a.page}: {page.rect.width:.1f} x {page.rect.height:.1f} pt")
    print(f"paths: " + ", ".join(f"{k}={v}" for k, v in Counter(s['kind'] for s in segs).most_common()))
    if not staves:
        print("no staff lines found -- is this a raster scan? see references/extract-pdf.md")
    for s in systems:
        st = [staves[i] for i in s["staves"]]
        print(f"system {s['system']}: staves {s['staves']}, y {s['top']}-{s['bottom']}, "
              f"spacing {st[0]['spacing']} (half step {st[0]['spacing'] / 2:.3f}), "
              f"{s['bars']} bars, barlines at {[round(x, 1) for x in s['barlines']]}")
    if font:
        ids = Counter(g["gid"] for g in gs if g["font"] == font)
        print(f"music font {font}: {len(ids)} distinct glyph ids, "
              + ", ".join(f"{g}x{n}" for g, n in ids.most_common(12)))

    notes = []
    heads = {int(x) for x in a.heads.split(",") if x.strip()}
    clefs = [c.strip() for c in a.clefs.split(",")]
    if heads and staves:
        for g in gs:
            if g["font"] != font or g["gid"] not in heads:
                continue
            k = staff_of(g["y"], staves)
            st = staves[k]
            half = st["spacing"] / 2
            step = round((st["bottom"] - g["y"]) / half)          # 0 = bottom line
            sysno = next((s["system"] for s in systems if k in s["staves"]), 1)
            within = next((s["staves"].index(k) for s in systems if k in s["staves"]), 0)
            clef = clefs[within] if within < len(clefs) else clefs[-1]
            notes.append(dict(system=sysno, staff=k, clef=clef, gid=g["gid"],
                              x=g["x"], y=g["y"], step=step, pitch=pitch_of(step, clef),
                              off=round((st["bottom"] - g["y"]) / half - step, 3)))
        notes.sort(key=lambda n: (n["staff"], n["x"], -n["step"]))
        bad = [n for n in notes if abs(n["off"]) > 0.18]
        print(f"noteheads: {len(notes)}"
              + (f"  ** {len(bad)} sit more than 0.18 step off the grid -- check the clef "
                 f"and the staff detection **" if bad else "  (all on the grid)"))

    if a.sheet:
        order = contact_sheet(doc, pno, gs, font, a.sheet, window=a.window)
        print(f"contact sheet -> {a.sheet} ({len(order)} glyph ids). Read it, name every id, "
              f"then re-run with --heads <the notehead ids>.")

    if a.json:
        with open(a.json, "w") as f:
            json.dump(dict(file=a.file, page=a.page,
                           size=[page.rect.width, page.rect.height],
                           staves=staves, systems=systems, music_font=font,
                           glyphs=gs, paths=segs, notes=notes), f, indent=1)
        print(f"json -> {a.json}")


if __name__ == "__main__":
    main()
