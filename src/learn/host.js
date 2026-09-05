// The laptop's half of remote mode: "Put it on the phone".
//
// iOS has no Web MIDI and never will, so on an iPhone the phone cannot be the app --
// but it can be the *screen*. The laptop stays plugged into the piano and keeps
// everything: the engine, the scorer, the MIDI port, the click. This module puts a
// room on the relay, publishes what the laptop is doing, and applies what the phone
// taps back. The phone renders it all locally; see remote.js.
//
// Two rules shape what goes over the wire, and both are the same rule:
//
//   * **State once, then events.** A snapshot goes out when something *changes* --
//     a step loads, the tempo moves, a hand is switched. It carries the clock's
//     anchor (beat 0 in relay time) rather than its position, so the phone runs its
//     own clock at 60 fps from it. Nothing is streamed per frame or per tick.
//   * **Marks as they happen.** A hit, a miss, a wrong note, a pass -- a handful a
//     second at most, each carrying enough of the note's identity (hand, bar, beat,
//     pitch) for the phone to colour the same notehead.
//
// The sound is the one thing that does stream, and only when it is asked to: with
// "Out: Computer" the app is playing through a speaker, and the speaker the pianist
// is sitting next to is the phone's. So every message midi.js sends goes over too
// (`note`), and this laptop's own synth is muted while the phone is listening --
// otherwise the same chord arrives twice, a room apart.
//
// The snapshot is found by diffing rather than by calling `publish()` from thirty
// places in app.js: a 200 ms comparison of one small object is cheaper than the bugs
// that come from forgetting one of the thirty. Events do not wait for the diff --
// they go out the moment the engine emits them.
//
// The phone's choice of view stays the phone's. It travels in the snapshot so the
// laptop can *say* what it is showing, but a `view` command is deliberately not in
// the vocabulary: the laptop is at eye level with a mouse and the phone is on a
// music stand at arm's length, and they do not want the same picture.

import { qrSvg } from '../qr.js';
import { audible, getOutputMode, hasMidiOutput, onSend, onOutputChange, setSynthMuted } from '../midi.js';
import { makeRelay, relayInfo, shortId } from './relay.js';
import { toServer } from './sync.js';

const ROOM_KEY = 'middleman.learn.room';
const ON_KEY = 'middleman.learn.hosting';
const DIFF_MS = 200;

const read = k => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };

/**
 * Who owns the speakers. Only when a phone is actually there and the app is playing
 * audio rather than driving the piano -- sharing alone must not silence a laptop that
 * nobody is listening to on a phone.
 *
 * `mirrors` is the number of phones that have *said* they are mirroring this laptop,
 * not the number of connections in the room. It used to be the connection count, and
 * that stopped being the same thing the moment a room could hold a second player with
 * a piano of their own (jam.js): a jam partner joining would have muted this laptop's
 * speakers on the theory that it was a phone asking for the sound.
 */
export const soundOnPhone = (on, mirrors, mode) => !!on && mirrors > 0 && mode === 'audio';

/** Everything the phone needs to find the same notehead again. */
const markOf = e => ({ n: e.n, hand: e.hand, b: e.b, bar: e.note?.bar ?? null, beat: e.note?.b ?? null });

/**
 * The step-done card, read straight off the overlay the laptop is already showing.
 * Taking it from the DOM rather than from a variable keeps app.js out of this: there
 * is exactly one place that decides what a finished step says, and it is the overlay.
 */
function cardOf(overlay) {
  if (!overlay || overlay.hidden || !overlay.classList.contains('done')) return null;
  const t = s => overlay.querySelector(s)?.textContent ?? '';
  return {
    title: t('.otitle'), sub: t('.osub'), coach: t('.ocoach'), hint: t('.ohint'),
    progress: (parseFloat(overlay.querySelector('.obar i')?.style.width) || 0) / 100,
  };
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/**
 * The address to put in the QR, which is *not* the address of this page.
 *
 * The laptop's page is nearly always open on localhost, and "localhost" on a phone is
 * the phone. So the host is swapped for one of the machine's own LAN addresses, taken
 * from `/relay/info` (see serve.py). The port is kept: the relay's rooms live in the
 * server process, so the phone must land on the very same server, not just the same
 * machine. `info` may be null -- an old server, or a plain static file server, which
 * answers 404 -- and then the page's own address is all there is to go on.
 *
 * `reachable` is false when nothing we can build will work from the phone: the server
 * is bound to loopback only, or it knows of no address but its own. A page already
 * open on a routable hostname is its own proof to the contrary.
 *
 * @returns {{ url: string, reachable: boolean, ip: string|null }}
 */
export function shareLink(pageUrl, info, room) {
  const u = new URL('learn-m.html', pageUrl);
  u.searchParams.set('room', room);
  const ip = info?.addrs?.[0] ?? null;
  const local = LOOPBACK.has(u.hostname);
  if (info) u.protocol = info.tls ? 'https:' : 'http:';
  if (local && ip) u.hostname = ip;
  const boundLocal = !!info && LOOPBACK.has(String(info.bind ?? ''));
  return { url: u.toString(), reachable: !boundLocal && !(local && !ip), ip };
}

/**
 * The room to publish into.
 *
 * The server owns it: one id per machine, in `certs/room`, the same for every origin
 * and across every restart (see serve.py). That is the fix for the detached Home
 * screen app -- localStorage is per *origin*, so the Learn page on `localhost` and
 * the same page on the LAN address used to be two rooms on one server, and a phone
 * installed with `?room=` frozen into it ended up in whichever of them the laptop was
 * no longer in. The remembered id is now only the fallback for a server too old to
 * answer, and a fresh one is the fallback for that.
 */
export const pickRoom = (info, saved) => info?.room || saved || shortId();

/** What to say instead of a QR nobody's phone could scan. */
export const unreachableNote = ip =>
  'This server is only reachable from this laptop. Run ./phone.sh and open '
  + `https://${ip || '<ip>'}:8765/learn.html here, then share again.`;

/**
 * What to say when the server serving this page is a plain file server: there is no
 * room to put anything in, so there is nothing to scan. The address is only named
 * when /relay/info answered -- and on a server with no relay it usually did not.
 */
export const noRelayNote = ip =>
  'This server has no phone relay.'
  + (ip ? ` Run ./phone.sh and open https://${ip}:8765/learn.html here.` : '');

/** The same shape, doing nothing, for a page with no share panel in it. */
const inertHost = () => ({
  on: false, room: null, link: null, relay: null,
  publish() {}, pushHeld() {}, start() {}, stop() {},
});

/**
 * @param el   { btn, box, qr, hint, url, state } -- the sidebar's share panel
 * @param ctx  getters onto the page's state, and `cmd` -- one function per command
 *             the phone may send. Nothing else in app.js knows this module exists.
 */
export function mountHost(el, ctx) {
  // Mounted from the middle of app.js's wiring, so a panel that is not in the page
  // must not throw: it would abort the module and leave the transport, the tutor and
  // the song list unbuilt -- a page where no step can be started, over a missing div.
  // Sharing is an extra; the lesson is not. (mountOutToggle guards the same way.)
  if (!el || !el.btn || !el.box || !el.qr || !el.hint || !el.url || !el.state) return inertHost();
  const { engine, clock, overlay } = ctx;
  // what the last server said, until this one answers -- so a click before the fetch
  // lands still has a room, and an old server that names none keeps working
  let room = pickRoom(null, read(ROOM_KEY));
  write(ROOM_KEY, room);
  const relay = makeRelay({ room });
  let last = '', timer = null, on = false, heldTimer = 0;
  // the server has no relay: the panel stays open to say so, but nothing is armed --
  // no stream, no diff loop, no snapshots, and the remembered flag is left alone so a
  // reload on a proper server picks sharing straight back up
  let noRelay = false;

  let share = shareLink(location.href, null, room), asking = null;

  /**
   * Ask the server who it is: where the phone should aim, which room to be in, and --
   * by whether it answers at all -- whether there is a relay here to open. Fires once
   * at mount and again on every start, because the laptop may have changed network.
   *
   * This is the only thing that decides `noRelay`, and it is deliberately one request:
   * a `null` is a server that answered and has no relay, so there is nothing to keep
   * asking about, and the button is right there when the answer needs revisiting.
   */
  function loadInfo() {
    if (asking) return asking;
    asking = relayInfo().then(info => {
      asking = null;
      noRelay = info === null;
      if (info?.room && info.room !== room) { room = info.room; write(ROOM_KEY, room); relay.setRoom(room); }
      share = shareLink(location.href, info ?? null, room);
      paint();
      return info;
    });
    return asking;
  }

  // ---------------------------------------------------------------- the snapshot
  function snapshot() {
    const plan = ctx.plan(), si = ctx.si();
    return {
      type: 'state', v: 1,
      songId: ctx.song()?.id ?? null,
      mode: ctx.mode(), si, stepId: plan[si]?.id ?? null, view: ctx.view(),
      // beat 0 in *relay* time: the whole of the sync, and the only timing that
      // crosses the wire. The phone anchors its own clock on it and never asks again.
      t0: toServer(clock.time(0), relay.offset), bpm: clock.bpm,
      running: engine.running, wait: engine.wait, loop: engine.loop,
      metro: engine.metroOn, guide: engine.guide, hearing: ctx.hearing(),
      // where the notes come out, and whether there is a piano at all -- the phone
      // draws the same Out toggle from these two
      out: getOutputMode(), midiOut: hasMidiOutput(),
      from: engine.from, to: engine.to, loopStart: engine.loopStart, loopLen: engine.loopLen,
      startAt: engine.startAt, hands: { ...engine.hands },
      freeCh: ctx.freeCh(), results: ctx.results(), done: [...ctx.done()], best: { ...ctx.best() },
      card: cardOf(overlay),
    };
  }

  function publish(force = false) {
    if (!on || noRelay) return;             // snapshotting five times a second into a 501
    const s = snapshot();
    const json = JSON.stringify(s);
    if (!force && json === last) return;
    // Remembered as sent only once it has actually gone. A snapshot the relay refused
    // -- the stream is down, the server has stopped answering -- would otherwise be
    // the newest thing `last` knows about, and the diff loop, finding nothing changed
    // since, would never send it again: the phone sits on the previous bar until
    // something else happens to move. Forgetting it makes the next tick resend it.
    if (!relay.send(s)) { last = ''; return; }
    last = json;
  }

  // ---------------------------------------------------------------- events out
  const forward = (type, x) => { if (on) relay.send({ type, ...x }); };

  // ---------------------------------------------------------------- the sound
  let onPhone = false;
  /**
   * The phones that have said they are mirroring this laptop, by relay client id.
   * A room can hold devices that are not phones now, and only a phone wants the sound.
   */
  const mirrors = new Set();

  /** Hand the speakers over, or take them back, whenever the answer changes. */
  function syncAudio() {
    const want = soundOnPhone(on, mirrors.size, getOutputMode());
    if (want === onPhone) return;
    onPhone = want;
    setSynthMuted(want);            // the toggle relabels itself off the back of this
  }

  // The note goes out with the timestamp it was scheduled for, in relay time: the
  // engine schedules 120 ms ahead and the relay is a LAN away, so most of them are
  // still in the future when the phone gets them and land exactly on the beat.
  //
  // `from` names the device it came from, on every note that crosses the relay -- the
  // room may hold more than two devices now (see jam.js), and a note nobody has signed
  // is a note no receiver can decide about. This one is *not* `live`: it is the app's
  // output on its way to a speaker, not a pair of hands, and only the mirror plays it.
  onSend((data, timestamp) => {
    if (!onPhone || !audible(data)) return;
    relay.send({ type: 'note', from: relay.client, data: [...data],
                 t: toServer(timestamp ?? performance.now(), relay.offset) });
  });
  onOutputChange(() => { syncAudio(); publish(); });

  engine.on('hit', e => forward('hit', { ...markOf(e), off: e.hit?.off ?? 0 }));
  engine.on('miss', e => forward('miss', markOf(e)));
  engine.on('extra', x => forward('extra', { n: x.n, beat: x.beat }));
  engine.on('ignored', x => forward('ignored', { n: x.n, beat: x.beat }));
  engine.on('reset', es => forward('reset', { marks: es.map(markOf) }));
  engine.on('pass', r => { forward('pass', { result: r }); publish(true); });
  engine.on('end', () => { forward('end', {}); publish(true); });
  engine.on('range', () => publish());
  engine.on('hands', () => publish());

  // wait mode has no clock, so the phone cannot work out which group is armed --
  // it is told. In flow mode ticks are never forwarded: the phone has its own.
  let lastGi = -1;
  engine.on('tick', pos => {
    if (!pos.wait) { lastGi = -1; return; }
    if (pos.gi === lastGi && pos.running) return;
    lastGi = pos.gi;
    forward('wait', { gi: pos.gi, running: pos.running });
  });

  /** What is under the pianist's hands, for the phone's key strip. Coalesced to a frame. */
  function pushHeld(notes) {
    if (!on || heldTimer) return;
    heldTimer = setTimeout(() => { heldTimer = 0; forward('held', { notes: [...notes].sort((a, b) => a - b) }); }, 16);
  }

  // ---------------------------------------------------------------- commands in
  relay.on('cmd', ev => {
    const fn = ctx.cmd[ev.name];
    if (fn) fn(ev);
    publish(true);
  });
  // a phone that has just connected, or a relay that has just restarted, needs a
  // snapshot with a *fresh* anchor rather than whatever was left in the room
  relay.on('join', () => { syncAudio(); publish(true); });
  // a phone saying what it is. It says so when its stream goes live, again on every
  // join, and again on every resync -- so a laptop that started sharing after the
  // phone was already connected still learns about it within half a minute.
  relay.on('mirror', ev => { if (ev.from) { mirrors.add(ev.from); syncAudio(); publish(true); } });
  relay.on('leave', ev => { mirrors.delete(ev.client); syncAudio(); });   // the speakers come back
  // A restarted server loses every room, so a reconnected stream is an empty one: the
  // snapshot has to go again, with a fresh anchor, the moment it is back.
  relay.onStatus(s => { paint(); if (s === 'live') publish(true); });
  relay.on('sync', () => publish(true));

  // ---------------------------------------------------------------- the panel
  // The QR is redrawn only when the link actually changes: paint() runs five times a
  // second off the diff timer, and re-encoding the same string that often is waste.
  let shown = null;

  /** The QR's slot as plain text: an explanation is better than a code that fails. */
  function sayInstead(text) {
    el.qr.innerHTML = '';
    // #shareqr is styled for an SVG (line-height 0, no wrapping), so the text state
    // brings its own few lines of style rather than asking learn.css for a class
    el.qr.style.cssText = 'line-height:1.4;font-size:11px;color:#0b0d10;padding:8px;overflow-wrap:anywhere';
    el.qr.textContent = text;
  }

  function paintLink() {
    // the room is in the key as well as the URL: it moves under an unreachable panel
    // too, where only the spoken code is on screen
    const key = noRelay ? `none:${share.ip}` : share.reachable ? share.url : `no:${share.ip}:${room}`;
    if (key === shown) return;
    shown = key;
    el.url.hidden = noRelay;                // a link into a room that does not exist
    if (noRelay) {
      // no room to join, so neither the code nor the address is worth saying
      sayInstead(noRelayNote(share.ip));
      el.hint.textContent = '';
      return;
    }
    if (share.reachable) {
      el.qr.style.cssText = '';
      el.qr.innerHTML = qrSvg(share.url, { quiet: 2, dark: '#0b0d10', light: '#e9edf2' });
      // the code is the fallback for a camera that cannot read the screen, so it is
      // said next to the QR rather than left to be guessed out of the address
      el.hint.innerHTML = `Scan it with the phone’s camera.<br>Code: <b>${room}</b>`;
    } else {
      // a QR of an unreachable address is worse than no QR: it scans, it opens, it
      // fails, and nothing on the phone says why. So the panel says why instead.
      sayInstead(unreachableNote(share.ip));
      el.hint.innerHTML = `Code: <b>${room}</b>`;
    }
    el.url.textContent = share.url.replace(/^https?:\/\//, '');
    el.url.href = share.url;
  }

  function paint() {
    // the panel stays up while the no-relay note is the thing it has to say, even
    // though sharing itself is off
    const open = on || noRelay;
    el.box.hidden = !open;
    el.btn.classList.toggle('on', on);
    el.btn.textContent = on ? 'On the phone' : 'Put it on the phone';
    if (!open) return;
    paintLink();
    // the round trip is only worth saying once there is a phone at the other end of it
    const here = !noRelay && relay.status === 'live' && mirrors.size > 0;
    const rtt = relay.synced ? ` · ${Math.round(relay.rtt)} ms` : '';
    el.state.textContent = noRelay ? 'No relay on this server'
      : relay.status === 'live' ? (here ? `Phone connected${rtt}` : 'Waiting for the phone…')
      : relay.status === 'reconnecting' ? 'Reconnecting…' : 'Connecting…';
    el.state.classList.toggle('ok', here);
  }

  /** Open the stream and the diff loop. Only ever reached once a relay is known to be there. */
  function arm() {
    relay.open();
    clearInterval(timer);             // a second start must not leave a second diff loop
    timer = setInterval(() => { syncAudio(); publish(); paint(); }, DIFF_MS);
    publish(true);
  }

  /**
   * `info` short-circuits the fetch for the one caller that already has the answer --
   * the remembered-sharing path at mount, which asked to find out whether to call this
   * at all. Everyone else asks again: the laptop may have changed network since mount.
   */
  function start(info) {
    on = true;
    write(ON_KEY, '1');
    paint();
    (info ? Promise.resolve(info) : loadInfo()).then(i => {
      if (!on) return;                // stopped while the answer was out
      // a null is the file server: the panel now says so, and nothing is armed. Not an
      // error and not forgotten -- ON_KEY stays set, so a reload on a real server picks
      // sharing straight back up.
      if (i === null) return paint();
      arm();
    });
  }

  function stop() {
    on = false;
    noRelay = false;
    mirrors.clear();                  // nothing is connected to us any more
    write(ON_KEY, '');
    clearInterval(timer); timer = null;
    relay.close();
    syncAudio();                      // nobody is mirroring: this laptop plays again
    paint();
  }

  el.btn.onclick = () => (on ? stop() : start());
  paint();
  // So the first click already has an address and a room to use -- and, when sharing
  // was remembered, so a laptop reload does not orphan the phone. The same answer
  // keeps it from re-arming against a server with no relay, which is the loop that
  // filled the log and froze the page. An `undefined` -- unreachable, rather than
  // relay-less -- still starts: the stream's own backoff handles a server that is
  // only being restarted.
  loadInfo().then(info => { if (info !== null && read(ON_KEY)) start(info); });

  return { get on() { return on; }, get room() { return room; }, get onPhone() { return onPhone; },
           get link() { return share.url; }, get reachable() { return share.reachable; },
           get relay() { return relay; }, publish, pushHeld, start, stop };
}
