// How loud Guide plays your hand.
//
// Guide is the app playing the hand you are learning along with you, quietly, so the
// notes are in your ear while your fingers look for them. "Quietly" used to be one
// fixed velocity; this is the dial on it. The level is a share of the velocity the
// app uses for its own hands (see VEL in engine.js), so 100% is the guide as loud as
// the app plays a hand it owns, and the default sits where the fixed number was.
//
// A percentage on screen, a fraction in the engine and on the wire. The clamp is the
// one rule both pages and the phone's mirror apply, so a number typed, tapped or
// relayed lands inside the same range everywhere.

export const GUIDE_VOL = 0.45;                          // the default, about the old fixed velocity
export const GUIDE_VOL_MIN = 0.05, GUIDE_VOL_MAX = 1;   // never silent: off is what the Guide button is for
export const GUIDE_PCT_STEP = 5;                        // one tap of the phone's stepper

/** A level the engine will take: inside the range, and the default for anything that is not a number. */
export const clampGuideVol = v =>
  (Number.isFinite(v) ? Math.min(GUIDE_VOL_MAX, Math.max(GUIDE_VOL_MIN, v)) : GUIDE_VOL);

/** The level as the readouts show it. */
export const guidePct = v => Math.round(clampGuideVol(v) * 100);

/** A typed or tapped percentage back into a level. */
export const guideVolOfPct = p => clampGuideVol(p / 100);

/** Both learn pages remember the level under this key, as a percentage. */
export const GUIDE_VOL_KEY = 'middleman.learn.guidevol';
