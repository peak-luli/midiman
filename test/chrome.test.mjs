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

test('the always-on Guide is never hidden for a listen step', () => {
  const app = read('src/learn/app.js');
  assert.match(app, /el\.guide\.hidden = false/, 'laptop unhides the bar Guide');
  assert.doesNotMatch(app, /el\.guide\.hidden\s*=\s*s\.kind/, 'listen must not hide the bar Guide');
  const mob = read('src/learn/mobile.js');
  assert.doesNotMatch(mob, /guideBtn\.hidden|el\.guide\.hidden/, 'phone has no hide of the bar Guide');
});

test('Options sits above the hands dock so View/Wait stay tappable', () => {
  const css = read('learn.css');
  const z = sel => {
    const re = sel.replace(/[.#]/g, '\\$&');
    const m = css.match(new RegExp(re + '\\{[^}]*z-index:(\\d+)'));
    assert.ok(m, `${sel} has a z-index`);
    return +m[1];
  };
  const chrome = z('#learnChrome');
  assert.ok(z('.optsScrim') > chrome, 'scrim above #learnChrome');
  assert.ok(z('.optsSheet') > chrome, 'sheet above #learnChrome');
});

test('phone hands chips are not torn down on a same-hands heartbeat', () => {
  const mob = read('src/learn/mobile.js');
  assert.match(mob, /shownHands/, 'paintHands remembers what it last drew');
  assert.match(mob, /key === shownHands/, 'same hands skip the rewrite');
  assert.match(mob, /for \(const btn of host\.children\) btn\.classList\.toggle/,
    'a real hand change toggles, it does not replace the nodes');
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
