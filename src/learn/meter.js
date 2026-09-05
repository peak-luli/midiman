// The challenge meter: where you are on the way to the step's goal, updated on
// every tick while you loop. A "passes" challenge is one slot per required pass --
// finished passes are ✓ or ✗, the running one fills with the live hit rate of the
// notes that have come due so far. A "window" challenge is a single slot with the
// hit rate over the last N seconds, which turns ✓ the moment it reaches the target.
//
// The slots are built once per challenge and then only mutated, because this runs
// forty times a second under a playhead.

export function makeMeter(el) {
  let ch = null, slots = [];
  const pct = v => Math.round(v * 100) + '%';

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
    update({ results = [], live = null, win = null, done = false } = {}) {
      if (!ch || ch.kind === 'none') return;
      if (ch.kind === 'window') {
        if (done) return paint(0, 'ok done', '100%', '✓');
        if (!win || !win.due) return paint(0, 'idle', '0%', '–');
        const ok = win.pct >= ch.accuracy && win.due >= ch.minDue;
        paint(0, ok ? 'ok' : 'live', pct(win.pct), pct(win.pct));
        return;
      }
      // a finished pass keeps its percentage on show: green with a tick, or red --
      // and a red one ends the streak, so nothing counts live until it is cleared
      results.forEach((r, i) => paint(i, r.ok ? 'ok done' : 'no done', pct(r.accuracy ?? 1),
                                       (r.ok ? '✓ ' : '✗ ') + pct(r.accuracy ?? 1)));
      const cur = results.length;
      for (let i = cur; i < slots.length; i++) paint(i, 'idle', '0%', '–');
      if (done || cur >= slots.length || !live || results.some(r => !r.ok)) return;
      if (!live.due) return paint(cur, 'live', '0%', '–');
      paint(cur, live.pct >= ch.accuracy ? 'ok live' : 'live', pct(live.pct), pct(live.pct));
    },
  };
}
