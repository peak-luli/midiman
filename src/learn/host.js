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
// This laptop is the only writer. The phone taps commands at it and draws what comes
// back; it holds no opinion of its own about the transport or the step. That is only
// true, though, for as long as what comes back keeps coming: publishing on a *diff*
// means a snapshot the phone never received is never sent again, and the phone sits
// on a lesson that has moved on with nothing on screen to say so. It happened -- the
// laptop played on through a step advance while the phone showed ▶ Start.
//
// So three things ride on every snapshot, and one timer sits behind it:
//
//   `epoch`      which page published it. A room outlives a page: serve.py keeps the
//                last snapshot and replays it to whoever connects next.
//   `seq`        in what order, within that page.
//   `at`         when, in relay time -- so the reader can tell a snapshot published
//                just now from one kept in a room since yesterday, and refuse to
//                anchor a playhead on the second kind. See `anchorState`.
//   the heartbeat  the whole snapshot goes out once a second even when nothing has
//                changed. The diff is what makes a change arrive in 200 ms; the
//                heartbeat is what bounds how long the phone can be wrong to one
//                second, whatever was dropped and by whom.
//
// And one more rule about *which* laptop page is allowed to say any of it: **one
// writer per room.** The room is the machine's, and sharing is remembered, so every
// Learn page this laptop has open arms itself into the same room -- and a phone with
// two of them talking at it shows a lesson that flips between two tabs. Everything
// published from here is signed with this page's claim (`by`, `since`), and a page
// that hears a newer claim goes quiet and says so in the panel. The rule is
// owner.js's; both ends apply it. `epoch`/`seq`/`at` still order snapshots *inside*
// one page; the claim picks the page.
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
import { beatenBy } from './owner.js';
import { toServer } from './sync.js';

const ROOM_KEY = 'middleman.learn.room';
const ON_KEY = 'middleman.learn.hosting';
const DIFF_MS = 200;
/**
 * How often the snapshot goes out even when nothing in it changed.
 *
 * This is the ceiling on how long a follower can be showing the wrong lesson. A
 * message can be lost in ways neither end sees: the relay drops into a full
 * subscriber queue without a word (serve.py), an iPhone that has been backgrounded
 * stops reading its socket, a redraw throws halfway through applying one. None of
 * those are errors anybody can catch -- so instead of catching them, the state is
 * said again. One small object a second, against a channel already carrying hits
 * and held keys.
 */
export const HEARTBEAT_MS = 1000;

/**
 * Does this snapshot go out? A change goes out at once; an unchanged one goes out
 * again once the heartbeat is due; a forced one always goes.
 *
 * It is here, named and pure, because it is the rule that bounds how wrong the phone
 * can get, and "publish only what changed" is the reasonable-sounding version of it
 * that put the phone on ▶ Start while the laptop played the next step.
 */
export const shouldPublish = ({ force, json, last, now, sentAt, heartbeat = HEARTBEAT_MS }) =>
  !!force || json !== last || now - sentAt >= heartbeat;

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
  /**
   * This page's publishing session, and its place in it.
   *
   * A room belongs to the machine and outlives any one page (see `pickRoom`), and
   * serve.py keeps a room's last snapshot to hand to whoever connects next. So a
   * phone can be given a picture published by a page that has since been closed, or
   * -- after a laptop reload -- one from before the reload, arriving *after* the new
   * page's first snapshot. `epoch` says which page, `seq` says where in it, and
   * `sentAt` is what the heartbeat counts from.
   *
   * `since` is the claim on the *room*, minted every time this page is told to host
   * (see owner.js). A second Learn page in the same room hears it and goes quiet.
   */
  const epoch = shortId(8);
  let seq = 0, sentAt = -Infinity, since = 0;
  /** A newer Learn page has the room. Set from its snapshots, cleared when it leaves. */
  let rival = null;
  const claim = () => ({ client: relay.client, since });
  /** Is this page the room's writer? Nothing goes out, and no command is obeyed, unless it is. */
  const writing = () => on && !rival && !noRelay;
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
    if (!writing()) return;                 // snapshotting five times a second into a 501
    const s = snapshot();
    const json = JSON.stringify(s);
    const now = performance.now();
    if (!shouldPublish({ force, json, last, now, sentAt })) return;
    // The stamps go on *after* the diff, not into the snapshot: `at` moves every time
    // it is read, so a snapshot carrying it would never compare equal to the last one
    // and the 200 ms loop would become a five-a-second publisher -- which is a phone
    // being redrawn five times a second for nothing. `by`/`since` are the room claim
    // (owner.js) and sit next to `epoch`/`seq` for the same reason.
    const out = { ...s, epoch, seq: ++seq, at: toServer(now, relay.offset), synced: relay.synced,
                  by: relay.client, since };
    // Remembered as sent only once it has actually gone. A snapshot the relay refused
    // -- the stream is down, the server has stopped answering -- would otherwise be
    // the newest thing `last` knows about, and the diff loop, finding nothing changed
    // since, would never send it again: the phone sits on the previous bar until
    // something else happens to move. Forgetting it makes the next tick resend it.
    if (!relay.send(out)) { last = ''; return; }
    last = json; sentAt = now;
  }

  // ---------------------------------------------------------------- events out
  // Signed, like the snapshot: a mark from a page that is not the room's writer is a
  // notehead coloured for playing that happened somewhere else, and an `end` from one
  // stops the phone's playhead mid-practice.
  const forward = (type, x) => { if (writing()) relay.send({ type, by: relay.client, since, ...x }); };

  // ---------------------------------------------------------------- the sound
  let onPhone = false;
  /**
   * The phones that have said they are mirroring this laptop, by relay client id.
   * A room can hold devices that are not phones now, and only a phone wants the sound.
   */
  const mirrors = new Set();

  /** Hand the speakers over, or take them back, whenever the answer changes. */
  function syncAudio() {
    // `writing()`, not `on`: a page a newer one has beaten is not the one the phone is
    // showing, and muting its synth would silence a laptop nobody is listening to
    // through the phone.
    const want = soundOnPhone(writing(), mirrors.size, getOutputMode());
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
  //
  // `by` is the claim on the room, which is the same client id here and a different
  // question: `from` is who played it, `by` is whose lesson it belongs to (owner.js).
  onSend((data, timestamp) => {
    if (!onPhone || !audible(data)) return;
    relay.send({ type: 'note', from: relay.client, by: relay.client, since, data: [...data],
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
    if (!writing() || heldTimer) return;
    heldTimer = setTimeout(() => { heldTimer = 0; forward('held', { notes: [...notes].sort((a, b) => a - b) }); }, 16);
  }

  // ---------------------------------------------------------------- commands in
  // Every command is answered with a snapshot, which is also the whole of `resync`:
  // a follower that has missed one, or could not apply one, asks for the state again
  // rather than waiting for this laptop to happen to change something. It is a
  // command with nothing to do but arrive, so it deliberately has no entry in
  // `ctx.cmd` -- the page has nothing to say about it.
  relay.on('cmd', ev => {
    // Only the room's writer obeys the phone. A page a newer one has beaten taking
    // the taps as well would start a second lesson on this laptop, on the same piano,
    // behind the one the pianist is looking at.
    if (!writing()) return;
    const fn = ctx.cmd[ev.name];
    if (fn) fn(ev);
    publish(true);
  });

  // ---------------------------------------------------------------- one writer
  /**
   * Another Learn page publishing into this room. If its claim is newer than ours it
   * is the one on the phone, and this page goes quiet: see owner.js for why newest
   * wins, and `paint` for what the panel then says.
   */
  relay.on('state', ev => {
    if (!on) return;
    const beaten = beatenBy(claim(), ev);
    if (!beaten) return;
    if (rival && rival.client === beaten.client && rival.since === beaten.since) return;
    rival = beaten;
    syncAudio();                    // the phone is not ours: our own speakers come back
    paint();
  });

  // a phone that has just connected, or a relay that has just restarted, needs a
  // snapshot with a *fresh* anchor rather than whatever was left in the room
  relay.on('join', () => { syncAudio(); publish(true); });
  // a phone saying what it is. It says so when its stream goes live, again on every
  // join, and again on every resync -- so a laptop that started sharing after the
  // phone was already connected still learns about it within half a minute.
  relay.on('mirror', ev => { if (ev.from) { mirrors.add(ev.from); syncAudio(); publish(true); } });
  relay.on('leave', ev => {
    mirrors.delete(ev.client);                        // the speakers come back
    // the page that had the room is gone -- closed, reloaded, or told to stop sharing.
    // This one is the writer again, and the phone needs a snapshot to say so.
    if (rival && ev.client === rival.client) { rival = null; last = ''; paint(); publish(true); }
    syncAudio();
  });
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
    el.btn.classList.toggle('on', on && !rival);
    // a page a newer one has beaten must not go on saying it is the one on the phone,
    // and the button is where the way back belongs: one click takes the room again
    el.btn.textContent = !on ? 'Put it on the phone' : rival ? 'Take it back' : 'On the phone';
    if (!open) return;
    paintLink();
    // the round trip is only worth saying once there is a phone at the other end of it
    const here = !noRelay && !rival && relay.status === 'live' && mirrors.size > 0;
    const rtt = relay.synced ? ` · ${Math.round(relay.rtt)} ms` : '';
    el.state.textContent = noRelay ? 'No relay on this server'
      : rival ? 'Another Learn page on this laptop is on the phone'
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
    // the claim is minted here, where the pianist said so -- by the button, or by the
    // remembered flag on load. That is what makes the newest claim the right one.
    since = Date.now();
    rival = null;
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

  /**
   * Take the room back from a newer page: a fresh claim, and a snapshot to prove it.
   * `seq` is deliberately not reset -- the phone drops a snapshot from this client
   * that it has already moved past, and a counter starting over would be exactly that.
   */
  function takeOver() {
    since = Date.now();
    rival = null;
    last = '';
    paint();
    syncAudio();
    publish(true);
  }

  function stop() {
    on = false;
    noRelay = false;
    rival = null;
    mirrors.clear();                  // nothing is connected to us any more
    write(ON_KEY, '');
    clearInterval(timer); timer = null;
    relay.close();
    syncAudio();                      // nobody is mirroring: this laptop plays again
    paint();
  }

  el.btn.onclick = () => (!on ? start() : rival ? takeOver() : stop());
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
           get relay() { return relay; },
           /** Is this page the room's writer, and if not, which page took it. */
           get writing() { return writing(); }, get rival() { return rival; },
           publish, pushHeld, start, stop, takeOver };
}
