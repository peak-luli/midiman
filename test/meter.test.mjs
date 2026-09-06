// The challenge meter: a snapshot or step-chrome refresh that omitted `live`
// used to paint the running slot idle (0% / –). That is the freeze — ticks had
// filled it, then a heartbeat wiped it. Leaving the current slot alone when
// live is missing is the whole of this file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMeter } from '../src/learn/meter.js';
import { CHALLENGES } from '../src/learn/scorer.js';

function mini(tag = 'div') {
  const kids = [];
  const node = {
    tagName: tag.toUpperCase(),
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

  // the heartbeat / syncTutor path: results only, no live
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
  assert.equal(slotsOf(el)[0].width, '13%');          // fill is due/total, not the hit rate
  meter.update({ results: [], live: { due: 12, hits: 9, total: 24, pct: 0.75 } });
  assert.equal(slotsOf(el)[0].val, '75%');
  assert.equal(slotsOf(el)[0].width, '50%');
});
