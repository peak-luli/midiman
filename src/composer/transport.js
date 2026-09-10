// The composer's end of the transport: a piece, made into one more source for the
// looper's scheduler (`src/transport.js`). The clock, the look-ahead window, the click,
// the stop and the panic are all that file's; what is left here is what a *piece* is:
//
//   * positions in a piece are always *straight*; the swing is put back on the way to
//     the port, with `swungBeat` -- exactly as Learn plays City of Stars. So an edit
//     made on the roll is an edit to the written music, not to a groove.
//   * a selection loops. Auditioning two bars you have just changed is the whole
//     reason the editor is worth having, and looping them is one `loop:` on the source.
//
// The clock and the metronome are injected, so this whole file runs under
// `node --test` against a fake clock -- see test/composer-app.test.mjs.

import { swungBeat } from '../song.js';
import { makeScheduler, LOOKAHEAD_MS, TICK_MS } from '../transport.js';
import { beatsPerBarOf, swingOf, barsOf } from './piece.js';

export { LOOKAHEAD_MS, TICK_MS };

// A note this recently gone is still sent, rather than dropped as "in the past":
// the first round happens a hair after the clock starts, and without this margin
// the downbeat you started on is the one note that never sounds.
const PAST_MS = 20;

/**
 * @param clock   a `makeClock()`; beats are the ruler for everything.
 * @param metro   a metronome on the same clock (made here unless a test passes one).
 * @param send    where notes go (midi.js `send`, or a spy).
 * @param panic   all notes off (midi.js `panic`, or a spy).
 */
export function makeTransport({ clock, metro, send, panic } = {}) {
  const sched = makeScheduler({ clock, metro, send, panic, fill });
  const click = sched.metro;
  click.setEnabled(false);
  let piece = null, voiced = null;
  let sel = null;                  // { from, to } in beats, or null for the whole piece
  let cursor = 0, mode = 'idle';   // 'idle' | 'play' | 'rec'
  let countIn = 0;                 // beats of click before beat 0, 0 when playing back
  const listeners = new Map();     // event -> Set(fn)

  const bpb = () => beatsPerBarOf(piece);
  const endBeat = () => barsOf(piece) * bpb();
  const span = () => (sel ? sel.to - sel.from : endBeat());
  const start0 = () => (sel ? sel.from : 0);

  const emit = (name, arg) => { for (const fn of listeners.get(name) ?? []) fn(arg); };

  /** A selection loops so you can hear an edit; a take is recorded against the piece. */
  const looping = () => mode === 'play' && !!sel;

  /**
   * The piece as the port wants it: pitches under `p`, and the swing put back in, once
   * per edit rather than once per round. A cycle of a loop is a whole number of beats,
   * so repeating one leaves the swing alone -- `swungBeat` only ever moves the offbeat
   * eighth of its own beat.
   */
  function voice() {
    if (voiced) return voiced;
    const s = swingOf(piece);
    voiced = (piece?.notes ?? []).map(n => {
      const b = swungBeat(n.b, s);
      return { b, p: n.n, len: swungBeat(n.b + n.len, s) - b, v: n.v ?? 80 };
    });
    return voiced;
  }

  /** One window of the transport's loop: the piece, or the bars picked out of it. */
  function fill(now, until) {
    if (mode === 'idle') return false;
    cursor = Math.max(cursor, now - PAST_MS / (60000 / clock.bpm));  // a stall drops what is long gone
    const base = looping() ? sel.from : 0;
    // recording is an overdub: the piece plays under you
    sched.emit(voice(), Math.max(cursor, base), until, { base, loop: looping() ? span() : 0 });
    cursor = Math.max(cursor, until);
    emit('tick', position());
    // playing the whole piece once: stop when the last note has sounded and rung out
    if (mode === 'play' && !looping() && now >= endBeat()) stop();
  }

  function position() {
    const beat = clock.beat();
    return {
      beat, running: mode !== 'idle', recording: mode === 'rec',
      countIn: beat < 0,
      // where the playhead sits in the piece: the count-in is behind beat 0, and a
      // looping selection wraps inside itself
      at: beat < 0 ? beat
        : looping() ? start0() + ((beat - start0()) % Math.max(1e-9, span()))
          : beat,
      bar: Math.floor(Math.max(0, beat) / bpb()),
      beatInBar: Math.floor(Math.max(0, beat) % bpb()),
    };
  }

  function begin(atBeat, how) {
    stop();
    mode = how;
    countIn = atBeat < 0 ? -atBeat : 0;
    cursor = atBeat;
    click.setRange(atBeat, Infinity);
    click.setAccent(bpb(), 0);
    sched.start(atBeat);
  }

  function stop() {
    if (mode === 'idle') return;
    mode = 'idle';
    sched.stop();
    emit('tick', position());
    emit('end');
  }

  return {
    pump: sched.pump, position,
    get piece() { return piece; },
    get running() { return mode !== 'idle'; },
    get recording() { return mode === 'rec'; },
    get selection() { return sel; },
    get countIn() { return countIn; },
    get clickOn() { return click.enabled; },

    on(name, fn) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(fn);
      return () => listeners.get(name).delete(fn);
    },

    load(p) { piece = p; voiced = null; if (p?.bpm) clock.setBpm(p.bpm); },
    /** A selection is the loop; clearing it puts the whole piece back. */
    setSelection(s) { sel = s && s.to > s.from ? { from: s.from, to: s.to } : null; },
    setClick(on) { click.setEnabled(!!on); },
    setBpm(v) { clock.setBpm(v); },

    /** Play from beat 0, or from the top of the selection when there is one. */
    play() { if (piece) begin(start0(), 'play'); },
    /** Record: one bar of count-in on the click, then the buffer does the rest. */
    record() { if (piece) begin(-bpb(), 'rec'); },
    stop,
  };
}
