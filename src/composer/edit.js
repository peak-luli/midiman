// Every edit the composer can make, as a pure function of a piece: `(piece, ...) -> piece`.
//
// Nothing here mutates its input and nothing here half-applies -- an op builds a new
// notes array, sorts it, and hands back a new piece -- so undo is an array of snapshots
// (makeHistory) rather than a pile of inverse operations. Bars follow from `b`, so an
// edit that pushes notes past the last section lengthens it; sections never shrink,
// because the form is what the player named, not a window on the notes.

import { swingOf, sortNotes, barsOf } from './piece.js';

const EPS = 1e-9;
const DEFAULT_V = { rh: 80, lh: 68 };

/** One grid step in beats. A raw piece has no grid but still needs a floor: a sixteenth. */
export const gridUnit = grid =>
  grid === '1/8' ? 0.5 : grid === '1/16' ? 0.25 : grid === '1/8T' ? 1 / 3 : 0.25;

// Where the grid *sounds* under swing, and where the same points are *written*.
// (The looper's `gridOffsets` is private, so the arithmetic is repeated here.)
function offsetsOf(grid, sw) {
  if (grid === '1/8') return { heard: [0, sw], written: [0, 0.5] };
  if (grid === '1/16') return { heard: [0, sw / 2, sw, sw + (1 - sw) / 2], written: [0, 0.25, 0.5, 0.75] };
  if (grid === '1/8T') return { heard: [0, 1 / 3, 2 / 3], written: [0, 1 / 3, 2 / 3] };
  throw new Error(`unknown grid "${grid}" -- use '1/8', '1/16' or '1/8T'`);
}

/**
 * The indices an op applies to. `target` is either one note, `{ idx }`, or a selection
 * `{ from, to, hands }` -- beats, half-open `[from, to)`, hands a subset of lh/rh.
 * A missing bound is unbounded, so `{}` is the whole piece and `{ hands: ['rh'] }` a hand.
 */
export function selected(piece, target = {}) {
  const notes = piece.notes ?? [];
  const one = typeof target === 'number' ? target : target?.idx;
  if (one != null) return one >= 0 && one < notes.length ? [one] : [];
  const { from = -Infinity, to = Infinity, hands = ['lh', 'rh'] } = target ?? {};
  const out = [];
  notes.forEach((n, i) => {
    if (n.b > from - EPS && n.b < to - EPS && hands.includes(n.hand)) out.push(i);
  });
  return out;
}

// ------------------------------------------------------------------ the plumbing

// Sections are 1-based inclusive bars; barsOf already answers "as long as the form or
// the notes, whichever is longer", so growing the last one is one comparison.
function grown(piece, notes) {
  const secs = piece.sections ?? [];
  if (!secs.length) return secs;
  const bars = barsOf({ ...piece, notes });
  const last = secs.length - 1;
  if (secs[last].to >= bars) return secs;
  return secs.map((s, i) => (i === last ? { ...s, to: bars } : s));
}

/** Every op ends here: a new piece, a new sorted notes array, sections grown to fit. */
function withNotes(piece, notes) {
  const sorted = sortNotes(notes);
  return { ...piece, notes: sorted, sections: grown(piece, sorted) };
}

const mapAt = (piece, idxs, fn) =>
  withNotes(piece, piece.notes.map((n, i) => (idxs.has(i) ? fn(n) : n)));

const mapSel = (piece, target, fn) => mapAt(piece, new Set(selected(piece, target)), fn);

const oneOf = idx => (typeof idx === 'number' ? idx : idx?.idx);

// ------------------------------------------------------------------ the operations

/** Drag in time. Beat 0 is the first downbeat, so nothing goes behind it. */
export const moveTime = (piece, target, dBeats) =>
  mapSel(piece, target, n => ({ ...n, b: Math.max(0, n.b + dBeats) }));

/** The same move, under the name the selection toolbar uses. */
export const shift = moveTime;

/** Drag up/down, or transpose a selection. */
export function setPitch(piece, target, dSemis) {
  const idxs = selected(piece, target);
  // Clamp the *move*, not each note: an octave up near the top of the keyboard must
  // not squash a chord into a unison.
  let d = dSemis;
  for (const i of idxs) {
    const { n } = piece.notes[i];
    d = dSemis > 0 ? Math.min(d, 127 - n) : Math.max(d, -n);
  }
  return mapAt(piece, new Set(idxs), n => ({ ...n, n: n.n + d }));
}

export const transpose = setPitch;
export const octave = (piece, target, dir) => setPitch(piece, target, 12 * dir);

/** Drag the right edge of one note. A note shorter than a grid step cannot be written. */
export function setLen(piece, idx, len) {
  const i = oneOf(idx), min = gridUnit(piece.grid);
  return withNotes(piece, piece.notes.map((n, j) => (j === i ? { ...n, len: Math.max(min, len) } : n)));
}

export function remove(piece, target) {
  const idxs = new Set(selected(piece, target));
  return withNotes(piece, piece.notes.filter((_, i) => !idxs.has(i)));
}

/** Click an empty cell: one grid step at that pitch. */
export function insert(piece, { b, n, hand = 'rh', len, v }) {
  const note = {
    b: Math.max(0, b), len: len ?? gridUnit(piece.grid), n, hand,
    v: v ?? DEFAULT_V[hand] ?? 80,
  };
  return withNotes(piece, [...piece.notes, note]);
}

/** Cut one note at the playhead. A cut at either end would make a zero-length note. */
export function split(piece, idx, atBeat) {
  const i = oneOf(idx), src = piece.notes[i];
  if (!src || atBeat <= src.b + EPS || atBeat >= src.b + src.len - EPS)
    return withNotes(piece, piece.notes);
  const head = { ...src, len: atBeat - src.b };
  const tail = { ...src, b: atBeat, len: src.b + src.len - atBeat };
  return withNotes(piece, piece.notes.flatMap((n, j) => (j === i ? [head, tail] : [n])));
}

/** Join with the next note of the same pitch and hand, if it starts where this one ends. */
export function merge(piece, idx) {
  const i = oneOf(idx), src = piece.notes[i];
  if (!src) return withNotes(piece, piece.notes);
  const j = piece.notes.findIndex((o, k) =>
    k !== i && o.n === src.n && o.hand === src.hand && Math.abs(o.b - (src.b + src.len)) < EPS);
  if (j < 0) return withNotes(piece, piece.notes);
  const joined = { ...src, len: piece.notes[j].b + piece.notes[j].len - src.b };
  return withNotes(piece, piece.notes.flatMap((n, k) => (k === j ? [] : k === i ? [joined] : [n])));
}

// ------------------------------------------------------------------ the transforms

/**
 * Quantise, with the minimum of magic: strength is always 1, the click is where the bar
 * lines come from, and the take stays in `raw` so this is one undo step like any other.
 *
 * A take played under swing has the swing in its timestamps, so each onset snaps to the
 * nearest point of the grid *as it sounds* and is stored where it is *written* --
 * quantise de-swings, playback re-swings with swungBeat().
 */
export function quantise(piece, grid) {
  const { heard, written } = offsetsOf(grid, swingOf(piece));
  const unit = gridUnit(grid);
  const notes = sortNotes(piece.notes.map(n => ({
    ...n,
    b: snap(n.b, heard, written),
    len: Math.max(1, Math.round(n.len / unit)) * unit,   // whole grid units, minimum one
  })));
  // Rounding can push a note over the repeat of its own pitch; the earlier one stops
  // where the later starts rather than sounding through it.
  for (let i = 0; i < notes.length; i++) {
    const cur = notes[i];
    for (let j = i + 1; j < notes.length; j++) {          // sorted, so the first match is the next
      const o = notes[j];
      if (o.n !== cur.n || o.hand !== cur.hand || o.b <= cur.b + EPS) continue;
      if (cur.b + cur.len > o.b + EPS) notes[i] = { ...cur, len: o.b - cur.b };
      break;
    }
  }
  return { ...withNotes(piece, notes), grid };
}

// Nearest grid point inside the beat, plus the next downbeat -- that last candidate
// catches a note played a hair early, which belongs on 1, not back on the last offbeat.
function snap(b, heard, written) {
  const base = Math.floor(b), f = b - base;
  let best = 0, bd = Infinity;
  for (let i = 0; i <= heard.length; i++) {
    const d = Math.abs(f - (i === heard.length ? 1 : heard[i]));
    if (d < bd) { bd = d; best = i === heard.length ? 1 : written[i]; }
  }
  return base + best;
}

/** Back to the take as played. Without a `raw` there is nothing to go back to. */
export function unquantise(piece) {
  if (!piece.raw?.notes) return withNotes(piece, piece.notes);
  return { ...withNotes(piece, piece.raw.notes.map(n => ({ ...n }))), grid: null };
}

/** Double or halve speed: bars follow from `b`, so the form stretches with the notes. */
export const stretch = (piece, target, factor) =>
  mapSel(piece, target, n => ({ ...n, b: n.b * factor, len: n.len * factor }));

export const swapHands = (piece, target) =>
  mapSel(piece, target, n => ({ ...n, hand: n.hand === 'lh' ? 'rh' : 'lh' }));

export const sendToHand = (piece, target, hand) =>
  mapSel(piece, target, n => ({ ...n, hand }));

/**
 * Velocities: off is one value a hand (a sheet drops `v` anyway); on restores what was
 * played, matched by pitch and nearest onset because quantise has since moved the notes.
 */
export function humanise(piece, on) {
  if (!on)
    return withNotes(piece, piece.notes.map(n => ({ ...n, v: DEFAULT_V[n.hand] ?? 80 })));
  const raw = piece.raw?.notes;
  if (!raw) return withNotes(piece, piece.notes);
  return withNotes(piece, piece.notes.map(n => {
    let best = null, bd = Infinity;
    for (const r of raw) {
      const d = Math.abs(r.b - n.b);
      if ((r.n ?? r.p) === n.n && d < bd) { bd = d; best = r; }
    }
    return best?.v == null ? n : { ...n, v: best.v };
  }));
}

// ------------------------------------------------------------------ undo / redo

/**
 * Snapshots and an index. Pieces are small plain objects and no op mutates one, so
 * keeping the whole piece per step is cheaper than being clever, and `undo` cannot
 * leave a half-applied edit behind.
 */
export function makeHistory(initial) {
  const snaps = [initial];
  let i = 0;
  return {
    get piece() { return snaps[i] },
    get canUndo() { return i > 0 },
    get canRedo() { return i < snaps.length - 1 },
    /** A fresh edit after an undo forks: the redo tail is gone. */
    push(piece) { snaps.length = i + 1; snaps.push(piece); i = snaps.length - 1; return piece },
    undo() { if (i > 0) i--; return snaps[i] },
    redo() { if (i < snaps.length - 1) i++; return snaps[i] },
  };
}
