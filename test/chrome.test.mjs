// Learn chrome after I15 / #54: phone keeps the always-on bottom bar;
// laptop Learn is desktop chrome again (transport on #bar, Feedback in the
// sidebar). The pages have no build step, so a drift here is a different
// layout at the piano.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = f => readFileSync(join(ROOT, f), 'utf8');

const PHONE = 'learn-m.html';
const DESK = 'learn.html';
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

function topBar(html) {
  return html.match(/<div id="bar">([\s\S]*?)<\/div>\s*<div id="work">/)?.[1];
}

test('phone has the always-on bar in Wait · Loop · metronome icon · Guide · Feedback order', () => {
  const html = read(PHONE);
  const bar = barOf(html);
  const ids = [...bar.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(ids.filter(id => BAR_IDS.includes(id)), BAR_IDS, 'phone bar order');
  assert.match(bar, />Wait</);
  assert.match(bar, />Loop</);
  assert.match(bar, /id="metroBtn"[^>]*aria-label="Metronome"/);
  assert.match(bar, /<svg class="learnIco"/);
  assert.match(bar, />Guide</);
  assert.match(bar, />Feedback</);
  assert.doesNotMatch(bar, /Options/, 'phone Options menu is gone');
  assert.doesNotMatch(bar, /Click/, 'phone metronome must not say Click');
  assert.doesNotMatch(bar, />Metronome</, 'phone metronome is icon-only — no word label');
});

test('phone puts views on the top with BPM, not in a menu or the bottom bar', () => {
  const html = read(PHONE);
  const bar = barOf(html);
  const top = html.match(/<header id="topbar">([\s\S]*?)<\/header>/)?.[1];
  assert.ok(top, 'phone has a top chrome strip');
  assert.match(top, /id="viewSeg"/);
  assert.match(top, /data-view="staff"/);
  assert.match(top, /data-view="roll"/);
  assert.match(top, /data-view="fall"/);
  assert.match(top, /data-view="scroll"/);
  assert.match(top, />Staff</);
  assert.match(top, />Roll</);
  assert.match(top, />Falling</);
  assert.match(top, />Scroll</);
  assert.match(top, /id="bpmv"/, 'phone views sit with BPM');
  assert.match(top, /class="[^"]*topRight/, 'phone BPM + views are right-aligned');
  assert.doesNotMatch(bar, /id="viewSeg"|data-view=/);
  assert.doesNotMatch(html, /id="optsSheet"|id="optsBtn"|id="optsScrim"/);
});

test('phone keeps hands above the bar, not inside it', () => {
  const html = read(PHONE);
  const { start, bar } = chromeSlice(html);
  const dock = html.indexOf('id="handsDock"', start);
  assert.ok(dock >= 0 && dock < bar, 'handsDock sits above #learnBar');
  const slice = html.slice(start, bar);
  assert.match(slice, /id="lhDock"/);
  assert.match(slice, /id="rhDock"/);
  assert.doesNotMatch(barOf(html), /lhDock|rhDock|handsDock/);
});

test('desktop Learn does not use the phone always-on bottom bar', () => {
  const html = read(DESK);
  assert.doesNotMatch(html, /id="learnChrome"/, 'desktop has no #learnChrome');
  assert.doesNotMatch(html, /id="learnBar"/, 'desktop has no #learnBar');
  assert.doesNotMatch(html, /id="handsDock"|id="lhDock"|id="rhDock"/, 'desktop has no phone hands dock');
  assert.doesNotMatch(html, /class="learnBar"/, 'desktop does not paint the phone bar');
});

test('desktop Learn keeps Feedback one-tap in the sidebar, not on a phone bar', () => {
  const html = read(DESK);
  const side = html.match(/<div id="setbox">([\s\S]*?)<\/div>\s*<\/div>\s*<main>/)?.[1];
  assert.ok(side, 'desktop has the lesson sidebar setbox');
  assert.match(side, /id="fbBtn"/, 'Feedback is in the sidebar');
  assert.match(side, />💬 Feedback</, 'Feedback is labeled and visible');
  const top = topBar(html);
  assert.ok(top, 'desktop has a top transport bar');
  assert.doesNotMatch(top, /id="fbBtn"/, 'Feedback is not the top-bar primary chrome');
});

test('desktop Learn puts Wait · Loop · Click on the top bar, Guide in the lesson column', () => {
  const html = read(DESK);
  const top = topBar(html);
  assert.ok(top, 'desktop has #bar');
  assert.match(top, /id="waitBtn"/);
  assert.match(top, /id="loopBtn"/);
  assert.match(top, /id="metroBtn"/);
  assert.match(top, />⏸ Wait for me</);
  assert.match(top, />↻ Loop</);
  assert.match(top, />● Click</);
  assert.doesNotMatch(top, /id="guideBtn"/, 'Guide is not a phone-bar item on the transport');
  assert.match(html, /id="tutor"[\s\S]*id="guideBtn"/, 'tutor Guide is in the lesson column');
  assert.match(html, /id="guideBtn2"/, 'free-practice Guide stays in the lesson column');
});

test('desktop views stay top-right with BPM', () => {
  const html = read(DESK);
  const top = topBar(html);
  assert.ok(top, 'desktop has a top chrome strip');
  assert.match(top, /id="viewSeg"/);
  assert.match(top, />Staff</);
  assert.match(top, />Roll</);
  assert.match(top, />Falling</);
  assert.match(top, />Scroll</);
  assert.match(top, /id="bpmv"/, 'desktop views sit with BPM');
  assert.match(top, /class="[^"]*topRight/, 'desktop BPM + views are right-aligned');
});

test('the guide volume sits with the tempo: a slider beside Speed, a stepper beside Guide', () => {
  const desk = read(DESK);
  const top = topBar(desk);
  assert.match(top, /id="gvol"[\s\S]*id="guideVol"[\s\S]*id="guideVolv"[\s\S]*id="speed"/,
    'desktop: the guide level is a slider with a typed readout, before Speed');
  const phone = read(PHONE);
  const bar = barOf(phone);
  assert.match(bar, /id="guideBtn"[\s\S]*id="guideVolDn"[\s\S]*id="guideVolv"[\s\S]*id="guideVolUp"[\s\S]*id="fbBtn"/,
    'phone: a −/+ stepper right after Guide in the always-on bar');
  assert.match(phone, /id="bpmUp2"[\s\S]*id="guideVolDn2"[\s\S]*id="guideVolUp2"/,
    'phone: and one in the free-practice sheet, with the tempo stepper');
  const css = read('learn-m.css').replace(/\s+/g, '');
  assert.match(css, /\.stepper\[hidden\]\{display:none\}/, 'a hidden stepper is hidden, flex or not');
});

for (const page of [DESK, PHONE]) {
  test(`${page} has no volume control in Learn chrome`, () => {
    const html = read(page);
    assert.doesNotMatch(html, /id="volume"|id="volumev"|id="mvol"|id="vol"/);
    assert.doesNotMatch(html, />Volume</);
  });
}

test('Feedback stays a one-tap mount on both pages', () => {
  for (const [mod, page, device] of [['src/learn/app.js', DESK, 'laptop'],
                                     ['src/learn/mobile.js', PHONE, 'phone']]) {
    const src = read(mod);
    assert.match(src, /mountFeedback\(/, `${mod} still mounts Feedback`);
    assert.match(src, new RegExp(`device: '${device}'`));
    const html = read(page);
    assert.match(html, /id="fbBtn"/, `${page} has the Feedback button`);
    if (page === PHONE) assert.match(barOf(html), /id="fbBtn"/, 'phone Feedback stays on the always-on bar');
    else assert.match(html, /id="setbox"[\s\S]*id="fbBtn"/, 'laptop Feedback stays in the sidebar');
  }
});

test('the always-on phone Guide is never hidden for a listen step', () => {
  const app = read('src/learn/app.js');
  assert.match(app, /el\.guide\.hidden = s\.kind === 'listen'/, 'laptop hides lesson Guide on listen');
  const mob = read('src/learn/mobile.js');
  assert.doesNotMatch(mob, /guideBtn\.hidden|el\.guide\.hidden/, 'phone has no hide of the bar Guide');
});

test('top chrome: BPM readout is left-aligned; view-options height matches BPM', () => {
  const flat = s => s.replace(/\s+/g, '');
  const desk = flat(read('learn.css'));
  const phone = flat(read('learn-m.css'));
  // phone: the stepper slot, not the free-practice sheet
  assert.match(phone, /#topbar\.stepper\.bpmv\{[^}]*text-align:left/,
    'phone BPM value/label is left-aligned in its slot');
  assert.match(phone, /#topbar#viewSeg\{height:40px\}/);
  assert.match(phone, /#topbar#viewSegbutton\{height:40px/);
  assert.match(phone, /\.stepper\{[^}]*height:40px/, 'stepper box is 40px — view chips match it');
  // laptop: same rules, Learn-scoped so Practice/Looper keep a right-aligned readout
  assert.match(desk, /body\.learn#speedb\{text-align:left\}/);
  assert.match(desk, /body\.learn#speed\{min-height:30px\}/);
  assert.match(desk, /body\.learn#viewSeg\.seg\{min-height:30px/);
  assert.match(desk, /body\.learn#bar\.topRight\{[^}]*align-items:stretch/,
    'laptop Speed and view chips share one row height');
});

// Nothing in the laptop transport bar may move because the state changed. Play,
// Pause and Resume are three widths of the same button, and the readouts beside it
// say different-length things while you play -- so the buttons whose label changes
// are sized for the longest word, and the readouts get a box rather than a floor.
// The failure this stops is the bar shuffling sideways under a pianist's eyes at the
// exact moment they press pause to read a bar.
test('the laptop transport bar keeps its geometry when the state changes', () => {
  const html = read(DESK);
  const app = read('src/learn/app.js');
  const flat = s => s.replace(/\s+/g, '');
  const learn = flat(read('learn.css'));
  const style = flat(read('style.css'));
  const top = topBar(html);

  // which buttons in the bar have a label that app.js rewrites? el.<name> -> id
  const names = new Map([...app.matchAll(/(\w+): \$\('([^']+)'\)/g)].map(m => [m[2], m[1]]));
  const barButtons = [...top.matchAll(/<button id="([^"]+)"/g)].map(m => m[1]);
  const changing = barButtons.filter(id =>
    new RegExp(`el\\.${names.get(id)}\\.textContent\\s*=`).test(app));
  assert.deepEqual(changing, ['play'],
    `bar buttons whose label changes: ${changing.join(', ')} -- each needs a reserved width`);

  // ...and it is reserved at the width of the longest of the three words
  assert.match(learn, /body\.learn#bar#play,body\.learn#bar#stopBtn\{min-width:94px\}/,
    'Play / Pause / Resume are one width, measured on the widest');
  for (const label of ['▶ Play', '⏸ Pause', '▶ Resume']) assert.ok(app.includes(label), label);

  // the readouts: a width, not a floor, and what will not fit is clipped
  assert.match(learn, /body\.learn#pos\{width:192px;flex:00auto;white-space:nowrap;overflow:hidden;text-overflow:ellipsis\}/);
  assert.match(style, /#played\{[^}]*width:100px;flex:00auto/);
  assert.match(learn, /body\.learn#played\{width:128px\}/);
  assert.match(style, /#played\{[^}]*overflow:hidden;text-overflow:ellipsis/);
  assert.doesNotMatch(style, /#played\{[^}]*min-width/, 'a floor is what let ten notes stretch the row');
  // and the tutor aside's Start step, which cycles the same three words, is a block
  // in a stretched column: its width is the column's, so its label moves nothing
  assert.match(learn, /#tutor,#free\{display:flex;flex-direction:column/);
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
