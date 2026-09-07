// The pieces the desktop learn page and the phone page share: the saved document
// and the pass/streak rule. Both pages have to agree on them exactly -- a step
// finished on the laptop has to read as finished on the phone -- so they are tested
// here rather than only through whichever page happens to be open.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { storeKey, loadProgress, saveProgress, readSetting, writeSetting } from '../src/learn/store.js';
import { makeStreak, ignoreOtherHand, goalText, stepCleared, FAIL_HOLD_MS } from '../src/learn/pass.js';
import { parseSong } from '../src/song.js';
import { expectedOf } from '../src/learn/scorer.js';
import { buildPlan, nodeState, progress, YOU, APP } from '../src/learn/plan.js';

// a localStorage that behaves like the browser's, including throwing when it is full
function fakeStorage({ full = false } = {}) {
  const m = new Map();
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { if (full) throw new Error('QuotaExceeded'); m.set(k, String(v)); },
    removeItem: k => m.delete(k),
  };
}
const withStorage = (s, fn) => { globalThis.localStorage = s; try { return fn(); } finally { delete globalThis.localStorage; } };

// ---------------------------------------------------------------- the document
test('the saved document round-trips, and both pages address it the same way', () => {
  assert.equal(storeKey('city-of-stars'), 'middleman.learn.city-of-stars');
  const store = fakeStorage();
  withStorage(store, () => {
    saveProgress('s', { step: 3, done: new Set([0, 1]), best: { 0: 0.9 }, tempos: { slow: 72 } });
    const d = loadProgress('s', 10);
    assert.equal(d.step, 3);
    assert.deepEqual([...d.done], [0, 1]);
    assert.deepEqual(d.best, { 0: 0.9 });
    assert.deepEqual(d.tempos, { slow: 72 });
  });
  // the shape on disk is the one the desktop page has always written
  assert.deepEqual(JSON.parse(store.getItem('middleman.learn.s')),
    { v: 1, step: 3, done: [0, 1], best: { 0: 0.9 }, tempo: { slow: 72 } });
});

test('a missing, unreadable or over-long document reads as a fresh start', () => {
  withStorage(fakeStorage(), () => {
    const d = loadProgress('nope', 5);
    assert.equal(d.step, 0);
    assert.equal(d.done.size, 0);
    assert.deepEqual(d.tempos, {});
  });
  const s = fakeStorage();
  s.setItem('middleman.learn.x', 'not json');
  withStorage(s, () => assert.equal(loadProgress('x').step, 0));
  // a plan that got shorter must not leave you on a step that no longer exists
  const t = fakeStorage();
  withStorage(t, () => {
    saveProgress('y', { step: 40, done: new Set(), best: {}, tempos: {} });
    assert.equal(loadProgress('y', 6).step, 5);
  });
});

// A step index is used as `plan[si]` the moment it is read. Anything that is not a
// whole number inside the plan makes that undefined, which throws out of applyStep
// during the page's wiring -- and because the document is in localStorage, it would
// throw again on every reload. The page must come up on step 0 instead.
test('a step that is not a whole number inside the plan reads as step 0', () => {
  for (const [bad, want] of [[2.5, 2], ['x', 0], [null, 0], [undefined, 0], [-3, 0], [NaN, 0], [{}, 0], ['4', 4]]) {
    const s = fakeStorage();
    s.setItem('middleman.learn.z', JSON.stringify({ v: 1, step: bad, done: [], best: {} }));
    withStorage(s, () => {
      const i = loadProgress('z', 10).step;
      assert.ok(Number.isInteger(i) && i >= 0 && i < 10, `step ${JSON.stringify(bad)} read as ${i}`);
      assert.equal(i, want);
    });
  }
});

test('a full or absent localStorage never throws out', () => {
  withStorage(fakeStorage({ full: true }), () => {
    assert.doesNotThrow(() => saveProgress('s', { step: 1, done: new Set(), best: {}, tempos: {} }));
    assert.doesNotThrow(() => writeSetting('k', 'v'));
  });
  assert.equal(readSetting('middleman.learn.mview', 'roll'), 'roll');   // no localStorage at all
});

test('a setting is remembered under its own key', () => {
  withStorage(fakeStorage(), () => {
    assert.equal(readSetting('middleman.learn.mview', 'roll'), 'roll');
    writeSetting('middleman.learn.mview', 'fall');
    assert.equal(readSetting('middleman.learn.mview', 'roll'), 'fall');
  });
});

// ---------------------------------------------------------------- the streak
const pass = accuracy => ({ accuracy, hits: 10, total: 10, misses: 0, extras: 0 });

test('a streak needs its passes in a row', () => {
  const st = makeStreak();
  assert.deepEqual(st.push(pass(0.9), 0.85), { ok: true, no: 1, streak: 1 });
  assert.deepEqual(st.push(pass(0.5), 0.85), { ok: false, no: 2, streak: 0 });
  assert.deepEqual(st.push(pass(0.9), 0.85), { ok: true, no: 1, streak: 1 });
  assert.deepEqual(st.push(pass(0.86), 0.85), { ok: true, no: 2, streak: 2 });
});

test('the meter shows the streak -- and holds a pass that has just failed', () => {
  const st = makeStreak();
  st.push(pass(0.9), 0.85);
  assert.equal(st.results().length, 1);
  st.push(pass(0.4), 0.85);
  // straight after the failure the slot is still there, in red, with its percentage
  assert.equal(st.results().length, 1);
  assert.equal(st.results()[0].ok, false);
  // and a moment later the slots are empty and pass 1 counts again
  assert.equal(st.results(performance.now() + FAIL_HOLD_MS + 1).length, 0);
  st.reset();
  assert.equal(st.results().length, 0);
});

test('an empty pass counts as passed only when the step asked for nothing', () => {
  const listen = makeStreak();
  assert.equal(listen.push({ accuracy: 1, total: 0, hits: 0 }, 0).ok, true);
  const hunt = makeStreak();
  assert.equal(hunt.push({ accuracy: 1, total: 0, hits: 0 }, 0.85).ok, false);
});

// ---------------------------------------------------------------- other-hand notes
const twoHands = () => parseSong({
  id: 'h', title: 'H', bpm: 60, swing: 0.5,
  rh: ['C5 D5 E5 F5 G5 A5 B5 C6'],
  lh: ['C3:8'],
});

test('notes belonging to a hand you are not playing leave the pass alone', () => {
  const song = twoHands();
  const swung = b => b;
  const engine = {
    hands: { lh: APP, rh: YOU }, from: 0, to: 0, loopStart: 0, loopLen: 4,
    tally: { extras: [{ n: 48, beat: 0 }, { n: 61, beat: 1 }] },   // C3 is the app's; C#5 is wrong
  };
  const r = { extras: 2 };
  assert.equal(ignoreOtherHand(r, { song, engine, swung }), 1);
  assert.equal(r.extras, 1);
  assert.equal(r.ignored, 1);
  // and with both hands yours there is no other part, so nothing is forgiven
  const r2 = { extras: 2 };
  assert.equal(ignoreOtherHand(r2, { song, engine: { ...engine, hands: { lh: YOU, rh: YOU } }, swung }), 0);
  assert.equal(r2.extras, 2);
  assert.ok(expectedOf(song, 0, 0, ['lh'], swung).length > 0);
});

// ---------------------------------------------------------------- the path's nodes
const pathSong = () => parseSong({
  id: 'p', title: 'P', bpm: 90, practiceBpm: 60, swing: 0.5,
  sections: [{ name: 'A', from: 1, to: 2 }, { name: 'B', from: 3, to: 4 }],
  rh: ['C5:8', 'D5:8', 'E5:8', 'F5:8'],
  lh: ['C3:8', 'D3:8', 'E3:8', 'F3:8'],
});

test('a path node is ticked, current, or still ahead', () => {
  const plan = buildPlan(pathSong());
  const done = new Set([plan[0].id, plan[1].id]);
  assert.deepEqual(nodeState(plan[0], 0, 3, done), { done: true, cur: false, mark: '✓' });
  assert.deepEqual(nodeState(plan[3], 3, 3, done), { done: false, cur: true, mark: '▸' });
  assert.deepEqual(nodeState(plan[4], 4, 3, done), { done: false, cur: false, mark: '' });
  // a step you passed and came back to still reads as passed
  assert.deepEqual(nodeState(plan[1], 1, 1, done), { done: true, cur: true, mark: '✓' });
});

test('the ring on Home is the share of the path that is behind you', () => {
  const plan = buildPlan(pathSong());
  assert.deepEqual(progress(plan, new Set()), { done: 0, total: plan.length, pct: 0 });
  const all = new Set(plan.map(s => s.id));
  assert.equal(progress(plan, all).pct, 1);
  assert.equal(progress(plan, new Set([plan[0].id])).done, 1);
});

// ---------------------------------------------------------------- wording
test('the goal reads as a sentence for every challenge shape', () => {
  assert.match(goalText({ kind: 'passes', n: 2, accuracy: 0.85 }), /2 passes in a row at 85%/);
  assert.match(goalText({ kind: 'passes', n: 1, accuracy: 0.85 }), /^One pass/);
  assert.match(goalText({ kind: 'window', seconds: 10, accuracy: 0.8 }), /80% .* last 10 s/);
  assert.match(goalText({ kind: 'none' }), /as often as you like/);
});

// The phone has two lives -- the lesson runs here, or the laptop runs it and this is
// its screen -- and it says which in plain words. "remote", "mirror" and "room" are
// the words for how it is built, not for what you are looking at, and the one place
// any of them earns its keep is the button that ends it. Easy to reintroduce by
// copying a nearby line, so it is asserted rather than remembered.
// Scroll on the stand is a finger-pan, not a seek-on-touch. The page used to
// jump the strip to the first contact, which is the "strange" fight. These
// checks are the wiring, so a later edit cannot silently put that back.
test('phone Scroll owns a horizontal drag and does not seek on the first touch', () => {
  const css = readFileSync(new URL('../learn-m.css', import.meta.url), 'utf8');
  const js = readFileSync(new URL('../src/learn/mobile.js', import.meta.url), 'utf8');
  const scroll = readFileSync(new URL('../src/learn/scroll.js', import.meta.url), 'utf8');
  const host = readFileSync(new URL('../src/learn/app.js', import.meta.url), 'utf8');
  assert.match(css, /#stage \.view\.scroll\{touch-action:none\}/);
  assert.match(js, /view\.pan\(/);
  assert.match(js, /view\.endPan\(\)/);
  assert.match(js, /PAN_SLOP/);
  // pause → 1:1 pan → resume from the line. A tap still seeks the finger.
  assert.match(js, /pauseForPan/);
  assert.match(js, /engine\.pause\(\)/);
  assert.match(js, /engine\.resume\(beat\)/);
  assert.match(js, /resumeAfterPan\(view\.endPan\(\)\)/);
  assert.match(js, /touchmove/);
  assert.match(js, /view\.beatAt\?\.\(x, y\)/);
  assert.match(js, /commitPan/);
  assert.match(js, /releaseRemotePark/);
  assert.match(js, /scroll: views\.scroll/);
  assert.match(js, /if \(scrubbing\) return/);
  assert.match(host, /pause: \(\) => \{ engine\.pause\(\)/);
  assert.match(host, /resume: ev =>/);
  assert.match(scroll, /parked = \{ beat: b, from \}/);
  assert.match(scroll, /followReady/);
  assert.match(scroll, /panMinBeat\(lineBeat\(\)\)/);
  // a tap must not rewrite the offset (count-in would jump to 0 first)
  assert.match(scroll, /if \(!didPan\) \{\s*parked = null;/);
});

test('picking a song on the phone asks the laptop by id', () => {
  // Let It Be shipped as the second catalog entry. Without this command the
  // phone's tap only re-lettered the path, and the snapshot put City of Stars back.
  const phone = readFileSync(new URL('../src/learn/mobile.js', import.meta.url), 'utf8');
  const laptop = readFileSync(new URL('../src/learn/app.js', import.meta.url), 'utf8');
  assert.match(phone, /engine\.cmd\('song', \{ songId: song\.id \}\)/);
  assert.match(laptop, /song:\s*ev\s*=>/);
  assert.match(laptop, /songPickIndex\(SONGS/);
  // a song-only snapshot must re-letter the path, not only a step/mode change
  assert.match(phone, /songChanged \|\| mode !== s\.mode \|\| si !== s\.si/);
});

test('the phone page says where it is without naming the plumbing', () => {
  const html = readFileSync(new URL('../learn-m.html', import.meta.url), 'utf8');
  const shown = html
    .replace(/<!--[\s\S]*?-->/g, ' ')            // comments are for whoever edits this
    .replace(/<[^>]+>/g, ' ')                    // ids and hrefs are not read out either
    .replace('Stop mirroring', ' ');             // the one allowed use: the way out
  const bad = shown.match(/\b(remote|mirror\w*|room)\b/gi);
  assert.deepEqual(bad, null, `learn-m.html shows: ${bad?.join(', ')}`);
  // and the two states it can be in are the two lines it can say
  assert.match(html, /id="modeLine"[^>]*>on this phone</);
  assert.match(html, /id="leaveBtn"[^>]*hidden[^>]*>Stop mirroring</);
  // the way back for a laptop that landed here by mistake
  assert.match(html, /id="deskbar">This is the phone screen\.<a href="learn\.html">/);
});
