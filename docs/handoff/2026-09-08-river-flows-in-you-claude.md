# Handoff — River Flows in You (Learn)

> **2026-09-09:** the song was renamed to **Perfect** (`songs/perfect.json`, id `perfect`) because the sheet this was transcribed from is Ed Sheeran's *Perfect* in C major, not Yiruma's River Flows in You. History below is left as it was written.


Paused 2026-09-08 for Claude. Token budget. Do not continue as this CloudAgent.

**Updated 2026-09-08 by Claude:** the arrangement now matches the sheet and AC1–AC4 are verified.
What is left needs push access to this repo — see §8.

## 1. Goal + issue

**Goal:** Add **River Flows in You** (Yiruma) to MidiMan Learn as a beginner-friendly real song (Let It Be difficulty bar — not City of Stars hard), from Ishay’s attached piano sheet.

**Issue:** https://github.com/peak-luli/midiman/issues/81

**PR (draft, do not merge):** https://github.com/peak-luli/midiman/pull/82

**Working branch:** `cursor/river-flows-in-you-f141`

**HEAD when paused:** `8148c0f7ed62acd83ca11fe2644e5e9dc22b76c4`

## 2. Process

Hibernation exception — Building was kicked immediately.

Path: **eng → eng review → Miriam product-check → Ready for Ishay → Ishay Approved → merge.**

Ishay plays before approve. Do **not** merge this PR.

## 3. Progress so far

### Done

- Optional **6/8** song meter: `"meter": "6/8"` → 6 eighths/bar, dotted-quarter beat (`beatsPerBar = 2`). Existing 4/4 songs unchanged (still 8 eighths / 4 beats).
- `songs/river-flows-in-you.json` — 49 bars, A minor, sections Theme / Bridge / Theme 2 / Outro.
- `songs/index.json` lists it after Let It Be.
- Learn transport + views (engine, staff, roll, fall, scroll, laptop app) use `song.beatsPerBar` instead of a hardcoded 4.
- Staff engraves `M:6/8` and beams with `meter(6, 8)`.
- Tests added; **full suite green** (`node --test test/*.test.mjs`: 563 pass, 17 skip).
- Draft PR #82 open.
- Source sheet is already on issue #81 (see §5). A later CloudAgent comment also mirrored it from this branch.

### Done in the second pass (Claude, 2026-09-08)

- **The arrangement now matches the sheet.** The first pass came from a vision read that had the
  piece wrong. The scan was re-read bar by bar — staff lines and noteheads measured off the JPG
  rather than eyeballed — and the song JSON was rewritten:

  | | first pass | the sheet |
  |---|---|---|
  | chord loop | Am–F–C–G, one bar each | **C–Am–F–G, two bars each** (bars 1–16, 33–40) |
  | accidentals | RH motif on A–G♯–A–B | **none** — no key signature, nothing off the white keys |
  | bars 1–4 | left-hand-only intro | **both hands from bar 1**; there is no intro |
  | bars 17–32 | part of one long Theme | **bridge**: chords move once a bar, Am–F–C–G ×4 |
  | held notes | — | bars 7/15/39 are a **D tied over the barline**; ends on Am held over the last two bars |

  Sections are now **Theme (1–16) / Bridge (17–32) / Theme 2 (33–42) / Outro (43–49)**.
- Deliberately still simplified, per “not a full engraving”: the bridge’s dotted-eighth+sixteenth
  ornaments and the outro’s sixteenth runs.
- **The left hand is an octave below the sheet.** The sheet puts both hands in treble, around
  F3–G4. In MidiMan the left hand engraves in bass clef, where that is ledger lines all the way
  down, and it crowds the tune. Same chords, same shape, one octave lower.
- `test/learn.test.mjs` now asserts the sheet: C-major arpeggio in bar 1, RH from bar 1 on E5,
  no black keys anywhere, the tie in bar 7, the final Am chord, hands not overlapping.
  **Suite green: 563 pass, 17 skip, 0 fail.**
- **AC1–AC4 verified in a real browser** (headless Chromium against `./serve.sh --local 8765`),
  full-viewport shots taken at 1440×900 and 390×844 / 844×390. See §6.

### Not done

- **Nothing reached GitHub from that session.** The Claude Code web session was authorized to
  *read* `peak-luli/midiman` but not to write it: `git push` is refused by the git proxy
  (“not in this session’s authorized repository set”), and every `api.github.com` /
  `gh api repos/...` call 403s with “GitHub access to this repository is not enabled for this
  session. Use add_repo to request access” — and no `add_repo` tool was offered. So the commit,
  the `user-attachments` upload and the PR body edit all still need a session (or a human) with
  push access to this repo. The shots and the commit were handed to Ishay in the session instead.
- PR body still says shots “will follow.”
- Sheet JPG was on this branch; **removed 2026-09-08** (Miriam: song PR must not carry the binary). Sheet stays on #81 / `docs/river-flows-sheet-81` only.

### Files changed vs `main` (at HEAD above)

| File | Change |
|---|---|
| `src/song.js` | `parseMeter`, per-song `barEighths` / `beatsPerBar` / `eighthsPerBeat` |
| `src/learn/engine.js` | loop + count-in + metronome accent from `beatsPerBar` |
| `src/learn/staff.js` | `M:6/8`, 6/8 beaming, grid/playhead use `beatsPerBar` |
| `src/learn/roll.js`, `fall.js`, `scroll.js`, `app.js` | bar math from `beatsPerBar` |
| `songs/river-flows-in-you.json` | new song |
| `songs/index.json` | catalog entry |
| `sw.js` | precache new song, bump `mm-learn-v6` |
| `README.md` | document optional `meter` |
| `test/learn.test.mjs`, `engine.test.mjs`, `staff-abc.test.mjs`, `staff-drag.test.mjs` | 6/8 + River Flows |
| `docs/shots/river-flows-in-you/source-sheet.jpg` | **removed from this PR** — do not put it back |

There is **no** `songs/README.md`. Notation lives in the repo root `README.md` (“Adding a song”) and the parser in `src/song.js`. `src/notation.js` is the **Practice** page’s abcjs helper (4/4 blues/tracks), not Learn songs.

## 4. Song format + 6/8 encoding

Follow existing songs:

- `songs/let-it-be.json` — 4/4, 8 eighths/bar, simple real song (difficulty bar to match)
- `songs/city-of-stars.json` — 4/4, harder; do not copy its density
- `songs/index.json` — catalog order

Per hand, one string per bar. Tokens: pitch `A4`, chord `[A4 C5 E5]`, rest `r`; `:n` length in eighths; `~` tie; `/` roll.

**4/4 (default):** every bar sums to **8** eighths. Beat = quarter. `b = bar * 4 + eighths / 2`.

**6/8 (this song):** `"meter": "6/8"`. Every bar sums to **6** eighths. Beat = **dotted quarter** (2 beats/bar) so the click and staff feel in 2. `bpm` / `practiceBpm` are dotted-quarter (64 / 48 here).

```js
// src/song.js — already shipped
parseMeter('6/8')
// barEighths = 6, eighthsPerBeat = 3, beatsPerBar = 2
// b = bar * beatsPerBar + c.at / eighthsPerBeat
```

Keep 4/4 compatible. Do not hardcode `4` again in Learn loop/staff/roll/fall.

River Flows sections (1-based, as in the JSON):

| Section | Bars | Notes |
|---|---|---|
| Theme | 1–16 | Both hands from bar 1. RH E5 falling to C; LH C–Am–F–G triad arpeggios, two bars a chord. Bars 7 and 15 are a held D tied over the barline. |
| Bridge | 17–32 | Chords move once a bar: Am–F–C–G, four times round. RH answers an octave up over long held notes. Ornaments simplified. |
| Theme 2 | 33–42 | The tune again (33–40), then a two-bar walk down (41–42). |
| Outro | 43–49 | LH holds one long note a bar; RH rolls up. Final Am chord tied across the last two bars. |

## 5. Source sheet — do not merge the binary

**Already on the ticket** (use this, not cursor.com):

https://github.com/peak-luli/midiman/issues/81#issuecomment-5589399074

Image:

`https://raw.githubusercontent.com/peak-luli/midiman/docs/river-flows-sheet-81/docs/shots/river-flows-in-you/source-sheet.jpg`

Branch: **`docs/river-flows-sheet-81`** (docs-only; leave it).

**Do NOT merge** `docs/shots/river-flows-in-you/` or the sheet binary onto `main`. Removed from this song PR. Ticket + `docs/river-flows-sheet-81` hold the source of truth. Song PR = song JSON + index + app wiring + proof screenshots as user-attachments.

A true GitHub `user-attachments` copy of the sheet is still welcome if Claude can upload (browser, or `gh issue comment --attach` with an OAuth/classic PAT — not the CloudAgent `ghs_` token).

## 6. Acceptance (from #81)

Full-viewport shots = entire app window (chrome + content). Staff-only crops fail. Host shots as **`github.com/user-attachments` only** — not cursor.com artifacts, not raw.githubusercontent if the eng bar requires user-attachments.

All four were run on 2026-09-08 against `./serve.sh --local 8765` in headless Chromium at
1440×900 (laptop) and 390×844 / 844×390 (phone). Shots are full-viewport. They are **not yet on
the PR** — see “Not done”.

- [x] **AC1** — Learn on laptop lists **River Flows in You** (`simple piano · A minor · 6/8`),
      third in the song list. It opens with no page error and no failed request but `favicon.ico`,
      which 404s on every page of the app. Shot: `laptop-learn-river-flows.png`.
- [x] **AC2** — Tutor builds a **31-step** plan (Listen → each hand → together, per section).
      Free practice loops bars 1–8 and scores: injected notes through `window.__mm.demo(1)` gave
      **PASS 1/2 · 100%** with the challenge on “2 passes in a row at 85%”. Same shot.
- [x] **AC3** — The staff engraves `M:6/8` on both clefs, two beats to the bar. Bar 1 is two
      dotted-quarter E5s, bar 2 falls E5–D5–C5, the left hand climbs the C major arpeggio, and
      bar 7 is the held D tied over the barline — the sheet's opening. Same shot.
- [x] **AC4** — Phone `learn-m.html` lists it (`… · 6/8 · 49 bars`, “Start: Theme · Listen”),
      Begin opens the lesson path, and sideways the **Scroll** view engraves and slides under the
      playhead. Shots: `phone-learn-river-flows.png`, `phone-scroll-river-flows.png`.

Pre-existing, not from this branch: the phone Scroll view logs
`<g> attribute transform: Expected number, "translate(Infinity,0)"` during playback. It does the
same on **Let It Be** and **City of Stars**, which are untouched 4/4 songs, and nothing renders
wrong. Out of scope here; worth its own ticket.

## 7. Out of scope

- Full commercial engraving / every ornament from every published edition
- Pedagogy rewrite of City of Stars
- New UI chrome beyond listing/playing the song

## 8. Next steps (ordered)

Steps 1–7 of the old list are done — see §3 and §6. What is left is everything that needs
**push access to `peak-luli/midiman`**, which the session that did the work did not have.

1. Land the commit `Match River Flows in You to the sheet on #81` on
   `cursor/river-flows-in-you-f141` (it was handed over as a patch, not pushed).
2. Upload the three shots from §6 as **`github.com/user-attachments`** on PR #82 — drag them into
   the PR body in the web UI, or `gh` with an OAuth/classic PAT. **No cursor.com artifact links**,
   and do not commit them: `docs/shots/river-flows-in-you/` stays off this PR.
3. Update the PR #82 body: `Fixes #81`, the sheet comment link from §5, the 6/8 note, what the
   second pass changed, and the AC1–AC4 shots. Keep it **draft**; do not merge.
4. A `user-attachments` copy of the sheet on #81 is still welcome, alongside the docs-branch image.
5. Path after that: eng review → Miriam product-check → Ready for Ishay.

Two calls for the product-check to look at, both deliberate and both written down above:
the left hand sits an octave below the sheet (§3), and the bridge/outro ornaments are simplified.

## 9. Verify locally

```bash
./serve.sh --local 8765
# laptop Learn
open http://127.0.0.1:8765/learn.html
# phone Learn
open http://127.0.0.1:8765/learn-m.html
```

Pick **River Flows in You** in the song list. Switch to **Free practice**. Intro is LH-only (4 bars). Theme starts bar 5. Sections chips: Intro / Theme / Theme 2 / Outro / whole song. Tutor path is the usual listen → hands → together plan from `src/learn/plan.js`.

```bash
node --test test/*.test.mjs
```

Should stay green. River Flows / 6/8 coverage is in `test/learn.test.mjs`, `test/staff-abc.test.mjs`, `test/engine.test.mjs`, `test/staff-drag.test.mjs`.
