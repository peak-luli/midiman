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
// Play is not clamped, and both ends of that are deliberate:
//   - at the start the offset is positive, so the first bar stands at the line and
//     the strip runs off to the right. During the count-in the beat is negative and
//     the strip is further right still, sliding in so that bar 1 reaches the line
//     exactly on beat 0 -- the count-in is *seen*, not just heard.
//   - at the end nothing stops: the last bar passes under the line and out to the
//     left, which is the whole point of a fixed playhead. Clamping there would park
//     the last notes at the right edge and make you read them out of time.
// Looping is then nothing: the beat drops back to 0 and so does the offset.
//
// A finger pan is different: the engine can only seek inside the loop, so the line
// is held to that same range while the finger is down. Otherwise a drag past 0 or
// past the last bar would draw one beat and seek another, and follow would jump.

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
 *
 * Pass `x`, `minBeat` and `maxBeat` to stop the line at the loop ends -- the
 * hard stop that matches a clamped seek, not a rubber-band. Play still uses
 * `offsetFor` unclamped, so count-in and the last bar passing are untouched.
 *
 * Count-in starts behind beat 0. `panMinBeat` keeps that negative line so the
 * first finger move slides 1:1 instead of jumping to 0; the seek still clamps.
 */
export function panBy(dx, {
  offset, beatOfX, scale = 1, viewWidth, anchor = 0.3, left = 0,
  x, minBeat, maxBeat,
}) {
  const next = offset + dx;
  let beat = beatAt(lineAt(viewWidth, anchor, left), { offset: next, beatOfX, scale });
  if (x && minBeat != null && beat < minBeat) {
    beat = minBeat;
    return { offset: offsetFor(beat, { viewWidth, anchor, x, scale, left }), beat };
  }
  if (x && maxBeat != null && beat > maxBeat) {
    beat = maxBeat;
    return { offset: offsetFor(beat, { viewWidth, anchor, x, scale, left }), beat };
  }
  return { offset: next, beat };
}

/** Lowest line beat a finger may hold: 0 in the loop, or the count-in beat it is already on. */
export function panMinBeat(lineBeat) {
  return lineBeat < 0 ? lineBeat : 0;
}

/**
 * A finger left the strip on `parkedBeat`, from engine beat `fromBeat`.
 * The old clock staying near the parked line is not a landed seek -- a short
 * drag is often closer than a beat, and a mirror has not moved yet. Ready
 * only once follow is closer to the parked target than to that old clock
 * (the seek landed, or wait-mode snapped to a group).
 */
export function followReady(engineBeat, parkedBeat, fromBeat = null) {
  if (parkedBeat == null) return true;
  if (fromBeat == null) return false;
  const toFrom = Math.abs(engineBeat - fromBeat);
  const toPark = Math.abs(engineBeat - parkedBeat);
  return toFrom > toPark;
}

/**
 * A mirror snapshot just arrived. If its clock origin jumped, commit the
 * Scroll that was parked -- not whichever view is on screen now. Leaving
 * Scroll before the snapshot lands must not leave that strip frozen.
 * Returns the park to keep, or null once it has been committed.
 */
export function releaseRemotePark(park, snapshot) {
  if (!park) return null;
  if (snapshot.t0 === park.t0 && snapshot.startAt === park.startAt) return park;
  park.scroll?.commitPan?.();
  return null;
}
