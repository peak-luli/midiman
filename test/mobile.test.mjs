// The pieces the desktop learn page and the phone page share: the saved document
// and the pass/streak rule. Both pages have to agree on them exactly -- a step
// finished on the laptop has to read as finished on the phone -- so they are tested
// here rather than only through whichever page happens to be open.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { storeKey, loadProgress, saveProgress, readSetting, writeSetting } from '../src/learn/store.js';
import { makeStreak, ignoreOtherHand, goalText, stepCleared, FAIL_HOLD_MS, challengePassNo, okPassCopy, failPassCopy, resetMarks, MARK_HOLD_MS } from '../src/learn/pass.js';
import { slotStates } from '../src/learn/meter.js';
import { CHALLENGES } from '../src/learn/scorer.js';
import { parseSong } from '../src/song.js';
import { expectedOf } from '../src/learn/scorer.js';
import { buildPlan, nodeState, progress, YOU, APP } from '../src/learn/plan.js';
import { heldLabel } from '../src/readout.js';
import { transportLabel } from '../src/learn/press.js';

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

// ------------------------------------------------------- the colours at the wrap
/** A view that only remembers what colour each expected note was last given. */
function fakeView() {
  const marks = new Map();
  return { marks, clearMarks() { marks.clear(); }, mark(e, cls) { if (cls) marks.set(e, cls); else marks.delete(e); } };
}

test('the hold after a pass hands the board over without wiping the new pass', () => {
  // The loop never stopped: by the time the finished pass's colours come off, the
  // new pass has already had its first note played. Clearing the lot was why that
  // note was never green -- on every pass but the first.
  const view = fakeView();
  const done = [{ hit: { beat: 0, off: 0 }, missed: false }, { hit: null, missed: true }];
  for (const e of done) view.mark(e, e.hit ? 'hit' : 'miss');
  assert.equal(view.marks.size, 2);

  const live = [{ hit: { beat: 0.02, off: 0.02 }, missed: false }, { hit: null, missed: false }];
  resetMarks(view, { expected: live });
  assert.equal(view.marks.get(live[0]), 'hit', "the new pass's first note keeps its green");
  assert.equal(view.marks.has(live[1]), false, 'nothing it has not scored yet is coloured');
  for (const e of done) assert.equal(view.marks.has(e), false, "the finished pass's colours are gone");

  // and a wrap nobody has played into leaves the board blank
  resetMarks(view, { expected: [{ hit: null, missed: false }] });
  assert.equal(view.marks.size, 0);
  resetMarks(view, null);
  assert.equal(view.marks.size, 0);
});

test('both pages hold the marks for the same moment and hand them over the same way', () => {
  // laptop and phone show the same board; a bare clearMarks() on the hold is the bug
  assert.equal(MARK_HOLD_MS, 250);
  for (const mod of ['src/learn/app.js', 'src/learn/mobile.js']) {
    const src = readFileSync(new URL('../' + mod, import.meta.url), 'utf8');
    assert.match(src, /setTimeout\(\(\) => resetMarks\(view, engine\.tally\), MARK_HOLD_MS\)/,
      `${mod} hands the board to the running pass`);
    assert.doesNotMatch(src, /setTimeout\(\(\) => view\.clearMarks\(\)/, `${mod} must not wipe it wholesale`);
  }
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
test('fail copy never says 100% then again from pass 1', () => {
  const empty = { total: 0, hits: 0, accuracy: 0 };
  const lie = { total: 0, hits: 0, accuracy: 1 };
  const miss = { total: 10, hits: 7, accuracy: 0.7 };
  assert.equal(failPassCopy(1, empty, 0.85), 'Pass 1: no notes scored — again from pass 1');
  assert.equal(failPassCopy(1, lie, 0.85), 'Pass 1: no notes scored — again from pass 1');
  assert.equal(failPassCopy(1, miss, 0.85), 'Pass 1: 70%, needs 85% — again from pass 1');
  assert.doesNotMatch(failPassCopy(1, empty, 0.85), /100%/);
  assert.doesNotMatch(failPassCopy(1, lie, 0.85), /100%/);
  assert.doesNotMatch(failPassCopy(1, miss, 0.85), /100%/);
});

test('ok copy after a clean pass 1 names pass 1 and does not reset', () => {
  const r = { total: 10, hits: 10, accuracy: 1 };
  assert.equal(okPassCopy(1, r, 1), 'Pass 1: 100% ✓ — one more');
  assert.doesNotMatch(okPassCopy(1, r, 1), /again from pass 1/);
});

test('top pass N matches the PASS chips after success and after fail', () => {
  const passes = CHALLENGES.passes;
  const after1 = [{ ok: true, accuracy: 1 }];
  assert.equal(challengePassNo(after1), 2);
  assert.deepEqual(slotStates(passes, 2, { results: after1 }).map(s => s.cls), ['ok done', 'live']);

  const failed = [{ ok: false, accuracy: 0 }];
  assert.equal(challengePassNo(failed), 1);
  assert.deepEqual(slotStates(passes, 2, { results: failed }).map(s => s.cls), ['no done', 'idle']);

  assert.equal(challengePassNo([]), 1);
  assert.deepEqual(slotStates(passes, 2, { results: [] }).map(s => s.cls), ['live', 'idle']);
});

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

// The stand's transport is ONE button: the room a second one would take is room the
// music is using. A tap cycles Play → Pause → Resume and a hold is Stop (press.js).
// The awkward case is the finger-pan, which pauses on purpose and resumes itself on
// lift -- the button must not read "Resume" in the middle of a gesture nobody thinks
// of as a pause.
test('the phone has one transport button, and it says which of the three it is', () => {
  const html = readFileSync(new URL('../learn-m.html', import.meta.url), 'utf8');
  const js = readFileSync(new URL('../src/learn/mobile.js', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../learn-m.css', import.meta.url), 'utf8');

  // one button in the meter row, where the thumb is, and no second one anywhere
  const row = html.match(/<div id="meterrow">([\s\S]*?)<\/div>\s*\n\s*<div id="mkb"/)[1];
  assert.match(row, /id="startBtn"[\s\S]*id="startLabel">▶ Play</);
  assert.equal(row.match(/<button/g).length, 1, 'one button in the row');
  assert.doesNotMatch(html, /id="stopBtn"|class="stopbtn"/, 'the phone Stop button is gone');
  assert.doesNotMatch(css, /stopbtn/, 'and so is its CSS');

  // the label per state, and the fill that says a hold is being waited for
  assert.equal(transportLabel({ running: false, paused: false }), '▶ Play');
  assert.equal(transportLabel({ running: true, paused: false }), '⏸ Pause');
  assert.equal(transportLabel({ running: false, paused: true }), '▶ Resume');
  assert.equal(transportLabel({ running: false, paused: true, scrubbing: true }), '▶ Play',
    'a finger-pan is a pause nobody thinks of as one: it must not offer to resume');
  assert.match(js, /el\.startLabel\.textContent = transportLabel\(\{ running: engine\.running, paused: engine\.paused, scrubbing \}\)/);
  assert.match(css, /#startBtn \.hold\{[^}]*width:0/, 'the fill starts empty');
  assert.match(js, /Math\.floor\(engine\.startAt \/ bpb\) \* bpb/,
    'Resume comes back in on the downbeat of the bar you paused in');
  assert.match(js, /engine\.resume\(at, \{ countIn: !engine\.wait \}\)/,
    'and asks for the click bar, except in wait mode where there is no clock');
  // and the plate stays off the music while it is held
  assert.match(js, /!s \|\| engine\.running \|\| engine\.paused \|\| pending/);
  // the plate teaches the hold, since a hold is the one gesture with nothing on screen
  assert.match(html, /id="iHint">tap Play · hold it to stop</);
});

// Both bars carry a readout whose length nothing bounds: the notes held on the
// laptop, the notes a wait group is standing on. Ten fingers down used to stretch
// the row -- so the text is trimmed to the box before it is ever written.
test('the readouts that change while you play are trimmed to a fixed box', () => {
  const laptop = readFileSync(new URL('../src/learn/app.js', import.meta.url), 'utf8');
  const phone = readFileSync(new URL('../src/learn/mobile.js', import.meta.url), 'utf8');
  const style = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
  const learn = readFileSync(new URL('../learn.css', import.meta.url), 'utf8');
  const mcss = readFileSync(new URL('../learn-m.css', import.meta.url), 'utf8');
  const flat = s => s.replace(/\s+/g, '');

  assert.equal(heldLabel([]), '', 'empty is empty: the pages keep their own idle dash');
  assert.equal(heldLabel(['C4']), 'C4');
  assert.equal(heldLabel(['C4', 'E4', 'G4']), 'C4 E4 G4');
  assert.equal(heldLabel(['C4', 'E4', 'G4', 'B4', 'D5']), 'C4 E4 G4 +2');
  assert.equal(heldLabel(['C4', 'E4', 'G4', 'B4'], 2), 'C4 E4 +2');
  assert.equal(heldLabel(new Set(['C4', 'E4'])), 'C4 E4', 'a set of held notes is a list');
  // ten fingers down: as long as a chord's label, not three times it
  const ten = ['C2', 'E2', 'G2', 'C3', 'E3', 'G3', 'C4', 'E4', 'G4', 'C5'];
  assert.equal(heldLabel(ten), 'C2 E2 G2 +7');
  assert.ok(heldLabel(ten).length <= 15, 'and it fits the reserved box');

  assert.match(laptop, /heldLabel\(\[\.\.\.held\]\.sort\(\(a, b\) => a - b\)\.map\(noteName\)\)/);
  assert.match(phone, /heldLabel\(g\.notes\.map\(e => noteName\(e\.n\)\)\)/);
  // and the boxes themselves: a width, not a floor, with the overflow clipped
  assert.match(flat(style), /#played\{[^}]*width:100px[^}]*\}/);
  assert.match(flat(style), /#played\{[^}]*text-overflow:ellipsis[^}]*\}/);
  assert.match(flat(learn), /body\.learn#played\{width:128px\}/, 'Learn has the room for the whole label');
  assert.match(flat(mcss), /#waitbox\.wnoteb\{[^}]*width:150px[^}]*text-overflow:ellipsis/);
  assert.match(flat(mcss), /#waitbox\.wfoundb\{[^}]*width:104px/);
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
