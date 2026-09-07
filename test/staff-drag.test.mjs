// Staff drag sets the loop to every whole bar the span touches. A click with no
// drag still only seeks. The math is the product rule (always whole bars); the
// wiring check is so a later edit cannot silently put seek-on-pointerdown back
// on the staff, or drop the live highlight.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { barsTouched } from '../src/learn/staff.js';

const read = f => readFileSync(new URL('../' + f, import.meta.url), 'utf8');

test('a point selection is the bar that contains it', () => {
  // loop = song bars 0–15 (16 bars, 64 beats)
  assert.deepEqual(barsTouched(0, 0, 0, 64), [0, 0]);
  assert.deepEqual(barsTouched(3.9, 3.9, 0, 64), [0, 0]);
  assert.deepEqual(barsTouched(4, 4, 0, 64), [1, 1]);
  assert.deepEqual(barsTouched(16.2, 16.2, 0, 64), [4, 4]);
});

test('a span includes every half-open bar it overlaps, not the next bar line', () => {
  // [0, 4] is exactly bar 0; the point at 4 is the start of bar 1 and is not a touch
  assert.deepEqual(barsTouched(0, 4, 0, 64), [0, 0]);
  assert.deepEqual(barsTouched(0, 4.01, 0, 64), [0, 1]);
  assert.deepEqual(barsTouched(2, 6, 0, 64), [0, 1]);
  // ~bar 4 → ~bar 9 (loop-relative beats 16–37 sit inside those bars)
  assert.deepEqual(barsTouched(16, 37, 0, 64), [4, 9]);
  // drag to the bar line after bar 9: still bars 4–9
  assert.deepEqual(barsTouched(16, 40, 0, 64), [4, 9]);
  // reverse drag is the same range
  assert.deepEqual(barsTouched(37, 16, 0, 64), [4, 9]);
});

test('bars are song indices, so a loop that is not the whole song still shrinks', () => {
  // current loop is song bars 4–11 (8 bars); drag the first three of those
  assert.deepEqual(barsTouched(0, 11, 4, 32), [4, 6]);
  assert.deepEqual(barsTouched(4, 20, 4, 32), [5, 8]);
  // a drag that stays in one loop bar shrinks to that bar
  assert.deepEqual(barsTouched(4.2, 6.8, 4, 32), [5, 5]);
});

test('the end of the loop is the last bar, never a phantom bar past it', () => {
  assert.deepEqual(barsTouched(0, 64, 0, 64), [0, 15]);
  assert.deepEqual(barsTouched(60, 64, 0, 64), [15, 15]);
  assert.deepEqual(barsTouched(-2, 70, 0, 64), [0, 15]);
});

test('laptop staff drag commits whole bars on release and previews them live', () => {
  const app = read('src/learn/app.js');
  const staff = read('src/learn/staff.js');
  const css = read('learn.css');
  const html = read('learn.html');
  assert.match(app, /import \{ makeStaff, barsTouched \}/);
  assert.match(app, /viewName === 'staff'/);
  assert.match(app, /previewLoop/);
  assert.match(app, /view\.pickRange\?/);
  assert.match(app, /classList\.toggle\('pick'/);
  assert.match(app, /finishStaffDrag/);
  assert.match(app, /setRange\(lo, hi\)/);
  // a click with no drag still only seeks — the loop is not touched
  assert.match(app, /engine\.seek\(start\)/);
  assert.match(app, /if \(moved\) \{/);
  // pointerdown on the staff must not seek (that would fire on a drag-to-loop).
  // Seek stays on the other views, and on the staff only after a click-up.
  const down = app.slice(app.indexOf("el.rollcanvas.addEventListener('pointerdown'"));
  const staffDown = down.slice(0, down.indexOf("el.rollcanvas.addEventListener('pointerup'"));
  assert.match(staffDown, /viewName === 'staff'/);
  assert.match(staffDown, /staffDrag = \{[\s\S]*return;\s*\}\s*engine\.seek\(b\)/);
  assert.match(staff, /export function barsTouched/);
  assert.match(staff, /function pickRange/);
  assert.match(staff, /e\.className = 'spick'/);
  assert.match(css, /\.staff \.spick/);
  assert.match(css, /#strip \.bar\.pick/);
  assert.match(html, /drag across the staff/);
});

test('phone staff has no drag-to-loop yet', () => {
  const phone = read('src/learn/mobile.js');
  assert.doesNotMatch(phone, /pickRange/);
  assert.doesNotMatch(phone, /barsTouched/);
  assert.doesNotMatch(phone, /previewLoop/);
});
