// The phone's half of remote mode: a mirror of the laptop's engine.
//
// `makeMirror` returns an object with the same surface `mobile.js` already uses on
// `makeLearnEngine` -- position(), running, hands, from/to, loopStart/loopLen, a
// tally, groups, stats(), on() -- so the views, the meter, the key strip, the path
// and the done card all work unchanged against it. Nothing on this page touches Web
// MIDI: the piano is on the laptop and so is the click. The one thing that can be
// here is the *sound*: with the laptop set to "Out: Computer" its notes arrive as
// `note` events for mobile.js to play, because the speaker next to the pianist is
// this one.
//
// Where the numbers come from:
//
//   the playhead   the phone's own `makeClock`, anchored once on the laptop's beat 0
//                  through the relay's clock (sync.js). It ticks from a local timer
//                  and is redrawn per frame, so it is as smooth as the laptop's and
//                  no packet is involved in moving it. A snapshot re-anchors it.
//   the marks      hit / miss / extra / ignored / reset events, each naming a note
//                  by hand, pitch and beat. The mirror keeps its own tally built
//                  from the same scorer over the same song, and marks the entry the
//                  event names -- so `liveOf()` and the meter and the coloured
//                  noteheads are all computed here from real data, not shipped.
//   wait mode      has no clock, so the armed group cannot be derived: the laptop
//                  sends `wait { gi }` on every group change, which is a handful of
//                  messages per pass.
//   the controls   every setter becomes a command. It is also applied locally at
//                  once, because a chip that waits for a round trip before it lights
//                  up feels broken; the laptop's next snapshot is the authority and
//                  overwrites it a few milliseconds later.

import { makeClock, mod } from '../clock.js';
import { swungBeat } from '../song.js';
import { expectedOf, makeTally, groupsOf, liveOf, windowStats, WINDOW } from './scorer.js';
import { YOU, APP, OFF } from './plan.js';
import { makeRelay, relayInfo } from './relay.js';
import { anchorClock, toLocal } from './sync.js';

const TICK_MS = 25;
const ROOM_KEY = 'middleman.learn.room';

/** The room this page is mirroring: the URL wins, then whatever was used last. */
export function roomFromUrl(search = location.search) {
  const q = new URLSearchParams(search).get('room');
  if (q) { try { localStorage.setItem(ROOM_KEY, q); } catch { /* private mode */ } return q; }
  return null;
}

export const savedRoom = () => { try { return localStorage.getItem(ROOM_KEY); } catch { return null; } };
export const saveRoom = r => { try { localStorage.setItem(ROOM_KEY, r); } catch { /* private mode */ } };

/**
 * The room this phone should actually be in, given what the server just said.
 *
 * The URL's room is where the pairing came from, and it is frozen: a page saved to the
 * Home screen keeps the `?room=` it was saved with for as long as the app exists. The
 * server's room is where the laptop is *now* -- it survives restarts and is the same
 * on every origin -- so it wins, and the phone quietly follows it across a laptop that
 * moved network, a cleared browser or a server that was restarted. `null` means stay
 * put: an old server that names no room, or one that could not be reached at all.
 */
export const followRoom = (info, mine) => (info?.room && info.room !== mine ? info.room : null);

/**
 * Should this page ask the server whether to be a mirror, rather than waiting to be
 * told? Three things, all of them true at once:
 *
 *   `paired`    it already knows a room and was asked to use it -- the QR, the typed
 *               code, the remembered flag. Then there is nothing to decide.
 *   `webMidi`   a device with Web MIDI can be the app: Android keeps its own engine
 *               unless it is asked to mirror. A device without it -- every iPhone --
 *               can only ever be the laptop's screen.
 *   `optedOut`  "Stop mirroring" was tapped during *this* launch. Not longer: an
 *               installed app's next launch is a phone going back on a music stand.
 *
 * It is a question rather than an answer because the server still has to name a room:
 * a phone whose laptop is off or whose server has no relay stays its own app.
 */
export const mirrorsByDefault = ({ paired, webMidi, optedOut }) => !paired && !webMidi && !optedOut;

/**
 * Who the server is, for the phone. Re-exported so mobile.js has one import for the
 * whole of the connection and not two.
 */
export { relayInfo };

/**
 * @param clock   the page's own clock; the mirror anchors it and nothing else drives it
 * @param room    the pairing id
 * @param songOf  (songId) => a parsed song, so a snapshot can bring its own song in
 * @param onState called after every snapshot, for the parts of the page that are not
 *                the engine: which step, which mode, the path, the done card
 */
export function makeMirror({ clock = makeClock(60), room, songOf, onState }) {
  const relay = makeRelay({ room });
  const listeners = {};
  const emit = (t, x) => (listeners[t] || []).forEach(fn => fn(x));

  let song = null, swung = b => b;
  let from = 0, to = 0, loopStart = 0, loopLen = 4, startAt = 0;
  let hands = { lh: YOU, rh: YOU };
  let wait = false, loop = true, metroOn = true, guide = false, running = false;
  let tally = null, groups = [], gi = 0;
  let hist = [];                       // { t, k } for the sliding-window challenge
  const held = new Set();
  let timer = null, state = null;

  // ---------------------------------------------------------------- the tally
  // Rebuilt from the same scorer the laptop runs, over the same song and range, so
  // the two sides agree on what the expected notes even are. Only which of them were
  // hit crosses the wire.
  function rebuild() {
    if (!song) { tally = null; groups = []; return; }
    const you = ['lh', 'rh'].filter(h => hands[h] === YOU);
    const exp = expectedOf(song, from, to, you, swung).map(e => ({ ...e, b: e.b - loopStart }));
    tally = makeTally(exp);
    groups = groupsOf(exp);
  }

  /** The expected note an event names. Same song, same maths -- so the beat matches exactly. */
  const find = m => tally?.expected.find(e => e.n === m.n && e.hand === m.hand && Math.abs(e.b - m.b) < 1e-6);

  // ---------------------------------------------------------------- position
  const local = beat => (beat < loopStart ? beat - loopStart : mod(beat - loopStart, loopLen));

  function position(beat = (running ? clock.beat() : loopStart + startAt)) {
    const inAt = loopStart + startAt;
    const pass = beat < loopStart ? 0 : Math.floor((beat - loopStart) / loopLen);
    return { beat: local(beat), loopLen, pass, running, wait,
             countIn: running && beat < inAt, inBeats: Math.max(0, inAt - beat),
             group: wait ? groups[gi] : null, gi };
  }

  function tick() { emit('tick', position()); }

  function runTimer(want) {
    if (want && !timer) { timer = setInterval(tick, TICK_MS); tick(); }
    else if (!want && timer) { clearInterval(timer); timer = null; tick(); }
  }

  // ---------------------------------------------------------------- snapshots
  async function apply(s) {
    state = s;
    let fresh = false;
    if (s.songId && song?.id !== s.songId) {
      song = await songOf(s.songId);
      swung = song ? (b => swungBeat(b, song.swing)) : (b => b);
      fresh = true;
    }
    const shape = [from, to, loopStart, loopLen, hands.lh, hands.rh].join();
    from = s.from; to = s.to; loopStart = s.loopStart; loopLen = s.loopLen; startAt = s.startAt;
    hands = { ...s.hands };
    wait = s.wait; loop = s.loop; metroOn = s.metro; guide = s.guide;
    const wasRunning = running;
    running = s.running;
    if (fresh || !tally || shape !== [from, to, loopStart, loopLen, hands.lh, hands.rh].join()) rebuild();
    // one anchor, and the phone's clock keeps the laptop's beat from here on
    anchorClock(clock, { t0: s.t0, bpm: s.bpm, running: s.running }, relay.offset);
    if (!running && wasRunning) { hist = []; }
    runTimer(running || wait);
    // The page's own callback re-engraves the stage. It must not be able to take the
    // rest of the snapshot with it: `apply` is async, so anything thrown here becomes
    // a rejection nobody is waiting on, the tick never goes out, and the phone stops
    // following the laptop over what is only a drawing bug -- silently.
    try { onState?.(s); } catch (err) { console.error('the mirror could not redraw', err); }
    tick();
  }

  relay.on('state', s => { apply(s); });

  // Say what this device *is*, rather than leaving the laptop to guess from how many
  // connections the room has. It stopped being able to guess the moment a room could
  // hold a second player with a piano of their own (jam.js), and the thing the laptop
  // does with the answer is hand over its speakers -- so it has to be right.
  //
  // Said three times over, all of them cheap: when this stream goes live, on every
  // join (so a newcomer hears it), and again on every resync, which is one POST every
  // half minute and is what heals a laptop that started sharing after this phone
  // connected. `onStatus` fires on the resync as well as on the change, so the first
  // and the third are the same line.
  const iAmAMirror = () => relay.send({ type: 'mirror', from: relay.client });
  relay.onStatus(s => { if (s === 'live') iAmAMirror(); });
  relay.on('join', iAmAMirror);

  relay.on('hit', m => {
    const e = find(m);
    if (!e) return;
    e.hit = { beat: e.b + (m.off ?? 0), off: m.off ?? 0 };
    hist.push({ t: performance.now(), k: 'hit' });
    emit('hit', e);
  });
  relay.on('miss', m => {
    const e = find(m);
    if (!e) return;
    e.missed = true;
    hist.push({ t: performance.now(), k: 'miss' });
    emit('miss', e);
  });
  relay.on('extra', x => { hist.push({ t: performance.now(), k: 'extra' }); emit('extra', x); });
  relay.on('ignored', x => emit('ignored', x));
  relay.on('reset', ev => {
    const es = (ev.marks ?? []).map(find).filter(Boolean);
    for (const e of es) { e.hit = null; e.missed = false; e.skipped = false; }
    emit('reset', es);
  });
  relay.on('pass', ev => { emit('pass', ev.result); rebuild(); });
  relay.on('end', () => { running = false; runTimer(wait); emit('end'); });
  // wait mode has no clock, so the armed group is the only thing that can move --
  // the hits inside it arrive as ordinary `hit` events and land on the local tally
  relay.on('wait', ev => { gi = ev.gi; emit('tick', position()); });
  relay.on('held', ev => { held.clear(); for (const n of ev.notes) held.add(n); emit('held', held); });
  // the laptop's sound, when it is set to play through here. The stamp is turned back
  // into this page's performance.now() on the way past, because relay time is the
  // mirror's business and nothing above it should have to know the offset exists.
  //
  // `live` notes are somebody's hands in a jam (see jam.js), and they are not this
  // phone's business: the phone on the music stand is a screen showing one laptop's
  // lesson, and the speaker for that laptop's sound. Playing the room's playing out of
  // it would be a second, quieter piano beside the first.
  relay.on('note', ev => {
    if (ev.live) return;
    emit('note', { data: ev.data, from: ev.from ?? null, t: toLocal(ev.t, relay.offset) });
  });

  // ---------------------------------------------------------------- commands out
  const cmd = (name, args = {}) => relay.send({ type: 'cmd', name, ...args });

  return {
    relay, held, cmd,
    get remote() { return true; },
    get state() { return state; },
    on(t, fn) { (listeners[t] ||= []).push(fn); return () => listeners[t] = listeners[t].filter(f => f !== fn); },
    onStatus(fn) { return relay.onStatus(fn); },
    open() { relay.open(); },
    get room() { return relay.room; },
    /** Follow the laptop into the room the server named. See `followRoom`. */
    setRoom(r) { relay.setRoom(r); },

    get song() { return song; }, get from() { return from; }, get to() { return to; },
    get hands() { return hands; }, get wait() { return wait; }, get loop() { return loop; },
    get metroOn() { return metroOn; }, get guide() { return guide; },
    get running() { return running; }, get tally() { return tally; }, get groups() { return groups; },
    get loopStart() { return loopStart; }, get loopLen() { return loopLen; },
    get startAt() { return startAt; },
    /** Where the laptop is sending its notes, and whether it has a piano to send to. */
    get out() { return state?.out ?? 'midi'; },
    get midiOut() { return !!state?.midiOut; },
    /** The finished passes of the laptop's streak, for the meter. */
    results: () => state?.results ?? [],
    position,
    stats(seconds = 10) {
      return { live: liveOf(tally), win: windowStats(hist, performance.now(), seconds) };
    },

    // the setters. Optimistic locally, authoritative from the next snapshot.
    load(s) { song = s; swung = b => swungBeat(b, s.swing); rebuild(); },
    play() { cmd('start'); },
    pause() { cmd('pause'); },
    resume(b) { cmd('resume', { beat: Math.max(0, Math.min(loopLen, b)) }); },
    stop() { cmd('stop'); },
    toggle() { cmd(running ? 'stop' : 'start'); },
    seek(b) { cmd('seek', { beat: Math.max(0, Math.min(loopLen, b)) }); },
    setBpm(v) { clock.setBpm(v); cmd('bpm', { bpm: v }); },
    setHands(h) { hands = { ...hands, ...h }; rebuild(); cmd('hands', { hands: h }); },
    setRange(a, b) { cmd('range', { from: a, to: b }); },
    setWait(v) { wait = !!v; cmd('wait', { on: !!v }); },
    setLoop(v) { loop = !!v; cmd('loop', { on: !!v }); },
    setMetro(v) { metroOn = !!v; cmd('metro', { on: !!v }); },
    setGuide(v) { guide = !!v; cmd('guide', { on: !!v }); },
    setOut(m) { cmd('out', { mode: m }); },
    /** No MIDI on this page: a note played here would be a note played on the phone. */
    noteOn() { },
    WINDOW, YOU, APP, OFF,
  };
}
