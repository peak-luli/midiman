// The Intro coach: the shape of the first three steps of a song, and the streak that
// decides when one of them is finished.
//
// This is the happy path the pianist actually walks -- open Learn, Start over, land on
// the Intro, listen, find the left hand's notes, then play them in time until two
// passes in a row are clean. Every claim below is one of those moments, checked
// against the shipped song rather than a fixture, because "lands on the Intro" is a
// claim about City of Stars and not about a plan builder in the abstract.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { parseSong } from '../src/song.js';
import { buildPlan, YOU, APP, OFF, PASS_ACCURACY, PASS_STREAK } from '../src/learn/plan.js';
import { makeStreak, FAIL_HOLD_MS } from '../src/learn/pass.js';

const city = () => parseSong(JSON.parse(
  readFileSync(new URL('../songs/city-of-stars.json', import.meta.url), 'utf8')));

/** A pass, as the engine reports one: only accuracy decides whether it counts. */
const pass = accuracy => ({ total: 20, hits: Math.round(20 * accuracy), misses: 0, extras: 0, accuracy });

// ---------------------------------------------------------------- the Intro's shape
test('a fresh plan starts on the Intro: bars 1-4, listening, both hands the app\'s', () => {
  const song = city();
  const plan = buildPlan(song);
  const s = plan[0];
  assert.equal(song.sections[s.section].name, 'Intro');
  assert.equal(s.kind, 'listen');
  assert.equal(s.title, 'Listen');
  assert.deepEqual([s.from + 1, s.to + 1], [1, 4]);        // bars, as the page counts them
  assert.equal(s.lh, APP);
  assert.equal(s.rh, APP);
  assert.equal(s.wait, false);
  assert.equal(s.bpm, song.practiceBpm);
});

test('the Intro is the left hand alone: find the notes, then in time, and no right hand', () => {
  const plan = buildPlan(city());
  const intro = plan.filter(s => s.section === 0);
  assert.deepEqual(intro.map(s => s.kind), ['listen', 'notes', 'hand']);
  assert.deepEqual(intro.map(s => s.title),
    ['Listen', 'Left hand: find the notes', 'Left hand in time']);
  for (const s of intro.slice(1)) {
    assert.equal(s.lh, YOU);
    assert.equal(s.rh, OFF);                                // bars 1-4 have no right hand at all
    assert.deepEqual([s.from + 1, s.to + 1], [1, 4]);
  }
});

test('the clock waits on "find the notes" and runs on "in time"; both loop, listening does not', () => {
  const [listen, notes, inTime] = buildPlan(city()).filter(s => s.section === 0);
  assert.equal(listen.wait, false);
  assert.equal(notes.wait, true);                           // Wait for me: no clock, it waits for you
  assert.equal(inTime.wait, false);
  // the page turns the loop on for every step but listening (app.js: `s.kind !== 'listen'`)
  assert.deepEqual([listen, notes, inTime].map(s => s.kind !== 'listen'), [false, true, true]);
});

test('"in time" wants two passes at 85%; the steps before it want one pass', () => {
  const [listen, notes, inTime] = buildPlan(city()).filter(s => s.section === 0);
  assert.equal(inTime.passes, PASS_STREAK);
  assert.equal(inTime.challenge.n, PASS_STREAK);
  assert.equal(inTime.challenge.accuracy, PASS_ACCURACY);
  assert.equal(PASS_STREAK, 2);
  assert.equal(PASS_ACCURACY, 0.85);
  assert.deepEqual([listen.passes, notes.passes], [1, 1]);
});

// ---------------------------------------------------------------- the coach's line
test('every step carries a coach line, short enough to read over the music', () => {
  const plan = buildPlan(city());
  for (const s of plan) {
    assert.ok(s.coach, `step ${s.id} (${s.title}) has no coach line`);
    assert.ok(s.coach.length <= 120, `step ${s.id} coach line is ${s.coach.length} chars: ${s.coach}`);
    assert.notEqual(s.coach, s.text);                       // the panel's paragraph is a different sentence
  }
});

test('a section can say its own words, and the Intro does', () => {
  const song = city();
  const plan = buildPlan(song);
  assert.ok(song.sections[0].coach, 'the Intro section has no coach line in the song');
  assert.ok(plan[0].coach.includes(song.sections[0].coach));
  const listenB = plan.find(s => s.kind === 'listen' && s.section === 1);
  assert.ok(listenB.coach.includes('bars 5–12') || listenB.coach.includes('Bars 5–12'));
});

// ---------------------------------------------------------------- the streak
test('two passes in a row at 85% finish the step', () => {
  const st = makeStreak();
  assert.equal(st.push(pass(0.9), PASS_ACCURACY).streak, 1);
  const second = st.push(pass(0.85), PASS_ACCURACY);
  assert.equal(second.ok, true);
  assert.equal(second.no, 2);                               // "Pass 2/2", as the meter labels it
  assert.equal(second.streak, PASS_STREAK);
  assert.equal(st.results().length, PASS_STREAK);
});

test('a pass below 85% starts the count again from pass 1', () => {
  const st = makeStreak();
  st.push(pass(0.9), PASS_ACCURACY);
  const bad = st.push(pass(0.84), PASS_ACCURACY);
  assert.equal(bad.ok, false);
  assert.equal(bad.streak, 0);
  assert.equal(st.push(pass(1), PASS_ACCURACY).no, 1);      // the next one is pass 1 again
  assert.equal(st.streak, 1);
});

test('the failed pass is held on the meter for a moment, then the slots clear', () => {
  const st = makeStreak();
  st.push(pass(0.9), PASS_ACCURACY);
  st.push(pass(0.5), PASS_ACCURACY);
  const now = st.passes[st.passes.length - 1].at;
  const held = st.results(now + FAIL_HOLD_MS / 2);
  assert.equal(held.length, 1);
  assert.equal(held[0].ok, false);
  assert.equal(held[0].accuracy, 0.5);                      // shown with its percentage, in red
  assert.deepEqual(st.results(now + FAIL_HOLD_MS + 1), []);
});

test('a listening step passes on nothing played, because none of it is yours', () => {
  const st = makeStreak();
  const heard = st.push({ total: 0, hits: 0, misses: 0, extras: 0, accuracy: 1 }, 0);
  assert.equal(heard.ok, true);
  assert.equal(heard.streak, 1);
});
