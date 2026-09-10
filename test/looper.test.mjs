// The musical logic, tested away from the browser: what a take picks up, where a loop
// lands in the form, what following the changes moves it by, and what the melody
// export hands back to tracks.json.

import test from 'node:test';
import assert from 'node:assert/strict';

import { onSend } from '../src/midi.js';
import { setVolume } from '../src/volume.js';
import { makeBuffer } from '../src/looper/buffer.js';
import { makeEngine } from '../src/looper/engine.js';
import { loadTracks } from '../src/tracks.js';
import {
  quantize, placements, slotNotes, foldTake, toMelody, melodyOf, newSlot,
  defaultMode, defaultFollow, canFill,
} from '../src/looper/loops.js';

// A clock whose timestamps are beats, so tests can put the playhead anywhere.
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

// ------------------------------------------------------------------ quantize
test('quantize follows the track shuffle, not a straight grid', () => {
  // an offbeat played at .60 belongs on the shuffled eighth at 2/3, not on .5
  assert.ok(Math.abs(quantize(0.60, 8, SHUFFLE, 1) - 2 / 3) < 1e-9);
  assert.ok(Math.abs(quantize(0.60, 8, 0.5, 1) - 0.5) < 1e-9);   // straight track: .5
});

test('quantize strength interpolates, and 0 leaves the take alone', () => {
  assert.equal(quantize(1.30, 8, 0.5, 0), 1.30);
  assert.ok(Math.abs(quantize(1.30, 8, 0.5, 0.5) - 1.40) < 1e-9);  // halfway to 1.5
  assert.ok(Math.abs(quantize(1.30, 8, 0.5, 1) - 1.5) < 1e-9);
});

test('quantize rounds up onto the next downbeat rather than back a whole beat', () => {
  assert.ok(Math.abs(quantize(0.97, 8, SHUFFLE, 1) - 1) < 1e-9);
});

// ------------------------------------------------------------------ placement
test('a 4-bar loop tiles a 12-bar form, and only where it divides it', () => {
  assert.equal(canFill(4, 12), true);
  assert.equal(canFill(5, 12), false);
  assert.equal(defaultMode(5, 12), 'phrase');
  assert.equal(defaultFollow(4, BLUES), true);
  assert.equal(defaultFollow(4, [0, 0, 0, 0]), false);   // a vamp has nothing to follow
});

test('following the changes moves each repeat by the interval between the chords', () => {
  const slot = { ...newSlot(0), fromBar: 4, lenBars: 4, mode: 'fill', follow: true };
  const pl = placements(slot, BLUES);
  assert.deepEqual(pl.map(p => p.start), [4, 0, 8]);
  // recorded over bars 5-8 (F7 F7 C7 C7); repeated over 1-4 (all C7) and 9-12 (G7 F7 C7 G7)
  assert.deepEqual([0, 1, 2, 3].map(b => pl[1].shift(b)), [-5, -5, 0, 0]);
  assert.deepEqual([0, 1, 2, 3].map(b => pl[2].shift(b)), [2, 0, 0, 7]);
});

test('follow off leaves every repeat at the pitches that were played', () => {
  const slot = { ...newSlot(0), fromBar: 4, lenBars: 4, mode: 'fill', follow: false };
  for (const p of placements(slot, BLUES))
    assert.deepEqual([0, 1, 2, 3].map(b => p.shift(b)), [0, 0, 0, 0]);
});

test('a phrase loop stays in its own bars', () => {
  const slot = { ...newSlot(0), fromBar: 4, lenBars: 4, mode: 'phrase' };
  assert.deepEqual(placements(slot, BLUES).map(p => p.start), [4]);
});

test('slotNotes stamps the chorus, transposes repeats and applies the octave', () => {
  const slot = {
    ...newSlot(0), st: 'play', fromBar: 4, lenBars: 4, mode: 'fill', follow: true,
    oct: 1, level: 3, layers: [[{ b: 0, len: 1, p: 65, v: 80 }]],
  };
  const ns = slotNotes(slot, track, { div: 0, strength: 0 });
  assert.deepEqual(ns.map(n => [n.b, n.p, n.ghost]), [
    [0, 65 + 12 - 5, true],     // over C7, a fourth down from the F7 it was played on
    [16, 65 + 12, false],       // as played
    [32, 65 + 12 + 2, true],    // over G7, a tone up
  ]);
});

// ------------------------------------------------------------------ the buffer
test('a note struck just before the take starts is pulled onto the downbeat', () => {
  const clock = fakeClock().at(20);
  const buf = makeBuffer(clock);
  buf.feed({ on: 1, n: 60, v: 90, t: 7.94 });     // a hair early
  buf.feed({ on: 0, n: 60, v: 0, t: 8.5 });
  const take = buf.slice(8, 16);
  assert.equal(take.length, 1);
  assert.equal(take[0].b, 0);
});

test('a note struck just before the take ends belongs to the next time round', () => {
  const clock = fakeClock().at(20);
  const buf = makeBuffer(clock);
  buf.feed({ on: 1, n: 60, v: 90, t: 15.95 });
  buf.feed({ on: 0, n: 60, v: 0, t: 16.4 });
  const take = buf.slice(8, 16);
  assert.equal(take.length, 1);
  assert.equal(take[0].b, 0, 'wraps to the start rather than being clipped off the end');
});

test('a note still held when the take ends is closed at the end', () => {
  const clock = fakeClock().at(16);
  const buf = makeBuffer(clock);
  buf.feed({ on: 1, n: 60, v: 90, t: 14 });        // never released
  const take = buf.slice(8, 16);
  assert.equal(take.length, 1);
  assert.ok(Math.abs(take[0].b - 6) < 1e-9);
  assert.ok(take[0].b + take[0].len <= 8 + 1e-9, 'does not run past the loop');
});

test('a pitch re-struck before release closes the first note', () => {
  const clock = fakeClock().at(20);
  const buf = makeBuffer(clock);
  buf.feed({ on: 1, n: 60, v: 90, t: 8 });
  buf.feed({ on: 1, n: 60, v: 90, t: 9 });         // stuck key, or a fast repeat
  buf.feed({ on: 0, n: 60, v: 0, t: 9.5 });
  const take = buf.slice(8, 16);
  assert.equal(take.length, 2);
  assert.ok(Math.abs(take[0].len - 1) < 1e-9);
});

test('notes outside the take are left alone', () => {
  const clock = fakeClock().at(30);
  const buf = makeBuffer(clock);
  buf.feed({ on: 1, n: 60, v: 90, t: 2 }); buf.feed({ on: 0, n: 60, v: 0, t: 3 });
  buf.feed({ on: 1, n: 62, v: 90, t: 20 }); buf.feed({ on: 0, n: 62, v: 0, t: 21 });
  assert.equal(buf.slice(8, 16).length, 0);
});

// ------------------------------------------------------------------ overdub
test('an overdub spanning several passes folds onto the loop length', () => {
  const slot = { ...newSlot(0), fromBar: 0, lenBars: 2, mode: 'fill' };
  // dubbed from beat 8 for two passes of a 2-bar (8-beat) loop
  const take = [{ b: 0, len: 1, p: 60, v: 80 }, { b: 9, len: 1, p: 62, v: 80 }];
  const folded = foldTake(take, slot, 8, 48);
  assert.deepEqual(folded.map(n => [n.b, n.p]), [[0, 60], [1, 62]]);
});

test('an overdub outside a phrase loop\'s own bars is dropped, not smeared over it', () => {
  const slot = { ...newSlot(0), fromBar: 4, lenBars: 4, mode: 'phrase' };
  const take = [{ b: 0, len: 1, p: 60, v: 80 }];
  assert.equal(foldTake(take, slot, 0, 48).length, 0);      // bar 1, outside bars 5-8
  assert.equal(foldTake(take, slot, 16, 48).length, 1);     // bar 5, inside
});

// ------------------------------------------------------------------ record cycle
function rig() {
  const clock = fakeClock();
  const buffer = makeBuffer(clock);
  const engine = makeEngine({ clock, buffer });
  engine.load(track);
  return { clock, buffer, engine };
}

test('pressing record late still starts the take on the bar line', () => {
  const { clock, buffer, engine } = rig();
  clock.at(17.4);                       // 1.4 beats into bar 5
  engine.press(0);
  engine.pump();
  const s = engine.slots[0];
  assert.equal(s.st, 'rec');
  assert.equal(s.recStart, 16, 'snaps back to the line it just passed');
});

test('a late press keeps the notes already played since the line', () => {
  const { clock, buffer, engine } = rig();
  buffer.feed({ on: 1, n: 67, v: 90, t: 16.5 });
  buffer.feed({ on: 0, n: 67, v: 0, t: 17.0 });
  clock.at(17.4);
  engine.press(0); engine.pump();
  for (let b = 17.4; b <= 32.2; b += 0.5) { clock.at(b); engine.pump(); }
  clock.at(32.2); engine.press(0); engine.pump();
  const s = engine.slots[0];
  assert.equal(s.st, 'play');
  assert.equal(s.lenBars, 4);
  assert.equal(s.fromBar, 4, 'the loop remembers it was played over bar 5');
  assert.deepEqual(s.layers[0].map(n => n.p), [67]);
  assert.ok(Math.abs(s.layers[0][0].b - 0.5) < 1e-9, 'kept at the offset it was played');
});

test('an early press waits for the line instead of starting under your hands', () => {
  const { clock, engine } = rig();
  clock.at(19.2);                       // .8 of a beat before bar 6
  engine.press(0); engine.pump();
  assert.equal(engine.slots[0].st, 'empty');
  assert.equal(engine.slots[0].pend, 'rec');
  clock.at(20.1); engine.pump();
  assert.equal(engine.slots[0].st, 'rec');
  assert.equal(engine.slots[0].recStart, 20);
});

test('pressing record twice before the line cancels it', () => {
  const { clock, engine } = rig();
  clock.at(19.2);
  engine.press(0); engine.press(0);
  engine.pump();
  assert.equal(engine.slots[0].pend, null);
  assert.equal(engine.slots[0].st, 'empty');
});

test('a take cannot end before it has run a whole snap unit', () => {
  const { clock, engine } = rig();
  clock.at(16); engine.press(0); engine.pump();
  clock.at(16.1); engine.press(0);              // fumbled second press
  assert.equal(engine.slots[0].pendAt, 20, 'held to the next bar, not zero length');
});

test('capture takes the last bars straight out of the buffer', () => {
  const { clock, buffer, engine } = rig();
  for (let i = 0; i < 8; i++) {
    buffer.feed({ on: 1, n: 60 + i, v: 90, t: 16 + i });
    buffer.feed({ on: 0, n: 60 + i, v: 0, t: 16.5 + i });
  }
  clock.at(24.3);
  assert.equal(engine.capture(1, 2, 0), true);
  const s = engine.slots[1];
  assert.equal(s.st, 'play');
  assert.equal(s.lenBars, 2);
  assert.equal(s.fromBar, 4, 'anchored where it was played, bar 5');
  assert.deepEqual(s.layers[0].map(n => n.p), [60, 61, 62, 63, 64, 65, 66, 67]);
});

test('capture with nothing in the buffer reports failure rather than an empty lane', () => {
  const { clock, engine } = rig();
  clock.at(24);
  assert.equal(engine.capture(0, 4, 0), false);
  assert.equal(engine.slots[0].st, 'empty');
});

// ------------------------------------------------------------------ the volume
// Played twice over the same bars, at full and at half, and compared note for note.
// Both halve: a loop coming back out of the app is the app playing, not you -- what
// the level never touches is the keys under your hands, which never come through here.
test('the volume scales the backing track and the recorded lane alike', () => {
  function run(level) {
    const { clock, buffer, engine } = rig();
    buffer.feed({ on: 1, n: 67, v: 90, t: 0.1 });   // one bar of your own playing,
    buffer.feed({ on: 0, n: 67, v: 0, t: 0.6 });    // captured into a lane that tiles
    clock.at(4);
    assert.equal(engine.capture(0, 1, 0), true);
    engine.patch(0, x => { x.follow = false; });    // keep the pitch, so it stays spottable
    const ons = [];
    const off = onSend(d => { if ((d[0] & 0xf0) === 0x90 && d[2] > 0) ons.push([d[1], d[2]]); });
    setVolume(level);
    try { for (let b = 4; b < 8; b += 0.2) { clock.at(b); engine.pump(); } }
    finally { off(); setVolume(1); }
    return ons;
  }

  const full = run(1), half = run(0.5);
  assert.ok(full.some(([p]) => p === 67), 'the lane sounded');
  assert.ok(full.some(([p]) => p !== 67), 'so did the backing track');
  assert.deepEqual(half.map(([p]) => p), full.map(([p]) => p), 'the same notes either way');
  // onSend sees the note as the engine wrote it -- send() scales what this machine
  // plays and leaves the tap unscaled, so the engine must be emitting the same
  // velocities at both levels and letting midi.js do the turning down
  assert.deepEqual(half, full, 'the engine emits as played; the level lands in send()');
});

// The same run seen from the other end: what actually reaches the speakers is the
// emitted velocity put through the level, note for note.
test('what the synth is struck with is the emitted velocity at the level', async () => {
  const midi = await import('../src/midi.js');
  const { scaleVelocity } = await import('../src/volume.js');
  const struck = [];
  midi.setSynth({
    noteOn: (n, v) => struck.push(v), noteOff() {}, setPedal() {}, allOff() {},
  });
  midi.setOutputMode('audio');
  const emitted = [];
  const off = midi.onSend(d => {
    if ((d[0] & 0xf0) === 0x90 && d[2] > 0) emitted.push(d[2]);
  });
  const { clock, engine } = rig();
  setVolume(0.5);
  try { for (let b = 0; b < 2; b += 0.2) { clock.at(b); engine.pump(); } }
  finally { off(); setVolume(1); }
  assert.ok(emitted.length, 'the backing reached the speakers');
  assert.deepEqual(struck, emitted.map(v => scaleVelocity(v, 0.5)));
  assert.ok(struck.every((v, i) => v < emitted[i]), 'and every one of them came out quieter');
});

test('clearing a lane is undoable, so it needs no confirmation', () => {
  const { clock, buffer, engine } = rig();
  buffer.feed({ on: 1, n: 60, v: 90, t: 16 }); buffer.feed({ on: 0, n: 60, v: 0, t: 17 });
  clock.at(24.1); engine.capture(0, 2, 0);
  engine.clear(0);
  assert.equal(engine.slots[0].st, 'empty');
  engine.undo(0);
  assert.equal(engine.slots[0].st, 'play');
  assert.deepEqual(engine.slots[0].layers[0].map(n => n.p), [60]);
});

test('undo drops the last overdub layer and redo puts it back', () => {
  const { engine } = rig();
  engine.patch(0, s => {
    Object.assign(s, { st: 'play', lenBars: 4, fromBar: 0, layers: [[], [], []] });
  });
  engine.undo(0);
  assert.equal(engine.slots[0].layers.length, 2);
  engine.redo(0);
  assert.equal(engine.slots[0].layers.length, 3);
});

test('a soloed lane silences the others but keeps them cycling', () => {
  const { engine } = rig();
  engine.patch(0, s => Object.assign(s, { st: 'play', layers: [[{ b: 0, len: 1, p: 60, v: 80 }]] }));
  engine.patch(1, s => Object.assign(s, { st: 'play', layers: [[{ b: 0, len: 1, p: 62, v: 80 }]] }));
  assert.equal(engine.audible(engine.slots[0]), true);
  engine.patch(1, s => { s.solo = true; });
  assert.equal(engine.audible(engine.slots[0]), false);
  assert.equal(engine.audible(engine.slots[1]), true);
  assert.equal(engine.slots[0].st, 'play', 'still cycling, just silent');
});

// ------------------------------------------------------------------ melody export
test('an exported melody is something tracks.json actually accepts', async () => {
  const slot = {
    ...newSlot(0), st: 'play', fromBar: 0, lenBars: 2, layers: [[
      { b: 0, len: 0.6, p: 67, v: 80 },
      { b: 0.67, len: 0.3, p: 70, v: 80 },      // on the shuffled offbeat
      { b: 2, len: 1.8, p: 72, v: 80 },
      { b: 5, len: 2.5, p: 65, v: 80 },
    ]],
  };
  const mel = toMelody(slot, track, { div: 0, strength: 0 }, 'take 1');
  assert.equal(mel.bars.length, 12, 'a whole chorus, which is what the loop sounds like');
  for (const bar of mel.bars)
    assert.equal(bar.reduce((a, c) => a + c[1], 0), 8, 'every bar accounts for 8 eighths');

  // hand it to the real loader, which is what would validate it in the app
  const doc = {
    version: 1, melodies: { take1: mel },
    tracks: [{ ...track, melody: 'take1', form: BLUES, pattern: track.pattern, scale: { name: 'blues', intervals: track.scale } }],
  };
  const saved = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => doc });
  try {
    const [loaded] = await loadTracks('x');
    assert.equal(loaded.melody.name, 'take 1');
    assert.equal(loaded.melody.bars.length, 12);
  } finally { globalThis.fetch = saved; }
});

// The composer writes its melodies with the same function now (composer.test.mjs
// compares the two ends), so the looper's own output is pinned here: moving the
// writer must not quietly move where a note lands.
test('a lane comes out on the eighths it was heard on, shuffle and all', () => {
  const lane = () => ({
    ...newSlot(0), st: 'play', fromBar: 0, lenBars: 2, mode: 'fill', follow: false,
    oct: 1, layers: [[
      { b: 0, len: 0.6, p: 67, v: 80 },
      { b: 0.67, len: 0.3, p: 70, v: 80 },      // on the shuffled offbeat
      { b: 1.5, len: 0.2, p: 60, v: 80 },
      { b: 2, len: 1.8, p: 72, v: 80 },
      { b: 5, len: 2.5, p: 65, v: 80 },
    ]],
  });
  const mel = toMelody(lane(), track, { div: 0, strength: 0 }, 'take 1');
  assert.deepEqual(mel.bars[0], [['G5', 1], ['A#5', 2], ['C5', 1], ['C6', 4]]);
  assert.deepEqual(mel.bars[1], [[null, 2], ['F5', 6]]);
  assert.deepEqual(mel.bars[2], mel.bars[0], 'and the repeat is the same line');
  assert.deepEqual(
    mel, melodyOf(slotNotes(lane(), track, { div: 0, strength: 0 }),
      { bars: track.form.length, swing: track.swing, name: 'take 1' }),
    'toMelody is melodyOf over an expanded lane, and nothing else');
});
