// Fixing notes in the looper: turning a pointer on a lane's roll into one of the lane's
// own notes, and applying one change to it.
//
// The rules a lane plays by do not change. A lane is still layers of notes exactly as
// they were played, bent on the way out by the knobs (quantise, octave, follow, level);
// an edit is a change to the notes themselves, so it is stored as one *edited layer*
// that replaces the layers it was made from, and the layers it replaced go onto the
// same `undo` stack that holds a removed overdub. So U undoes an edit the way it undoes
// a dub, the raw take is never lost while it is on the stack, and every knob still
// applies on top of the result.
//
// The arithmetic that decides *which* note and *where it lands* is here and pure: the
// page can be driven by a pointer or by four arrow keys and neither has to know how a
// roll is drawn. What the ops themselves do -- clamp to beat 0, keep a note inside the
// keyboard, never make one shorter than a grid step -- is the composer's `edit.js`,
// because a note is a note on either page.

import { moveTime, setPitch, setLen, remove } from '../composer/edit.js';
import { quantize } from './loops.js';

/** The pitch window a lane's roll draws: `LO` at the bottom, `SPAN` semitones tall. */
export const LO = 48, SPAN = 44;

/** The looper's grid divisions, under the names the composer's ops call them by. */
export const gridName = div => (div === 8 ? '1/8' : div === 16 ? '1/16' : div === 12 ? '1/8T' : null);

/** One step of the lane's grid in beats -- a sixteenth when the grid is off. */
export const stepOf = div => (div === 8 ? 0.5 : div === 16 ? 0.25 : div === 12 ? 1 / 3 : 0.25);

/** A dragged beat, pulled onto the lane's grid -- the swung one, as the lane is. */
export const snapBeat = (b, div, sw) => (div ? quantize(Math.max(0, b), div, sw, 1) : Math.max(0, b));

/** A dragged length: whole grid steps, and never nothing. */
export const snapLen = (len, div) => {
  const step = stepOf(div);
  return Math.max(step, Math.round(len / step) * step);
};

/**
 * Where a pointer sits on a lane's roll, in the beats and pitches the roll draws.
 * `fx` and `fy` are fractions of the note box: 0,0 is its top left.
 */
export function rollPoint(fx, fy, formBeats) {
  return {
    b: Math.max(0, Math.min(formBeats, fx * formBeats)),
    p: LO + (1 - fy) * SPAN,
  };
}

/**
 * The drawn note under a point -- the one sounding at that beat whose pitch is nearest,
 * within `tol` semitones. `-1` when the pointer is over the empty roll.
 */
export function pickNote(notes, at, tol = 3) {
  let best = -1, bd = Infinity;
  notes.forEach((n, i) => {
    if (at.b < n.b - 0.02 || at.b > n.b + n.len + 0.02) return;
    const d = Math.abs(n.p - at.p);
    if (d <= tol && d < bd) { bd = d; best = i; }
  });
  return best;
}

/** A lane's own notes, flattened out of its layers -- what an edit's index counts. */
export const laneNotes = slot => slot.layers.flat();

/**
 * One edit, applied to a lane.
 *
 * `op` names a note by its index into `laneNotes(slot)` and says where it should end up
 * in the lane's *own* coordinates -- relative beats and the pitch as played, before the
 * octave and the changes move it:
 *
 *   { kind: 'move', i, b, p }   b or p left out means "leave that alone"
 *   { kind: 'len',  i, len }
 *   { kind: 'del',  i }
 *
 * Hands back what the lane becomes -- `{ layers, undo, i }`, `i` being where the note
 * ended up so the page can keep hold of it -- or null when nothing would change.
 */
export function applyEdit(slot, op, div = 0) {
  const raw = laneNotes(slot);
  const note = raw[op.i];
  if (!note) return null;

  // the composer's ops speak pieces: `n` for pitch, a hand, a grid for the minimum
  // length. A mark rides along on the note being edited, because every op sorts its
  // result and the index would otherwise move under us.
  const piece = {
    grid: gridName(div),
    notes: raw.map((n, k) => ({ b: n.b, len: n.len, n: n.p, hand: 'rh', v: n.v, mark: k === op.i })),
  };
  const marked = p => p.notes.findIndex(n => n.mark);

  let next = piece;
  if (op.kind === 'del') next = remove(next, { idx: op.i });
  else if (op.kind === 'len') next = setLen(next, { idx: op.i }, op.len);
  else if (op.kind === 'move') {
    if (op.p != null && op.p !== note.p) next = setPitch(next, { idx: marked(next) }, op.p - note.p);
    if (op.b != null && op.b !== note.b) next = moveTime(next, { idx: marked(next) }, op.b - note.b);
  } else return null;

  const layer = next.notes.map(n => ({ b: n.b, len: n.len, p: n.n, v: n.v }));
  if (same(layer, raw)) return null;
  return {
    layers: [layer],
    // the same entry `clear` and `capture` push: U puts the whole lane back as it was
    undo: [...slot.undo, { whole: { ...slot, layers: slot.layers.slice() } }],
    i: marked(next),
  };
}

const same = (a, b) => a.length === b.length
  && a.every((n, i) => n.b === b[i].b && n.p === b[i].p && n.len === b[i].len);
