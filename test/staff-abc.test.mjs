// The ABC the staff view hands abcjs. abcjs breaks a system exactly where the source
// breaks a line, so how many `[V:V1]` lines the tune has *is* how many systems get
// engraved -- which is what the scrolling view depends on when it asks for one.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildAbc, colsFor, systemGrid } from '../src/learn/staff.js';
import { parseSong } from '../src/song.js';

const song = parseSong(JSON.parse(readFileSync(new URL('../songs/city-of-stars.json', import.meta.url), 'utf8')));
/** The voice lines of a tune: one pair per system. */
const systems = abc => abc.split('\n').filter(l => l.startsWith('[V:V1]'));
const bars = line => line.split('|').length - 1;

test('cols = the number of bars puts the whole range on one system', () => {
  for (const [a, b] of [[0, 3], [0, 7], [4, 15], [0, 31]]) {
    const n = b - a + 1;
    const rows = systems(buildAbc(song, a, b, n));
    assert.equal(rows.length, 1, `bars ${a + 1}-${b + 1} came out as ${rows.length} systems`);
    assert.equal(bars(rows[0]), n);
    // both hands are there, and the tune is still a grand staff of two voices
    const abc = buildAbc(song, a, b, n);
    assert.equal(abc.split('\n').filter(l => l.startsWith('[V:V2]')).length, 1);
    assert.ok(abc.includes('V:V1 clef=treble') && abc.includes('V:V2 clef=bass'));
  }
});

test('the same range wraps as before when cols is the reading width', () => {
  // the multi-system mode is untouched: 8 bars at 4 to a line is still two lines
  assert.equal(systems(buildAbc(song, 0, 7, colsFor(8))).length, 2);
  assert.equal(systems(buildAbc(song, 0, 5, colsFor(6))).length, 2);
  assert.equal(systems(buildAbc(song, 0, 3, colsFor(4))).length, 1);
  assert.equal(colsFor(4), 4);
  assert.equal(colsFor(6), 3);
  assert.equal(colsFor(8), 4);
});

test('a 6/8 song engraves M:6/8 and two beats to the bar', () => {
  const river = parseSong(JSON.parse(readFileSync(new URL('../songs/river-flows-in-you.json', import.meta.url), 'utf8')));
  const abc = buildAbc(river, 0, 3, 4);
  assert.ok(abc.startsWith('X:1\nM:6/8\n'));
  assert.ok(abc.includes('K:C'));
  const g = systemGrid(0, 80, 4, river.beatsPerBar);
  assert.equal(g.barW, 20);
  assert.equal(g.pxPerBeat, 10);
  assert.equal(g.barX(1), g.barW);
  assert.equal(g.x(river.beatsPerBar), g.barW);   // no inset asked for: the onset is on the line
});

test('one system of n bars is n bars wide, at the pixels per beat asked for', () => {
  // what the strip promises the camera: the grid is linear, and a beat is a beat
  const ppb = 60, n = 8;
  const g = systemGrid(30, 30 + n * 4 * ppb, n);
  assert.equal(g.pxPerBeat, ppb);
  assert.equal(g.barW, ppb * 4);
  assert.equal(g.x(0), 30);
  assert.equal(g.x(n * 4), g.right);
  for (let b = 0; b < n * 4; b++) assert.equal(g.x(b + 1) - g.x(b), ppb);
  for (let k = 0; k <= n; k++) assert.equal(g.barX(k), 30 + k * 4 * ppb);
  // and it extrapolates both ways, which is how a count-in and the last bar work
  assert.equal(g.x(-4), 30 - 4 * ppb);
  assert.equal(g.beat(g.x(37.5)), 37.5);
});

test('a bar keeps a gap after its bar line, and the beats inside it stay equal', () => {
  // the engraving bug: with no inset the beat-0 note is drawn *on* the bar line
  const plain = systemGrid(0, 800, 4);
  assert.equal(plain.x(4), plain.barX(1));

  const g = systemGrid(0, 800, 4, 4, 10);        // 200 px a bar, a 10 px inset
  assert.equal(g.inset, 10);
  assert.equal(g.barW, 200);
  for (let k = 0; k <= 4; k++) assert.equal(g.barX(k), k * 200);   // the lines have not moved
  // every bar's first note clears its own bar line by exactly the inset
  for (let k = 0; k < 4; k++) assert.equal(g.x(k * 4) - g.barX(k), 10);
  // ...and the beats inside a bar are still one width, so the playhead keeps tempo
  assert.equal(g.pxPerBeat, 47.5);               // (200 - 10) / 4
  for (let k = 0; k < 4; k++)
    for (let b = 0; b < 3; b++)
      assert.equal(g.x(k * 4 + b + 1) - g.x(k * 4 + b), g.pxPerBeat);
  // the room comes off the bar, not off the next one: the last sixteenth of a bar is
  // still short of the line that closes it
  assert.ok(g.x(3.75) < g.barX(1));
  assert.ok(g.barX(1) - g.x(3.5) > 10);
  // crossing the line is the one step that is not a beat: it is a beat plus the inset
  assert.equal(g.x(4) - g.x(3), g.pxPerBeat + 10);
});

test('the inset grid still maps a point back to the beat it is over', () => {
  const g = systemGrid(100, 900, 4, 4, 10);
  for (const b of [0, 1.5, 4, 7.5, 8, 15.9, 16]) assert.ok(Math.abs(g.beat(g.x(b)) - b) < 1e-9);
  // the gap itself belongs to the bar it opens: a click just past a bar line seeks
  // that bar's downbeat rather than the tail of the bar before
  assert.equal(g.beat(g.barX(2)), 8);
  assert.equal(g.beat(g.barX(2) + 5), 8);
  assert.equal(g.beat(g.barX(2) + 10), 8);
  assert.ok(g.beat(g.barX(2) - 1) < 8);
});

test('a dense system cannot spend its bar on the gap', () => {
  // 6/8 at 20 px a bar: half a beat is 5, whatever the caller measured off the glyphs
  const g = systemGrid(0, 80, 4, 2, 40);
  assert.equal(g.inset, 5);
  assert.equal(g.pxPerBeat, 7.5);
  assert.equal(g.x(2) - g.barX(1), 5);
  assert.equal(systemGrid(0, 800, 4, 4, -3).inset, 0);
});
