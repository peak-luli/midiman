// Sounding -> written: a piece turned back into the bar strings a song file keeps, in
// one canonical spelling that `parseSong` reads back as the same sound. Per hand and
// bar: every onset and every note end is a cell boundary, a note still sounding at one
// continues as a `~` cell, silence is a rest, and the house rule spells anything that
// starts off the beat as a tie over the next beat line rather than a syncopated value.
//
// A `~` prefix ties every pitch of its cell, and `parseSong` resolves it per pitch: in
// `~[G4 B4]` a G4 that is open is extended and a B4 that is not is a new attack. So a
// cell that mixes held and new pitches writes fine. What it cannot say is a pitch
// re-struck at the moment its own last note ends *inside* a tied cell -- parseSong
// would tie the re-strike on instead of hearing it -- nor two notes of one pitch
// overlapping in one hand. Both want a second voice per hand, which v1 does not have,
// so writeSong refuses them by name (`canWrite` returns the same sentence) instead of
// writing something that sounds different from what you played.

import { parseMeter } from '../song.js';
import { melodyOf } from '../looper/loops.js';
import { barsOf, swingOf, validate } from './piece.js';

const EPS = 1e-6;
const MAX_DEN = 16;          // the biggest denominator a written length may need, e.g. `:2/7`

const SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

/** MIDI number -> the scientific name `pitchOf` reads back, spelled the song's way. */
const spell = (n, sharps) => (sharps ? SHARP : FLAT)[((n % 12) + 12) % 12] + (Math.floor(n / 12) - 1);

/** A length in eighths as `parseLen` writes it, or null if no small fraction fits. */
function lenText(e) {
  for (let q = 1; q <= MAX_DEN; q++) {
    const p = Math.round(e * q);
    if (p > 0 && Math.abs(e * q - p) < EPS) return q === 1 ? String(p) : `${p}/${q}`;
  }
  return null;
}

const offGrid = (hand, bar, n, beat, sharps) => new Error(
  `${hand} bar ${bar}: note ${spell(n, sharps)} at beat ${+beat.toFixed(2)} is off the grid — Quantise first`);

const twoVoices = (hand, bar, n, beat, sharps, why) => new Error(
  `${hand} bar ${bar}: note ${spell(n, sharps)} at beat ${+beat.toFixed(2)} ${why} — that needs a second voice`);

const onBeat = (e, epb) => Math.abs(e / epb - Math.round(e / epb)) < EPS;

/** One hand of the piece as `nbars` bar strings. */
function handBars(piece, hand, nbars, m) {
  const { beatsPerBar, eighthsPerBeat: epb, barEighths } = m;
  const sharps = !!piece.sharps;
  const notes = piece.notes
    .filter(n => n.hand === hand && n.len > EPS)
    .sort((a, b) => a.b - b.b || a.n - b.n);

  // one voice per hand: two notes of a pitch cannot sound at once in it
  const open = new Map();
  for (const n of notes) {
    const prev = open.get(n.n);
    if (prev && n.b < prev.b + prev.len - EPS)
      throw twoVoices(hand, Math.floor(n.b / beatsPerBar) + 1, n.n,
        n.b - Math.floor(n.b / beatsPerBar) * beatsPerBar, sharps, 'overlaps another of the same pitch');
    if (!prev || n.b + n.len > prev.b + prev.len) open.set(n.n, n);
  }
  const endsAt = (pitch, beat) => notes.some(q => q.n === pitch && Math.abs(q.b + q.len - beat) < EPS);

  const bars = [];
  for (let bi = 0; bi < nbars; bi++) {
    const b0 = bi * beatsPerBar, b1 = b0 + beatsPerBar;
    const segs = [];
    for (const n of notes) {
      if (n.b + n.len <= b0 + EPS || n.b >= b1 - EPS) continue;
      segs.push({
        note: n, n: n.n,
        s: (Math.max(n.b, b0) - b0) * epb,          // eighths into the bar
        e: (Math.min(n.b + n.len, b1) - b0) * epb,
        attack: n.b > b0 - EPS,                     // false = tied over the bar line
      });
    }

    // every onset and end is a boundary; the house rule adds the beat line an offbeat
    // note runs over, so it reads as an eighth tied on rather than a syncopation
    const cuts = [0, barEighths];
    for (const g of segs) {
      cuts.push(g.s, g.e);
      if (g.attack && !onBeat(g.s, epb)) {
        const line = (Math.floor(g.s / epb + EPS) + 1) * epb;
        if (line < g.e - EPS) cuts.push(line);
      }
    }
    const at = [];
    for (const c of cuts.sort((x, y) => x - y))
      if (c > -EPS && c < barEighths + EPS && (!at.length || c - at[at.length - 1] > EPS)) at.push(c);

    const toks = [];
    for (let k = 0; k + 1 < at.length; k++) {
      const a = at[k], z = at[k + 1];
      const abs = b0 + a / epb;
      const here = segs.filter(g => g.s <= a + EPS && g.e >= z - EPS);
      // a note whose own onset is behind this boundary is held through it -- including
      // one tied over the bar line, whose segment starts at the bar's own 0
      const held = g => g.note.b < abs - EPS;
      const tie = here.some(held);
      const pitches = [...new Set(here.map(g => g.n))].sort((x, y) => x - y);

      if (tie) for (const g of here) {
        if (held(g) || !endsAt(g.n, abs)) continue;
        throw twoVoices(hand, bi + 1, g.n, a / epb, sharps, 'is struck again under a tie');
      }

      const d = lenText(z - a);
      if (d === null) {
        // the cell is an unwritable length: the note that put a boundary here is the
        // one to name, and where it starts is what the player has to move
        const blame = segs.find(g => [g.s, g.e].some(x => Math.abs(x - a) < EPS || Math.abs(x - z) < EPS));
        if (!blame) throw offGrid(hand, bi + 1, 0, a / epb, sharps);
        throw offGrid(hand, bi + 1, blame.n, blame.note.b - b0, sharps);
      }
      const body = !pitches.length ? 'r'
        : pitches.length === 1 ? spell(pitches[0], sharps)
          : `[${pitches.map(p => spell(p, sharps)).join(' ')}]`;
      toks.push((tie ? '~' : '') + body + (d === '1' ? '' : `:${d}`));
    }
    bars.push(toks.join(' '));
  }
  return bars;
}

/** A piece as a song document -- the shape of `songs/*.json`, ready for `songText`. */
export function writeSong(piece) {
  validate(piece);
  const m = parseMeter(piece.meter ?? '4/4');
  const nbars = barsOf(piece);
  const sw = swingOf(piece);
  const doc = {
    id: piece.id, title: piece.title, sub: piece.sub ?? '', credit: piece.credit ?? '',
    bpm: piece.bpm, practiceBpm: piece.practiceBpm ?? Math.round(piece.bpm * 0.6),
  };
  if (m.label !== '4/4') doc.meter = m.label;
  if (sw !== 0.5) doc.swing = piece.swing;
  // a swung song has to show its beats: a half-bar beam over a tie reads as a triplet
  doc.beams = sw !== 0.5 ? 'beat' : (piece.beams ?? 'half');
  doc.key = piece.key ?? 'C';
  doc.sharps = !!piece.sharps;
  if (piece.clefs) doc.clefs = { ...piece.clefs };
  doc.sections = piece.sections.map(s => {
    const out = { name: s.name, from: s.from, to: Math.min(s.to, nbars) };
    if (s.hint) out.hint = s.hint;
    if (s.coach) out.coach = s.coach;
    return out;
  });
  doc.rh = handBars(piece, 'rh', nbars, m);
  doc.lh = handBars(piece, 'lh', nbars, m);
  return doc;
}

/** The sentence `writeSong` would throw, or null when the piece can be written. */
export function canWrite(piece) {
  try { writeSong(piece); return null; }
  catch (e) { return e.message; }
}

/** A song document as file text: header a key to a line, each bar its own line. */
export function songText(doc) {
  const parts = [];
  const block = (k, items) => `  ${JSON.stringify(k)}: [\n${items.map(x => `    ${x}`).join(',\n')}\n  ]`;
  for (const [k, v] of Object.entries(doc)) {
    if (v === undefined) continue;
    if (k === 'rh' || k === 'lh') parts.push(block(k, v.map(b => JSON.stringify(b))));
    else if (k === 'sections') parts.push(block(k, v.map(s => JSON.stringify(s))));
    else parts.push(`  ${JSON.stringify(k)}: ${JSON.stringify(v)}`);
  }
  return `{\n${parts.join(',\n')}\n}\n`;
}

/**
 * One hand as a `tracks.json` melody. The rules are `looper/loops.js melodyOf`'s --
 * they are the same file at the other end -- so all this has to say is what a piece's
 * notes are: one hand of them, and *straight*, because a piece stores written
 * positions and the track puts the swing back at playback.
 */
export function writeMelody(piece, hand = 'rh', formBars = barsOf(piece)) {
  const m = parseMeter(piece.meter ?? '4/4');
  if (m.label !== '4/4') throw new Error(`a melody is 4/4 only; this piece is ${m.label}`);
  return melodyOf(
    piece.notes.filter(n => n.hand === hand).map(n => ({ b: n.b, p: n.n })),
    { bars: Math.max(1, Math.round(formBars)), swing: 0.5, name: piece.title || 'captured line' },
  );
}
