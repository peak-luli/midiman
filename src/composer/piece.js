// The piece document: the one thing the composer edits, plays and saves -- a header
// and a flat list of sounding notes on a beat grid, exactly the shape `parseSong`
// hands out. Bars, ties, rests and beams are not stored: they are worked out on the
// way to a song file (see write.js), because they are properties of the edition.
//
// This file builds pieces (empty, from a song document, from a recorded take), asks
// the small questions about one, and says plainly when a piece does not hold together.

import { parseSong, parseMeter } from '../song.js';

/** Grid names, and the beats one unit of each is worth in a given meter. */
const GRID_BEATS = {
  '1/8': epb => 1 / epb,           // one eighth
  '1/16': epb => 1 / (2 * epb),    // half an eighth
  '1/8T': epb => 2 / (3 * epb),    // three in the space of two eighths
};

const meterOf = piece => parseMeter(piece?.meter ?? '4/4');

export const beatsPerBarOf = piece => meterOf(piece).beatsPerBar;
export const eighthsPerBeatOf = piece => meterOf(piece).eighthsPerBeat;

/**
 * The swing as a number, however the header spells it: `"2/3"` and `0.6667` mean the
 * same push, and nothing at all means straight. Positions in a piece are always
 * straight -- this is what playback multiplies them out by (`song.js swungBeat`).
 */
export function swingOf(piece) {
  const v = piece?.swing;
  if (v === undefined || v === null || v === '') return 0.5;
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new Error(`swing ${v} is not a number`);
    return v;
  }
  const m = /^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/.exec(String(v).trim());
  if (!m || +m[2] === 0) throw new Error(`swing ${JSON.stringify(v)} is neither a number nor "a/b"`);
  return +m[1] / +m[2];
}

/** How many bars the piece is: the notes and the sections, whichever reaches further. */
export function barsOf(piece) {
  const bpb = beatsPerBarOf(piece);
  let end = 0;
  for (const n of piece?.notes ?? []) end = Math.max(end, n.b + n.len);
  let bars = Math.max(1, Math.ceil(end / bpb - 1e-9));
  for (const s of piece?.sections ?? []) bars = Math.max(bars, s?.to ?? 0);
  return bars;
}

/** The notes of `hands` inside bars [fromBar, toBar], 0-based and inclusive. */
export function notesIn(piece, fromBar, toBar, hands = ['lh', 'rh']) {
  const bpb = beatsPerBarOf(piece);
  return (piece?.notes ?? []).filter(n => {
    const bar = Math.floor(n.b / bpb + 1e-9);
    return bar >= fromBar && bar <= toBar && hands.includes(n.hand);
  });
}

/** A new array in playing order: by beat, then bottom note up. The input is untouched. */
export const sortNotes = notes => [...(notes ?? [])].sort((a, b) => a.b - b.b || a.n - b.n);

export function emptyPiece(header = {}) {
  const bpm = header.bpm ?? 90;
  return {
    v: 1,
    id: 'untitled', title: 'Untitled', sub: '', credit: '',
    bpm, practiceBpm: Math.round(bpm * 0.6),
    meter: '4/4', swing: 0.5, key: 'C', sharps: false, beams: 'half', clefs: undefined,
    sections: [{ name: 'Whole song', from: 1, to: 1, hint: '', coach: '' }],
    grid: '1/8',
    notes: [],
    raw: null,
    ...header,
  };
}

/** Does every note sit on this grid, onset and length alike? */
function fits(notes, grid, epb) {
  const u = GRID_BEATS[grid](epb);
  return notes.every(n => {
    for (const x of [n.b, n.len]) if (Math.abs(x / u - Math.round(x / u)) > 1e-6) return false;
    return true;
  });
}

/**
 * The coarsest grid the whole piece already sits on -- eighths if it can, then
 * sixteenths, then triplet eighths. `null` means no single grid holds it (a raw take,
 * or a piece with tuplets that are not eighth triplets), which is what Quantise is for.
 */
function gridOf(notes, epb) {
  for (const g of ['1/8', '1/16', '1/8T']) if (fits(notes, g, epb)) return g;
  return null;
}

/** A song document (the raw JSON, not a parsed song) as a piece. */
export function fromSong(doc) {
  const song = parseSong(doc);
  const notes = sortNotes(song.notes.map(n => ({
    b: n.b, len: n.len, n: n.n, hand: n.hand, v: n.hand === 'lh' ? 68 : 80,
  })));
  // sections come back 0-based from parseSong; a piece keeps them as the file writes them
  const sections = (doc.sections ?? song.sections.map(s => ({ ...s, from: s.from + 1, to: s.to + 1 })))
    .map(s => ({ name: s.name, from: s.from, to: s.to, hint: s.hint ?? '', coach: s.coach ?? '' }));
  return {
    v: 1,
    id: doc.id, title: doc.title, sub: song.sub, credit: song.credit,
    bpm: doc.bpm, practiceBpm: song.practiceBpm,
    meter: song.meter, swing: doc.swing ?? 0.5,
    key: song.key, sharps: song.sharps, beams: song.beams,
    clefs: doc.clefs ? { ...doc.clefs } : undefined,
    sections,
    grid: gridOf(notes, song.eighthsPerBeat),
    notes,
    raw: null,
  };
}

/**
 * A take -- `buffer.slice()`'s `{ b, len, p, v }` -- as a piece. Nothing is quantised
 * and nothing is thrown away: `grid` is null and the take is kept in `raw`, so the
 * first Quantise is one more undo step rather than a decision you cannot take back.
 */
export function fromTake(take, opts = {}) {
  const { bpm = 90, meter = '4/4', swing = 0.5, split = 60, hand = null, header = {} } = opts;
  const notes = sortNotes((take ?? []).map(t => ({
    b: t.b, len: t.len, n: t.p, hand: hand ?? (t.p < split ? 'lh' : 'rh'), v: t.v ?? 80,
  })));
  const piece = {
    ...emptyPiece({ bpm, meter, swing, ...header }),
    grid: null,
    notes,
    raw: { notes: (take ?? []).map(t => ({ ...t })), bpm },
  };
  if (!header.sections) piece.sections = [{
    name: 'Whole song', from: 1, to: barsOf({ ...piece, sections: [] }), hint: '', coach: '',
  }];
  return piece;
}

const HANDS = ['lh', 'rh'];

/** Throws in plain English at the first thing wrong; otherwise hands the piece back. */
export function validate(piece) {
  if (!piece || typeof piece !== 'object') throw new Error('a piece has to be an object');
  if (!piece.title) throw new Error('a piece needs a title');
  if (!(piece.bpm > 0)) throw new Error(`bpm ${piece.bpm} is not a tempo`);
  try { parseMeter(piece.meter ?? '4/4'); }
  catch (e) { throw new Error(e.message); }
  swingOf(piece);
  if (piece.grid != null && !GRID_BEATS[piece.grid])
    throw new Error(`grid "${piece.grid}" is not ${Object.keys(GRID_BEATS).join(', ')} or null`);
  if (!Array.isArray(piece.notes)) throw new Error('a piece needs a notes array');
  piece.notes.forEach((n, i) => {
    const at = `note ${i + 1}`;
    if (!Number.isFinite(n.b) || n.b < 0) throw new Error(`${at} starts at beat ${n.b}`);
    if (!(n.len > 0)) throw new Error(`${at} is ${n.len} beats long`);
    if (!Number.isInteger(n.n) || n.n < 0 || n.n > 127) throw new Error(`${at} has pitch ${n.n}, not 0-127`);
    if (!HANDS.includes(n.hand)) throw new Error(`${at} is in hand "${n.hand}", not lh or rh`);
  });
  if (!Array.isArray(piece.sections) || !piece.sections.length)
    throw new Error('a piece needs at least one section');
  for (const s of piece.sections) {
    if (!(s.from >= 1 && s.to >= s.from))
      throw new Error(`section "${s.name}" spans bars ${s.from}-${s.to}`);
  }
  return piece;
}
