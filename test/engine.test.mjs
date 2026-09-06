// The learn transport, driven against a fake clock and fake timers: does the loop
// actually wrap, pass after pass, in every mode and across mid-play changes?
import { test } from 'node:test';
import assert from 'node:assert/strict';

// ---------------------------------------------------------------- fake browser
let fakeNow = 10_000;
const timers = new Map();
let tid = 0;
globalThis.performance = { now: () => fakeNow, timeOrigin: 0 };
globalThis.setInterval = (fn, ms) => { timers.set(++tid, { fn, ms, at: fakeNow + ms, rep: true }); return tid; };
globalThis.setTimeout  = (fn, ms) => { timers.set(++tid, { fn, ms, at: fakeNow + ms, rep: false }); return tid; };
globalThis.clearInterval = globalThis.clearTimeout = id => timers.delete(id);

/** Move time forward, firing every timer that comes due, in order. */
function advance(ms) {
  const end = fakeNow + ms;
  for (;;) {
    let next = null;
    for (const [id, t] of timers) if (t.at <= end && (!next || t.at < next.t.at)) next = { id, t };
    if (!next) break;
    fakeNow = next.t.at;
    if (next.t.rep) next.t.at += next.t.ms; else timers.delete(next.id);
    next.t.fn();
  }
  fakeNow = end;
}

// a silent audio context, so the click can be on without a browser
globalThis.window = {
  AudioContext: class {
    currentTime = 0; state = 'running'; destination = {};
    resume() {}
    createOscillator() { return { type: '', frequency: {}, connect: g => g, start() {}, stop() {} }; }
    createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect: () => ({ connect() {} }) }; }
  },
};

// a MIDI port that records what is sent to it
const sent = [];
const port = { name: 'fake', send: (data, t) => sent.push({ data, t: t ?? fakeNow }) };
Object.defineProperty(globalThis, 'navigator', { value: { requestMIDIAccess: async () => ({ outputs: new Map([['o', port]]), inputs: new Map() }) }, configurable: true });

const { initMidi } = await import('../src/midi.js');
await initMidi({ onStatus() {}, onNote() {} });
const { makeClock } = await import('../src/clock.js');
const { parseSong } = await import('../src/song.js');
const { makeLearnEngine } = await import('../src/learn/engine.js');
const { YOU, APP, OFF } = await import('../src/learn/plan.js');

// ---------------------------------------------------------------- fixtures
// one bar: eight eighths in the right hand, two half notes in the left
const song = () => parseSong({
  id: 'one', title: 'One bar', bpm: 120,
  rh: ['C4 D4 E4 F4 G4 A4 B4 C5'], lh: ['C3:4 G3:4'],
});

const live = [];                                // engines are stopped before the next test's starts
function setup({ bpm = 120, hands = { lh: YOU, rh: YOU }, loop = true, wait = false, metro = false } = {}) {
  while (live.length) live.pop().stop();
  sent.length = 0;
  const clock = makeClock(bpm);
  const eng = makeLearnEngine({ clock });
  live.push(eng);
  eng.load(song());
  eng.setHands(hands); eng.setLoop(loop); eng.setWait(wait); eng.setMetro(metro);
  const ev = { pass: [], end: 0, hit: [], extra: [], miss: [], ignored: [], reset: [] };
  eng.on('pass', r => ev.pass.push(r));
  eng.on('end', () => ev.end++);
  eng.on('hit', h => ev.hit.push(h));
  eng.on('extra', x => ev.extra.push(x));
  eng.on('miss', m => ev.miss.push(m));
  eng.on('ignored', x => ev.ignored.push(x));
  eng.on('reset', es => ev.reset.push(...es));
  return { eng, clock, ev };
}

const noteOns = () => sent.filter(s => s.data[0] === 0x90).map(s => ({ n: s.data[1], t: s.t }));
const SPB = 500, BAR = 4 * SPB;               // 120 bpm: a beat is 500 ms, the loop 2 s

// ---------------------------------------------------------------- flow mode
test('a looping bar wraps pass after pass, each with a fresh tally', () => {
  const { eng, ev } = setup();
  eng.play();
  assert.ok(eng.running);
  assert.ok(eng.position().countIn);
  advance(BAR);                                 // the count-in bar
  assert.ok(!eng.position().countIn);
  advance(3 * BAR + 60);
  assert.equal(ev.pass.length, 3);
  assert.equal(eng.position().pass, 3);
  assert.ok(ev.pass.every(r => r.total === 10 && r.hits === 0 && r.misses === 10));
  assert.equal(eng.tally.hits, 0);
  assert.ok(eng.running);
  assert.equal(ev.end, 0);
  eng.stop();
  assert.ok(!eng.running);
});

test('with loop off it plays the bars once, reports the pass, and stops', () => {
  const { eng, ev } = setup({ loop: false });
  eng.play();
  advance(BAR + BAR + 60);
  assert.equal(ev.pass.length, 1);
  assert.equal(ev.end, 1);
  assert.ok(!eng.running);
  advance(3 * BAR);
  assert.equal(ev.pass.length, 1);              // nothing keeps ticking after the end
});

test('the app hand is scheduled once per pass, with no gap or double across the wrap', () => {
  const { eng, clock } = setup({ hands: { lh: APP, rh: YOU } });
  eng.play();
  advance(BAR + 3 * BAR + 60);
  const c3 = noteOns().filter(x => x.n === 48).map(x => x.t);
  const g3 = noteOns().filter(x => x.n === 55).map(x => x.t);
  assert.equal(c3.length, 4, 'C3 of the fourth pass is already queued, a lookahead ahead of the wrap');
  assert.equal(g3.length, 3, 'G3 of the fourth pass is a second away, so not yet');
  for (let i = 1; i < c3.length; i++) assert.equal(Math.round(c3[i] - c3[i - 1]), BAR);
  for (let i = 1; i < g3.length; i++) assert.equal(Math.round(g3[i] - g3[i - 1]), BAR);
  assert.equal(Math.round(c3[0]), Math.round(clock.time(0)));
  assert.equal(Math.round(g3[0] - c3[0]), 2 * SPB);
  // every note-on has its note-off
  assert.equal(sent.filter(s => s.data[0] === 0x80).length, noteOns().length);
});

// The hands are the whole contract: You is what you are challenged on, App is a
// companion the app plays that is never counted for you, Off is neither.
test('the hand you chose is the hand you are challenged on', () => {
  const { eng, ev } = setup();                            // both hands yours
  eng.setHands({ lh: APP, rh: YOU });                     // the app takes the left, you play the right
  eng.play();
  advance(BAR);                                           // through the count-in
  assert.ok(eng.tally.expected.length);
  assert.ok(eng.tally.expected.every(e => e.hand === 'rh'), 'only the hand set to You is expected');
  assert.ok(eng.groups.every(g => g.notes.every(e => e.hand === 'rh')));
  assert.ok(noteOns().length);
  assert.ok(noteOns().every(x => x.n === 48 || x.n === 55), 'the app sends the left hand and nothing else');
  // the app's hand is outside your part: playing it is ignored, never a wrong note
  eng.noteOn(48, fakeNow);
  assert.equal(ev.ignored.length, 1);
  assert.equal(ev.extra.length, 0);
  eng.noteOn(61, fakeNow);                                // C#4: in neither hand
  assert.equal(ev.extra.length, 1);
  eng.stop();
});

test('a hand set to Off is neither played out nor expected', () => {
  const { eng } = setup({ hands: { lh: APP, rh: OFF } });
  eng.play();
  advance(BAR + BAR / 2);
  assert.equal(eng.tally.expected.length, 0, 'no hand is yours, so nothing is expected');
  assert.ok(noteOns().length, 'the left hand is still played out');
  assert.equal(noteOns().filter(x => x.n >= 60).length, 0, 'not one right-hand note is sent');
  eng.stop();
});

test('wait mode: the other hand is ignored, and Off leaves nothing to wait for', () => {
  const { eng, ev } = setup({ hands: { lh: APP, rh: YOU }, wait: true });
  eng.play();
  assert.ok(eng.groups.every(g => g.notes.every(e => e.hand === 'rh')));
  eng.noteOn(55, fakeNow);                                // G3: the app's hand
  assert.equal(ev.extra.length, 0);
  assert.equal(ev.ignored.length, 1);
  assert.equal(eng.position().gi, 0, 'and it does not move the cursor');
  eng.setHands({ rh: OFF });
  assert.equal(eng.groups.length, 0);
  eng.stop();
});

test('changing hands, tempo and the click mid-play keeps the loop wrapping', () => {
  const { eng, clock, ev } = setup({ hands: { lh: APP, rh: YOU } });
  eng.play();
  advance(BAR + BAR / 2);                       // half way through pass 1
  eng.setHands({ rh: APP });                    // the app takes the right hand too
  advance(BAR / 2 + 60);
  assert.equal(ev.pass.length, 1);
  const before = noteOns().length;
  eng.setBpm(60);                               // the loop is now 4 s long
  eng.setMetro(true);
  const b = clock.beat();
  advance(4000 - (b - eng.loopStart - eng.loopLen * 1) * 1000 + 60);   // to the end of pass 2
  assert.equal(ev.pass.length, 2);
  assert.ok(noteOns().length > before, 'the right hand is being sent now');
  eng.setMetro(false);
  eng.setHands({ lh: OFF, rh: YOU });
  advance(4000);
  assert.equal(ev.pass.length, 3);
  assert.ok(eng.running);
  eng.stop();
});

test('a note played a hair before the wrap counts for the next pass, not as a wrong note', () => {
  const { eng, ev } = setup({ hands: { lh: OFF, rh: YOU } });
  eng.play();
  advance(BAR + BAR - 40);                      // 40 ms before pass 1 ends
  eng.noteOn(60, fakeNow);                      // C4: the first onset of the bar
  assert.equal(ev.extra.length, 0);
  assert.equal(ev.hit.length, 0, 'not scored until the wrap');
  advance(100);
  assert.equal(ev.pass.length, 1);
  assert.equal(ev.pass[0].extras, 0);
  assert.equal(ev.hit.length, 1);
  assert.equal(ev.hit[0].b, 0);
  assert.equal(eng.tally.hits, 1);
  assert.ok(ev.hit[0].hit.off < 0, 'recorded as early');
  eng.stop();
});

test('notes in time are hits, late ones are misses, wrong ones are extras', () => {
  const { eng, clock, ev } = setup({ hands: { lh: OFF, rh: YOU } });
  eng.play();
  advance(BAR);
  const at = beat => clock.time(beat);
  eng.noteOn(60, at(0) + 30);                   // C4 on the one, a touch late
  advance(SPB / 2);
  eng.noteOn(62, fakeNow);                      // D4 on the and
  eng.noteOn(61, fakeNow);                      // C#4: wrong
  advance(BAR - SPB / 2 + 60);
  assert.equal(ev.pass.length, 1);
  const r = ev.pass[0];
  assert.equal(r.hits, 2); assert.equal(r.misses, 6); assert.equal(r.extras, 1);
  assert.equal(ev.miss.length, 6);
  eng.stop();
});

// ---------------------------------------------------------------- seeking
// Clicking a view takes your playing position there. The bookkeeping is the whole
// point: music you were never given the chance to play must not read as misses.
test('seeking forward takes the notes jumped over out of the pass, not counting them as misses', () => {
  const { eng, ev } = setup({ hands: { lh: OFF, rh: YOU } });     // eight onsets, every half beat
  eng.play();
  advance(BAR);                                 // through the count-in, on beat 0
  eng.noteOn(60, fakeNow);                      // C4 on the one: a hit
  advance(SPB / 2);
  eng.seek(3);                                  // jump to the fourth beat
  assert.ok(Math.abs(eng.position().beat - 3) < 0.05);
  assert.equal(ev.miss.length, 0, 'nothing that was jumped over is called a miss');
  assert.equal(eng.tally.expected.filter(e => e.skipped).length, 5);   // 0.5 through 2.5
  eng.noteOn(71, fakeNow);                      // B4, the onset we landed on
  advance(SPB + 60);                            // out through the wrap
  const r = ev.pass[0];
  assert.equal(r.total, 3, 'the pass total shrinks by what was skipped');
  assert.equal(r.hits, 2);
  assert.equal(r.misses, 1);                    // only the C5 on the and of four
  eng.stop();
});

test('seeking back puts that stretch up for scoring again', () => {
  const { eng, ev } = setup({ hands: { lh: OFF, rh: YOU } });
  eng.play();
  advance(BAR);
  eng.noteOn(60, fakeNow);                      // C4 hit, then two beats of nothing
  advance(2 * SPB);
  assert.equal(eng.tally.hits, 1);
  assert.ok(ev.miss.length >= 3);
  eng.seek(0);
  assert.equal(eng.tally.hits, 0, 'the hit it took back comes off the count too');
  assert.equal(ev.reset.length, 4, 'the four onsets before beat 2 are up for scoring again');
  assert.ok(eng.tally.expected.slice(0, 4).every(e => !e.hit && !e.missed && !e.skipped));
  for (const n of [60, 62, 64, 65]) { eng.noteOn(n, fakeNow); advance(SPB / 2); }
  advance(2 * SPB + 60);                        // out through the wrap
  const r = ev.pass[0];
  assert.equal(r.total, 8, 'nothing was skipped, so the pass is still the whole bar');
  assert.equal(r.hits, 4);
  eng.stop();
});

test('a seek re-aims the app hand, so it plays on from there and repeats nothing', () => {
  const { eng } = setup({ hands: { lh: APP, rh: YOU } });         // C3 on beat 0, G3 on beat 2
  eng.play();
  advance(BAR + 30);                            // just into the pass: C3 has gone out, G3 has not
  assert.equal(noteOns().filter(x => x.n === 48).length, 1);
  assert.equal(noteOns().filter(x => x.n === 55).length, 0);
  eng.seek(1.9);
  advance(200);
  assert.equal(noteOns().filter(x => x.n === 55).length, 1, 'G3 goes out from the new position');
  assert.equal(noteOns().filter(x => x.n === 48).length, 1, 'and C3 is not played a second time');
  assert.ok(eng.running);
  eng.stop();
});

test('pause holds the sounding beat, and resume skips the count-in', () => {
  const { eng } = setup();
  eng.play();
  advance(BAR + SPB);                           // count-in, then one beat into the pass
  const at = eng.position().beat;
  assert.ok(at > 0.8 && at < 1.2, `paused around beat 1, got ${at}`);
  eng.pause();
  assert.ok(!eng.running);
  assert.ok(Math.abs(eng.startAt - at) < 0.15, `startAt ${eng.startAt} should hold ${at}`);
  assert.ok(Math.abs(eng.position().beat - at) < 0.15);
  eng.resume(2);
  assert.ok(eng.running);
  assert.ok(!eng.position().countIn, 'a finger-lift must not replay the click bar');
  assert.ok(Math.abs(eng.position().beat - 2) < 0.15, `resumed at ${eng.position().beat}`);
  eng.stop();
});

test('play() still counts in; play({ countIn: false }) does not', () => {
  const { eng, clock } = setup();
  eng.seek(0);
  eng.play();
  assert.ok(eng.position().countIn);
  assert.ok(clock.beat() < 0);
  eng.stop();
  eng.play({ countIn: false });
  assert.ok(eng.running);
  assert.ok(!eng.position().countIn);
  assert.ok(clock.beat() >= -0.05);
  eng.stop();
});

test('a click while idle sets where Play comes in, after the usual count-in bar', () => {
  const { eng, clock, ev } = setup({ hands: { lh: OFF, rh: YOU } });
  eng.seek(2);                                  // stopped: half way through the bar
  assert.equal(eng.startAt, 2);
  assert.equal(eng.position().beat, 2);
  eng.play();
  assert.ok(eng.position().countIn);
  assert.equal(Math.round(clock.beat()), -2, 'a whole bar of click before beat 2');
  advance(BAR);
  assert.ok(!eng.position().countIn);
  assert.ok(Math.abs(eng.position().beat - 2) < 0.05);
  assert.equal(eng.tally.expected.filter(e => e.skipped).length, 4, 'the bar before the entry is not yours');
  advance(2 * SPB + 60);
  assert.equal(ev.pass[0].total, 4);
  eng.stop();
});

test('picking new bars forgets where the last click asked to come in', () => {
  const { eng } = setup();
  eng.seek(2);
  assert.equal(eng.startAt, 2);
  eng.setRange(0, 0);
  assert.equal(eng.startAt, 0);
});

test('wait mode: a click jumps the cursor to the next onset group', () => {
  const { eng } = setup({ hands: { lh: OFF, rh: YOU }, wait: true });
  eng.play();
  assert.equal(eng.position().gi, 0);
  eng.seek(1.2);                                // between the onsets on 1 and on the and of 2
  assert.equal(eng.position().gi, 3);
  assert.equal(eng.position().group.b, 1.5);
  assert.equal(eng.tally.expected.filter(e => e.skipped).length, 3);
  eng.stop();
});

test('a frozen tab that skips two wraps catches up without stalling', () => {
  const { eng, ev } = setup();
  eng.play();
  advance(BAR);
  advance(BAR * 2 + BAR / 2);                   // one jump: two and a half passes go by unseen
  // the jump fires the interval repeatedly at its due times in order, so the
  // engine sees the wraps one tick at a time -- now freeze for real
  fakeNow += BAR * 2;                           // no ticks at all for two passes
  advance(30);                                  // one tick
  assert.equal(ev.pass.length, 4);
  assert.equal(eng.position().pass, 4);
  advance(BAR / 2 + 60);
  assert.equal(ev.pass.length, 5);
  assert.ok(eng.running);
  eng.stop();
});

// ---------------------------------------------------------------- wait mode
test('wait mode steps through the onsets, reports the pass, and loops back', () => {
  const { eng, ev } = setup({ hands: { lh: YOU, rh: YOU }, wait: true });
  eng.play();
  assert.ok(eng.running);
  const groups = eng.groups;
  assert.equal(groups.length, 8);
  assert.deepEqual(groups[0].notes.map(n => n.n), [48, 60]);
  for (let gi = 0; gi < groups.length; gi++) {
    assert.equal(eng.position().gi, gi);
    for (const e of groups[gi].notes) eng.noteOn(e.n, fakeNow);
    advance(200);                               // the short pause before the cursor moves
  }
  assert.equal(ev.hit.length, 10);
  assert.equal(ev.pass.length, 0);
  advance(700);                                 // the tail after the last onset
  assert.equal(ev.pass.length, 1);
  assert.equal(ev.pass[0].hits, 10);
  assert.equal(eng.position().gi, 0);
  assert.equal(eng.position().group.b, 0);
  assert.ok(eng.running);
  assert.equal(eng.tally.hits, 0);
  eng.stop();
});

test('wait mode: a wrong note does not move the cursor, and loop off ends after one pass', () => {
  const { eng, ev } = setup({ hands: { lh: OFF, rh: YOU }, wait: true, loop: false });
  eng.play();
  eng.noteOn(61, fakeNow);
  advance(300);
  assert.equal(eng.position().gi, 0);
  assert.equal(ev.extra.length, 1);
  for (const g of eng.groups) { for (const e of g.notes) eng.noteOn(e.n, fakeNow); advance(200); }
  advance(700);
  assert.equal(ev.pass.length, 1);
  assert.equal(ev.end, 1);
  assert.ok(!eng.running);
});

test('wait mode plays the app hand up to each onset it waits on', () => {
  const { eng } = setup({ hands: { lh: APP, rh: YOU }, wait: true });
  eng.play();
  assert.deepEqual(noteOns().map(x => x.n), [48]);          // C3 sits under the first onset
  for (let gi = 0; gi < 4; gi++) { for (const e of eng.groups[gi].notes) eng.noteOn(e.n, fakeNow); advance(200); }
  assert.deepEqual(noteOns().map(x => x.n), [48, 55]);      // G3 arrived with beat 3's onset
  eng.stop();
});
