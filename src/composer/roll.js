// The composer's piano roll: Learn's roll, made editable.
//
// It is deliberately a second file rather than a flag on `learn/roll.js`. Learn's roll
// is read-only and on the scoring path -- hit and miss colours, wait cursors, a phone
// mirroring it -- and none of that should have to think about a drag. What is shared
// is the *look*: the same class names, so `learn.css` styles this one too, and the same
// `rollBeat` for turning a pointer into a beat.
//
// The gestures are the whole point, so the arithmetic that decides what a drag *means*
// is a pure function (`gestureOf`) that never touches the DOM: it can be tested, and
// the handlers below stay small enough to read.

import { rollBeat } from '../learn/roll.js';
import { gridUnit } from './edit.js';
import { beatsPerBarOf, barsOf } from './piece.js';

const SVG = 'http://www.w3.org/2000/svg';
const BLACK = [1, 3, 6, 8, 10];
const EDGE_PX = 6;               // how close to a note's right end is "the edge"
const SLOP_PX = 4;               // a pointer that moved less than this did not drag

const mk = (tag, attrs = {}) => {
  const e = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
};

const snapTo = (b, unit) => Math.round(b / unit) * unit;

/** The bars a drag across empty space touches, as a half-open beat range. */
export function barRange(b0, b1, bpb) {
  const lo = Math.min(b0, b1), hi = Math.max(b0, b1);
  return { from: Math.floor(lo / bpb) * bpb, to: (Math.floor(hi / bpb) + 1) * bpb };
}

/**
 * What a pointer gesture means, in musical units and nothing else.
 *
 * `start` is where the pointer went down: `{ b, n, idx, noteB, noteLen, edge }` --
 * `idx` is the note under it (null over empty space) and `edge` says the pointer was
 * on that note's right end. `now` is where it came up: `{ b, n }`.
 *
 *   over a note   click  -> pick it        drag -> move it (snapped) and/or repitch it
 *                 edge drag -> set its length (snapped, never shorter than one unit)
 *   over nothing  click  -> insert one grid unit there
 *                 drag   -> select the bars it crossed
 */
export function gestureOf(start, now, { grid = '1/8', bpb = 4, moved = true } = {}) {
  const unit = gridUnit(grid);
  if (start.idx == null) {
    if (!moved) return { kind: 'insert', b: Math.floor(start.b / unit) * unit, n: start.n };
    return { kind: 'range', ...barRange(start.b, now.b, bpb) };
  }
  if (start.edge && moved)
    return { kind: 'len', idx: start.idx, len: Math.max(unit, snapTo(now.b - start.noteB, unit)) };
  if (!moved) return { kind: 'pick', idx: start.idx };
  return {
    kind: 'drag', idx: start.idx,
    // the drag is measured from where the note is, not from where the pointer grabbed
    // it, so a note picked up off-centre still lands on the grid
    dBeats: snapTo(start.noteB + (now.b - start.b), unit) - start.noteB,
    dSemis: now.n - start.n,
  };
}

/**
 * @param el         the pane to draw into.
 * @param onGesture  called with a `gestureOf` result when a gesture completes.
 */
export function makeRoll(el, { onGesture = () => {} } = {}) {
  let svg = null, lo = 36, hi = 84, len = 4, bpb = 4, W = 200, H = 120;
  let BW = 48, RH = 7;
  let piece = null, notesG = null, head = null, selBox = null, hover = null;
  const rects = [];                       // note index -> rect
  let drag = null;

  const x = b => b * BW;
  const y = n => (hi - n) * RH;
  const beatOfX = px => rollBeat(px, W, len);
  const noteOfY = py => hi - Math.floor(py / RH);

  /** The topmost note under a point, and whether the point is on its right edge. */
  function hit(b, n) {
    for (let i = rects.length - 1; i >= 0; i--) {
      const note = piece.notes[i];
      if (note.n !== n) continue;
      if (b < note.b - 1e-6 || b > note.b + note.len + 1e-6) continue;
      return { idx: i, noteB: note.b, noteLen: note.len, edge: x(note.b + note.len) - x(b) <= EDGE_PX };
    }
    return { idx: null, noteB: 0, noteLen: 0, edge: false };
  }

  function render(p, { sel = null, picked = null } = {}) {
    piece = p;
    bpb = beatsPerBarOf(p);
    len = Math.max(bpb, barsOf(p) * bpb);
    const ns = p.notes.map(n => n.n);
    lo = Math.min(48, ...ns) - 2; hi = Math.max(72, ...ns) + 2;
    W = Math.max(200, el.clientWidth); H = Math.max(120, el.clientHeight);
    BW = W / len; RH = H / (hi - lo + 1);

    el.innerHTML = '';
    svg = mk('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, class: 'roll' });
    el.appendChild(svg);

    const bg = mk('g', { class: 'rbg' });
    for (let n = lo; n <= hi; n++) {
      if (BLACK.includes(((n % 12) + 12) % 12))
        bg.appendChild(mk('rect', { x: 0, y: y(n), width: W, height: RH, class: 'rblack' }));
      if (n % 12 === 0)
        bg.appendChild(mk('line', { x1: 0, x2: W, y1: y(n) + RH, y2: y(n) + RH, class: 'rc' }));
    }
    // the grid is the piece's own: quantise to sixteenths and the roll says so
    // ...but only while its lines are far enough apart to read as a grid
    const step = x(gridUnit(p.grid)) >= 5 ? gridUnit(p.grid) : 1;
    for (let b = 0; b <= len + 1e-9; b += step) {
      const cls = Math.abs(b % bpb) < 1e-9 ? 'rbar' : Math.abs(b % 1) < 1e-9 ? 'rbeat' : 'rsub';
      bg.appendChild(mk('line', { x1: x(b), x2: x(b), y1: 0, y2: H, class: cls }));
    }
    svg.appendChild(bg);

    selBox = mk('rect', { x: 0, y: 0, width: 0, height: H, class: 'rsel', hidden: '' });
    svg.appendChild(selBox);

    notesG = mk('g'); svg.appendChild(notesG);
    rects.length = 0;
    p.notes.forEach((n, i) => {
      const r = mk('rect', {
        x: x(n.b) + 0.5, y: y(n.n) + 0.6, rx: 2,
        width: Math.max(4, x(n.len) - 1.5), height: Math.max(3, RH - 1.2),
        class: `rn ${n.hand}${picked === i ? ' sel' : ''}`,
      });
      notesG.appendChild(r);
      rects[i] = r;
    });

    hover = mk('rect', { x: 0, y: 0, width: 0, height: 0, class: 'rghost', hidden: '' });
    svg.appendChild(hover);
    head = mk('line', { x1: 0, x2: 0, y1: 0, y2: H, class: 'rhead' });
    svg.appendChild(head);
    showSel(sel);
  }

  /** The selection wash: a time range, dimmed on a hand that is not in it. */
  function showSel(sel) {
    if (!selBox) return;
    if (!sel) { selBox.setAttribute('hidden', ''); for (const r of rects) r?.classList.remove('out'); return; }
    selBox.removeAttribute('hidden');
    selBox.setAttribute('x', x(sel.from));
    selBox.setAttribute('width', Math.max(2, x(sel.to - sel.from)));
    piece?.notes.forEach((n, i) => {
      const inSel = n.b >= sel.from - 1e-9 && n.b < sel.to - 1e-9 && (sel.hands ?? ['lh', 'rh']).includes(n.hand);
      rects[i]?.classList.toggle('out', !inSel);
    });
  }

  // ---------------------------------------------------------------- gestures
  const at = e => {
    const r = svg.getBoundingClientRect();
    return {
      px: e.clientX - r.left, py: e.clientY - r.top,
      b: Math.max(0, Math.min(len, beatOfX((e.clientX - r.left) * (W / r.width)))),
      n: Math.max(0, Math.min(127, noteOfY((e.clientY - r.top) * (H / r.height)))),
    };
  };

  function down(e) {
    if (!svg || !piece || e.button) return;
    const p = at(e);
    drag = { ...p, ...hit(p.b, p.n), x0: e.clientX, y0: e.clientY, moved: false };
    svg.setPointerCapture?.(e.pointerId);
    e.preventDefault();
  }

  function move(e) {
    if (!drag || !svg) return;
    const p = at(e);
    drag.moved ||= Math.abs(e.clientX - drag.x0) > SLOP_PX || Math.abs(e.clientY - drag.y0) > SLOP_PX;
    if (!drag.moved) return;
    // the preview is the gesture itself, drawn: what will happen on release
    const g = gestureOf(drag, p, { grid: piece.grid, bpb, moved: true });
    if (g.kind === 'range') {
      showSel({ from: g.from, to: g.to });
    } else if (g.kind === 'drag') {
      const n = piece.notes[g.idx];
      ghost(n.b + g.dBeats, n.n + g.dSemis, n.len);
    } else if (g.kind === 'len') {
      const n = piece.notes[g.idx];
      ghost(n.b, n.n, g.len);
    }
  }

  function up(e) {
    if (!drag || !svg) return;
    const p = at(e);
    const g = gestureOf(drag, p, { grid: piece.grid, bpb, moved: drag.moved });
    drag = null;
    hover?.setAttribute('hidden', '');
    onGesture(g);
  }

  function ghost(b, n, l) {
    if (!hover) return;
    hover.removeAttribute('hidden');
    hover.setAttribute('x', x(b) + 0.5);
    hover.setAttribute('y', y(n) + 0.6);
    hover.setAttribute('width', Math.max(4, x(l) - 1.5));
    hover.setAttribute('height', Math.max(3, RH - 1.2));
  }

  el.addEventListener('pointerdown', down);
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', () => { drag = null; hover?.setAttribute('hidden', ''); });

  return {
    render, showSel,
    get loopLen() { return len; },
    /** The beat a client x sits on -- the page uses it for "split at the playhead". */
    beatAt(cx) {
      if (!svg) return 0;
      const r = svg.getBoundingClientRect();
      return Math.max(0, Math.min(len, rollBeat(cx - r.left, r.width, len)));
    },
    playhead(beat, countIn) {
      if (!head) return;
      const b = Math.max(0, Math.min(len, beat));
      head.setAttribute('x1', x(b)); head.setAttribute('x2', x(b));
      head.classList.toggle('off', beat < 0 && !countIn);
    },
  };
}
