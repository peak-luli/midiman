/**
 * Between-step and start-step gates (issue #44).
 *
 * One story, two locks, both Learn pages:
 *   1. After a step is done, the next one does not start by itself.
 *   2. A piano / MIDI note never starts a step and never skips the handoff.
 * Space, the Start button, Next / Go now, and a click on the done card do.
 */

/** Space, Start, Next, overlay / Go now click. */
export const INTENT = 'intent';
/** A piano or MIDI note. */
export const NOTE = 'note';
/** Time passing on the done card. */
export const TIMER = 'timer';

/** Load-and-start the next step from the done / waiting handoff? */
export const mayAdvance = source => source === INTENT;

/** Start transport on a waiting (idle) step? */
export const mayStart = source => source === INTENT;
