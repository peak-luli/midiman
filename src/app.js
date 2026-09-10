// Wiring: transport, playhead, and the panels. Everything DOM-facing lives here.

import { loadTracks, build } from './tracks.js';
import { NAMES, noteName } from './theory.js';
import { heldLabel } from './readout.js';
import { held, initMidi, send, panic } from './midi.js';
import { audio, makeMetronome } from './metronome.js';
import { mountOutToggle } from './outtoggle.js';
import { makeClock } from './clock.js';
import { renderKeys, paintKeys } from './keyboard.js';
import { renderNotation, updateBarHl, paintPlayed } from './notation.js';
import { bindVolumeSlider } from './volume.js';

const $ = id => document.getElementById(id);
const el = {
  tracks: $('tracks'), grid: $('grid'), notation: $('notation'), notewrap: $('notewrap'),
  barhl: $('barhl'), info: $('info'), kb: $('kb'), pos: $('pos'), played: $('played'),
  inled: $('inled'), status: $('statusEl'), tempo: $('tempo'), bpmv: $('bpmv'),
  play: $('play'), stop: $('stop'), metro: $('metroBtn'), outsel: $('outsel'),
  melody: $('melody'), melLabel: $('melLabel'), melSound: $('melSoundBtn'),
  vol: $('volume'), volv: $('volumev'),
};

const LOOKAHEAD_MS = 200;   // schedule this far ahead; keeps Stop immediate
const TICK_MS = 50;

let cur = null;             // active track + its expanded event list
let view = { bars: [], chordEls: [], hasMel: false };
let melOn = false, melSound = true;   // show the melody staff / send it to the piano
let timer = null, idx = 0, cycle = 0, gen = 0;
// one clock for the notes, the click and the playhead; the built stretch (count-in
// plus a few choruses) repeats as cycle after cycle of absolute beats, so the seam
// between cycles is a beat like any other rather than a restart of the clock
const clock = makeClock(100);
const metro = makeMetronome(clock);
metro.setEnabled(false);
let lastBi = -1, ledTimer = null;
const sounding = new Set(); // notes the backing track is holding right now

// ---------------------------------------------------------------- transport
function play(ti) {
  stop();
  const t = TRACKS[ti];
  cur = { ...t, ...build(t), ti };

  el.tracks.querySelectorAll('.trk').forEach((n, i) => n.classList.toggle('on', i === ti));
  el.tempo.value = t.bpm;
  el.bpmv.textContent = t.bpm;
  syncMelUi();
  renderSheet();
  view = renderNotation(el.notation, cur, melOn);
  lastBi = -1;
  el.barhl.style.display = 'none';
  renderInfo();

  audio();      // the gesture the browser wants before the click or the synth can sound

  idx = 0; cycle = 0;
  clock.setBpm(t.bpm);
  clock.start(0);
  metro.setAccent(4, cur.start);           // beat 1 of the form, not of the count-in
  metro.start(0);
  const my = ++gen;
  timer = setInterval(() => {
    if (my !== gen) return;
    const now = performance.now(), horizon = now + LOOKAHEAD_MS;

    while (cur.ev.length) {
      if (idx >= cur.ev.length) { idx = 0; cycle++; }
      const e = cur.ev[idx], at = clock.time(cycle * cur.total + e.b);
      if (at >= horizon) break;
      idx++;
      // the written melody sounds only when it is shown AND its speaker is on:
      // note-offs still go out, so unticking it mid-note cannot leave a key hanging
      if (e.mel && e.on && !(melOn && melSound)) continue;
      // send() puts everything the app plays out at the volume level; the pianist's
      // own notes arrive on the other side of midi.js and never come past here
      if (at >= now - 30) send(e.on ? [0x90, e.n, e.v] : [0x80, e.n, 0], at);
    }
    metro.pump(LOOKAHEAD_MS);

    const beat = clock.beat(now);
    tick(beat - Math.floor(beat / cur.total) * cur.total);
  }, TICK_MS);
}

function stop() {
  gen++;
  clearInterval(timer);
  timer = null;
  metro.stop();
  clock.stop();
  panic();
  el.grid.querySelectorAll('.bar').forEach(b => b.classList.remove('cur'));
  clearCur();
  el.barhl.style.display = 'none';
  lastBi = -1;
  el.pos.textContent = '–';
  sounding.clear();
  paint();
}

// ---------------------------------------------------------------- playhead
function tick(beat) {
  if (!cur) return;
  sounding.clear();
  for (const e of cur.ev) {
    if (e.b > beat) break;
    if (e.on) sounding.add(e.n); else sounding.delete(e.n);
  }
  // only one chorus is drawn, so fold later ones back onto it
  const local = beat >= cur.start ? cur.start + ((beat - cur.start) % cur.formBeats) : beat;
  const bi = Math.floor((local - cur.start) / 4);

  el.grid.querySelectorAll('.bar').forEach((n, i) => n.classList.toggle('cur', i === bi));
  clearCur();
  const bar = cur.bars[bi], vb = view.bars[bi];
  if (bar && vb) {
    mark(vb.bass, bar.notes, local);
    // rests hold no element, so walk the sounding notes only -- same order as vb.mel
    mark(vb.mel, bar.mel.filter(m => m.n != null), local);
  }
  if (bi !== lastBi) { lastBi = bi; updateBarHl(el.barhl, el.notewrap, view, bi); }
  if (bi >= 0 && bi < cur.nbars)
    el.pos.textContent = `bar ${bi + 1}/${cur.nbars} · ${cur.bars[bi].chord}`;
  paint();
}

/** Blue the last note whose onset has passed, in one bar of one staff. */
function mark(els, notes, local) {
  let k = -1;
  for (let i = 0; i < notes.length; i++) if (notes[i].at <= local) k = i;
  if (k >= 0 && els[k]) els[k].classList.add('cur-note');
}

function clearCur() {
  for (const b of view.bars) {
    for (const e of b.bass) e.classList.remove('cur-note');
    for (const e of b.mel)  e.classList.remove('cur-note');
  }
}

/** The melody controls only make sense on a track that has one. */
function syncMelUi() {
  const has = !!cur?.melody;
  el.melody.disabled = !has;
  el.melLabel.classList.toggle('off', !has);
  el.melLabel.title = has ? `melody: ${cur.melody.name}` : 'this track has no melody';
  el.melSound.hidden = !(has && melOn);
}

function paint() {
  paintKeys(el.kb, { scale: cur?.scale, root: cur ? cur.root % 12 : 0, sounding, held });
  paintPlayed(view, held);
}

// ---------------------------------------------------------------- panels
function renderSheet() {
  el.grid.style.gridTemplateColumns = `repeat(${cur.nbars},1fr)`;
  el.grid.innerHTML = cur.bars.slice(0, cur.nbars)
    .map(b => `<div class="bar">${b.chord}</div>`).join('');
}

function renderInfo() {
  const r = cur.root % 12;
  const chords = [...new Set(cur.bars.slice(0, cur.nbars).map(b => b.chord))];
  el.info.innerHTML =
    `<div>${NAMES[r]} ${cur.scaleName}: <b>${cur.scale.map(i => NAMES[(r + i) % 12]).join(' ')}</b></div>` +
    `<div>Chords: <b>${chords.join('  ')}</b></div>` +
    (cur.blue != null ? `<div>Blue note: <b>${NAMES[(r + cur.blue) % 12]}</b></div>` : '');
  paint();
}

// ---------------------------------------------------------------- tempo
function setBpm(v) {
  el.bpmv.textContent = v;
  if (!cur) return;
  cur.bpm = v;
  clock.setBpm(v);                   // re-anchors: the playhead and the next click stay put
}

// ---------------------------------------------------------------- wiring
// top-level await: the rest of the wiring runs once the track file has loaded
let TRACKS = [];
try {
  TRACKS = await loadTracks();
} catch (err) {
  el.status.textContent = 'tracks.json: ' + err.message;
  el.tracks.innerHTML = `<div class="trk-err">Could not load tracks.json<br><small>${err.message}</small></div>`;
  console.error(err);
}

el.tracks.innerHTML = TRACKS.map((t, i) =>
  `<div class="trk" data-i="${i}" title="${t.note || ''}">`
  + `<div>${t.name}</div><small>${t.sub}</small></div>`).join('') || el.tracks.innerHTML;
el.tracks.onclick = e => {
  const d = e.target.closest('.trk');
  if (d) play(+d.dataset.i);
};
el.play.onclick = () => play(cur ? cur.ti : 0);
el.stop.onclick = stop;
el.metro.onclick = () => {
  metro.setEnabled(!metro.enabled);
  el.metro.classList.toggle('on', metro.enabled);
  audio();
};

el.melody.onchange = () => {
  melOn = el.melody.checked;
  syncMelUi();
  if (!cur) return;
  view = renderNotation(el.notation, cur, melOn);
  lastBi = -1;                                  // force the chord box to re-measure
  paint();
};
el.melSound.onclick = () => {
  melSound = !melSound;
  el.melSound.classList.toggle('on', melSound);
  if (!melSound) panic();                       // kill anything the melody is holding
};
el.melSound.classList.toggle('on', melSound);

el.tempo.oninput = e => setBpm(+e.target.value);
bindVolumeSlider(el.vol, el.volv);
const BPM_MIN = +el.tempo.min, BPM_MAX = +el.tempo.max;
el.bpmv.onfocus = () => getSelection().selectAllChildren(el.bpmv);
el.bpmv.onkeydown = e => {
  if (e.key === 'Enter') { e.preventDefault(); el.bpmv.blur(); }
  else if (e.key === 'Escape') { e.preventDefault(); el.bpmv.textContent = el.tempo.value; el.bpmv.blur(); }
};
el.bpmv.onblur = () => {
  const v = parseInt(el.bpmv.textContent.replace(/[^0-9]/g, ''), 10);
  if (!Number.isFinite(v)) { el.bpmv.textContent = el.tempo.value; return; }
  const clamped = Math.min(BPM_MAX, Math.max(BPM_MIN, v));
  el.tempo.value = clamped;
  setBpm(clamped);
};

addEventListener('resize', () => {
  if (!cur) return;
  view = renderNotation(el.notation, cur, melOn);
  lastBi = -1;
});
addEventListener('keydown', e => {
  if (e.code !== 'Space' || e.repeat) return;
  const t = e.target;
  // don't hijack the bpm field, the slider, or a focused button
  if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(t.tagName))) return;
  e.preventDefault();
  if (timer) stop(); else play(cur ? cur.ti : 0);
});

syncMelUi();
mountOutToggle(el.outsel);
renderKeys(el.kb);
initMidi({
  onStatus: s => el.status.textContent = s,
  onNote: () => {
    el.played.textContent = heldLabel([...held].sort((a, b) => a - b).map(noteName)) || '–';
    el.inled.classList.add('hit');
    clearTimeout(ledTimer);
    ledTimer = setTimeout(() => el.inled.classList.remove('hit'), 140);
    paint();
  },
});

// exposed for debugging and for the headless render checks
window.__mm = { play, stop, tick, updateBarHl, clock, metro,
                get cur() { return cur; }, get view() { return view; }, el };
