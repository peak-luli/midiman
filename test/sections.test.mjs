// Contiguous Free practice section range: click then Shift+click (or a long-press)
// takes every section between the two, inclusive, in list order. No gaps.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  sectionSpan, sectionsCovered, sectionAligned, sectionOn, wholeSongOn,
  sectionAt, rangeAnchor, pickSection, rangeTitle,
} from '../src/learn/sections.js';

const song = {
  nbars: 12,
  sections: [
    { name: 'Intro', from: 0, to: 2 },
    { name: 'Part A', from: 3, to: 5 },
    { name: 'Part B', from: 6, to: 8 },
    { name: 'Theme', from: 9, to: 11 },
  ],
};

const pick = (sec, extra = {}) => pickSection(song.sections, {
  sec, extend: false, anchor: null, from: 0, to: 2, nbars: song.nbars, ...extra,
});

test('a plain click selects one section', () => {
  assert.deepEqual(pick(0), { from: 0, to: 2, anchor: 0 });
  assert.deepEqual(pick(2), { from: 6, to: 8, anchor: 2 });
  assert.deepEqual(pick('all'), { from: 0, to: 11, anchor: 0 });
});

test('Shift+click takes the inclusive span in list order (AC1, AC3)', () => {
  // click Intro, Shift+click Part B → Intro + Part A + Part B
  const span = pick(2, { extend: true, anchor: 0, from: 0, to: 2 });
  assert.deepEqual(span, { from: 0, to: 8, anchor: 0 });
  assert.deepEqual(sectionsCovered(song.sections, span.from, span.to), [0, 1, 2]);
  assert.ok(sectionOn(song.sections, span.from, span.to, 0));
  assert.ok(sectionOn(song.sections, span.from, span.to, 1));
  assert.ok(sectionOn(song.sections, span.from, span.to, 2));
  assert.equal(sectionOn(song.sections, span.from, span.to, 3), false);
});

test('Shift+click backwards is the same inclusive span', () => {
  const span = pick(0, { extend: true, anchor: 2, from: 6, to: 8 });
  assert.deepEqual(span, { from: 0, to: 8, anchor: 2 });
  assert.deepEqual(sectionsCovered(song.sections, span.from, span.to), [0, 1, 2]);
});

test('a later Shift+click keeps the original anchor (still contiguous)', () => {
  // after Intro→Part B, Shift+click Theme stretches from Intro, not from Part B
  const span = pick(3, { extend: true, anchor: 0, from: 0, to: 8 });
  assert.deepEqual(span, { from: 0, to: 11, anchor: 0 });
  assert.deepEqual(sectionsCovered(song.sections, span.from, span.to), [0, 1, 2, 3]);
});

test('a plain click after a range collapses to that one section (AC2)', () => {
  const next = pick(3, { extend: false, anchor: 0, from: 0, to: 8 });
  assert.deepEqual(next, { from: 9, to: 11, anchor: 3 });
  assert.ok(sectionOn(song.sections, next.from, next.to, 3));
  assert.equal(sectionOn(song.sections, next.from, next.to, 0), false);
  assert.equal(sectionOn(song.sections, next.from, next.to, 1), false);
});

test('there is no way to pick a disconnected pair', () => {
  // Shift+click "skips" nothing: Intro + Theme still includes Part A and Part B
  const span = sectionSpan(song.sections, 0, 3);
  assert.deepEqual(span, { from: 0, to: 11, start: 0, end: 3 });
  assert.deepEqual(sectionsCovered(song.sections, span.from, span.to), [0, 1, 2, 3]);
  // a bar range that is not section-aligned lights no chips
  assert.equal(sectionAligned(song.sections, 1, 7), false);
  assert.equal(sectionOn(song.sections, 1, 7, 0), false);
  assert.equal(sectionOn(song.sections, 1, 7, 1), false);
});

test('an unset anchor infers the start of the current aligned span', () => {
  assert.equal(rangeAnchor(song.sections, 0, 2, null), 0);
  assert.equal(rangeAnchor(song.sections, 3, 8, null), 1);   // Part A through Part B
  assert.equal(rangeAnchor(song.sections, 4, 7, null), 1);   // bar inside Part A
  assert.equal(rangeAnchor(song.sections, 0, 2, 2), 2);      // stored wins
});

test('section chips and the ruler follow an aligned span', () => {
  assert.equal(rangeTitle(song.sections, 0, 2), 'Intro');
  assert.equal(rangeTitle(song.sections, 0, 8), 'Intro – Part B');
  assert.equal(rangeTitle(song.sections, 1, 4), 'Intro');    // not aligned: first section at from
  assert.ok(wholeSongOn(0, 11, 12));
  assert.equal(wholeSongOn(0, 8, 12), false);
  assert.equal(sectionAt(song.sections, 7), 2);
});
