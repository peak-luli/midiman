// PLACEHOLDER. Only the four helpers `edit.js` is allowed to import, exactly as
// CONTRACT.md specifies them; the real piece.js (fromTake, fromSong, validate,
// notesIn, emptyPiece, ...) is being written in parallel and replaces this file whole.

import { parseMeter } from '../song.js';

/** A quarter is a beat, so 6/8 is two beats a bar, not six. parseMeter knows. */
export const beatsPerBarOf = piece => parseMeter(piece?.meter ?? '4/4').beatsPerBar;

/** Swing as the file writes it: a number, or "2/3". Straight (or absent) is 0.5. */
export function swingOf(piece) {
  const v = piece?.swing;
  if (typeof v === 'number') return v;
  if (!v) return 0.5;
  const [a, b] = String(v).split('/');
  return b === undefined ? +a : +a / +b;
}

/** Time order, then low to high, so a chord reads bottom-up. Never in place. */
export const sortNotes = notes => [...notes].sort((x, y) => x.b - y.b || x.n - y.n);

/** As many bars as the sections claim or the notes need -- at least one. */
export function barsOf(piece) {
  const bpb = beatsPerBarOf(piece);
  const end = (piece?.notes ?? []).reduce((m, n) => Math.max(m, n.b + n.len), 0);
  const named = (piece?.sections ?? []).reduce((m, s) => Math.max(m, s.to ?? 0), 0);
  return Math.max(named, Math.ceil(end / bpb - 1e-9), 1);
}
