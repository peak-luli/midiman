// The camera of the scrolling staff: one sum, kept on its own because it is the
// only part of that view worth being sure about.
//
// The strip is one long picture of the loop and `x(beat)` says how far into it a
// beat falls. The line stands `anchor` of the way across the viewport and never
// moves, so the strip is simply pushed left by however much further in than the
// line beat `b` is:
//
//     offset = left + anchor * (viewWidth - left) - scale * x(b)
//
// `left` is the strip's fixed header -- the clefs, key and time signature are pinned
// to the left edge rather than scrolled away, because you need to see the flats to
// read the notes. The music therefore starts after it, and the line stands `anchor`
// of the way across what is left.
//
// `scale` is the shrink the view applies when the engraving is taller than the
// panel: it is a CSS transform on the same wrapper, `translateX(off) scale(k)`,
// which maps a strip pixel p to off + k*p, so the offset has to be in the scaled
// space too.
//
// Nothing is clamped, and both ends of that are deliberate:
//   - at the start the offset is positive, so the first bar stands at the line and
//     the strip runs off to the right. During the count-in the beat is negative and
//     the strip is further right still, sliding in so that bar 1 reaches the line
//     exactly on beat 0 -- the count-in is *seen*, not just heard.
//   - at the end nothing stops: the last bar passes under the line and out to the
//     left, which is the whole point of a fixed playhead. Clamping there would park
//     the last notes at the right edge and make you read them out of time.
// Looping is then nothing: the beat drops back to 0 and so does the offset.

/** The translateX that puts `x(beat)` under the line. */
export function offsetFor(beat, { viewWidth, anchor = 0.3, x, scale = 1, left = 0 }) {
  return lineAt(viewWidth, anchor, left) - scale * x(beat);
}

/** Where the line stands: `anchor` across the panel, past the pinned header. */
export function lineAt(viewWidth, anchor = 0.3, left = 0) {
  return left + anchor * (viewWidth - left);
}

/** Its inverse: the loop beat a point `px` across the viewport is over. */
export function beatAt(px, { offset, beatOfX, scale = 1 }) {
  return beatOfX((px - offset) / scale);
}

/**
 * Slide the strip with a finger. `dx` is viewport pixels, same sign as the
 * finger -- left, the music goes left -- so the motion is 1:1 and never inverted.
 * The beat under the line after that slide is the camera's inverse, so a later
 * seek there puts the playhead back on the same notes without a jump.
 */
export function panBy(dx, { offset, beatOfX, scale = 1, viewWidth, anchor = 0.3, left = 0 }) {
  const next = offset + dx;
  return { offset: next, beat: beatAt(lineAt(viewWidth, anchor, left), { offset: next, beatOfX, scale }) };
}
