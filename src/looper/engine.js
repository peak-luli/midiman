// The looper's engine: what a lane holds, when a take opens and closes, and what the
// four lanes hand to the transport. The scheduling itself is `src/transport.js` -- one
// clock, several sources, all queued ahead onto the same port -- and a lane is simply
// one of those sources, sitting next to the backing track.
//
// Two timings are deliberately different. Playback is scheduled a little into the
// future, so the port always has work queued. Recording is resolved against the real
// present, because a take is pulled out of the buffer after the fact -- which is why
// arming late costs nothing.

import { panic } from '../midi.js';
import { makeScheduler } from '../transport.js';
import { build } from '../tracks.js';
import { mod } from '../clock.js';
import {
  newSlot, slotNotes, foldTake, GRIDS, SNAPS, defaultMode, defaultFollow,
} from './loops.js';

export const COUNT_IN = 4;              // beats of click before the first chorus

/** build() hands back separate note-ons and note-offs; pair them back into notes. */
function pairNotes(evs) {
  const open = new Map(), out = [];
  for (const e of evs) {
    if (e.on) {
      const n = { b: e.b, len: 0.1, p: e.n, v: e.v };
      open.set(e.n, n);
      out.push(n);
    } else {
      const n = open.get(e.n);
      if (n) { n.len = Math.max(0.03, e.b - n.b); open.delete(e.n); }
    }
  }
  return out.sort((a, b) => a.b - b.b);
}

export function makeEngine({ clock, buffer }) {
  let track = null, backing = [], bars = [], nbars = 0, formBeats = 0;
  const slots = [0, 1, 2, 3].map(newSlot);
  let grid = 0, strength = 1, snap = 0;
  let backOn = true;
  let rev = 0;
  let backSched = 0;
  // one scheduler for the lot: the backing track and the four lanes are its sources
  const sched = makeScheduler({ clock, fill: tick });
  // the click lives on the same clock; accent on beat 1 of the form, from beat 0
  const metro = sched.metro;
  metro.setEnabled(false);
  metro.setAccent(4, 0);
  metro.setRange(-COUNT_IN, Infinity);
  const cache = new Map();

  const q = () => ({ div: GRIDS[grid].div, strength });
  const snapBeats = () => (SNAPS[snap].bars ? SNAPS[snap].bars * 4 : formBeats) || 4;
  const bump = () => { rev++; cache.clear(); };

  /** One chorus of a loop, expanded and memoised -- the UI draws the same list. */
  function notesOf(i) {
    const key = i + ':' + rev;
    let v = cache.get(key);
    if (!v) { v = slotNotes(slots[i], track, q()); cache.set(key, v); }
    return v;
  }

  /** What a lane is taking in right now, drawn while it records. */
  function liveNotes(i) {
    const s = slots[i];
    if (s.st !== 'rec' && s.st !== 'dub') return [];
    const now = clock.beat();
    if (now <= s.recStart) return [];
    const from = s.recStart;
    // a take can run past the end of the chorus, so it wraps round in the roll
    return buffer.slice(from, Math.max(from + 0.001, now)).map(n => ({
      b: mod(from + n.b, formBeats), p: n.p, len: n.len, v: n.v, ghost: false,
    }));
  }

  const audible = s =>
    s.st !== 'empty' && !s.mute && s.layers.length
    && (!slots.some(x => x.solo && x.st !== 'empty') || s.solo);

  // The velocities go out as they were written or played: send() scales every note
  // the app plays by the volume level, the backing track and a recorded loop alike --
  // a loop coming back out of the app is the app, not you playing it again.
  const emit = (notes, from, to) => sched.emit(notes, from, to, { loop: formBeats });

  /** One window of the transport's loop: what the backing and the lanes sound in it. */
  function tick(now, until) {
    resolve(now);

    if (backOn) {
      backSched = Math.max(backSched, now, 0);
      emit(backing, backSched, until);
    }
    backSched = Math.max(backSched, until);

    for (const s of slots) {
      s.sched = Math.max(s.sched, now);
      if (audible(s)) emit(notesOf(s.i), s.sched, until);
      s.sched = Math.max(s.sched, until);
    }
  }

  /** Anything queued lands on its line. Recording lines are resolved against `now`. */
  function resolve(now) {
    for (const s of slots) {
      if (!s.pend || s.pendAt > now) continue;
      if (s.pend === 'rec') {
        s.st = 'rec'; s.recStart = s.pendAt; s.layers = []; s.undo = [];
      } else if (s.pend === 'dub') {
        s.st = 'dub'; s.recStart = s.pendAt;
      } else {
        const end = Math.min(s.pendAt, s.recStart + formBeats);
        const take = buffer.slice(s.recStart, end);
        if (s.st === 'rec') {
          s.lenBars = Math.max(1, Math.min(nbars, Math.round((end - s.recStart) / 4)));
          s.fromBar = mod(Math.floor(s.recStart / 4), nbars);
          s.mode = defaultMode(s.lenBars, nbars);
          s.follow = defaultFollow(s.lenBars, track.form);
          s.layers = [take.filter(n => n.b < s.lenBars * 4)];
          if (!s.name) s.name = 'Loop ' + (s.i + 1);
        } else if (s.st === 'dub' && take.length) {
          s.layers.push(foldTake(take, s, s.recStart, formBeats));
        }
        s.st = 'play';
        s.sched = s.pendAt;
        s.undo = [];
      }
      s.pend = null;
      bump();
    }
  }

  const lineNear = b => Math.round(b / snapBeats()) * snapBeats();
  /** Capture always snaps to a bar, whatever the record snap is set to. */
  const lineNearBar = b => Math.round(b / 4) * 4;

  return {
    slots,
    get track() { return track; },
    get bars() { return bars; },
    get nbars() { return nbars; },
    get formBeats() { return formBeats; },
    get rev() { return rev; },
    get grid() { return grid; },
    get strength() { return strength; },
    get snap() { return snap; },
    get metroOn() { return metro.enabled; },
    get backOn() { return backOn; },
    notesOf, liveNotes, audible, snapBeats,
    /** One scheduling pass. play() runs this on a timer; tests drive it by hand. */
    pump: sched.pump,

    load(t) {
      this.stop();
      track = t;
      const b = build(t, 1);
      nbars = b.nbars;
      formBeats = b.formBeats;
      bars = b.bars.slice(0, nbars);
      // one chorus, without the count-in and without the written melody -- in the
      // looper the melody is whatever you play
      backing = pairNotes(b.ev.filter(e => e.b >= b.start && !e.mel)
        .map(e => ({ ...e, b: e.b - b.start })))
        .filter(n => n.b < formBeats);
      slots.forEach((s, i) => Object.assign(s, newSlot(i)));
      buffer.clear();          // the old track's beats mean nothing against the new form
      clock.setBpm(t.bpm);
      bump();
    },

    play() {
      if (!track || sched.running) return;
      backSched = -COUNT_IN;
      slots.forEach(s => { s.sched = -COUNT_IN; });
      buffer.clear();
      sched.start(-COUNT_IN);
    },

    stop() {
      sched.stop(() => {
        // close any take that was running rather than throwing it away
        const now = clock.beat();
        for (const s of slots) {
          if (s.st !== 'rec' && s.st !== 'dub') { s.pend = null; continue; }
          const end = Math.max(Math.floor(now / 4) * 4, s.recStart + 4);
          s.pend = 'play';
          s.pendAt = end;
        }
        resolve(Infinity);
      });
      bump();
    },

    get running() { return sched.running; },

    setBpm(v) { clock.setBpm(v); },
    setMetro(v) { metro.setEnabled(v); },
    setBacking(v) { backOn = v; if (!v) panic(); },
    setGrid(i) { grid = mod(i, GRIDS.length); bump(); },
    setStrength(v) { strength = Math.max(0, Math.min(1, v)); bump(); },
    setSnap(i) { snap = mod(i, SNAPS.length); },

    /** The one-key cycle: record -> end -> overdub -> end. */
    press(i) {
      const s = slots[i];
      if (!track) return;
      const now = clock.beat(), L = lineNear(now);
      if (s.st === 'empty') {
        if (s.pend === 'rec') { s.pend = null; return; }        // pressed twice: cancel
        s.pend = 'rec'; s.pendAt = Math.max(L, 0);
      } else if (s.st === 'rec' || s.st === 'dub') {
        s.pend = 'play'; s.pendAt = Math.max(L, s.recStart + snapBeats());
      } else {
        if (s.pend === 'dub') { s.pend = null; return; }
        s.pend = 'dub'; s.pendAt = L;
      }
      bump();
    },

    /** Take the last `bars` bars straight out of the buffer -- no arming at all. */
    capture(i, capBars, offBars = 0) {
      const s = slots[i];
      if (!track) return false;
      const end = lineNearBar(clock.beat()) - offBars * 4;
      const start = end - capBars * 4;
      if (end - buffer.span > start) return false;
      const take = buffer.slice(start, end);
      if (!take.length) return false;
      const prev = s.st !== 'empty' ? { ...s, layers: s.layers.slice() } : null;
      s.st = 'play';
      s.pend = null;
      s.lenBars = Math.max(1, Math.min(nbars, capBars));
      s.fromBar = mod(Math.floor(start / 4), nbars);
      s.mode = defaultMode(s.lenBars, nbars);
      s.follow = defaultFollow(s.lenBars, track.form);
      s.layers = [take];
      s.undo = prev ? [{ whole: prev }] : [];
      s.sched = clock.beat();
      if (!s.name) s.name = 'Capture ' + (i + 1);
      bump();
      return true;
    },

    /** Undo takes off the last overdub -- or puts back a lane you cleared. */
    undo(i) {
      const s = slots[i];
      if (s.layers.length > 1) { s.undo.push({ layer: s.layers.pop() }); bump(); return; }
      const last = s.undo[s.undo.length - 1];
      if (last?.whole) { s.undo.pop(); Object.assign(s, last.whole, { i, undo: s.undo }); bump(); }
    },

    redo(i) {
      const s = slots[i];
      const last = s.undo[s.undo.length - 1];
      if (last?.layer) { s.undo.pop(); s.layers.push(last.layer); bump(); }
    },

    /** Clearing is undoable, so it needs no confirmation. */
    clear(i) {
      const s = slots[i];
      if (s.st === 'empty') return;
      const prev = { ...s, layers: s.layers.slice() };
      Object.assign(s, newSlot(i), { undo: [{ whole: prev }] });
      panic();
      bump();
    },

    stopAll() {
      slots.forEach(s => { s.pend = null; if (s.st === 'rec' || s.st === 'dub') s.st = s.layers.length ? 'play' : 'empty'; });
      bump();
    },

    patch(i, fn) { fn(slots[i]); bump(); },

    /** Where every lane's material is sounding right now, for the key strip. */
    sounding(beat) {
      const out = new Map();
      const inCycle = mod(beat, formBeats);
      for (const s of slots) {
        if (!audible(s)) continue;
        for (const n of notesOf(s.i))
          if (inCycle >= n.b && inCycle < n.b + n.len) out.set(n.p, s.i);
      }
      return out;
    },

    backingSounding(beat) {
      const out = new Set();
      if (!backOn || !formBeats) return out;
      const inCycle = mod(beat, formBeats);
      for (const n of backing) if (inCycle >= n.b && inCycle < n.b + n.len) out.add(n.p);
      return out;
    },
  };

}
