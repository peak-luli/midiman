// The #44 gates: click or Space between steps; a piano note never starts one.
//
// Both Learn pages import these, so the lock lives here rather than in two copies
// of the same `if`. Changing the rule without changing this file is the bug.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { INTENT, NOTE, TIMER, mayAdvance, mayStart } from '../src/learn/gate.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = f => readFileSync(resolve(root, f), 'utf8');

test('a piano note never starts a waiting step and never advances the handoff', () => {
  assert.equal(mayStart(NOTE), false);
  assert.equal(mayAdvance(NOTE), false);
});

test('Space or Start still starts, and still moves on from the done card', () => {
  assert.equal(mayStart(INTENT), true);
  assert.equal(mayAdvance(INTENT), true);
});

test('time passing never advances; there is no auto-start between steps', () => {
  assert.equal(mayAdvance(TIMER), false);
  assert.equal(mayStart(TIMER), false);
});

test('both Learn pages consult the gate and do not run a done-card countdown', () => {
  for (const f of ['src/learn/app.js', 'src/learn/mobile.js']) {
    const src = read(f);
    assert.match(src, /from '\.\/gate\.js'/, `${f} imports the #44 gate`);
    assert.match(src, /mayStart\(NOTE\)/, `${f} asks before a note can start`);
    assert.match(src, /mayAdvance\(NOTE\)/, `${f} asks before a note can advance`);
    const body = src.slice(src.indexOf('function stepDone'), src.indexOf('\nfunction cancelCountdown'));
    assert.ok(body.length > 40, `${f} has a stepDone the test can see`);
    assert.ok(!body.includes('setInterval'), `${f} stepDone must not auto-advance`);
    assert.ok(!body.includes('COUNTDOWN'), `${f} stepDone has no countdown`);
  }
});
