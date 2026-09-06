// What a pass means, and how passes add up to a finished step.
//
// The rule is the same in the tutor and in free practice, and has to be the same
// on the laptop and on the phone: a pass is judged on accuracy alone, a pass at or
// above the challenge's level extends the streak, and one below it starts the
// streak again from pass 1. A pass that has just failed is held on the meter for a
// moment before the slots reset, so you see what happened rather than watching the
// slots blank for no visible reason.

import { passed, splitExtras, expectedOf } from './scorer.js';
import { YOU } from './plan.js';

export const FAIL_HOLD_MS = 1500;

/** The streak behind a passes challenge: push a pass in, ask what the meter should show. */
export function makeStreak() {
  let passes = [], streak = 0;
  return {
    get streak() { return streak; },
    get passes() { return passes; },
    reset() { passes = []; streak = 0; },

    /** Record a pass at the challenge's level. Returns { ok, no, streak } -- `no` is 1-based. */
    push(result, accuracy) {
      const ok = passed(result, accuracy);
      const no = streak + 1;
      passes.push({ ...result, ok, at: performance.now() });
      streak = ok ? streak + 1 : 0;
      return { ok, no, streak };
    },

    /** The passes the meter shows: the running streak, or a just-failed pass, held. */
    results(now = performance.now()) {
      const last = passes[passes.length - 1];
      if (streak === 0 && last && !last.ok && now - last.at < FAIL_HOLD_MS) return [last];
      return passes.slice(passes.length - streak);
    },
  };
}

/**
 * Notes played outside your part. Your part is the hands set to You, so a note that
 * belongs to a hand the app is playing beside you -- or to one switched off -- is
 * outside it, not wrong. They land in the pass's extras; take them back out, the
 * same rule the engine applies live (see its `otherExp`).
 *
 * Mutates `result` (extras down, `ignored` set) and returns how many were ignored.
 */
export function ignoreOtherHand(result, { song, engine, swung }) {
  const others = ['lh', 'rh'].filter(h => engine.hands[h] !== YOU);
  if (!others.length || !engine.tally?.extras.length) return 0;
  const other = expectedOf(song, engine.from, engine.to, others, swung)
    .map(e => ({ ...e, b: e.b - engine.loopStart }));
  const { outside } = splitExtras(engine.tally.extras, other, engine.loopLen);
  result.extras -= outside.length;
  result.ignored = outside.length;
  return outside.length;
}

/** What the step asks of you, in words. */
export const goalText = ch => !ch || ch.kind === 'none' ? 'Play it as often as you like.'
  : ch.kind === 'window' ? `${Math.round(ch.accuracy * 100)}% of the notes over the last ${ch.seconds} s.`
  : ch.n > 1 ? `${ch.n} passes in a row at ${Math.round(ch.accuracy * 100)}% or better.`
  : `One pass at ${Math.round(ch.accuracy * 100)}% or better.`;

/**
 * Whether the tutor may auto-advance after this streak. Listen is done when the
 * app has played it through (an empty pass). Every other step needs the
 * challenge's streak of *played* passes -- a wrap with nothing to score, or a
 * find-notes hunt that was seeked past, must not yank the next step in.
 *
 * Laptop and phone both call this; the gate has to be the same sentence.
 */
export function stepCleared(step, streak) {
  const need = step.challenge?.n ?? 1;
  if (streak.streak < need) return false;
  if (step.kind === 'listen') return true;
  const rows = streak.results();
  if (rows.length < need) return false;
  const hunt = step.wait || step.kind === 'notes';
  return rows.every(r => r.ok && r.total > 0 && !(hunt && r.skipped > 0));
}
