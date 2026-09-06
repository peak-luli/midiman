// The scrolling staff: the whole loop engraved on one line, sliding leftwards at a
// constant speed under a playhead that never moves. You look at one place and the
// music comes to you -- on a phone on the music stand, and on a laptop across the
// room, where the notes are drawn as big as the panel will take.
//
// It is glue, and only glue. The engraving is `makeStaff(..., { single: true })`,
// which is the staff view asked for one system at a fixed number of pixels per
// beat; where to put that strip is `camera.js`. This file owns three things:
//
//   * the viewport -- `overflow: hidden`, with the strip inside it and the fixed
//     line, the played shade and the pinned header painted on top of it, not in it.
//   * the header -- the clefs, key and time signature are copied out of the strip and
//     held at the left edge instead of scrolling away with bar 1. You cannot read the
//     notes without knowing which of them are flat.
//   * the move: one `transform: translateX(...)` per frame. A transform is
//     composited, so a phone scrolls the music without laying anything out again;
//     changing `left` or scrolling the box instead cost a layout every frame.
//   * the fit: the engraving is drawn to fill the panel -- grown on a laptop, shrunk
//     on a phone in landscape -- and re-engraved at that size (abcjs's own `scale`)
//     rather than stretched with a CSS transform, so the staff lines and noteheads
//     are drawn big rather than blown up: crisp at 4x. Scale is uniform, so `x(beat)`
//     stays proportional and the camera only has to know the factor.
//
// The notes get all the room the panel has, with one hard limit: two noteheads must
// never step over each other, however big the staff is drawn. That is measured off
// the engraving rather than reasoned about, because swing, tuplets and chords all
// change how close two onsets come. See `fitFor`.

import { makeStaff } from './staff.js';
import { offsetFor, lineAt, beatAt as camBeatAt, panBy, followReady } from './camera.js';

export const ANCHOR = 0.3;               // where the playhead stands across the view
const MIN_PPB = 40;                      // a beat never narrower than this
const MAX_SCALE = 5;                     // a grand staff drawn larger than this is a billboard
const SCALE_FLOOR = 1.4;                 // ...and smaller than this is the old thin strip back
const FIT_PAD = 10;                      // breathing room above and below the strip
/** That breathing room, but never a big share of a short panel. */
const padFor = viewHeight => Math.min(FIT_PAD, viewHeight * 0.02);
const HEAD_GAP = 4;                      // white between one notehead and the next
const BARS_MIN = 2, BARS_MAX = 3;        // bars across the panel: the read-ahead band
const BARS_FLOOR = 1.5;                  // ...and what dense music may fall back to
// abcjs's %%sysstaffsep, the gap between the two staves. Left as tight as abcjs will
// draw it: the two staves have to read as one system, and its default put a third of
// the strip's height into the white band between them. Height the music does not use
// is better left as margin than poured into that gap.
const STAFF_SEP = 20;
// the pinned opening, packed: abcjs's own gaps between clef, key and meter, halved,
// and a fade rather than an edge where the pad gives way to the moving strip
const LEAD_IN = 4, GLYPH_GAP = 5, FADE = 24;
const HEAD_MAX = 0.24;                   // ...and the share of the panel it may take

/**
 * How to draw the strip for this panel, given what the last drawing measured.
 *
 * Three numbers come out and they are decided in this order.
 *
 *   scale -- how big the music is drawn. As big as the panel is tall, except that
 *     noteheads must not step over each other: the closest pair of onsets can only
 *     carry heads narrower than the gap between them, so the scale is capped by how
 *     much sideways room a beat has when BARS_MIN bars are in the panel. Dense bars
 *     (a run of thirty-seconds) would drive that below legibility, so down there it
 *     buys room by showing fewer bars -- as few as BARS_FLOOR -- instead of shrinking
 *     past SCALE_FLOOR.
 *
 *   pxPerBeat -- the least that keeps those heads apart, so that the bars in view are
 *     as many as the notes allow rather than as few as the size demands. Never fewer
 *     than BARS_MIN in sight, never more than BARS_MAX.
 *
 * `m` is the last engraving: the scale it was drawn at, its height in px, and `pairs`
 * -- every note that is followed by another in the same hand, as the width of its head
 * column per unit of scale and the beats until that next onset. Feed the result back
 * in and it converges in two or three passes.
 *
 * On a laptop the heads are what binds, not the height, so the panel keeps some margin
 * above and below: a compact grand staff with big notes, rather than two staves flung
 * apart to touch the edges.
 */
export function fitFor({ width, height }, m) {
  const avail = height - padFor(height);
  const unit = Math.max(1, m.height / m.scale);   // the system's height per unit of scale
  // pixels a beat must have so that every pair of notes keeps HEAD_GAP between them
  const needs = s => m.pairs.reduce((n, p) => Math.max(n, (p.head * s + HEAD_GAP) / p.beats), 0);
  // ...and the biggest the music can be drawn with `bars` bars across the panel
  const fits = bars => m.pairs.reduce(
    (k, p) => Math.min(k, (width / (4 * bars) * p.beats - HEAD_GAP) / p.head), Infinity);

  const byHeight = avail / unit;
  let scale = Math.min(byHeight, fits(BARS_MIN), MAX_SCALE);
  // A run of thirty-seconds cannot be both readable and two bars wide. Rather than
  // shrink the notes to nothing, give up bars down to BARS_FLOOR -- but only as far
  // as SCALE_FLOOR, and never against the panel's height, which is a hard wall.
  if (scale < SCALE_FLOOR) scale = Math.min(byHeight, fits(BARS_FLOOR), MAX_SCALE, SCALE_FLOOR);
  scale = Math.max(0.3, scale);
  const pxPerBeat = Math.max(MIN_PPB, width / (4 * BARS_MAX), needs(scale));
  return { scale, pxPerBeat };
}

/** Pixels per beat when nothing has been measured yet: a plain 2.5 bars in view. */
export const ppbFor = (viewWidth, scale = 1) =>
  Math.max(MIN_PPB, 24 * scale, viewWidth / (4 * BARS_MAX));

const SVGNS = 'http://www.w3.org/2000/svg';

export function makeScroll(el) {
  let loopLen = 4, vw = 0, scale = 1, offset = 0, at = 0, headW = 0, held = false;
  let parked = null;                     // line beat a finger left; follow waits for the engine
  // the engine reports loopLen as 0 (the wrap), so a finger must stop just inside
  const lastLine = () => Math.max(0, loopLen - 1e-4);

  el.classList.add('scroll');
  const wrap = document.createElement('div'); wrap.className = 'swrap';
  const strip = document.createElement('div');
  const shade = document.createElement('div'); shade.className = 'splayed';
  const fixed = document.createElement('div'); fixed.className = 'sfixed';
  const glyphs = document.createElement('div'); glyphs.className = 'sfglyph';
  const line = document.createElement('div'); line.className = 'sline';
  wrap.appendChild(strip); fixed.appendChild(glyphs);
  el.innerHTML = ''; el.append(wrap, shade, fixed, line);

  // the option object is read at every staff render, so the strip is re-engraved at
  // the right size when the panel's is not what it was
  const opt = { single: true, pxPerBeat: MIN_PPB, scale: 1, staffSep: STAFF_SEP };
  const staff = makeStaff(strip, opt);

  // The panel is not always the size it was when the strip was engraved: on the phone
  // the play screen's controls arrive after the first render and take back a third of
  // the height. Since the whole point of the sizing is to fill the panel, a panel that
  // has changed shape is engraved again rather than stretched to cover it.
  let last = null, pending = 0, was = '';
  if (typeof ResizeObserver === 'function') new ResizeObserver(() => {
    const now = `${el.clientWidth}x${el.clientHeight}`;
    if (!last || now === was || pending) return;
    pending = requestAnimationFrame(() => { pending = 0; render(...last); });
  }).observe(el);

  /**
   * Copy the opening of the system -- the two clefs, the key signature, the meter and
   * the brace that binds them -- into a pad pinned to the left edge, and hide the
   * originals so the strip does not carry a second set past it. The staff lines come
   * too, so the clefs sit on lines rather than in mid air, and the music slides on
   * behind. Returns where the pad ends, in the strip's own pixels.
   *
   * The copy is packed up tight. abcjs sets the opening out with a printing press's
   * spacing, which on a strip this size took a third of the panel; here the block is
   * read once and then stared past, so the glyphs go as close as a printed score's
   * and the width that frees goes back to the music.
   */
  function pin(maxWidth) {
    fixed.innerHTML = ''; glyphs.innerHTML = '';
    glyphs.style.transform = 'none';            // measure in the strip's own pixels
    fixed.appendChild(glyphs);
    const svg = strip.querySelector('svg');
    if (!svg) return 0;
    // matched on the class attribute rather than classList: on an SVG element that is
    // a newer property than the rest of this, and a miss here would silently leave the
    // header with nothing in it
    const has = (e, c) => (' ' + (e.getAttribute('class') || '') + ' ').indexOf(' ' + c + ' ') >= 0;
    const extras = [...svg.querySelectorAll('.abcjs-staff-extra')];
    if (!extras.length) return 0;
    const sr = svg.getBoundingClientRect(), pr = strip.getBoundingClientRect();

    // abcjs applies its `scale` as an inline CSS transform on the svg rather than in
    // the coordinates. The copy asks for the same size through a viewBox instead --
    // svg's own scaling, which needs nothing of the browser beyond svg itself.
    const out = document.createElementNS(SVGNS, 'svg');
    const uw = parseFloat(svg.getAttribute('width')) || sr.width;
    const uh = parseFloat(svg.getAttribute('height')) || sr.height;
    out.setAttribute('viewBox', `0 0 ${uw} ${uh}`);
    out.setAttribute('width', sr.width.toFixed(2));
    out.setAttribute('height', sr.height.toFixed(2));
    out.setAttribute('preserveAspectRatio', 'xMinYMin meet');
    out.style.position = 'absolute';
    out.style.left = (sr.left - pr.left).toFixed(1) + 'px';
    out.style.top = (sr.top - pr.top).toFixed(1) + 'px';
    const sheetStyle = svg.querySelector('style');
    if (sheetStyle && sheetStyle.parentNode === svg) out.appendChild(sheetStyle.cloneNode(true));

    // the joining line down the system's left edge is a bare path, tall and hair-thin
    const joins = [...svg.querySelectorAll('.abcjs-staff-wrapper > path')]
      .filter(e => { const b = e.getBBox(); return b.width < 3 && b.height > 20; });
    const braces = [...svg.querySelectorAll('.abcjs-brace')];
    const lines = [], clef = [], key = [], meter = [], bound = [];
    const take = (e, into) => { const c = e.cloneNode(true); out.appendChild(c); if (into) into.push(c); };
    for (const e of svg.querySelectorAll('.abcjs-staff > path')) take(e, lines);
    for (const e of braces.concat(joins)) take(e, bound);
    for (const e of extras)
      take(e, has(e, 'abcjs-clef') ? clef : has(e, 'abcjs-key-signature') ? key
             : has(e, 'abcjs-time-signature') ? meter : null);
    for (const e of braces.concat(joins, extras)) e.style.visibility = 'hidden';
    glyphs.appendChild(out);

    // Pack the copies up close, one column per kind, both staves moved together so the
    // clefs, the flats and the meter stay in line with each other down the system.
    // Measured with client rects, not getBBox: a group's own transform is not in its
    // bbox, and abcjs gives each of these one.
    const k = out.getBoundingClientRect().width / uw || 1;      // px per user unit
    const L = e => e.getBoundingClientRect().left - pr.left;
    const R = e => e.getBoundingClientRect().right - pr.left;
    const staffX = lines.length ? Math.min(...lines.map(L)) : 0;
    const pack = from => {
      let cur = from + LEAD_IN * k;
      for (const els of [clef, key, meter]) {
        if (!els.length) continue;
        const x0 = Math.min(...els.map(L)), x1 = Math.max(...els.map(R));
        const dx = (cur - x0) / k;                                          // in user units
        for (const e of els) {
          const was = e.getAttribute('transform');
          e.setAttribute('transform', `translate(${dx.toFixed(2)},0)` + (was ? ' ' + was : ''));
        }
        cur += (x1 - x0) + GLYPH_GAP * k;
      }
      return cur - GLYPH_GAP * k + LEAD_IN * k;    // where the pad's white ends, in strip px
    };
    let end = pack(staffX);
    if (maxWidth > 0 && end > maxWidth) {
      // On a phone in portrait the opening block would eat the music. The brace and the
      // line joining the staves are the first thing to go: they say the two staves are
      // one system, which the reader can see, where the key signature is the one thing
      // that cannot be worked out from the notes.
      for (const e of bound) out.removeChild(e);
      end = pack(0);
    }
    return end;
  }

  /** Put the current offset on the strip. One transform, same as `move`. */
  function apply() {
    wrap.style.transform = `translateX(${offset.toFixed(2)}px) scale(${scale.toFixed(4)})`;
  }

  /** Slide the strip so that `beat` is under the line. */
  function move(beat) {
    at = beat;
    // a finger is still on the strip, or a seek has not landed yet: leave the
    // offset alone so playhead follow cannot fight the drag. The note colours
    // still ride `beat` via playhead().
    if (held) return;
    if (parked != null && !followReady(beat, parked)) return;
    parked = null;
    offset = offsetFor(beat, { viewWidth: vw, anchor: ANCHOR, x: staff.x, scale, left: headW });
    apply();
  }

  /** Nudge the strip `dx` viewport pixels with the finger. Holds follow until `endPan`. */
  function pan(dx) {
    held = true;
    parked = null;
    offset = panBy(dx, {
      offset, beatOfX: staff.beatOfX, scale, viewWidth: vw, anchor: ANCHOR, left: headW,
      x: staff.x, minBeat: 0, maxBeat: lastLine(),
    }).offset;
    apply();
  }

  /** Beat now under the fixed line, from the offset the finger left. */
  function lineBeat() {
    return camBeatAt(lineAt(vw, ANCHOR, headW), { offset, beatOfX: staff.beatOfX, scale });
  }

  /**
   * Let playhead follow again. The strip stays where it was dragged; a seek to
   * `lineBeat()` is what puts the engine on those notes without a visual jump.
   * A real pan parks that beat so a mirror seek -- async, the phone clock has
   * not moved -- cannot restore the old offset on the next playhead frame.
   * A tap never called `pan`, so it must not park: finishDrag then seeks the
   * finger, and follow should take that beat at once.
   */
  function endPan() {
    const didPan = held;
    held = false;
    const b = Math.max(0, Math.min(lastLine(), lineBeat()));
    offset = offsetFor(b, { viewWidth: vw, anchor: ANCHOR, x: staff.x, scale, left: headW });
    apply();
    at = b;
    parked = didPan ? b : null;
    return at;
  }

  /**
   * The engraving that is on screen, as the pairs of notes that could collide: for
   * every note followed by another in the same hand, how wide its head column is and
   * how many beats until the next onset. Heads of one chord are one column and may
   * legitimately touch -- a second is engraved side by side -- so they are grouped by
   * their note, and what must never touch is two notes.
   *
   * Both numbers are per unit of scale and per beat, so they hold at any size: a pair
   * needs `head * scale + HEAD_GAP` pixels and has `beats * pxPerBeat` of them.
   */
  function measure() {
    const cols = new Map();                      // note element -> box
    for (const h of strip.querySelectorAll('.abcjs-notehead')) {
      const b = h.getBoundingClientRect();
      if (!b.width) continue;
      const g = h.closest('.abcjs-note') || h;
      const hand = h.getAttribute('data-hand') || g.getAttribute('data-hand') || '?';
      const c = cols.get(g);
      if (c) { c.l = Math.min(c.l, b.left); c.r = Math.max(c.r, b.right); }
      else cols.set(g, { hand, l: b.left, r: b.right });
    }
    const all = [...cols.values()];
    const pairs = [];
    for (const hand of new Set(all.map(c => c.hand))) {
      const a = all.filter(c => c.hand === hand).sort((p, q) => p.l - q.l);
      for (let i = 1; i < a.length; i++) {
        const beats = (a[i].l - a[i - 1].l) / opt.pxPerBeat;
        if (beats > 1e-4) pairs.push({ head: (a[i - 1].r - a[i - 1].l) / opt.scale, beats });
      }
    }
    return pairs;
  }

  function render(song, from, to, swung) {
    last = [song, from, to, swung];
    loopLen = (to - from + 1) * 4;
    vw = Math.max(200, el.clientWidth);
    const vh = Math.max(80, el.clientHeight);
    was = `${el.clientWidth}x${el.clientHeight}`;
    // measured unscaled: the staff caches its geometry in the strip's own pixels
    wrap.style.transform = 'none';
    const panel = { width: vw, height: vh };

    // Engrave, measure, aim again. Each pass draws the strip the size the last one's
    // measurements say will fill the panel without the noteheads stepping over each
    // other; three are enough to settle, and the starting point is what worked last
    // time, so a re-render of the same panel usually settles on the first.
    //
    // The pinned header is measured in the same loop, because it is engraved at the
    // same scale: a bigger staff has a bigger clef, which leaves the music less width,
    // which caps the scale. The fit is given the width the music actually gets.
    //
    // Growing is abcjs's job and shrinking is the transform's. abcjs redraws a bigger
    // staff crisply, but asked for less than 1 it holds its minimum note spacing and
    // hands back a staff that is shorter without its noteheads shrinking in step --
    // so a phone would get thin notes in a squat staff. Scaled down, everything goes
    // down together, which is what a small panel wants.
    let shrink = 1;
    for (let pass = 0; pass < 4; pass++) {
      staff.render(song, from, to, swung);
      shrink = staff.height > 0 ? Math.max(0.3, Math.min(1, (vh - padFor(vh)) / staff.height)) : 1;
      headW = pin((vw * HEAD_MAX - FADE) / shrink) * shrink + FADE;
      const pairs = measure();
      if (!pairs.length) break;                   // a bar of rests: nothing to fit around
      const fit = fitFor({ width: Math.max(180, vw - headW), height: vh },
                         { pairs, scale: opt.scale, height: staff.height });
      const drawn = Math.max(1, fit.scale);
      // pxPerBeat is in the strip's own pixels, which the transform then shrinks, so
      // it is divided back out: what reaches the eye is exactly fit.pxPerBeat
      const ppb = fit.pxPerBeat * drawn / fit.scale;
      const near = (a, b) => Math.abs(a - b) < 0.02 * Math.abs(b || 1);
      const settled = near(drawn, opt.scale) && near(ppb, opt.pxPerBeat);
      opt.scale = drawn; opt.pxPerBeat = ppb;
      if (settled) break;
    }

    scale = shrink;
    wrap.style.height = staff.height + 'px';
    wrap.style.marginTop = (-staff.height / 2) + 'px';   // vertically centred, then scaled about its middle
    wrap.style.width = staff.width + 'px';
    // the pad runs the full height of the panel and has no edges: white, then a soft
    // fade into the sheet, so nothing about it reads as a box sitting on the music
    fixed.style.width = headW.toFixed(1) + 'px';
    glyphs.style.height = staff.height + 'px';
    glyphs.style.marginTop = (-staff.height / 2) + 'px';
    // the pad's white fades over its last FADE pixels; the copied staff lines are faded
    // with it by a mask, which is the only way to fade an element's own content. The
    // layer is scaled, so the distance is given in its own pixels.
    glyphs.style.width = (headW / scale).toFixed(1) + 'px';
    const soft = `linear-gradient(90deg,#000 0,#000 calc(100% - ${(FADE / scale).toFixed(1)}px),transparent 100%)`;
    glyphs.style.webkitMaskImage = soft; glyphs.style.maskImage = soft;
    for (const box of [wrap, glyphs]) box.style.transform = `scale(${scale.toFixed(4)})`;

    const at30 = lineAt(vw, ANCHOR, headW);
    // the playhead and its shade grow with the picture: a 2px hair over a staff drawn
    // four times life size reads as an accident rather than as "now"
    const lw = Math.max(2, Math.min(4, Math.round(opt.scale * scale)));
    line.style.width = lw + 'px';
    line.style.left = at30 + 'px';
    line.style.marginLeft = (-lw / 2) + 'px';
    shade.style.left = headW + 'px';
    shade.style.width = Math.max(0, at30 - headW) + 'px';
    // a re-engrave (the play controls arriving, a rotate) must not drop a held
    // finger or a parked seek: keep the line on the same beat so follow cannot
    // snap the strip back to a clock that has not moved yet
    if (held) apply();
    else if (parked != null) {
      offset = offsetFor(parked, { viewWidth: vw, anchor: ANCHOR, x: staff.x, scale, left: headW });
      apply();
    } else move(at);
  }

  return {
    render,
    setHands: h => staff.setHands(h),
    mark: (e, cls) => staff.mark(e, cls),
    extra: (n, beat) => staff.extra(n, beat),
    clearMarks: () => staff.clearMarks(),

    playhead(beat, countIn) {
      staff.playhead(beat, countIn);       // the bar box and the note colours ride along
      move(beat);
    },

    /** Wait mode: bring the armed group to the line and hold it there. */
    cursor(group) {
      staff.cursor(group);
      if (group) move(group.b);
    },

    /** The loop beat a pointer is over: everything is in x, through the camera. */
    beatAt(cx) {
      const px = cx - el.getBoundingClientRect().left;
      const b = camBeatAt(px, { offset, beatOfX: staff.beatOfX, scale });
      return Math.max(0, Math.min(loopLen, b));
    },
    /** A faint line where a click would take the playhead; it lives in the strip. */
    hoverAt: beat => staff.hoverAt(beat),

    pan, endPan, lineBeat,
    get held() { return held; },
    get parked() { return parked; },
  };
}
