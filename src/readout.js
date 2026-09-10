// The top bar's readouts: the spans that change while you play.
//
// Every page's bar is one row of fixed boxes with the status line taking the slack,
// so a readout that grows with its content does not "get wider" -- it shoves the
// controls beside it along, mid-practice, at the exact moment your eyes are on the
// music. The boxes are reserved in CSS; the text has to be trimmed to fit them here.

/** How many note names the held readout shows before it starts counting. */
export const HELD_MAX = 3;

/**
 * The notes held right now: the first `max` of them, then how many more.
 *
 *   ['C4']                       -> 'C4'
 *   ['C4', 'E4', 'G4']           -> 'C4 E4 G4'
 *   ['C4', 'E4', 'G4', 'B4', …]  -> 'C4 E4 G4 +2'
 *
 * Ten fingers down is a chord, not a bar-length label. Three names is what the
 * reserved box holds with a two-digit tail, and the count is the honest way to say
 * the rest: the keyboard under the bar is already showing every one of them in
 * colour, so this line is a glance, not the record.
 *
 * Empty is the empty string, and the pages keep their own idle dash for it.
 */
export function heldLabel(names, max = HELD_MAX) {
  const all = [...names];
  const keep = Math.max(1, Math.floor(max));
  if (!all.length) return '';
  if (all.length <= keep) return all.join(' ');
  return `${all.slice(0, keep).join(' ')} +${all.length - keep}`;
}
