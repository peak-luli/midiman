// Fixing notes in the looper: turning a pointer on a lane's roll into one of the lane's
// own notes, what an edit does to the layers, and -- the part that matters most -- that
// U still means what it meant. An edit that lost a take, or that an overdub could not be
// stacked on afterwards, would be worse than no editor at all.

import test from 'node:test';
import assert from 'node:assert/strict';

import { makeBuffer } from '../src/looper/buffer.js';
import { makeEngine } from '../src/looper/engine.js';
import { slotNotes, newSlot } from '../src/looper/loops.js';
import {
  LO, SPAN, applyEdit, laneNotes, pickNote, rollPoint, snapBeat, snapLen, stepOf, gridName,
} from '../src/looper/edit.js';

function fakeClock() {
  let b = 0, bpm = 100;
  return {
    get bpm() { return bpm }, get running() { return true },
    at(v) { b = v; return this },
    start() {}, stop() {},
    beat(t) { return t === undefined ? b : t },
    time(x) { return x },
    setBpm(v) { bpm = v },
  };
}

const SHUFFLE = 2 / 3;
const BLUES = [0, 0, 0, 0, 5, 5, 0, 0, 7, 5, 0, 7];
const track = {
  id: 'test-blues', root: 36, bpm: 100, swing: SHUFFLE, sharps: false, quality: '7',
  pattern: [0, 7, 9, 10, 12, 10, 9, 7], form: BLUES, cols: 6,
  scale: [0, 3, 5, 6, 7, 10], scaleName: 'blues', blue: 6, melody: null, name: 'test', sub: '',
};

const near = (a, b, why) => assert.ok(Math.abs(a - b) < 1e-9, `${why}: ${a} vs ${b}`);

/** A lane holding one bar of three notes, tiling the form. */
const lane = (over = {}) => ({
  ...newSlot(0), st: 'play', fromBar: 0, lenBars: 4, mode: 'fill', follow: false,
  layers: [[
    { b: 0, len: 1, p: 60, v: 80 },
    { b: 1.4, len: 0.5, p: 64, v: 80 },
    { b: 3, len: 1, p: 67, v: 80 },
  ]],
  ...over,
});

const q0 = { div: 0, strength: 0 };

function rig(slot) {
  const clock = fakeClock();
  const buffer = makeBuffer(clock);
  const engine = makeEngine({ clock, buffer });
  engine.load(track);
  if (slot) engine.patch(0, s => Object.assign(s, slot, { i: 0 }));
  return { clock, buffer, engine };
}

// ------------------------------------------------------------------ the pointer
test('a pointer on the roll finds the note it is over, and nothing where there is none', () => {
  const notes = slotNotes(lane(), track, q0);
  const fb = engine_formBeats();
  const on = rollPoint(1.4 / fb, 1 - (64 - LO) / SPAN, fb);
  const k = pickNote(notes, on);
  assert.ok(k >= 0, 'the offbeat E is under the pointer');
  assert.equal(notes[k].p, 64);
  assert.equal(pickNote(notes, rollPoint(2.5 / fb, 1 - (72 - LO) / SPAN, fb)), -1,
    'empty roll, no note');
});

test('a ghost repeat is the same note, and says how far it was moved', () => {
  const notes = slotNotes(lane({ follow: true }), track, q0);
  const fb = engine_formBeats();
  // the same lane note, in bar 5 (F7): the repeat sounds a fourth up from the C7 take
  const ghosts = notes.filter(n => n.ghost && n.src === 0);
  assert.ok(ghosts.length, 'the loop tiles the form');
  const g = ghosts[0];
  const k = pickNote(notes, rollPoint(g.b / fb, 1 - (g.p - LO) / SPAN, fb));
  assert.equal(notes[k].src, 0, 'clicking a repeat picks the note it repeats');
  near(notes[k].b - notes[k].db, 0, 'and its own beat is the take\'s');
  assert.equal(notes[k].p - notes[k].dp, 60, 'as is its own pitch');
});

test('the grid is the lane\'s: a dragged beat is pulled onto it, swung', () => {
  near(snapBeat(1.4, 8, SHUFFLE), 1 + 2 / 3, 'the shuffled offbeat');
  near(snapBeat(1.4, 0, SHUFFLE), 1.4, 'no grid, no snapping');
  near(snapLen(0.6, 8), 0.5, 'lengths are whole steps');
  near(snapLen(0.01, 8), 0.5, 'and never nothing');
  near(stepOf(16), 0.25);
  assert.equal(gridName(12), '1/8T');
});

// ------------------------------------------------------------------ the edit
test('an edit sets the note\'s own beat and pitch, and flattens the lane into one layer', () => {
  const s = lane({ layers: [[{ b: 0, len: 1, p: 60, v: 80 }], [{ b: 2, len: 1, p: 64, v: 80 }]] });
  const next = applyEdit(s, { kind: 'move', i: 1, b: 2.5, p: 65 });
  assert.equal(next.layers.length, 1, 'one edited layer');
  assert.deepEqual(next.layers[0].map(n => [n.b, n.p]), [[0, 60], [2.5, 65]]);
  assert.deepEqual(next.undo[next.undo.length - 1].whole.layers, s.layers,
    'and what it replaced is on the undo stack, whole');
});

test('an edit that would change nothing is not an edit', () => {
  const s = lane();
  assert.equal(applyEdit(s, { kind: 'move', i: 0, b: 0, p: 60 }), null);
  assert.equal(applyEdit(s, { kind: 'move', i: 9, b: 1 }), null, 'no such note');
});

test('a note cannot be dragged behind the top of the lane, or off the keyboard', () => {
  const s = lane();
  near(applyEdit(s, { kind: 'move', i: 1, b: -3 }).layers[0][0].b, 0);
  assert.equal(applyEdit(s, { kind: 'move', i: 0, p: 400 }).layers[0][0].p, 127);
});

test('length follows the grid step, and delete takes the note out', () => {
  const s = lane();
  near(applyEdit(s, { kind: 'len', i: 0, len: 0.1 }, 8).layers[0][0].len, 0.5,
    'never shorter than the lane\'s own grid step');
  const gone = applyEdit(s, { kind: 'del', i: 1 });
  assert.deepEqual(gone.layers[0].map(n => n.p), [60, 67]);
});

// ------------------------------------------------------------------ through the engine
test('the engine takes the edit, and U puts the lane back as it was played', () => {
  const { engine } = rig(lane());
  const before = engine.slots[0].layers.map(l => l.map(n => ({ ...n })));
  const at = engine.edit(0, { kind: 'move', i: 1, b: 1.5, p: 65 });
  assert.ok(at >= 0, 'the edit landed');
  assert.equal(engine.slots[0].layers.length, 1);
  assert.deepEqual(laneNotes(engine.slots[0]).map(n => [n.b, n.p]), [[0, 60], [1.5, 65], [3, 67]]);
  assert.equal(at, 1, 'and it says where the note ended up');

  engine.undo(0);
  assert.deepEqual(engine.slots[0].layers, before, 'U is one undo step, like an overdub');
});

test('an overdub after an edit stacks on it, and U takes the dub off first', () => {
  const { clock, buffer, engine } = rig(lane());
  engine.edit(0, { kind: 'move', i: 0, b: 0.5 });

  // a pass over the loop, recorded as a second layer
  clock.at(0);
  engine.press(0);                       // play -> dub
  engine.pump();
  buffer.feed({ on: 1, n: 72, v: 90, t: 1 });
  buffer.feed({ on: 0, n: 72, v: 0, t: 1.5 });
  clock.at(16);
  engine.press(0);                       // dub -> play
  engine.pump();
  assert.equal(engine.slots[0].layers.length, 2, 'the dub is its own layer, on top of the edit');
  assert.ok(engine.slots[0].layers[1].some(n => n.p === 72));

  engine.undo(0);
  assert.equal(engine.slots[0].layers.length, 1, 'U takes the dub off');
  near(laneNotes(engine.slots[0])[0].b, 0.5, 'and the edit is still there under it');
  // ending a take has always emptied the lane's undo stack, edit or no edit: what is
  // undoable after a dub is the dub. The edit is part of the material now.
  engine.undo(0);
  near(laneNotes(engine.slots[0])[0].b, 0.5, 'nothing older than the dub is on the stack');
});

test('the knobs still apply on top of an edited lane', () => {
  const { engine } = rig(lane({ oct: 1 }));
  engine.edit(0, { kind: 'move', i: 0, p: 62 });
  engine.setGrid(1);                     // 1/8, swung
  engine.setStrength(1);
  const notes = engine.notesOf(0).filter(n => !n.ghost);
  assert.equal(notes[0].p, 62 + 12, 'the octave is still a playback knob');
  near(notes.find(n => n.src === 1).b, 1 + 2 / 3, 'and so is quantise');
});

test('a lane that is recording is not one to fix', () => {
  const { engine } = rig(lane({ st: 'rec' }));
  assert.equal(engine.edit(0, { kind: 'move', i: 0, b: 2 }), -1);
});

/** The form is twelve bars of four beats; the roll draws one chorus of it. */
function engine_formBeats() { return BLUES.length * 4; }
