# The song document, and getting it into the app

The authority is `src/song.js` (its header comment and `parseSong`) and the
README's "Adding a song". This is the transcriber's-eye view of the same thing.

## Notation

One string per bar per hand. Tokens separated by spaces:

| token | meaning |
|---|---|
| `G4` `Bb3` `C#5` | a pitch, scientific octaves, one eighth long |
| `[G4 Bb4 D5]` | a chord — one attack, several pitches |
| `r` | a rest |
| `:n` | length in eighths; fractions allowed (`:2/3`, `:1/2`, `:4/3`) |
| `~` prefix | tied from the previous token of the same pitch: no new attack, the earlier note is extended |
| `/` prefix | rolled chord, bottom to top |

Lengths in eighths: `:8` whole, `:6` dotted half, `:4` half, `:3` dotted quarter,
`:2` quarter, `:1` (or nothing) eighth, `:1/2` sixteenth, `:1/4` 32nd.

`~` applies per pitch, so a partly-tied chord works: `[F4 A4]:2 ~[F4 A4]` extends
both; `~[A4 D5 F5]` after `[A4 C5 F5]` extends A4 and F5 and attacks D5 fresh — the
parser only warns if *nothing* in the token tied, so a chord that half-ties is
silent. Check those bars against the score by eye.

**Every bar must sum to the meter** — 8 eighths in 4/4, 6 in 6/8 — or `parseSong`
throws, naming the hand and bar.

## Song-level fields

```json
{
  "id": "city-of-stars",
  "title": "City of Stars",
  "sub": "piano arrangement · swing",
  "credit": "Transcribed from <where the score came from>",
  "bpm": 96, "practiceBpm": 60,
  "swing": "2/3",
  "key": "F", "sharps": false,
  "meter": "4/4",
  "beams": "beat",
  "sections": [{ "name": "Intro", "from": 1, "to": 4, "hint": "…", "coach": "…" }],
  "rh": ["r:8", "…"],
  "lh": ["G2 Bb2 D3 G3 ~G3 G3 F3 D3", "…"]
}
```

- **`id`** — kebab-case, and it must equal the file name without `.json`. It is
  also the key the app saves progress under (`middleman.learn.<id>`) and what a
  share link and a phone-mirror session name. **Renaming an id orphans every
  pianist's saved progress and breaks any share link already sent**, so choose it
  once; if you must rename, say so in the commit message.
- **`title` / `sub`** — the two lines of the catalog row. `sub` is a few words:
  arrangement and feel.
- **`credit`** — where the score came from. Say it plainly; it shows on hover.
- **`bpm`** — the performance tempo (the dotted quarter in 6/8). **`practiceBpm`**
  is where the tutor starts; default is 60% of `bpm`, and slower is kinder for a
  piece with fast runs.
- **`swing`** — `"2/3"` or a number; `0.5` (the default) is straight. Set it when
  the score says swing/shuffle, and write straight eighths.
- **`key`** and **`sharps`** — the key name for display, and which way the staff
  spells accidentals. A flat key (F, Bb, Dm, Gm) wants `"sharps": false`.
- **`meter`** — `"4/4"` default; `"6/8"`, `"3/4"`, `"12/8"` all work. Compound
  meters over 8 beat in dotted quarters, so 6/8 is two beats a bar.
- **`beams`** — how the staff groups beams. `"half"` (default) lets 4/4 beam by the
  half bar; `"beat"` stops every beam at the beat. *An arrangement that ties across
  the beat needs `"beat"`*, or a half-bar beam over three eighths and a quarter
  reads as a triplet. (Added with `BEAM_STYLES` in `src/notation/beams.js`; if
  `parseSong` rejects the key, the branch that adds it has not landed yet — leave
  it out and note it.)

## Sections

`sections` are 1-based, inclusive, and drive the tutor's plan and the chips in free
practice. They must tile the song: first `from` is 1, last `to` is the last bar,
and each starts where the previous ended plus one.

Follow the printed form — intro, theme, second time, bridge, turn, outro — rather
than cutting every eight bars. A section is a thing a pianist would name.

- **`hint`** — a sentence or two in the panel: what this section *is*, and what to
  watch for. Say the harmony if it helps ("the vamp moves to C7 and Dm"), and say
  what the hands are doing.
- **`coach`** — optional, one line, **max 120 characters**, said over the music at
  the section's first step. Encouragement plus one concrete thing. Not every
  section needs one.

## Registration — what makes the song appear

1. **`songs/<id>.json`** — the file itself.
2. **`songs/index.json`** — add `"<id>.json"` to `songs`. This is the catalog and
   its order is the order of the rows. Nothing loads a song file that is not here.
3. **`sw.js`** — add `'songs/<id>.json'` to `SHELL` so the song is precached and
   the app opens it offline. (Not every shipped song is listed today; a song left
   out still works online.)
4. **Tests** — `test/learn.test.mjs` parses every file in `songs/` and asserts that
   everything `index.json` lists exists, so a new song is already covered. If you
   want it asserted by name (bars, key, sections, a landmark pitch), add a test
   there in the shape of the "Let It Be" one.
5. **README** — the "Adding a song" section documents the notation, not the
   catalog, so a new song needs no README change unless you added a *field*.

Then `npm test`, and open the app to see the row.
