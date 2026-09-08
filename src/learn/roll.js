// The piano roll: the loop's bars left to right, pitch bottom to top, one bar of
// notes per hand in its own colour. It is an SVG stretched to the panel, so nothing
// with text lives inside it -- bar numbers go in the strip above.

const SVG = 'http://www.w3.org/2000/svg';
// px per beat and per semitone: set per render from the panel's size, so the
// viewBox is the panel's own pixel box and the SVG is never scaled non-uniformly
// (Chrome's compositor stalls on a stretched SVG; headless never paints one at all)
let BW = 48, RH = 7;
const BLACK = [1, 3, 6, 8, 10];

/** Where a point across the roll falls in the loop: time is linear in x, so it is a ratio. */
export const rollBeat = (x, width, loopLen) => (x / width) * loopLen;

const mk = (tag, attrs = {}) => {
  const e = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
};

export function makeRoll(el) {
  let svg = null, lo = 36, hi = 84, loopLen = 4;
  let notesG = null, marksG = null, head = null, hover = null, cursorBox = null, countBox = null;
  const rects = new Map();                     // song note -> rect
  let beatLines = [];                          // beat number in the loop -> its line

  const x = b => b * BW;
  const y = n => (hi - n) * RH;

  function render(song, from, to, swung) {
    const bpb = song.beatsPerBar ?? 4;
    loopLen = (to - from + 1) * bpb;
    const inRange = song.notes.filter(n => n.bar >= from && n.bar <= to);
    const ns = inRange.map(n => n.n);
    lo = Math.min(48, ...ns) - 2; hi = Math.max(72, ...ns) + 2;
    const cw = Math.max(200, el.clientWidth), ch = Math.max(120, el.clientHeight);
    BW = cw / loopLen; RH = ch / (hi - lo + 1);
    const W = cw, H = ch;

    el.innerHTML = '';
    svg = mk('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, class: 'roll' });
    el.appendChild(svg);

    const bg = mk('g', { class: 'rbg' });
    for (let n = lo; n <= hi; n++) {
      if (BLACK.includes(n % 12))
        bg.appendChild(mk('rect', { x: 0, y: y(n), width: W, height: RH, class: 'rblack' }));
      if (n % 12 === 0)
        bg.appendChild(mk('line', { x1: 0, x2: W, y1: y(n) + RH, y2: y(n) + RH, class: 'rc' }));
    }
    beatLines = [];
    for (let b = 0; b <= loopLen; b++) {
      const l = mk('line', { x1: x(b), x2: x(b), y1: 0, y2: H, class: b % bpb ? 'rbeat' : 'rbar' });
      bg.appendChild(l);
      beatLines.push(l);
    }
    svg.appendChild(bg);

    countBox = mk('rect', { x: -W, y: 0, width: W, height: H, class: 'rcount', hidden: '' });
    svg.appendChild(countBox);
    cursorBox = mk('rect', { x: 0, y: 0, width: Math.max(6, BW / 4), height: H, class: 'rcursor', hidden: '' });
    svg.appendChild(cursorBox);

    notesG = mk('g'); svg.appendChild(notesG);
    rects.clear();
    for (const n of inRange) {
      const b = swung(n.b) - from * bpb;
      const r = mk('rect', {
        x: x(b) + 0.5, y: y(n.n) + 0.6, rx: 2,
        width: Math.max(4, x(n.len) - 1.5), height: Math.max(3, RH - 1.2),
        class: `rn ${n.hand}`,
      });
      notesG.appendChild(r);
      rects.set(n, r);
    }
    marksG = mk('g'); svg.appendChild(marksG);
    hover = mk('line', { x1: 0, x2: 0, y1: 0, y2: H, class: 'rhover', hidden: '' });
    svg.appendChild(hover);
    head = mk('line', { x1: 0, x2: 0, y1: 0, y2: H, class: 'rhead' });
    svg.appendChild(head);
  }


  return {
    render,
    get loopLen() { return loopLen; },

    /** Dim the hands the app plays or that are off, so your notes stand out. */
    setHands(hands) {
      if (!notesG) return;
      for (const [n, r] of rects) r.classList.toggle('dim', hands[n.hand] !== 'you');
    },

    mark(e, cls) {
      const r = rects.get(e.note);
      if (!r) return;
      r.classList.remove('hit', 'miss');
      if (cls) r.classList.add(cls);
    },

    extra(n, beat) {
      if (!marksG) return;
      const b = Math.max(0, Math.min(loopLen, beat));
      marksG.appendChild(mk('rect', { x: x(b) - 2, y: y(n) + 1, width: 4, height: Math.max(3, RH - 2), class: 'rx' }));
    },

    clearMarks() {
      if (!marksG) return;
      marksG.innerHTML = '';
      for (const r of rects.values()) r.classList.remove('hit', 'miss');
    },

    playhead(beat, countIn) {
      if (!head) return;
      const b = Math.max(0, Math.min(loopLen, beat));
      head.setAttribute('x1', x(b)); head.setAttribute('x2', x(b));
      head.classList.toggle('off', beat < 0 && !countIn);
      if (countIn) countBox.removeAttribute('hidden'); else countBox.setAttribute('hidden', '');
    },

    /** Wait mode: box the onset the app is waiting on. */
    cursor(group) {
      if (!cursorBox) return;
      if (!group) { cursorBox.setAttribute('hidden', ''); return; }
      cursorBox.removeAttribute('hidden');
      cursorBox.setAttribute('x', x(group.b) - 2);
      head.setAttribute('x1', x(group.b)); head.setAttribute('x2', x(group.b));
    },

    /** The loop beat a pointer is over: time runs left to right, so it is all in x. */
    beatAt(cx) {
      if (!svg) return null;
      const r = svg.getBoundingClientRect();
      return Math.max(0, Math.min(loopLen, rollBeat(cx - r.left, r.width, loopLen)));
    },
    /** A faint line where a click would take the playhead. */
    hoverAt(beat) {
      if (!hover) return;
      if (beat == null) { hover.setAttribute('hidden', ''); return; }
      hover.removeAttribute('hidden');
      hover.setAttribute('x1', x(beat)); hover.setAttribute('x2', x(beat));
    },
  };
}
