// The camera of the scrolling staff. It is one sum and its inverse, and everything
// the view can get wrong -- the music drifting off the line, the count-in arriving
// early, a click seeking somewhere else -- is a mistake in that sum, so it is
// checked here rather than at the music stand.

import test from 'node:test';
import assert from 'node:assert/strict';
import { offsetFor, lineAt, beatAt } from '../src/learn/camera.js';
import { ppbFor, fitFor, ANCHOR } from '../src/learn/scroll.js';
import { trailingRoom, stripStaffWidth } from '../src/learn/staff.js';

// a strip like the staff's: bar 1 starts 30px in (the clef and key), 60px a beat
const PPB = 60, LEFT = 30;
const x = b => LEFT + b * PPB;
const beatOfX = px => (px - LEFT) / PPB;
const view = { viewWidth: 800, anchor: 0.3, x };
const at = (b, o = {}) => offsetFor(b, { ...view, ...o });
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} !== ${b}`);

// ---------------------------------------------------------------- the anchor
test('the beat asked for lands exactly under the line', () => {
  for (const b of [0, 1, 3.5, 7, 16]) near(at(b) + x(b), 0.3 * 800);
});

test('the line is a fraction of the viewport, not a fixed distance', () => {
  near(at(4, { viewWidth: 1200 }) + x(4), 0.3 * 1200);
  near(at(4, { anchor: 0.5 }) + x(4), 0.5 * 800);
});

test('the strip moves exactly one pixels-per-beat for every beat, at every tempo', () => {
  // constant speed is the whole claim of the view: equal beats, equal pixels
  for (let b = 0; b < 12; b++) near(at(b) - at(b + 1), PPB);
  near(at(0) - at(0.25), PPB / 4);
});

test('it slides leftwards: later beats are further left', () => {
  assert.ok(at(8) < at(4) && at(4) < at(0));
});

// ---------------------------------------------------------------- the ends
test('at beat 0 the strip starts at the line, with the whole loop to its right', () => {
  // positive offset: nothing is clamped away, so the first bar is *at* the line and
  // the 30% to its left is empty rather than showing bar 1 already half gone
  assert.ok(at(0) > 0);
  near(at(0), 0.3 * 800 - LEFT);
});

test('a count-in slides the music in, arriving on beat 0', () => {
  // four negative beats: the strip sits four beats further right and walks in
  const counts = [-4, -3, -2, -1, 0].map(at);
  for (let i = 1; i < counts.length; i++) near(counts[i - 1] - counts[i], PPB);
  assert.ok(counts[0] > counts[4]);
  near(counts[4], at(0));
});

test('the last bar passes under the line rather than parking at the edge', () => {
  // no clamp at the end: beyond the loop the offset keeps going negative, so the
  // final notes are read under the playhead like every other note
  const end = 16;                                  // a four-bar loop
  assert.ok(at(end + 2) < at(end));
  near(at(end) - at(end + 2), 2 * PPB);
});

test('a loop wrap is a jump back to where beat 0 was, and nothing else', () => {
  near(at(0), at(16) + 16 * PPB);
});

// ---------------------------------------------------------------- the shrink
test('a scaled-down strip is offset in the scaled space', () => {
  // transform: translateX(off) scale(k) maps a strip pixel p to off + k*p
  const k = 0.5;
  near(at(6, { scale: k }) + k * x(6), 0.3 * 800);
});

// ---------------------------------------------------------------- seeking
test('click-to-seek is the exact inverse of the camera', () => {
  for (const scale of [1, 0.62]) {
    for (const b of [0, 2.5, 9, 15.75]) {
      const offset = at(b, { scale });
      // the point under the line is the beat that was asked for
      near(beatAt(0.3 * 800, { offset, beatOfX, scale }), b);
      // and a point further right is further into the loop
      const ahead = beatAt(0.3 * 800 + PPB * scale, { offset, beatOfX, scale });
      near(ahead, b + 1);
    }
  }
});

test('seeking left of the line lands in what has already been played', () => {
  const offset = at(8);
  assert.ok(beatAt(0, { offset, beatOfX }) < 8);
});

// -------------------------------------------------------- the pinned header
// The clefs and the key signature do not scroll away -- you cannot read the notes
// without knowing which are flat -- so the music starts after a fixed header and the
// line stands 30% of the way across what is left, not of the whole panel.
test('the line stands past the pinned header, not across it', () => {
  near(lineAt(800, 0.3, 0), 240);
  near(lineAt(800, 0.3, 200), 200 + 0.3 * 600);
  assert.ok(lineAt(800, 0.3, 200) > lineAt(800, 0.3, 0));
});

test('a beat still lands exactly under the line with a header in the way', () => {
  for (const b of [0, 2, 7.5]) near(at(b, { left: 200 }) + x(b), lineAt(800, 0.3, 200));
});

test('the header does not change the speed, only where the line is', () => {
  for (let b = 0; b < 6; b++) near(at(b, { left: 200 }) - at(b + 1, { left: 200 }), PPB);
});

test('click-to-seek still inverts the camera once the header has shifted it', () => {
  const left = 200, l = lineAt(800, 0.3, left);
  for (const scale of [1, 0.7]) for (const b of [0, 4.25, 12]) {
    const offset = at(b, { left, scale });
    near(beatAt(l, { offset, beatOfX, scale }), b);
    near(beatAt(l + PPB * scale, { offset, beatOfX, scale }), b + 1);
  }
});

// ---------------------------------------------------------------- the fit
// The complaint this answers came in two parts: a strip engraved at one size floated
// in the middle of a laptop panel with notes too thin to read, and once it was grown,
// noteheads stepped over each other. So `fitFor` is given a measured engraving and
// asked for the next one; the checks below are that what comes back is bigger than
// what went in and that nothing collides.

// what one system of City of Stars' intro measures, engraved at scale 1 with the
// staves tight: 137px tall, 9.8px noteheads, and swung eighths a third of a beat apart
const HEAD = 9.81, TALL = 137;
const drawn = (scale, pxPerBeat, gaps = [1 / 3, 2 / 3]) => ({
  scale, height: TALL * scale,
  pairs: gaps.map(beats => ({ head: HEAD, beats })),
});
const laptop = { width: 738, height: 545 };
const wide = { width: 1138, height: 743 };
const phone = { width: 822, height: 133 };
/** Run the fit until it stops moving, the way the view does. */
const settle = (panel, gaps = [1 / 3, 2 / 3]) => {
  let f = { scale: 1, pxPerBeat: 60 };
  for (let i = 0; i < 6; i++) f = fitFor(panel, drawn(f.scale, f.pxPerBeat, gaps));
  return { ...f, head: HEAD * f.scale, bars: panel.width / (4 * f.pxPerBeat),
           height: TALL * f.scale, tightest: Math.min(...gaps) * f.pxPerBeat - HEAD * f.scale };
};

test('no notehead ever steps over the next one, however big the staff is drawn', () => {
  // the bug the owner saw: swung eighths a third of a beat apart under 30px heads.
  // sixteenths, septuplets and a run of thirty-seconds are the same sum with a
  // smaller gap, so they are all checked here rather than only in the browser
  for (const panel of [laptop, wide, phone]) {
    for (const gaps of [[1 / 3, 2 / 3], [1 / 4], [1 / 7, 2 / 7], [1 / 8], [1]]) {
      const f = settle(panel, gaps);
      assert.ok(f.tightest >= 3.5,
        `${panel.width}x${panel.height} with a ${gaps[0]}-beat gap left ${f.tightest.toFixed(1)}px between heads`);
    }
  }
});

test('the notes are drawn far bigger than the plain engraving', () => {
  // what the owner asked for: on a laptop the heads were 9.8px and unreadable. A phone
  // in landscape has no height to give and keeps roughly the size it had.
  assert.ok(settle(laptop).head > 24, `${settle(laptop).head.toFixed(1)}px heads`);
  assert.ok(settle(wide).head > 40, `${settle(wide).head.toFixed(1)}px heads`);
  assert.ok(settle(phone).head >= HEAD * 0.9, `${settle(phone).head.toFixed(1)}px heads`);
});

test('a taller panel gets a bigger engraving, not more empty space', () => {
  const short = fitFor({ width: 738, height: 220 }, drawn(1, 60)).scale;
  const tall = fitFor({ width: 738, height: 545 }, drawn(1, 60)).scale;
  assert.ok(tall > short * 1.5, `${short} -> ${tall}`);
  assert.ok(tall > 1);                             // it grows, which is the bug it fixes
});

test('a phone in landscape is fitted to its short panel, not to a laptop', () => {
  const f = settle(phone);
  assert.ok(f.height <= phone.height, `${f.height.toFixed(0)}px in a ${phone.height}px panel`);
  assert.ok(f.height / phone.height > 0.85);       // and it fills it
});

test('there are always a couple of bars to read ahead of the line', () => {
  for (const panel of [laptop, wide, phone]) {
    const bars = settle(panel).bars;
    assert.ok(bars >= 1.9 && bars <= 3.1, `${panel.width}px panel: ${bars.toFixed(2)} bars`);
  }
});

test('dense bars buy their room with bars in view, not by shrinking to nothing', () => {
  // a run of thirty-seconds cannot be both readable and two bars wide
  const dense = settle(laptop, [1 / 8]);
  assert.ok(dense.bars >= 1.4, `${dense.bars.toFixed(2)} bars`);
  assert.ok(dense.head > 9, `${dense.head.toFixed(1)}px heads`);
});

test('the fit settles rather than oscillating', () => {
  let f = { scale: 1, pxPerBeat: 60 };
  const seen = [];
  for (let i = 0; i < 8; i++) { f = fitFor(laptop, drawn(f.scale, f.pxPerBeat)); seen.push(f.scale); }
  assert.ok(Math.abs(seen[7] - seen[6]) < 1e-9, seen.join(' '));
});

test('a bar takes about a third of the viewport before anything is measured', () => {
  for (const w of [844, 1280, 400]) {
    const bar = ppbFor(w) * 4;
    assert.ok(bar >= w / 4 && bar <= w / 2, `${w}px viewport gave a ${bar}px bar`);
  }
  assert.equal(ppbFor(100), 40);                   // never narrower than the floor
  assert.equal(ANCHOR, 0.3);
});

// -------------------------------------------------------- last-note room
// The last note of a loop used to vanish: the strip ended at the last bar line
// (plus 6px) and the svg was short of the grid at laptop scale. These checks are
// the trailer and the viewport, so a last-eighth vamp stays fully visible.

test('a last-eighth note keeps its whole head on the strip', () => {
  // City of Stars vamp: D3 on the last eighth. Laptop heads ~40px at 60px/beat.
  const headPx = 40, ppb = 60, gap = 4;
  const trail = trailingRoom(0.5, { pxPerBeat: ppb, headPx });
  assert.ok(0.5 * ppb + trail >= headPx + gap, `only ${0.5 * ppb + trail}px after onset`);
  assert.ok(trail > 6, 'the old PAD_RIGHT is not enough for a laptop head');
  // a note two beats from the end already has room inside the last bar
  assert.equal(trailingRoom(2, { pxPerBeat: ppb, headPx }), 6);
});

test('the last onset under the playhead is fully inside the panel', () => {
  // AC1 / AC2: not clipped by the right edge, the pinned header, or its fade
  const headPx = 40, fade = 24;
  for (const vw of [400, 822, 1138]) {            // phone portrait, phone landscape, laptop
    const left = Math.min(200, vw * 0.24);
    const line = lineAt(vw, ANCHOR, left);
    assert.ok(line + headPx <= vw, `${vw}px panel: last head clipped by the right edge`);
    assert.ok(line >= left + fade, `${vw}px panel: last head under the header fade`);
  }
});

test('the opening reserve does not shrink when the staff is drawn large', () => {
  // the bug: (span + 80) / scale reserved 80/scale user units for the clef
  const span = 1920;
  const extra = s => stripStaffWidth(span, s) - span / s;
  assert.ok(extra(3) >= 140, `scale 3 reserved only ${extra(3).toFixed(1)}`);
  assert.ok(extra(5) >= 140, `scale 5 reserved only ${extra(5).toFixed(1)}`);
  assert.equal(extra(1), extra(3));
  assert.equal(extra(3), extra(5));
});
