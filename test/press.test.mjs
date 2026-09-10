// The phone's one transport button: tap plays, pauses and picks up again; a hold
// stops. Everything here is about what must *not* happen -- a scroll that begins on
// the button is not a Stop, a hold is not also a tap, and the click the browser
// sends after a press is that press arriving a second time.
//
// The machine takes its timers, so this runs on a clock that never actually waits.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { makePress, HOLD_MS, SLOP, CLICK_MS } from '../src/learn/press.js';

/** setTimeout / clearTimeout with the clock in the test's hands. */
function fakeTimers() {
  let now = 0, id = 0;
  const jobs = new Map();
  return {
    setTimer: (fn, ms) => { jobs.set(++id, { at: now + ms, fn }); return id; },
    clearTimer: i => jobs.delete(i),
    tick(ms) {
      now += ms;
      for (const [i, j] of [...jobs].sort((a, b) => a[1].at - b[1].at)) {
        if (j.at <= now) { jobs.delete(i); j.fn(); }
      }
    },
    get pending() { return jobs.size; },
  };
}

function harness(opts = {}) {
  const log = [];
  const t = fakeTimers();
  const press = makePress({
    tap: () => log.push('tap'),
    hold: () => log.push('stop'),
    cue: on => log.push(on ? 'cue on' : 'cue off'),
    setTimer: t.setTimer, clearTimer: t.clearTimer,
    ...opts,
  });
  return { press, log, t, down: (x = 100, y = 100) => press.down({ clientX: x, clientY: y, button: 0 }),
           move: (x, y = 100) => press.move({ clientX: x, clientY: y }) };
}

test('a press held for half a second stops, once', () => {
  const { press, log, t, down } = harness();
  down();
  assert.deepEqual(log, ['cue on'], 'the fill starts crossing straight away');
  assert.equal(press.holding, true);
  t.tick(HOLD_MS - 1);
  assert.deepEqual(log, ['cue on'], 'and nothing has happened yet');
  t.tick(1);
  assert.deepEqual(log, ['cue on', 'cue off', 'stop']);
  assert.equal(press.holding, false);
  // letting go of a press that already stopped is not also a tap, and no amount of
  // waiting afterwards fires a second one
  press.up();
  t.tick(10_000);
  assert.deepEqual(log, ['cue on', 'cue off', 'stop']);
  assert.equal(t.pending, 0, 'and nothing is left ticking');
});

test('a press let go of early is a tap', () => {
  const { press, log, t, down } = harness();
  down();
  t.tick(300);
  assert.deepEqual(log, ['cue on'], 'three hundred milliseconds is not a hold');
  press.up();
  assert.deepEqual(log, ['cue on', 'cue off', 'tap']);
  t.tick(10_000);
  assert.deepEqual(log, ['cue on', 'cue off', 'tap'], 'and the hold never arrives after it');
});

test('a press that wanders off is neither: a scroll cannot stop the practice', () => {
  const { press, log, t, down, move } = harness();
  down(100, 100);
  move(100 + SLOP, 100);                          // still inside the slop: nothing yet
  assert.deepEqual(log, ['cue on']);
  move(100 + SLOP + 4, 100);
  assert.deepEqual(log, ['cue on', 'cue off'], 'the fill snaps back');
  t.tick(HOLD_MS * 4);
  assert.deepEqual(log, ['cue on', 'cue off'], 'no stop');
  press.up();
  assert.deepEqual(log, ['cue on', 'cue off'], 'and no tap on the way up either');
});

test('the click a handled press leaves behind is swallowed', () => {
  // a completed hold
  const a = harness();
  a.down(); a.t.tick(HOLD_MS); a.press.up();
  assert.equal(a.press.click(), true, 'the click after a long press is not a second command');
  assert.deepEqual(a.log, ['cue on', 'cue off', 'stop']);

  // a tap: the press already fired it on the way up
  const b = harness();
  b.down(); b.t.tick(120); b.press.up();
  assert.equal(b.press.click(), true);
  assert.deepEqual(b.log, ['cue on', 'cue off', 'tap'], 'exactly one tap');

  // a press that wandered off takes its click with it
  const c = harness();
  c.down(); c.move(400); c.press.up();
  assert.equal(c.press.click(), true);
  assert.deepEqual(c.log, ['cue on', 'cue off']);

  // and a click with no press behind it -- Space on the focused button, a headless
  // check calling .click() -- is a tap the page still has to make
  const d = harness();
  assert.equal(d.press.click(), false);
  // ...including one that arrives long after a press has been forgotten
  const e = harness();
  e.down(); e.t.tick(120); e.press.up();
  e.t.tick(CLICK_MS + 1);
  assert.equal(e.press.click(), false, 'the swallow does not outlive the press');
});

test('the system taking the pointer away is not a command', () => {
  const { press, log, t, down } = harness();
  down();
  press.cancel();
  assert.deepEqual(log, ['cue on', 'cue off']);
  assert.equal(press.click(), true, 'and the click it may still send is dropped');
  t.tick(HOLD_MS * 2);
  assert.deepEqual(log, ['cue on', 'cue off'], 'the hold it was waiting for never lands');
});

test('a right or middle button press is not this button', () => {
  const { press, log, t } = harness();
  press.down({ clientX: 1, clientY: 1, button: 2 });
  t.tick(HOLD_MS * 2);
  press.up();
  assert.deepEqual(log, []);
});

// The page has to actually be wired to it, and the fill has to be told the same
// number the timer uses -- a cue that finishes early is a promise the press breaks.
test('the phone wires its one button to the press machine', () => {
  const js = readFileSync(new URL('../src/learn/mobile.js', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../learn-m.css', import.meta.url), 'utf8');
  assert.match(js, /makePress\(\{\s*tap: onStartControl,\s*hold: \(\) => halt\(\),/);
  assert.match(js, /cue: on => btn\.classList\.toggle\('holding', on\)/);
  assert.match(js, /btn\.style\.setProperty\('--hold-ms', `\$\{HOLD_MS\}ms`\)/,
    "the fill is given the machine's own duration");
  for (const ev of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) {
    assert.match(js, new RegExp(`btn\\.addEventListener\\('${ev}'`), ev);
  }
  assert.match(js, /addEventListener\('scroll', \(\) => transport\.cancel\(\)/,
    'a page moving under the finger calls the hold off');
  assert.match(js, /if \(transport\.click\(\)\) e\.preventDefault\(\); else onStartControl\(\)/);
  assert.match(css, /#startBtn\.holding \.hold\{width:100%;transition:width var\(--hold-ms,500ms\) linear\}/);
});
