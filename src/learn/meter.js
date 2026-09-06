// The challenge meter: where you are on the way to the step's goal, updated on
// every tick while you loop. A "passes" challenge is one slot per required pass --
// finished passes are ✓ or ✗, the running one fills with the live hit rate of the
// notes that have come due so far. A "window" challenge is a single slot with the
// hit rate over the last N seconds, which turns ✓ the moment it reaches the target.
//
// The slots are built once per challenge and then only mutated, because this runs
// forty times a second under a playhead.
//
// The current pass is always the slot after the finished streak -- even when the
// caller has no live tally yet (a snapshot, the step chrome refresh, the first
// ticks after a wrap). Leaving that slot idle is what kept PASS 1/2 looking
// current after a clean pass 1: the only chrome on the row stayed on the ✓.

const pct = v => Math.round(v * 100) + '%';

/**
 * What each slot should show. `n` is how many slots the challenge built.
 *
 * results: the finished passes of the current streak ({ ok, accuracy });
 * live:    liveOf() for the running pass, or null when nothing is running;
 * win:     windowStats() for a window challenge.
 */
export function slotStates(ch, n, { results = [], live = null, win = null, done = false } = {}) {
  if (!ch || ch.kind === 'none' || n < 1) return [];
  if (ch.kind === 'window') {
    if (done) return [{ cls: 'ok done', width: '100%', text: '✓' }];
    if (!win || !win.due) return [{ cls: 'idle', width: '0%', text: '–' }];
    const ok = win.pct >= ch.accuracy && win.due >= ch.minDue;
    return [{ cls: ok ? 'ok' : 'live', width: pct(win.pct), text: pct(win.pct) }];
  }
  const out = Array.from({ length: n }, () => ({ cls: 'idle', width: '0%', text: '–' }));
  results.forEach((r, i) => {
    if (i >= n) return;
    out[i] = {
      cls: r.ok ? 'ok done' : 'no done',
      width: pct(r.accuracy ?? 1),
      text: (r.ok ? '✓ ' : '✗ ') + pct(r.accuracy ?? 1),
    };
  });
  const cur = results.length;
  // a failed pass ends the streak: hold it in red, do not start counting the next
  if (done || cur >= n || results.some(r => !r.ok)) return out;
  // the next slot is the current pass even before a note is due, and even when
  // the caller omitted `live` -- otherwise a heartbeat paints it idle and the
  // finished slot keeps the only border on the row
  if (!live || !live.due) {
    out[cur] = { cls: 'live', width: '0%', text: '–' };
    return out;
  }
  out[cur] = {
    cls: live.pct >= ch.accuracy ? 'ok live' : 'live',
    width: pct(live.pct),
    text: pct(live.pct),
  };
  return out;
}

export function makeMeter(el) {
  let ch = null, slots = [];

  function build(challenge, n) {
    ch = challenge;
    el.innerHTML = '';
    slots = [];
    if (!ch || ch.kind === 'none') return;
    for (let i = 0; i < n; i++) {
      const s = document.createElement('div');
      s.className = 'slot';
      s.innerHTML = '<span class="slabel"></span><div class="sbar"><i></i></div><b class="sval">–</b>';
      // "Pass 1/2", not "Pass 1": a slot has to say how many the step wants as well as
      // which one it is, because the meter is often the only thing being looked at
      s.querySelector('.slabel').textContent = ch.kind === 'window' ? `last ${ch.seconds} s`
        : n > 1 ? `Pass ${i + 1}/${n}` : `Pass ${i + 1}`;
      el.appendChild(s);
      slots.push({ el: s, bar: s.querySelector('i'), val: s.querySelector('.sval') });
    }
  }

  function paint(i, cls, width, text) {
    const s = slots[i];
    if (!s) return;
    s.el.className = 'slot ' + cls;
    s.bar.style.width = width;
    s.val.textContent = text;
  }

  return {
    /** Lay out the slots for a challenge. `n` overrides the pass count. */
    set(challenge, n = challenge?.n ?? 1) { build(challenge, n); },

    /**
     * results: the finished passes of the current streak ({ ok, accuracy });
     * live:    liveOf() for the running pass, or null when nothing is running;
     * win:     windowStats() for a window challenge.
     */
    update(arg = {}) {
      if (!ch || ch.kind === 'none') return;
      for (const [i, s] of slotStates(ch, slots.length, arg).entries())
        paint(i, s.cls, s.width, s.text);
    },
  };
}
