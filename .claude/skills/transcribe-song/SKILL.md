---
name: transcribe-song
description: >
  Turn a printed piano score — a PDF, a scan, photos of the pages — into a MidiMan
  song in songs/*.json: measured off the score's own geometry rather than read by
  eye, verified by four gates, and registered so it appears in the app. Use this
  whenever someone drops a score, sheet music, or a piece they want playable in
  MidiMan, and equally when fixing, revising, extending or double-checking a song
  that already exists in songs/ against its source. Covers page-to-bar mapping,
  PyMuPDF glyph and path extraction, the compact per-bar notation with its ties and
  tuplets, and the parse / sound / engraving / test gates.
---

# Transcribing a score into a MidiMan song

The end goal this serves is "drop a PDF, a song appears in the app". This is the
agent-driven first version of that: a pipeline with stages that each produce
something checkable, so nobody has to trust a read-through.

The one thing to internalise before starting: **do not transcribe by looking.** A
vision-only pass over a 59-bar arrangement produced nine wrong pitches and ties, all
in bars that looked unambiguous at page zoom. Measure the geometry, then confirm the
measurement with a crop. The scripts here exist to make that the cheap path.

Work in a scratch directory (`/tmp/...`) for crops, dumps and notes; only the song
JSON and the registration edits belong in the repo.

---

## Stage 1 — Intake: what is this, and which bar is where

```bash
python3 .claude/skills/transcribe-song/scripts/score-geom.py SCORE.pdf --page 1
```

It reports staff systems, their spacing, and the barlines of each system.

- **Staves found** → vector path. **Nothing found, or it's a JPG/PNG** → raster
  path. Both are in `references/extract.md`; read it now, it decides everything
  downstream.
- Run it for every page and write a **page → system → bar-number map**. Cross-check
  against the bar numbers printed over each system — engraved scores number the
  first bar of each system, which catches a lost or doubled bar for free.
- Record the total bar count. That is the length of `rh` and `lh`.

Then name the glyphs once, since ids are font-private:

```bash
python3 .claude/skills/transcribe-song/scripts/score-geom.py SCORE.pdf --page 3 --sheet /tmp/glyphs.png
```

Read `/tmp/glyphs.png` (one labelled, crosshaired sample per id) and note which id
is a black / half / whole notehead, a sharp, a flat, a natural, each rest, a
fermata. Then the measured pitch table:

```bash
python3 .claude/skills/transcribe-song/scripts/score-geom.py SCORE.pdf --page 3 \
    --heads 114,113,112 --clefs treble,bass --json /tmp/p3.json
```

It must say **"all on the grid"**. If not, the clefs or the staff detection are
wrong — fix that before believing any pitch.

**Output of this stage:** the page→bar map, the glyph id table, one JSON per page.

## Stage 2 — Structure first

Before any notes, settle and write down:

- **meter**, and whether it changes (a change mid-piece is not representable — say so);
- **key signature**, and whether it changes;
- **tempo and feel** — a "Swing"/"Shuffle" marking means straight eighths written
  plus `"swing": "2/3"`, never swung durations;
- **repeats, 1st/2nd endings, D.S., D.C., codas** — the song is a flat bar list, so
  these must be **written out**, after which the printed bar numbers no longer match
  your indices. Keep both numberings in your map;
- **clef per hand, and every clef change** — both hands in treble is common;
- **pickup bar** — it is bar 1 and must still sum: pad the front with rests;
- **fermatas, pedal, dynamics, hairpins** — not representable; note them for the
  section hints;
- **whether the score is complete and well-formed.** Printed bars are sometimes
  underfull (a rest the engraver left out). Note each one; you will pad it and say
  you did.

## Stage 3 — Bar by bar, as written

Transcribe **as the score prints it**, not as it sounds. An eighth tied over the
beat is `D5 ~D5:2`, never `D5:3` — MidiMan engraves what you wrote, and a collapsed
tie makes the staff beam three eighths, which reads as a triplet.

For each bar, per hand, in order: pitches from the measured table (then key
signature, then accidentals carried through the bar), duration from notehead type +
beams/flags + dots, `~` where a tie arrives, `/` where a roll is printed, `r` for
rests. **One line per bar per hand, and every line sums to the meter.** If a line
does not sum, you misread it — go back to the crop, do not adjust a value to fit.

Confirm every ambiguous bar visually before moving on:

```bash
python3 .claude/skills/transcribe-song/scripts/score-crop.py SCORE.pdf --page 3 \
    --system 2 --bars 2-3 --dpi 900 --out /tmp/b35.png     # then read the image
```

**Read `references/traps.md` before the first bar.** Every entry is something that
has actually gone wrong: accidentals carrying through the bar, cautionary
accidentals, an accidental belonging to the head at its own y, seconds displaced
across the stem, ledger counting in bass clef, octave doublings, tiny arcs that are
ties and not accents, tie fragments after a key signature, tuplets as fractions of
eighths, rolled chords one squiggle per hand, swing as a feel, hands swapped,
underfull bars.

## Stage 4 — The song document

Write `songs/<id>.json`. Fields, conventions and what each one does are in
`references/song-json.md`; the shape is:

```json
{ "id": "…", "title": "…", "sub": "…", "credit": "where the score came from",
  "bpm": 96, "practiceBpm": 60, "swing": "2/3", "key": "F", "sharps": false,
  "meter": "4/4", "beams": "beat",
  "sections": [{ "name": "Intro", "from": 1, "to": 4, "hint": "…", "coach": "…" }],
  "rh": ["…"], "lh": ["…"] }
```

Two that are easy to miss: **`"beams": "beat"`** if the arrangement ties across the
beat (otherwise the staff beams by the half bar and syncopations read as triplets),
and **sections that follow the printed form** — intro, theme, second time, bridge,
turn, outro — tiling the whole song with a `hint` each and a `coach` line under 120
characters where one helps.

## Stage 5 — The gates

Run all four. Each one catches a different class of mistake and none subsumes another.

**(a) Parse gate** — the bar sums, the ties, the id, the registration, the sections:

```bash
node .claude/skills/transcribe-song/scripts/song-check.mjs songs/<id>.json
```

Zero FAILs. A "tie with nothing to tie to" is a real error: the `~` is on a pitch
that was not sounding.

**(b) Written vs sounding** — only when revising an existing transcription, but then
always. Rewriting bars "as written" changes most of the text while the *music* must
stay identical everywhere you did not deliberately correct:

```bash
node .claude/skills/transcribe-song/scripts/compare-notes.mjs --old HEAD --new songs/<id>.json --table
```

Every bar comes back **SAME** (text identical), **DISPLAY-ONLY** (text changed,
sound identical) or **SOUND-DIFF** (the music changed). Review each SOUND-DIFF
against the score and decide; a fourth class, **UNSURE**, is yours to mark in your
notes when the score cannot settle it — go back to a 1600 dpi crop rather than
guessing. Then re-run as a gate with the bars you verified:

```bash
node .claude/skills/transcribe-song/scripts/compare-notes.mjs --old HEAD --new songs/<id>.json \
     --expect 18,28,29,30,33,41,42,46,56
```

An unexpected SOUND-DIFF is a bar you broke while rewriting; an expected bar that
did not change is a correction that did not land.

**(c) Engraving gate** — the app's own staff, for every bar:

```bash
node .claude/skills/transcribe-song/scripts/check-pairing.mjs --song <id> --port 8850
node .claude/skills/transcribe-song/scripts/shot-staff.mjs  --song <id> --bars 1-59 --per 4 \
     --out /tmp/shots --port 8850
```

`check-pairing` must print zero warnings — a "voice N has X engraved elements for Y
cells" means the bar's text and its engraving have come apart, which no test
catches and which silently kills the staff's highlighting. Then **look at every
shot** against the source crop for the same bars: beams, ties, chord shapes, octaves.
This is the stage that finds an octave error, and it only works if you actually read
the images.

**(d) The suite:**

```bash
npm test
```

**(e) An audible sanity read** of your own text, once through: are the chords spelled
sensibly for the key (a flat key spelling a G♯?), is the left hand below the right
(`song-check.mjs` prints both ranges), does the melody move by steps and thirds
rather than jumping a sixth and back, do repeated sections have identical bars where
the score repeats literally?

## Stage 6 — Register it

Per `references/song-json.md`:

1. `songs/index.json` — add `"<id>.json"` to `songs` (nothing loads a file that is
   not listed);
2. `sw.js` — add `'songs/<id>.json'` to `SHELL` so it opens offline;
3. tests — `test/learn.test.mjs` already parses every song and checks the index; add
   a by-name test there if the song deserves asserting (bars, key, sections, a
   landmark pitch);
4. README — only if you introduced a *field*; the "Adding a song" section documents
   the notation, not the catalog.

**The id is the key saved progress lives under** (`middleman.learn.<id>`) and what
share links carry, so renaming an id orphans everyone's progress and breaks links
already sent. Choose it once; if it must change, say so in the commit message.

## Stage 7 — Fixing an existing transcription

Do not rewrite from scratch — you lose the parts that were right and gain new
errors. Instead:

1. read the current bars for the range in question;
2. transcribe the same bars from the score, as written, per stages 1–3;
3. build the comparison table — one row per bar per hand, *PDF as written* vs
   *current JSON*, classified SAME / DISPLAY-ONLY / SOUND-DIFF / UNSURE, with a
   sentence of evidence (a measured y, a ledger line, a tie rectangle) for every
   SOUND-DIFF and UNSURE;
4. edit only the bars the table says to;
5. gate (b) with `--expect` set to exactly the SOUND-DIFF bars, then (a), (c), (d).

A table like that is also the right thing to paste into the PR body: it is the
evidence that the 50 bars you did not touch are untouched.

---

## Checklist

- [ ] page → system → bar map, checked against the printed bar numbers
- [ ] vector or raster path chosen; glyph ids named from the contact sheet
- [ ] pitch table "all on the grid"
- [ ] meter, key, tempo, feel, clefs, repeats written out, pickup, fermatas noted
- [ ] every bar transcribed as written; every line sums; ambiguous bars crop-checked
- [ ] traps.md re-read against the finished text
- [ ] song JSON with credit, sections tiling the piece, `beams`/`meter`/`swing` set
- [ ] `song-check.mjs` clean
- [ ] `compare-notes.mjs --expect` clean (when revising)
- [ ] `check-pairing.mjs` zero warnings; staff shots read against the score
- [ ] `npm test` green
- [ ] index.json, sw.js, tests updated

## Scripts

| script | what it does |
|---|---|
| `scripts/score-geom.py` | staves, systems, barlines, glyph contact sheet, measured notehead pitches → JSON |
| `scripts/score-crop.py` | a crop of a page, a system or a bar range at any dpi (PDF or image) |
| `scripts/song-check.mjs` | parse gate + id, index, sections, coach length, hand ranges |
| `scripts/compare-notes.mjs` | SAME / DISPLAY-ONLY / SOUND-DIFF per bar against a file or git ref |
| `scripts/check-pairing.mjs` | the app's staff engraves one element per cell, every bar |
| `scripts/shot-staff.mjs` | PNGs of the app's staff, a few bars at a time, to read |

The Python ones need `pip install pymupdf`. The Node ones need only node and
python3 (they run the repo's own `serve.py`), plus Playwright's Chromium for the two
that drive the app. All run from the repo root.

## References

- `references/extract.md` — the vector and raster extraction recipes, and how pitch,
  duration and ties are actually measured
- `references/traps.md` — everything that has gone wrong before; read it twice
- `references/song-json.md` — the notation, every song field, and registration
