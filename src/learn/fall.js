// The falling view: notes as bars over their keys, streaming down onto a key strip
// the way video tutorials show it. A bar's bottom edge reaches the hit line exactly
// at the note's onset; the bar then slides on over the key while it sounds, so its
// colour -- green for a hit, red for a miss -- is seen on the key itself.
//
// The view carries its own key strip, because the bars have to sit over the keys
// they belong to and the page's strip lives in another column. It is drawn from
// the clock on every frame the page gives it (playhead), not on the 25 ms tick.

import { renderKeys, paintKeys } from '../keyboard.js';

export const LOOKAHEAD = 3;                    // beats visible above the hit line
const BLACK = [1, 3, 6, 8, 10];
const COL = { lh: '#2f7fd0', rh: '#e8b44a', hit: '#5fbf7a', miss: '#e63d40' };

/** Where a note's bar sits horizontally: over its key, or squeezed at the edge when the strip has no key for it. */
export function fallX(keys, n, width) {
  const k = keys.get(n);
  if (k) return { x: k.left, w: k.width, off: false };
  return n < 36 ? { x: 0, w: 6, off: true } : { x: width - 6, w: 6, off: true };
}

/** y of a loop-relative onset, given the beat the view is at and the canvas geometry. */
export const fallY = (onset, beat, hitY, ppb) => hitY - (onset - beat) * ppb;

/** Its inverse: the onset a point on the canvas is over. Time runs down, so it is all in y. */
export const fallBeat = (y, beat, hitY, ppb) => beat + (hitY - y) / ppb;

export function makeFall(el) {
  let notes = [], loopLen = 4, from = 0, bpb = 4, hands = { lh: 'you', rh: 'you' };
  let W = 0, H = 0, hitY = 0, ppb = 60, keys = new Map();
  let beat = 0, countIn = false, waitGroup = null, hoverBeat = null;
  const status = new Map();                    // song note -> 'hit' | 'miss'
  let extras = [];                             // { n, t }

  el.classList.add('fall');
  const canvas = document.createElement('canvas');
  const kb = document.createElement('div'); kb.className = 'fkeys';
  el.innerHTML = ''; el.append(canvas, kb);
  renderKeys(kb);
  const ctx = canvas.getContext('2d');

  function measure() {
    W = Math.max(200, el.clientWidth); H = Math.max(120, el.clientHeight);
    canvas.width = W; canvas.height = H;
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    const er = el.getBoundingClientRect();
    hitY = kb.getBoundingClientRect().top - er.top;
    ppb = hitY / LOOKAHEAD;
    keys = new Map();
    for (const k of kb.querySelectorAll('[data-n]')) {
      const r = k.getBoundingClientRect();
      keys.set(+k.dataset.n, { left: r.left - er.left, width: r.width, black: BLACK.includes(+k.dataset.n % 12) });
    }
  }

  function render(song, a, to, swung) {
    from = a; bpb = song.beatsPerBar ?? 4; loopLen = (to - from + 1) * bpb;
    notes = song.notes.filter(n => n.bar >= from && n.bar <= to)
      .map(n => ({ note: n, b: swung(n.b) - from * bpb, len: n.len, n: n.n, hand: n.hand }));
    status.clear(); extras = []; beat = 0; countIn = false; waitGroup = null; hoverBeat = null;
    measure();
    draw();
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    const at = waitGroup ? waitGroup.b : beat;
    // beat lines, bar lines brighter, with the bar number
    ctx.font = '11px ui-sans-serif, system-ui, sans-serif';
    for (let k = Math.floor(at) - 4; k <= at + LOOKAHEAD + 1; k++) {
      const y = fallY(k, at, hitY, ppb);
      if (y < -2 || y > H) continue;
      const bar = ((k % bpb) + bpb) % bpb === 0;
      ctx.strokeStyle = bar ? 'rgba(150,160,180,.45)' : 'rgba(120,130,150,.18)';
      ctx.lineWidth = bar ? 1 : .6;
      ctx.beginPath(); ctx.moveTo(0, y + .5); ctx.lineTo(W, y + .5); ctx.stroke();
      if (bar && k >= 0 && k < loopLen) { ctx.fillStyle = 'rgba(150,160,180,.7)'; ctx.fillText(`bar ${from + k / bpb + 1}`, 6, y - 4); }
    }
    // the notes of this pass and the next, so the stream never breaks at the wrap
    for (const pass of [0, 1]) for (const m of notes) {
      const onset = m.b + pass * loopLen;
      const bottom = fallY(onset, at, hitY, ppb), top = bottom - m.len * ppb;
      if (bottom < 0 || top > H) continue;
      const { x, w, off } = fallX(keys, m.n, W);
      const st = pass === 0 ? status.get(m.note) : null;
      const mine = hands[m.hand] === 'you';
      const col = st === 'hit' ? COL.hit : st === 'miss' ? COL.miss : COL[m.hand];
      ctx.globalAlpha = mine ? 1 : .3;
      // above the line: the bar; below it: the same bar, faded, sliding over the key
      const y0 = Math.max(0, top), y1 = Math.min(bottom, hitY);
      if (y1 > y0) { ctx.fillStyle = col; roundRect(x + 1, y0, w - 2, y1 - y0, 3); ctx.fill(); }
      if (bottom > hitY) {
        ctx.globalAlpha = (mine ? .55 : .2);
        const ky0 = Math.max(hitY, top), ky1 = Math.min(H, bottom);
        if (ky1 > ky0) { ctx.fillStyle = col; roundRect(x + 1, ky0, w - 2, ky1 - ky0, 3); ctx.fill(); }
      }
      if (off) { ctx.globalAlpha = 1; ctx.fillStyle = col; ctx.fillText('◂', x + 8, Math.min(H - 4, Math.max(12, bottom))); }
      ctx.globalAlpha = 1;
    }
    // wrong notes flash red on their key
    const now = performance.now();
    extras = extras.filter(e => now - e.t < 400);
    for (const e of extras) {
      const { x, w } = fallX(keys, e.n, W);
      ctx.globalAlpha = 1 - (now - e.t) / 400;
      ctx.fillStyle = COL.miss; roundRect(x + 1, hitY - 18, w - 2, 16, 3); ctx.fill();
      ctx.globalAlpha = 1;
    }
    // where a click would take the playhead: the beat's own line, not the pointer's y
    if (hoverBeat != null) {
      const y = fallY(hoverBeat, at, hitY, ppb);
      ctx.strokeStyle = 'rgba(124,111,224,.55)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(0, y + .5); ctx.lineTo(W, y + .5); ctx.stroke();
    }
    // the hit line; amber while counting in
    ctx.strokeStyle = countIn ? 'rgba(232,180,74,.7)' : 'rgba(255,255,255,.55)';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(0, hitY - .5); ctx.lineTo(W, hitY - .5); ctx.stroke();
    if (waitGroup) {
      ctx.fillStyle = 'rgba(255,255,255,.8)';
      ctx.fillText('waiting for: ' + waitGroup.notes.map(e => e.n).join(' '), 6, hitY - 8);
    }
  }

  function roundRect(x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
  }

  return {
    render,
    setHands(h) { hands = { ...h }; draw(); },
    mark(e, cls) { if (cls) status.set(e.note, cls); else status.delete(e.note); },
    extra(n) { extras.push({ n, t: performance.now() }); draw(); },
    clearMarks() { status.clear(); extras = []; draw(); },
    playhead(b, ci) { beat = b; countIn = !!ci; waitGroup = null; draw(); },
    cursor(group) { waitGroup = group; if (group) draw(); },
    /** The loop beat a pointer is over: here time runs down the view, so it is all in y. */
    beatAt(cx, cy) {
      const at = waitGroup ? waitGroup.b : beat;
      return Math.max(0, Math.min(loopLen, fallBeat(cy - el.getBoundingClientRect().top, at, hitY, ppb)));
    },
    /** A faint line where a click would take the playhead. */
    hoverAt(b) { hoverBeat = b; draw(); },
    /** The view's own key strip, painted like the page's. */
    paintKeys(args) { paintKeys(kb, args); },
    measure,
  };
}
