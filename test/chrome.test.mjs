// I15: one Learn chrome system on laptop and phone.
// The pages have no build step, so the bar order, top-right views, and Feedback
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
const BAR_IDS = ['waitBtn', 'loopBtn', 'metroBtn', 'guideBtn', 'fbBtn'];

function barOf(html) {
  const m = html.match(/<nav id="learnBar"[^>]*>([\s\S]*?)<\/nav>/);
  assert.ok(m, 'page has #learnBar');
  return m[1];
}

function chromeSlice(html) {
  const start = html.indexOf('id="learnChrome"');
  const bar = html.indexOf('id="learnBar"', start);
  assert.ok(start >= 0 && bar > start, 'page has #learnChrome wrapping the bar');
  return { start, bar, html };
}

for (const page of PAGES) {
  test(`${page} has the shared always-on bar in Wait · Loop · metronome icon · Guide · Feedback order`, () => {
    const html = read(page);
    const bar = barOf(html);
    const ids = [...bar.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]);
    assert.deepEqual(ids.filter(id => BAR_IDS.includes(id)), BAR_IDS, `${page} bar order`);
    assert.match(bar, />Wait</);
    assert.match(bar, />Loop</);
    assert.match(bar, /id="metroBtn"[^>]*aria-label="Metronome"/);
    assert.match(bar, /<svg class="learnIco"/);
    assert.match(bar, />Guide</);
    assert.match(bar, />Feedback</);
    assert.doesNotMatch(bar, /Options/, `${page} Options menu is gone`);
    assert.doesNotMatch(bar, /Click/, `${page} metronome must not say Click`);
    assert.doesNotMatch(bar, />Metronome</, `${page} metronome is icon-only — no word label`);
  });

  test(`${page} puts views on the top with BPM, not in a menu or the bottom bar`, () => {
    const html = read(page);
    const bar = barOf(html);
    const top = page === 'learn.html'
      ? html.match(/<div id="bar">([\s\S]*?)<\/div>\s*<div id="work">/)?.[1]
      : html.match(/<header id="topbar">([\s\S]*?)<\/header>/)?.[1];
    assert.ok(top, `${page} has a top chrome strip`);
    assert.match(top, /id="viewSeg"/);
    assert.match(top, /data-view="staff"/);
    assert.match(top, /data-view="roll"/);
    assert.match(top, /data-view="fall"/);
    assert.match(top, /data-view="scroll"/);
    assert.match(top, />Staff</);
    assert.match(top, />Roll</);
    assert.match(top, />Falling</);
    assert.match(top, />Scroll</);
    assert.match(top, /id="bpmv"/, `${page} views sit with BPM`);
    assert.match(top, /class="[^"]*topRight/, `${page} BPM + views are right-aligned`);
    assert.doesNotMatch(bar, /id="viewSeg"|data-view=/);
    assert.doesNotMatch(html, /id="optsSheet"|id="optsBtn"|id="optsScrim"/);
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

  test(`${page} has no volume control in Learn chrome`, () => {
    const html = read(page);
    assert.doesNotMatch(html, /id="volume"|id="volumev"|id="mvol"|id="vol"/);
    assert.doesNotMatch(html, />Volume</);
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
  }
});

test('the always-on Guide is never hidden for a listen step', () => {
  const app = read('src/learn/app.js');
  assert.match(app, /el\.guide\.hidden = false/, 'laptop unhides the bar Guide');
  assert.doesNotMatch(app, /el\.guide\.hidden\s*=\s*s\.kind/, 'listen must not hide the bar Guide');
  const mob = read('src/learn/mobile.js');
  assert.doesNotMatch(mob, /guideBtn\.hidden|el\.guide\.hidden/, 'phone has no hide of the bar Guide');
});

test('Learn chrome wiring has no Options menu and no volume slider bind', () => {
  for (const mod of ['src/learn/app.js', 'src/learn/mobile.js']) {
    const src = read(mod);
    assert.doesNotMatch(src, /function setOpts\(|optsBtn|optsSheet|bindVolumeSlider/);
  }
});

test('phone hands chips are not torn down on a same-hands heartbeat', () => {
  const mob = read('src/learn/mobile.js');
  assert.match(mob, /shownHands/, 'paintHands remembers what it last drew');
  assert.match(mob, /key === shownHands/, 'same hands skip the rewrite');
  assert.match(mob, /for \(const btn of host\.children\) btn\.classList\.toggle/,
    'a real hand change toggles, it does not replace the nodes');
});
