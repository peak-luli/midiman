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

test('the guide plays your hand at the guide volume, and a new level lands on the next notes', () => {
  const { eng } = setup({ hands: { lh: OFF, rh: YOU } });
  eng.setGuide(true);
  eng.play();
  advance(BAR + BAR / 2);                       // the count-in, then half of pass 1
  const vel = () => sent.filter(s => s.data[0] === 0x90).map(s => s.data[2]);
  const before = vel();
  assert.ok(before.length, 'the guide is sounding your hand');
  assert.ok(before.every(v => v === 35), `default: 45% of the app's 78 for the right hand, got ${before}`);
  eng.setGuideVol(1);                           // as loud as the app plays a hand of its own
  advance(BAR);
  const after = vel().slice(before.length);
  assert.ok(after.length, 'still sounding after the change');
  assert.ok(after.every(v => v === 78), `full: the app's own velocity, got ${after}`);
  eng.setGuideVol(0);                           // clamped, never silent: off is the Guide button's job
  assert.equal(eng.guideVol, 0.05);
  advance(BAR);
  assert.ok(vel().slice(before.length + after.length).every(v => v === 4), 'five percent, still audible');
  eng.setGuideVol('junk');
  assert.equal(eng.guideVol, 0.45, 'nonsense reads as the default');
  eng.setGuide(false);
  const n = vel().length;
  advance(BAR);
  assert.equal(vel().length, n, 'guide off: your hand is yours again, whatever the level');
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

test('a note played a hair after the wrap counts for the new pass, not as a wrong note', () => {
  // The wrap is noticed by the 25 ms scheduler tick, so for up to a tick after the
  // bar line the engine is still holding the finished pass's tally -- and 110 bpm
  // puts the bar line between two ticks, where a downbeat usually lands. Score the
  // note there and it is judged against a pass whose first onset was claimed a pass
  // ago: the new pass's first note is never scored, and reads as a wrong note.
  const { eng, ev } = setup({ bpm: 110, hands: { lh: OFF, rh: YOU } });
  const BAR110 = 4 * 60000 / 110;               // 2181.8 ms: not a whole number of ticks
  eng.play();
  advance(BAR110);                              // the count-in
  eng.noteOn(60, fakeNow);                      // C4 on the one of pass 1
  assert.equal(ev.hit.length, 1);
  advance(BAR110 + 3);                          // 3 ms past the wrap
  assert.equal(ev.pass.length, 0, 'the tick has not seen the wrap yet');
  eng.noteOn(60, fakeNow);                      // C4 on the one of pass 2
  assert.equal(ev.extra.length, 0, 'the new pass\'s first note is not a wrong note');
  advance(60);                                  // the tick that reports the wrap
  assert.equal(ev.pass.length, 1);
  assert.equal(ev.pass[0].hits, 1);
  assert.equal(ev.pass[0].extras, 0);
  assert.equal(ev.hit.length, 2, 'it is scored, as a hit');
  assert.equal(ev.hit[1].b, 0);
  assert.equal(eng.tally.hits, 1, 'on the new pass, not the finished one');
  assert.ok(eng.tally.expected[0].hit, 'and the view is told to colour it green');
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

test('live progress keeps moving through a whole pass, not only the opening notes', () => {
  const { eng, clock } = setup({ hands: { lh: OFF, rh: YOU } });
  eng.play();
  advance(BAR);                                       // through the count-in
  const exp = eng.tally.expected;
  assert.ok(exp.length >= 8, 'the fixture has a full bar of right-hand notes');
  const lives = [];
  for (const e of exp) {
    const abs = eng.loopStart + e.b;
    const wait = Math.max(0, clock.time(abs) - fakeNow);
    if (wait) advance(wait);
    eng.noteOn(e.n, clock.time(abs));
    lives.push({ ...eng.stats().live, b: e.b });
  }
  for (let i = 1; i < lives.length; i++)
    assert.ok(lives[i].due >= lives[i - 1].due,
      `due stalled at ${lives[i - 1].due} after note ${i} (beat ${lives[i].b})`);
  assert.ok(lives[lives.length - 1].due >= 8);
  assert.ok(lives[2].due < lives[lives.length - 1].due,
    'mid-pass due must not be stuck on the opening hits');
  eng.stop();
});

test('pause and resume keep the running pass tally, so live does not reset', () => {
  const { eng, clock } = setup({ hands: { lh: OFF, rh: YOU } });
  eng.play();
  advance(BAR);
  eng.noteOn(60, clock.time(0));
  advance(SPB / 2);
  eng.noteOn(62, fakeNow);
  const before = eng.stats().live;
  assert.ok(before.hits >= 2, `expected opening hits, got ${before.hits}`);
  const gen = eng.playGen;
  eng.pause();
  assert.ok(!eng.running);
  eng.resume(eng.startAt);
  assert.equal(eng.playGen, gen, 'resume is the same play, not a new Start');
  assert.equal(eng.tally.hits, before.hits);
  assert.equal(eng.stats().live.hits, before.hits);
  advance(SPB / 2);
  eng.noteOn(64, fakeNow);
  assert.ok(eng.stats().live.hits >= 3, 'notes after resume still count on this pass');
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

// The pianist's own pause: not a stop with a nicer name. `paused` is what tells the
// pages to leave the music uncovered, keep the playhead where it is, and offer
// Resume instead of Play -- so it has to be true for exactly as long as the beat is
// being held, and false the moment anything gives that beat up.
test('paused is true only while a beat is being held', () => {
  const { eng } = setup();
  eng.play();
  advance(BAR + SPB);
  assert.equal(eng.paused, false, 'running is not paused');
  eng.pause();
  assert.equal(eng.paused, true);
  assert.equal(eng.position().paused, true, 'the tick payload carries it to the pages');
  eng.resume(eng.startAt);
  assert.equal(eng.paused, false, 'resume gives it up');
  eng.pause();
  eng.stop();
  assert.equal(eng.paused, false, 'so does Stop');
  // and every other way out of a run, all of which go through the same stop()
  eng.play(); advance(BAR); eng.pause();
  eng.play();
  assert.equal(eng.paused, false, 'a fresh Start is not a resume');
  eng.pause();
  eng.setRange(0, 0);
  assert.equal(eng.paused, false, 'a new range throws the held beat away');
  eng.stop();
});

// Resume from the pianist's button rewinds to the top of the bar and counts a bar
// of click in, because coming back in on the and of three is asking to fail. The
// finger-pan on the phone must not get that bar of silence, so it stays the default.
test('resume({ countIn: true }) starts the clock a bar before the target', () => {
  const { eng, clock } = setup();
  eng.play();
  advance(BAR + 2.5 * SPB);                     // count-in, then two and a half beats in
  eng.pause();
  const bpb = 4;
  const barStart = Math.floor(eng.startAt / bpb) * bpb;
  assert.equal(barStart, 0, 'one-bar loop: the bar you paused in starts at 0');
  eng.resume(barStart, { countIn: true });
  assert.ok(eng.running);
  assert.ok(eng.position().countIn, 'a bar of click before you come back in');
  assert.equal(Math.round(clock.beat()), -bpb, `clock at ${clock.beat()}, wanted -${bpb}`);
  advance(BAR);
  assert.ok(!eng.position().countIn);
  assert.ok(Math.abs(eng.position().beat - barStart) < 0.15, `landed on ${eng.position().beat}`);
  eng.stop();
  // the default is still the silent continue the finger-pan was written for
  eng.play(); advance(BAR + SPB); eng.pause();
  eng.resume(eng.startAt);
  assert.ok(!eng.position().countIn);
  eng.stop();
});

// Rewinding to the downbeat puts the part-bar you were in the middle of back up for
// scoring: those notes were never played on this pass, and are about to be.
test('resuming from the bar start offers the part-bar notes again', () => {
  const { eng, clock, ev } = setup({ hands: { lh: OFF, rh: YOU } });
  eng.play();
  advance(BAR);
  eng.noteOn(60, clock.time(0));                // beat 0
  advance(SPB);
  eng.noteOn(62, fakeNow);                      // the eighth on 0.5 is missed, 1 is hit
  const hits = eng.tally.hits;
  assert.ok(hits >= 1);
  eng.pause();
  ev.reset.length = 0;
  eng.resume(0, { countIn: true });
  assert.ok(ev.reset.length, 'the bar you are coming back into is up for scoring again');
  assert.equal(eng.tally.hits, 0, 'and nothing before the resume point is claimed');
  eng.stop();
});

// Wait mode has no clock, so the beat the clock is on says nothing about where the
// pianist is: the armed group does. Holding the clock's number meant the resume
// recomputed `gi` from it and re-armed a group nobody was standing on.
test('wait mode holds the armed group, not the free-running beat', () => {
  const { eng } = setup({ hands: { lh: OFF, rh: YOU }, wait: true });
  eng.play();
  advance(300);
  eng.noteOn(60);                               // the first onset: the cursor moves on
  advance(300);
  const g = eng.position().group;
  assert.ok(g, 'a group is armed');
  advance(4000);                                // time passes; the clock is not the position
  eng.pause();
  assert.equal(eng.paused, true);
  assert.ok(Math.abs(eng.startAt - g.b) < 1e-6, `held ${eng.startAt}, the group is on ${g.b}`);
  eng.resume(eng.startAt);
  assert.equal(eng.position().group?.b, g.b, 'and the same group comes back up');
  eng.stop();
});

// Pause keeps your place; Stop is how the pianist says they no longer want it. The
// pages spell that as stop() then seek(0) -- there is nowhere else in the loop that
// "from the top" could mean.
test('Stop after a pause goes back to the first bar', () => {
  const { eng } = setup();
  eng.play();
  advance(BAR + 2 * SPB);
  eng.pause();
  assert.ok(eng.startAt > 1.5, `held at ${eng.startAt}`);
  eng.stop();
  eng.seek(0);
  assert.equal(eng.startAt, 0);
  assert.equal(eng.position().beat, 0);
  assert.equal(eng.paused, false);
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

test('wait mode: seeking past the last onset reports a skipped-all pass, not a played one', () => {
  const { eng, ev } = setup({ hands: { lh: OFF, rh: YOU }, wait: true });
  eng.play();
  const due = eng.tally.expected.length;
  assert.ok(due > 0);
  eng.seek(eng.loopLen);
  advance(700);
  assert.equal(ev.pass.length, 1);
  assert.equal(ev.pass[0].total, 0);
  assert.equal(ev.pass[0].hits, 0);
  assert.equal(ev.pass[0].skipped, due);
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

test('a 6/8 song loops in two-beat bars', () => {
  const s = parseSong({
    id: 'six', title: 'Six', bpm: 120, meter: '6/8',
    rh: ['C4 D4 E4 C4 D4 E4', 'C4:6'],
    lh: ['C3:6', 'C3:6'],
  });
  const clock = makeClock(120);
  const eng = makeLearnEngine({ clock });
  live.push(eng);
  eng.load(s);
  assert.equal(eng.loopLen, 4);
  assert.equal(eng.loopStart, 0);
  eng.setRange(0, 0);
  assert.equal(eng.loopLen, 2);
  eng.stop();
});

test('wait mode plays the app hand up to each onset it waits on', () => {
  const { eng } = setup({ hands: { lh: APP, rh: YOU }, wait: true });
  eng.play();
  assert.deepEqual(noteOns().map(x => x.n), [48]);          // C3 sits under the first onset
  for (let gi = 0; gi < 4; gi++) { for (const e of eng.groups[gi].notes) eng.noteOn(e.n, fakeNow); advance(200); }
  assert.deepEqual(noteOns().map(x => x.n), [48, 55]);      // G3 arrived with beat 3's onset
  eng.stop();
});
