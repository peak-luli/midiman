// The challenge meter: after a clean pass 1 the ✓ stays on slot 0 and the
// current-pass chrome moves to slot 1. The bug this file exists for: a snapshot
// or a step-chrome refresh that omitted `live` painted the rest idle, so PASS 1/2
// kept the only border on the row while the pianist was already on pass 2.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slotStates } from '../src/learn/meter.js';
import { CHALLENGES } from '../src/learn/scorer.js';

const passes = CHALLENGES.passes;
const ok = accuracy => ({ ok: true, accuracy });
const no = accuracy => ({ ok: false, accuracy });

test('after pass 1 succeeds, pass 2 is live even when the caller sent no live tally', () => {
  const slots = slotStates(passes, 2, { results: [ok(1)] });
  assert.deepEqual(slots.map(s => s.cls), ['ok done', 'live']);
  assert.equal(slots[0].text, '✓ 100%');
  assert.equal(slots[1].text, '–');
});

test('live progress fills the current pass, never the one that just finished', () => {
  const slots = slotStates(passes, 2, {
    results: [ok(1)],
    live: { due: 4, hits: 4, pct: 1 },
  });
  assert.deepEqual(slots.map(s => s.cls), ['ok done', 'ok live']);
  assert.equal(slots[0].text, '✓ 100%');
  assert.equal(slots[1].text, '100%');
  assert.equal(slots[1].width, '100%');
});

test('with no finished result, live belongs on pass 1 — that is pass 1 still running', () => {
  const slots = slotStates(passes, 2, { results: [], live: { due: 8, hits: 8, pct: 1 } });
  assert.equal(slots[0].cls, 'ok live');
  assert.equal(slots[0].text, '100%');
  assert.equal(slots[1].cls, 'idle');
});

test('once the streak records pass 1, that leftover live moves to pass 2', () => {
  const slots = slotStates(passes, 2, {
    results: [ok(1)],
    live: { due: 8, hits: 8, pct: 1 },
  });
  assert.deepEqual(slots.map(s => s.cls), ['ok done', 'ok live']);
});

test('a failed pass is held in red and does not start counting pass 2', () => {
  const slots = slotStates(passes, 2, { results: [ok(0.9), no(0.4)] });
  assert.deepEqual(slots.map(s => s.cls), ['ok done', 'no done']);
  assert.equal(slots[1].text, '✗ 40%');
});

test('a finished step keeps the ticks and does not mark a next slot live', () => {
  const slots = slotStates(passes, 2, { results: [ok(0.9), ok(0.95)], done: true });
  assert.deepEqual(slots.map(s => s.cls), ['ok done', 'ok done']);
});

test('before any pass, an omitted live still marks pass 1 as the current one', () => {
  const slots = slotStates(passes, 2, { results: [] });
  assert.deepEqual(slots.map(s => s.cls), ['live', 'idle']);
});
