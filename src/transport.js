// The transport, shared by every page that plays: one clock, several sources, all
// scheduled ahead onto the same MIDI port. The backing track is just another source,
// and so is every loop, and so is a piece in the composer.
//
// There is only ever one scheduling loop in the app, and it is here. A page brings its
// own answer to "what sounds between these two beats" (`fill`) and its own idea of what
// a source is; what it does not bring is a second look-ahead window, a second timer, a
// second way of stopping, or a second panic -- those went wrong in different ways on
// different pages, which is the whole reason this file exists.
//
// Two timings are deliberately different. Playback is scheduled a little into the
// future, so the port always has work queued. Recording is resolved against the real
// present, because a take is pulled out of the buffer after the fact -- which is why
// arming late costs nothing.

import { send as midiSend, panic as midiPanic } from './midi.js';
import { makeMetronome } from './metronome.js';

export const LOOKAHEAD_MS = 120;   // how far ahead the port is kept fed
export const TICK_MS = 25;         // how often we look

/**
 * Every note of `notes` that sounds in `[from, to)`, handed to the port with the
 * performance-time each one falls on.
 *
 * `loop` is the length of one cycle: the source repeats every `loop` beats, and only
 * the notes inside `[base, base + loop)` belong to it. `loop = 0` plays the list once,
 * where it is written. Beats are absolute and can be negative -- a loop is already
 * cycling during the count-in, which is what makes a lane come in on time.
 */
export function emitNotes(notes, from, to, { send, clock, base = 0, loop = 0 }) {
  if (to <= from || !notes.length) return;
  const c0 = loop > 0 ? Math.floor((from - base) / loop) : 0;
  const c1 = loop > 0 ? Math.floor((to - 1e-9 - base) / loop) : 0;
  for (let c = c0; c <= c1; c++) {
    const off = c * loop;
    for (const n of notes) {
      if (loop > 0 && (n.b < base - 1e-9 || n.b >= base + loop - 1e-9)) continue;
      const b = n.b + off;
      if (b < from || b >= to) continue;
      send([0x90, n.p, n.v], clock.time(b));
      send([0x80, n.p, 0], clock.time(b + n.len));
    }
  }
}

/**
 * The scheduling loop itself.
 *
 * @param clock  a `makeClock()`; beats are the ruler for everything.
 * @param metro  a metronome on the same clock (made here unless one is passed in).
 * @param send   where notes go (midi.js `send`, or a spy).
 * @param panic  all notes off (midi.js `panic`, or a spy).
 * @param fill   `(now, until) -> void`, one window's worth of scheduling. Returning
 *               `false` means "nothing is running", and the click is left alone too.
 *
 * The clock, the click and the port are all injected, so a page built on this runs
 * under `node --test` against a fake clock and a spy -- see test/transport.test.mjs.
 */
export function makeScheduler({ clock, metro, send = midiSend, panic = midiPanic, fill }) {
  const click = metro ?? makeMetronome(clock);
  let timer = null;

  /** One scheduling round. `start()` runs this on a timer; tests drive it by hand. */
  function pump() {
    const now = clock.beat();
    const ahead = LOOKAHEAD_MS / (60000 / clock.bpm);
    if (fill(now, now + ahead) === false) return;
    click.pump(LOOKAHEAD_MS);
  }

  return {
    metro: click,
    pump,
    get running() { return !!timer; },

    /** Schedule one source's notes into this window. */
    emit(notes, from, to, opts = {}) {
      emitNotes(notes, from, to, { send, clock, ...opts });
    },

    start(atBeat) {
      clock.start(atBeat);
      click.start(atBeat);
      timer = setInterval(pump, TICK_MS);
      pump();
    },

    /**
     * `closing` runs with the timer already off but the clock still where it was, so a
     * page can close whatever it had open (a running take) against the beat it stopped
     * on. Then everything goes quiet, twice: once now, and once after the window, to
     * catch what was already handed to the port.
     */
    stop(closing) {
      clearInterval(timer);
      timer = null;
      closing?.();
      click.stop();
      clock.stop();
      panic();
      setTimeout(panic, LOOKAHEAD_MS + 20);
    },
  };
}
