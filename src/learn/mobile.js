// Wiring for the phone's learn page.
//
// Everything musical is the desktop page's, unchanged: the plan, the scorer, the
// transport, the meter and all four views. What differs is the shape of the
// screen around them, and it differs in one decision -- the phone is either on the
// music stand, sideways, with your hands on the piano, or it is in your hand,
// upright, and you are browsing. So there are three screens and rotation moves
// between them:
//
//   home   the songs, with progress
//   path   the lesson path: sections down the page, steps as nodes
//   play   the step: stage, meter, one big Start/Stop, keys
//
// Nothing on `play` needs aim. The step's text lives on the path node and on the
// done card, the tempo is a stepper, and free practice is a sheet you open while
// stopped rather than a panel beside the music.
//
// Progress is the same `middleman.learn.<songId>` document the laptop writes, so a
// step finished on one is finished on the other. Only the choice of view is the
// phone's own (`middleman.learn.mview`, default Scroll): on a phone a wrapped staff
// holds two bars and jumps between them, which is the one thing a music stand cannot
// afford, so a fresh install lands on the strip that slides under a fixed playhead.
// A remembered choice always wins.

import { loadSong, swungBeat } from '../song.js';
import { held, initMidi, onMidi, playOn, receive } from '../midi.js';
import { audio } from '../metronome.js';
import { synth } from '../synth.js';
import { mountOutToggle } from '../outtoggle.js';
import { renderKeys, paintKeys } from '../keyboard.js';
import { noteName } from '../theory.js';
import { makeClock } from '../clock.js';
import { bindVolumeSlider } from '../volume.js';
import { buildPlan, progress, nodeState, YOU, APP, OFF } from './plan.js';
import { resolveTempo, rememberTempo, freeStep } from './tempo.js';
import { CHALLENGES } from './scorer.js';
import { makeMeter } from './meter.js';
import { makeLearnEngine } from './engine.js';
import { makeRoll } from './roll.js';
import { makeStaff } from './staff.js';
import { makeFall } from './fall.js';
import { makeScroll } from './scroll.js';
import { loadProgress, saveProgress, readSetting, writeSetting, safeStep } from './store.js';
import { makeStreak, ignoreOtherHand, goalText, stepCleared, passOk } from './pass.js';
import { fullscreen, exitFullscreen, isFullscreen, canFullscreen, makeWakeLock,
         registerServiceWorker, installHint } from './phone.js';
import { makeMirror, roomFromUrl, savedRoom, saveRoom, followRoom, mirrorsByDefault,
         relayInfo } from './remote.js';
import { mountFeedback, successOf } from './feedback.js';

const $ = id => document.getElementById(id);
const el = new Proxy({}, { get: (_, k) => $(k) });     // ids are the element names

const VIEW_KEY = 'middleman.learn.mview';
const REMOTE_KEY = 'middleman.learn.remote';
/** "Stop mirroring", remembered for this launch only. See the block below. */
const MIRROR_OFF_KEY = 'middleman.learn.mirroroff';
/** How long the page will wait for the server before deciding it is on its own. */
const BOOT_INFO_MS = 1500;
const COUNTDOWN_MS = 3000;
const BPM_STEP = 5, BPM_MIN = 30, BPM_MAX = 200;

/**
 * Remote mode. An iPhone has no Web MIDI -- Safari has never shipped it and is not
 * going to -- so there the laptop keeps the piano and runs the whole lesson, and this
 * page mirrors it: the same views, meter, path and done card, driven by the laptop's
 * events over the relay instead of by a local engine. Everything below this line is
 * written once and works either way; the differences are marked `REMOTE`.
 *
 * The room comes off the laptop's QR (`?room=…`) and is remembered, so the phone can
 * be reopened from the Home screen without scanning again -- and then the server is
 * asked at boot which room the laptop is *actually* in, because the one in the URL is
 * frozen the day the page is saved to the Home screen and the laptop's is not. That
 * one question is the difference between an app that catches up and one that sits
 * connected to a room nobody is publishing into. See `followRoom` in remote.js.
 */
const urlRoom = roomFromUrl();
if (urlRoom) writeSetting(REMOTE_KEY, '1');
let ROOM = urlRoom || savedRoom();
let REMOTE = !!ROOM && readSetting(REMOTE_KEY) === '1';

/** Web MIDI: the whole reason a phone would ever be the app rather than the screen. */
const hasWebMidi = () => !!navigator.requestMIDIAccess;
const readSession = k => { try { return sessionStorage.getItem(k); } catch { return null; } };
const writeSession = (k, v) => { try { sessionStorage.setItem(k, v); } catch { /* private mode */ } };
/** Resolve to `undefined` rather than keep the page waiting on a laptop that is off. */
const inTime = (p, ms) => Promise.race([p, new Promise(r => setTimeout(r, ms))]);

/**
 * Mirroring by default, on the devices that have no other option.
 *
 * An iPhone saved to the Home screen is a standalone web app: its own localStorage,
 * separate from Safari's, and a URL frozen the day it was installed. So on that phone
 * *nothing on the device* can be trusted to name the live room, or to say there is
 * one -- not the query string, not a saved flag. And it will never have Web MIDI, so
 * it can never be the app on its own; being the laptop's screen is the only thing it
 * can usefully be.
 *
 * So it asks the server, and if the server names a room this page is the screen --
 * no QR, no code, no remembered flag. "Stop mirroring" still works, and is remembered
 * for this launch only (sessionStorage, which an installed app clears when it is
 * closed), because the next launch is a phone put back on the music stand.
 *
 * A device that *has* Web MIDI -- Android -- is left exactly as it was: its own app
 * unless it was asked to mirror, by the QR, the code or the remembered flag.
 *
 * The ask is skipped whenever it could not change the answer, and it is given a
 * second and a half: a phone whose laptop is asleep has to open its own app now, not
 * when some TCP timeout expires.
 */
let bootInfo = null, askedInfo = false;
if (mirrorsByDefault({ paired: REMOTE, webMidi: hasWebMidi(),
                       optedOut: readSession(MIRROR_OFF_KEY) === '1' })) {
  askedInfo = true;
  bootInfo = await inTime(relayInfo(), BOOT_INFO_MS);
  if (bootInfo?.room) { ROOM = bootInfo.room; REMOTE = true; }
}

const clock = makeClock(60);
const engine = REMOTE
  ? makeMirror({ clock, room: ROOM, onState: s => applyRemoteState(s),
                 songOf: id => SONGS.find(x => x.song.id === id)?.song ?? null })
  : makeLearnEngine({ clock });
const panes = { staff: el.vStaff, roll: el.vRoll, fall: el.vFall, scroll: el.vScroll };
const views = { staff: makeStaff(panes.staff), roll: makeRoll(panes.roll),
                fall: makeFall(panes.fall), scroll: makeScroll(panes.scroll) };
const meter = makeMeter(el.meter);
const wake = makeWakeLock();

let SONGS = [];                                  // [{ file, song }]
let song = null, plan = [], si = 0, mode = 'tutor';
let done = new Set(), best = {}, tempos = {}, tempoStep = null;
let streak = makeStreak(), hearing = false, pending = null;
let freeCh = 'passes', freeStreak = makeStreak();
let viewName = readSetting(VIEW_KEY, 'scroll'), view = views[viewName] ?? views.scroll;
let screen = 'home', midiText = '', rotated = false;
// what the laptop last said it was showing, and what this page has actually drawn of
// it. The snapshot now arrives once a second whether or not anything changed (see
// HEARTBEAT_MS in host.js), so "have I already drawn this?" is the difference between
// a still picture and one that blinks every second.
let remoteCard = null, remoteShape = '', remoteOut = '', shownCard = '', shownIdle = '';
const sw = b => swungBeat(b, song.swing);
// in remote mode the piano is on the laptop, and so is what is held down on it
const heldNow = () => (REMOTE ? engine.held : held);

// ---------------------------------------------------------------- screens
function go(name) {
  screen = name;
  for (const s of ['home', 'path', 'play']) el[s].hidden = s !== name;
  closeSheet();
  if (name !== 'play') { halt(); return; }
  // the stage was display:none until now, so every view measured zero
  requestAnimationFrame(() => { redraw(); syncPlay(); });
}

/**
 * Rotation is the mode switch: sideways is playing, upright is browsing. It only
 * takes over after the first turn -- a cold load lands on Home whichever way up
 * the phone is, because "which song?" is the question at that point.
 */
const landscape = () => matchMedia('(orientation: landscape)').matches;
matchMedia('(orientation: landscape)').addEventListener('change', e => {
  rotated = true;
  if (!song) return;
  if (e.matches) go('play');
  else if (!engine.running) go(screen === 'play' ? 'path' : screen);
  redraw();
});

// ---------------------------------------------------------------- song + path
function pick(i) {
  song = SONGS[i].song;
  if (!REMOTE) engine.stop();
  engine.load(song);
  plan = buildPlan(song);
  // in remote mode where you are in the plan is the laptop's answer, not this
  // phone's: the next snapshot puts the step, the mode and the ticks back
  if (!REMOTE) {
    const p = loadProgress(song.id, plan.length);
    si = p.step; done = p.done; best = p.best; tempos = p.tempos;
    setMode('tutor');
  }
  renderPath();
  go(landscape() && rotated ? 'play' : 'path');
}

// the progress document belongs to whichever machine owns the engine, and in remote
// mode that is the laptop -- two writers on one document is how a finished step
// un-finishes itself
const save = () => { if (!REMOTE) saveProgress(song?.id, { step: si, done, best, tempos }); };

function renderSongs() {
  el.songs.innerHTML = SONGS.map(({ song: s }, i) => {
    const p = progress(buildPlan(s), loadProgress(s.id).done);
    const pct = Math.round(p.pct * 100);
    const c = 2 * Math.PI * 28;
    return `<div class="songcard" data-i="${i}">
      <div class="songhead">
        <div class="ttl2"><div class="st1">${s.title}</div><div class="st2">${s.sub} · ${s.nbars} bars</div></div>
        <div class="ring"><svg viewBox="0 0 64 64"><circle class="rbg2" cx="32" cy="32" r="28"/>
          <circle class="rfg" cx="32" cy="32" r="28" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - p.pct)}"/></svg>
          <b>${pct}%</b></div>
      </div>
      <div class="st3">${p.done ? 'Up next' : 'Start'}: ${nextTitle(s, p)}</div>
      <button class="primary" style="width:100%">▷ ${p.done ? 'Continue' : 'Begin'}</button>
    </div>`;
  }).join('') || '<div class="dashed">No songs loaded.</div>';
}

function nextTitle(s, p) {
  const pl = buildPlan(s), d = loadProgress(s.id, pl.length);
  const step = pl[Math.min(d.step, pl.length - 1)];
  void p;
  return `${s.sections[step.section]?.name ?? ''} · ${step.title}`;
}

function renderPath() {
  el.pathTitle.textContent = song.title;
  el.pathSub.textContent = `${song.sub} · ${song.bpm} bpm`;
  const p = progress(plan, done);
  el.pathProg.textContent = `${p.done} of ${p.total} steps`;
  el.pathWhere.textContent = `${song.sections[plan[si].section]?.name ?? ''} · ${Math.round(p.pct * 100)}%`;
  el.pathBar.style.width = Math.round(p.pct * 100) + '%';

  let html = '', lastSec = -1;
  plan.forEach((s, i) => {
    if (s.section !== lastSec || s.kind === 'song') {
      if (lastSec >= 0) html += '</div>';
      lastSec = s.section;
      const sec = song.sections[s.section];
      html += `<div class="psec"><b>${s.kind === 'song' ? 'The whole song' : sec.name}</b>`
            + `<span>bars ${s.from + 1}–${s.to + 1}</span></div><div class="pgroup">`;
    }
    const n = nodeState(s, i, si, done);
    html += `<button class="node${n.done ? ' done' : ''}${n.cur ? ' cur' : ''}" data-i="${i}">`
      + `<i>${n.mark}</i>`
      + `<span><span class="n1">${s.title}</span><br><span class="n2">${nodeSub(s)}</span></span>`
      + (n.cur ? '<span class="now">Now</span>' : '') + '</button>';
  });
  el.pathList.innerHTML = html + (lastSec >= 0 ? '</div>' : '');
  el.contLabel.textContent = `Continue · ${plan[si].title}`;
  el.pathList.querySelector('.node.cur')?.scrollIntoView({ block: 'center' });
}

const nodeSub = s => s.kind === 'listen' ? `both hands · ${s.bpm} bpm`
  : s.wait ? 'wait mode · no clock'
  : (best[s.id] ? `${goalText(s.challenge)} · best ${Math.round(best[s.id] * 100)}%` : `${goalText(s.challenge)} · ${s.bpm} bpm`);

// ---------------------------------------------------------------- modes
function setMode(m) {
  if (REMOTE) return engine.cmd('mode', { mode: m });
  mode = m;
  cancelCountdown();
  hearing = false;
  hideCard();
  engine.stop();
  if (m === 'tutor') return applyStep(si);
  engine.setWait(false); engine.setLoop(true); engine.setGuide(false);
  engine.setHands({ lh: YOU, rh: YOU });
  tempoStep = freeStep(song.practiceBpm);
  setBpm(resolveTempo(tempoStep, tempos));
  setFreeChallenge(freeCh);
  redraw();
  syncPlay();
}

/** Load a step. `autoStart` is for steps reached by the countdown -- a cold one waits. */
function applyStep(i, autoStart = false) {
  if (REMOTE) return engine.cmd('step', { i, start: autoStart });
  cancelCountdown();
  mode = 'tutor';
  // safeStep, not a bare clamp: `i` also arrives from a saved document and from the
  // laptop over the relay, and a `plan[si]` of undefined would throw out of here
  si = safeStep(i, plan.length);
  const s = plan[si];
  if (!s) return;
  streak.reset(); hearing = false;
  engine.stop();
  engine.setRange(s.from, s.to);
  engine.setHands({ lh: s.lh, rh: s.rh });
  engine.setWait(s.wait);
  engine.setLoop(s.kind !== 'listen');
  engine.setGuide(false);
  tempoStep = s;
  setBpm(resolveTempo(s, tempos));
  redraw();
  meter.set(s.kind === 'listen' ? null : s.challenge);
  syncPlay();
  save();
  if (autoStart) start(); else showIdle();
}

// ---------------------------------------------------------------- the card
function showCard(title, sub, next, hint, coach = '') {
  hideIdle();
  el.cTitle.textContent = title;
  el.cSub.textContent = sub;
  el.cCoach.textContent = coach;
  el.cNext.innerHTML = next;
  el.cHint.textContent = hint;
  el.card.querySelector('.cbar i').style.width = '0%';
  el.card.hidden = false;
}
// `shown…` is forgotten with the panel, so whatever comes back is drawn afresh. Both
// check before they write: on the snapshot path these run once a second, and setting
// `hidden` to the value it already has is still a write to the document.
const hideIdle = () => { if (el.idle.hidden) return; el.idle.hidden = true; shownIdle = ''; };
const hideCard = () => { if (!el.card.hidden) { el.card.hidden = true; } shownCard = ''; hideIdle(); };

/**
 * What is loaded and waiting. From the music stand this is read at arm's length, so
 * it is the step's name, where it is in the song, and the coach's one line -- not the
 * panel's paragraph, which belongs on the laptop where there is a chair in front of it.
 *
 * In mirror mode this is reached on every snapshot, which is once a second even when
 * nothing moved -- so it draws only when what it would say has changed. Rewriting the
 * same three lines a second is not free: it is a panel that blinks on a music stand.
 *
 * The plate belongs to the tutor, and when there is no step to describe it comes
 * *down* rather than being left alone. Returning early instead is how an "Intro ·
 * Listen" plate ended up sitting over free practice: the laptop left the tutor, the
 * snapshot had no card in it, and nothing here was willing to clear the last one.
 */
function showIdle() {
  const s = mode === 'tutor' ? plan[si] : null;
  if (!s || engine.running || pending) return hideIdle();
  // the song is in the signature as well as the step: two songs can have a step with
  // the same index, id and bars, and the plate has to be re-lettered between them
  const sig = [song?.id, si, s.id, engine.from, engine.to].join();
  if (sig === shownIdle && !el.idle.hidden) return;
  shownIdle = sig;
  el.iTitle.textContent = `${song.sections[s.section]?.name ?? ''} · ${s.title}`;
  // nothing of yours is scored while the app plays it to you, so a percentage there
  // would be a goal you cannot miss and cannot aim at
  el.iWhere.textContent = `bars ${s.from + 1}–${s.to + 1} · `
    + (s.kind === 'listen' ? 'the app plays it, both hands' : goalText(s.challenge));
  el.iSub.textContent = s.coach ?? '';
  if (!el.card.hidden) el.card.hidden = true;
  shownCard = '';
  el.idle.hidden = false;
}

/** Step done: say so over the stage, count down, then load and start the next one. */
function stepDone(r) {
  const s = plan[si], next = plan[si + 1];
  const notes = r?.total ? `${r.hits} of ${r.total} notes` : 'heard it';
  if (!next) return showCard('✓ The whole song', notes, '', 'that was the last step');
  showCard(`✓ ${s.title}`, notes, `next up <b>${next.title}</b>`,
    'starts by itself · tap anywhere to go now', next.coach);
  const t0 = performance.now();
  pending = setInterval(() => {
    const f = Math.min(1, (performance.now() - t0) / COUNTDOWN_MS);
    el.card.querySelector('.cbar i').style.width = Math.round(f * 100) + '%';
    if (f >= 1) advance();
  }, 50);
}

function cancelCountdown() {
  if (!pending) return;
  clearInterval(pending); pending = null;
  hideCard();
}
const advance = () => {
  if (REMOTE) return engine.cmd('advance');   // the laptop owns the countdown, and the step
  cancelCountdown(); applyStep(si + 1, true);
};

// ---------------------------------------------------------------- passes
function onTutorPass(r) {
  if (hearing || REMOTE) return;         // remote: the laptop scores the streak, and says so
  const s = plan[si], ch = s.challenge;
  ignoreOtherHand(r, { song, engine, swung: sw });
  // a listening step has no notes of yours in it, so its pass is empty and passes.
  // Play steps go through stepCleared so an empty or seek-skipped wrap cannot advance.
  const { streak: n } = streak.push(r, s.kind === 'listen' ? 0 : ch.accuracy, passOk(s, r));
  best[s.id] = Math.max(best[s.id] ?? 0, r.accuracy);
  if (stepCleared(s, streak)) {
    done.add(s.id);
    engine.stop();
    save();
    syncPlay();
    // the pass that finished the step still has to land on the meter: the card sits
    // over the stage, not over the meter row, and the last slot filling is the answer
    // to "did that count?"
    meter.update({ results: streak.results(), done: true });
    stepDone(r);
    return;
  }
  meter.update({ results: streak.results() });
}

function onFreePass(r) {
  const ch = CHALLENGES[freeCh];
  if (ch.kind === 'none' || REMOTE) return;
  if (ch.kind === 'window' && !engine.wait) return;
  const passCh = ch.kind === 'window' ? CHALLENGES.passes : ch;
  ignoreOtherHand(r, { song, engine, swung: sw });
  const { ok, no, streak: n } = freeStreak.push(r, passCh.accuracy);
  const pct = Math.round(r.accuracy * 100) + '%';
  if (n >= passCh.n) {
    el.freeState.className = 'lstate ok';
    el.freeState.textContent = `✓ ${passCh.n} clean pass${passCh.n > 1 ? 'es' : ''} — again?`;
    meter.update({ results: freeStreak.results(), done: true });
    freeStreak.reset();
    return;
  }
  el.freeState.className = 'lstate ' + (ok ? 'ok' : 'no');
  el.freeState.textContent = ok ? `Pass ${no}: ${pct} ✓ — ${passCh.n - n} more`
    : `Pass ${no}: ${pct}, needs ${Math.round(passCh.accuracy * 100)}% — again from pass 1`;
  meter.update({ results: freeStreak.results() });
}

/** Live progress on every tick: the running pass, or free practice's sliding window. */
function syncMeters(pos) {
  if (mode === 'tutor' && !plan[si]) return;
  const ch = mode === 'tutor' ? plan[si].challenge : CHALLENGES[freeCh];
  if (!ch || ch.kind === 'none' || !pos.running || hearing) return;
  const st = engine.stats(ch.seconds ?? 10);
  // the finished passes are the laptop's in remote mode; the running one is worked
  // out here from the marks that arrived, so the slot still fills between passes
  const results = REMOTE ? engine.results() : (mode === 'tutor' ? streak : freeStreak).results();
  if (mode === 'tutor') return meter.update({ results, live: st.live, done: done.has(plan[si].id) });
  if (ch.kind === 'window' && !pos.wait) return meter.update({ win: st.win });
  meter.update({ results, live: st.live });
}

// ---------------------------------------------------------------- the stage
function redraw() {
  if (!song) return;
  view.render(song, engine.from, engine.to, sw);
  view.setHands(engine.hands);
  const p = engine.position();
  if (p.wait) view.cursor(p.running ? p.group : null); else view.playhead(p.beat, p.countIn);
  paint(p);
}

function setView(name) {
  if (!views[name]) return;
  viewName = name; view = views[name];
  writeSetting(VIEW_KEY, name);
  for (const n in panes) panes[n].hidden = n !== name;
  document.body.classList.toggle('fallview', name === 'fall');
  el.viewSeg.querySelectorAll('[data-view]').forEach(b => b.classList.toggle('on', b.dataset.view === name));
  if (screen === 'play') requestAnimationFrame(redraw);
}

// ---------------------------------------------------------------- transport
function syncPlay() {
  if (!song) return;
  const s = mode === 'tutor' ? plan[si] : null;
  el.stepTitle.textContent = s ? s.title : 'Free practice';
  // sideways this line has about a fifth of the bar, so it is where you are in the
  // song first and the count through the plan last, in the shortest form that says it
  const where = s ? song.sections[s.section]?.name ?? '' : song.title;
  el.stepWhere.textContent = `${where} · bars ${engine.from + 1}–${engine.to + 1}`
    + (s ? ` · ${si + 1}/${plan.length}` : '') + (engine.wait ? ' · no clock' : '');
  el.startBtn.textContent = engine.running ? '■ Stop' : (hearing ? '■ Stop' : '▶ Start');
  el.startBtn.classList.toggle('on', engine.running);
  for (const [id, on] of [['metroBtn', engine.metroOn], ['waitBtn', engine.wait], ['loopBtn', engine.loop]]) {
    el[id].classList.toggle('on', on);
    el[id + '2']?.classList.toggle('on', on);
  }
  el.metroBtn.classList.toggle('na', engine.wait);            // kept, but idle: no clock to click to
  el.guideBtn?.classList.toggle('on', engine.guide);
  // wait mode counts notes found rather than measuring a percentage against a clock
  el.meter.hidden = engine.wait;
  el.waitbox.hidden = !engine.wait;
  el.bpmv.textContent = clock.bpm; el.bpmv2.textContent = clock.bpm;
  wake.set(engine.running);
}

/**
 * The gesture everything audible needs. In remote mode there is no MIDI to ask for --
 * the piano is the laptop's -- and no click to wake, because that one sounds beside
 * the piano. The sound of the *app* is a different question: see "the phone's sound".
 */
const gesture = () => { if (REMOTE) { if (phoneOut()) unlockAudio(); return; } audio(); ensureMidi(); };

/**
 * Start and stop. REMOTE: the laptop owns the transport, so this asks and draws
 * nothing -- what turns the button round is the snapshot that comes back. It used to
 * clear the card and repaint here as well, which is how a Start that never arrived
 * left the phone and the laptop disagreeing until it was tapped again.
 */
const start = () => {
  gesture();
  if (REMOTE) return engine.play();
  cancelCountdown(); hideCard(); unhear();
  view.clearMarks(); engine.play(); syncPlay();
};
const halt = () => {
  if (REMOTE) return engine.stop();
  engine.stop(); unhear(); syncPlay(); showIdle();
};

/**
 * Where a stepper's next tap counts from.
 *
 * In mirror mode the laptop owns the value and it only arrives on the next snapshot,
 * so counting from what is on screen makes a second tap inside one round trip compute
 * the same absolute value and land as a no-op: three presses, one step. `asked` is
 * what this page has already asked for and not been answered about -- see remote.js.
 * It is a note of a request, not a second copy of the lesson.
 */
const nudgeFrom = () => {
  const a = REMOTE ? engine.asked : {};
  return { bpm: a.bpm ?? clock.bpm, from: a.from ?? engine.from, to: a.to ?? engine.to };
};

function setBpm(v) {
  const bpm = Math.max(BPM_MIN, Math.min(BPM_MAX, Math.round(v)));
  engine.setBpm(bpm);
  // the readout shows what has been asked for. In mirror mode the laptop's snapshot is
  // still the authority: answering the ask clears it and applyRemoteState takes over.
  el.bpmv.textContent = bpm; el.bpmv2.textContent = bpm;
}
function nudgeBpm(d) {
  setBpm(nudgeFrom().bpm + d);
  if (REMOTE) return;                 // and the laptop remembers the tempo it was asked for
  tempos = rememberTempo(tempos, tempoStep, clock.bpm);
  save();
}

/** Hear the step's bars played by the app, both hands, once. */
function hear() {
  if (REMOTE) return engine.cmd('hear');
  hearing = true;
  engine.stop();
  engine.setWait(false); engine.setLoop(false);
  engine.setHands({ lh: APP, rh: APP });
  view.setHands(engine.hands);
  hideCard();
  gesture();
  engine.play();
  syncPlay();
}
function unhear() {
  if (REMOTE || !hearing) return;     // the laptop says when it has stopped listening
  hearing = false;
  const s = mode === 'tutor' ? plan[si] : null;
  if (s) { engine.setHands({ lh: s.lh, rh: s.rh }); engine.setWait(s.wait); engine.setLoop(s.kind !== 'listen'); }
  view.setHands(engine.hands);
}

// ---------------------------------------------------------------- free practice
function openSheet() {
  if (!song) return;
  setMode('free');
  syncFree();
  el.scrim.hidden = false; el.sheet.hidden = false;
}
const closeSheet = () => { el.scrim.hidden = true; el.sheet.hidden = true; };

function syncFree() {
  el.freeSub.textContent = `${song.title} · bars ${engine.from + 1}–${engine.to + 1}`;
  el.barsv.textContent = `${engine.from + 1} – ${engine.to + 1}`;
  el.secChips.innerHTML = song.sections.map((s, i) =>
    `<button class="${engine.from === s.from && engine.to === s.to ? 'on' : ''}" data-sec="${i}">${s.name}</button>`).join('')
    + `<button class="${engine.from === 0 && engine.to === song.nbars - 1 ? 'on' : ''}" data-sec="all">Whole song</button>`;
  for (const h of ['lh', 'rh'])
    el[h + 'Chips'].innerHTML = [[YOU, 'You'], [APP, 'App'], [OFF, 'Off']].map(([v, t]) =>
      `<button class="${engine.hands[h] === v ? 'on' : ''}" data-hand="${h}" data-v="${v}">${t}</button>`).join('');
  el.chChips.innerHTML = Object.entries(CHALLENGES).map(([k, c]) =>
    `<button class="${freeCh === k ? 'on' : ''}" data-ch="${k}">${c.label}</button>`).join('');
  syncPlay();
}

function setFreeChallenge(k) {
  freeCh = k; freeStreak.reset();
  const ch = CHALLENGES[k];
  meter.set(ch, ch.kind === 'window' && engine.wait ? CHALLENGES.passes.n : undefined);
  el.freeState.textContent = '';
}

function setRange(a, b) {
  engine.setRange(a, b);
  if (REMOTE) return;                 // the laptop moves the range; the snapshot redraws
  redraw();
  if (mode === 'free') syncFree();
  syncPlay();
}

// ---------------------------------------------------------------- keys + MIDI
function paint(pos) {
  const colours = new Map();
  if (pos?.running) {
    const col = h => h === 'lh' ? 'var(--lh)' : 'var(--rh)';
    if (pos.wait) for (const e of pos.group?.notes ?? []) colours.set(e.n, col(e.hand));
    else for (const e of engine.tally?.expected ?? [])
      if (!e.hit && !e.skipped && e.b >= pos.beat - 0.05 && e.b < pos.beat + 1) colours.set(e.n, col(e.hand));
  }
  const args = { scale: null, root: 0, sounding: new Set(), held: heldNow(), colours };
  paintKeys(el.mkb, args);
  view.paintKeys?.(args);
}

/**
 * Web MIDI on Android Chrome may want a user gesture, and the AudioContext always
 * does -- so the permission is asked for on the first tap rather than on load, and
 * asked again only if it never came through.
 */
let midiAsked = false;
function ensureMidi() {
  if (REMOTE || midiAsked) return;    // remote: the piano is the laptop's, not this phone's
  midiAsked = true;
  initMidi({
    onStatus: s => {
      midiText = s;
      const bad = /in: 0\b/.test(s) || /^no MIDI/.test(s) || /blocked/.test(s);
      // Home says which of its two lives this page is living, not how many ports
      // are open: with a piano on the phone the answer is one short sentence, and
      // only when there is no piano does the port count become the news.
      el.modeLine.textContent = bad ? s : 'on this phone';
      el.midiPlay.textContent = s;
      el.modeLine.classList.toggle('bad', bad);
      el.midiPlay.classList.toggle('bad', bad);
      el.midibar.hidden = !bad;
      if (bad) midiAsked = false;                 // let the next tap try again
    },
    onNote: () => paint(engine.position()),
  });
}

onMidi(ev => {
  if (ev.cc !== undefined || !ev.on) return;
  if (pending) return advance();                  // a note skips the countdown
  if (song && !engine.running && screen === 'play') { start(); return; }
  engine.noteOn(ev.n, ev.t);
});

// ---------------------------------------------------------------- engine events
engine.on('tick', pos => {
  if (!song) return;
  if (pos.wait) {
    view.cursor(pos.running ? pos.group : null);
    const g = pos.group;
    el.waitNote.textContent = g ? g.notes.map(e => noteName(e.n)).join(' ') : '–';
    const exp = engine.tally?.expected ?? [];
    el.waitFound.textContent = `${exp.filter(e => e.hit).length} of ${exp.length}`;
  } else { view.cursor(null); view.playhead(pos.beat, pos.countIn); }
  paint(pos);
  syncMeters(pos);
});
// the playhead is redrawn every frame while running, so it follows the clock and
// not the 25 ms scheduler
let raf = 0;
function frame() {
  raf = 0;
  if (!engine.running) return;
  if (!engine.wait) { const p = engine.position(); view.playhead(p.beat, p.countIn); }
  raf = requestAnimationFrame(frame);
}
engine.on('tick', pos => { if (pos.running && !raf) raf = requestAnimationFrame(frame); });

engine.on('hit', e => view.mark(e, 'hit'));
engine.on('miss', e => view.mark(e, 'miss'));
engine.on('reset', es => { for (const e of es) view.mark(e, null); });
engine.on('extra', x => view.extra(x.n, x.beat));
engine.on('pass', r => {
  if (mode === 'tutor') onTutorPass(r); else onFreePass(r);
  setTimeout(() => view.clearMarks(), 250);
});
engine.on('end', () => {
  if (hearing && !REMOTE) { unhear(); start(); return; }   // the app played it; now it is your turn
  syncPlay();
});

// ---------------------------------------------------------------- the phone's sound
/**
 * "Out: Computer" on the laptop means the app is playing through a speaker rather
 * than the piano -- and the speaker worth using is the one on the music stand. So
 * every note the laptop sends arrives here and is played on this phone's own synth,
 * on the timestamp it was scheduled for; the laptop mutes its own while we have them.
 *
 * Two things have to be true before an iPhone makes a sound at all:
 *   * the AudioContext only starts inside a real tap, so unlockAudio() hangs off the
 *     same gestures everything else does -- and a note that arrives before the first
 *     tap is dropped rather than queued, or they would all fire at once on the tap;
 *   * Web Audio on its own plays in the "ambient" category, which the ring/silent
 *     switch mutes -- and a phone on a music stand is exactly the phone that is on
 *     silent. Safari 17 and later take `navigator.audioSession.type`; before that the
 *     only lever was that a page which has played an HTMLMediaElement counts as
 *     playback, which is what the looping silent clip is for.
 */
const phoneOut = () => REMOTE && engine.out === 'audio';
// 0.05 s of 8-bit silence: the header, then 133 groups of three 0x80 samples
const SILENT_WAV = 'data:audio/wav;base64,UklGRrQBAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YZABAACA'
  + 'gICA'.repeat(133);
let piano = null, quiet = null;

/** @returns the AudioContext, so a caller can see whether the tap has happened yet. */
function unlockAudio() {
  const a = audio();                    // the metronome's, so the synth's mapping holds
  try { navigator.audioSession.type = 'playback'; } catch { /* not Safari 17+ */ }
  if (!('audioSession' in navigator)) {
    quiet ||= Object.assign(new Audio(SILENT_WAV), { loop: true });
    if (quiet.paused) quiet.play().catch(() => { /* no gesture yet; the next tap tries */ });
  }
  return a;
}

engine.on('note', ev => {
  if (!phoneOut() || unlockAudio().state !== 'running') return;
  playOn(piano ||= synth(), ev.data, ev.t);
});

// ---------------------------------------------------------------- remote mode
/**
 * A snapshot from the laptop. The mirror has already taken the parts that are the
 * engine's -- the range, the hands, the clock's anchor -- so what is left here is the
 * page around it: which step, which mode, the path's ticks, the meter's challenge and
 * the done card. It arrives on change, not on a timer, so this can afford to redraw.
 */
function applyRemoteState(s) {
  // the song is the laptop's choice too: it says which one, this page loads it
  if (s.songId && song?.id !== s.songId) {
    const found = SONGS.find(x => x.song.id === s.songId);
    if (found) { song = found.song; plan = buildPlan(song); engine.load(song); remoteShape = ''; }
  }
  if (!song || !plan.length) return;
  const stepChanged = mode !== s.mode || si !== s.si;
  mode = s.mode;
  si = safeStep(s.si ?? 0, plan.length);
  done = new Set(s.done ?? []);
  best = s.best ?? best;
  freeCh = s.freeCh ?? freeCh;
  hearing = !!s.hearing;
  remoteCard = s.card ?? null;
  const step = mode === 'tutor' ? plan[si] : null;
  // The transport first, and on its own line: it is the cheap half and it is the half
  // that was wrong from the piano -- ▶ Start on the phone while the laptop played on.
  // Everything below it re-engraves something, and a throw in any of them must not be
  // able to take the button with it.
  syncPlay();

  const out = [s.out, s.midiOut].join();
  if (out !== remoteOut) {
    remoteOut = out;
    syncOut();
    if (!phoneOut()) piano?.allOff();   // the laptop took the sound back mid-chord
  }
  if (stepChanged) {
    tempoStep = step;
    meter.set(step ? (step.kind === 'listen' ? null : step.challenge) : CHALLENGES[freeCh]);
    renderPath();
  }
  // the stage only has to be re-engraved when the music under it changes
  const shape = [s.songId, s.from, s.to, s.hands?.lh, s.hands?.rh, s.wait].join();
  if (shape !== remoteShape) {
    remoteShape = shape;
    if (screen === 'play') redraw();
    if (!el.sheet.hidden) syncFree();   // free practice's chips are the laptop's answer too
  }
  // a nudge that has not been answered yet keeps its number: the snapshot that answers
  // it clears the ask (see remote.js) and this line takes the readout back
  if (engine.asked.bpm == null) { el.bpmv.textContent = clock.bpm; el.bpmv2.textContent = clock.bpm; }

  if (remoteCard) {
    // the words are rebuilt only when they change; the bar moves on every snapshot,
    // and showCard resets it to nothing -- which is a countdown that restarts five
    // times a second if it is called for a card already on screen
    const words = [remoteCard.title, remoteCard.sub, remoteCard.hint, remoteCard.coach ?? ''].join('\n');
    if (words !== shownCard) { shownCard = words; showCard(remoteCard.title, remoteCard.sub, '', remoteCard.hint, remoteCard.coach ?? ''); }
    el.card.querySelector('.cbar i').style.width = Math.round((remoteCard.progress ?? 0) * 100) + '%';
  } else {
    if (!el.card.hidden) el.card.hidden = true;
    shownCard = '';
    // showIdle decides both ways round now, including taking the plate down when the
    // laptop is playing or has left the tutor -- so this no longer asks about running
    showIdle();
  }
  meter.update({ results: engine.results(), done: !!step && done.has(step.id) });
}

/**
 * The Out toggle in remote mode: the same two halves as everywhere else, but the mode
 * belongs to the laptop -- this only shows it and asks for it -- and the second half
 * is this phone rather than a computer, because that is where the notes come out.
 */
function mountRemoteOut() {
  el.outsel.className = 'seg';
  el.outsel.innerHTML = '<b>Out:</b><button data-out="midi">Piano</button><button data-out="audio">Phone</button>';
  el.outsel.onclick = e => {
    const b = e.target.closest('[data-out]');
    if (!b || b.disabled) return;
    if (b.dataset.out === 'audio') unlockAudio();   // the tap is the gesture iOS wants
    engine.setOut(b.dataset.out);
    b.parentElement.querySelectorAll('[data-out]').forEach(x => x.classList.toggle('on', x === b));
  };
}

function syncOut() {
  const midi = el.outsel.querySelector('[data-out="midi"]');
  if (!midi) return;
  midi.classList.toggle('on', engine.out === 'midi' || engine.out === 'both');
  el.outsel.querySelector('[data-out="audio"]').classList.toggle('on', engine.out !== 'midi');
  midi.disabled = !engine.midiOut;
  midi.setAttribute('data-tip', engine.midiOut ? 'Notes go to the piano on the laptop'
    : 'No piano found on the laptop, so there is nothing to send to');
  el.outsel.querySelector('[data-out="audio"]')
    .setAttribute('data-tip', "Notes play through this phone's speaker; the laptop's stay quiet");
}

/**
 * "showing the laptop · 12 ms", in the slot the MIDI status uses when the piano is
 * here. It is the whole answer to "why is this phone not doing anything?", so it is
 * said in the same words on Home and on the playing screen.
 */
// a phone that landed on a plain file server will never connect, and saying
// "reconnecting…" at it forever is the one answer that explains nothing. Decided once
// at boot, off /relay/info -- the same question the laptop's panel asks.
let noRelay = false;

/**
 * An open stream is not the same thing as a lesson being followed: the socket can be
 * perfectly happy while the snapshot that said "the next step is running" never came,
 * which is exactly how this page ended up on ▶ Start through a step advance. So the
 * line says which of the two it is, and `bad` covers both.
 */
function paintConn() {
  const r = engine.relay;
  const shown = `showing the laptop${r.synced ? ` · ${Math.round(r.rtt)} ms` : ''}`;
  const txt = noRelay ? 'This server has no phone relay'
    : engine.following ? shown
    : r.status === 'live' ? 'catching up with the laptop…'
    : r.status === 'reconnecting' ? 'reconnecting…' : 'connecting…';
  for (const id of ['modeLine', 'midiPlay']) {
    el[id].textContent = txt;
    el[id].classList.toggle('bad', noRelay || !engine.following);
  }
}

// ---------------------------------------------------------------- wiring
renderKeys(el.mkb);
setView(viewName);
if (REMOTE) {
  // no piano here, but the sound can be here: the toggle is the laptop's, shown and
  // driven from this end (Piano | Phone)
  mountRemoteOut();
  el.midibar.hidden = true;
  el.startOver.hidden = true;                   // the progress document is the laptop's
  el.connectBtn.hidden = true;                  // already connected; the way out is in the header
  el.leaveBtn.hidden = false;
  el.remoteNote.textContent = 'The laptop runs the lesson and the piano; this phone shows it '
    + 'and drives it.';
  engine.onStatus(paintConn);          // the relay is opened at boot, once the songs are in
  engine.onConn(paintConn);            // and again when a live stream falls quiet, or catches up
  // a start is not a wrap, so the laptop sends no `pass` to clear the last run's
  // colours off the noteheads -- the mirror says when it saw the transport turn over
  engine.on('restart', () => view.clearMarks());
} else {
  // where the notes come out: the piano over MIDI, or this phone's own speakers. With
  // no MIDI output midi.js already picks the speakers, so this is the override.
  mountOutToggle(el.outsel, { tip: 'data-tip' });
}
// iPhone Safari has no Fullscreen API; Add to Home Screen is its answer, and the hint says so
if (!canFullscreen()) el.fsBtn.hidden = true;

document.body.addEventListener('click', e => {
  const go2 = e.target.closest('[data-go]');
  if (go2) go(go2.dataset.go);
}, true);

el.songs.addEventListener('click', e => {
  const c = e.target.closest('.songcard'); if (c) pick(+c.dataset.i);
});
el.pathList.addEventListener('click', e => {
  const n = e.target.closest('.node'); if (!n) return;
  applyStep(+n.dataset.i);
  renderPath();
  go('play');
});
el.contBtn.onclick = () => { applyStep(si); renderPath(); go('play'); };
el.freeBtn.onclick = () => { go('play'); openSheet(); };
el.hearBtn.onclick = () => { go('play'); hear(); };
el.startOver.onclick = () => {
  if (!confirm('Forget the progress on this song and start the course again?')) return;
  done = new Set(); best = {}; applyStep(0); renderPath(); save();
};
el.viewSeg.onclick = e => { const d = e.target.closest('[data-view]'); if (d) setView(d.dataset.view); };
el.startBtn.onclick = () => (engine.running ? halt() : start());
// REMOTE: every one of these is a command and nothing more. The chip lights when the
// laptop says it did it -- a LAN round trip away -- rather than on the tap, so a
// command that was dropped cannot leave the phone lit for a setting nobody applied.
el.metroBtn.onclick = el.metroBtn2.onclick = () => { engine.setMetro(!engine.metroOn); gesture(); if (!REMOTE) syncPlay(); };
el.waitBtn.onclick = el.waitBtn2.onclick = () => {
  engine.setWait(!engine.wait);
  if (REMOTE) return;
  if (mode === 'free') setFreeChallenge(freeCh);
  syncPlay(); redraw();
};
el.loopBtn.onclick = el.loopBtn2.onclick = () => { engine.setLoop(!engine.loop); if (!REMOTE) syncPlay(); };
el.guideBtn.onclick = () => { engine.setGuide(!engine.guide); if (!REMOTE) syncPlay(); };
el.bpmDn.onclick = el.bpmDn2.onclick = () => nudgeBpm(-BPM_STEP);
el.bpmUp.onclick = el.bpmUp2.onclick = () => nudgeBpm(BPM_STEP);
// this phone's own level, applied wherever this phone makes the sound: its synth in
// mirror mode, its own send() when it is playing the song itself. The laptop keeps
// its own, so turning one down does not touch the other.
bindVolumeSlider(el.volume, null);

el.cGo.onclick = advance;
el.cAgain.onclick = () => { if (REMOTE) return engine.cmd('again'); cancelCountdown(); applyStep(si, true); };
el.cPath.onclick = () => { cancelCountdown(); renderPath(); go('path'); };
el.card.onclick = e => { if (e.target === el.card && (pending || remoteCard)) advance(); };

// free practice's sheet
el.sheetX.onclick = closeSheet;
el.scrim.onclick = closeSheet;
el.freeStart.onclick = () => { closeSheet(); start(); };
// counted from what has been asked for, so two quick taps move two bars rather than one
el.barsDn.onclick = () => { const b = nudgeFrom(); setRange(b.from, Math.max(b.from, b.to - 1)); };
el.barsUp.onclick = () => { const b = nudgeFrom(); setRange(b.from, Math.min(song.nbars - 1, b.to + 1)); };
el.secChips.onclick = e => {
  const d = e.target.closest('[data-sec]'); if (!d) return;
  if (d.dataset.sec === 'all') setRange(0, song.nbars - 1);
  else { const s = song.sections[+d.dataset.sec]; setRange(s.from, s.to); }
};
const handClick = e => {
  const d = e.target.closest('[data-hand]'); if (!d) return;
  engine.setHands({ [d.dataset.hand]: d.dataset.v });
  if (REMOTE) return;                 // a hand change moves the shape, so the snapshot redraws
  view.setHands(engine.hands); view.clearMarks(); syncFree();
};
el.lhChips.onclick = handClick;
el.rhChips.onclick = handClick;
el.chChips.onclick = e => { const d = e.target.closest('[data-ch]'); if (d) { setFreeChallenge(d.dataset.ch); syncFree(); } };

/** Tap the stage to take your playing position there -- the same seek the desktop has. */
el.stage.addEventListener('pointerdown', e => {
  if (!song || e.button) return;
  const b = view.beatAt?.(e.clientX, e.clientY);
  if (b == null) return;
  gesture();
  engine.seek(b);
});

// Full screen, and the gesture everything else needs: audio and MIDI wake up here
// too. It is a toggle, because once the browser bar is gone this button is the only
// thing on the screen that can bring it back.
el.fsBtn.onclick = async () => {
  gesture();
  if (isFullscreen()) exitFullscreen(); else await fullscreen();
  syncFs();
};
// the browser can leave full screen without us -- Escape, the back gesture, the
// system bar -- so the lit state follows the event rather than the tap
const syncFs = () => { el.fsBtn.classList.toggle('on', isFullscreen()); redraw(); };
document.addEventListener('fullscreenchange', syncFs);
// in remote mode the sound can be switched on long after the first tap, so this one
// stays armed rather than firing once
addEventListener('pointerdown', gesture, { once: !REMOTE, capture: true });
el.midibar.onclick = () => { midiAsked = false; ensureMidi(); };

addEventListener('keydown', e => {
  if (e.code !== 'Space' || e.repeat) return;
  e.preventDefault();
  if (pending || remoteCard) advance(); else if (screen === 'play') engine.running ? halt() : start();
});
addEventListener('resize', () => { if (screen === 'play') redraw(); });

// pairing without the camera: the laptop prints the code under the QR
el.connectBtn.onclick = () => {
  const r = (prompt('Code from the laptop’s Learn page (under the QR):') || '').trim().toLowerCase();
  if (!r) return;
  saveRoom(r); writeSetting(REMOTE_KEY, '1');
  writeSession(MIRROR_OFF_KEY, '');    // asking to connect is the opposite of "stop"
  location.search = '?room=' + encodeURIComponent(r);
};
el.leaveBtn.onclick = () => {
  exitFullscreen();                                  // or the plain page comes up with no browser bar
  writeSetting(REMOTE_KEY, '');
  // and for this launch only: a phone with no Web MIDI mirrors by default, so without
  // this the reload would put it straight back. Closing the app forgets it, which is
  // right -- the next launch is a phone going back on the music stand.
  writeSession(MIRROR_OFF_KEY, '1');
  location.href = location.pathname;                 // drop ?room= or the reload re-arms it
};

/**
 * Feedback, from the music stand. The same module and the same sheet the laptop
 * mounts -- the only differences are the two facts the laptop cannot know: this is a
 * phone, and it may be mirroring rather than running the lesson itself.
 *
 * It reads and stops nothing. In mirror mode that matters twice over: the streak and
 * the passes belong to the laptop, so they are read off the last snapshot rather than
 * from a local streak that is not keeping score.
 */
function liveNow() {
  if (!song || !engine.running || hearing) return null;
  const ch = mode === 'tutor' ? plan[si]?.challenge : CHALLENGES[freeCh];
  if (!ch || ch.kind === 'none') return null;
  const st = engine.stats(ch.seconds ?? 10);
  return ch.kind === 'window' && !engine.wait ? st.win : st.live;
}

mountFeedback(el.fbBtn, {
  device: 'phone',
  get mirroring() { return REMOTE; },
  song: () => song,
  mode: () => mode,
  step: () => (mode === 'tutor' ? plan[si] : null),
  stepNo: () => si + 1,
  stepCount: () => plan.length,
  section: () => song?.sections.find(s => engine.from >= s.from && engine.from <= s.to)?.name ?? null,
  bars: () => (song ? [engine.from + 1, engine.to + 1] : null),
  bpm: () => clock.bpm,
  view: () => viewName,
  success: () => {
    const passes = REMOTE ? engine.results() : (mode === 'tutor' ? streak : freeStreak).passes;
    const s = mode === 'tutor' ? plan[si] : null;
    return successOf({ live: liveNow(), lastPass: passes[passes.length - 1] ?? null,
                       best: s ? best[s.id] ?? null : null });
  },
});

installHint(el.hint, el.hintAdd, el.hintX);
registerServiceWorker();

// ---------------------------------------------------------------- boot
try {
  const idx = await (await fetch('songs/index.json', { cache: 'no-cache' })).json();
  SONGS = await Promise.all(idx.songs.map(async file => ({ file, song: await loadSong('songs/' + file) })));
} catch (err) {
  el.songs.innerHTML = `<div class="dashed">Could not load the songs<br>${err.message}</div>`;
  console.error(err);
}
renderSongs();
if (SONGS.length) { song = SONGS[0].song; engine.load(song); plan = buildPlan(song); }
// the relay only opens once the songs are in, because the first snapshot names one
if (REMOTE) {
  // one question, before anything is opened: is there a relay here, and which room is
  // the laptop in? A `null` is a server that answered and has no relay, so nothing is
  // opened and the mode line says why. An `undefined` is a laptop that is asleep or a
  // Wi-Fi not up yet, which is not the same thing at all -- that one connects and lets
  // the stream's own backoff wait for it.
  const info = askedInfo ? bootInfo : await relayInfo();
  noRelay = info === null;
  const follow = followRoom(info, engine.room);
  if (follow) { saveRoom(follow); engine.setRoom(follow); }
  if (!noRelay) engine.open();
  paintConn();
}

/** Exposed for the headless checks, the same handles the desktop page offers. */
window.__mm = {
  engine, clock, views, setView, receive, onMidi, swungBeat, go,
  remote: REMOTE ? { get room() { return engine.room; }, get noRelay() { return noRelay; },
                     get status() { return engine.relay.status; },
                     /** Whether this page is following the laptop, not just connected to it. */
                     get stale() { return engine.stale; }, get anchored() { return engine.anchored; },
                     get anchorWhy() { return engine.anchorWhy; },
                     get rtt() { return engine.relay.rtt; }, get offset() { return engine.relay.offset; },
                     get state() { return engine.state; }, get card() { return remoteCard; },
                     get out() { return engine.out; },
                     /** Notes this phone has actually handed to its own audio thread. */
                     get scheduled() { return piano?.scheduled ?? 0; },
                     unlockAudio } : null,
  get view() { return view; }, get song() { return song; }, get plan() { return plan; },
  get si() { return si; }, get mode() { return mode; }, get screen() { return screen; },
  get done() { return done; }, get tempos() { return tempos; },
  pick, applyStep, setMode, setRange, openSheet, closeSheet, hear,
  holdCountdown() { if (pending) clearInterval(pending); },
  demo(accuracy = 1, jitterBeats = 0.06) {
    const exp = engine.tally?.expected ?? [];
    const spb = 60000 / clock.bpm;
    const timers = [];
    const now = clock.beat(), rel = now - engine.loopStart;
    for (const e of exp) {
      if (Math.random() > accuracy) continue;
      let abs = engine.loopStart + Math.max(0, Math.floor(rel / engine.loopLen)) * engine.loopLen + e.b;
      if (abs < now - 0.05) abs += engine.loopLen;
      const at = clock.time(abs + (Math.random() - 0.5) * 2 * jitterBeats) - performance.now();
      timers.push(setTimeout(() => {
        receive([0x90, e.n, 80]);
        setTimeout(() => receive([0x80, e.n, 0]), Math.max(60, e.len * spb * 0.8));
      }, Math.max(0, at)));
    }
    return () => timers.forEach(clearTimeout);
  },
  demoWait(n = 9999) {
    let k = 0;
    const step = () => {
      const g = engine.position().group;
      if (!g || k++ >= n || !engine.running) return;
      for (const e of g.notes) { receive([0x90, e.n, 80]); setTimeout(() => receive([0x80, e.n, 0]), 120); }
      setTimeout(step, 220);
    };
    step();
  },
};
