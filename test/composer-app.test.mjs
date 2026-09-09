// The composer page, tested where it can be: the transport's scheduling and the
// roll's pointer arithmetic. Both are the parts that go wrong silently -- a note
// scheduled straight in a swung piece is only "a bit off" at the piano, and a drag
// that lands a note between grid lines only shows up later, as a piece that will not
// write. Neither needs a browser: the clock is injected and the gesture maths is pure.
//
// The page's own furniture (every id app.js reaches for) is checked in wiring.test.mjs.

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { makeTransport, LOOKAHEAD_MS, TICK_MS } from '../src/composer/transport.js';
import { gestureOf, barRange } from '../src/composer/roll.js';
import { emptyPiece } from '../src/composer/piece.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = f => readFileSync(join(ROOT, f), 'utf8');

// A clock whose timestamps are beats, as looper.test.mjs uses: `time(b) === b`, so a
// scheduled timestamp reads as the beat it was meant to sound on.
function fakeClock() {
  let b = 0, bpm = 100, running = false;
  return {
    get bpm() { return bpm }, get running() { return running },
    at(v) { b = v; return this },
    start(atBeat) { b = atBeat ?? b; running = true },
    stop() { running = false },
    beat(t) { return t === undefined ? b : t },
    time(x) { return x },
    setBpm(v) { bpm = v },
  };
}

/** A metronome stand-in: it counts pumps and never asks for an AudioContext. */
function fakeMetro() {
  return {
    pumps: 0, enabled: false, running: false,
    setEnabled(v) { this.enabled = !!v }, setAccent() {}, setRange() {},
    start() { this.running = true }, stop() { this.running = false },
    pump() { this.pumps++; return 0 },
  };
}

// Every transport a test starts, so a failed assertion cannot leave a real
// `setInterval` running and hang the whole run.
const live = [];
after(() => { for (const t of live) t.stop(); });

function rig(piece) {
  const clock = fakeClock(), metro = fakeMetro();
  const sent = [], panics = [];
  const t = makeTransport({
    clock, metro,
    send: (d, at) => sent.push({ d, at }),
    panic: () => panics.push(1),
  });
  t.load(piece);
  live.push(t);
  return { clock, metro, t, sent, panics, ons: () => sent.filter(s => (s.d[0] & 0xf0) === 0x90) };
}

const piece = (over = {}) => ({
  ...emptyPiece({ title: 'Test', bpm: 100 }),
  sections: [{ name: 'Whole song', from: 1, to: 2, hint: '', coach: '' }],
  ...over,
});

const N = (b, n, len = 0.5, hand = 'rh', v = 80) => ({ b, len, n, hand, v });
const near = (a, b, why) => assert.ok(Math.abs(a - b) < 1e-6, `${why}: ${a} vs ${b}`);

// ------------------------------------------------------------------ transport
test('the transport schedules the piece swung, from beat 0', () => {
  const p = piece({ swing: '2/3', notes: [N(0, 60), N(0.5, 62), N(1, 64)] });
  const { t, clock, ons } = rig(p);
  t.play();
  // the window is 120 ms wide -- .2 of a beat at 100 bpm -- so it is walked, not jumped
  for (let b = 0; b < 1.5; b += 0.1) { clock.at(b); t.pump(); }
  const at = n => ons().find(s => s.d[1] === n)?.at;
  near(at(60), 0, 'the downbeat is where it is written');
  near(at(62), 2 / 3, 'the offbeat eighth is pushed to 2/3 of the beat');
  near(at(64), 1, 'and the next beat is straight again');
  t.stop();                         // play() runs a real interval; leaving one on hangs node
});

test('a straight piece is played straight -- the swing is a header, not a position', () => {
  const p = piece({ swing: 0.5, notes: [N(0.5, 62)] });
  const { t, clock, ons } = rig(p);
  t.play();
  clock.at(0.5); t.pump();
  near(ons()[0].at, 0.5, 'the offbeat eighth stays where it is written');
  t.stop();
});

test('every note gets its note-off, at the end of the note', () => {
  const p = piece({ swing: '2/3', notes: [N(0.5, 62, 0.5)] });
  const { t, clock, sent } = rig(p);
  t.play();
  clock.at(0.6); t.pump();
  const off = sent.find(s => (s.d[0] & 0xf0) === 0x80);
  assert.ok(off, 'the note is released');
  near(off.at, 1, 'the swung eighth ends on the beat after it');
  t.stop();
});

test('a selection loops, so an edit can be auditioned', () => {
  const p = piece({ notes: [N(0, 60), N(4, 67), N(8, 72)] });
  const { t, clock, ons } = rig(p);
  t.setSelection({ from: 4, to: 8 });
  t.play();
  assert.equal(clock.beat(), 4, 'play starts at the top of the selection');
  for (let b = 4; b < 13; b += 0.5) { clock.at(b); t.pump(); }
  const pitches = ons().map(s => s.d[1]);
  assert.ok(!pitches.includes(60) && !pitches.includes(72), 'only the selected bar sounds');
  assert.ok(pitches.filter(x => x === 67).length >= 2, 'and it comes round again');
  t.stop();
});

test('the beat you started on is not dropped as already gone', () => {
  const p = piece({ notes: [N(0, 60), N(4, 67)] });
  const { t, clock, ons } = rig(p);
  t.play();
  clock.at(0.001); t.pump();        // the first round is always a hair after the start
  assert.deepEqual(ons().map(s => s.d[1]), [60], 'the downbeat sounds');
  t.stop();
});

test('nothing is scheduled twice as the window walks forward', () => {
  const p = piece({ notes: [N(0, 60), N(1, 62), N(2, 64), N(3, 65)] });
  const { t, clock, ons } = rig(p);
  t.play();
  for (let b = 0; b < 4; b += 0.05) { clock.at(b); t.pump(); }
  assert.equal(ons().length, 4, 'four notes, four note-ons');
  t.stop();
});

test('stop is clean: the timer goes, the click stops and everything is silenced', () => {
  const p = piece({ notes: [N(0, 60)] });
  const { t, clock, metro, panics } = rig(p);
  t.play();
  assert.equal(t.running, true);
  t.stop();
  assert.equal(t.running, false, 'the transport is idle');
  assert.equal(metro.running, false, 'the click has stopped');
  assert.equal(clock.running, false, 'and so has the clock');
  assert.ok(panics.length >= 1, 'all notes off');
  const before = t.position();
  clock.at(9); t.pump();
  assert.deepEqual(t.position().running, before.running, 'a pump after stop does nothing');
});

test('record starts a bar of count-in behind beat 0, with the click running', () => {
  const p = piece({ meter: '3/4', notes: [] });
  const { t, clock, metro } = rig(p);
  t.record();
  assert.equal(clock.beat(), -3, 'one bar of the piece\'s own meter');
  assert.equal(metro.running, true);
  assert.equal(t.recording, true);
  assert.equal(t.position().countIn, true);
  t.stop();
});

test('recording over a piece is an overdub: the piece plays underneath', () => {
  const p = piece({ notes: [N(0, 60)] });
  const { t, clock, ons } = rig(p);
  t.record();
  for (let b = -4; b < 1; b += 0.25) { clock.at(b); t.pump(); }
  assert.deepEqual(ons().map(s => s.d[1]), [60], 'what is already there sounds while you play');
  t.stop();
});

test('the look-ahead window is the looper\'s, in ms not beats', () => {
  assert.equal(LOOKAHEAD_MS, 120);
  assert.equal(TICK_MS, 25);
});

// ------------------------------------------------------------------ roll gestures
const start = (b, n, over = {}) => ({ b, n, idx: null, noteB: 0, noteLen: 0, edge: false, ...over });

test('a click on empty space inserts one grid unit at that pitch', () => {
  const g = gestureOf(start(1.31, 64), { b: 1.31, n: 64 }, { grid: '1/8', moved: false });
  assert.equal(g.kind, 'insert');
  near(g.b, 1, 'the cell it fell in, not the nearest line');
  assert.equal(g.n, 64);
});

test('a drag across empty space selects whole bars, whichever way it went', () => {
  const fwd = gestureOf(start(1.2, 60), { b: 6.9, n: 70 }, { bpb: 4 });
  assert.deepEqual([fwd.kind, fwd.from, fwd.to], ['range', 0, 8]);
  const back = gestureOf(start(6.9, 60), { b: 1.2, n: 70 }, { bpb: 4 });
  assert.deepEqual([back.from, back.to], [0, 8], 'a backwards drag is the same bars');
  assert.deepEqual(barRange(9, 9, 3), { from: 9, to: 12 }, 'and the meter is the bar');
});

test('a drag on a note moves it in time on the grid and in pitch by semitone', () => {
  const s = start(1.1, 60, { idx: 3, noteB: 1, noteLen: 1 });
  const g = gestureOf(s, { b: 2.4, n: 63 }, { grid: '1/8' });
  assert.equal(g.kind, 'drag');
  assert.equal(g.idx, 3);
  near(g.dBeats, 1.5, 'snapped to the eighth, measured from the note not the grab');
  assert.equal(g.dSemis, 3);
  near(gestureOf(s, { b: 2.4, n: 60 }, { grid: '1/8T' }).dBeats, 4 / 3, 'a triplet grid snaps to thirds');
});

test('a drag on the right edge sets the length, never shorter than a grid unit', () => {
  const s = start(2.9, 60, { idx: 0, noteB: 1, noteLen: 2, edge: true });
  near(gestureOf(s, { b: 3.4, n: 60 }, { grid: '1/8' }).len, 2.5, 'snapped to the eighth');
  near(gestureOf(s, { b: 0.9, n: 60 }, { grid: '1/8' }).len, 0.5, 'a drag past the start is one unit');
});

test('a click on a note picks it, and a click is not a drag', () => {
  const s = start(1.1, 60, { idx: 2, noteB: 1, noteLen: 1 });
  assert.deepEqual(gestureOf(s, { b: 1.1, n: 60 }, { moved: false }), { kind: 'pick', idx: 2 });
  assert.equal(gestureOf({ ...s, edge: true }, { b: 1.1, n: 60 }, { moved: false }).kind, 'pick');
});

// ------------------------------------------------------------------ the page
test('the composer page loads its own module, the shared stylesheets and abcjs', () => {
  const html = read('composer.html');
  assert.match(html, /<script type="module" src="src\/composer\/app\.js">/);
  for (const css of ['style.css', 'looper.css', 'learn.css', 'composer.css'])
    assert.ok(html.includes(`href="${css}"`), `composer.html loads ${css}`);
  assert.match(html, /vendor\/abcjs-basic-min\.js/, 'the staff preview needs the engraver');
});

test('every page offers the composer in its nav', () => {
  for (const page of ['index.html', 'learn.html', 'guitar.html', 'composer.html'])
    assert.match(read(page), /<a href="composer\.html"/, `${page} links to the composer`);
});

test('every control on the composer page carries a tip', () => {
  const html = read('composer.html');
  const buttons = [...html.matchAll(/<button\b[^>]*>/g)].map(m => m[0]);
  const bare = buttons.filter(b => !b.includes('data-tip'));
  assert.deepEqual(bare, [], 'a control with no tip: ' + bare.join(' '));
});
