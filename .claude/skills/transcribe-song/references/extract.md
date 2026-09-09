# Getting the notes off the page

Two paths, and picking the right one is stage 1 of the pipeline. Vector is
measurement; raster is measurement too, just with the grid recovered from ink
instead of read off a path list. Neither is "look at the page and type what you
see" — a vision-only pass over one 59-bar piano piece got nine pitches and ties
wrong, all of them in places that look obvious at page zoom.

## Which path

```bash
python3 .claude/skills/transcribe-song/scripts/score-geom.py score.pdf --page 1
```

- Staff lines, systems and barlines come back → **vector path**. Anything exported
  from MuseScore, Sibelius, Finale, LilyPond or Dorico, and most publisher PDFs.
- "no staff lines found", or the file is a JPG/PNG → **raster path**.
- A PDF that is one big image per page is raster too: `page.get_images()` returns a
  full-page image and `get_drawings()` returns nothing.

`pip install pymupdf` if the import fails. Both paths use it; `import pymupdf`
(the old name `fitz` still works and warns).

## Vector path

### What is a glyph and what is a path

Everything with a shape from the music font is a **glyph** with an exact origin:
noteheads, clefs, accidentals, rests, flags, fermatas, the arpeggio squiggle,
tuplet numerals. Everything drawn is a **path**: staff lines, stems, beams, ledger
lines, ties, slurs, augmentation dots (a tiny filled circle or curve), barlines,
brackets.

`score-geom.py --json` gives you both, already classified, plus the staff grid.
The pieces of it worth understanding, because you will write follow-up queries
against the JSON:

```python
page.get_texttrace()   # spans; each span['chars'] is (ucs, glyph_id, origin, bbox)
page.get_drawings()    # paths; each has 'items' of ('l',p1,p2) ('re',rect) ('c',p1..p4) ('qu',quad)
```

The music font's `ucs` is usually `0xfffd` — the glyphs are addressed by
**font-private glyph id**, not Unicode, so ids mean nothing until you name them.
That is what `--sheet` is for: one labelled, magnified sample of every id with a
crosshair on its origin, in a single image. Read it once, write the mapping into
your notes (`114 = black notehead, 113 = half, 112 = whole, 447 = flat, 448 =
natural, 449 = sharp, 429 = quarter rest, 430 = eighth rest, 825 = fermata`, for
one MuseScore export), and pass the notehead ids to `--heads`.

### Pitch

`spacing` is the distance between staff lines; **one diatonic step is half of it**.
With the bottom line at `bottom`:

```
step  = round((bottom - notehead_y) / (spacing / 2))     # 0 = bottom line
pitch = "E4" + step  in treble,  "G2" + step  in bass
```

`score-geom.py --heads … --clefs treble,bass` does exactly this and reports `off`,
how far each head sits from the grid. Every head should be within ~0.1 of a step.
If many are not, the clef list is wrong or two systems got merged — fix that before
believing a single pitch.

This is *before* the key signature and accidentals. Apply those yourself, per bar,
in the order printed: key signature first, then any accidental in the bar, carrying
forward to the end of the bar at that pitch and octave. See `traps.md`.

An accidental belongs to the notehead **at its own y**, not the nearest one. In a
cluster the accidentals stack in a column to the left and the one nearest the stem
is rightmost — so match them by y, not by reading order. When two candidates sit a
step apart, measure: crop at 1600+ dpi and compare the accidental's cross-bar
centres with the notehead centres. That is the difference between `[A3 Bb3 C#4 E4]`
(A7♭9) and `[A3 B3 C#4 E4]` (A9).

### Duration

Written duration = notehead type + beams/flags + dots. Nothing else.

| what | how to see it |
|---|---|
| whole / half / black head | different glyph ids — the contact sheet names them |
| stem | a `vline` path touching the head's x, running ~3.5 spaces |
| beam / flag count | horizontal filled rects stacked over the stem end; a slanted beam is a 4-line filled path, and a flag is a glyph |
| augmentation dot | a small filled dot ~0.9 space right of the head, on a space (never on a line) |
| tuplet | a numeral glyph, with or without a bracket path, over the group |

One beam = eighth, two = sixteenth, three = 32nd. A note with no beam and no flag
and a stem is a quarter; no stem is a whole. In eighths (the unit the song notation
uses): whole `:8`, half `:4`, quarter `:2`, eighth `:1`, sixteenth `:1/2`, 32nd
`:1/4`. A dot adds half: dotted quarter `:3`, dotted half `:6`. A triplet eighth is
`:2/3`; a septuplet sixteenth `:2/7`.

### Ties

A tie is a `c` (bezier) path — usually a *pair* of them, the two edges of the arc —
joining two noteheads **of the same pitch**, its ends level with those heads. Match
by: both endpoints within a step of the same y, x spanning from just after one head
to just before the next of that pitch.

A slur is the same primitive over *different* pitches; an articulation is a glyph,
not a path. In MuseScore exports the tiny 3×3 pt arcs that look like accents at page
zoom are ties — see `traps.md`, this cost nine bars once.

Across a system or page break a tie is drawn as **two fragments**: one trailing off
the end of one system, one just after the next system's key signature. Both belong
to one tie. A fragment right after a key signature always means "this bar's first
note is tied in from the previous bar" — write `~` on it.

### Bars and systems

`score-geom.py` reports the barlines of each system, so bars-per-system is
`len(barlines) - 1`. Turn that into a page → bar-number map before transcribing
anything (stage 1), and check it against the printed rehearsal numbers over each
system: engraved scores number the first bar of each system, which is a free,
independent check that you have not lost or gained a bar.

## Raster path (photo, scan, JPG)

PyMuPDF opens an image like a one-page document, so the same crop machinery works:

```bash
python3 .claude/skills/transcribe-song/scripts/score-crop.py page.jpg \
    --frac 0.05,0.28,0.95,0.44 --scale 4 --out /tmp/sys3.png
```

Then recover the grid from ink instead of from paths:

```python
import numpy as np, pymupdf
pm = pymupdf.open("page.jpg")[0].get_pixmap(matrix=pymupdf.Matrix(4, 4))
a  = np.frombuffer(pm.samples, np.uint8).reshape(pm.height, pm.width, pm.n)[:, :, 0]
rows = (a < 128).sum(axis=1)                      # ink per row
lines = [y for y in range(len(rows)) if rows[y] > 0.5 * rows.max()]   # staff lines
```

Cluster those rows into runs, take each run's centre, and you have the five staff
lines of a staff — after which pitch is the same arithmetic as the vector path,
`step = round((bottom - head_y) / (spacing / 2))`.

Rules that matter here and not in vector:

- **Upscale before measuring, never after.** `Matrix(4,4)` or more. Half a step at
  page resolution is a couple of pixels, which is inside the noise.
- **Deskew first if the staff lines are not level.** Fit a line through one staff
  line's ink; if it drifts more than a third of a step across the system, rotate
  (`page.set_rotation`, or crop system by system so the drift stays small).
- **Measure noteheads as blobs**, not by eye: threshold, find connected components
  of about one space across, take each centroid's y.
- Never read a raster staff at a magnification where you cannot tell a line from a
  space in the rendered image you are looking at. If you cannot, crop tighter.

## Looking, at the end

Every path ends the same way: **crop and look**. Measurement settles what a thing
is; a crop confirms the measurement was of the thing you thought.

```bash
# by geometry
python3 .claude/skills/transcribe-song/scripts/score-crop.py score.pdf --page 3 \
    --rect 86,110,300,180 --dpi 600 --out /tmp/b30.png
# or by system and bar, using the detected barlines
python3 .claude/skills/transcribe-song/scripts/score-crop.py score.pdf --page 3 \
    --system 2 --bars 2-3 --dpi 900 --out /tmp/b35.png
```

300 dpi to read a bar's rhythm, 600–900 to settle a notehead's line-or-space, 1600+
to settle which notehead an accidental belongs to. Look at every bar at least once,
and every bar you were unsure about at the highest magnification that fits.
