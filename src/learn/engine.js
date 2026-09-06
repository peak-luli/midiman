// The learn transport. One loop over a bar range of the song; each hand is either
// yours, the app's (sent to the piano), or off. Two ways of moving through it:
//
//   flow  -- the clock runs. App hands are scheduled ahead onto the MIDI port, the
//            click is scheduled with them, and what you play is tallied against the
//            expected onsets. Each time the loop wraps, a pass is reported.
//   wait  -- no clock, and so no click. A cursor sits on the next onset of your
//            hands; the app plays its own notes up to that point and waits until you
//            have played yours. The click setting is kept for when the clock returns.
//
// Beats are absolute on the shared clock; the loop starts at `loopStart` and wraps
// every `loopLen` beats. A count-in bar sits just before it.
//
// `seek(beat)` moves the playing position inside the loop -- the views hand it a
// click. Running, it re-anchors the clock, the click and the app's hands to the new
// beat; what it jumped over is taken out of the pass rather than counted as misses
// (and jumping back puts that stretch up for scoring again). Idle, it just sets
// where the next Play starts from.

import { send, panic } from '../midi.js';
import { makeMetronome } from '../metronome.js';
import { mod } from '../clock.js';
import { swungBeat } from '../song.js';
import { expectedOf, makeTally, groupsOf, WINDOW, liveOf, windowStats, splitExtras } from './scorer.js';
import { YOU, APP, OFF } from './plan.js';

const LOOKAHEAD_MS = 120, TICK_MS = 25;
const COUNT_IN = 4;
const ROLL_MS = 45;                     // spread of a rolled chord, per note
const VEL = { lh: 68, rh: 78 };

export function makeLearnEngine({ clock }) {
  let song = null;
  let from = 0, to = 0, loopStart = 0, loopLen = 4;
  let hands = { lh: YOU, rh: YOU };
  let wait = false, loop = true, guide = false;
  let timer = null, gen = 0;
  let startAt = 0;                      // where the next play() comes in, inside the loop
  let appNotes = [], pIdx = 0, nIdx = 0;
  const metro = makeMetronome(clock);       // accented on beat 1 of the loop, see setRange
  let tally = null, passNo = 0, passStartBeat = 0;
  let groups = [], gi = 0, pending = new Set(), advancing = null, waitDone = 0;
  let hist = [];                        // { t, k } for every hit, miss and extra since play
  let otherExp = [];                    // onsets of the hands that are not yours, see newTally
  let carry = [];                       // notes played just before the wrap, for the next pass
  const listeners = {};

  const emit = (t, x) => (listeners[t] || []).forEach(fn => fn(x));
  const sw = b => swungBeat(b, song ? song.swing : 0.5);
  const youHands = () => ['lh', 'rh'].filter(h => hands[h] === YOU);
  const appHands = () => ['lh', 'rh'].filter(h => hands[h] === APP || (guide && hands[h] === YOU));

  function rebuildApp() {
    appNotes = [];
    for (const h of appHands()) for (const n of song[h]) {
      if (n.bar < from || n.bar > to) continue;
      const rel = sw(n.b) - loopStart;
      appNotes.push({ rel, len: Math.max(0.1, n.len * 0.92), n: n.n, v: hands[h] === YOU ? 34 : VEL[h],
                      roll: n.roll > 0 ? n.roll : 0 });
    }
    appNotes.sort((a, b) => a.rel - b.rel || a.n - b.n);
  }

  function newTally() {
    const exp = expectedOf(song, from, to, youHands(), sw).map(e => ({ ...e, b: e.b - loopStart }));
    // the onsets of every hand that is not yours -- App as much as Off. Your part is
    // what you chose to play; a note that belongs to the other hand is outside it, not
    // wrong, whether the app is playing that hand along with you or nobody is.
    otherExp = expectedOf(song, from, to, ['lh', 'rh'].filter(h => hands[h] !== YOU), sw)
      .map(e => ({ ...e, b: e.b - loopStart }));
    tally = makeTally(exp);
    groups = groupsOf(exp);
    return tally;
  }

  /** Point the scheduler at the first app note not before absolute beat `beat`. */
  function aimApp(beat) {
    const rel = beat - loopStart;
    pIdx = Math.max(0, Math.floor(rel / loopLen));
    const inPass = rel - pIdx * loopLen;
    nIdx = appNotes.findIndex(x => x.rel >= inPass - 1e-6);
    if (nIdx < 0) { nIdx = 0; pIdx++; }
  }

  function sendNote(x, atMs) {
    const t = atMs + x.roll * ROLL_MS;
    send([0x90, x.n, x.v], t);
    send([0x80, x.n, 0], t + x.len * (60000 / clock.bpm));
  }

  // ---------------------------------------------------------------- flow mode
  function tick(my) {
    if (my !== gen) return;
    const now = performance.now(), spb = 60000 / clock.bpm;
    const horizon = now + LOOKAHEAD_MS;

    while (appNotes.length && (loop || pIdx === 0)) {
      const x = appNotes[nIdx];
      const abs = loopStart + pIdx * loopLen + x.rel;
      const at = clock.time(abs);
      if (at >= horizon) break;
      if (at >= now - 30) sendNote(x, at);
      if (++nIdx >= appNotes.length) { nIdx = 0; pIdx++; }
    }
    metro.pump(LOOKAHEAD_MS);

    const beat = clock.beat(now);
    // a pass ends when the loop wraps
    const passIdx = beat < loopStart ? -1 : Math.floor((beat - loopStart) / loopLen);
    while (passIdx > passNo) {
      finishPass();
      if (!loop) { stop(); emit('end'); return; }
    }
    for (const m of tally.missesBefore(local(beat))) if (!m.missed && passIdx >= 0) {
      m.missed = true; hist.push({ t: now, k: 'miss' }); emit('miss', m);
    }
    emit('tick', position(beat));
  }

  function finishPass() {
    const r = tally.result();
    passNo++;
    emit('pass', r);
    newTally();
    // what arrived a hair before the wrap was meant for this pass's first onsets
    for (const c of carry) score(c.n, c.beat);
    carry = [];
  }

  /** Match one played note against the current tally and tell everyone. */
  function score(n, beat) {
    const hit = tally.onNote(n, beat);
    if (hit) { hist.push({ t: performance.now(), k: 'hit' }); emit('hit', hit); return; }
    // a note that belongs to the silent hand is not a wrong note: no red tick, no
    // mark against the hit rate (the pass total is settled by the page from the tally)
    if (splitExtras([{ n, beat }], otherExp, loopLen).outside.length) { emit('ignored', { n, beat }); return; }
    hist.push({ t: performance.now(), k: 'extra' });
    emit('extra', { n, beat });
  }

  const local = beat => (beat < loopStart ? beat - loopStart : mod(beat - loopStart, loopLen));

  // stopped, the position is where the next play() comes in -- the clock's frozen
  // beat is wherever the last run happened to be halted
  function position(beat = (timer ? clock.beat() : loopStart + startAt)) {
    // the count-in runs up to where you come in, which a click may have moved
    const inAt = loopStart + startAt;
    return { beat: local(beat), loopLen, pass: passNo, running: !!timer, wait,
             countIn: beat < inAt, inBeats: Math.max(0, inAt - beat),
             group: wait ? groups[gi] : null, gi };
  }

  // ---------------------------------------------------------------- wait mode
  function armGroup() {
    clearTimeout(advancing); advancing = null;
    const g = groups[gi];
    pending = new Set(g ? g.notes.map(e => e.n) : []);
    // the app's notes up to (and including) this onset
    const prev = gi > 0 ? groups[gi - 1].b : -1e-9;
    const upTo = g ? g.b : loopLen;
    const now = performance.now(), spb = 60000 / clock.bpm;
    for (const x of appNotes) if (x.rel > prev && x.rel <= upTo + 1e-6)
      sendNote(x, now + Math.max(0, (x.rel - (g ? g.b : upTo)) * spb));
    emit('tick', position());
    if (!g) {                         // nothing left to wait for: the pass is done
      advancing = setTimeout(() => { if (wait && timer) { finishPass(); gi = 0; waitDone++;
        if (loop) armGroup(); else { stop(); emit('end'); } } }, 600);
    }
  }

  function waitNote(n) {
    const g = groups[gi];
    if (!g) return;
    if (pending.has(n)) {
      pending.delete(n);
      const e = tally.onNote(n, g.b);
      if (e) { hist.push({ t: performance.now(), k: 'hit' }); emit('hit', e); }
      if (!pending.size && !advancing) advancing = setTimeout(() => { gi++; armGroup(); }, 140);
    } else if (otherExp.some(e => e.n === n)) {
      // wait mode has no clock, so the other hand's notes can only be told apart by
      // pitch -- but they are still outside your part, not wrong notes
      emit('ignored', { n, beat: g.b });
    } else {
      emit('extra', { n, beat: g.b });
    }
  }

  // ---------------------------------------------------------------- public
  /**
   * Start from `startAt`. The Start button always counts in (`countIn` true).
   * A finger that paused mid-pass comes back with `countIn: false` so play
   * continues from that beat instead of replaying the bar of click.
   */
  function play(opts = {}) {
    const countIn = opts.countIn !== false;
    stop();
    if (!song) return;
    rebuildApp();
    newTally();
    // coming in mid-loop: the notes before that were never yours to play
    if (startAt > 0) tally.skip(0, startAt);
    passNo = 0; gi = 0; hist = []; carry = [];
    const my = ++gen;
    timer = true;
    const at = loopStart + startAt;
    if (wait) {
      clock.stop(); clock.start(loopStart);
      gi = Math.max(0, groups.findIndex(g => g.b >= startAt - 1e-6));
      armGroup(); return;
    }
    const from = countIn ? at - COUNT_IN : at;
    clock.start(from);
    metro.setAccent(4, loopStart);
    metro.setRange(from, loop ? Infinity : loopStart + loopLen);
    metro.start(from);
    aimApp(at);
    timer = setInterval(() => tick(my), TICK_MS);
    tick(my);
  }

  /**
   * Hold the transport on the beat that is sounding. Stop() alone would
   * report `startAt` (where Play came in), which snaps the staff back a
   * bar or more. Pause writes the current beat first so a finger-pan
   * starts from the notes that were under the line.
   */
  function pause() {
    if (!timer) return;
    const pos = position();
    startAt = Math.max(0, Math.min(loopLen, pos.beat < 0 ? 0 : pos.beat));
    stop();
  }

  /**
   * Continue from `beat` without a count-in. Running, that is a seek.
   * Idle (after pause), Play starts on that beat so the pianist does
   * not have to press Start and does not sit through another click bar.
   */
  function resume(beat) {
    if (beat != null) startAt = Math.max(0, Math.min(loopLen, beat));
    if (timer) { seek(startAt); return; }
    play({ countIn: false });
  }

  /**
   * Move the playing position to `beat` inside the loop -- a click on any view.
   * Running, the clock, the click and the app's hands are re-anchored there and the
   * pass's bookkeeping follows: what was jumped over leaves the pass, what was
   * jumped back over goes up for scoring again. Idle, it only sets where Play comes in.
   */
  function seek(b) {
    if (!song || !tally) return;
    const target = Math.max(0, Math.min(loopLen, b));
    if (!timer) { startAt = target; emit('tick', position()); return; }
    if (wait) {
      const found = groups.findIndex(g => g.b >= target - 1e-6);
      const next = found < 0 ? groups.length : found;
      const at = i => groups[i]?.b ?? loopLen;
      if (next > gi) tally.skip(at(gi), at(next));
      else if (next < gi) emit('reset', tally.reset(at(next), at(gi)));
      gi = next;
      armGroup();
      return;
    }
    const was = local(clock.beat());
    if (target > was) tally.skip(was, target);
    else if (target < was) emit('reset', tally.reset(target, was));
    const abs = loopStart + passNo * loopLen + target;   // the same pass: no wrap
    panic();                                             // whatever the app was holding
    clock.start(abs);
    metro.start(abs);
    aimApp(abs);
    carry = [];
    emit('tick', position(abs));
  }

  function stop() {
    gen++;
    if (timer && timer !== true) clearInterval(timer);
    timer = null;
    clearTimeout(advancing); advancing = null;
    metro.stop();
    clock.stop();
    panic();
    emit('tick', position(loopStart + startAt));
  }

  return {
    on(t, fn) { (listeners[t] ||= []).push(fn); return () => listeners[t] = listeners[t].filter(f => f !== fn); },
    get song() { return song; }, get from() { return from; }, get to() { return to; },
    get hands() { return hands; }, get wait() { return wait; }, get loop() { return loop; },
    get metroOn() { return metro.enabled; }, get guide() { return guide; },
    get running() { return !!timer; }, get tally() { return tally; }, get groups() { return groups; },
    get loopStart() { return loopStart; }, get loopLen() { return loopLen; }, get metro() { return metro; },
    get startAt() { return startAt; },
    position, seek,
    /** Progress inside the running pass, and over the last `seconds` of playing. */
    stats(seconds = 10) {
      return { live: liveOf(tally), win: windowStats(hist, performance.now(), seconds) };
    },

    load(s) { song = s; this.setRange(0, s.nbars - 1); },
    setRange(a, b) {
      const was = this.running; stop();
      from = Math.max(0, Math.min(a, b)); to = Math.min(song.nbars - 1, Math.max(a, b));
      loopStart = from * 4; loopLen = (to - from + 1) * 4; startAt = 0;
      rebuildApp(); newTally();
      emit('range', { from, to });
      if (was) play();
    },
    setHands(h) {
      hands = { ...hands, ...h };
      rebuildApp(); newTally();
      if (this.running) { if (wait) { gi = 0; armGroup(); } else aimApp(clock.beat()); }
      emit('hands', hands);
    },
    setWait(v) { const was = this.running; stop(); wait = !!v; if (was) play(); },
    setLoop(v) { loop = !!v; metro.setRange(loopStart + startAt - COUNT_IN, loop ? Infinity : loopStart + loopLen); },
    setMetro(v) { metro.setEnabled(v); },
    setGuide(v) { guide = !!v; rebuildApp(); if (this.running && !wait) aimApp(clock.beat()); },
    setBpm(v) { clock.setBpm(v); },

    /** A note-on from the piano. */
    noteOn(n, t) {
      if (!timer || !tally) return;
      if (wait) return waitNote(n);
      const beat = clock.beat(t);
      if (beat < loopStart + startAt - WINDOW) return;
      const lb = local(beat);
      // played early for the next pass: nothing left to claim at the end of this one,
      // so hold it until the wrap instead of calling it a wrong note
      const claimable = tally.expected.some(e => e.n === n && !e.hit && !e.skipped && Math.abs(e.b - lb) <= WINDOW);
      if (!claimable && lb > loopLen - WINDOW && loop) { carry.push({ n, beat: lb - loopLen }); return; }
      score(n, lb);
    },

    play, pause, resume, stop,
    toggle() { if (this.running) stop(); else play(); },
    WINDOW, YOU, APP, OFF,
  };
}
