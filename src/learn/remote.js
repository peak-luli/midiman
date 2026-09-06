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
//   the controls   every setter is *only* a command. See "one writer" below.
//
// ---------------------------------------------------------------- one writer
//
// The laptop owns the transport and the step; this page owns nothing but how it is
// drawn. Every setter here used to also apply its change locally, on the reasoning
// that a chip which waits for a round trip before it lights up feels broken. On a
// home LAN that round trip is twenty-five milliseconds, and the price of not waiting
// for it turned out to be this, from the piano:
//
//   * Start tapped on the phone, and the two ends disagreed about what was playing
//     until Start was tapped a second time.
//   * a step advance on the laptop that the phone never followed: the laptop played
//     on into the next step while the phone sat on ▶ Start.
//
// Both are the same bug. A command is fire-and-forget -- `relay.send` drops it when
// the stream is not up, and a POST can be lost -- so a phone that has already moved
// its own picture is now the only thing that believes it. And the laptop publishes on
// a *diff*, so a picture it has already sent is never sent again: nothing corrects a
// follower that guessed wrong. Two writers, one of them unable to hear that it lost.
//
// So this page no longer writes state at all, and three things make the one writer's
// word actually arrive:
//
//   * **the host heartbeats** the snapshot once a second even when unchanged, so a
//     message lost anywhere costs at most a second (see HEARTBEAT_MS in host.js).
//   * **this end watches for silence** and asks for the state again -- the only way
//     out of a snapshot dropped into a full queue while the phone was backgrounded.
//   * **a snapshot has to be newer than the one on screen to replace it**, and
//     recent enough to anchor a playhead on. serve.py replays a room's last snapshot
//     to whoever connects next, and a room outlives the page that filled it.

import { makeClock, mod } from '../clock.js';
import { swungBeat } from '../song.js';
import { expectedOf, makeTally, groupsOf, liveOf, windowStats, WINDOW } from './scorer.js';
import { YOU, APP, OFF } from './plan.js';
import { makeRelay, relayInfo } from './relay.js';
import { anchorClock, anchorState, toLocal, toServer } from './sync.js';

const TICK_MS = 25;
const ROOM_KEY = 'middleman.learn.room';
/**
 * How long the mirror will go without a snapshot before it says so and asks for one.
 * Two heartbeats and a bit: one lost snapshot is not worth a request, a run of them
 * is the only sign this page gets that it has stopped following the laptop.
 */
export const STALE_MS = 2500;

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
 * Is this snapshot newer than the one already on screen?
 *
 * Snapshots do not only arrive in the order the laptop sent them. serve.py keeps a
 * room's last one and hands it to every new subscriber, so a reconnect -- or a phone
 * reopened from the Home screen -- is given whatever was left in the room, which may
 * be older than what this page already has, and may have been published by a laptop
 * page that has since been reloaded or closed.
 *
 * `at` is the ordering, because it is the one number both ends read on the same clock
 * (the relay's) and it therefore compares across publishing sessions as well as
 * within them. `seq` breaks a tie inside one session, for two snapshots stamped in
 * the same millisecond. A snapshot from an older laptop carries neither, and is
 * accepted: there is nothing better to go on, and the old behaviour was to accept
 * everything.
 */
export function acceptState(prev, next) {
  if (!next) return false;
  if (!prev) return true;
  if (!Number.isFinite(next.at) || !Number.isFinite(prev.at)) return true;
  if (next.at !== prev.at) return next.at > prev.at;
  return next.epoch === prev.epoch && (next.seq ?? 0) > (prev.seq ?? 0);
}

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
 * @param net     where `fetch` and `EventSource` come from -- the window in the
 *                browser, a pair of fakes in a test. The same one door relay.js has,
 *                and the reason any of the sync rules below can be held to a test.
 * @param staleMs how long a live stream may go quiet before this page says so and
 *                asks. Injected for the same reason `retryMs` is in relay.js: the
 *                rule is worth a test and the wait is not.
 */
export function makeMirror({ clock = makeClock(60), room, songOf, onState, net,
                             staleMs = STALE_MS }) {
  const relay = makeRelay({ room, ...(net ? { net } : {}) });
  const listeners = {};
  const emit = (t, x) => (listeners[t] || []).forEach(fn => fn(x));

  let song = null, swung = b => b;
  let from = 0, to = 0, loopStart = 0, loopLen = 4, startAt = 0;
  let hands = { lh: YOU, rh: YOU };
  let wait = false, loop = true, metroOn = true, guide = false, running = false;
  let tally = null, groups = [], gi = 0, playGen = 0;
  let hist = [];                       // { t, k } for the sliding-window challenge
  const held = new Set();
  let timer = null, state = null;
  // the connection's health as this page sees it, which is not the same question as
  // whether the socket is open: a live stream that has gone quiet is the failure that
  // put the phone on the wrong step
  let watchdog = null, heardAt = -Infinity, askedAt = -Infinity;
  let stale = false, anchored = false, anchorWhy = 'nothing yet';
  const connFns = new Set();
  const sayConn = () => connFns.forEach(fn => fn());

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

  function tick() {
    // the laptop marks misses on its own tick; those events can be dropped, and
    // liveOf() used to freeze on the opening hits. Close the same windows here
    // from this page's clock so the meter keeps settling through the pass.
    if (tally && running && !wait) {
      const beat = position().beat;
      for (const e of tally.expected) {
        if (e.hit || e.skipped || e.missed || e.b + WINDOW >= beat) continue;
        e.missed = true;
        hist.push({ t: performance.now(), k: 'miss' });
        emit('miss', e);
      }
    }
    emit('tick', position());
  }

  function runTimer(want) {
    if (want && !timer) { timer = setInterval(tick, TICK_MS); tick(); }
    else if (!want && timer) { clearInterval(timer); timer = null; tick(); }
  }

  // ---------------------------------------------------------------- snapshots
  async function apply(s) {
    state = s;
    // A snapshot published after the last ask went out is the laptop's answer to it,
    // whatever it says. One published before it is not -- a heartbeat that crossed the
    // tap in flight -- and clearing on that would put the stepper back to counting
    // from a stale number, which is the bug `asked` is for. An ask still being
    // gathered up has not gone out at all, so nothing can have answered it.
    if (askSentAt != null && (!Number.isFinite(s.at) || s.at >= askSentAt)) { asked = {}; askSentAt = null; }
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
    // One anchor, and this page's clock keeps the laptop's beat from here on -- but
    // only when the anchor is one both ends can read and is recent enough to still
    // name the beat the laptop is on. Otherwise the state still applies (which step,
    // whether it is playing: the button has to be right) and the playhead is parked
    // where the loop comes in rather than wherever the arithmetic landed.
    const a = anchorState(s, { synced: relay.synced, offset: relay.offset });
    const wasAnchored = anchored;
    anchorWhy = a.why;
    if (a.ok) { anchorClock(clock, { t0: s.t0, bpm: s.bpm, running: s.running }, relay.offset); anchored = true; }
    else {
      anchored = false;
      clock.setBpm(s.bpm);
      clock.stop(); clock.start(loopStart + startAt); clock.stop();
      askResync();                     // whatever it was, a fresh one fixes it
    }
    if (anchored !== wasAnchored) sayConn();
    // A start is not a wrap, so no `pass` arrives to rebuild the tally -- and the
    // shape has not changed either. Without this the phone keeps the last run's
    // colours on the noteheads and its meter counts hits nobody has played yet.
    // playGen is the start-vs-resume signal: a finger-pan pauses and resumes
    // inside the same play(), and must not throw the marks away.
    const gen = Number.isFinite(s.playGen) ? s.playGen : null;
    if (gen != null) {
      if (gen !== playGen) { playGen = gen; hist = []; rebuild(); emit('restart'); }
    } else if (running && !wasRunning) {
      hist = []; rebuild(); emit('restart');
    }
    if (!running && wasRunning) { hist = []; }
    runTimer(running || wait);
    // The page's own callback re-engraves the stage. It must not be able to take the
    // rest of the snapshot with it: `apply` is async, so anything thrown here becomes
    // a rejection nobody is waiting on, the tick never goes out, and the phone stops
    // following the laptop over what is only a drawing bug -- silently.
    try { onState?.(s); } catch (err) { console.error('the mirror could not redraw', err); }
    tick();
  }

  /**
   * Ask the laptop to say the state again. Every command is answered with a snapshot
   * (see host.js), so this is a command with nothing in it but the asking.
   *
   * Rate-limited, because the cases that need it are also the cases where the answer
   * may not come -- a laptop that has stopped sharing, a room nobody is publishing
   * into -- and one request every couple of seconds all evening is enough. `gap` is
   * for the one caller that has just learnt something new and should not wait: the
   * clock estimate landing is what makes an anchor readable at all.
   */
  function askResync(gap = staleMs) {
    const now = performance.now();
    if (now - askedAt < gap) return;
    askedAt = now;
    relay.send({ type: 'cmd', name: 'resync' });
  }

  /**
   * A snapshot has to be newer than the one on screen, and arriving at all is news:
   * `heardAt` is what the watchdog below measures silence against.
   */
  relay.on('state', s => {
    heardAt = performance.now();
    if (stale) { stale = false; sayConn(); }
    if (!acceptState(state, s)) return;
    apply(s);
  });

  /**
   * The other half of the heartbeat. A live stream that has gone quiet is not a state
   * this page can detect from the socket -- EventSource is perfectly happy, the room
   * exists, the last message simply never came. So the silence is measured, said on
   * the mode line, and asked about.
   */
  function watch() {
    if (relay.status !== 'live') return;
    const quiet = performance.now() - heardAt > staleMs;
    if (quiet) askResync();
    if (quiet !== stale) { stale = quiet; sayConn(); }
  }

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
  let wasStatus = null;
  relay.onStatus(s => {
    // a stream that has only just come back has heard nothing yet through no fault of
    // the laptop's, so the silence the watchdog measures starts now rather than before
    // the drop. `onStatus` also fires on every resync with the status unchanged, which
    // is why this asks whether it *became* live.
    if (s === 'live' && wasStatus !== 'live') heardAt = performance.now();
    if (s === 'live') iAmAMirror();
    wasStatus = s;
  });
  relay.on('join', iAmAMirror);

  /**
   * This device's own estimate of the relay clock lands a moment *after* the stream
   * opens -- eight round trips -- and is re-taken every half minute and after every
   * reconnect. Until the first one has landed no anchor is readable here at all, so
   * the snapshot that arrived on connect could only be applied without its playhead.
   * Asking again the moment the clock is known is what turns that into a picture
   * that follows the laptop, instead of one that waits for the pianist to tap Start
   * a second time.
   */
  relay.on('sync', () => { if (!anchored) askResync(0); });

  relay.on('hit', m => {
    const e = find(m);
    if (!e) return;
    e.hit = { beat: e.b + (m.off ?? 0), off: m.off ?? 0 };
    hist.push({ t: performance.now(), k: 'hit' });
    emit('hit', e);
  });
  relay.on('miss', m => {
    const e = find(m);
    if (!e || e.missed) return;          // already closed locally; do not double-count
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
  relay.on('pass', ev => {
    // the laptop scores the streak; this page must not wait for the next
    // snapshot to find out a pass finished, or live keeps painting on slot 0
    if (state && Array.isArray(ev.results)) state = { ...state, results: ev.results };
    emit('pass', ev.result);
    rebuild();
  });
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

  /**
   * The values this page has asked for and has not been answered about yet.
   *
   * This is *not* a second copy of the lesson: nothing is drawn from it, no tally is
   * built against it, and `wait` / `running` / `from` / `to` still mean what the
   * laptop last said. It exists for one narrow job -- a nudge has to count from the
   * last value *asked for*, not from the last value the laptop happened to have said.
   *
   * Without it, two taps of the tempo stepper inside one round trip both read 90 off
   * the last snapshot, both send `bpm 95`, and the laptop steps once for two presses.
   * Same for the bars stepper. That is what the local writes used to hide, and taking
   * them out is what exposed it.
   *
   * `askSentAt` is when the ask went out, in relay time. Any snapshot published after
   * that is the laptop's answer and clears it -- including a snapshot that ignores the
   * ask, because a command that was dropped means the laptop never heard the tap, and
   * a number nobody applied is worse than one that snaps back. It is null while an ask
   * is still inside the window below: nothing can have answered a command that has
   * not left yet.
   */
  let asked = {}, askSentAt = null;

  /**
   * How long a burst of taps is gathered up before it goes out as one command.
   *
   * Each tap used to be its own POST, and the relay gives each one its own thread
   * (`ThreadingHTTPServer` in serve.py) -- so three absolute values sent a millisecond
   * apart can be applied in any order, and the laptop can end up on the first of them.
   * That is the same "three presses, one step" the pianist saw, arrived at by a
   * different route, and it is not something the receiving end can sort out: an
   * absolute command carries no clue about when it was meant.
   *
   * What matters about a stepper is where it ended up, so a burst goes out once, with
   * the value it ended on. Short enough to be imperceptible on the tap, long enough to
   * gather up a handful of them.
   */
  const ASK_MS = 60;
  let askTimer = 0;
  /** The latest ask per command name, so a tempo burst cannot swallow a range change. */
  const askQueue = new Map();

  function ask(name, args, want) {
    asked = { ...asked, ...want };            // at once, so the next tap counts from it
    askQueue.set(name, { ...args });
    if (askTimer) return;
    askTimer = setTimeout(() => {
      askTimer = 0;
      // stamped as it goes rather than as it was asked: the clearing rule above
      // measures a snapshot against the first moment the laptop could have known
      askSentAt = toServer(performance.now(), relay.offset);
      for (const [n, a] of askQueue) cmd(n, a);
      askQueue.clear();
    }, ASK_MS);
  }

  return {
    relay, held, cmd,
    get remote() { return true; },
    get state() { return state; },
    on(t, fn) { (listeners[t] ||= []).push(fn); return () => listeners[t] = listeners[t].filter(f => f !== fn); },
    onStatus(fn) { return relay.onStatus(fn); },
    /**
     * Whether this page is actually following the laptop, which the socket's status
     * cannot answer: `stale` is a live stream that has gone quiet, and `anchored` is
     * whether the last snapshot could be turned into a playhead. The mode line says
     * both, because "why is this phone not doing anything?" is the question it exists
     * to answer.
     */
    onConn(fn) { connFns.add(fn); return () => connFns.delete(fn); },
    /**
     * What has been asked for and not yet answered -- `{ bpm, from, to, at }`, any of
     * them absent. Only for counting the next nudge from; see `asked`.
     */
    get asked() { return { ...asked }; },
    get stale() { return stale; },
    get anchored() { return anchored; },
    get anchorWhy() { return anchorWhy; },
    /**
     * Is this page actually following the laptop? Three things, and the socket is only
     * the first of them: the stream is up, it has not gone quiet, and the last
     * snapshot was one a playhead could be run from. A room's kept snapshot satisfies
     * the first two and not the third -- it is state with no clock in it -- and the
     * mode line has to be able to tell the pianist which of those it has.
     */
    get following() { return relay.status === 'live' && !stale && anchored; },
    open() {
      relay.open();
      // the watchdog only ever runs while this page is a mirror, and looking twice
      // per staleness window is enough to notice the window closing
      clearInterval(watchdog);
      heardAt = performance.now();
      watchdog = setInterval(watch, Math.max(50, Math.round(staleMs / 2)));
    },
    /**
     * Put everything down: the stream, the watchdog and the page's own tick. Only the
     * tests close a mirror -- a phone on a music stand never does, it navigates away.
     */
    close() {
      clearInterval(watchdog); watchdog = null;
      clearTimeout(askTimer); askTimer = 0; askQueue.clear();
      runTimer(false); relay.close();
    },
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
      const beat = running && !wait ? position().beat : null;
      return { live: liveOf(tally, beat), win: windowStats(hist, performance.now(), seconds) };
    },

    // The setters: a command, and nothing else. See "one writer" at the top -- none
    // of these may move this page's own idea of the transport or the step, because a
    // command that never arrives would then leave this page the only thing that
    // believes it, with nothing able to say otherwise.
    //
    // The song is the exception, and only because it is not state: `load` hands over
    // an already-parsed song for the tally to be built against, and the snapshot's
    // `songId` is still what decides which one that is.
    load(s) { song = s; swung = b => swungBeat(b, s.swing); rebuild(); },
    // absolute, not a toggle: a command that is retried or duplicated has to land on
    // the state it asked for rather than flip whatever it finds
    play() { cmd('transport', { running: true }); },
    pause() { cmd('pause'); },
    resume(b) { cmd('resume', { beat: Math.max(0, Math.min(loopLen, b)) }); },
    stop() { cmd('transport', { running: false }); },
    toggle() { cmd('transport', { running: !running }); },
    seek(b) { cmd('seek', { beat: Math.max(0, Math.min(loopLen, b)) }); },
    // the two steppers: what was asked for is remembered, so the next tap counts from
    // it rather than from a snapshot that has not arrived yet. See `asked`.
    setBpm(v) { ask('bpm', { bpm: v }, { bpm: v }); },
    setHands(h) { cmd('hands', { hands: h }); },
    setRange(a, b) { ask('range', { from: a, to: b }, { from: a, to: b }); },
    setWait(v) { cmd('wait', { on: !!v }); },
    setLoop(v) { cmd('loop', { on: !!v }); },
    setMetro(v) { cmd('metro', { on: !!v }); },
    setGuide(v) { cmd('guide', { on: !!v }); },
    setOut(m) { cmd('out', { mode: m }); },
    /** Ask the laptop to say where it is. Exposed for the page's "catching up" state. */
    resync: askResync,
    /** No MIDI on this page: a note played here would be a note played on the phone. */
    noteOn() { },
    WINDOW, YOU, APP, OFF,
  };
}
