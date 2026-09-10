// Tap, and hold, on one button.
//
// The phone's transport is a single full-width button, because a phone on a music
// stand has room for one: a tap cycles Play -> Pause -> Resume, and a hold is Stop.
// Giving up your place has to cost something more than the tap that keeps it --
// pressing the same button twice is exactly how Stop used to be landed on by
// accident, which is what Pause was added to end.
//
// The timer is the easy half. The rest is everything that must *not* happen: a
// finger that slides off on its way to a scroll is not a tap and not a hold, the
// click the browser sends after a completed hold is that same press arriving a
// second time, and a mouse has to behave like a finger because the phone page is
// opened on a laptop to look at.
//
// No DOM in here. The caller hands it the two numbers off the event and its own
// timers, so the state machine can be run under `node --test`.

/** How long Stop takes to mean it. The button's fill crosses in the same time. */
export const HOLD_MS = 500;
/** Drift a press survives, in px. Past this the finger is going somewhere else. */
export const SLOP = 10;
/** How long a handled press keeps swallowing the click it is about to produce. */
export const CLICK_MS = 350;

/**
 * What the one button says, from the transport it is showing.
 *
 * Three states -- idle, running, held -- and one exception: a finger-pan on the
 * Scroll strip pauses on purpose and resumes itself when the finger lifts, so
 * mid-gesture the button must not offer to Resume something nobody thinks they
 * paused. Stop has no label: it is the hold, and the fill is what says so.
 */
export function transportLabel({ running, paused, scrubbing = false } = {}) {
  if (running) return '⏸ Pause';
  return paused && !scrubbing ? '▶ Resume' : '▶ Play';
}

/**
 * A press on one button.
 *
 *   tap   a press let go of before the hold -- Play / Pause / Resume
 *   hold  the press held the whole `ms` -- Stop
 *   cue   the fill: true while a hold is being waited for, false the moment it is
 *         no longer coming (fired, let go of, or wandered off)
 *
 * `down` / `move` / `up` / `cancel` take the pointer event; `click` answers the
 * one question the click handler has -- "is this click the press I just handled?"
 */
export function makePress({ tap = () => {}, hold = () => {}, cue = () => {},
                            ms = HOLD_MS, slop = SLOP, clickMs = CLICK_MS,
                            setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  let at = null;            // where the live press started, or null between presses
  let fired = false;        // the hold has gone off: the press is spent
  let timer = 0, mine = 0;  // the hold timer, and the swallow window after it
  let swallow = false;      // a click now belongs to a press this already answered

  const stopTimer = () => { if (timer) clearTimer(timer); timer = 0; };
  /** The press is over, one way or another; the click it leaves behind is ours. */
  const spend = () => {
    at = null;
    if (mine) clearTimer(mine);
    mine = setTimer(() => { swallow = false; mine = 0; }, clickMs);
  };

  return {
    /** True while a hold is still coming -- the fill is crossing. */
    get holding() { return !!at && !fired; },

    down(e = {}) {
      if (e.button) return;                  // right / middle: not this button's press
      stopTimer();
      at = { x: e.clientX ?? 0, y: e.clientY ?? 0 };
      fired = false;
      swallow = true;
      cue(true);
      timer = setTimer(() => {
        timer = 0; fired = true;
        cue(false);
        hold();
      }, ms);
    },

    move(e = {}) {
      if (!at || fired) return;
      const dx = (e.clientX ?? 0) - at.x, dy = (e.clientY ?? 0) - at.y;
      if (dx * dx + dy * dy <= slop * slop) return;
      // gone: a scroll, or a finger on its way somewhere. Neither a tap nor a stop,
      // and the click it may still leave behind is swallowed with the rest of it.
      stopTimer(); cue(false); spend();
    },

    up() {
      if (fired) { fired = false; spend(); return; }   // the hold already spoke
      if (!at) return;                                 // wandered off, or never began
      stopTimer(); cue(false); spend();
      tap();
    },

    /** The system took the pointer away (a call, the app going behind): nothing happened. */
    cancel() {
      if (!at && !fired) return;
      stopTimer(); fired = false; cue(false); spend();
    },

    /**
     * True when this click is the press just handled and should be dropped. A click
     * with no press behind it -- Space on the focused button, a headless harness --
     * is a tap the caller still has to make.
     */
    click() {
      const ours = swallow;
      swallow = false;
      if (mine) { clearTimer(mine); mine = 0; }
      return ours;
    },
  };
}
