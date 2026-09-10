// The composer's edit operations: what a selection covers, what each op does to the
// notes, that quantise de-swings a take, that the form only ever grows, that undo is a
// stack of whole pieces -- and that no op ever touches the piece it was handed.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  selected, moveTime, shift, setPitch, transpose, octave, setLen, remove, insert,
  split, merge, quantise, unquantise, stretch, swapHands, sendToHand, humanise,
  makeHistory, gridUnit,
} from '../src/composer/edit.js';
import { barsOf } from '../src/composer/piece.js';
import { quantize } from '../src/looper/loops.js';
import { swungBeat } from '../src/song.js';

const SHUFFLE = '2/3';

/** A note, in the piece's own shape. */
const N = (b, n, hand = 'rh', len = 0.5, v = 80) => ({ b, len, n, hand, v });

const piece = (over = {}) => ({
  v: 1, id: 'test', title: 'Test', sub: '', credit: '',
  bpm: 96, practiceBpm: 60, meter: '4/4', swing: 0.5, key: 'C', sharps: false,
  beams: 'half',
  sections: [{ name: 'Whole song', from: 1, to: 1, hint: '', coach: '' }],
  grid: '1/8', notes: [], raw: null,
  ...over,
});

const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, msg ?? `${a} !== ${b}`);
const deepFreeze = o => {
  if (o && typeof o === 'object') { Object.values(o).forEach(deepFreeze); Object.freeze(o); }
  return o;
};

// ------------------------------------------------------------------ selection
test('a selection is a half-open range of beats crossed with the hands', () => {
  // a piece's notes are always sorted (b, then n), so an index is a position in that order
  const p = piece({ notes: [N(0, 48, 'lh'), N(0, 60, 'rh'), N(1, 62, 'rh'), N(2, 64, 'rh')] });
  assert.deepEqual(selected(p, { from: 0, to: 1 }), [0, 1]);
  assert.deepEqual(selected(p, { from: 0, to: 1, hands: ['rh'] }), [1]);   // hand filter
  assert.deepEqual(selected(p, { from: 1, to: 3 }), [2, 3]);              // b === to is out
  assert.deepEqual(selected(p, { from: 0, to: 0 }), []);
  assert.deepEqual(selected(p, {}), [0, 1, 2, 3]);                        // no bound = all
  assert.deepEqual(selected(p, { hands: ['lh'] }), [0]);
});

test('one note is selected by index, and a bad index selects nothing', () => {
  const p = piece({ notes: [N(0, 60), N(1, 62)] });
  assert.deepEqual(selected(p, { idx: 1 }), [1]);
  assert.deepEqual(selected(p, { idx: 7 }), []);
  assert.deepEqual(selected(p, { idx: -1 }), []);
});

// ------------------------------------------------------------------ move / pitch
test('moveTime shifts the selection and clamps at beat 0', () => {
  const p = piece({ notes: [N(0, 60), N(1, 62), N(2, 64)] });
  const q = moveTime(p, { from: 1, to: 3 }, 0.5);
  assert.deepEqual(q.notes.map(n => n.b), [0, 1.5, 2.5]);
  assert.deepEqual(moveTime(p, {}, -5).notes.map(n => n.b), [0, 0, 0]);
  assert.equal(shift, moveTime);            // the toolbar's name for the same move
});

test('the notes array comes back sorted after a move reorders it', () => {
  const p = piece({ notes: [N(0, 60), N(1, 62)] });
  const q = moveTime(p, { idx: 0 }, 3);
  assert.deepEqual(q.notes.map(n => [n.b, n.n]), [[1, 62], [3, 60]]);
});

test('transpose moves the whole selection, and the move clamps, not each note', () => {
  const p = piece({ notes: [N(0, 60), N(0, 64), N(1, 67, 'lh')] });
  assert.deepEqual(transpose(p, { hands: ['rh'] }, 2).notes.map(n => n.n), [62, 66, 67]);
  assert.deepEqual(octave(p, {}, -1).notes.map(n => n.n), [48, 52, 55]);
  assert.equal(setPitch, transpose);
  // a chord near the ceiling keeps its interval: the shift stops at 127, the notes don't collapse
  const top = piece({ notes: [N(0, 120), N(0, 124)] });
  assert.deepEqual(octave(top, {}, 1).notes.map(n => n.n), [123, 127]);
});

// ------------------------------------------------------------------ length / life
test('setLen never makes a note shorter than one grid unit', () => {
  const p = piece({ notes: [N(0, 60)] });
  near(setLen(p, 0, 1.5).notes[0].len, 1.5);
  near(setLen(p, 0, 0.01).notes[0].len, 0.5);                         // 1/8 grid
  near(setLen(piece({ grid: '1/16', notes: [N(0, 60)] }), 0, 0).notes[0].len, 0.25);
  near(setLen(piece({ grid: null, notes: [N(0, 60)] }), 0, 0).notes[0].len, 0.25);  // raw take
  near(gridUnit('1/8T'), 1 / 3);
});

test('remove takes the selection out and leaves the rest alone', () => {
  const p = piece({ notes: [N(0, 48, 'lh'), N(0, 60, 'rh'), N(2, 64, 'rh')] });
  assert.deepEqual(remove(p, { hands: ['rh'] }).notes.map(n => n.n), [48]);
  assert.deepEqual(remove(p, { idx: 0 }).notes.map(n => n.n), [60, 64]);
});

test('insert defaults to one grid unit and the hand\'s velocity', () => {
  const p = insert(piece({ notes: [N(2, 64)] }), { b: 1, n: 55, hand: 'lh' });
  assert.deepEqual(p.notes.map(n => n.n), [55, 64]);                   // sorted in
  near(p.notes[0].len, 0.5);
  assert.equal(p.notes[0].v, 68);
  const raw = insert(piece({ grid: null }), { b: 0, n: 60, hand: 'rh', len: 1 });
  near(raw.notes[0].len, 1);
  assert.equal(raw.notes[0].v, 80);
});

// ------------------------------------------------------------------ split / merge
test('split cuts one note in two, and refuses a cut at either end', () => {
  const p = piece({ notes: [N(0, 60, 'rh', 2)] });
  const q = split(p, 0, 1.5);
  assert.deepEqual(q.notes.map(n => [n.b, n.len]), [[0, 1.5], [1.5, 0.5]]);
  assert.deepEqual(split(p, 0, 0).notes.map(n => n.len), [2]);
  assert.deepEqual(split(p, 0, 2).notes.map(n => n.len), [2]);
});

test('merge joins the next note of the same pitch and hand that starts where this ends', () => {
  const p = piece({ notes: [N(0, 60, 'rh', 1), N(1, 60, 'rh', 0.5), N(1, 60, 'lh', 0.5)] });
  const q = merge(p, 0);
  assert.deepEqual(q.notes.map(n => [n.b, n.len, n.hand]), [[0, 1.5, 'rh'], [1, 0.5, 'lh']]);
  // a gap, another pitch, or the other hand is not a merge
  const gap = piece({ notes: [N(0, 60, 'rh', 1), N(1.5, 60)] });
  assert.deepEqual(merge(gap, 0).notes.map(n => n.len), [1, 0.5]);
});

// ------------------------------------------------------------------ quantise
test('quantise snaps to the swung grid and stores the straight position', () => {
  // played where a shuffled offbeat sounds (2/3); written where it belongs (x.5)
  const p = piece({ swing: SHUFFLE, grid: null, notes: [N(0.02, 60), N(0.667, 62), N(1.68, 64)] });
  const q = quantise(p, '1/8');
  assert.deepEqual(q.notes.map(n => n.b), [0, 0.5, 1.5]);
  assert.equal(q.grid, '1/8');
  // the same take read straight lands the offbeat on 0.5 from a different distance
  near(quantise(piece({ grid: null, notes: [N(0.6, 62)] }), '1/8').notes[0].b, 0.5);
});

test('quantise is the looper\'s, read off the swung grid and written straight', () => {
  // whatever the looper would pull a lane onto, the composer writes the same point --
  // one set of grid maths, so a take snapped on either page lands on the same eighth
  for (const sw of [0.5, 2 / 3]) {
    for (const b of [0.02, 0.3, 0.6, 0.667, 0.97, 1.68, 2.4]) {
      const heard = quantize(b, 8, sw, 1);
      const written = quantise(piece({ swing: sw === 0.5 ? 0.5 : SHUFFLE, grid: null, notes: [N(b, 60)] }), '1/8').notes[0].b;
      near(swungBeat(written, sw), heard, `at ${b} under swing ${sw}`);
    }
  }
});

test('quantise rounds a note played a hair early onto the next downbeat', () => {
  const p = piece({ swing: SHUFFLE, grid: null, notes: [N(0.97, 60)] });
  near(quantise(p, '1/8').notes[0].b, 1);
});

test('quantise 1/16 and 1/8T use their own grid points', () => {
  const sixteenths = piece({ grid: null, notes: [N(0.3, 60), N(0.8, 62)] });
  assert.deepEqual(quantise(sixteenths, '1/16').notes.map(n => n.b), [0.25, 0.75]);
  // under swing the sixteenths sit at 0, 1/3, 2/3, 5/6 and are written 0, .25, .5, .75
  const swungSixteenths = piece({ swing: SHUFFLE, grid: null, notes: [N(0.34, 60), N(0.84, 62)] });
  assert.deepEqual(quantise(swungSixteenths, '1/16').notes.map(n => n.b), [0.25, 0.75]);
  const triplets = piece({ grid: null, notes: [N(0.35, 60), N(0.63, 62)] });
  const t = quantise(triplets, '1/8T');
  near(t.notes[0].b, 1 / 3);
  near(t.notes[1].b, 2 / 3);
});

test('quantise snaps lengths to whole grid units, minimum one', () => {
  const p = piece({ grid: null, notes: [N(0, 60, 'rh', 0.06), N(1, 62, 'rh', 0.62), N(2, 64, 'rh', 1.3)] });
  assert.deepEqual(quantise(p, '1/8').notes.map(n => n.len), [0.5, 0.5, 1.5]);
});

test('quantise clips a note that now runs into the next of the same pitch and hand', () => {
  const p = piece({
    grid: null,
    notes: [N(0, 60, 'rh', 2), N(0.98, 60, 'rh', 1), N(0, 60, 'lh', 2)],
  });
  const q = quantise(p, '1/8');
  const held = q.notes.filter(n => n.hand === 'rh');
  near(held[0].len, 1);                       // clipped where its repeat starts
  near(held[1].len, 1);
  near(q.notes.find(n => n.hand === 'lh').len, 2);   // the other hand is not in the way
});

test('quantise keeps the take in raw, and unquantise brings it back', () => {
  const take = [N(0.02, 60, 'rh', 0.47, 91), N(0.667, 62, 'rh', 0.4, 73)];
  const p = piece({ swing: SHUFFLE, grid: null, notes: take.map(n => ({ ...n })), raw: { notes: take, bpm: 96 } });
  const q = quantise(p, '1/8');
  assert.equal(q.raw, p.raw);                 // untouched
  const u = unquantise(q);
  assert.equal(u.grid, null);
  assert.deepEqual(u.notes.map(n => [n.b, n.len]), take.map(n => [n.b, n.len]));
  assert.notEqual(u.notes[0], take[0]);       // a copy, not the take's own objects
  const nothing = unquantise(piece({ notes: [N(0, 60)] }));
  assert.deepEqual(nothing.notes.map(n => n.b), [0]);
});

// ------------------------------------------------------------------ transforms
test('stretch scales beats and lengths together, so the bars follow', () => {
  const p = piece({ notes: [N(0, 60, 'rh', 1), N(2, 62, 'rh', 1)] });
  const slow = stretch(p, {}, 2);
  assert.deepEqual(slow.notes.map(n => [n.b, n.len]), [[0, 2], [4, 2]]);
  assert.equal(barsOf(slow), 2);
  assert.deepEqual(stretch(p, {}, 0.5).notes.map(n => [n.b, n.len]), [[0, 0.5], [1, 0.5]]);
});

test('hands swap and are sent, one note or a selection at a time', () => {
  const p = piece({ notes: [N(0, 60, 'rh'), N(1, 48, 'lh')] });
  assert.deepEqual(swapHands(p, {}).notes.map(n => n.hand), ['lh', 'rh']);
  assert.deepEqual(sendToHand(p, {}, 'lh').notes.map(n => n.hand), ['lh', 'lh']);
  assert.deepEqual(sendToHand(p, { idx: 1 }, 'rh').notes.map(n => n.hand), ['rh', 'rh']);
});

test('humanise off flattens velocities; on restores them from the take', () => {
  const take = [N(0.02, 60, 'rh', 0.5, 104), N(0.98, 60, 'rh', 0.5, 61), N(0, 48, 'lh', 1, 55)];
  const p = piece({
    grid: '1/8', raw: { notes: take, bpm: 96 },
    notes: [N(0, 60, 'rh', 0.5, 104), N(1, 60, 'rh', 0.5, 61), N(0, 48, 'lh', 1, 55)],
  });
  assert.deepEqual(humanise(p, false).notes.map(n => n.v), [68, 80, 80]);
  // matched by pitch, then nearest onset -- quantise has moved the notes since
  assert.deepEqual(humanise(humanise(p, false), true).notes.map(n => n.v), [55, 104, 61]);
  const noTake = piece({ notes: [N(0, 60, 'rh', 0.5, 99)] });
  assert.deepEqual(humanise(noTake, true).notes.map(n => n.v), [99]);
});

// ------------------------------------------------------------------ the form
test('an edit past the last section lengthens it, and nothing ever shortens one', () => {
  const p = piece({ notes: [N(0, 60)] });
  assert.equal(p.sections[0].to, 1);
  const late = moveTime(p, {}, 6);                       // beat 6.5 is bar 2 in 4/4
  assert.equal(late.sections[0].to, 2);
  assert.equal(barsOf(late), 2);
  assert.equal(remove(late, {}).sections[0].to, 2);      // emptying the piece keeps the form
  assert.equal(moveTime(late, {}, -6).sections[0].to, 2);
  // only the last section grows
  const two = piece({
    notes: [N(0, 60)],
    sections: [{ name: 'A', from: 1, to: 2 }, { name: 'B', from: 3, to: 4 }],
  });
  const far = moveTime(two, {}, 20);                     // beat 20.5 is bar 6
  assert.deepEqual(far.sections.map(s => s.to), [2, 6]);
});

// ------------------------------------------------------------------ history
test('history is snapshots and an index: undo, redo, and a truncated tail', () => {
  const p0 = piece({ notes: [N(0, 60)] });
  const h = makeHistory(p0);
  assert.equal(h.piece, p0);
  assert.equal(h.canUndo, false);
  assert.equal(h.canRedo, false);

  const p1 = octave(p0, {}, 1), p2 = octave(p1, {}, 1);
  h.push(p1); h.push(p2);
  assert.equal(h.piece, p2);
  assert.equal(h.canUndo, true);
  assert.equal(h.undo(), p1);
  assert.equal(h.undo(), p0);
  assert.equal(h.undo(), p0);                  // the bottom of the stack holds
  assert.equal(h.canUndo, false);
  assert.equal(h.canRedo, true);
  assert.equal(h.redo(), p1);

  const p3 = remove(p1, {});                   // a new edit after an undo forks
  h.push(p3);
  assert.equal(h.piece, p3);
  assert.equal(h.canRedo, false);
  assert.equal(h.redo(), p3);
  assert.equal(h.undo(), p1);
});

// ------------------------------------------------------------------ purity
test('no operation touches the piece it was given', () => {
  const take = [N(0.02, 60, 'rh', 0.47, 91), N(0.98, 60, 'rh', 0.4, 73), N(0, 48, 'lh', 2, 60)];
  const p = deepFreeze(piece({
    swing: SHUFFLE, grid: '1/8', raw: { notes: take.map(n => ({ ...n })), bpm: 96 },
    notes: [N(0, 60, 'rh', 2), N(1, 60, 'rh', 0.5), N(0, 48, 'lh', 2, 60)],
  }));
  const before = JSON.stringify(p);

  const ops = [
    () => moveTime(p, {}, 1.25),
    () => moveTime(p, { idx: 0 }, -9),
    () => setPitch(p, { from: 0, to: 4, hands: ['rh'] }, 3),
    () => transpose(p, {}, -12),
    () => octave(p, { idx: 2 }, 1),
    () => setLen(p, 0, 0.1),
    () => remove(p, { hands: ['lh'] }),
    () => insert(p, { b: 3, n: 67, hand: 'rh' }),
    () => split(p, 0, 1),
    () => merge(p, 0),
    () => quantise(p, '1/8'),
    () => quantise(p, '1/16'),
    () => quantise(p, '1/8T'),
    () => unquantise(p),
    () => stretch(p, {}, 2),
    () => stretch(p, {}, 0.5),
    () => swapHands(p, {}),
    () => sendToHand(p, {}, 'lh'),
    () => humanise(p, false),
    () => humanise(p, true),
  ];
  for (const op of ops) {
    const q = op();
    assert.notEqual(q, p, 'an op returns a new piece');
    assert.notEqual(q.notes, p.notes, 'with a new notes array');
    assert.deepEqual(q.notes, [...q.notes].sort((a, b) => a.b - b.b || a.n - b.n), 'sorted');
    assert.equal(JSON.stringify(p), before, 'and leaves the input exactly as it was');
  }
  assert.deepEqual(selected(p, {}), [0, 1, 2]);
  assert.equal(JSON.stringify(p), before);
});
