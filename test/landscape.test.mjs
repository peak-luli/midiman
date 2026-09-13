// The phone sideways is a music stand, and a music stand is mostly music. These
// checks hold the playing screen to that: two strips of chrome, the stage between
// them, nothing that scrolls, and a key strip that costs the staff nothing until it
// is asked for. They are CSS and markup facts, read off the files, so a later edit
// cannot quietly put a third row back -- the layout this replaces had four rows of
// chrome and an 80px staff, and every one of those rows was added for a reason.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = f => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const flat = s => s.replace(/\s+/g, '');
const html = read('learn-m.html');
const css = read('learn-m.css');
const js = read('src/learn/mobile.js');
const fcss = flat(css);
/** The body of a `@media (...)` block, flattened. */
const media = q => {
  const i = fcss.indexOf(`@media(${q})`);
  assert.ok(i >= 0, `learn-m.css has a ${q} block`);
  let depth = 0, j = fcss.indexOf('{', i);
  for (; j < fcss.length; j++) { if (fcss[j] === '{') depth++; else if (fcss[j] === '}' && --depth === 0) break; }
  return fcss.slice(i, j + 1);
};
const px = (rule, prop) => +(new RegExp(`${rule.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\{[^}]*${prop}:(\\d+)px`).exec(fcss)?.[1] ?? NaN);

test('sideways the playing screen is three rows: a bar, the stage, a strip', () => {
  const play = html.match(/<section id="play"[\s\S]*?<\/section>/)[0];
  // the direct children of #play, in order, by id
  const rows = [...play.matchAll(/^  <(?:header|div) id="([^"]+)"/gm)].map(m => m[1]);
  assert.deepEqual(rows, ['topbar', 'midibar', 'stagewrap', 'card', 'mkb', 'learnChrome']);
  // the transport sits in the bar over the music, beside the title
  const top = play.match(/<header id="topbar">([\s\S]*?)<\/header>/)[1];
  assert.match(top, /id="startBtn"/, 'the transport is in the top bar');
  assert.match(top, /id="viewBtn"[\s\S]*id="viewMenu"[\s\S]*id="viewSeg"[\s\S]*id="zoomSeg"/,
    'the view is one button with a menu under it');
  // the meter and the toggles share the strip under the music
  const chrome = play.match(/<div id="learnChrome">([\s\S]*?)<nav id="learnBar"/)[1];
  assert.match(chrome, /id="bottombar">\s*<div id="meterrow">/, 'the meter leads the bottom strip');
  assert.match(chrome, /id="waitbox"/, 'and the wait readouts take its place in wait mode');
  const bar = play.match(/<nav id="learnBar"[^>]*>([\s\S]*?)<\/nav>/)[1];
  assert.match(bar, /id="keysBtn"[\s\S]*>Keys</, 'the key strip has a button');
  assert.match(bar, /id="guideBtn"[\s\S]*id="keysBtn"[\s\S]*id="fbBtn"/, 'between Guide and Feedback');
});

test('the chrome around the music adds up to a third of a phone sideways, at most', () => {
  const top = px('#topbar', 'height'), strip = px('#bottombar', 'min-height');
  const stageGap = px('#stagewrap', 'margin'), chromeGap = px('.mob#learnChrome', 'margin');
  assert.equal(top, 48);
  assert.equal(strip, 56);
  const chrome = top + stageGap + strip + chromeGap;
  assert.ok(chrome <= 130, `${chrome}px of chrome on a 390px screen`);
  // which leaves the stage at least 250px of an iPhone 13 sideways with the home
  // indicator paid for -- three times what it had, and two thirds of the screen
  const stage = 390 - 21 - chrome;
  assert.ok(stage >= 250, `${stage}px of stage`);
  // the tall meter row and the 96px key strip are gone from the flow
  assert.doesNotMatch(fcss, /#meterrow\{[^}]*height:52px/);
  assert.doesNotMatch(fcss, /--mkbh:96px/);
});

test('the playing screen never scrolls', () => {
  // each screen is the box the browser is showing, not a guess at it in vh
  assert.match(fcss, /\.screen\{position:fixed;inset:0;/);
  assert.doesNotMatch(css, /\.screen\{[^}]*100(?:vh|svh|dvh)/, 'no viewport unit on the screen box');
  assert.match(fcss, /#home,#path,#play,#sheet\{overflow:hidden\}/, 'the playing screen clips');
  // the strips are not a page: a finger that moves on one is not a scroll
  assert.match(fcss, /#topbar,#learnChrome,#mkb\{touch-action:none\}/);
  // what still scrolls, scrolls inside itself
  assert.match(fcss, /#pathList,\.sbody,\.cbox,\.mob\.fbsheet,\.mob\.staff\.sinner\{overscroll-behavior:contain\}/);
  assert.match(fcss, /html,body\{[^}]*overflow:hidden[^}]*overscroll-behavior:none/);
  // the notch's insets are paid by the strips, so the stage keeps its height
  const land = media('orientation:landscape');
  assert.match(land, /#play\{padding-left:0;padding-right:0\}/);
  assert.match(land, /#topbar\{padding-left:max\(2px,calc\(var\(--sal\)-4px\)\);padding-right:max\(6px,var\(--sar\)\)\}/);
});

test('the key strip is off sideways until asked for, thin when it is, and always there upright', () => {
  const land = media('orientation:landscape'), port = media('orientation:portrait');
  assert.match(fcss, /:root\{--mkbh:40px;/, 'sideways the strip is 40px');
  assert.match(land, /body\.mob:not\(\.keyson\)#mkb\{display:none\}/);
  assert.match(port, /:root\{--mkbh:64px\}/, 'upright it is 64px');
  assert.match(port, /#keysBtn\{display:none\}/, 'and there is nothing to toggle upright');
  assert.doesNotMatch(land, /#mkb\{display:block/, 'the strip is not forced on sideways');
  // the falling view's keys are the target the bars land on: their own height
  assert.match(fcss, /body\.mob\{--kbh:64px\}/);
  assert.match(fcss, /body\.mob\.fallview#keysBtn\{display:none\}/);
  // wired: a remembered setting, a body class, and a redraw because the stage moved
  assert.match(js, /const KEYS_KEY = 'middleman\.learn\.mkeys'/);
  assert.match(js, /document\.body\.classList\.toggle\('keyson', on\)/);
  assert.match(js, /el\.keysBtn\.onclick = \(\) => setKeys\(!keysOn\)/);
  assert.match(js, /function setKeys\(on\) \{[\s\S]*?requestAnimationFrame\(redraw\)/);
  assert.match(js, /readSetting\(KEYS_KEY, '0'\) === '1'/, 'off by default');
});

test('the view menu names the view and carries the zoom stops of the strip', () => {
  assert.match(js, /const ZOOM_KEY = 'middleman\.learn\.mzoom'/);
  assert.match(js, /makeScroll\(panes\.scroll, \{ zoom: readSetting\(ZOOM_KEY, DEFAULT_ZOOM\) \}\)/);
  assert.match(js, /views\.scroll\.setZoom\(name\)/);
  assert.match(js, /el\.viewLabel\.textContent = b\.textContent/, 'the button says which view this is');
  assert.match(js, /el\.zoomSeg\.classList\.toggle\('na', name !== 'scroll'\)/, 'the zoom is greyed off the strip');
  assert.match(js, /showViewMenu\(false\)/);
  // the popover hangs under the bar; the bar's own rows keep the 40px the chrome test pins
  assert.match(fcss, /#viewMenu\{position:absolute;right:6px;top:calc\(100%\+4px\);z-index:60;/);
  assert.match(fcss, /#topbar\{position:relative;/, 'the bar anchors it');
  assert.doesNotMatch(fcss, /#topbar\{[^}]*overflow:hidden/, 'and does not clip it');
  for (const z of ['big', 'balanced', 'far']) assert.match(html, new RegExp(`data-zoom="${z}"`));
});

test('sideways the status is a dot and the wait readouts stack, so the strip is one line', () => {
  const land = media('orientation:landscape');
  assert.match(land, /#midiPlay\{width:10px;height:10px;[^}]*border-radius:50%;[^}]*font-size:0;/);
  assert.match(land, /#midiPlay\.bad\{background:var\(--accent\)\}/);
  assert.match(fcss, /#waitbox>div\{display:flex;flex-direction:column;/, 'label over value, in both orientations');
  assert.match(fcss, /#waitbox\.whint\{display:none\}/);
  assert.match(fcss, /#startBtn\{width:118px;height:40px;min-height:40px;/, 'the transport is a fixed box in the bar');
});
