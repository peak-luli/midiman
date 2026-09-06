// One writer per room.
//
// Ishay's bug (#43), in his words: "Start the step, then press Stop... wait about
// 5-10 seconds without touching anything. The waiting screen suddenly changes and
// resets" -- to Free practice on bar 1, and back to the step a second or two later.
// The same one-second jump to another screen turned up mid-practice.
//
// It was two writers in one room. The room belongs to the machine now (`certs/room`,
// answered from `/relay/info`), and "Put it on the phone" is remembered -- so every
// Learn page the laptop has open, on any origin, arms itself into the *one* room and
// publishes snapshots into it. Nothing said which of them was the lesson, so the
// phone applied whichever landed last. Idle after Stop, the only thing that publishes
// is the half-minute resync, which every page in the room answers at once: hence a
// flash to a forgotten tab's lesson and back, out of nowhere, twice a minute.
//
// So a page claims the room and signs what it publishes, the newest claim owns it,
// and both ends work that out from the claim alone. This is that rule, and then the
// mirror driven through a fake relay to prove it drops what it should.

import test from 'node:test';
import assert from 'node:assert/strict';

import { claimOf, seqOf, newerClaim, follow, fromOwner, beatenBy } from '../src/learn/owner.js';
import { makeMirror } from '../src/learn/remote.js';
import { parseSong } from '../src/song.js';

// ------------------------------------------------------------------ the claim
test('a claim is who published it and when that page took the room', () => {
  assert.deepEqual(claimOf({ by: 'abc', since: 1700 }), { client: 'abc', since: 1700 });
  // a page that signed itself but named no moment still has an identity to be told
  // apart by -- it is only the ordering that falls back on the tie-break
  assert.deepEqual(claimOf({ by: 'abc' }), { client: 'abc', since: 0 });
  assert.deepEqual(claimOf({ by: 'abc', since: 'soon' }), { client: 'abc', since: 0 });
});

test('an unsigned message has no claim at all -- a laptop on an older build', () => {
  assert.equal(claimOf({ type: 'state' }), null);
  assert.equal(claimOf({ by: '' }), null);
  assert.equal(claimOf(null), null);
  assert.equal(claimOf(undefined), null);
});

// `from` inside a snapshot is the first bar of the range, and has been since before
// anything signed itself. A claim that read it would take the bar number for a page.
test('the claim is not confused with a snapshot\'s first bar', () => {
  assert.equal(claimOf({ type: 'state', from: 4, to: 11 }), null);
  assert.deepEqual(claimOf({ type: 'state', from: 4, to: 11, by: 'abc', since: 9 }),
                   { client: 'abc', since: 9 });
});

test('the snapshot counter reads as a number or as nothing', () => {
  assert.equal(seqOf({ seq: 7 }), 7);
  assert.equal(seqOf({ seq: '7' }), 7);
  assert.equal(seqOf({}), null);
  assert.equal(seqOf({ seq: 'x' }), null);
});

// ------------------------------------------------------------------ who wins
test('the newest claim owns the room', () => {
  const old = { client: 'aaa', since: 1000 };
  const fresh = { client: 'bbb', since: 2000 };
  assert.equal(newerClaim(fresh, old), true);
  assert.equal(newerClaim(old, fresh), false);
});

test('any claim beats no claim, and no claim beats nothing', () => {
  assert.equal(newerClaim({ client: 'a', since: 0 }, null), true);
  assert.equal(newerClaim(null, { client: 'a', since: 0 }), false);
  assert.equal(newerClaim(null, null), false);
});

// Two pages that armed in the same millisecond have to be separated somehow, and the
// point is not which of them is better -- it is that the laptop and the phone reach
// the *same* answer without asking each other.
test('a tie is broken the same way at both ends', () => {
  const a = { client: 'aaa', since: 5 }, b = { client: 'bbb', since: 5 };
  assert.equal(newerClaim(b, a), true);
  assert.equal(newerClaim(a, b), false);
  assert.equal(newerClaim(a, a), false, 'and a page never beats itself');
});

// ------------------------------------------------------------------ the phone
const state = (by, since, seq) => ({ type: 'state', by, since, seq });

test('the first snapshot to arrive is the one the phone follows', () => {
  const held = follow(null, state('one', 100, 1));
  assert.deepEqual(held, { claim: { client: 'one', since: 100 }, seq: 1 });
});

test('a snapshot from a page with an older claim is dropped', () => {
  const held = follow(null, state('new', 200, 1));
  assert.equal(follow(held, state('old', 100, 9)), null, 'a forgotten tab, still publishing');
  assert.equal(follow(held, state('old', 100, 10)), null, 'and still, however much it says');
});

test('a page that claimed the room later takes the phone with it', () => {
  const held = follow(null, state('old', 100, 4));
  const next = follow(held, state('new', 200, 1));
  assert.deepEqual(next, { claim: { client: 'new', since: 200 }, seq: 1 });
});

// The counter is what tells a fresh snapshot from one that arrived out of order --
// the copy the server keeps and replays on every reconnect, or the older of two that
// raced inside the phone while a song was loading.
test('a snapshot the phone has already moved past is dropped', () => {
  const held = follow(null, state('one', 100, 5));
  assert.equal(follow(held, state('one', 100, 5)), null, 'the same one again');
  assert.equal(follow(held, state('one', 100, 4)), null, 'one from before it');
  assert.deepEqual(follow(held, state('one', 100, 6)), { claim: { client: 'one', since: 100 }, seq: 6 });
});

test('a writer that reloads is a new claim, so its counter starting over is fine', () => {
  const held = follow(null, state('one', 100, 90));
  const next = follow(held, state('two', 300, 1));
  assert.deepEqual(next, { claim: { client: 'two', since: 300 }, seq: 1 });
});

test('an unsigned laptop is followed only while nobody has claimed the room', () => {
  const held = follow(null, { type: 'state', si: 3 });
  assert.deepEqual(held, { claim: null, seq: null });
  // and is beaten by the first page that says who it is
  const next = follow(held, state('one', 100, 1));
  assert.deepEqual(next, { claim: { client: 'one', since: 100 }, seq: 1 });
  assert.equal(follow(next, { type: 'state', si: 9 }), null);
});

// A mark moves the phone on its own: a `pass` rebuilds the tally, an `end` stops the
// playhead. One from a page the phone is not following is playing that happened
// somewhere else.
test('a mark is taken only from the page the phone is following', () => {
  const held = follow(null, state('one', 100, 1));
  assert.equal(fromOwner(held, { type: 'end', by: 'one' }), true);
  assert.equal(fromOwner(held, { type: 'end', by: 'two' }), false);
  assert.equal(fromOwner(held, { type: 'end' }), true, 'unsigned: an older laptop, nothing better to go on');
  assert.equal(fromOwner(null, { type: 'end', by: 'two' }), true, 'nobody followed yet');
});

// ------------------------------------------------------------- the mirror itself
// The rule above, through the real thing: `net` is the only door to the network in
// relay.js, so a fake EventSource is enough to hand a mirror a room's worth of
// messages and read back which lesson it ended up on.

const SONG = parseSong({
  id: 'song', title: 'Song', bpm: 60, swing: 0.5,
  sections: [{ name: 'A', from: 1, to: 2 }, { name: 'B', from: 3, to: 4 }],
  rh: ['C5:4 D5:4', 'E5:4 F5:4', 'G5:4 A5:4', 'B5:4 C6:4'],
  lh: ['C3:8', 'D3:8', 'E3:8', 'F3:8'],
});

/** A relay that is already live, and a handle to push a room's messages into it. */
function room() {
  let es = null;
  const sent = [];
  const net = {
    fetch: async (url, opts) => {
      if (opts?.method === 'POST') sent.push(JSON.parse(opts.body));
      return { ok: true, status: 200, json: async () => ({ t: 0 }) };
    },
    EventSource: class {
      constructor(url) { this.url = url; this.readyState = 1; es = this; }
      close() { this.readyState = 2; }
    },
  };
  return {
    net, sent,
    live() { es.onopen?.(); },
    push(ev) { es.onmessage?.({ data: JSON.stringify(ev) }); },
  };
}

const settle = () => new Promise(r => setTimeout(r, 0));

/** A laptop's snapshot, as host.js signs and sends it: `from`/`to` are the bar range. */
const lesson = ({ by, since, seq }, over) => ({
  type: 'state', v: 1, by, since, seq,
  songId: 'song', mode: 'tutor', si: 4, stepId: 'x', view: 'staff',
  t0: 0, bpm: 60, running: false, wait: false, loop: true, metro: true, guide: false,
  hearing: false, out: 'midi', midiOut: false,
  from: 0, to: 7, loopStart: 0, loopLen: 32, startAt: 0,
  hands: { lh: 'you', rh: 'off' }, freeCh: 'passes', results: [], done: [], best: {}, card: null,
  ...over,
});

const theme = { mode: 'tutor', si: 4, from: 4, to: 11, loopStart: 16, loopLen: 32 };
const strayTab = { mode: 'free', si: 0, from: 0, to: 0, loopStart: 0, loopLen: 4 };

/** A mirror in a live room, closed again when the test ends -- its resync is on a timer. */
async function mirrorIn(t, r, songOf = () => SONG) {
  const m = makeMirror({ room: 'rm', songOf, net: r.net });
  t.after(() => m.close());
  m.open();
  r.live();
  await settle();
  return m;
}

test('the mirror stays on the lesson when a second Learn page publishes an older one', async t => {
  const r = room();
  const m = await mirrorIn(t, r);

  r.push(lesson({ by: 'live', since: 2000, seq: 1 }, theme));
  await settle();
  assert.equal(m.owner.client, 'live');
  assert.deepEqual([m.from, m.to], [4, 11]);

  // the forgotten tab, answering the same half-minute resync the live one answered
  r.push(lesson({ by: 'stray', since: 1000, seq: 1 }, strayTab));
  await settle();
  assert.deepEqual([m.from, m.to], [4, 11], 'still the Theme, not Free practice on bar 1');
  assert.equal(m.state.mode, 'tutor');
  assert.equal(m.owner.client, 'live');
});

test('and follows the page that claimed the room last, whichever order they arrive in', async t => {
  const r = room();
  const m = await mirrorIn(t, r);

  // the stray tab happens to publish first -- there is nothing else to follow yet
  r.push(lesson({ by: 'stray', since: 1000, seq: 1 }, strayTab));
  await settle();
  assert.deepEqual([m.from, m.to], [0, 0]);

  // and one round trip later the page the pianist is on says so, and keeps it
  r.push(lesson({ by: 'live', since: 2000, seq: 1 }, theme));
  await settle();
  assert.deepEqual([m.from, m.to], [4, 11]);
  r.push(lesson({ by: 'stray', since: 1000, seq: 2 }, strayTab));
  await settle();
  assert.deepEqual([m.from, m.to], [4, 11]);
});

test('a writer that leaves the room lets the next snapshot through', async t => {
  const r = room();
  const m = await mirrorIn(t, r);
  r.push(lesson({ by: 'live', since: 2000, seq: 1 }, theme));
  await settle();

  r.push({ type: 'leave', client: 'live', subs: 1 });
  r.push(lesson({ by: 'stray', since: 1000, seq: 3 }, strayTab));
  await settle();
  assert.deepEqual([m.from, m.to], [0, 0], 'the only page left is the lesson now');
  assert.equal(m.owner.client, 'stray');
});

// `end` sets running to false and stops the playhead: from a page the phone is not
// following, that is the mid-practice stall in the same report.
test('a mark from a page that is not the writer is ignored', async t => {
  const r = room();
  const m = await mirrorIn(t, r);
  r.push(lesson({ by: 'live', since: 2000, seq: 1 }, { ...theme, running: true }));
  await settle();
  assert.equal(m.running, true);

  r.push({ type: 'end', by: 'stray', since: 1000 });
  await settle();
  assert.equal(m.running, true, 'the stray tab stopping is not this lesson stopping');

  r.push({ type: 'end', by: 'live', since: 2000 });
  await settle();
  assert.equal(m.running, false);
});

// One `state` waits (the song has to be loaded) and the next does not, so without a
// guard the older one finishes last and the phone lands on the lesson before it.
test('a snapshot that waited for a song does not finish over a newer one', async t => {
  const r = room();
  let release;
  const slow = new Promise(res => { release = () => res(SONG); });
  let asked = 0;
  const m = await mirrorIn(t, r, () => (++asked === 1 ? slow : SONG));

  r.push(lesson({ by: 'live', since: 2000, seq: 1 }, { ...theme, songId: 'song' }));
  await settle();
  r.push(lesson({ by: 'live', since: 2000, seq: 2 }, { ...theme, from: 0, to: 3 }));
  await settle();
  assert.deepEqual([m.from, m.to], [0, 3]);

  release();
  await settle();
  await settle();
  assert.deepEqual([m.from, m.to], [0, 3], 'the newer snapshot stands');
});

// ------------------------------------------------------------------ the laptop
test('a page gives the room up for a newer claim, and only for a newer one', () => {
  const mine = { client: 'mine', since: 1000 };
  assert.deepEqual(beatenBy(mine, state('other', 2000, 1)), { client: 'other', since: 2000 });
  assert.equal(beatenBy(mine, state('other', 500, 1)), null);
  assert.equal(beatenBy(mine, state('mine', 1000, 1)), null, 'never for itself');
  assert.equal(beatenBy(mine, { type: 'state' }), null, 'nor for an unsigned one');
});
