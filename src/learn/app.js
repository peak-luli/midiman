// Wiring for the learn page: songs, the tutor and free practice, the transport,
// MIDI in, the roll and the keys.

import { loadSong, swungBeat, notesIn } from '../song.js';
import { held, initMidi, onMidi, receive, send as midiSend, setOutputMode } from '../midi.js';
import { audio } from '../metronome.js';
import { mountOutToggle } from '../outtoggle.js';
import { renderKeys, paintKeys } from '../keyboard.js';
import { noteName } from '../theory.js';
import { makeClock } from '../clock.js';
import { initTips } from '../looper/tips.js';
import { bindVolumeSlider } from '../volume.js';
import { buildPlan, progress, PASS_ACCURACY, YOU, APP, OFF } from './plan.js';
import { resolveTempo, rememberTempo, forgetTempo, freeStep, isCustomTempo } from './tempo.js';
import { CHALLENGES } from './scorer.js';
import { makeMeter } from './meter.js';
import { makeLearnEngine } from './engine.js';
import { makeRoll } from './roll.js';
import { makeStaff } from './staff.js';
import { makeFall } from './fall.js';
import { makeScroll } from './scroll.js';
import { loadProgress, saveProgress, readSetting, writeSetting, safeStep } from './store.js';
import { makeStreak, ignoreOtherHand } from './pass.js';
import { mountHost } from './host.js';
import { mountJam } from './jam.js';
import { mountFeedback, successOf } from './feedback.js';

const $ = id => document.getElementById(id);
const el = {
  tracks: $('tracks'), tutorBtn: $('tutorBtn'), freeBtn: $('freeBtn'),
  progline: $('progline'), progbar: $('progbar'),
  play: $('play'), metro: $('metroBtn'), outsel: $('outsel'),
  waitBtn: $('waitBtn'), loopBtn: $('loopBtn'),
  pos: $('pos'), tempo: $('tempo'), bpmv: $('bpmv'), tempoMark: $('tempoMark'),
  vol: $('volume'), volv: $('volumev'),
  played: $('played'), inled: $('inled'), status: $('statusEl'),
  tutor: $('tutor'), free: $('free'),
  stepWhere: $('stepWhere'), stepTitle: $('stepTitle'), stepText: $('stepText'), stepGoal: $('stepGoal'),
  stepMeter: $('stepMeter'), stepState: $('stepState'), prev: $('prevBtn'), next: $('nextBtn'),
  hear: $('hearBtn'), guide: $('guideBtn'), guide2: $('guideBtn2'), reset: $('resetBtn'), steplist: $('steplist'),
  rangeLine: $('rangeLine'), secChips: $('secChips'), lhChips: $('lhChips'), rhChips: $('rhChips'),
  chChips: $('chChips'), freeMeter: $('freeMeter'), freeState: $('freeState'),
  secName: $('secName'), strip: $('strip'), rollcanvas: $('rollcanvas'), overlay: $('overlay'), scoreline: $('scoreline'),
  viewSeg: $('viewSeg'), viewStaff: $('viewStaff'), viewRoll: $('viewRoll'), viewFall: $('viewFall'),
  viewScroll: $('viewScroll'),
  startBtn: $('startBtn'),
  info: $('info'), kb: $('kb'),
};

const clock = makeClock(60);
const engine = makeLearnEngine({ clock });
// four ways of seeing the same bars; all share one interface, so the page talks to `view`
const panes = { staff: el.viewStaff, roll: el.viewRoll, fall: el.viewFall, scroll: el.viewScroll };
const views = { staff: makeStaff(panes.staff), roll: makeRoll(panes.roll),
                fall: makeFall(panes.fall), scroll: makeScroll(panes.scroll) };
const VIEW_KEY = 'middleman.learn.view';
let viewName = readSetting(VIEW_KEY, 'staff');
if (!views[viewName]) viewName = 'staff';
let view = views[viewName];
const stepMeter = makeMeter(el.stepMeter), freeMeter = makeMeter(el.freeMeter);

let SONGS = [];                 // [{ file, song }]
let song = null, plan = [], si = 0, mode = 'tutor';
let done = new Set(), best = {};
let tempos = {}, tempoStep = null;   // your tempo per tier, and the step whose tier the slider is setting
const streak = makeStreak();
let hearing = false;
const freeStreak = makeStreak();
let freeCh = 'passes', freeWinDone = 0, freeWinArmed = true;   // free practice's challenge state
let anchor = 0, ledTimer = null;
let pending = null;               // the countdown to the next step, while a step-done overlay is up
const sw = b => swungBeat(b, song.swing);

// ---------------------------------------------------------------- persistence
// The document's shape lives in store.js, because the phone page writes the same
// one: a step finished on the laptop has to read as finished on the phone.
const save = () => saveProgress(song?.id, { step: si, done, best, tempos });
function restore() {
  const d = loadProgress(song?.id, plan.length);
  si = d.step; done = d.done; best = d.best; tempos = d.tempos;
}

// ---------------------------------------------------------------- song
function pick(i) {
  song = SONGS[i].song;
  engine.stop();
  el.tracks.querySelectorAll('.trk').forEach((n, k) => n.classList.toggle('on', k === i));
  engine.load(song);
  plan = buildPlan(song);
  restore();
  renderStrip();
  el.info.innerHTML = `<div>${song.title}${song.credit ? ` · <span style="color:var(--dim)">${song.credit}</span>` : ''}</div>`
    + '<span class="keylegend">'
    + '<span><i class="sw" style="background:var(--lh)"></i>left hand</span>'
    + '<span><i class="sw" style="background:var(--rh)"></i>right hand</span>'
    + '<span><i class="sw" style="background:var(--you);box-shadow:0 0 8px rgba(255,47,214,.6)"></i>you</span>'
    + '</span>';
  setMode(mode);
}

function renderStrip() {
  el.strip.style.gridTemplateColumns = `repeat(${song.nbars},1fr)`;
  el.strip.innerHTML = Array.from({ length: song.nbars }, (_, i) =>
    `<div class="bar" data-i="${i}" data-tip="Bar ${i + 1}: click to loop it, shift-click to stretch the loop to here">`
    + `${song.nbars <= 32 || i % 4 === 0 ? i + 1 : ''}</div>`).join('');
}

function syncStrip(pos) {
  const cur = pos && pos.running && !pos.countIn ? engine.from + Math.floor(pos.beat / 4) : -1;
  el.strip.querySelectorAll('.bar').forEach((b, i) => {
    b.classList.toggle('in', i >= engine.from && i <= engine.to);
    b.classList.toggle('cur', i === cur);
  });
  const sec = song.sections.find(s => engine.from >= s.from && engine.from <= s.to);
  el.secName.textContent = sec ? sec.name : '';
}

function redrawRoll() {
  el.scoreline.innerHTML = '';
  view.render(song, engine.from, engine.to, sw);
  view.setHands(engine.hands);
  syncStrip();
}

/** Switch the stage's view; the choice is kept across visits. */
function setView(name) {
  if (!views[name]) return;
  viewName = name; view = views[name];
  writeSetting(VIEW_KEY, name);
  for (const n in panes) panes[n].hidden = n !== name;
  // the falling view brings its own keys, right under its bars; the page's strip would only repeat them
  document.body.classList.toggle('fallview', name === 'fall');
  el.viewSeg.querySelectorAll('[data-view]').forEach(b => b.classList.toggle('on', b.dataset.view === name));
  if (!song) return;
  redrawRoll();
  const p = engine.position();
  if (p.wait) view.cursor(p.running ? p.group : null); else view.playhead(p.beat, p.countIn);
  paint(p);
}

// ---------------------------------------------------------------- modes
function setMode(m) {
  mode = m;
  cancelCountdown();
  // `hearing` is the tutor's: leaving mid-listen must not leave it armed, or the next
  // Play calls unhear() and puts the step's hands back over free practice's chips
  hearing = false;
  hideOverlay();
  engine.stop();
  el.tutorBtn.classList.toggle('on', m === 'tutor');
  el.freeBtn.classList.toggle('on', m === 'free');
  el.tutor.hidden = m !== 'tutor';
  el.free.hidden = m !== 'free';
  if (m === 'tutor') applyStep(si);
  else {
    engine.setWait(false); engine.setLoop(true); engine.setGuide(false);
    engine.setHands({ lh: YOU, rh: YOU });
    tempoStep = freeStep(song.practiceBpm);
    setBpm(resolveTempo(tempoStep, tempos));
    setFreeChallenge(freeCh);
    redrawRoll();
  }
  syncTransport();
}

// ---------------------------------------------------------------- tutor
/**
 * Load a step. `autoStart` is for steps reached by Next or the countdown -- the
 * first step after a page load stays idle, since audio needs a gesture first.
 */
function applyStep(i, autoStart = false) {
  cancelCountdown();
  // safeStep, not a bare clamp: `i` also arrives from a saved document and from the
  // phone over the relay, and a `plan[si]` of undefined would throw out of here and
  // leave the page wired but songless -- no step could be started at all
  si = safeStep(i, plan.length);
  const s = plan[si];
  if (!s) return;
  streak.reset(); hearing = false;
  engine.stop();
  engine.setRange(s.from, s.to);
  engine.setHands({ lh: s.lh, rh: s.rh });
  engine.setWait(s.wait);
  // the challenge decides when a step is done; the bars keep looping until you
  // move on. Only listening plays once, and that step advances by itself.
  engine.setLoop(s.kind !== 'listen');
  engine.setGuide(false);
  tempoStep = s;
  setBpm(resolveTempo(s, tempos));   // your tempo for this tier if you have set one, else the plan's
  redrawRoll();
  stepMeter.set(s.kind === 'listen' ? null : s.challenge);   // nothing to measure while listening
  syncTutor();
  syncTransport();
  save();
  if (autoStart) start(); else showIdle();
}

// ---------------------------------------------------------------- overlay + countdown
const COUNTDOWN_MS = 3000;

function showOverlay(cls, title, sub, hint, coach = '') {
  el.overlay.className = cls;
  el.overlay.querySelector('.otitle').textContent = title;
  el.overlay.querySelector('.osub').textContent = sub;
  el.overlay.querySelector('.ocoach').textContent = coach;
  el.overlay.querySelector('.ohint').textContent = hint;
  el.overlay.querySelector('.obar i').style.width = '0%';
  el.overlay.hidden = false;
}
const hideOverlay = () => { el.overlay.hidden = true; };

/**
 * What a step is called while it is loaded and waiting for you: the section first,
 * because "Listen" on its own says which step but not where in the song you are --
 * and where you are is the whole answer to "did Start over put me back at the Intro?".
 */
const stepHead = s => `${song.sections[s.section]?.name ?? ''} · ${s.title}`;
const stepWhere = s => `bars ${s.from + 1}–${s.to + 1} · step ${s.id + 1} of ${plan.length}`;

function showIdle() {
  if (mode !== 'tutor' || engine.running || pending) return;
  const s = plan[si];
  showOverlay('idle', stepHead(s), stepWhere(s),
    'Start step, Space, or just play a note · one bar of click counts you in', s.coach);
}

/** Step done: say so on the roll, count down, then load and start the next one. */
function stepDone(r) {
  const s = plan[si], next = plan[si + 1];
  const notes = r?.total ? `${r.hits}/${r.total} notes` : 'heard it';
  if (!next) { showOverlay('done', '✓ The whole song', notes, 'that was the last step'); return; }
  // the coach's line is the *next* step's: this overlay is the boundary between them,
  // and by the time it goes the next step is already running
  showOverlay('done', `✓ ${s.title}`, `${notes} · next: ${next.title}`,
    'click, or Space, to go now · Back to stay', next.coach);
  const t0 = performance.now();
  pending = { timer: setInterval(() => {
    const f = Math.min(1, (performance.now() - t0) / COUNTDOWN_MS);
    el.overlay.querySelector('.obar i').style.width = Math.round(f * 100) + '%';
    if (f >= 1) advance();
  }, 50) };
}

function cancelCountdown() {
  if (!pending) return;
  clearInterval(pending.timer);
  pending = null;
  hideOverlay();
}

function advance() {
  cancelCountdown();
  applyStep(si + 1, true);
}

el.overlay.onclick = () => { if (pending) advance(); else if (!engine.running) start(); };

function syncTutor() {
  const s = plan[si], sec = song.sections[s.section];
  el.stepWhere.textContent = `${sec.name} · bars ${s.from + 1}–${s.to + 1} · step ${si + 1} of ${plan.length}`;
  el.stepTitle.textContent = s.title;
  el.stepText.textContent = s.text;
  el.stepGoal.innerHTML = s.kind === 'listen' ? 'Just listen. Press <b>Next</b> when you are ready.'
    : s.wait ? 'Play every note the song is waiting on, through to the end of the bars.'
    : goalText(s.challenge);
  const isDone = done.has(s.id);
  stepMeter.update({ results: streakResults(), done: isDone });
  el.stepState.className = 'lstate' + (isDone ? ' ok' : '');
  el.stepState.textContent = isDone ? '✓ done' : '';
  el.next.classList.toggle('go', isDone);
  el.prev.disabled = si === 0;
  el.next.textContent = si === plan.length - 1 ? 'Finished' : (isDone ? 'Next ▶' : 'Skip ▶');
  el.guide.classList.toggle('on', engine.guide);
  el.guide.hidden = s.kind === 'listen';
  el.hear.hidden = s.kind === 'listen';
  const p = progress(plan, done);
  el.progline.textContent = `${p.done} of ${p.total} steps done`;
  el.progbar.firstElementChild.style.width = Math.round(p.pct * 100) + '%';
  renderStepList();
}

const goalText = ch => ch.kind === 'window'
  ? `<b>${Math.round(ch.accuracy * 100)}%</b> of the notes over the last <b>${ch.seconds} s</b>.`
  : ch.n > 1 ? `<b>${ch.n}</b> passes in a row at <b>${Math.round(ch.accuracy * 100)}%</b> or better.`
  : `One pass at ${Math.round(ch.accuracy * 100)}% or better.`;

/**
 * The passes the meter shows: the current streak -- or, for a moment after a
 * failed pass, that pass alone in red with its percentage, so you see what
 * happened before the slots reset and pass 1 starts counting again. The rule is
 * pass.js's, so the phone's meter says the same thing about the same playing.
 */
const streakResults = () => streak.results();

/** Take the other hand's notes back out of a pass's wrong notes; see pass.js. */
const ignoreOther = r => ignoreOtherHand(r, { song, engine, swung: sw });

const pctOf = v => Math.round(v * 100) + '%';
const ignoredText = r => (r.ignored ? ` · ${r.ignored} note${r.ignored === 1 ? '' : 's'} outside the part ignored` : '');

function renderStepList() {
  let html = '', lastSec = -1;
  plan.forEach((s, i) => {
    if (s.section !== lastSec && s.kind !== 'song') {
      lastSec = s.section;
      html += `<div class="st sec">${song.sections[s.section].name}</div>`;
    }
    html += `<div class="st${i === si ? ' cur' : ''}${done.has(s.id) ? ' done' : ''}" data-i="${i}"><i></i>${s.title}</div>`;
  });
  el.steplist.innerHTML = html;
  el.steplist.querySelector('.st.cur')?.scrollIntoView({ block: 'nearest' });
}

function onTutorPass(r) {
  const s = plan[si];
  if (hearing) return;
  const ch = s.challenge;
  if (ignoreOther(r)) showScore(r);
  // a listening step has no notes of yours in it, so its pass is empty and passes
  const { ok, no: passNo, streak: n } = streak.push(r, s.kind === 'listen' ? 0 : ch.accuracy);
  best[s.id] = Math.max(best[s.id] ?? 0, r.accuracy);
  if (n >= ch.n) {
    done.add(s.id);
    engine.stop();
    syncTransport();
    el.stepState.className = 'lstate ok';
    syncTutor();
    el.stepState.textContent = s.kind === 'listen' ? '✓ heard it' : `✓ step done — ${r.hits}/${r.total} notes`;
    save();
    stepDone(r);
    return;
  }
  syncTutor();
  if (s.kind === 'listen') return;
  // the loop keeps going: the slot is already ✓ or ✗ and the next pass is counting
  const left = ch.n - n;
  el.stepState.className = 'lstate' + (ok ? ' ok' : ' no');
  el.stepState.textContent = ok
    ? `Pass ${passNo}: ${pctOf(r.accuracy)} ✓ — ${left === 1 ? 'one more' : left + ' more'}${ignoredText(r)}`
    : `Pass ${passNo}: ${pctOf(r.accuracy)}, needs ${pctOf(ch.accuracy)} — again from pass 1${ignoredText(r)}`;
}

/** Live progress on every tick: the running pass, or the sliding window. */
function syncMeters(pos) {
  if (mode === 'tutor' && !plan[si]) return;         // the first tick lands before the plan exists
  const ch = mode === 'tutor' ? plan[si].challenge : CHALLENGES[freeCh];
  const meter = mode === 'tutor' ? stepMeter : freeMeter;
  if (!ch || ch.kind === 'none' || !pos.running || hearing) return;
  const st = engine.stats(ch.seconds ?? 10);
  if (mode === 'tutor') { meter.update({ results: streakResults(), live: st.live, done: done.has(plan[si].id) }); return; }
  // a time window makes no sense without a clock: wait mode shows the pass slots instead
  if (ch.kind === 'window' && !pos.wait) {
    const hit = st.win.pct >= ch.accuracy && st.win.due >= ch.minDue;
    if (hit && freeWinArmed) { freeWinArmed = false; freeWinDone++; el.freeState.className = 'lstate ok';
      el.freeState.textContent = `✓ ${Math.round(ch.accuracy * 100)}% held over ${ch.seconds} s` + (freeWinDone > 1 ? ` · ×${freeWinDone}` : ''); }
    if (!hit && !freeWinArmed && st.win.pct < ch.accuracy - 0.1) freeWinArmed = true;   // re-arm once it clearly drops
    meter.update({ win: st.win, done: !freeWinArmed });
    return;
  }
  meter.update({ results: freeStreakResults(), live: st.live });
}

/** A pass in free practice: the same rules as the tutor, streak and all. */
const freeStreakResults = () => freeStreak.results();

function onFreePass(r) {
  const ch = CHALLENGES[freeCh];
  if (ch.kind === 'none') return;
  if (ch.kind === 'window' && !engine.wait) return;
  const passCh = ch.kind === 'window' ? CHALLENGES.passes : ch;
  if (ignoreOther(r)) showScore(r);
  const { ok, no: passNo, streak: n } = freeStreak.push(r, passCh.accuracy);
  if (n >= passCh.n) {
    el.freeState.className = 'lstate ok';
    el.freeState.textContent = `✓ ${passCh.n} clean pass${passCh.n > 1 ? 'es' : ''} — again?${ignoredText(r)}`;
    freeMeter.update({ results: freeStreak.results(), done: true });
    freeStreak.reset();
    return;
  }
  const left = passCh.n - n;
  el.freeState.className = 'lstate' + (ok ? ' ok' : ' no');
  el.freeState.textContent = ok
    ? `Pass ${passNo}: ${pctOf(r.accuracy)} ✓ — ${left === 1 ? 'one more' : left + ' more'}${ignoredText(r)}`
    : `Pass ${passNo}: ${pctOf(r.accuracy)}, needs ${pctOf(passCh.accuracy)} — again from pass 1${ignoredText(r)}`;
  freeMeter.update({ results: freeStreakResults() });
}

function setFreeChallenge(k) {
  freeCh = k; freeStreak.reset(); freeWinDone = 0; freeWinArmed = true;
  const ch = CHALLENGES[k];
  // in wait mode a window challenge is scored as passes, so it needs pass slots
  freeMeter.set(ch, ch.kind === 'window' && engine.wait ? CHALLENGES.passes.n : undefined);
  el.freeState.textContent = '';
  syncFree();
}

/** Hear the step's bars played by the app, both hands, once. */
function hear() {
  const s = plan[si];
  hearing = true;
  engine.stop();
  engine.setWait(false); engine.setLoop(false);
  engine.setHands({ lh: APP, rh: APP });
  view.setHands(engine.hands);
  el.stepState.className = 'lstate';
  el.stepState.textContent = '♪ listening…';
  hideOverlay();
  engine.play();
  syncTransport();
}

function unhear() {
  if (!hearing) return;
  hearing = false;
  const s = plan[si];
  engine.setHands({ lh: s.lh, rh: s.rh });
  engine.setWait(s.wait); engine.setLoop(s.kind !== 'listen');
  view.setHands(engine.hands);
  el.stepState.textContent = '';
}

// ---------------------------------------------------------------- free practice
function syncFree() {
  el.rangeLine.textContent = engine.from === engine.to ? `bar ${engine.from + 1}`
    : `bars ${engine.from + 1}–${engine.to + 1}`;
  el.secChips.innerHTML = song.sections.map((s, i) =>
    `<button class="chip${engine.from === s.from && engine.to === s.to ? ' on' : ''}" data-sec="${i}" `
    + `data-tip="${s.hint}">${s.name}</button>`).join('')
    + `<button class="chip${engine.from === 0 && engine.to === song.nbars - 1 ? ' on' : ''}" data-sec="all">whole song</button>`;
  for (const h of ['lh', 'rh']) {
    el[h + 'Chips'].innerHTML = [[YOU, 'You'], [APP, 'App'], [OFF, 'Off']].map(([v, t]) =>
      `<button class="chip${engine.hands[h] === v ? ' on' : ''}" data-hand="${h}" data-v="${v}">${t}</button>`).join('');
  }
  el.guide2.classList.toggle('on', engine.guide);
  el.chChips.innerHTML = Object.entries(CHALLENGES).map(([k, c]) =>
    `<button class="chip${freeCh === k ? ' on' : ''}" data-ch="${k}">${c.label}</button>`).join('');
}

function setRange(a, b) {
  engine.setRange(a, b);
  redrawRoll();
  if (mode === 'free') syncFree();
}

// ---------------------------------------------------------------- transport + tempo
function syncTransport() {
  el.play.textContent = engine.running ? '■ Stop' : '▶ Play';
  el.play.classList.toggle('on', engine.running);
  el.startBtn.textContent = engine.running ? '■ Stop' : '▶ Start step';
  el.startBtn.classList.toggle('on', engine.running);
  el.metro.classList.toggle('on', engine.metroOn);
  // wait mode has no clock, so it has no click either: keep the choice, show it idle
  el.metro.classList.toggle('na', engine.wait);
  el.metro.dataset.tip = engine.wait
    ? 'No click in wait mode: there is no clock to click to. The setting comes back with the clock.'
    : 'The click, on every beat. Browser audio, so it never reaches the piano.';
  el.waitBtn.classList.toggle('on', engine.wait);
  el.loopBtn.classList.toggle('on', engine.loop);
}

function setBpm(v) {
  el.tempo.value = v; el.bpmv.textContent = v;
  engine.setBpm(v);        // the clock re-anchors, so the playhead stays put across the change
  syncTempoMark();
}

/** A tempo you set by hand: it sticks, for this tier of steps, until you reset it. */
function userBpm(v) {
  setBpm(v);
  tempos = rememberTempo(tempos, tempoStep, v);
  save();
  syncTempoMark();
}

/** The marker beside the readout: only up while the tempo showing is yours, not the step's. */
function syncTempoMark() {
  if (!el.tempoMark) return;
  const mine = isCustomTempo(tempoStep, +el.tempo.value);
  el.tempoMark.hidden = !mine;
  if (mine) el.tempoMark.dataset.tip = `your tempo · step default ${tempoStep.bpm} · click to reset`;
}

const start = () => { cancelCountdown(); hideOverlay(); audio(); unhear(); view.clearMarks(); engine.play(); syncTransport(); };
const halt = () => { engine.stop(); unhear(); syncTransport(); showIdle(); };

// ---------------------------------------------------------------- engine events
engine.on('tick', pos => {
  if (!song) return;
  syncStrip(pos);
  if (pos.wait) view.cursor(pos.running ? pos.group : null);
  else { view.cursor(null); view.playhead(pos.beat, pos.countIn); }
  el.pos.textContent = !pos.running ? '–'
    : pos.countIn ? `count-in ${Math.min(4, Math.floor(4 - pos.inBeats) + 1)}`
    : `bar ${engine.from + Math.floor(pos.beat / 4) + 1} · beat ${Math.floor(pos.beat % 4) + 1} · pass ${pos.pass + 1}`;
  paint(pos);
  syncMeters(pos);
});
// the playhead is redrawn every frame while running, so its position is the
// clock's, not the 25 ms scheduler's
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
// a jump back put that stretch up for scoring again, so its colours go too
engine.on('reset', es => { for (const e of es) view.mark(e, null); });
engine.on('extra', x => view.extra(x.n, x.beat));
engine.on('pass', r => {
  showScore(r);
  if (mode === 'tutor') onTutorPass(r);
  else onFreePass(r);
  setTimeout(() => view.clearMarks(), 250);
});
engine.on('end', () => {
  if (hearing) { unhear(); start(); return; }      // the app played it; now it is your turn
  syncTransport();
});

function showScore(r) {
  if (!r.total) { el.scoreline.innerHTML = ''; return; }
  el.scoreline.innerHTML = `<span>pass: <b class="${r.accuracy >= PASS_ACCURACY ? 'hitc' : 'missc'}">${Math.round(r.accuracy * 100)}%</b></span>`
    + `<span>hit <b>${r.hits}</b> of <b>${r.total}</b></span>`
    + `<span>missed <b>${r.misses}</b></span><span>extra <b>${r.extras}</b></span>`
    + (r.hits ? `<span>${r.early > r.late * 2 ? 'mostly early' : r.late > r.early * 2 ? 'mostly late' : 'timing centred'}</span>` : '')
    + '<span class="legend"><span><i style="background:var(--hit)"></i>hit</span><span><i style="background:#3a2126;border:1px solid var(--miss)"></i>missed</span><span><i style="background:var(--miss)"></i>wrong</span></span>';
}

// ---------------------------------------------------------------- keys + MIDI
function paint(pos) {
  const colours = new Map();
  if (pos?.running) {
    const you = ['lh', 'rh'].filter(h => engine.hands[h] === YOU);
    const col = h => h === 'lh' ? 'var(--lh)' : 'var(--rh)';
    if (pos.wait) { for (const e of pos.group?.notes ?? []) colours.set(e.n, col(e.hand)); }
    else for (const e of engine.tally?.expected ?? [])
      if (!e.hit && !e.skipped && e.b >= pos.beat - 0.05 && e.b < pos.beat + 1) colours.set(e.n, col(e.hand));
    void you;
  }
  paintKeys(el.kb, { scale: null, root: 0, sounding: new Set(), held, colours });
  view.paintKeys?.({ scale: null, root: 0, sounding: new Set(), held, colours });
}

onMidi(ev => {
  if (ev.cc !== undefined || !ev.on) return;
  if (pending) { advance(); return; }                    // a note skips the countdown, like Space
  if (song && !engine.running) {                         // and starts an idle step, like Space
    start();                                             // that note is the trigger, not scored
    audioHint();
    return;
  }
  engine.noteOn(ev.n, ev.t);
});

/**
 * A MIDI message is not a user gesture, so the click may stay suspended after a
 * note starts the step; say so rather than click silently, and clear it once a
 * pointer or key brings the context back.
 */
let midiStatus = '';
function audioHint() {
  const a = audio();
  setTimeout(() => {
    if (a.state === 'running') return;
    el.status.textContent = 'click anywhere once to enable the click';
    a.addEventListener('statechange', () => { if (a.state === 'running') el.status.textContent = midiStatus; }, { once: true });
  }, 300);
}

// ---------------------------------------------------------------- wiring
initTips();
renderKeys(el.kb);
setView(viewName);
el.viewSeg.onclick = e => { const d = e.target.closest('[data-view]'); if (d) setView(d.dataset.view); };

/**
 * Click anywhere on the stage to take your playing position there: the engine
 * re-anchors the clock and the app's hands, and what was jumped over leaves the
 * pass. Idle, it sets where Play comes in. Every view maps a point to a beat its own
 * way -- across for the staff and the roll, down for the falling notes -- and shows
 * a faint line at that beat under the pointer, so the target is not a guess.
 */
const stageBeat = e => (song ? view.beatAt?.(e.clientX, e.clientY) ?? null : null);
el.rollcanvas.addEventListener('pointermove', e => view.hoverAt?.(stageBeat(e)));
el.rollcanvas.addEventListener('pointerleave', () => view.hoverAt?.(null));
el.rollcanvas.addEventListener('pointerdown', e => {
  if (e.button) return;
  const b = stageBeat(e);
  if (b == null) return;
  audio();                                   // a click is a gesture: let the metronome wake
  engine.seek(b);                            // the 'tick' it emits moves the playhead
});

try {
  const idx = await (await fetch('songs/index.json', { cache: 'no-cache' })).json();
  SONGS = await Promise.all(idx.songs.map(async file => ({ file, song: await loadSong('songs/' + file) })));
} catch (err) {
  el.status.textContent = 'songs: ' + err.message;
  el.tracks.innerHTML = `<div class="trk-err">Could not load the songs<br><small>${err.message}</small></div>`;
  console.error(err);
}
el.tracks.innerHTML = SONGS.map((s, i) =>
  `<div class="trk" data-i="${i}" title="${s.song.credit}"><div>${s.song.title}</div><small>${s.song.sub}</small></div>`).join('')
  || el.tracks.innerHTML;
el.tracks.onclick = e => { const d = e.target.closest('.trk'); if (d) pick(+d.dataset.i); };

el.tutorBtn.onclick = () => setMode('tutor');
el.freeBtn.onclick = () => setMode('free');
el.play.onclick = () => engine.running ? halt() : start();
el.metro.onclick = () => { engine.setMetro(!engine.metroOn); audio(); syncTransport(); };
mountOutToggle(el.outsel, { tip: 'data-tip' });
el.waitBtn.onclick = () => { engine.setWait(!engine.wait); if (mode === 'free') setFreeChallenge(freeCh); syncTransport(); };
el.loopBtn.onclick = () => { engine.setLoop(!engine.loop); syncTransport(); };
el.prev.onclick = () => applyStep(si - 1);
el.next.onclick = () => applyStep(si + 1, true);
el.startBtn.onclick = () => engine.running ? halt() : start();
el.hear.onclick = () => (hearing ? halt() : hear());
const toggleGuide = () => { engine.setGuide(!engine.guide); el.guide.classList.toggle('on', engine.guide); el.guide2.classList.toggle('on', engine.guide); };
el.guide.onclick = toggleGuide;
el.guide2.onclick = toggleGuide;
/**
 * Start over: the course from the top. It has to land somewhere unmistakable rather
 * than merely somewhere valid -- step 1 is the first section's listening step, and the
 * line under the meter names it, so nothing has to be hunted for on the step list.
 */
el.reset.onclick = () => {
  done = new Set(); best = {};
  streak.reset();
  applyStep(0);
  const s = plan[0];
  el.stepState.className = 'lstate';
  el.stepState.textContent = `Back to the top · ${stepHead(s)} · bars ${s.from + 1}–${s.to + 1}`;
};
el.steplist.onclick = e => { const d = e.target.closest('.st[data-i]'); if (d) applyStep(+d.dataset.i); };

el.strip.onclick = e => {
  const d = e.target.closest('.bar'); if (!d) return;
  const i = +d.dataset.i;
  if (mode === 'tutor') setMode('free');
  if (e.shiftKey) setRange(anchor, i); else { anchor = i; setRange(i, i); }
};
el.secChips.onclick = e => {
  const d = e.target.closest('[data-sec]'); if (!d) return;
  if (d.dataset.sec === 'all') setRange(0, song.nbars - 1);
  else { const s = song.sections[+d.dataset.sec]; anchor = s.from; setRange(s.from, s.to); }
};
const handClick = e => {
  const d = e.target.closest('[data-hand]'); if (!d) return;
  engine.setHands({ [d.dataset.hand]: d.dataset.v });
  view.setHands(engine.hands); view.clearMarks(); syncFree();
};
el.lhChips.onclick = handClick;
el.chChips.onclick = e => { const d = e.target.closest('[data-ch]'); if (d) setFreeChallenge(d.dataset.ch); };
el.rhChips.onclick = handClick;

el.tempo.oninput = e => userBpm(+e.target.value);
bindVolumeSlider(el.vol, el.volv);
el.tempoMark.onclick = () => {
  tempos = forgetTempo(tempos, tempoStep);
  setBpm(tempoStep.bpm);
  save();
};
const BPM_MIN = +el.tempo.min, BPM_MAX = +el.tempo.max;
el.bpmv.onfocus = () => getSelection().selectAllChildren(el.bpmv);
el.bpmv.onkeydown = e => {
  if (e.key === 'Enter') { e.preventDefault(); el.bpmv.blur(); }
  else if (e.key === 'Escape') { e.preventDefault(); el.bpmv.textContent = el.tempo.value; el.bpmv.blur(); }
};
el.bpmv.onblur = () => {
  const v = parseInt(el.bpmv.textContent.replace(/[^0-9]/g, ''), 10);
  if (!Number.isFinite(v)) { el.bpmv.textContent = el.tempo.value; return; }
  userBpm(Math.min(BPM_MAX, Math.max(BPM_MIN, v)));
};

addEventListener('keydown', e => {
  const t = e.target;
  if (e.repeat || (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)))) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (e.code === 'Space') { e.preventDefault(); if (pending) advance(); else engine.running ? halt() : start(); }
  else if (k === 'n' && mode === 'tutor') applyStep(si + 1);
  else if (k === 'p' && mode === 'tutor') applyStep(si - 1);
  else if (k === 'h' && mode === 'tutor') el.hear.onclick();
  else if (k === 'g') toggleGuide();
  else if (k === 'w') el.waitBtn.onclick();
  else if (k === 'l') el.loopBtn.onclick();
  else if (k === 'm') el.metro.onclick();
  else if (k === 't') setMode('tutor');
  else if (k === 'f') setMode('free');
  else return;
  if (t?.tagName === 'BUTTON') t.blur();
});
addEventListener('resize', () => song && redrawRoll());

/**
 * Remote mode: this laptop hosts, a phone mirrors. Everything the phone may ask for
 * is one entry below, and everything it may see is a getter -- host.js knows nothing
 * else about this page, and this page knows nothing about the relay.
 */
const share = mountHost(
  { btn: $('shareBtn'), box: $('sharebox'), qr: $('shareqr'),
    hint: $('sharehint'), url: $('shareurl'), state: $('sharestate') },
  {
    engine, clock, overlay: el.overlay,
    song: () => song, plan: () => plan, si: () => si, mode: () => mode, view: () => viewName,
    hearing: () => hearing, freeCh: () => freeCh, done: () => done, best: () => best,
    results: () => (mode === 'tutor' ? streak : freeStreak).results(),
    cmd: {
      start: () => { if (!engine.running) start(); },
      stop: () => halt(),
      toggle: () => (engine.running ? halt() : start()),
      next: () => applyStep(si + 1, true),
      prev: () => applyStep(si - 1),
      step: ev => applyStep(ev.i, !!ev.start),
      seek: ev => engine.seek(ev.beat),
      bpm: ev => userBpm(Math.min(BPM_MAX, Math.max(BPM_MIN, Math.round(ev.bpm)))),
      hands: ev => { engine.setHands(ev.hands); view.setHands(engine.hands); view.clearMarks(); syncFree(); },
      range: ev => { if (mode === 'tutor') setMode('free'); setRange(ev.from, ev.to); },
      wait: ev => { engine.setWait(ev.on); if (mode === 'free') setFreeChallenge(freeCh); syncTransport(); },
      loop: ev => { engine.setLoop(ev.on); syncTransport(); },
      metro: ev => { engine.setMetro(ev.on); syncTransport(); },
      guide: ev => { engine.setGuide(ev.on); el.guide.classList.toggle('on', engine.guide); el.guide2.classList.toggle('on', engine.guide); },
      mode: ev => setMode(ev.mode),
      out: ev => setOutputMode(ev.mode),      // the toggle relabels itself from midi.js

      challenge: ev => setFreeChallenge(ev.k),
      hear: () => (hearing ? halt() : hear()),
      advance: () => { if (pending) advance(); },
      again: () => applyStep(si, true),
    },
  });

/**
 * The jam: another person, another machine, the same room. It is deliberately its own
 * connection and its own switch rather than something the share panel implies -- this
 * laptop can be hosting a phone, jamming, both or neither, and each of those is a
 * thing the pianist said rather than a thing the app guessed. midi.js's two doors are
 * handed in: what the pianist plays goes out, what the others play comes back in
 * through the same send() the app's own notes use, so the Out toggle and the volume
 * apply to a jam partner exactly as they do to the tutor's companion hand.
 */
const jam = mountJam(
  { btn: $('jamBtn'), box: $('jambox'), hint: $('jamhint'), state: $('jamstate') },
  { onMidi, play: midiSend });

/**
 * Feedback: a note about how that went, onto the standing GitHub issue, without
 * getting up from the piano. Every getter below is a read -- nothing here may stop
 * the loop, reset the meter or touch the streak, because the whole reason it is on
 * this page rather than in a browser tab is that it costs nothing mid-lesson.
 *
 * The success hint is the one thing worth assembling: what the meter is showing
 * right now if anything is running, else the pass that just finished, else the best
 * this step has been. successOf picks; see feedback.js.
 */
function liveNow() {
  if (!song || !engine.running || hearing) return null;
  const ch = mode === 'tutor' ? plan[si]?.challenge : CHALLENGES[freeCh];
  if (!ch || ch.kind === 'none') return null;
  const st = engine.stats(ch.seconds ?? 10);
  // a window challenge measures the last N seconds, and only when there is a clock
  return ch.kind === 'window' && !engine.wait ? st.win : st.live;
}

mountFeedback($('fbBtn'), {
  device: 'laptop',
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
    const passes = (mode === 'tutor' ? streak : freeStreak).passes;
    const s = mode === 'tutor' ? plan[si] : null;
    return successOf({ live: liveNow(), lastPass: passes[passes.length - 1] ?? null,
                       best: s ? best[s.id] ?? null : null });
  },
});

initMidi({
  onStatus: s => { midiStatus = s; el.status.textContent = s; },
  onNote: () => {
    el.played.textContent = [...held].sort((a, b) => a - b).map(noteName).join(' ') || '–';
    el.inled.classList.add('hit');
    clearTimeout(ledTimer);
    ledTimer = setTimeout(() => el.inled.classList.remove('hit'), 140);
    paint(engine.position());
    share.pushHeld(held);           // so the phone's key strip shows the same fuchsia
  },
});

if (SONGS.length) pick(0);

/**
 * Exposed for the headless checks: `receive` injects MIDI as if it came from the
 * piano, and `demo(accuracy)` plays the current step's expected notes through it
 * with a bit of human jitter, dropping some, so the scoring can be exercised
 * without a piano attached.
 */
window.__mm = {
  engine, clock, views, setView, share, jam, get view() { return view; }, receive, onMidi, swungBeat, get song() { return song; }, get plan() { return plan; }, get si() { return si; },
  get mode() { return mode; }, get done() { return done; }, get tempos() { return tempos; }, applyStep, setMode, setRange,
  /** Freeze the step-done countdown, so a screenshot can catch the overlay. */
  holdCountdown() { if (pending) clearInterval(pending.timer); },
  demo(accuracy = 1, jitterBeats = 0.06) {
    const exp = engine.tally?.expected ?? [];
    const spb = 60000 / clock.bpm;
    const timers = [];
    const fire = () => {
      // each note at its next occurrence from now, so a call mid-pass covers the rest of it
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
    };
    fire();
    return () => timers.forEach(clearTimeout);
  },
  /** Wait mode: press the notes the engine is waiting on, one group at a time. */
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
