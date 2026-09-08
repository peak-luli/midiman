# Handoff — River Flows in You (Learn)

Paused 2026-09-08 for Claude. Token budget. Do not continue as this CloudAgent.

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
- `songs/river-flows-in-you.json` — 49 bars, A minor, sections Intro / Theme / Theme 2 / Outro.
- `songs/index.json` lists it after Let It Be.
- Learn transport + views (engine, staff, roll, fall, scroll, laptop app) use `song.beatsPerBar` instead of a hardcoded 4.
- Staff engraves `M:6/8` and beams with `meter(6, 8)`.
- Tests added; **full suite green** (`node --test test/*.test.mjs`: 563 pass, 17 skip).
- Draft PR #82 open.
- Source sheet is already on issue #81 (see §5). A later CloudAgent comment also mirrored it from this branch.

### Not done

- **No browser verify.** AC1–AC4 not ticked. No laptop/phone full-viewport shots.
- **No `user-attachments` images.** `gh issue comment --attach` failed (`unsupported authentication type` — GitHub App `ghs_` token). `MIDIMAN_GITHUB_TOKEN` was a dead PAT (401). ManagePullRequest rewrote the sheet to a **cursor.com artifact** — do not use that for the ticket or AC proof.
- PR body still says shots “will follow.”
- Sheet JPG was on this branch; **removed 2026-09-08** (Miriam: song PR must not carry the binary). Sheet stays on #81 / `docs/river-flows-sheet-81` only.
- Arrangement is a **simplified** MidiMan Learn piece matching the brief (Am, 6/8, LH A–F–C–G arpeggios, RH A–G♯–A–B motif). Vision reads of the JPG disagreed on some bars; compare to the sheet on #81 and tighten if Miriam/Ishay say it is not the sheet.

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
| Intro | 1–4 | RH rest; LH Am–F–C–G eighth arpeggios |
| Theme | 5–28 | Motif + 1st/2nd endings written through once |
| Theme 2 | 29–42 | Same river, a few more sixteenths |
| Outro | 43–49 | Held dotted halves; final Am chord |

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

- [ ] **AC1** — Learn on laptop lists **River Flows in You**; opens without error. Full-viewport laptop shot.
- [ ] **AC2** — Free practice (and Tutor if present) playable; notes score; early bars completable as a simple real song.
- [ ] **AC3** — Opening recognizable vs sheet: A minor, 6/8, LH arpeggio + RH melody.
- [ ] **AC4** — Phone Learn (`learn-m.html`) opens it; staff or Scroll usable. Full-viewport phone shot.

## 7. Out of scope

- Full commercial engraving / every ornament from every published edition
- Pedagogy rewrite of City of Stars
- New UI chrome beyond listing/playing the song

## 8. Next steps for Claude (ordered)

1. Read #81 + comments + this doc + PR #82. Do not invent a different piece than the sheet.
2. Sheet binary is already off this PR. Do **not** add `docs/shots/river-flows-in-you/` back.
3. If you have a token/`gh --attach` that works: put a **user-attachments** markdown image of the sheet on #81 (in addition to the existing docs-branch image).
4. Compare `songs/river-flows-in-you.json` to the sheet. Fix notes if the opening or form is wrong; keep it Let It Be–simple.
5. `./serve.sh` (or `./serve.sh --local 8765`). Open `http://127.0.0.1:8765/learn.html`.
6. Verify AC1–AC3: song in the list, opens, Free practice + Tutor, Intro/Theme chips, Guide, early bars score. Confirm 6/8 staff (`M:6/8`) and LH arpeggio + RH motif.
7. Open `http://127.0.0.1:8765/learn-m.html` at a phone viewport (e.g. 390×844). AC4.
8. Take **full-viewport** laptop + phone shots. Upload as GitHub **user-attachments** on PR #82 (and the issue if required). No cursor.com artifact links.
9. Update PR #82 body: Fixes #81, sheet comment link, 6/8 note, AC shots. Keep **draft** until eng is done; do not merge.
10. Path after you: eng review → Miriam product-check → Ready for Ishay.

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
