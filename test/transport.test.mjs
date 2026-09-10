// The one scheduling loop, tested on its own: what lands in a window, how a source
// repeats, and that a stop leaves nothing running and nothing sounding.
//
// The looper's engine and the composer's transport are both built on this file, and
// their own tests (looper.test.mjs, composer-app.test.mjs) are what say the two pages
// still behave. What is here is the seam itself.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { makeScheduler, emitNotes, LOOKAHEAD_MS, TICK_MS } from '../src/transport.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = f => readFileSync(join(ROOT, f), 'utf8');

/** A clock whose timestamps are beats, as the other transport tests use. */
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

function fakeMetro() {
  return {
    pumps: 0, enabled: false, running: false,
    setEnabled(v) { this.enabled = !!v }, setAccent() {}, setRange() {},
    start() { this.running = true }, stop() { this.running = false },
    pump() { this.pumps++; return 0 },
  };
}

const N = (b, p, len = 0.5, v = 80) => ({ b, p, len, v });
const near = (a, b, why) => assert.ok(Math.abs(a - b) < 1e-9, `${why}: ${a} vs ${b}`);

function catcher() {
  const sent = [], clock = fakeClock();
  const send = (d, at) => sent.push({ d, at });
  return {
    clock, sent,
    ons: () => sent.filter(s => (s.d[0] & 0xf0) === 0x90),
    emit: (notes, from, to, opts) => emitNotes(notes, from, to, { send, clock, ...opts }),
  };
}

// ------------------------------------------------------------------ the window
test('a source plays once when it does not loop', () => {
  const c = catcher();
  c.emit([N(0, 60), N(1, 62), N(9, 64)], 0, 2);
  assert.deepEqual(c.ons().map(s => s.d[1]), [60, 62], 'only what falls in the window');
});

test('every note gets its note-off, a length later', () => {
  const c = catcher();
  c.emit([N(0.5, 62, 1.5)], 0, 1);
  const off = c.sent.find(s => (s.d[0] & 0xf0) === 0x80);
  near(off.at, 2, 'the note is released where it ends');
});

test('a looping source comes round again, and only its own notes do', () => {
  const c = catcher();
  const notes = [N(0, 60), N(4, 67), N(8, 72)];
  for (let b = 4; b < 12; b += 0.5) c.emit(notes, b, b + 0.5, { base: 4, loop: 4 });
  const ps = c.ons().map(s => s.d[1]);
  assert.deepEqual(ps, [67, 67], 'the loop is the four beats picked out, twice');
  near(c.ons()[1].at, 8, 'the second time round is one cycle later');
});

test('a cycle before the base still sounds -- a loop is running during the count-in', () => {
  const c = catcher();
  c.emit([N(3, 60)], -1.5, -0.5, { base: 0, loop: 4 });
  assert.equal(c.ons().length, 1, 'the last beat of the cycle before beat 0');
  near(c.ons()[0].at, -1, 'one whole cycle behind where it is written');
});

test('nothing is scheduled twice as the window walks forward', () => {
  const c = catcher();
  const notes = [N(0, 60), N(1, 62), N(2, 64), N(3, 65)];
  for (let b = 0; b < 3.9; b += 0.05) c.emit(notes, b, b + 0.05, { loop: 4 });
  assert.equal(c.ons().length, 4, 'four notes, four note-ons, before it comes round');
});

// ------------------------------------------------------------------ the loop itself
test('a pump fills one look-ahead window and pumps the click', () => {
  const clock = fakeClock(), metro = fakeMetro();
  const seen = [];
  const s = makeScheduler({ clock, metro, send() {}, panic() {}, fill: (a, b) => seen.push([a, b]) });
  clock.at(2);
  s.pump();
  assert.equal(seen.length, 1);
  near(seen[0][0], 2, 'the window starts at now');
  near(seen[0][1], 2 + LOOKAHEAD_MS / 600, 'and is the look-ahead wide, in beats');
  assert.equal(metro.pumps, 1, 'the click is fed from the same round');
});

test('a fill that says nothing is running leaves the click alone', () => {
  const clock = fakeClock(), metro = fakeMetro();
  const s = makeScheduler({ clock, metro, send() {}, panic() {}, fill: () => false });
  s.pump();
  assert.equal(metro.pumps, 0);
});

test('stop halts the timer, the click and the clock, and silences the port', () => {
  const clock = fakeClock(), metro = fakeMetro();
  const panics = [], order = [];
  const s = makeScheduler({
    clock, metro, send() {}, panic: () => panics.push(1), fill: () => {},
  });
  s.start(0);
  assert.equal(s.running, true, 'a timer is up');
  assert.equal(metro.running, true, 'and the click is counting');
  s.stop(() => order.push(clock.running));
  assert.deepEqual(order, [true], 'what was open is closed while the clock still stands');
  assert.equal(s.running, false);
  assert.equal(metro.running, false);
  assert.equal(clock.running, false);
  assert.ok(panics.length >= 1, 'all notes off');
});

// ------------------------------------------------------------------ one transport
test('both pages are built on this file, not on a scheduler of their own', () => {
  for (const f of ['src/looper/engine.js', 'src/composer/transport.js']) {
    const src = read(f);
    assert.match(src, /from '\.\.\/transport\.js'/, `${f} takes its scheduling from src/transport.js`);
    assert.ok(!/setInterval/.test(src), `${f} runs no timer of its own`);
  }
  assert.equal(TICK_MS, 25);
  assert.equal(LOOKAHEAD_MS, 120);
});
