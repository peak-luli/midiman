// The staff view: the loop's bars engraved on a grand staff with abcjs, coloured
// live like the roll -- a hit notehead goes green, a missed one red.
//
// The song is kept as written (song.cells: rests, ties, tuplets), so the ABC is a
// transcription of the cells rather than a re-quantisation of the notes.
//
// The layout is *proportional to time*, which abcjs does not do and has no option
// for (its only justification knob is `stretchlast`). Engravers space notes by an
// aesthetic curve of their duration, so a playhead that follows the noteheads speeds
// up and slows down between them and the music stops feeling like it has a tempo. So
// abcjs is used for the glyphs only: after it draws, every system is given one grid
// -- bars of equal width, four equal beats each -- and each note, rest and bar line
// is translated to the x its onset asks for (at its *swung* position, so the eighths
// sit where they sound). The playhead is then simply linear in beats.
//
// What that costs, and what is done about it:
//   - a beam is one glyph over several notes and abcjs cannot re-lay it, so after
//     the move abcjs's beams are hidden and redrawn here. Which notes are under a
//     beam is decided by `src/notation/beams.js` -- a bar of cells in, beam groups
//     out -- and the same groups both write the ABC (tokens inside a group are
//     joined with no space, which is how ABC says "beam these") and drive the
//     redraw, so the engraving and the geometry can never disagree.
//   - ties are abcjs's own curves between two engraved x's, so they are hidden and
//     redrawn as plain arcs between the heads once the heads have moved.
//   - a tuplet's bracket cannot be re-spanned; its number is moved with the group.
//
// Redrawing a beam, in three steps (`drawBeams`):
//   1. every note keeps abcjs's stem (`.abcjs-stem`, a filled rect inside the note's
//      own `<g>`, so it moves with the note) and abcjs's choice of stem direction.
//   2. the new beam is the line through the two *outer* stem tips at their new x,
//      with the slope capped, then pushed out far enough that no stem ends up
//      shorter than the one abcjs drew. Secondary beams sit parallel inside it, a
//      beam thickness and a half apart (SMuFL: 0.5 + 0.25 staff spaces); a partial
//      beam is a stub off its own stem.
//   3. every stem in the group is re-cut to end exactly on that line -- abcjs cut
//      them for its own beam, and the slope has changed.
//
// abcjs specifics that shape this file (see also src/notation.js):
//   - add_classes gives every note a `.abcjs-note` with `.abcjs-vN` (voice),
//     `.abcjs-lN` (system) and `.abcjs-mN` (bar within the system); a chord is one
//     `.abcjs-note` holding several `.abcjs-notehead`s; rests are `.abcjs-rest`
//   - the clef/key/time block is `.abcjs-staff-extra`, a bar line `.abcjs-bar`
//   - K: must be last in the header; a blank line ends the tune
//   - a tie is `-` after the first note; inside a chord it goes after each pitch

import { swungBeat } from '../song.js';
import { beamBar } from '../notation/beams.js';

// ---------------------------------------------------------------- key signatures
const FIFTHS = { C: 0, G: 1, D: 2, A: 3, E: 4, B: 5, 'F#': 6, 'C#': 7,
                 F: -1, Bb: -2, Eb: -3, Ab: -4, Db: -5, Gb: -6, Cb: -7 };
const SHARP_ORDER = 'FCGDAEB', FLAT_ORDER = 'BEADGCF';
const MINOR_TO_MAJOR = { Am: 'C', Em: 'G', Bm: 'D', 'F#m': 'A', 'C#m': 'E', 'G#m': 'B',
                         Dm: 'F', Gm: 'Bb', Cm: 'Eb', Fm: 'Ab', Bbm: 'Db', Ebm: 'Gb' };

/** The key signature as letter -> alteration, for a key name like "F", "Bb", "Am". */
export function keySignature(key = 'C') {
  const major = MINOR_TO_MAJOR[key] ?? key;
  const n = FIFTHS[major] ?? 0;
  const sig = {};
  for (const l of 'CDEFGAB') sig[l] = 0;
  if (n > 0) for (let i = 0; i < n; i++) sig[SHARP_ORDER[i]] = 1;
  if (n < 0) for (let i = 0; i < -n; i++) sig[FLAT_ORDER[i]] = -1;
  return { major, n, sig };
}

// how a chromatic pitch class is spelt: sharps or flats, per key family
const SPELL_SHARP = { 1: ['C', 1], 3: ['D', 1], 6: ['F', 1], 8: ['G', 1], 10: ['A', 1] };
const SPELL_FLAT  = { 1: ['C', 1], 3: ['E', -1], 6: ['F', 1], 8: ['A', -1], 10: ['B', -1] };
const NATURAL = { 0: 'C', 2: 'D', 4: 'E', 5: 'F', 7: 'G', 9: 'A', 11: 'B' };

/**
 * MIDI number -> ABC pitch in a key: the letter, an accidental only where it
 * differs from the signature (`=` for a natural that the signature alters), and
 * the octave marks.
 */
export function abcNote(n, ks, sharps) {
  const pc = n % 12;
  let letter, acc;
  if (NATURAL[pc] !== undefined) { letter = NATURAL[pc]; acc = 0; }
  else {
    // prefer the spelling the signature already provides (Bb in F, not A#)
    const cands = [SPELL_FLAT[pc], SPELL_SHARP[pc]].filter(([l, a]) => ks.sig[l] === a);
    [letter, acc] = cands[0] ?? (ks.n < 0 || (ks.n === 0 && !sharps) ? SPELL_FLAT[pc] : SPELL_SHARP[pc]);
  }
  // the octave of the letter, not of the midi number: Cb4 is written on the C4 line
  const midiOfLetter = n - acc;
  const oct = Math.floor(midiOfLetter / 12) - 1;
  const sign = acc === ks.sig[letter] ? '' : acc === 0 ? '=' : acc > 0 ? '^' : '_';
  const name = oct >= 5 ? letter.toLowerCase() + "'".repeat(oct - 5) : letter + ','.repeat(Math.max(0, 4 - oct));
  return sign + name;
}

/** A length in eighths -> ABC length suffix under L:1/8. */
export function abcLen(d) {
  if (Math.abs(d - Math.round(d)) < 1e-9) return d === 1 ? '' : String(Math.round(d));
  if (Math.abs(d * 2 - Math.round(d * 2)) < 1e-9) return d === 0.5 ? '/' : `${Math.round(d * 2)}/2`;
  if (Math.abs(d * 4 - Math.round(d * 4)) < 1e-9) return `${Math.round(d * 4)}/4`;
  return `${Math.round(d * 8)}/8`;
}

/**
 * One voice's bars as ABC. `bars` is song.cells[hand] sliced to the loop; `next`
 * is the first cell after the loop (a tie into it needs the `-`), or null.
 *
 * In ABC a space means "break the beam here" and no space means "beam these
 * together", so the beam plan of `beams.js` becomes literally the spacing of the
 * tokens. Nothing else in the file decides where a beam goes.
 */
export function abcVoice(bars, ks, sharps, next = null) {
  const out = [];
  bars.forEach((bar, bi) => {
    const plan = beamBar(bar);
    const opens = new Map(plan.tuplets.map(t => [t.from, `(${t.p}:${t.q}:${t.p}`]));
    const value = new Map();                      // cell index -> its written value
    for (const t of plan.tuplets) for (let i = t.from; i <= t.to; i++) value.set(i, t.v);
    let line = '';
    for (let i = 0; i < bar.length; i++) {
      const c = bar[i];
      const after = bar[i + 1] ?? bars[bi + 1]?.[0] ?? next;
      const tied = new Set(after?.tie ? after.ns : []);
      const L = abcLen(value.get(i) ?? c.d);
      let body;
      if (!c.ns.length) body = 'z' + L;
      else if (c.ns.length === 1) body = abcNote(c.ns[0], ks, sharps) + L + (tied.has(c.ns[0]) ? '-' : '');
      else {
        const all = c.ns.every(n => tied.has(n));
        body = '[' + c.ns.map(n => abcNote(n, ks, sharps) + (!all && tied.has(n) ? '-' : '')).join('') + ']' + L + (all ? '-' : '');
      }
      line += (i === 0 || plan.joined[i] ? '' : ' ') + (opens.get(i) ?? '') + body;
    }
    out.push(line + ' |');
  });
  return out;
}

/** The whole grand-staff tune for bars [from, to], `cols` bars per system. */
export function buildAbc(song, from, to, cols) {
  const ks = keySignature(song.key);
  const rh = abcVoice(song.cells.rh.slice(from, to + 1), ks, song.sharps, song.cells.rh[to + 1]?.[0] ?? null);
  const lh = abcVoice(song.cells.lh.slice(from, to + 1), ks, song.sharps, song.cells.lh[to + 1]?.[0] ?? null);
  // stretchlast justifies the last (often only) system across the staff width. The
  // layout is re-done from the time grid anyway, but starting closer to it keeps every
  // translation small -- and so keeps anything not moved by hand roughly in place
  const out = ['X:1', 'M:4/4', 'L:1/8', '%%stretchlast 1', '%%score {(V1) (V2)}',
               'V:V1 clef=treble', 'V:V2 clef=bass', `K:${ks.major}`];
  for (let r = 0; r * cols < rh.length; r++) {
    out.push('[V:V1] ' + rh.slice(r * cols, r * cols + cols).join(''));
    out.push('[V:V2] ' + lh.slice(r * cols, r * cols + cols).join(''));
  }
  return out.join('\n');
}

/** How many bars per system: four reads well; short loops fit on one line. */
export const colsFor = nbars => (nbars <= 4 ? nbars : nbars <= 6 ? 3 : 4);

/**
 * The proportional grid of one system: `bars` bars of equal width between `left`
 * and `right`, four equal beats each. `beat` is counted from the system's first bar,
 * so a playhead moving at a constant number of pixels per beat is exactly right.
 * Onsets are handed in already swung, so a shuffled eighth sits where it sounds.
 */
export function systemGrid(left, right, bars) {
  const pxPerBeat = (right - left) / (bars * 4);
  return {
    left, right, bars, pxPerBeat, barW: pxPerBeat * 4,
    x: beat => left + beat * pxPerBeat,
    beat: x => (x - left) / pxPerBeat,
  };
}

// The scrolling strip used to ask abcjs for `(musicSpan + 80) / scale` of staff.
// That 80 was in *scaled* pixels, so the reserve for the clef/key/meter shrank
// as the notes grew: at laptop scale the grid ran off the svg and overflow:hidden
// ate the last note of the loop. These are in svg user units and do not shrink.
const OPEN_UNITS = 140;              // clef + key + meter + pad; leftover is empty
const TRAIL_UNITS = 48;              // room after the last bar for a notehead

/** staffwidth (pre-scale) so the music span still comes out `span` pixels, with
 *  a scale-stable opening and a trailer the last onset can sit in. */
export function stripStaffWidth(span, scale) {
  return span / Math.max(0.3, scale || 1) + OPEN_UNITS + TRAIL_UNITS;
}

/**
 * Pixels past the last bar line so a note whose onset is `fromEnd` beats before
 * the loop end still has its whole head on the strip. City of Stars' vamp lands
 * a D3 on the last eighth: at laptop scale that head is wider than the half-beat
 * plus PAD_RIGHT that used to be there.
 */
export function trailingRoom(fromEnd, { pxPerBeat, headPx, pad, gap = 4 } = {}) {
  const afterOnset = Math.max(0, fromEnd) * (pxPerBeat || 0);
  return Math.max(pad ?? PAD_RIGHT, (headPx || 0) + gap - afterOnset);
}

// ---------------------------------------------------------------- the view
const SVGNS = 'http://www.w3.org/2000/svg';
const PAD_LEFT = 12;                 // between the key signature and the first onset
const PAD_RIGHT = 6;                 // between the closing bar line and the panel's edge
// SMuFL's engraving defaults put a beam at 0.5 staff spaces thick and 0.25 apart,
// so beams sit 1.5 thicknesses from each other; a beamlet is about 1.25 spaces
const BEAM_PITCH = 1.5;
const BEAMLET = 2.5;                 // in beam thicknesses
const MAX_SLOPE = 0.25;              // a beam never steeper than 1 in 4
let sheets = 0;                      // one id per staff on the page, for abcjs

/** abcjs's own beam thickness, read off one of its beams before they are hidden. */
function beamThickness(svg) {
  const e = svg.querySelector('.abcjs-beam-elem');
  const n = (e?.getAttribute('d')?.match(/-?[\d.]+/g) ?? []).map(Number);
  // "M x1 y1 L x2 y2 L x2 y2+t L x1 y1+t z" -- the thickness is the third y's rise
  return n.length >= 8 ? Math.abs(n[5] - n[3]) : 3.9;
}

/**
 * A note's stem in the space its `<g>` is moved in: the rect's x range, both ends,
 * and which way it points -- up if it stands on the right of the noteheads.
 */
function stemOf(el) {
  const s = el.querySelector('.abcjs-stem');
  const n = (s?.getAttribute('d')?.match(/-?[\d.]+/g) ?? []).map(Number);
  if (n.length < 4) return null;
  const xs = n.filter((_, i) => !(i % 2)), ys = n.filter((_, i) => i % 2);
  const heads = [...el.querySelectorAll('.abcjs-notehead')].map(h => h.getBBox());
  if (!heads.length) return null;
  const hx = (Math.min(...heads.map(b => b.x)) + Math.max(...heads.map(b => b.x + b.width))) / 2;
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  return { el: s, x0, x1, top: Math.min(...ys), bot: Math.max(...ys), up: (x0 + x1) / 2 > hx };
}

/**
 * `opts.single` makes one system of the whole range at a fixed `opts.pxPerBeat`,
 * for the scrolling view: the sheet becomes a strip as long as the music, and the
 * caller slides it under a fixed line instead of wrapping it onto several lines.
 * `pxPerBeat` is read at every render, so the view can re-pick it when the panel
 * resizes. Without `single` nothing here behaves differently.
 */
export function makeStaff(el, opts = {}) {
  const single = !!opts.single;
  let song = null, from = 0, to = 0, loopStart = 0, loopLen = 4, cols = 4, swung = b => b;
  let stripW = 0, stripH = 0;      // the strip's own box in wrapper px (single mode)
  const headsOf = new Map();       // song note -> [notehead elements]
  let systems = [];                // per system: { line, first, bars, grid, top, bottom }, in svg user units
  let anchors = [];                // per bar: [{ b, x, top, bottom, n }] in wrapper px, for the wrong-note ticks
  let u2w = { x: 0, y: 0, k: 1 };  // svg user units -> wrapper px
  let curLine = -1, waitEls = [];

  el.classList.add('staff');
  if (single) el.classList.add('sone');
  const inner = document.createElement('div'); inner.className = 'sinner';
  // abcjs draws into an element it looks up by id, so every staff on the page needs
  // its own -- with a shared one the scrolling strip engraved itself into the staff
  // view's sheet and came out empty
  const sheet = document.createElement('div');
  sheet.className = 'ssheet'; sheet.id = 'staffsheet' + (++sheets);
  const box = document.createElement('div'); box.className = 'sbar';
  const head = document.createElement('div'); head.className = 'shead';
  const hover = document.createElement('div'); hover.className = 'shover';
  const marks = document.createElement('div'); marks.className = 'smarks';
  inner.append(sheet, box, marks, hover, head);
  el.innerHTML = ''; el.appendChild(inner);

  // shown and hidden with visibility: toggling display on these overlays left
  // Chrome's compositor stuck, and a headless screenshot never returned
  const hide = e => { e.style.visibility = 'hidden'; };
  const show = e => { e.style.visibility = 'visible'; };

  const wrapRect = () => inner.getBoundingClientRect();
  const relX = cx => cx - wrapRect().left + inner.scrollLeft;
  const relY = cy => cy - wrapRect().top + inner.scrollTop;
  const wx = ux => u2w.x + ux * u2w.k;             // svg user units -> wrapper px
  const wy = uy => u2w.y + uy * u2w.k;
  const bbox = e => e.getBBox();

  /** Widen the engraved svg so a strip longer than abcjs's own spacing is not
   *  clipped by the svg viewport. Coordinates stay put; only the box grows. */
  function growSvg(svg, needPx) {
    svg.style.overflow = 'visible';
    const sr = svg.getBoundingClientRect();
    const need = needPx - relX(sr.left);
    if (!(need > sr.width + 0.5) || !sr.width) return;
    const cur = parseFloat(svg.getAttribute('width')) || 0;
    if (!cur) return;
    const next = cur * (need / sr.width);
    svg.setAttribute('width', next.toFixed(2));
    const vb = svg.getAttribute('viewBox');
    if (vb) {
      const p = vb.trim().split(/[\s,]+/);
      if (p.length === 4) svg.setAttribute('viewBox', `${p[0]} ${p[1]} ${next.toFixed(2)} ${p[3]}`);
    }
  }

  function render(s, a, b, sw) {
    song = s; from = a; to = b; swung = sw; loopStart = from * 4; loopLen = (to - from + 1) * 4;
    headsOf.clear(); systems = []; anchors = []; curLine = -1; waitEls = [];
    marks.innerHTML = ''; hide(box); hide(head); hide(hover);
    if (!window.ABCJS) { sheet.textContent = '(notation library failed to load)'; return; }
    const nbars = to - from + 1;
    cols = single ? nbars : colsFor(nbars);
    const abc = buildAbc(song, from, to, cols);
    const rows = Math.ceil(nbars / cols);
    const avail = el.clientHeight - 8;
    // a short loop is enlarged to use the panel (readable from the piano stool),
    // a long one shrinks to fit two systems, and longer still scrolls
    const draw = (scale, width, src = abc) => {
      window.ABCJS.renderAbc(sheet.id, src, {
        add_classes: true, staffwidth: Math.max(320, width),
        scale, paddingtop: 6, paddingbottom: 6, paddingleft: 4, paddingright: 4,
      });
      const svg = sheet.querySelector('svg');
      return svg ? svg.getBoundingClientRect().height : 0;
    };
    if (single) {
      // the strip's length is the music's: one system, a fixed number of pixels per
      // beat, and no shrink-to-fit passes -- it is meant to run off both edges. The
      // width asked for allows for the clef/key block, which is only measurable once
      // it is drawn; `layout` then pins the grid to exactly nbars * 4 * pxPerBeat.
      //
      // `opts.scale` is how big the caller wants the engraving drawn -- abcjs draws
      // the notes at that size rather than a CSS transform blowing them up, so a
      // strip filling a laptop panel is as sharp as one on a phone. staffwidth is in
      // pre-scale units, hence the division: the music still comes out `span`, and
      // `stripStaffWidth` keeps a scale-stable opening and trailer around it.
      //
      // `opts.staffSep` is the gap between the two staves of the system. The view sets
      // it: the scale is decided by how much room a beat has sideways, and whatever
      // height that leaves over is given to this gap rather than to margins, so the
      // system fills the panel instead of floating in the middle of it.
      const k = opts.scale || 1;
      const span = nbars * 4 * (opts.pxPerBeat || 48);
      const head = opts.staffSep != null ? `%%sysstaffsep ${Math.round(opts.staffSep)}\n` : '';
      inner.style.width = ''; inner.style.height = '';
      draw(k, stripStaffWidth(span, k), head + abc);
      layout();
      return;
    }
    const width = el.clientWidth - 24;
    let h = draw(1, width);
    if (h && rows <= 2 && avail >= 60) {
      const want = Math.max(.45, Math.min(1.7, (avail / h) * .92));
      if (want < 1) {
        // shrink at full layout width, so the systems keep their bars
        let scale = want;
        for (let pass = 0; pass < 3 && h > avail; pass++) { h = draw(scale, width); scale = Math.max(.45, scale * (avail / h) * .98); }
      } else if (want > 1.08) {
        // enlarging narrows the layout; if abcjs then wraps to more systems, keep the plain size
        if (draw(want, width / want) > avail) draw(1, width);
      }
    }
    layout();
  }

  /** The engraved elements of one voice, in time order, paired with the cells they came from. */
  function pair(svg, v) {
    const hand = v === 0 ? 'rh' : 'lh';
    const cells = [];
    for (let bi = from; bi <= to; bi++) for (const c of song.cells[hand][bi]) cells.push({ c, bi, hand });
    const els = [...svg.querySelectorAll(`.abcjs-note.abcjs-v${v}, .abcjs-rest.abcjs-v${v}`)];
    if (els.length !== cells.length) {
      console.warn(`staff: voice ${v} has ${els.length} engraved elements for ${cells.length} cells`);
      return null;
    }
    return els.map((g, i) => ({ g, ...cells[i] }));
  }

  /**
   * Pair every notehead with its song note, then move what abcjs engraved onto the
   * time grid. The measuring is in svg user units (getBBox), which is the space a
   * `transform` on those elements applies in; the overlays are converted to the
   * wrapper's pixels once, through u2w.
   */
  function layout() {
    const svg = sheet.querySelector('svg');
    if (!svg) return;
    const r = svg.getBoundingClientRect();
    u2w = { x: relX(r.left), y: relY(r.top), k: r.width / (parseFloat(svg.getAttribute('width')) || r.width) };

    const voices = [pair(svg, 0), pair(svg, 1)];
    if (voices.some(v => !v)) return;             // the map is wrong: leave abcjs's own layout alone

    // One grid per system, from the staff lines and the clef/key block that opens them.
    // Every system starts at the same x -- only the first carries a time signature, and
    // a bar that was wider on one line than another would change the playhead's speed.
    const nbars = to - from + 1, nsys = Math.ceil(nbars / cols);
    const lines = [], opens = [];
    for (let s = 0; s < nsys; s++) {
      const line = [...svg.querySelectorAll(`.abcjs-staff.abcjs-l${s}`)].map(bbox);
      if (!line.length) return;
      const extra = [...svg.querySelectorAll(`.abcjs-staff-extra.abcjs-l${s}`)].map(bbox);
      lines.push(line);
      opens.push((extra.length ? Math.max(...extra.map(b => b.x + b.width)) : Math.min(...line.map(b => b.x))) + PAD_LEFT);
    }
    const left = Math.max(...opens);
    // The grid takes the whole panel: abcjs will not stretch a system past its own
    // spacing cap (a short loop lands half way across), and where the engraving wanted
    // more room than it was given abcjs simply sized the svg over and let its own
    // container clip it. So the width to lay out across is what is actually visible,
    // and the staff lines are pulled out or in to meet it.
    const shown = sheet.clientWidth / u2w.k;
    // single: the grid is not fitted to a panel, it *is* the panel -- exactly the
    // asked-for pixels per beat, so the strip slides at one constant speed
    const right = single
      ? left + nbars * 4 * (opts.pxPerBeat || 48) / u2w.k
      : Math.min(parseFloat(svg.getAttribute('width')) || shown, shown) - PAD_RIGHT;
    if (!(right > left)) return;
    for (let s = 0; s < nsys; s++) {
      const bars = Math.min(cols, nbars - s * cols);
      // a short last system keeps the full system's bar width, so a bar is a bar
      const grid = systemGrid(left, left + (right - left) * bars / cols, bars);
      // the five lines of each staff: flat paths straight under the staff group (only
      // the topmost is classed, the rest are bare), never the brace, which is tall
      for (const e of svg.querySelectorAll(`.abcjs-staff.abcjs-l${s} > path`)) {
        const b = bbox(e);
        if (b.height > 2 || b.width < 20) continue;
        e.setAttribute('transform', `translate(${b.x},0) scale(${(grid.right - b.x) / b.width},1) translate(${-b.x},0)`);
      }
      systems.push({ line: s, first: s * cols, bars, grid,
                     top: Math.min(...lines[s].map(b => b.y)), bottom: Math.max(...lines[s].map(b => b.y + b.height)) });
    }

    const thick = beamThickness(svg);             // measured before abcjs's beams are hidden

    // every note, rest and bar line onto the grid
    for (let v = 0; v < 2; v++) {
      const moved = [];                           // { x0, dx }, for whatever else has to ride along
      for (const it of voices[v]) {
        const { g, c, bi, hand } = it;
        const sys = systems[Math.floor((bi - from) / cols)];
        const onset = swung(bi * 4 + c.at / 2) - loopStart - sys.first * 4;
        const b = bbox(g);
        // a note's onset is its notehead's left edge, where the playhead should touch
        // it; a rest belongs over the time it fills, so it is centred on that instead
        const heads = c.ns.length ? [...g.querySelectorAll('.abcjs-notehead')].map(bbox) : [];
        const dx = heads.length
          ? sys.grid.x(onset) - Math.min(...heads.map(h => h.x))
          : sys.grid.x(onset + c.d / 4) - (b.x + b.width / 2);
        shift(g, dx);
        it.dx = dx;                               // the beams need to know where it went
        moved.push({ x0: b.x, dx });
        if (c.ns.length) mapHeads(g, c, bi, hand, sys.first * 4 + onset, dx);
      }
      for (const g of svg.querySelectorAll(`.abcjs-bar.abcjs-v${v}`)) {
        const cls = g.getAttribute('class') || '';
        const s = +(/abcjs-l(\d+)/.exec(cls)?.[1] ?? 0), m = +(/abcjs-m(\d+)/.exec(cls)?.[1] ?? 0);
        const b = bbox(g);
        if (systems[s]) shift(g, systems[s].grid.x((m + 1) * 4) - (b.x + b.width / 2));
      }
      // a tuplet rides with its own group: moved to where its first note went, and its
      // bracket stretched to reach the last, so it does not hang over the bar line
      for (const g of svg.querySelectorAll(`[class*="abcjs-triplet"].abcjs-v${v}`)) {
        const b = bbox(g);
        const under = moved.filter(m => m.x0 >= b.x - 2 && m.x0 <= b.x + b.width + 2);
        if (!under.length) continue;
        const a = under[0], z = under[under.length - 1];
        shift(g, a.dx);
        const was = z.x0 - a.x0, now = (z.x0 + z.dx) - (a.x0 + a.dx);
        if (was > 1 && Math.abs(now / was - 1) > 0.02)
          for (const p of g.querySelectorAll('path'))
            p.setAttribute('transform', `translate(${b.x},0) scale(${(now / was).toFixed(4)},1) translate(${-b.x},0)`);
      }
    }
    // abcjs's ties, slurs and beams all join two x's it chose; ours join the glyphs
    // where they landed
    for (const e of svg.querySelectorAll('[class*="slur"],[class*="tie"],.abcjs-beam-elem')) e.style.display = 'none';
    drawTies(svg);
    for (let v = 0; v < 2; v++) drawBeams(voices[v], v === 0 ? 'rh' : 'lh', thick);
    for (const a of anchors) a?.sort((p, q) => p.b - q.b || p.x - q.x);

    // the strip's box, for the view that scrolls it. The grid ends at the last bar
    // line, but the last notehead (a last-eighth vamp, a dotted head) sits *on* that
    // onset and extends past it -- so the box is the grid plus enough trailer that
    // overflow:hidden does not eat the note. The svg is grown to match: abcjs sized
    // it for its own spacing, which at laptop scale was short of the grid.
    if (single) {
      let far = wx(right), headPx = 0, lastL = -Infinity;
      for (const h of svg.querySelectorAll('.abcjs-notehead')) {
        const b = h.getBoundingClientRect();
        if (!b.width) continue;
        far = Math.max(far, relX(b.right));
        headPx = Math.max(headPx, b.width);
        lastL = Math.max(lastL, relX(b.left));
      }
      const ppb = opts.pxPerBeat || 48;
      const fromEnd = lastL > -Infinity ? (wx(right) - lastL) / ppb : 0;
      const trail = trailingRoom(fromEnd, { pxPerBeat: ppb, headPx: headPx || 12 * (opts.scale || 1) });
      stripW = Math.ceil(Math.max(wx(right) + trail, far + 4));
      inner.style.width = stripW + 'px';
      growSvg(svg, stripW);
      stripH = Math.ceil(inner.getBoundingClientRect().height);
    }
  }

  /** Translate an engraved element sideways, keeping whatever transform abcjs gave it. */
  function shift(e, dx) {
    if (!dx) return;
    const base = e.getAttribute('transform');
    e.setAttribute('transform', `translate(${dx.toFixed(2)},0)` + (base ? ' ' + base : ''));
  }

  // getBBox() on a notehead is in its note group's own space, which is where the
  // group's translate has *not* been applied -- so the group's dx is added back on
  function mapHeads(g, c, bi, hand, beat, dx) {
    // bottom-most head first, so heads pair with the cell's ascending pitches
    const hs = [...g.querySelectorAll('.abcjs-notehead')].sort((p, q) => q.getBBox().y - p.getBBox().y);
    if (hs.length !== c.ns.length) console.warn(`staff: bar ${bi + 1} ${hand}: ${hs.length} heads for ${c.ns.length} pitches`);
    c.refs.forEach((note, k) => {
      const h = hs[k]; if (!h) return;
      h.dataset.hand = hand;
      if (!headsOf.has(note)) headsOf.set(note, []);
      headsOf.get(note).push(h);
      const bb = bbox(h);
      (anchors[bi - from] ||= []).push({ b: beat, x: wx(bb.x + dx), top: wy(bb.y), bottom: wy(bb.y + bb.height), n: note.n });
    });
  }

  /**
   * The beams of one voice, redrawn where the notes ended up. The groups come from
   * the same `beamBar` call that wrote the ABC, and `voices[v]` is in cell order,
   * so a bar's cell index plus the running offset names the engraved element.
   */
  function drawBeams(items, hand, t) {
    let k = 0;
    for (let bi = from; bi <= to; bi++) {
      const cells = song.cells[hand][bi];
      for (const grp of beamBar(cells).groups) {
        const els = [];
        for (let i = grp.from; i <= grp.to; i++) els.push(items[k + i]);
        if (els.every(Boolean)) drawGroup(els, grp, t);
      }
      k += cells.length;
    }
  }

  /** One beam group: the line, its secondary beams and beamlets, then the stems. */
  function drawGroup(els, grp, t) {
    // a rest under a beam (`beamOverRests`) has no stem: the beam simply passes over
    // it, so it is left out of the fitting and of the re-cutting
    const all = els.map(it => { const s = stemOf(it.g); return s && { ...s, dx: it.dx ?? 0 }; });
    const at = i => all[i - grp.from] ?? all.find(Boolean);
    const stems = all.filter(Boolean);
    if (stems.length < 2 || !all[0] || !all[all.length - 1]) return;
    // abcjs already chose a direction for the group; keep it (the majority, in case
    // an oddity in the middle disagrees)
    const up = stems.filter(s => s.up).length * 2 >= stems.length;
    const dir = up ? 1 : -1;                      // which way the beam is thick
    const cx = s => (s.x0 + s.x1) / 2 + s.dx;     // the stem's centre, after the move
    const tip = s => (up ? s.top : s.bot);        // the free end, as abcjs left it
    const a = stems[0], z = stems[stems.length - 1];
    // the line through the two outer stem tips, its slope capped so a group that the
    // grid squeezed together does not come out as a staircase
    let m = (tip(z) - tip(a)) / Math.max(1e-3, cx(z) - cx(a));
    m = Math.max(-MAX_SLOPE, Math.min(MAX_SLOPE, m));
    const mx = (cx(a) + cx(z)) / 2, my = (tip(a) + tip(z)) / 2;
    // then pushed out until no stem is shorter than the one abcjs drew: the inner
    // notes were on abcjs's line, and re-sloping it can only have raised or lowered
    // the beam past one of them
    const slack = stems.map(s => tip(s) - (my + m * (cx(s) - mx)));
    const off = up ? Math.min(0, ...slack) : Math.max(0, ...slack);
    const y = x => my + off + m * (x - mx);

    const g = document.createElementNS(SVGNS, 'g');
    g.setAttribute('class', 'sbeams');
    const quad = (x1, x2, level) => {
      const e1 = y(x1) + dir * (level - 1) * t * BEAM_PITCH, e2 = y(x2) + dir * (level - 1) * t * BEAM_PITCH;
      const p = document.createElementNS(SVGNS, 'path');
      p.setAttribute('d', `M${x1},${e1} L${x2},${e2} L${x2},${e2 + dir * t} L${x1},${e1 + dir * t} z`);
      g.appendChild(p);
    };
    for (const b of grp.beams) {
      const s0 = at(b.from), s1 = at(b.to);
      if (!b.partial) { quad(s0.x0 + s0.dx, s1.x1 + s1.dx, b.level); continue; }
      // a beamlet is a stub off its own stem, pointing at the note it belongs with
      const near = at(b.from + (b.partial === 'left' ? -1 : 1));
      const len = Math.min(BEAMLET * t, near !== s0 ? Math.abs(cx(near) - cx(s0)) * 0.4 : BEAMLET * t);
      if (b.partial === 'left') quad(s0.x1 + s0.dx - len, s0.x1 + s0.dx, b.level);
      else quad(s0.x0 + s0.dx, s0.x0 + s0.dx + len, b.level);
    }
    els[0].g.parentElement.appendChild(g);        // the space the stems' own d is in

    // and finally re-cut every stem to end on the new line. The stem is a filled
    // rect, "M x1 yA L x1 yB L x0 yB L x0 yA z", inside the note's own group -- so
    // its x stays as abcjs wrote it and only the free end's y moves.
    for (const s of stems) {
      const end = y(cx(s));
      const [t0, b0] = up ? [end, s.bot] : [s.top, end];
      s.el.setAttribute('d', `M${s.x1},${t0}L${s.x1},${b0}L${s.x0},${b0}L${s.x0},${t0}z`);
    }
  }

  /**
   * A tied note keeps one song note and two heads: join them with a plain arc, where
   * the heads ended up. Measured through the screen, since a head's own box is in the
   * space its group was moved in.
   */
  function drawTies(svg) {
    const sr = svg.getBoundingClientRect();
    const at = e => { const r = e.getBoundingClientRect();
      return { x: (r.left - sr.left) / u2w.k, w: r.width / u2w.k, y: (r.top - sr.top) / u2w.k, h: r.height / u2w.k }; };
    const g = document.createElementNS(SVGNS, 'g');
    g.setAttribute('class', 'sties');
    for (const hs of headsOf.values()) {
      for (let i = 0; i + 1 < hs.length; i++) {
        const a = at(hs[i]), b = at(hs[i + 1]);
        if (b.x <= a.x) continue;                 // the tie crossed a system: leave it out
        const x0 = a.x + a.w, y = a.y + a.h + 1.5;
        const dip = Math.max(3, Math.min(9, (b.x - x0) / 6));   // a long tie sags further
        const p = document.createElementNS(SVGNS, 'path');
        p.setAttribute('d', `M${x0},${y} Q${(x0 + b.x) / 2},${y + dip} ${b.x},${y}`);
        g.appendChild(p);
      }
    }
    svg.appendChild(g);
  }

  const sysOf = bar => systems[Math.max(0, Math.min(systems.length - 1, Math.floor(bar / cols)))];

  /** Where a loop-relative beat sits: linear in beats, so the playhead keeps tempo. */
  function xOf(beat) {
    if (!systems.length) return null;
    const bi = Math.max(0, Math.min(loopLen / 4 - 1, Math.floor(beat / 4)));
    const s = sysOf(bi);
    return { x: wx(s.grid.x(beat - s.first * 4)), s, bi };
  }

  /** Stand a full-height line on system `s`. */
  function stand(e, x, s) {
    show(e);
    e.style.left = x + 'px'; e.style.top = wy(s.top) + 'px';
    e.style.height = ((s.bottom - s.top) * u2w.k) + 'px';
  }

  function showBar(bi) {
    const s = sysOf(bi); if (!s) { hide(box); return; }
    show(box);
    box.style.left = wx(s.grid.x((bi - s.first) * 4)) + 'px';
    box.style.width = (s.grid.barW * u2w.k) + 'px';
    box.style.top = wy(s.top) + 'px'; box.style.height = ((s.bottom - s.top) * u2w.k) + 'px';
    if (s.line !== curLine) {                     // a long loop: keep the playing system in view
      curLine = s.line;
      if (inner.scrollHeight > inner.clientHeight) inner.scrollTo({ top: Math.max(0, wy(s.top) - 12), behavior: 'smooth' });
    }
  }

  function moveHead(beat) {
    const p = xOf(beat); if (!p) { hide(head); hide(box); return; }
    stand(head, p.x, p.s);
    showBar(p.bi);
  }

  return {
    render,
    setHands(hands) {
      for (const [note, hs] of headsOf) for (const h of hs) h.classList.toggle('dim', hands[note.hand] !== 'you');
    },
    mark(e, cls) {
      for (const h of headsOf.get(e.note) ?? []) { h.classList.remove('hit', 'miss'); if (cls) h.classList.add(cls); }
    },
    extra(n, beat) {
      const p = xOf(Math.max(0, Math.min(loopLen, beat))); if (!p) return;
      // the tick sits near where that pitch would be: beside the closest head in pitch
      const near = (anchors[p.bi] ?? []).slice().sort((a, b) => Math.abs(a.n - n) - Math.abs(b.n - n))[0];
      const y = near ? near.top + (near.n - n) * 3 : wy((p.s.top + p.s.bottom) / 2);
      const t = document.createElement('i');
      t.style.left = (p.x - 2) + 'px';
      t.style.top = Math.max(wy(p.s.top), Math.min(wy(p.s.bottom), y)) + 'px';
      marks.appendChild(t);
    },
    clearMarks() {
      marks.innerHTML = '';
      for (const hs of headsOf.values()) for (const h of hs) h.classList.remove('hit', 'miss');
    },
    playhead(beat, countIn) {
      if (beat < 0 && !countIn) { hide(head); return; }
      moveHead(Math.max(0, Math.min(loopLen, beat)));
      head.classList.toggle('countin', !!countIn);
    },
    cursor(group) {
      for (const h of waitEls) h.classList.remove('wait');
      waitEls = [];
      if (!group) return;
      for (const e of group.notes) for (const h of headsOf.get(e.note) ?? []) { h.classList.add('wait'); waitEls.push(h); }
      moveHead(group.b);
    },

    /** The loop beat a pointer is over: which system by y, where along it by x. */
    beatAt(cx, cy) {
      if (!systems.length) return null;
      const py = relY(cy), px = relX(cx);
      const s = systems.find(g => py >= wy(g.top) - 8 && py <= wy(g.bottom) + 8)
        ?? systems.reduce((a, b) => Math.abs(wy(b.top) - py) < Math.abs(wy(a.top) - py) ? b : a);
      return Math.max(0, Math.min(loopLen, s.first * 4 + s.grid.beat((px - u2w.x) / u2w.k)));
    },
    /** A faint line where a click would take the playhead. */
    hoverAt(beat) {
      const p = beat == null ? null : xOf(beat);
      if (!p) { hide(hover); return; }
      stand(hover, p.x, p.s);
    },

    // ---- the strip, for a view that scrolls it (single mode) ----
    /**
     * Where a loop beat sits along the strip, in its own pixels. Deliberately not
     * clamped: a count-in is negative beats, and the camera wants the strip to be
     * still off to the right then, and to keep going past the last bar at the end.
     */
    x(beat) {
      const s = systems[0];
      return s ? wx(s.grid.x(beat - s.first * 4)) : 0;
    },
    /** Its inverse, for click-to-seek. */
    beatOfX(px) {
      const s = systems[0];
      return s ? s.first * 4 + s.grid.beat((px - u2w.x) / u2w.k) : 0;
    },
    get width() { return stripW; },
    get height() { return stripH; },
  };
}
