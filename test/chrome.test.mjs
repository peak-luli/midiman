// I15: one Learn chrome system on laptop and phone.
// The pages have no build step, so the bar order, Options contents, and Feedback
// button have to live in the HTML the same way on both — a drift here is a
// different layout at the piano.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = f => readFileSync(join(ROOT, f), 'utf8');

const PAGES = ['learn.html', 'learn-m.html'];
const BAR_IDS = ['optsBtn', 'loopBtn', 'metroBtn', 'guideBtn', 'fbBtn'];

function barOf(html) {
  const m = html.match(/<nav id="learnBar"[^>]*>([\s\S]*?)<\/nav>/);
  assert.ok(m, 'page has #learnBar');
  return m[1];
}

function sheetOf(html) {
  const m = html.match(/<aside id="optsSheet"[\s\S]*?<\/aside>/);
  assert.ok(m, 'page has #optsSheet');
  return m[0];
}

function chromeSlice(html) {
  const start = html.indexOf('id="learnChrome"');
  const bar = html.indexOf('id="learnBar"', start);
  assert.ok(start >= 0 && bar > start, 'page has #learnChrome wrapping the bar');
  return { start, bar, html };
}

for (const page of PAGES) {
  test(`${page} has the shared always-on bar in Options · Loop · metronome icon · Guide · Feedback order`, () => {
    const html = read(page);
    const bar = barOf(html);
    const ids = [...bar.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]);
    assert.deepEqual(ids.filter(id => BAR_IDS.includes(id)), BAR_IDS, `${page} bar order`);
    assert.match(bar, />Options</);
    assert.match(bar, />Loop</);
    assert.match(bar, /id="metroBtn"[^>]*aria-label="Metronome"/);
    assert.match(bar, /<svg class="learnIco"/);
    assert.match(bar, />Guide</);
    assert.match(bar, />Feedback</);
    assert.doesNotMatch(bar, /Click/, `${page} metronome must not say Click`);
    assert.doesNotMatch(bar, />Metronome</, `${page} metronome is icon-only — no word label`);
  });

  test(`${page} puts views and Wait in Options, not on the always-on bar`, () => {
    const html = read(page);
    const sheet = sheetOf(html);
    const bar = barOf(html);
    assert.match(sheet, /id="viewSeg"/);
    assert.match(sheet, /data-view="staff"/);
    assert.match(sheet, /data-view="roll"/);
    assert.match(sheet, /data-view="fall"/);
    assert.match(sheet, /data-view="scroll"/);
    assert.match(sheet, /id="waitBtn"/);
    assert.doesNotMatch(bar, /id="viewSeg"|id="waitBtn"/);
    assert.doesNotMatch(bar, />Staff<|>Roll<|>Falling<|>Scroll<|>Wait</);
  });

  test(`${page} keeps hands above the bar, not inside it`, () => {
    const html = read(page);
    const { start, bar } = chromeSlice(html);
    const dock = html.indexOf('id="handsDock"', start);
    assert.ok(dock >= 0 && dock < bar, 'handsDock sits above #learnBar');
    const slice = html.slice(start, bar);
    assert.match(slice, /id="lhDock"/);
    assert.match(slice, /id="rhDock"/);
    assert.doesNotMatch(barOf(html), /lhDock|rhDock|handsDock/);
  });
}

test('Feedback stays a one-tap mount on the bar', () => {
  for (const [mod, page, device] of [['src/learn/app.js', 'learn.html', 'laptop'],
                                     ['src/learn/mobile.js', 'learn-m.html', 'phone']]) {
    const src = read(mod);
    assert.match(src, /mountFeedback\(/, `${mod} still mounts Feedback`);
    assert.match(src, new RegExp(`device: '${device}'`));
    const html = read(page);
    assert.match(barOf(html), /id="fbBtn"/, `${page} Feedback is on the always-on bar`);
    assert.doesNotMatch(sheetOf(html), /id="fbBtn"/, 'Feedback is not buried in Options');
  }
});

test('the wiring does not stop the loop when Options opens', () => {
  for (const mod of ['src/learn/app.js', 'src/learn/mobile.js']) {
    const src = read(mod);
    assert.match(src, /function setOpts\(/);
    const block = src.match(/function setOpts\([\s\S]*?\n\}/)[0];
    for (const forbidden of ['.stop(', '.play(', 'setMode', 'halt('])
      assert.ok(!block.includes(forbidden), `${mod} setOpts must not ${forbidden}`);
  }
});
