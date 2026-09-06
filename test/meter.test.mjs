// The challenge meter: after a clean pass 1 the ✓ stays on slot 0 and the
// current-pass chrome moves to slot 1 (#46). Live fill is due/total so the bar
// keeps moving through the pass (#48). An update that omits `live` still marks
// the current slot active, but does not wipe a slot that is already filling.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slotStates, makeMeter } from '../src/learn/meter.js';
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

test('when live has a total, the fill is how far through the pass', () => {
  const slots = slotStates(passes, 2, {
    results: [],
    live: { due: 3, hits: 3, total: 24, pct: 1 },
  });
  assert.equal(slots[0].text, '100%');
  assert.equal(slots[0].width, '13%');
  const mid = slotStates(passes, 2, {
    results: [],
    live: { due: 12, hits: 9, total: 24, pct: 0.75 },
  });
  assert.equal(mid[0].text, '75%');
  assert.equal(mid[0].width, '50%');
});

function mini() {
  const kids = [];
  const node = {
    tagName: 'DIV',
    className: '',
    innerHTML: '',
    style: {},
    textContent: '',
    children: kids,
    appendChild(c) { kids.push(c); },
    querySelector(sel) {
      if (sel === 'i' || sel === '.sbar i') return this._bar;
      if (sel === '.sval') return this._val;
      if (sel === '.slabel') return this._label;
      return null;
    },
  };
  node._bar = { style: { width: '0%' } };
  node._val = { textContent: '–' };
  node._label = { textContent: '' };
  return node;
}

if (typeof globalThis.document === 'undefined') {
  globalThis.document = { createElement: () => mini() };
}

function slotsOf(el) {
  return el.children.map(s => ({ cls: s.className, width: s._bar.style.width, val: s._val.textContent }));
}

test('a live update without a live tally does not wipe a slot that is already filling', () => {
  const el = mini();
  const meter = makeMeter(el);
  meter.set(CHALLENGES.passes, 2);
  meter.update({ results: [], live: { due: 8, hits: 6, total: 16, pct: 0.75 } });
  assert.equal(slotsOf(el)[0].val, '75%');
  assert.equal(slotsOf(el)[0].width, '50%');
  assert.match(slotsOf(el)[0].cls, /live/);

  meter.update({ results: [] });
  assert.equal(slotsOf(el)[0].val, '75%', 'omitted live must not reset the running pass to –');
  assert.equal(slotsOf(el)[0].width, '50%');
  assert.match(slotsOf(el)[0].cls, /live/);
  assert.equal(slotsOf(el)[1].val, '–');
});

test('when live is given, the current slot keeps tracking through later notes', () => {
  const el = mini();
  const meter = makeMeter(el);
  meter.set(CHALLENGES.passes, 2);
  meter.update({ results: [], live: { due: 3, hits: 3, total: 24, pct: 1 } });
  assert.equal(slotsOf(el)[0].val, '100%');
  assert.equal(slotsOf(el)[0].width, '13%');
  meter.update({ results: [], live: { due: 12, hits: 9, total: 24, pct: 0.75 } });
  assert.equal(slotsOf(el)[0].val, '75%');
  assert.equal(slotsOf(el)[0].width, '50%');
});
