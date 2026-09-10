// Wiring for the looper page: transport, keys, MIDI in, the inspector, persistence.

import { loadTracks } from '../tracks.js';
import { held, initMidi, onMidi } from '../midi.js';
import { audio } from '../metronome.js';
import { mountOutToggle } from '../outtoggle.js';
import { renderKeys } from '../keyboard.js';
import { NAMES, noteName } from '../theory.js';
import { heldLabel } from '../readout.js';
import { makeClock, mod } from '../clock.js';
import { makeBuffer } from './buffer.js';
import { makeEngine } from './engine.js';
import { makeUi } from './ui.js';
import { initTips } from './tips.js';
import { bindVolumeSlider } from '../volume.js';
import {
  GRIDS, SNAPS, LANE_COLOURS, LEVELS, canFill, toMelody,
} from './loops.js';
import {
  SPAN, laneNotes, pickNote, rollPoint, snapBeat, snapLen, stepOf,
} from './edit.js';

const $ = id => document.getElementById(id);
const el = {
  tracks: $('tracks'), setline: $('setline'), restore: $('restoreBtn'), melody: $('melodyBtn'),
  composer: $('composerBtn'),
  play: $('play'), stop: $('stop'), metro: $('metroBtn'), back: $('backBtn'), outsel: $('outsel'),
  pos: $('pos'), tempo: $('tempo'), bpmv: $('bpmv'), played: $('played'),
  inled: $('inled'), status: $('statusEl'),
  snap: $('snapBtn'), grid: $('gridBtn'), insp: $('inspBtn'),
  strip: $('strip'), rhead: $('rhead'), lanes: $('lanes'),
  cap: $('capBtn'), capOpts: $('capOpts'), capBack: $('capBack'), capFwd: $('capFwd'),
  capOff: $('capOff'), bufnotes: $('bufnotes'), bufwin: $('bufwin'),
  rec: $('recBtn'), undo: $('undoBtn'), clear: $('clearBtn'), selline: $('selline'),
  legend: $('legend'), info: $('info'), kb: $('kb'),
  panel: $('insp'),
  iNum: $('iNum'), iName: $('iName'), iState: $('iState'), iSpan: $('iSpan'),
  iLens: $('iLens'), iModes: $('iModes'), iFollow: $('iFollow'), iFollowHint: $('iFollowHint'),
  iGrids: $('iGrids'), iStrength: $('iStrength'), iLayers: $('iLayers'),
  vol: $('volume'), volv: $('volumev'),
};

const CAP_BARS = [1, 2, 4, 0];              // 0 = the whole chorus
const clock = makeClock(100);
const buffer = makeBuffer(clock);
const engine = makeEngine({ clock, buffer });

let TRACKS = [];
let ti = 0, sel = 0, capIdx = 2, capOff = 0, ledTimer = null, saveTimer = null;
let shownRev = -1, shownSel = -1;      // what the deck and inspector last drew
let fix = null;                        // { i, src }: the note being fixed, if any
let drag = null;                       // a pointer on the roll, mid-gesture

const capBars = () => CAP_BARS[capIdx] || engine.nbars;
const ui = makeUi(engine, clock, el, { held, buffer, capBars, capOff: () => capOff });

// ---------------------------------------------------------------- track + transport
function pick(i) {
  ti = i;
  fix = null;
  const t = TRACKS[i];
  engine.load(t);
  el.tracks.querySelectorAll('.trk').forEach((n, k) => n.classList.toggle('on', k === i));
  el.tempo.value = t.bpm;
  el.bpmv.textContent = t.bpm;
  sel = 0;
  capOff = 0;
  renderInfo();
  el.restore.hidden = !localStorage.getItem(setKey());
  el.setline.textContent = 'empty';
  ui.sync(sel, true, fix);
}

function renderInfo() {
  const t = engine.track;
  if (!t) return;
  const r = mod(t.root, 12);
  const chords = [...new Set(engine.bars.map(b => b.chord))];
  el.info.innerHTML =
    `<div>${NAMES[r]} ${t.scaleName}: <b>${t.scale.map(i => NAMES[(r + i) % 12]).join(' ')}</b></div>`
    + `<div>Chords: <b>${chords.join('  ')}</b></div>`
    + '<span class="keylegend">'
    + '<span><i class="sw" style="background:#ffeec2"></i>scale</span>'
    + '<span><i class="sw" style="background:var(--play)"></i>backing</span>'
    + `<span><i class="sw" style="background:linear-gradient(90deg,${LANE_COLOURS[0]},${LANE_COLOURS[3]})"></i>loops</span>`
    + '<span><i class="sw" style="background:var(--you);box-shadow:0 0 8px rgba(255,47,214,.6)"></i>you</span>'
    + '</span>';
}

const start = () => { audio(); engine.play(); syncTransport(); };
const halt = () => { engine.stop(); syncTransport(); };

function syncTransport() {
  el.play.textContent = engine.running ? '❚❚ Pause' : '▶ Play';
  el.play.classList.toggle('tgl', true);
  el.play.classList.toggle('on', engine.running);
}

// ---------------------------------------------------------------- deck + inspector
function syncDeck() {
  const s = engine.slots[sel];
  const st = ui.stateOf(s);
  el.rec.textContent = s.st === 'empty' ? '● Record'
    : s.st === 'rec' ? '■ End loop' : s.st === 'dub' ? '■ End overdub' : '● Overdub';
  el.rec.classList.toggle('on', s.st === 'rec' || s.st === 'dub' || !!s.pend);
  el.undo.disabled = s.layers.length < 2 && !s.undo.length;
  el.clear.disabled = s.st === 'empty';
  el.selline.textContent = `lane ${sel + 1}`
    + (s.name ? ` · ${s.name}` : '') + (st.label ? ` · ${st.label}` : '');
  el.snap.textContent = SNAPS[engine.snap].name;
  el.grid.textContent = GRIDS[engine.grid].name;
  el.grid.classList.toggle('on', engine.grid > 0);
  el.capOpts.innerHTML = CAP_BARS.map((n, i) =>
    `<button class="mini${i === capIdx ? ' on' : ''}" data-cap="${i}" `
    + `data-tip="Capture ${n ? 'the last ' + n + ' bar' + (n === 1 ? '' : 's') : 'a whole chorus'}">`
    + `${n ? n + ' bar' : 'chorus'}</button>`).join('');
  el.capOff.textContent = capOff ? `${capOff} bar${capOff === 1 ? '' : 's'}` : 'now';
  const used = engine.slots.filter(x => x.st !== 'empty').length;
  el.setline.textContent = used ? `${used} of 4 lanes used` : 'empty';
}

function syncInsp() {
  if (el.panel.hidden) return;
  const s = engine.slots[sel], st = ui.stateOf(s), col = LANE_COLOURS[sel];
  el.iNum.textContent = sel + 1;
  el.iNum.style.background = col;
  el.iName.textContent = s.name || '–';
  el.iState.textContent = st.label;
  el.iState.style.color = st.col;
  el.iSpan.textContent = s.st === 'empty' ? 'Nothing recorded here yet.'
    : `${s.lenBars} bar · from bar ${s.fromBar + 1} · over ${engine.bars[s.fromBar]?.chord ?? ''}`;

  const lens = [1, 2, 4, engine.nbars].filter((v, i, a) => a.indexOf(v) === i);
  el.iLens.innerHTML = lens.map(n =>
    `<button class="mini${s.lenBars === n ? ' on' : ''}" data-len="${n}" `
    + `data-tip="Make the loop ${n === engine.nbars ? 'a whole chorus' : n + ' bar' + (n === 1 ? '' : 's')} long">`
    + `${n === engine.nbars ? 'chorus' : n + ' bar'}</button>`).join('');

  const fill = canFill(s.lenBars, engine.nbars);
  el.iModes.innerHTML = [
    ['fill', 'Fill', `repeats every ${s.lenBars} bars, through the chorus`],
    ['phrase', 'Phrase', 'plays once per chorus, in its own bars'],
  ].map(([k, t, d]) =>
    `<button class="${s.mode === k ? 'on' : ''}" data-mode="${k}"`
    + `${k === 'fill' && !fill ? ' disabled' : ''}>${t}<small>${d}</small></button>`).join('');

  el.iFollow.textContent = s.follow ? 'on' : 'off';
  el.iFollow.classList.toggle('on', s.follow);
  el.iFollow.disabled = !fill;
  el.iFollowHint.textContent = !fill ? 'only applies to a loop that repeats inside the form'
    : s.follow ? 'repeats move with the harmony' : 'repeats play at the pitches you played';

  el.iGrids.innerHTML = GRIDS.map((g, i) =>
    `<button class="mini${engine.grid === i ? ' on' : ''}" data-grid="${i}" `
    + `data-tip="${i ? 'Snap onto ' + g.name + ' — swung to match the track' : 'Leave the timings exactly as played'}"`
    + `>${g.name}</button>`).join('');
  el.iStrength.innerHTML = [0, .25, .5, .75, 1].map(v =>
    `<button class="mini${engine.strength >= v ? ' on' : ''}" data-str="${v}" `
    + `data-tip="${v ? 'Pull notes ' + Math.round(v * 100) + '% of the way onto the grid' : 'Leave the timings alone'}"`
    + `></button>`).join('');

  el.iLayers.innerHTML = s.layers.length
    ? s.layers.map((ly, i) =>
      `<div class="layer"><b style="background:${col};opacity:${(0.45 + i * 0.25).toFixed(2)}"></b>`
      + `pass ${i + 1}<small>${ly.length} note${ly.length === 1 ? '' : 's'}</small></div>`)
      .reverse().join('')
    : '<div class="ihint">Nothing recorded here yet.</div>';
}

function syncAll() {
  ui.sync(sel, false, fix);
  syncDeck();
  syncInsp();
  scheduleSave();
  shownRev = engine.rev;
  shownSel = sel;
}

// ---------------------------------------------------------------- persistence
const setKey = () => 'middleman.looper.' + (engine.track?.id ?? '?');

/** The set as it stands, written now. False when there is nothing worth keeping. */
function saveSet() {
  clearTimeout(saveTimer);
  if (!engine.track) return false;
  const used = engine.slots.filter(s => s.st !== 'empty' && s.layers.length);
  if (!used.length) return false;
  const doc = {
    v: 1, grid: engine.grid, strength: engine.strength,
    slots: engine.slots.map(s => s.st === 'empty' || !s.layers.length ? null : {
      name: s.name, fromBar: s.fromBar, lenBars: s.lenBars, mode: s.mode,
      follow: s.follow, level: s.level, oct: s.oct, mute: s.mute, layers: s.layers,
    }),
  };
  try { localStorage.setItem(setKey(), JSON.stringify(doc)); } catch { /* quota */ }
  el.restore.hidden = false;
  return true;
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveSet, 700);
}

function restoreSet() {
  fix = null;
  const raw = localStorage.getItem(setKey());
  if (!raw) return;
  let doc;
  try { doc = JSON.parse(raw); } catch { return; }
  engine.setGrid(doc.grid ?? 0);
  engine.setStrength(doc.strength ?? 1);
  doc.slots?.forEach((d, i) => {
    if (!d) return;
    engine.patch(i, s => Object.assign(s, d, { st: 'play', pend: null, undo: [], sched: clock.beat() }));
  });
  syncAll();
}

// ---------------------------------------------------------------- keys
const EDITABLE = /^(INPUT|TEXTAREA|SELECT)$/;

addEventListener('keydown', e => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const t = e.target;
  if (t && (t.isContentEditable || EDITABLE.test(t.tagName))) return;
  const k = e.key.toLowerCase();
  const s = engine.slots[sel];
  const take = () => e.preventDefault();

  // A picked note takes the arrows, the brackets and Delete for as long as it is
  // picked: they are the lane's own keys otherwise, and Esc hands them straight back.
  if (fix && engine.slots[fix.i]?.st === 'play') {
    if (e.key === 'Escape') { take(); fix = null; syncAll(); return; }
    const raw = laneNotes(engine.slots[fix.i])[fix.src];
    const step = stepOf(GRIDS[engine.grid].div);
    const after = at => { if (at >= 0) fix = { ...fix, src: at }; syncAll(); };
    if (raw) {
      const nudge = (db, dp) => after(engine.edit(fix.i,
        { kind: 'move', i: fix.src, b: Math.max(0, raw.b + db), p: raw.p + dp }));
      if (e.key === 'ArrowLeft') { take(); nudge(-step, 0); return; }
      if (e.key === 'ArrowRight') { take(); nudge(step, 0); return; }
      if (e.key === 'ArrowUp') { take(); nudge(0, 1); return; }
      if (e.key === 'ArrowDown') { take(); nudge(0, -1); return; }
      if (k === '[' || k === ']') {
        take();
        after(engine.edit(fix.i,
          { kind: 'len', i: fix.src, len: raw.len + (k === ']' ? step : -step) }));
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        take();
        engine.edit(fix.i, { kind: 'del', i: fix.src });
        fix = null;
        syncAll();
        return;
      }
    }
  }

  if (k >= '1' && k <= '4') { take(); sel = +k - 1; fix = null; syncAll(); return; }
  if (k === 'r') { take(); fix = null; engine.press(sel); syncAll(); return; }
  if (k === 'c') { take(); fix = null; doCapture(); return; }
  if (k === 'u') { take(); fix = null; e.shiftKey ? engine.redo(sel) : engine.undo(sel); syncAll(); return; }
  if (k === 'm') { take(); engine.patch(sel, x => { x.mute = !x.mute; }); syncAll(); return; }
  if (k === 's') { take(); engine.patch(sel, x => { x.solo = !x.solo; }); syncAll(); return; }
  if (k === 'x') { take(); fix = null; engine.clear(sel); syncAll(); return; }
  if (k === 'f') {
    take();
    if (canFill(s.lenBars, engine.nbars)) engine.patch(sel, x => { x.follow = !x.follow; });
    syncAll(); return;
  }
  if (k === 'q') { take(); engine.setGrid(engine.grid + 1); syncAll(); return; }
  if (k === '[' || k === ']') { take(); resize(k === ']'); return; }
  if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
    take();
    const d = e.key === 'ArrowUp' ? 1 : -1;
    engine.patch(sel, x => { x.oct = Math.max(-2, Math.min(2, x.oct + d)); });
    syncAll(); return;
  }
  if (k === '+' || k === '=' || k === '-') {
    take();
    const d = k === '-' ? -1 : 1;
    engine.patch(sel, x => { x.level = Math.max(0, Math.min(LEVELS.length - 1, x.level + d)); });
    syncAll(); return;
  }
  if (e.key === 'Escape') { take(); engine.stopAll(); syncAll(); return; }
  if (e.code === 'Space') { take(); engine.running ? halt() : start(); return; }
  if (k === 'i') { take(); toggleInsp(); return; }
});

function resize(up) {
  const s = engine.slots[sel];
  if (s.st === 'empty') return;
  const steps = [1, 2, 4, engine.nbars].filter((v, i, a) => a.indexOf(v) === i);
  let k = steps.indexOf(s.lenBars);
  if (k < 0) k = steps.findIndex(v => v > s.lenBars);
  k = Math.max(0, Math.min(steps.length - 1, (k < 0 ? steps.length - 1 : k) + (up ? 1 : -1)));
  setLen(steps[k]);
}

function setLen(n) {
  engine.patch(sel, s => {
    s.lenBars = n;
    s.fromBar = mod(s.fromBar, engine.nbars);
    if (!canFill(n, engine.nbars)) { s.mode = 'phrase'; s.follow = false; }
  });
  syncAll();
}

function doCapture() {
  fix = null;
  const ok = engine.capture(sel, capBars(), capOff);
  el.status.textContent = ok
    ? `captured ${capBars()} bar${capBars() === 1 ? '' : 's'} into lane ${sel + 1}`
    : 'nothing in the buffer to capture yet';
  syncAll();
}

function toggleInsp() {
  el.panel.hidden = !el.panel.hidden;
  document.body.classList.toggle('insp', !el.panel.hidden);
  el.insp.classList.toggle('on', !el.panel.hidden);
  syncInsp();
}

// ---------------------------------------------------------------- fixing notes
// A lane's roll is editable in place: click a note to pick it, drag it (or its right
// end) to change it, arrows to nudge, Del to lose it. Every gesture ends in one
// `engine.edit`, which flattens the lane and pushes what it replaced onto the undo
// stack -- so a wrong drag is one U away, exactly like a wrong overdub.
const EDGE_PX = 7, SLOP_PX = 3;

const laneEl = i => el.lanes.querySelector(`.lane[data-i="${i}"]`);

/** Where a pointer sits on a lane's roll, measured against the box the notes live in. */
function rollAt(i, e) {
  const box = laneEl(i).querySelector('.lnotes').getBoundingClientRect();
  return {
    box,
    at: rollPoint((e.clientX - box.left) / box.width,
      (e.clientY - box.top) / box.height, engine.formBeats),
  };
}

/** The drag, drawn: the note and its repeats move with the pointer until it is let go. */
function preview(dx, dy, wPct) {
  laneEl(drag.i)?.querySelectorAll('.lnotes i.pick').forEach(n => {
    n.style.transform = `translate(${dx.toFixed(1)}px,${dy.toFixed(1)}px)`;
    if (wPct != null) n.style.width = wPct.toFixed(3) + '%';
  });
}

/** What the pointer is asking for, in the lane's own coordinates. */
function asked(e) {
  const { at, box } = rollAt(drag.i, e);
  const div = GRIDS[engine.grid].div;
  if (drag.edge) return { kind: 'len', len: snapLen(at.b - drag.shown, div), box };
  return {
    kind: 'move', box,
    b: snapBeat(at.b - drag.db, div, engine.track.swing),
    p: Math.round(at.p - drag.dp),
  };
}

el.lanes.addEventListener('pointerdown', e => {
  if (e.button || !e.target.closest('.lroll')) return;
  const lane = e.target.closest('.lane');
  if (!lane) return;
  const i = +lane.dataset.i, s = engine.slots[i];
  sel = i;
  drag = null;
  if (s.st !== 'play' || !s.layers.length) { fix = null; syncAll(); return; }
  const { at, box } = rollAt(i, e);
  const drawn = engine.notesOf(i);
  // a note is a few pixels tall, so "near enough in pitch" is a matter of geometry
  const k = pickNote(drawn, at, Math.max(1.5, SPAN * 4 / box.height));
  if (k < 0) { fix = null; syncAll(); return; }
  const n = drawn[k];
  const right = (n.b + n.len) / engine.formBeats * box.width;
  drag = {
    i, src: n.src, db: n.db, dp: n.dp, shown: n.b, pitch: n.p - n.dp,
    edge: right - (e.clientX - box.left) <= EDGE_PX,
    x0: e.clientX, y0: e.clientY, moved: false,
  };
  fix = { i, src: n.src };
  el.lanes.setPointerCapture?.(e.pointerId);
  syncAll();
});

el.lanes.addEventListener('pointermove', e => {
  if (!drag) return;
  drag.moved ||= Math.abs(e.clientX - drag.x0) > SLOP_PX || Math.abs(e.clientY - drag.y0) > SLOP_PX;
  if (!drag.moved) return;
  const g = asked(e);
  if (g.kind === 'len') preview(0, 0, g.len / engine.formBeats * 100);
  else preview((drag.db + g.b - drag.shown) / engine.formBeats * g.box.width,
    -(g.p - drag.pitch) * g.box.height / SPAN);
});

function endDrag(e) {
  if (!drag) return;
  const d = drag, g = d.moved ? asked(e) : null;
  drag = null;
  if (g) {
    const at = g.kind === 'len'
      ? engine.edit(d.i, { kind: 'len', i: d.src, len: g.len })
      : engine.edit(d.i, { kind: 'move', i: d.src, b: g.b, p: g.p });
    if (at >= 0) fix = { i: d.i, src: at };
    el.status.textContent = at >= 0 ? `lane ${d.i + 1}: note fixed — U puts the take back`
      : 'nothing to change there';
  }
  ui.sync(sel, true, fix);      // the preview was inline styles; draw it properly
  syncAll();
}

el.lanes.addEventListener('pointerup', endDrag);
el.lanes.addEventListener('pointercancel', endDrag);

// ---------------------------------------------------------------- clicks
el.lanes.onclick = e => {
  const lane = e.target.closest('.lane');
  if (!lane) return;
  const i = +lane.dataset.i;
  sel = i;
  if (e.target.closest('.mute')) engine.patch(i, s => { s.mute = !s.mute; });
  else if (e.target.closest('.solo')) engine.patch(i, s => { s.solo = !s.solo; });
  else if (e.target.closest('.follow')) engine.patch(i, s => { s.follow = !s.follow; });
  else if (e.target.closest('.lev')) {
    const box = e.target.closest('.lev').getBoundingClientRect();
    const f = (e.clientX - box.left) / box.width;
    engine.patch(i, s => { s.level = Math.max(0, Math.min(4, Math.floor(f * 5))); });
  }
  syncAll();
};
el.lanes.ondblclick = e => {
  const lane = e.target.closest('.lane');
  if (!lane) return;
  const i = +lane.dataset.i;
  const name = e.target.closest('.lname');
  if (name && engine.slots[i].st !== 'empty') {
    name.contentEditable = 'plaintext-only';
    name.focus();
    getSelection().selectAllChildren(name);
    name.onkeydown = ev => { if (ev.key === 'Enter' || ev.key === 'Escape') { ev.preventDefault(); name.blur(); } };
    name.onblur = () => {
      name.contentEditable = 'false';
      engine.patch(i, s => { s.name = name.textContent.trim().slice(0, 24) || s.name; });
      syncAll();
    };
    return;
  }
  if (e.target.closest('.lroll')) { engine.press(i); syncAll(); }
};

el.capOpts.onclick = e => {
  const b = e.target.closest('[data-cap]');
  if (!b) return;
  capIdx = +b.dataset.cap;
  capOff = Math.min(capOff, engine.nbars * 2 - capBars());
  syncDeck();
};
el.capBack.onclick = () => { capOff = Math.min(engine.nbars - capBars(), capOff + 1); syncDeck(); };
el.capFwd.onclick = () => { capOff = Math.max(0, capOff - 1); syncDeck(); };
el.cap.onclick = doCapture;

el.rec.onclick = () => { fix = null; engine.press(sel); syncAll(); };
el.undo.onclick = () => { fix = null; engine.undo(sel); syncAll(); };
el.clear.onclick = () => { fix = null; engine.clear(sel); syncAll(); };
el.snap.onclick = () => { engine.setSnap(engine.snap + 1); syncDeck(); };
el.grid.onclick = () => { engine.setGrid(engine.grid + 1); syncAll(); };
el.insp.onclick = toggleInsp;
el.restore.onclick = restoreSet;

el.panel.onclick = e => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.len) setLen(+b.dataset.len);
  else if (b.dataset.mode) engine.patch(sel, s => { s.mode = b.dataset.mode; });
  else if (b.dataset.grid) engine.setGrid(+b.dataset.grid);
  else if (b.dataset.str !== undefined) engine.setStrength(+b.dataset.str);
  else if (b === el.iFollow) engine.patch(sel, s => { s.follow = !s.follow; });
  syncAll();
};

el.melody.onclick = async () => {
  const s = engine.slots[sel];
  if (s.st === 'empty' || !s.layers.length) { el.status.textContent = 'lane is empty'; return; }
  const m = toMelody(s, engine.track,
    { div: GRIDS[engine.grid].div, strength: engine.strength });
  const text = JSON.stringify({ [engine.track.id + '-lane' + (sel + 1)]: m }, null, 2);
  try {
    await navigator.clipboard.writeText(text);
    el.status.textContent = 'melody copied to clipboard';
  } catch {
    console.log(text);
    el.status.textContent = 'clipboard blocked — melody is on the console';
  }
};

// The lanes, opened as a piece on the Composer page. Nothing travels in the URL but
// the track: the set itself goes through localStorage, where it is already kept, and
// the composer reads that key and tracks.json for itself. The write is normally 700 ms
// behind the last edit, so it is flushed here -- a page that navigates away with the
// timer still pending would hand the composer the *previous* set, which looks exactly
// like the app losing the last thing you played.
el.composer.onclick = () => {
  if (!engine.track) return;
  if (!saveSet()) { el.status.textContent = 'nothing recorded to open'; return; }
  location.href = 'composer.html?from=looper&track=' + encodeURIComponent(engine.track.id);
};

mountOutToggle(el.outsel, { tip: 'data-tip' });
el.play.onclick = () => (engine.running ? halt() : start());
el.stop.onclick = halt;
el.metro.onclick = () => {
  const on = !el.metro.classList.contains('on');
  el.metro.classList.toggle('on', on);
  audio();
  engine.setMetro(on);
};
el.back.onclick = () => {
  const on = !el.back.classList.contains('on');
  el.back.classList.toggle('on', on);
  engine.setBacking(on);
};

// ---------------------------------------------------------------- tempo
const BPM_MIN = +el.tempo.min, BPM_MAX = +el.tempo.max;
function setBpm(v) { el.bpmv.textContent = v; engine.setBpm(v); }
el.tempo.oninput = e => setBpm(+e.target.value);
bindVolumeSlider(el.vol, el.volv);
el.bpmv.onfocus = () => getSelection().selectAllChildren(el.bpmv);
el.bpmv.onkeydown = e => {
  if (e.key === 'Enter') { e.preventDefault(); el.bpmv.blur(); }
  else if (e.key === 'Escape') { e.preventDefault(); el.bpmv.textContent = el.tempo.value; el.bpmv.blur(); }
};
el.bpmv.onblur = () => {
  const v = parseInt(el.bpmv.textContent.replace(/[^0-9]/g, ''), 10);
  if (!Number.isFinite(v)) { el.bpmv.textContent = el.tempo.value; return; }
  const c = Math.min(BPM_MAX, Math.max(BPM_MIN, v));
  el.tempo.value = c;
  setBpm(c);
};

// ---------------------------------------------------------------- boot
try {
  TRACKS = await loadTracks();
} catch (err) {
  el.status.textContent = 'tracks.json: ' + err.message;
  el.tracks.innerHTML = `<div class="trk-err">Could not load tracks.json<br><small>${err.message}</small></div>`;
  console.error(err);
}

if (TRACKS.length) {
  el.tracks.innerHTML = TRACKS.map((t, i) =>
    `<div class="trk" data-i="${i}"${t.note ? ` data-tip="${t.note.replace(/"/g, '&quot;')}"` : ''}>`
    + `<div>${t.name}</div><small>${t.sub}</small></div>`).join('');
  el.tracks.onclick = e => {
    const d = e.target.closest('.trk');
    if (!d) return;
    const was = engine.running;
    halt();
    pick(+d.dataset.i);
    if (was) start();
  };
}

renderKeys(el.kb);
initTips();
if (TRACKS.length) pick(0);
syncTransport();
syncDeck();

initMidi({
  onStatus: s => { el.status.textContent = s; },
  onNote: () => {
    el.inled.classList.add('hit');
    clearTimeout(ledTimer);
    ledTimer = setTimeout(() => el.inled.classList.remove('hit'), 140);
  },
});
onMidi(ev => buffer.feed(ev));

(function loop() {
  requestAnimationFrame(loop);
  if (!engine.track) return;
  ui.sync(sel, false, fix);
  ui.frame(sel);
  ui.setPlayed(heldLabel([...held].sort((a, b) => a - b).map(noteName)) || '–');
  // These used to refresh only *while* a lane was busy, so the last frame drawn was
  // the busy one: when a take resolved to play the button stayed red for good.
  // Follow the same revision the lanes do, and the settled state gets drawn too.
  if (engine.rev !== shownRev || sel !== shownSel) {
    shownRev = engine.rev;
    shownSel = sel;
    syncDeck();
    syncInsp();
  }
})();

// exposed for debugging, and to drive the page without a piano attached
window.__lp = {
  engine, clock, buffer, ui, el,
  get sel() { return sel; },
  set sel(v) { sel = v; syncAll(); },
  /** Feed a phrase into the buffer as if it had been played. [[beat, len, pitch], ...] */
  seed(notes, atBeat = clock.beat() - 4) {
    for (const [b, len, p, v = 80] of notes) {
      buffer.feed({ on: 1, n: p, v, t: clock.time(atBeat + b) });
      buffer.feed({ on: 0, n: p, v: 0, t: clock.time(atBeat + b + len) });
    }
  },
  syncAll,
};
