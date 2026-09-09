// Wiring for the composer page: open a piece, play it, record over it, edit it on the
// roll, read it back on the staff, save it.
//
// The page owns no music of its own. A piece is a plain object, every change is a pure
// function of it (edit.js) pushed onto a history of snapshots, and after every change
// exactly one thing happens: `apply` redraws both views from the new piece. So the roll
// and the staff can never disagree, and Undo is a snapshot, not an inverse operation.
//
// The staff pane is the *written* form -- `parseSong(writeSong(piece))` -- so a tie or
// a rest that comes out wrong is visible here, before anything is saved. A take that
// cannot be written yet says so in words and offers Quantise: raw music plays, but it
// does not print.

import { parseSong, swungBeat, parseMeter } from '../song.js';
import { held, initMidi, onMidi, receive } from '../midi.js';
import { audio } from '../metronome.js';
import { mountOutToggle } from '../outtoggle.js';
import { renderKeys, paintKeys } from '../keyboard.js';
import { noteName } from '../theory.js';
import { makeClock } from '../clock.js';
import { loadTracks } from '../tracks.js';
import { makeBuffer } from '../looper/buffer.js';
import { slotNotes, GRIDS } from '../looper/loops.js';
import { initTips } from '../looper/tips.js';
import { makeStaff } from '../learn/staff.js';
import {
  emptyPiece, fromSong, fromTake, barsOf, beatsPerBarOf, swingOf, sortNotes,
} from './piece.js';
import {
  makeHistory, gridUnit, selected, moveTime, setPitch, setLen, remove, insert,
  split as splitNote, merge as mergeNote, quantise, unquantise, transpose, octave,
  shift, stretch, swapHands, sendToHand, humanise,
} from './edit.js';
import { writeSong, canWrite, writeMelody } from './write.js';
import { makeRoll } from './roll.js';
import { makeTransport } from './transport.js';
import {
  loadDraft, saveDraft, clearDraft, downloadSong, copyMelody, postSong, slugOf, sheetDefaults,
} from './save.js';

const $ = id => document.getElementById(id);
const el = {
  songs: $('songs'), sets: $('sets'), meterChips: $('meterChips'), swingChips: $('swingChips'),
  newBpm: $('newBpm'), newBtn: $('newBtn'),
  play: $('play'), stop: $('stop'), rec: $('recBtn'), metro: $('metroBtn'), outsel: $('outsel'),
  pos: $('pos'), tempo: $('tempo'), bpmv: $('bpmv'), undo: $('undoBtn'), redo: $('redoBtn'),
  played: $('played'), inled: $('inled'), status: $('statusEl'),
  handChips: $('handChips'), gridChips: $('gridChips'), raw: $('rawBtn'),
  save: $('saveBtn'), section: $('sectionBtn'), melody: $('melodyBtn'), draftline: $('draftline'),
  selline: $('selline'), selHands: $('selHands'), xforms: $('xforms'),
  secName: $('secName'), strip: $('strip'), viewRoll: $('viewRoll'),
  viewStaff: $('viewStaff'), staffmsg: $('staffmsg'),
  info: $('info'), kb: $('kb'),
  sheetbox: $('sheetbox'), sheetTitle: $('sheetTitle'), sheetId: $('sheetId'),
  sheetKey: $('sheetKey'), sheetBpm: $('sheetBpm'), dl: $('dlBtn'), post: $('postBtn'),
  sheetClose: $('sheetClose'), sheetStatus: $('sheetStatus'),
};

const KEYS = ['C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#', 'F', 'Bb', 'Eb', 'Ab', 'Db', 'Gb', 'Cb'];
const SHARP_KEYS = new Set(['G', 'D', 'A', 'E', 'B', 'F#', 'C#']);
const METERS = ['4/4', '3/4', '6/8', '2/4'];
const SWINGS = [['straight', 0.5], ['swing', '2/3']];
const SPLIT = 60;                       // middle C: the default hand split

const clock = makeClock(90);
const buffer = makeBuffer(clock);
const transport = makeTransport({ clock });
const staff = makeStaff(el.viewStaff);
const roll = makeRoll(el.viewRoll, { onGesture: gesture });

let history = makeHistory(emptyPiece({ title: 'Untitled' }));
let sel = null;                          // { from, to, hands } in beats, or null
let picked = null;                       // one note, by index into piece.notes
let hand = 'split';                      // what a new take becomes
let bpm = 90;                            // the transport's tempo, kept out of history
let newMeter = '4/4', newSwing = 0.5;
let recording = false, ledTimer = null, raf = 0, overwrite = false;

const piece = () => history.piece;
const bpb = () => beatsPerBarOf(piece());
const target = () => (sel ? sel : picked != null ? { idx: picked } : null);

// ---------------------------------------------------------------- the one edit path
/** Every change lands here: one snapshot, one draft, one redraw of both views. */
function apply(next) {
  history.push({ ...next, bpm });
  saveDraft(history.piece);
  draw();
}

/** A piece arriving from somewhere else (a song, a take, a draft) starts a new history. */
function open(p, from = null) {
  transport.stop();
  // the sidebar lights the song this piece came out of, and nothing when it came
  // from a take, a loop set or a draft
  el.songs.querySelectorAll('.trk').forEach((n, k) => n.classList.toggle('on', k === from));
  history = makeHistory(p);
  bpm = p.bpm ?? 90;
  sel = null; picked = null;
  clock.setBpm(bpm);
  el.tempo.value = bpm; el.bpmv.textContent = bpm;
  transport.load(p);
  if (p.notes.length) saveDraft(p);
  draw();
  el.status.textContent = `${p.title} · ${barsOf(p)} bars`;
}

function draw() {
  const p = piece();
  transport.load(p);
  transport.setSelection(sel);
  roll.render(p, { sel, picked });
  drawStaff(p);
  drawStrip(p);
  syncTools(p);
  const pos = transport.position();
  roll.playhead(pos.at, pos.countIn);
}

/**
 * The staff pane is the file you would save. When the piece cannot be written yet,
 * the pane says what is in the way in `parseSong`'s own voice -- and Quantise, one
 * chip away, is the answer to all of it.
 */
function drawStaff(p) {
  const why = canWrite(p);
  el.staffmsg.hidden = !why;
  el.viewStaff.hidden = !!why;
  if (why) {
    el.staffmsg.innerHTML = `<b>Not on the grid yet</b><div class="smsg">${why}</div>`
      + '<div class="smsg dim">A take plays exactly as you played it. Quantise it — 1/8, '
      + '1/16 or 1/8T above — and it can be written down, tied and beamed. Raw puts it back.</div>';
    return;
  }
  const sw = b => swungBeat(b, swingOf(p));
  staff.render(parseSong(writeSong(p)), 0, barsOf(p) - 1, sw);
}

function drawStrip(p) {
  const n = barsOf(p);
  el.strip.style.gridTemplateColumns = `repeat(${n},1fr)`;
  el.strip.innerHTML = Array.from({ length: n }, (_, i) =>
    `<div class="bar" data-i="${i}" data-tip="Bar ${i + 1}: click to select it, shift-click to stretch the selection">`
    + `${n <= 32 || i % 4 === 0 ? i + 1 : ''}</div>`).join('');
  const from = sel ? Math.floor(sel.from / bpb()) : -1, to = sel ? Math.ceil(sel.to / bpb()) - 1 : -1;
  el.strip.querySelectorAll('.bar').forEach((b, i) => b.classList.toggle('in', i >= from && i <= to));
  el.secName.textContent = sel
    ? `bars ${from + 1}–${to + 1}`
    : (p.sections[0]?.name ?? '–');
  el.info.innerHTML = `<div>${p.title}${p.credit ? ` · <span style="color:var(--dim)">${p.credit}</span>` : ''}`
    + ` · <span style="color:var(--dim)">${p.meter} · ${p.grid ? p.grid + ' grid' : p.raw ? 'raw take' : 'mixed lengths'} · ${p.notes.length} notes</span></div>`
    + '<span class="keylegend">'
    + '<span><i class="sw" style="background:var(--lh)"></i>left hand</span>'
    + '<span><i class="sw" style="background:var(--rh)"></i>right hand</span>'
    + '<span><i class="sw" style="background:var(--you);box-shadow:0 0 8px rgba(255,47,214,.6)"></i>you</span>'
    + '</span>';
}

// ---------------------------------------------------------------- the tool rows
const chip = (val, label, on, tip, attr = 'data-v') =>
  `<button class="chip${on ? ' on' : ''}" ${attr}="${val}" data-tip="${tip}">${label}</button>`;

const XFORMS = [
  ['oct+', 'Octave ↑', 'Everything selected an octave up'],
  ['oct-', 'Octave ↓', 'Everything selected an octave down'],
  ['tr+', '+1', 'Up one semitone'],
  ['tr-', '−1', 'Down one semitone'],
  ['sg-', '◀ grid', 'Back one grid step'],
  ['sg+', 'grid ▶', 'On one grid step'],
  ['sb-', '◀ bar', 'Back one bar'],
  ['sb+', 'bar ▶', 'On one bar'],
  ['x2', 'Double', 'Twice as slow: beats and lengths doubled, the bars follow'],
  ['x05', 'Halve', 'Twice as fast: beats and lengths halved'],
  ['swap', 'Swap hands', 'Left becomes right and right becomes left'],
  ['toLh', 'To left', 'Play it with the left hand'],
  ['toRh', 'To right', 'Play it with the right hand'],
  ['hum', 'Humanise', 'Off: one velocity a hand, as a sheet has. On: the velocities you played.'],
  ['split', 'Split', 'Cut the selected note at the playhead'],
  ['merge', 'Merge', 'Join it to the next note of the same pitch, if they touch'],
  ['del', 'Delete', 'Take the selected notes out'],
];

function syncTools(p) {
  el.gridChips.innerHTML = ['1/8', '1/16', '1/8T'].map(g =>
    chip(g, g, p.grid === g, `Pull every note onto ${g === '1/8T' ? 'triplet eighths' : g === '1/8' ? 'eighths' : 'sixteenths'} — swung to match the piece`, 'data-q')).join('');
  el.raw.disabled = !p.raw;
  el.handChips.innerHTML = [['rh', 'Right'], ['lh', 'Left'], ['split', 'Split at C4']].map(([v, t]) =>
    chip(v, t, hand === v, v === 'split' ? 'Anything under middle C goes to the left hand'
      : `A new take becomes the ${v === 'rh' ? 'right' : 'left'} hand`)).join('');
  el.selHands.innerHTML = ['lh', 'rh'].map(h =>
    chip(h, h === 'lh' ? 'Left' : 'Right', !!sel && sel.hands.includes(h),
      `Include the ${h === 'lh' ? 'left' : 'right'} hand in what the transforms touch`, 'data-h')).join('');
  el.xforms.innerHTML = XFORMS.map(([v, t, tip]) => chip(v, t, false, tip, 'data-x')).join('');
  const off = !target();
  el.xforms.querySelectorAll('button').forEach(b => { b.disabled = off; });
  el.section.disabled = !sel;
  el.selline.textContent = sel
    ? `bars ${Math.floor(sel.from / bpb()) + 1}–${Math.ceil(sel.to / bpb())} · `
      + `${selected(p, sel).length} note${selected(p, sel).length === 1 ? '' : 's'}`
    : picked != null && p.notes[picked]
      ? `${noteName(p.notes[picked].n)} at bar ${Math.floor(p.notes[picked].b / bpb()) + 1}`
      : 'nothing selected — drag across the roll to take some bars, or click a note';
  el.undo.disabled = !history.canUndo;
  el.redo.disabled = !history.canRedo;
  el.melody.disabled = parseMeter(p.meter).label !== '4/4';
}

// ---------------------------------------------------------------- gestures
function gesture(g) {
  const p = piece();
  if (g.kind === 'range') {
    sel = { from: g.from, to: Math.min(g.to, barsOf(p) * bpb()), hands: sel?.hands ?? ['lh', 'rh'] };
    picked = null;
    draw();
    return;
  }
  if (g.kind === 'pick') { picked = g.idx; sel = null; draw(); return; }
  if (g.kind === 'insert') {
    apply(insert(p, { b: g.b, n: g.n, hand: hand === 'split' ? (g.n < SPLIT ? 'lh' : 'rh') : hand }));
    return;
  }
  if (g.kind === 'len') { apply(setLen(p, g.idx, g.len)); return; }
  if (g.kind === 'drag') {
    // one gesture, one history step: the move and the repitch go on together
    let q = p;
    if (g.dBeats) q = moveTime(q, { idx: g.idx }, g.dBeats);
    if (g.dSemis) q = setPitch(q, { idx: g.idx }, g.dSemis);
    if (q !== p) apply(q);
  }
}

function transform(what) {
  const p = piece(), t = target();
  if (!t) return;
  const u = gridUnit(p.grid);
  const idx = picked != null && !sel ? picked : selected(p, t)[0];
  const ops = {
    'oct+': () => octave(p, t, 1), 'oct-': () => octave(p, t, -1),
    'tr+': () => transpose(p, t, 1), 'tr-': () => transpose(p, t, -1),
    'sg+': () => shift(p, t, u), 'sg-': () => shift(p, t, -u),
    'sb+': () => shift(p, t, bpb()), 'sb-': () => shift(p, t, -bpb()),
    x2: () => stretch(p, t, 2), x05: () => stretch(p, t, 0.5),
    swap: () => swapHands(p, t), toLh: () => sendToHand(p, t, 'lh'), toRh: () => sendToHand(p, t, 'rh'),
    hum: () => humanise(p, !humanised(p)),
    split: () => splitNote(p, idx, transport.position().at),
    merge: () => mergeNote(p, idx),
    del: () => { picked = null; return remove(p, t); },
  };
  const next = ops[what]?.();
  if (next) apply(next);
}

/** Are the velocities the ones that were played, or one value a hand? */
const humanised = p => new Set(p.notes.map(n => n.v)).size > 2;

// ---------------------------------------------------------------- transport
const play = () => { audio(); transport.play(); syncTransport(); };
const halt = () => { if (recording) endTake(); else transport.stop(); syncTransport(); };

function syncTransport() {
  el.play.classList.toggle('on', transport.running && !recording);
  el.play.textContent = transport.running && !recording ? '❚❚ Stop' : '▶ Play';
  el.rec.classList.toggle('on', recording);
  el.rec.textContent = recording ? '■ End take' : '● Record';
}

function startTake() {
  audio();
  buffer.clear();
  recording = true;
  transport.record();
  syncTransport();
  el.status.textContent = 'count-in — play when the bar comes round';
}

/**
 * Stop rounds the take up to a whole bar: the click gave the bar lines, so the end of
 * a take is a bar line, not wherever the last note happened to fall.
 */
function endTake() {
  const end = Math.max(bpb(), Math.ceil(clock.beat() / bpb() - 1e-6) * bpb());
  const take = buffer.slice(0, end);
  recording = false;
  transport.stop();
  syncTransport();
  if (!take.length) { el.status.textContent = 'nothing played — nothing recorded'; return; }
  const p = piece();
  const opts = {
    bpm, meter: p.meter, swing: p.swing, split: SPLIT,
    hand: hand === 'split' ? null : hand,
  };
  if (!p.notes.length) {
    // the empty piece stays behind in the history, so a take is a step you can undo
    const q = fromTake(take, { ...opts, header: { title: p.title, id: p.id, key: p.key, sharps: p.sharps } });
    apply(withPieceRaw(q));
  } else {
    // an overdub: the new notes join the piece as one history step, and `raw` grows
    // with them so Raw still means "everything, as played"
    const q = fromTake(take, opts);
    let next = q.notes.reduce((acc, n) => insert(acc, n), p);
    next = { ...next, grid: null, raw: { notes: [...(p.raw?.notes ?? p.notes), ...q.notes].map(n => ({ ...n })), bpm } };
    apply(next);
  }
  el.status.textContent = `take: ${take.length} notes over ${Math.round(end / bpb())} bars`;
}

/**
 * `fromTake` keeps the take in its own shape (`p` for pitch, no hand); `unquantise`
 * puts `raw.notes` straight back as the piece's notes. Storing the piece's own notes
 * -- which are the take, hand and all -- is what makes Raw come back playable.
 */
const withPieceRaw = q => ({ ...q, raw: { notes: q.notes.map(n => ({ ...n })), bpm: q.bpm } });

transport.on('tick', pos => {
  el.pos.textContent = !pos.running ? '–'
    : pos.countIn ? `count-in ${Math.floor(bpb() + pos.beat) + 1}`
      : `bar ${Math.floor(pos.at / bpb()) + 1} · beat ${Math.floor(pos.at % bpb()) + 1}`;
  if (pos.running && !raf) raf = requestAnimationFrame(frame);
  if (!pos.running) { roll.playhead(pos.at, false); staff.playhead(pos.at, false); }
});
transport.on('end', () => { recording = false; syncTransport(); });

function frame() {
  raf = 0;
  if (!transport.running) return;
  const p = transport.position();
  roll.playhead(p.at, p.countIn);
  staff.playhead(p.at, p.countIn);
  paintKeys(el.kb, { scale: null, root: 0, sounding: new Set(), held });
  raf = requestAnimationFrame(frame);
}

// ---------------------------------------------------------------- clicks
el.play.onclick = () => (transport.running && !recording ? halt() : play());
el.stop.onclick = halt;
el.rec.onclick = () => (recording ? endTake() : startTake());
el.metro.onclick = () => {
  const on = !el.metro.classList.contains('on');
  el.metro.classList.toggle('on', on);
  audio();
  transport.setClick(on);
};
el.undo.onclick = () => { history.undo(); draw(); };
el.redo.onclick = () => { history.redo(); draw(); };
el.raw.onclick = () => apply(unquantise(piece()));
el.gridChips.onclick = e => {
  const b = e.target.closest('[data-q]');
  if (b) apply(quantise(piece(), b.dataset.q));
};
el.handChips.onclick = e => {
  const b = e.target.closest('[data-v]');
  if (b) { hand = b.dataset.v; syncTools(piece()); }
};
el.selHands.onclick = e => {
  const b = e.target.closest('[data-h]');
  if (!b || !sel) return;
  const h = b.dataset.h;
  const hands = sel.hands.includes(h) ? sel.hands.filter(x => x !== h) : [...sel.hands, h];
  sel = { ...sel, hands: hands.length ? hands : sel.hands };
  draw();
};
el.xforms.onclick = e => {
  const b = e.target.closest('[data-x]');
  if (b && !b.disabled) transform(b.dataset.x);
};
el.strip.onclick = e => {
  const d = e.target.closest('.bar');
  if (!d) return;
  const i = +d.dataset.i, from = i * bpb(), to = from + bpb();
  sel = e.shiftKey && sel
    ? { ...sel, from: Math.min(sel.from, from), to: Math.max(sel.to, to) }
    : { from, to, hands: sel?.hands ?? ['lh', 'rh'] };
  picked = null;
  draw();
};

el.section.onclick = () => {
  if (!sel) return;
  const p = piece();
  const from = Math.floor(sel.from / bpb()) + 1, to = Math.ceil(sel.to / bpb());
  const name = prompt('Name these bars', `Section ${p.sections.length + 1}`);
  if (!name) return;
  const sections = [...p.sections, { name, from, to, hint: '', coach: '' }]
    .sort((a, b) => a.from - b.from);
  apply({ ...p, sections });
};

el.melody.onclick = async () => {
  const p = piece();
  try {
    const m = writeMelody(p, 'rh', barsOf(p));
    const ok = await copyMelody({ [`${slugOf(p.title)}-rh`]: m });
    el.status.textContent = ok ? 'melody copied to clipboard' : 'clipboard blocked — melody is on the console';
  } catch (err) { el.status.textContent = err.message; }
};

// ---------------------------------------------------------------- save as sheet
// the id follows the title until it is typed by hand: a retitled sheet otherwise
// kept the old slug and saved over the wrong file
let idTouched = false;
el.sheetId.oninput = () => { idTouched = true; };
el.sheetTitle.oninput = () => { if (!idTouched) el.sheetId.value = slugOf(el.sheetTitle.value); };
el.save.onclick = () => {
  const p = piece();
  const why = canWrite(p);
  const d = sheetDefaults(p);
  el.sheetbox.hidden = false;
  el.sheetTitle.value = d.title === 'Untitled' ? '' : d.title;
  el.sheetId.value = d.id;
  idTouched = false;
  el.sheetKey.innerHTML = KEYS.map(k => `<option${k === d.key ? ' selected' : ''}>${k}</option>`).join('');
  el.sheetBpm.value = d.practiceBpm;
  overwrite = false;
  el.post.textContent = 'Save into songs/';
  el.sheetStatus.textContent = why ? `Quantise first — ${why}` : '';
  el.dl.disabled = el.post.disabled = !!why;
};
el.sheetClose.onclick = () => { el.sheetbox.hidden = true; };

/** The piece as the sheet says it is: the form's fields are the header, nothing more. */
function sheetPiece() {
  const p = piece();
  const key = el.sheetKey.value;
  return {
    ...p,
    title: el.sheetTitle.value.trim() || p.title,
    id: slugOf(el.sheetId.value || el.sheetTitle.value),
    key, sharps: SHARP_KEYS.has(key),
    practiceBpm: +el.sheetBpm.value || Math.round(bpm * 0.6),
    bpm,
  };
}

el.dl.onclick = () => {
  if (!el.sheetTitle.value.trim()) { el.sheetStatus.textContent = 'a sheet needs a title'; return; }
  downloadSong(writeSong(sheetPiece()));
  el.sheetStatus.textContent = 'downloaded — drop it into songs/ and add it to songs/index.json';
};

el.post.onclick = async () => {
  if (!el.sheetTitle.value.trim()) { el.sheetStatus.textContent = 'a sheet needs a title'; return; }
  const doc = writeSong(sheetPiece());
  el.sheetStatus.textContent = 'saving…';
  const res = await postSong(doc, { overwrite });
  if (res.ok) {
    el.sheetStatus.textContent = `saved songs/${doc.id}.json — refresh Learn to see it`;
    apply(sheetPiece());
    overwrite = false;
    el.post.textContent = 'Save into songs/';
    return;
  }
  if (res.status === 409) {
    overwrite = true;
    el.post.textContent = 'Overwrite it';
    el.sheetStatus.textContent = `songs/${doc.id}.json is already there — press again to replace it`;
    return;
  }
  el.sheetStatus.textContent = `could not save (${res.status || 'no server'}): ${res.text}`;
};

// ---------------------------------------------------------------- keys
const EDITABLE = /^(INPUT|TEXTAREA|SELECT)$/;

addEventListener('keydown', e => {
  const t = e.target;
  if (t && (t.isContentEditable || EDITABLE.test(t.tagName))) return;
  if (e.metaKey || e.ctrlKey) {
    if (e.key.toLowerCase() === 'z') {
      e.preventDefault();
      e.shiftKey ? history.redo() : history.undo();
      draw();
    }
    return;
  }
  if (e.altKey) return;
  if (e.code === 'Space') { e.preventDefault(); transport.running && !recording ? halt() : play(); return; }
  if (e.key.toLowerCase() === 'r') { e.preventDefault(); recording ? endTake() : startTake(); return; }
  if (e.key === 'Escape') { e.preventDefault(); sel = null; picked = null; draw(); return; }
  if ((e.key === 'Delete' || e.key === 'Backspace') && target()) {
    e.preventDefault(); transform('del'); return;
  }
  if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && target()) {
    e.preventDefault();
    const d = (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 12 : 1);
    apply(setPitch(piece(), target(), d));
  }
});

// ---------------------------------------------------------------- tempo
const BPM_MIN = +el.tempo.min, BPM_MAX = +el.tempo.max;
/** The tempo is a setting, not an edit: it is stamped onto every snapshot `apply` makes. */
function setBpm(v) {
  bpm = v;
  el.bpmv.textContent = v;
  clock.setBpm(v);
}
el.tempo.oninput = e => setBpm(+e.target.value);
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

// ---------------------------------------------------------------- the sidebar
function syncNew() {
  el.meterChips.innerHTML = METERS.map(m =>
    chip(m, m, m === newMeter, `A new piece in ${m}`, 'data-m')).join('');
  el.swingChips.innerHTML = SWINGS.map(([label, v]) =>
    chip(label, label, String(v) === String(newSwing),
      label === 'swing' ? 'Offbeat eighths are played late, as in City of Stars. Positions stay straight; playback swings them.'
        : 'Eighths are even', 'data-s')).join('');
}
el.meterChips.onclick = e => {
  const b = e.target.closest('[data-m]');
  if (b) { newMeter = b.dataset.m; syncNew(); }
};
el.swingChips.onclick = e => {
  const b = e.target.closest('[data-s]');
  if (b) { newSwing = b.dataset.s === 'swing' ? '2/3' : 0.5; syncNew(); }
};
el.newBtn.onclick = () => {
  const t = +el.newBpm.value || 90;
  open(emptyPiece({ title: 'Untitled', bpm: t, meter: newMeter, swing: newSwing, grid: null }));
  el.status.textContent = 'empty piece — press Record and play';
};

async function loadSongs() {
  try {
    const res = await fetch('songs/index.json', { cache: 'no-cache' });
    const list = (await res.json()).songs ?? [];
    const docs = await Promise.all(list.map(f => fetch('songs/' + f).then(r => r.json())));
    el.songs.innerHTML = docs.map((d, i) =>
      `<div class="trk" data-i="${i}" data-tip="Open ${d.title} as a piece — its notes, its header, nothing lost">`
      + `<div>${d.title}</div><small>${d.credit ?? ''}</small></div>`).join('');
    el.songs.onclick = e => {
      const d = e.target.closest('.trk');
      if (d) open(fromSong(docs[+d.dataset.i]), +d.dataset.i);
    };
  } catch (err) {
    el.songs.innerHTML = `<div class="trk-err">No songs list<br><small>${err.message}</small></div>`;
  }
}

/**
 * The looper saves its lane set per track; the composer reads it back. `slotNotes`
 * expands the repeats, the follow-the-changes transpositions and the octave shifts,
 * so the lanes arrive as they sounded -- lane 1 the right hand, lane 2 the left.
 */
async function loadSets() {
  let tracks = [];
  try { tracks = await loadTracks(); } catch { el.sets.innerHTML = '<div class="none">no tracks.json</div>'; return; }
  const have = tracks.filter(t => localStorage.getItem('middleman.looper.' + t.id));
  if (!have.length) { el.sets.innerHTML = '<div class="none">Record a set in the looper and it shows up here.</div>'; return; }
  el.sets.innerHTML = have.map((t, i) =>
    `<div class="trk" data-i="${i}" data-tip="The lanes you last left in the looper on ${t.name}, expanded as they sounded">`
    + `<div>Open the last loop set</div><small>${t.name}</small></div>`).join('');
  el.sets.onclick = e => {
    const d = e.target.closest('.trk');
    if (d) openSet(have[+d.dataset.i]);
  };
}

function openSet(track) {
  let doc;
  try { doc = JSON.parse(localStorage.getItem('middleman.looper.' + track.id)); } catch { return; }
  const q = { div: GRIDS[doc.grid ?? 0].div, strength: doc.strength ?? 1 };
  const notes = [];
  (doc.slots ?? []).forEach((s, i) => {
    if (!s) return;
    const h = i === 1 ? 'lh' : 'rh';
    for (const n of slotNotes({ ...s, i, st: 'play', solo: false, mute: false }, track, q))
      notes.push({ b: n.b, len: n.len, n: n.p, hand: h, v: n.v });
  });
  if (!notes.length) { el.status.textContent = 'that set has no notes in it'; return; }
  const base = emptyPiece({
    title: `${track.name} — loop set`, id: slugOf(track.name), bpm: track.bpm,
    swing: track.swing, sharps: track.sharps, grid: null,
  });
  const p = { ...base, notes: sortNotes(notes) };
  open(withPieceRaw({ ...p, sections: [{ name: 'Whole song', from: 1, to: barsOf(p), hint: '', coach: '' }] }));
}

// ---------------------------------------------------------------- draft
function offerDraft(d) {
  if (!d?.notes?.length) { el.draftline.textContent = ''; return; }
  el.draftline.innerHTML = `<span>a draft is waiting: <b>${d.title}</b></span>`
    + '<button class="mini" data-draft="open" data-tip="Pick the draft up where you left it">Open it</button>'
    + '<button class="mini" data-draft="drop" data-tip="Throw the draft away">Drop it</button>';
  el.draftline.onclick = e => {
    const b = e.target.closest('[data-draft]');
    if (!b) return;
    if (b.dataset.draft === 'open') open(d);
    else clearDraft();
    el.draftline.innerHTML = '';
  };
}

// ---------------------------------------------------------------- boot
mountOutToggle(el.outsel, { tip: 'data-tip' });
renderKeys(el.kb);
initTips();
syncNew();
// read the draft before anything opens, or the empty piece would be the draft
const startDraft = loadDraft();
open(emptyPiece({ title: 'Untitled', grid: null }));
offerDraft(startDraft);
syncTransport();
transport.setClick(true);
loadSongs();
loadSets();
addEventListener('resize', () => draw());

initMidi({
  onStatus: s => { el.status.textContent = s; },
  onNote: () => {
    el.inled.classList.add('hit');
    clearTimeout(ledTimer);
    ledTimer = setTimeout(() => el.inled.classList.remove('hit'), 140);
  },
});
onMidi(ev => {
  buffer.feed(ev);                      // always rolling: a take is a slice of it
  el.played.textContent = [...held].sort((a, b) => a - b).map(noteName).join(' ') || '–';
  paintKeys(el.kb, { scale: null, root: 0, sounding: new Set(), held });
});

// exposed for debugging, and to drive the page without a piano attached
window.__cp = {
  clock, buffer, transport, roll, staff, el, receive,
  get piece() { return piece(); },
  get sel() { return sel; },
  set sel(v) { sel = v; draw(); },
  open, apply, draw,
  /** Feed a phrase in as if it had been played. [[beat, len, pitch, v], ...] */
  seed(notes, atBeat = 0) {
    for (const [b, len, p, v = 80] of notes) {
      buffer.feed({ on: 1, n: p, v, t: clock.time(atBeat + b) });
      buffer.feed({ on: 0, n: p, v: 0, t: clock.time(atBeat + b + len) });
    }
  },
};
