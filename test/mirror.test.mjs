// Laptop and phone, and the one thing that has to be true between them: the laptop
// says what the lesson is doing and the phone draws it. Nothing else.
//
// The owner's report, from the piano, is the whole reason this file exists:
//
//   1. Start tapped on the iPhone, and the two ends were out of sync.
//   2. Start tapped again, and they were in sync.
//   3. While playing, the phone flickered.
//   4. After the tutor advanced to the next step, the phone sat on ▶ Start while the
//      laptop played on.
//
// Four symptoms, one shape. The phone held an opinion of its own -- every setter
// applied its change locally before the command went out -- and the laptop published
// only what had *changed*, so a message lost anywhere left the phone the only thing
// that believed its picture, with nothing able to say otherwise. On top of that the
// clock anchor was trusted unconditionally, including when neither end had yet
// measured the relay's clock (the first snapshot of every session) and including when
// the server had replayed a snapshot a room had been keeping since some earlier page.
//
// So: one writer, stamped snapshots, a heartbeat, and a follower that notices silence.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeMirror, acceptState, STALE_MS } from '../src/learn/remote.js';
import { shouldPublish, HEARTBEAT_MS } from '../src/learn/host.js';
import { anchorState, stateAge, MAX_ANCHOR_AGE_MS, toServer } from '../src/learn/sync.js';
import { parseSong } from '../src/song.js';
import { makeClock } from '../src/clock.js';

const city = () => parseSong(JSON.parse(
  readFileSync(new URL('../songs/city-of-stars.json', import.meta.url), 'utf8')));

const after = ms => new Promise(r => setTimeout(r, ms));
const settle = () => after(5);

// ---------------------------------------------------------------- the age of a snapshot
test('a snapshot says when it was published, on the one clock both ends can read', () => {
  // the phone's page-load moment is 40 s behind the relay's, so offset = 40_000
  assert.equal(stateAge(100_000, 40_000, 61_000), 1_000);
  // a stamp a hair in the future is an honest estimate being slightly out
  assert.equal(stateAge(100_000, 40_000, 59_950), -50);
});

// ---------------------------------------------------------------- the anchor
// `t0` is written as `local + offset` and read as `now + offset - t0`. Both offsets
// start at zero and only become real once eight round trips have landed -- so before
// that the arithmetic is comparing one page's lifetime against another's, and the
// playhead lands thousands of beats from the music.
test('an anchor is only usable when both ends have measured the relay clock', () => {
  const now = 10_000, offset = 90_000;
  const fresh = { t0: 99_000, bpm: 90, at: toServer(now, offset), synced: true };

  assert.equal(anchorState(fresh, { synced: true, offset, now }).ok, true);
  // the laptop published before its own first measurement landed -- which is exactly
  // what it does the moment its stream goes live
  assert.equal(anchorState({ ...fresh, synced: false }, { synced: true, offset, now }).ok, false);
  // and the same arithmetic from this end
  assert.equal(anchorState(fresh, { synced: false, offset, now }).ok, false);
  assert.match(anchorState(fresh, { synced: false, offset, now }).why, /this device/);
});

test('an anchor older than the heartbeat names a beat nobody is on', () => {
  const now = 10_000, offset = 90_000;
  const at = toServer(now, offset);
  const anchor = t => ({ t0: 99_000, bpm: 90, at: t, synced: true });

  const old = anchorState(anchor(at - 60_000), { synced: true, offset, now });
  assert.equal(old.ok, false);
  assert.equal(old.why, 'stale');
  assert.equal(old.age, 60_000);
  // a room's kept snapshot is minutes old; one that merely queued behind something
  // still counts
  assert.equal(anchorState(anchor(at - (MAX_ANCHOR_AGE_MS - 1)), { synced: true, offset, now }).ok, true);
  assert.ok(MAX_ANCHOR_AGE_MS > HEARTBEAT_MS, 'a heartbeat must never look stale');
});

test('a snapshot from an older laptop is anchored rather than refused', () => {
  // no `at`, no `synced`: there is nothing better to go on and the old behaviour was
  // to trust everything, so compatibility wins over the new check
  const a = anchorState({ t0: 1000, bpm: 100 }, { synced: true, offset: 0, now: 2000 });
  assert.equal(a.ok, true);
  assert.equal(a.why, 'unstamped');
});

test('a snapshot with no anchor in it is not one', () => {
  assert.equal(anchorState(null, { synced: true }).ok, false);
  assert.equal(anchorState({ bpm: 90 }, { synced: true }).ok, false);
  assert.equal(anchorState({ t0: 5 }, { synced: true }).ok, false);
});

// ---------------------------------------------------------------- which snapshot wins
// serve.py keeps a room's last snapshot and hands it to every new subscriber, and a
// room outlives the page that filled it. So "the newest message" and "the last
// message to arrive" are different things.
test('a snapshot has to be newer than the one on screen to replace it', () => {
  const a = { epoch: 'p1', seq: 4, at: 1000 };
  assert.equal(acceptState(null, a), true, 'the first one always applies');
  assert.equal(acceptState(a, { epoch: 'p1', seq: 5, at: 1200 }), true);
  // the replay: a phone reconnects and is handed what the room was keeping
  assert.equal(acceptState(a, { epoch: 'p1', seq: 2, at: 400 }), false);
  // a laptop that reloaded is a new page, and its stamp is what orders it
  assert.equal(acceptState(a, { epoch: 'p2', seq: 1, at: 1100 }), true);
  assert.equal(acceptState(a, { epoch: 'p2', seq: 900, at: 900 }), false,
    'a high seq from an older page is still older');
  // two in the same millisecond, same page: seq breaks the tie
  assert.equal(acceptState(a, { epoch: 'p1', seq: 5, at: 1000 }), true);
  assert.equal(acceptState(a, { epoch: 'p1', seq: 3, at: 1000 }), false);
  assert.equal(acceptState(a, { epoch: 'p2', seq: 9, at: 1000 }), false,
    'the same millisecond from another page cannot be ordered, so it does not win');
  assert.equal(acceptState(a, null), false);
});

test('an unstamped snapshot is applied, as it always was', () => {
  assert.equal(acceptState({ at: 5000 }, { si: 2 }), true);
  assert.equal(acceptState({ si: 1 }, { at: 5000 }), true);
});

// ---------------------------------------------------------------- the heartbeat
// The rule that bounds how long the phone can be wrong. "Publish only what changed"
// is the reasonable-sounding version, and it is the one that left the phone on
// ▶ Start through a step advance: the snapshot it never received was never sent again.
test('an unchanged snapshot goes out again once the heartbeat is due', () => {
  const same = { json: 'x', last: 'x', sentAt: 0, force: false };
  assert.equal(shouldPublish({ ...same, now: HEARTBEAT_MS - 1 }), false, 'not five times a second');
  assert.equal(shouldPublish({ ...same, now: HEARTBEAT_MS }), true);
  assert.equal(shouldPublish({ ...same, json: 'y', now: 1 }), true, 'a change does not wait');
  assert.equal(shouldPublish({ ...same, force: true, now: 1 }), true);
});

// ---------------------------------------------------------------- the mirror, live
/**
 * A relay whose clock is `SERVER_AHEAD` ms in front of this process's, so a snapshot
 * can be stamped honestly fresh or honestly old. Every POST is kept, because what the
 * phone sends is half of what is under test.
 */
const SERVER_AHEAD = 500_000;
const serverNow = () => SERVER_AHEAD + performance.now();

function fakeNet() {
  const sent = [];
  const made = [];
  class FakeES {
    constructor(url) {
      this.url = url; this.readyState = 0; made.push(this);
      setTimeout(() => { this.readyState = 1; this.onopen?.(); }, 0);
    }
    close() { this.readyState = 2; }
    push(ev) { this.onmessage?.({ data: JSON.stringify(ev) }); }
  }
  return {
    sent, made,
    get es() { return made[made.length - 1]; },
    /** The commands the phone has sent, by name. */
    cmds: () => sent.filter(e => e.type === 'cmd').map(e => e.name),
    fetch: async (url, opts) => {
      if (String(url).includes('/relay/time')) return { ok: true, json: async () => ({ t: serverNow() }) };
      if (opts?.body) sent.push(JSON.parse(opts.body));
      return { ok: true, json: async () => ({ ok: true }) };
    },
    EventSource: FakeES,
  };
}

/** Everything host.js publishes, with the parts a test cares about overridable. */
const snapshot = (over = {}) => ({
  type: 'state', v: 1, songId: 'city-of-stars', mode: 'tutor', si: 0, stepId: 0, view: 'fall',
  t0: serverNow(), bpm: 90, running: false, wait: false, loop: true, metro: true, guide: false,
  hearing: false, out: 'midi', midiOut: true, from: 0, to: 3, loopStart: 0, loopLen: 16,
  startAt: 0, hands: { lh: 'you', rh: 'app' }, freeCh: 'passes', results: [], done: [], best: {},
  card: null, epoch: 'p1', seq: 1, at: serverNow(), synced: true, ...over,
});

async function harness({ staleMs = 120 } = {}) {
  const song = city();
  const net = fakeNet();
  const clock = makeClock(60);
  const states = [];
  const mirror = makeMirror({
    clock, room: 'r1', net, staleMs,
    songOf: () => song, onState: s => states.push(s),
  });
  mirror.open();
  await settle();                       // the stream accepts, then eight clock rounds
  for (let i = 0; i < 60 && !mirror.relay.synced; i++) await after(10);
  assert.ok(mirror.relay.synced, 'the fake relay clock was measured');
  return { mirror, net, clock, states, song };
}

test('a phone that has just connected does not run a playhead off an unreadable anchor', async () => {
  const song = city();
  const net = fakeNet();
  const clock = makeClock(60);
  const mirror = makeMirror({ clock, room: 'r1', net, songOf: () => song, staleMs: 120 });
  mirror.open();
  await settle();                       // live, but the clock rounds have not landed

  // this is the snapshot host.js sends the instant its stream goes live
  net.es.push(snapshot({ running: true, t0: serverNow() }));
  await settle();
  assert.equal(mirror.running, true, 'the state still applies: the button has to be right');
  assert.equal(mirror.anchored, false);
  assert.match(mirror.anchorWhy, /measured the relay clock/);
  // and it does not sit there: the asking is what "tap Start again" used to be for
  assert.ok(net.cmds().includes('resync'));
  mirror.close();
});

test('once its own clock is known, the phone asks the laptop to say it again', async () => {
  const { mirror, net } = await harness();
  const asks = net.cmds().filter(n => n === 'resync').length;
  assert.ok(asks >= 1, 'nothing was anchored yet, so it asked');
  net.es.push(snapshot({ running: true }));
  await settle();
  assert.equal(mirror.anchored, true);
  assert.equal(mirror.anchorWhy, 'fresh');
  mirror.close();
});

test('a snapshot the room has been keeping moves the step but not the playhead', async () => {
  // The room outlives the page: serve.py replays its last snapshot to whoever connects
  // next. Anchoring on one published a minute ago puts the playhead wherever
  // (now - then) happens to divide -- which is what "out of sync" looked like.
  const { mirror, net, clock } = await harness();
  const old = serverNow() - 60_000;
  net.es.push(snapshot({ si: 2, running: true, t0: old, at: old }));
  await settle();

  assert.equal(mirror.state.si, 2, 'the step is still news');
  assert.equal(mirror.running, true);
  assert.equal(mirror.anchored, false);
  assert.equal(mirror.anchorWhy, 'stale');
  assert.equal(clock.running, false, 'and no clock is run from it');
  assert.ok(Math.abs(mirror.position().beat) < 1, `parked at the loop, not at ${mirror.position().beat}`);
  // and the mode line must not claim otherwise: an open socket carrying a snapshot
  // nobody is publishing behind is not "showing the laptop"
  assert.equal(mirror.following, false);
  assert.equal(mirror.relay.status, 'live');
  mirror.close();
});

test('following the laptop is three things, and the socket is only the first', async () => {
  const { mirror, net } = await harness({ staleMs: 120 });
  net.es.push(snapshot({ running: true }));
  await settle();
  assert.equal(mirror.following, true, 'live, recent, anchored');

  await after(400);
  assert.equal(mirror.relay.status, 'live');
  assert.equal(mirror.following, false, 'a live stream that has gone quiet is not following');
  mirror.close();
});

test('a snapshot older than the one on screen is ignored', async () => {
  const { mirror, net, states } = await harness();
  const at = serverNow();
  net.es.push(snapshot({ si: 3, seq: 9, at }));
  await settle();
  assert.equal(mirror.state.si, 3);

  net.es.push(snapshot({ si: 1, seq: 4, at: at - 5_000 }));      // the replay, arriving late
  await settle();
  assert.equal(mirror.state.si, 3, 'the phone does not step backwards into a kept snapshot');
  assert.equal(states.filter(s => s.si === 1).length, 0, 'and the page is never told about it');
  mirror.close();
});

// ---------------------------------------------------------------- one writer
test('every control is a command and nothing else: the phone moves when the laptop says so', async () => {
  const { mirror, net } = await harness();
  net.es.push(snapshot({ wait: false, loop: true, metro: true, bpm: 90 }));
  await settle();

  mirror.setWait(true);
  mirror.setLoop(false);
  mirror.setMetro(false);
  mirror.setGuide(true);
  mirror.setBpm(140);
  mirror.setHands({ lh: 'app' });
  await after(120);                    // the steppers gather a burst up first

  // asked for, all of it
  assert.deepEqual(net.cmds().filter(n => ['wait', 'loop', 'metro', 'guide', 'bpm', 'hands'].includes(n)).sort(),
    ['bpm', 'guide', 'hands', 'loop', 'metro', 'wait']);
  // and not one of them applied here, because a command that never arrives would
  // otherwise leave this page the only thing that believes it
  assert.equal(mirror.wait, false);
  assert.equal(mirror.loop, true);
  assert.equal(mirror.metroOn, true);
  assert.equal(mirror.guide, false);
  assert.equal(mirror.hands.lh, 'you');
  assert.equal(mirror.position().wait, false);

  net.es.push(snapshot({ wait: true, loop: false, metro: false, guide: true, bpm: 140,
                         hands: { lh: 'app', rh: 'app' } }));
  await settle();
  assert.equal(mirror.wait, true);
  assert.equal(mirror.loop, false);
  assert.equal(mirror.hands.lh, 'app');
  mirror.close();
});

test('the transport is asked for absolutely, so a repeat cannot flip it back', async () => {
  const { mirror, net } = await harness();
  net.es.push(snapshot({ running: false }));
  await settle();

  mirror.play(); mirror.play();
  await settle();
  const runs = net.sent.filter(e => e.type === 'cmd' && e.name === 'transport');
  assert.deepEqual(runs.map(e => e.running), [true, true], 'twice asked to run, never asked to stop');
  assert.equal(mirror.running, false, 'and still not running until the laptop says it is');

  net.es.push(snapshot({ running: true }));
  await settle();
  mirror.toggle();
  await settle();
  assert.equal(net.sent.filter(e => e.name === 'transport').pop().running, false);
  mirror.close();
});

test('a finger-pan asks to pause and resume, not to halt', async () => {
  const { mirror, net } = await harness();
  mirror.pause();
  mirror.resume(2);
  await settle();
  assert.ok(net.sent.some(e => e.name === 'pause'), 'pause is not transport:false (that is halt)');
  const r = net.sent.find(e => e.name === 'resume');
  assert.equal(r.beat, 2);
  assert.ok(!net.sent.some(e => e.name === 'transport' && e.running === false));
  mirror.close();
});

// The cost of taking the local writes out, and the narrow thing that pays it back.
// A stepper's value is the laptop's, and it only arrives on the next snapshot -- so a
// second tap inside one round trip read the same number, computed the same absolute
// value, and the laptop stepped once for three presses.
//
// Sending each tap separately does not fix it either: the relay gives every POST its
// own thread, so three absolute values a millisecond apart can be applied in any
// order and the laptop can end on the first. So a burst goes out once, with the value
// it ended on -- and each command name keeps its own latest, or a tempo burst would
// swallow a range change made in the same breath.
test('a burst of taps goes out once, with the value it ended on', async () => {
  const { mirror, net, clock } = await harness();
  net.es.push(snapshot({ bpm: 90, from: 0, to: 3 }));
  await settle();

  // the rule mobile.js applies: count from what was asked for, else from what the
  // laptop last said
  const fromBpm = () => mirror.asked.bpm ?? clock.bpm;
  for (let i = 0; i < 3; i++) mirror.setBpm(fromBpm() + 5);
  const fromTo = () => mirror.asked.to ?? mirror.to;
  for (let i = 0; i < 2; i++) mirror.setRange(0, fromTo() + 1);
  assert.equal(mirror.asked.bpm, 105, 'each tap counts from the last, at once');
  assert.equal(mirror.asked.to, 5);
  const steppers = () => net.sent.filter(e => e.name === 'bpm' || e.name === 'range');
  assert.deepEqual(steppers(), [], 'and nothing has gone out yet');

  await after(120);
  assert.deepEqual(net.sent.filter(e => e.name === 'bpm').map(e => e.bpm), [105]);
  assert.deepEqual(net.sent.filter(e => e.name === 'range').map(e => e.to), [5]);
  // and still not applied here: the laptop is the only writer of the value itself
  assert.equal(clock.bpm, 90);
  assert.equal(mirror.to, 3);
  mirror.close();
});

test('an ask still being gathered up cannot have been answered yet', async () => {
  const { mirror, net, clock } = await harness();
  net.es.push(snapshot({ bpm: 90, at: serverNow(), seq: 1 }));
  await settle();

  mirror.setBpm(120);
  // a snapshot published *after* the tap but before the command left. It is not an
  // answer to anything, and clearing on it would drop the tap on the floor.
  net.es.push(snapshot({ bpm: 90, at: serverNow() + 10, seq: 2 }));
  await settle();
  assert.equal(mirror.asked.bpm, 120);

  await after(120);
  assert.deepEqual(net.sent.filter(e => e.name === 'bpm').map(e => e.bpm), [120], 'and it still went');
  assert.equal(clock.bpm, 90);
  mirror.close();
});

test("the laptop's answer clears the ask; a heartbeat that crossed it does not", async () => {
  const { mirror, net, clock } = await harness();
  const t = serverNow();
  net.es.push(snapshot({ bpm: 90, at: t - 100, seq: 1 }));
  await settle();

  mirror.setBpm(120);
  await after(120);                        // let the ask actually go out and be stamped
  assert.equal(mirror.asked.bpm, 120);

  // a heartbeat the laptop had already sent when the tap happened: newer than what is
  // on screen, older than the ask. Clearing on this is what would put the stepper back
  // to counting from a stale number.
  net.es.push(snapshot({ bpm: 90, at: t - 50, seq: 2 }));
  await settle();
  assert.equal(mirror.asked.bpm, 120, 'still counting from the tap');
  // and the readout follows the same rule, which is the one mobile.js paints from:
  // this crossing heartbeat must not put 90 back on the number
  assert.equal(mirror.asked.bpm ?? clock.bpm, 120);

  // the answer clears it even when it is not the value that was asked for -- a clamp,
  // a step default, or a command that never arrived. A number nobody applied is worse
  // than one that snaps back, and the heartbeat means it snaps back within a second.
  net.es.push(snapshot({ bpm: 90, at: serverNow() + 50, seq: 3 }));
  await settle();
  assert.equal(mirror.asked.bpm, undefined);
  assert.equal(clock.bpm, 90);
  assert.equal(mirror.asked.bpm ?? clock.bpm, 90, 'and the readout goes back to the laptop');
  mirror.close();
});

test('the ask is a note of a request, not a second copy of the lesson', async () => {
  const { mirror, net } = await harness();
  net.es.push(snapshot({ from: 0, to: 3, wait: false, running: false }));
  await settle();
  mirror.setRange(2, 5);
  await after(120);
  // nothing that draws the lesson reads it
  assert.equal(mirror.from, 0);
  assert.equal(mirror.to, 3);
  assert.equal(mirror.position().loopLen, 16);
  assert.equal(mirror.asked.from, 2);
  mirror.close();
});

test('the phone learns a fresh run from the snapshot, not from the tap', async () => {
  // A start is not a wrap, so the laptop sends no `pass` -- and the loop's shape has
  // not changed either. Without noticing the transport turn over, the phone keeps the
  // last run's colours on the noteheads and counts hits nobody has played.
  const { mirror, net } = await harness();
  let restarts = 0;
  mirror.on('restart', () => restarts++);
  net.es.push(snapshot({ running: false }));
  await settle();
  assert.equal(restarts, 0);

  net.es.push(snapshot({ running: true, seq: 2 }));
  await settle();
  assert.equal(restarts, 1);
  net.es.push(snapshot({ running: true, seq: 3 }));      // the heartbeat, not a new run
  await settle();
  assert.equal(restarts, 1);
  mirror.close();
});

// ---------------------------------------------------------------- noticing silence
test('a live stream that goes quiet is noticed, said, and asked about', async () => {
  // The failure this is for: nothing is wrong with the socket. The relay dropped a
  // message into a full queue without a word, or an iPhone that had been backgrounded
  // stopped reading its own -- and the laptop, publishing on a diff, never said it
  // again. The phone sat on ▶ Start while the laptop played the next step.
  const { mirror, net } = await harness({ staleMs: 120 });
  net.es.push(snapshot({ running: true }));
  await settle();
  assert.equal(mirror.stale, false);

  const before = net.cmds().filter(n => n === 'resync').length;
  await after(400);                       // the laptop's heartbeat never comes
  assert.equal(mirror.stale, true, 'and the mode line says "catching up"');
  assert.ok(net.cmds().filter(n => n === 'resync').length > before);

  net.es.push(snapshot({ running: true, seq: 2 }));
  await settle();
  assert.equal(mirror.stale, false, 'one snapshot and it is following again');
  mirror.close();
});

test('the staleness window is long enough that one dropped heartbeat is not an alarm', () => {
  assert.ok(STALE_MS > 2 * HEARTBEAT_MS,
    'a single lost snapshot must not make the phone shout; a run of them must');
});
