// The composer's transport: one clock, the piece's notes scheduled ahead onto the
// MIDI port, and a click. It is Learn's recipe without the tutor -- nothing here
// scores, waits or teaches, so the only questions are what sounds, when, and where
// the playhead is.
//
// Two things are worth saying out loud:
//   * positions in a piece are always *straight*; the swing is put back here, at the
//     last moment, with `swungBeat` -- exactly as Learn plays City of Stars. So an
//     edit made on the roll is an edit to the written music, not to a groove.
//   * a selection loops. Auditioning two bars you have just changed is the whole
//     reason the editor is worth having, and looping them is one `mod` in `pump`.
//
// The clock and the metronome are injected, so this whole file runs under
// `node --test` against a fake clock -- see test/composer-app.test.mjs.

import { send as midiSend, panic as midiPanic } from '../midi.js';
import { makeMetronome } from '../metronome.js';
import { swungBeat } from '../song.js';
import { beatsPerBarOf, swingOf, barsOf } from './piece.js';

export const LOOKAHEAD_MS = 120;   // how far ahead the port is kept fed
export const TICK_MS = 25;         // how often we look
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
export function makeTransport({ clock, metro, send = midiSend, panic = midiPanic } = {}) {
  const click = metro ?? makeMetronome(clock);
  click.setEnabled(false);
  let piece = null;
  let sel = null;                  // { from, to } in beats, or null for the whole piece
  let timer = null, sched = 0, mode = 'idle';   // 'idle' | 'play' | 'rec'
  let countIn = 0;                 // beats of click before beat 0, 0 when playing back
  const listeners = new Map();     // event -> Set(fn)

  const bpb = () => beatsPerBarOf(piece);
  const sw = () => swingOf(piece);
  const endBeat = () => barsOf(piece) * bpb();
  const span = () => (sel ? sel.to - sel.from : endBeat());
  const start0 = () => (sel ? sel.from : 0);

  const emit = (name, arg) => { for (const fn of listeners.get(name) ?? []) fn(arg); };

  /** A selection loops so you can hear an edit; a take is recorded against the piece. */
  const looping = () => mode === 'play' && !!sel;

  /**
   * Everything sounding between two absolute beats, one cycle of the loop at a time.
   * A cycle is a whole number of beats, so shifting one by `c * len` leaves the swing
   * alone -- `swungBeat` only ever moves the offbeat eighth of its own beat.
   */
  function emitNotes(from, to) {
    if (!piece || to <= from) return;
    const s = sw(), base = looping() ? sel.from : 0, len = looping() ? span() : endBeat();
    if (len <= 0) return;
    const c1 = looping() ? Math.floor((to - 1e-9 - base) / len) : 0;
    for (let c = Math.max(0, Math.floor((from - base) / len)); c <= c1; c++) {
      const off = c * len;
      for (const n of piece.notes) {
        if (n.b < base - 1e-9 || n.b >= base + len - 1e-9) continue;
        const b = off + swungBeat(n.b, s);
        if (b < from || b >= to) continue;
        send([0x90, n.n, n.v ?? 80], clock.time(b));
        send([0x80, n.n, 0], clock.time(off + swungBeat(n.b + n.len, s)));
      }
    }
  }

  /** One scheduling round. `play()` runs this on a timer; tests drive it by hand. */
  function pump() {
    if (mode === 'idle') return;
    const now = clock.beat();
    const perBeat = 60000 / clock.bpm;
    const until = now + LOOKAHEAD_MS / perBeat;
    sched = Math.max(sched, now - PAST_MS / perBeat);   // a stall drops what is long gone
    emitNotes(sched, until);          // recording is an overdub: the piece plays under you
    sched = Math.max(sched, until);
    click.pump(LOOKAHEAD_MS);
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
    clock.start(atBeat);
    sched = atBeat;
    click.setRange(atBeat, Infinity);
    click.setAccent(bpb(), 0);
    click.start(atBeat);
    timer = setInterval(pump, TICK_MS);
    pump();
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
    if (mode === 'idle') return;
    mode = 'idle';
    click.stop();
    clock.stop();
    panic();
    // whatever was already handed to the port still has to be caught
    setTimeout(panic, LOOKAHEAD_MS + 20);
    emit('tick', position());
    emit('end');
  }

  return {
    pump, position,
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

    load(p) { piece = p; if (p?.bpm) clock.setBpm(p.bpm); },
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
