// The learn page's musical logic: the song notation, the lesson plan, and scoring.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

import { parseSong, swungBeat, notesIn } from '../src/song.js';
import { buildPlan, progress, YOU, APP, OFF, PASS_STREAK } from '../src/learn/plan.js';
import { expectedOf, makeTally, passed, groupsOf, splitExtras, WINDOW } from '../src/learn/scorer.js';
import { TIERS, resolveTempo, rememberTempo, forgetTempo, freeStep, isCustomTempo } from '../src/learn/tempo.js';

const tiny = () => parseSong({
  id: 't', title: 'Tiny', bpm: 100, swing: '2/3',
  sections: [{ name: 'A', from: 1, to: 2 }, { name: 'B', from: 3, to: 3 }],
  rh: ['C4 D4 E4:2 r:2 [G4 B4]:2', '~[G4 B4]:4 r:4', 'r:8'],
  lh: ['C3:8', 'G2:4 ~G2:2 /[C3 E3]:2', 'C3:2/3 D3:2/3 E3:2/3 F3:6'],
});

// ---------------------------------------------------------------- notation
test('bars are cells of eighths and must sum to 8', () => {
  assert.throws(() => parseSong({ id: 'x', title: 'x', bpm: 1, rh: ['C4:7'], lh: ['r:8'] }), /sums to 7/);
  assert.throws(() => parseSong({ id: 'x', title: 'x', bpm: 1, rh: ['C4 C4:8'], lh: ['r:8'] }), /sums to 9/);
  assert.throws(() => parseSong({ id: 'x', title: 'x', bpm: 1, rh: ['H4:8'], lh: ['r:8'] }), /bad note/);
  assert.throws(() => parseSong({ id: 'x', title: 'x', bpm: 1, rh: ['r:8'], lh: [] }), /rh has 1 bars, lh has 0/);
});

test('pitches, chords, rests and lengths come out in beats', () => {
  const s = tiny();
  const rh = s.rh.filter(n => n.bar === 0);
  assert.deepEqual(rh.map(n => [n.n, n.b, n.len]),
    [[60, 0, .5], [62, .5, .5], [64, 1, 1], [67, 3, 1 + 2], [71, 3, 1 + 2]]);   // chord tied into bar 2
});

test('a tie extends the earlier note instead of striking it again', () => {
  const s = tiny();
  const g2 = s.lh.filter(n => n.n === 43);
  assert.equal(g2.length, 1);
  assert.equal(g2[0].len, 3);
  const chord = s.rh.filter(n => n.bar === 0 && n.n === 67)[0];
  assert.equal(chord.len, 3);                       // 2 eighths + 4 eighths tied = 3 beats
  assert.equal(s.rh.filter(n => n.bar === 1).length, 0);
});

test('a rolled chord marks each note with its place in the roll', () => {
  const s = tiny();
  const roll = s.lh.filter(n => n.bar === 1 && n.b === 7);
  assert.deepEqual(roll.map(n => n.roll), [0, 1]);
  assert.deepEqual(s.rh.filter(n => n.bar === 0).map(n => n.roll), [-1, -1, -1, -1, -1]);
});

test('fractions give exact tuplets', () => {
  const s = tiny();
  const trip = s.lh.filter(n => n.bar === 2).map(n => n.len);
  assert.ok(Math.abs(trip[0] - 1 / 3) < 1e-9);
  assert.ok(Math.abs(trip[3] - 3) < 1e-9);
});

test('swing moves only the offbeat eighths', () => {
  assert.equal(swungBeat(0, 2 / 3), 0);
  assert.ok(Math.abs(swungBeat(0.5, 2 / 3) - 2 / 3) < 1e-9);
  assert.equal(swungBeat(1.25, 2 / 3), 1.25);      // a sixteenth stays straight
  assert.ok(Math.abs(swungBeat(4.5, 2 / 3) - 4 - 2 / 3) < 1e-9);
});

test('sections are validated and zero-based', () => {
  const s = tiny();
  assert.deepEqual(s.sections.map(x => [x.from, x.to]), [[0, 1], [2, 2]]);
  assert.throws(() => parseSong({ id: 'x', title: 'x', bpm: 1, rh: ['r:8'], lh: ['r:8'],
    sections: [{ name: 'A', from: 1, to: 2 }] }), /spans bars 1-2 of 1/);
});

test('every shipped song parses', () => {
  const files = readdirSync(new URL('../songs/', import.meta.url)).filter(f => f.endsWith('.json') && f !== 'index.json');
  assert.ok(files.length >= 1);
  for (const f of files) {
    const doc = JSON.parse(readFileSync(new URL('../songs/' + f, import.meta.url), 'utf8'));
    const s = parseSong(doc);
    assert.ok(s.nbars > 0, f);
    assert.ok(s.rh.length + s.lh.length > 0, f);
  }
  const idx = JSON.parse(readFileSync(new URL('../songs/index.json', import.meta.url), 'utf8'));
  for (const f of idx.songs) assert.ok(files.includes(f), `index lists ${f}`);
});

test('Let It Be: 16 bars, C major, four-chord loop, no swing or rolls', () => {
  const s = parseSong(JSON.parse(readFileSync(new URL('../songs/let-it-be.json', import.meta.url), 'utf8')));
  assert.equal(s.title, 'Let It Be');
  assert.equal(s.nbars, 16);
  assert.equal(s.key, 'C');
  assert.equal(s.swing, 0.5);
  assert.equal(s.practiceBpm, 52);
  assert.equal(s.bpm, 72);
  assert.deepEqual(s.sections.map(x => x.name), ['Intro', 'Verse', 'Chorus']);
  assert.equal(s.sections[0].from, 0);
  assert.equal(s.sections.at(-1).to, 15);
  for (let i = 1; i < s.sections.length; i++) assert.equal(s.sections[i].from, s.sections[i - 1].to + 1);
  assert.ok(s.notes.every(n => n.roll < 0), 'no rolled chords');
  // Intro RH is a C major triad (two half notes); LH is C3. Verse melody starts on G4 in bar 5.
  assert.deepEqual([...new Set(s.rh.filter(n => n.bar === 0).map(n => n.n))].sort((a, b) => a - b), [60, 64, 67]);
  assert.equal(s.lh[0].n, 48);
  assert.equal(s.rh.find(n => n.bar === 4).n, 67);
  const idx = JSON.parse(readFileSync(new URL('../songs/index.json', import.meta.url), 'utf8'));
  assert.ok(idx.songs.includes('let-it-be.json'));
  assert.ok(idx.songs.includes('city-of-stars.json'));
  const plan = buildPlan(s);
  for (const step of plan) {
    assert.ok(step.coach, `${step.title} has no coach line`);
    assert.ok(step.coach.length <= 120, `${step.title} coach is ${step.coach.length} chars`);
  }
});

test('City of Stars: 59 bars, F major, both hands, sections cover the song', () => {
  const s = parseSong(JSON.parse(readFileSync(new URL('../songs/city-of-stars.json', import.meta.url), 'utf8')));
  assert.equal(s.nbars, 59);
  assert.equal(s.sections[0].from, 0);
  assert.equal(s.sections.at(-1).to, 58);
  for (let i = 1; i < s.sections.length; i++) assert.equal(s.sections[i].from, s.sections[i - 1].to + 1);
  // the first melody note is the G4 in bar 5; the vamp starts on G2
  assert.equal(s.rh[0].n, 67); assert.equal(s.rh[0].bar, 4);
  assert.equal(s.lh[0].n, 43); assert.equal(s.lh[0].bar, 0);
  // the tied D5 across bars 6-7 is one note, two and a half beats long
  const d5 = s.rh.find(n => n.bar === 5 && n.n === 74 && n.b === 5 * 4 + 3.5);
  assert.equal(d5.len, 1);
  const a4 = s.rh.find(n => n.bar === 6 && n.n === 69);
  assert.equal(a4.len, 3.5);
});

// ---------------------------------------------------------------- plan
test('the plan walks each section hear -> hands alone -> together, then joins', () => {
  const s = tiny(), plan = buildPlan(s);
  const kinds = plan.map(p => p.kind);
  // section A: listen, lh notes, lh in time, rh notes, rh in time, both slow, both faster
  assert.deepEqual(kinds.slice(0, 7), ['listen', 'notes', 'hand', 'notes', 'hand', 'both', 'both']);
  // section B has no right-hand notes, so only the left hand is taught
  const b = plan.filter(p => p.section === 1 && p.kind !== 'song');
  assert.deepEqual(b.map(p => p.kind), ['listen', 'notes', 'hand', 'join']);
  assert.ok(b.every(p => p.kind !== 'both'));
  assert.equal(plan.at(-1).kind, 'song');
  assert.equal(plan.at(-1).from, 0); assert.equal(plan.at(-1).to, 2);
  assert.deepEqual(plan.map(p => p.id), plan.map((_, i) => i));
});

test('steps say which hand is whose, whether the clock waits, and how many passes', () => {
  const plan = buildPlan(tiny());
  const notes = plan.find(p => p.kind === 'notes');
  assert.equal(notes.lh, YOU); assert.equal(notes.rh, OFF); assert.equal(notes.wait, true); assert.equal(notes.passes, 1);
  const listen = plan[0];
  assert.equal(listen.lh, APP); assert.equal(listen.rh, APP);
  const both = plan.find(p => p.kind === 'both');
  assert.equal(both.passes, PASS_STREAK); assert.equal(both.wait, false);
  const join = plan.find(p => p.kind === 'join');
  assert.equal(join.from, 0); assert.equal(join.to, 2);
});

test('progress counts done steps', () => {
  const plan = buildPlan(tiny());
  assert.deepEqual(progress(plan, new Set([0, 1])), { done: 2, total: plan.length, pct: 2 / plan.length });
});

// ---------------------------------------------------------------- tempo tiers
test('every step names its tempo tier, and the tier matches its bpm', () => {
  const s = tiny(), plan = buildPlan(s);
  const bpmOf = { slow: s.practiceBpm, mid: Math.round(s.bpm * 0.8), full: s.bpm };
  for (const p of plan) {
    assert.ok(TIERS.includes(p.tier), `${p.title} has no tier`);
    assert.equal(p.bpm, bpmOf[p.tier]);
  }
  assert.equal(plan.at(-1).tier, 'full');
  assert.equal(plan.find(p => p.title === 'Hands together, faster').tier, 'mid');
  assert.equal(plan.find(p => p.kind === 'join').tier, 'mid');
  assert.equal(plan[0].tier, 'slow');
});

test('a step loads at your tempo for its tier, else the plan default', () => {
  const plan = buildPlan(tiny());
  const slow = plan[0], mid = plan.find(p => p.tier === 'mid'), full = plan.at(-1);
  assert.equal(resolveTempo(slow, {}), slow.bpm);
  assert.equal(resolveTempo(slow), slow.bpm);                       // no prefs saved yet
  const prefs = { slow: 84 };
  assert.equal(resolveTempo(slow, prefs), 84);
  assert.equal(resolveTempo(mid, prefs), mid.bpm);                  // a tier of its own
  assert.equal(resolveTempo(full, prefs), full.bpm);
  assert.equal(resolveTempo(slow, { slow: null }), slow.bpm);       // junk falls back
});

test('a hand-set tempo is remembered under its own tier, and reset clears just that one', () => {
  const plan = buildPlan(tiny());
  const slow = plan[0], mid = plan.find(p => p.tier === 'mid');
  let prefs = rememberTempo({}, slow, 84);
  assert.deepEqual(prefs, { slow: 84 });
  prefs = rememberTempo(prefs, mid, 100);
  assert.deepEqual(prefs, { slow: 84, mid: 100 });
  prefs = rememberTempo(prefs, slow, 88);                           // the tier's tempo is replaced
  assert.deepEqual(prefs, { slow: 88, mid: 100 });
  assert.deepEqual(rememberTempo(prefs, slow, NaN), prefs);         // nothing to remember
  const cleared = forgetTempo(prefs, slow);
  assert.deepEqual(cleared, { mid: 100 });
  assert.equal(resolveTempo(slow, cleared), slow.bpm);
  assert.deepEqual(forgetTempo(cleared, slow), cleared);            // clearing twice is a no-op
  assert.deepEqual(prefs, { slow: 88, mid: 100 });                  // and the old prefs are untouched
});

test('free practice keeps a tempo of its own, and the marker follows the default', () => {
  const free = freeStep(60), plan = buildPlan(tiny());
  const prefs = rememberTempo({ slow: 84 }, free, 72);
  assert.deepEqual(prefs, { slow: 84, free: 72 });
  assert.equal(resolveTempo(free, prefs), 72);
  assert.equal(resolveTempo(plan[0], prefs), 84);                   // free practice does not leak into the steps
  assert.equal(isCustomTempo(free, 72), true);
  assert.equal(isCustomTempo(free, 60), false);
  assert.equal(isCustomTempo(null, 60), false);
});

// ---------------------------------------------------------------- scorer
const swung = b => swungBeat(b, 0.5);

test('expected onsets are the played hands only, in time order', () => {
  const s = tiny();
  const both = expectedOf(s, 0, 0, ['lh', 'rh'], swung);
  assert.deepEqual(both.map(e => [e.b, e.n]), [[0, 48], [0, 60], [.5, 62], [1, 64], [3, 67], [3, 71]]);
  assert.equal(expectedOf(s, 0, 0, ['rh'], swung).length, 5);
  assert.equal(expectedOf(s, 2, 2, ['rh'], swung).length, 0);
});

test('a note within the window is a hit; the rest are extras and misses', () => {
  const s = tiny();
  const t = makeTally(expectedOf(s, 0, 0, ['rh'], swung));
  assert.ok(t.onNote(60, 0.1));                     // C4 a bit late
  assert.equal(t.onNote(60, 0.1), null);            // the same note again: already claimed
  assert.ok(t.onNote(62, 0.5 - WINDOW + 0.01));
  assert.equal(t.onNote(64, 2.5), null);            // E4 far too late
  assert.equal(t.extras.length, 2);
  assert.deepEqual(t.missesBefore(2).map(e => e.n), [64]);
  const r = t.result();
  assert.equal(r.hits, 2); assert.equal(r.total, 5); assert.equal(r.misses, 3); assert.equal(r.extras, 2);
  assert.ok(r.late >= 1);
});

test('a note just before the loop wraps can hit the first onset of the next pass', () => {
  const s = tiny();
  const t = makeTally(expectedOf(s, 0, 0, ['rh'], swung), 4);
  const hit = t.onNote(60, 3.9);
  assert.ok(hit); assert.equal(hit.b, 0);
  assert.ok(Math.abs(hit.hit.off - (-0.1)) < 1e-9);
});

test('passing needs the accuracy and not too many wrong notes', () => {
  assert.ok(passed({ total: 10, hits: 9, extras: 1, accuracy: .9 }, .85));
  assert.ok(!passed({ total: 10, hits: 8, extras: 0, accuracy: .8 }, .85));
  assert.ok(passed({ total: 10, hits: 10, extras: 29, accuracy: 1 }, .85));   // wrong notes never fail a pass
  // empty is only a pass when the step asked for nothing (listen uses 0)
  assert.ok(passed({ total: 0, hits: 0, extras: 0, accuracy: 1 }, 0));
  assert.ok(!passed({ total: 0, hits: 0, extras: 0, accuracy: 1 }, .85));
});

test('notes that belong to the silent hand are not wrong notes', () => {
  const s = tiny();
  const other = expectedOf(s, 0, 0, ['lh'], swung);            // left hand is Off: C3 at beat 0
  const { outside, wrong } = splitExtras([{ n: 48, beat: 0.1 }, { n: 48, beat: 2 }, { n: 50, beat: 0 }, { n: 48, beat: 3.9 }], other, 4);
  assert.deepEqual(outside.map(x => x.beat), [0.1, 3.9]);      // in time, and just before the wrap
  assert.deepEqual(wrong.map(x => [x.n, x.beat]), [[48, 2], [50, 0]]);
  assert.equal(splitExtras([], other).wrong.length, 0);
});

test('wait-mode groups gather everything at one onset', () => {
  const s = tiny();
  const g = groupsOf(expectedOf(s, 0, 0, ['lh', 'rh'], swung));
  assert.deepEqual(g.map(x => [x.b, x.notes.map(n => n.n)]), [[0, [48, 60]], [.5, [62]], [1, [64]], [3, [67, 71]]]);
});

test('notesIn picks a hand and a bar range', () => {
  const s = tiny();
  assert.equal(notesIn(s, 0, 0, 'lh').length, 1);
  assert.equal(notesIn(s, 0, 1).length, 5 + 1 + 1 + 2);
});

// ---------------------------------------------------------------- live progress
import { liveOf, windowStats, CHALLENGES } from '../src/learn/scorer.js';

test('liveOf counts only the notes that have come due', () => {
  const s = tiny();
  const t = makeTally(expectedOf(s, 0, 0, ['rh'], swung));
  assert.deepEqual(liveOf(t), { hits: 0, due: 0, extras: 0, pct: 0 });
  t.onNote(60, 0.05);                                // hit
  t.onNote(70, 0.3);                                 // extra
  assert.deepEqual(liveOf(t), { hits: 1, due: 1, extras: 1, pct: 1 });
  for (const m of t.missesBefore(2)) m.missed = true;   // D4 and E4 came and went
  const l = liveOf(t);
  assert.equal(l.due, 3); assert.equal(l.hits, 1); assert.ok(Math.abs(l.pct - 1 / 3) < 1e-9);
  assert.equal(liveOf(null).due, 0);
});

test('liveOf keeps counting as the playhead moves, even when missed was never set', () => {
  // the phone freeze: only the opening hits had flags, later windows closed
  // without a miss event, and the meter stuck on the early percentage
  const s = tiny();
  const t = makeTally(expectedOf(s, 0, 0, ['rh'], swung));
  t.onNote(60, 0.05);                                 // C4 hit
  const early = liveOf(t, 0.4);
  assert.equal(early.hits, 1);
  assert.equal(early.due, 1);
  const mid = liveOf(t, 2);                            // D4 and E4 windows have closed
  assert.equal(mid.hits, 1);
  assert.ok(mid.due >= 3, `due should keep growing past the first hit, got ${mid.due}`);
  assert.ok(mid.due > early.due);
  assert.ok(mid.pct < early.pct);
});

test('windowStats is the hit rate over the last N seconds, extras aside', () => {
  const hist = [
    { t: 0, k: 'hit' }, { t: 500, k: 'miss' },            // outside a 10 s window at t=11000
    { t: 2000, k: 'hit' }, { t: 3000, k: 'hit' }, { t: 4000, k: 'extra' }, { t: 5000, k: 'miss' },
  ];
  const w = windowStats(hist, 11000, 10);
  assert.deepEqual(w, { hits: 2, misses: 1, extras: 1, due: 3, pct: 2 / 3 });
  assert.deepEqual(windowStats(hist, 20000, 10), { hits: 0, misses: 0, extras: 0, due: 0, pct: 0 });
  assert.equal(windowStats(hist.slice(0, 2), 10000, 10).pct, 0.5);   // t=0 sits exactly on the boundary and counts
  assert.equal(windowStats([], 0, 10).due, 0);
});

test('every step carries its challenge, and the shared challenges are well-formed', () => {
  const plan = buildPlan(tiny());
  for (const s of plan) {
    assert.equal(s.challenge.kind, 'passes');
    assert.equal(s.challenge.n, s.passes);
    assert.equal(s.challenge.accuracy, 0.85);
  }
  assert.equal(plan.find(p => p.kind === 'hand').challenge.n, PASS_STREAK);
  assert.equal(plan[0].challenge.n, 1);
  assert.equal(CHALLENGES.passes.n, 2);
  assert.equal(CHALLENGES.window.seconds, 10);
  assert.ok(CHALLENGES.window.minDue > 0);
  assert.equal(CHALLENGES.none.kind, 'none');
});

// ---------------------------------------------------------------- staff (ABC engraving)
import { keySignature, abcNote, abcLen, abcVoice, buildAbc, colsFor, systemGrid } from '../src/learn/staff.js';
import { fallX, fallY, fallBeat, LOOKAHEAD } from '../src/learn/fall.js';
import { rollBeat } from '../src/learn/roll.js';

test('key signatures come from the circle of fifths, minors via their relative major', () => {
  assert.deepEqual(keySignature('F').sig, { C: 0, D: 0, E: 0, F: 0, G: 0, A: 0, B: -1 });
  assert.equal(keySignature('D').n, 2);
  assert.equal(keySignature('D').sig.F, 1); assert.equal(keySignature('D').sig.C, 1);
  assert.equal(keySignature('Dm').major, 'F');
  assert.equal(keySignature('C').n, 0);
});

test('pitches are spelt against the key: no sign when the signature has it, = for a cancelled one', () => {
  const F = keySignature('F');
  assert.equal(abcNote(58, F), 'B,');          // Bb3 in F: the signature has it
  assert.equal(abcNote(59, F), '=B,');         // B natural needs the natural sign
  assert.equal(abcNote(61, F), '^C');          // C#4
  assert.equal(abcNote(63, F), '_E');          // Eb4: not in the signature, so it gets its flat
});

test('octave marks follow the letter: C4 is C, C5 is c, C3 is C,', () => {
  const C = keySignature('C');
  assert.equal(abcNote(60, C), 'C'); assert.equal(abcNote(72, C), 'c'); assert.equal(abcNote(48, C), 'C,');
  assert.equal(abcNote(84, C), "c'"); assert.equal(abcNote(36, C), 'C,,');
  assert.equal(abcNote(70, C, false), '_B'); assert.equal(abcNote(70, C, true), '^A');
});

test('lengths are eighths under L:1/8, with fractions for shorter values', () => {
  assert.equal(abcLen(1), ''); assert.equal(abcLen(2), '2'); assert.equal(abcLen(3), '3'); assert.equal(abcLen(8), '8');
  assert.equal(abcLen(0.5), '/'); assert.equal(abcLen(1.5), '3/2'); assert.equal(abcLen(0.25), '1/4');
});

test('a voice is engraved with chords, rests, ties across the bar line and tuplets', () => {
  const s = tiny();                                              // rh: "C4 D4 E4:2 r:2 [G4 B4]:2", "~[G4 B4]:4 r:4", "r:8"
  const ks = keySignature('C');
  // no space between two tokens means "beam them"; a space breaks the beam
  const rh = abcVoice(s.cells.rh, ks, false);
  assert.deepEqual(rh, ['CD E2 z2 [GB]2- |', '[GB]4 z4 |', 'z8 |']);
  const lh = abcVoice(s.cells.lh, ks, false);                    // "C3:8", "G2:4 ~G2:2 /[C3 E3]:2", "C3:2/3 D3:2/3 E3:2/3 F3:6"
  assert.deepEqual(lh, ['C,8 |', 'G,,4- G,,2 [C,E,]2 |', '(3:2:3C,D,E, F,6 |']);
});

test('a partial tie in a chord marks only the tied pitches', () => {
  const s = parseSong({ id: 'x', title: 'x', bpm: 1, key: 'C',
    rh: ['[C4 E4 G4]:4 ~[E4 G4]:4', 'r:8'], lh: ['r:8', 'r:8'] });
  assert.deepEqual(abcVoice(s.cells.rh, keySignature('C'), false), ['[CE-G-]4 [EG]4 |', 'z8 |']);
});

test('the tune has a grand staff with K: last and one V1/V2 line pair per system', () => {
  const s = tiny();
  const abc = buildAbc(s, 0, 2, 2);
  const lines = abc.split('\n');
  assert.deepEqual(lines.slice(0, 8), ['X:1', 'M:4/4', 'L:1/8', '%%stretchlast 1', '%%score {(V1) (V2)}',
                                       'V:V1 clef=treble', 'V:V2 clef=bass', 'K:C']);
  assert.equal(lines[8], '[V:V1] CD E2 z2 [GB]2- |[GB]4 z4 |');
  assert.equal(lines[9], '[V:V2] C,8 |G,,4- G,,2 [C,E,]2 |');
  assert.equal(lines[10], '[V:V1] z8 |');
  assert.equal(lines.length, 12);
  assert.ok(!abc.includes('\n\n'));                              // a blank line would end the tune
});

test('City of Stars engraves every bar in F with the accidentals it needs', () => {
  const s = parseSong(JSON.parse(readFileSync(new URL('../songs/city-of-stars.json', import.meta.url), 'utf8')));
  const abc = buildAbc(s, 0, 58, 4);
  assert.ok(abc.includes('K:F'));
  const v1 = abc.split('\n').filter(l => l.startsWith('[V:V1]')).map(l => l.slice(7)).join('');
  assert.equal(v1.split('|').length - 1, 59);
  assert.ok(v1.includes('=B'));                                  // B natural in the A7 voicing
  assert.ok(v1.includes('^C'));                                  // C sharp there too
  assert.ok(v1.includes('(7:4:7'));                              // the seven-tuplet in bar 34
  assert.ok(abc.includes('(3:2:3'));
  assert.equal(colsFor(4), 4); assert.equal(colsFor(6), 3); assert.equal(colsFor(59), 4);
});

// ---------------------------------------------------------------- proportional staff grid
test('a system gives every bar the same width and every beat the same span', () => {
  const g = systemGrid(100, 900, 4);                             // 800 px, 4 bars, 16 beats
  assert.equal(g.barW, 200);
  assert.equal(g.pxPerBeat, 50);
  assert.equal(g.x(0), 100);                                     // the first onset opens the system
  assert.equal(g.x(4), 300);                                     // every bar line 200 px on
  assert.equal(g.x(8), 500);
  assert.equal(g.x(12), 700);
  assert.equal(g.x(16), 900);                                    // the closing line ends it
  // the whole point: equal beats, so a constant-speed playhead is correct
  const step = [...Array(16)].map((_, i) => g.x(i + 1) - g.x(i));
  assert.ok(step.every(d => Math.abs(d - 50) < 1e-9));
});

test('the grid maps a point back to the beat it is over, and back again', () => {
  const g = systemGrid(100, 900, 4);
  assert.equal(g.beat(100), 0);
  assert.equal(g.beat(475), 7.5);
  for (const b of [0, 1.5, 7.5, 16]) assert.ok(Math.abs(g.beat(g.x(b)) - b) < 1e-9);
});

test('a swung eighth lands where it sounds, not halfway between the beats', () => {
  const g = systemGrid(0, 800, 4);                               // 50 px a beat
  const sw = 2 / 3;
  assert.equal(g.x(swungBeat(1, sw)), 50);                       // downbeats are untouched
  assert.equal(g.x(swungBeat(1.5, sw)), 50 + 50 * sw);           // the offbeat sits two thirds in
  assert.ok(g.x(swungBeat(1.5, sw)) > g.x(1.5));                 // later than a straight eighth
  assert.equal(g.x(swungBeat(1.25, sw)), g.x(1.25));             // off the eighth grid: straight
});

test('a short last system keeps the same bar width it would have had full', () => {
  const full = systemGrid(100, 900, 4), part = systemGrid(100, 500, 2);
  assert.equal(full.barW, part.barW);
  assert.equal(full.pxPerBeat, part.pxPerBeat);
});

// ---------------------------------------------------------------- falling view geometry
test('a falling bar sits over its key and reaches the hit line at its onset', () => {
  const keys = new Map([[60, { left: 100, width: 20 }], [61, { left: 114, width: 12 }]]);
  assert.deepEqual(fallX(keys, 60, 800), { x: 100, w: 20, off: false });
  assert.deepEqual(fallX(keys, 61, 800), { x: 114, w: 12, off: false });
  assert.equal(fallX(keys, 30, 800).off, true);                  // below the strip: squeezed at the edge
  const hitY = 300, ppb = hitY / LOOKAHEAD;
  assert.equal(fallY(2, 2, hitY, ppb), hitY);                    // at its onset: on the line
  assert.equal(fallY(2, 0, hitY, ppb), hitY - 2 * ppb);          // two beats early: two beats up
  assert.equal(fallY(0, -4, hitY, ppb), hitY - 4 * ppb);         // during the count-in, still above
  assert.ok(fallY(1, 2, hitY, ppb) > hitY);                      // already played: below the line
});

// ---------------------------------------------------------------- click -> beat
test('a click maps to a beat: across the roll, down the falling view', () => {
  assert.equal(rollBeat(0, 800, 16), 0);
  assert.equal(rollBeat(800, 800, 16), 16);                      // the far edge is the loop end
  assert.equal(rollBeat(480, 800, 16), 9.6);                     // 60% across an 8-bar loop
  assert.equal(rollBeat(200, 800, 4), 1);                        // a one-bar loop is four beats wide

  const hitY = 300, ppb = hitY / LOOKAHEAD;
  assert.equal(fallBeat(hitY, 5, hitY, ppb), 5);                 // on the line: where you are
  assert.equal(fallBeat(hitY - 2 * ppb, 5, hitY, ppb), 7);       // two beats above: two beats ahead
  assert.equal(fallBeat(hitY + ppb, 5, hitY, ppb), 4);           // below it: a beat behind
  for (const b of [0, 3.5, 9]) assert.ok(Math.abs(fallBeat(fallY(b, 5, hitY, ppb), 5, hitY, ppb) - b) < 1e-9);
});
