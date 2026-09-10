// All the DOM the looper owns. Static structure is rebuilt only when the engine's
// revision changes; the playhead, the key strip and the buffer redraw every frame.

import { LANE_COLOURS, canFill } from './loops.js';
import { LO, SPAN } from './edit.js';   // the pitch window a roll shows
import { mod } from '../clock.js';
import { paintKeys } from '../keyboard.js';

const REC = '#e63d40', DUB = '#e8b44a', OK = '#5fbf7a', OFF = '#6c7382';

const KEYS = [
  ['1–4', 'lane'], ['R', 'rec / end / overdub'], ['C', 'capture'], ['U', 'undo'],
  ['M', 'mute'], ['S', 'solo'], ['X', 'clear'], ['F', 'follow'], ['[ ]', 'length'],
  ['↑↓', 'octave'], ['Q', 'quantize'], ['Esc', 'all back to play'],
  ['click', 'pick a note'], ['←→', 'move it in time'], ['↑↓', 'move it in pitch'],
  ['[ ]', 'its length'], ['Del', 'remove it'],
];

function stateOf(s) {
  if (s.pend) return {
    label: s.pend === 'rec' ? 'REC NEXT' : s.pend === 'dub' ? 'DUB NEXT' : 'END NEXT',
    col: s.pend === 'dub' ? DUB : s.pend === 'play' ? OFF : REC, pending: true,
  };
  if (s.st === 'rec') return { label: 'REC', col: REC };
  if (s.st === 'dub') return { label: 'DUB', col: DUB };
  if (s.st === 'play') return { label: s.mute ? 'MUTE' : 'PLAY', col: s.mute ? OFF : OK };
  return { label: '', col: '#3a3f4a' };
}

/** `pick` is the lane's own note being fixed: every place it shows up is marked. */
function rollHtml(notes, formBeats, colour, pick = null) {
  let h = '';
  for (const n of notes) {
    const t = Math.max(0, Math.min(1, (n.p - LO) / SPAN));
    const w = Math.max(0.35, n.len / formBeats * 100);
    h += (n.src === pick ? '<i class="pick" ' : '<i ')
      + `style="left:${(n.b / formBeats * 100).toFixed(3)}%;width:${w.toFixed(3)}%;`
      + `top:${((1 - t) * 100).toFixed(2)}%;`
      + (n.ghost ? `background:transparent;border:1px solid ${colour};opacity:.42`
                 : `background:${colour}`) + '"></i>';
  }
  return h;
}

export function makeUi(engine, clock, el, opts) {
  const lanes = [];
  let lastRev = -1, lastSel = -1, lastTrack = null, lastBar = -1, lastPlayed = '';
  let lastPick = null;

  el.lanes.innerHTML = engine.slots.map((s, i) => `
    <div class="lane empty" data-i="${i}">
      <div class="lhead">
        <div class="lrow">
          <span class="ldot"></span>
          <span class="lnum" style="background:${LANE_COLOURS[i]}"
                data-tip="Lane ${i + 1}" data-key="${i + 1}">${i + 1}</span>
          <span class="lname" data-tip="Double-click to rename">–</span>
          <span class="lst"></span>
        </div>
        <div class="lrow"><span class="lspan">no material</span>
          <button class="chip follow" data-key="F"
            data-tip="Follow the changes: each repeat moves by the interval between the chord this was played over and the one underneath it now">follow</button></div>
        <div class="lrow lmix">
          <button class="chip mute" data-key="M"
            data-tip="Mute — the lane keeps its place in the form, silently">M</button>
          <button class="chip solo" data-key="S"
            data-tip="Solo — hear this lane against the backing track, with the other lanes silent">S</button>
          <span class="lev" data-tip="Level. Click along it to set.">${'<i></i>'.repeat(5)}</span>
          <span class="loct" data-key="↑ ↓"
                data-tip="Move the lane an octave, to keep it clear of the bass">8ve 0</span>
        </div>
      </div>
      <div class="lroll" data-tip="Click a note to pick it; drag it, or its right end for length. Arrows nudge it, Del removes it, U puts the take back.">
        <div class="lnotes"></div>
        <div class="lspanbox"></div>
        <div class="lempty">empty — <span class="kbd">${i + 1}</span> then
          <span class="kbd">R</span> to record here</div>
        <div class="lphead2"></div>
      </div>
    </div>`).join('');

  el.lanes.querySelectorAll('.lane').forEach((n, i) => lanes.push({
    root: n, head: n.querySelector('.lhead'), dot: n.querySelector('.ldot'),
    name: n.querySelector('.lname'), st: n.querySelector('.lst'),
    span: n.querySelector('.lspan'), follow: n.querySelector('.follow'),
    mute: n.querySelector('.mute'), solo: n.querySelector('.solo'),
    lev: [...n.querySelectorAll('.lev i')], oct: n.querySelector('.loct'),
    roll: n.querySelector('.lroll'), notes: n.querySelector('.lnotes'),
    spanbox: n.querySelector('.lspanbox'), head2: n.querySelector('.lphead2'),
    empty: n.querySelector('.lempty'), html: null,
  }));

  el.legend.innerHTML = KEYS
    .map(k => `<span class="k"><span class="kbd">${k[0]}</span>${k[1]}</span>`).join('');

  /** Chord chips and the roll grid have to be rebuilt when the form changes. */
  function syncTrack() {
    const t = engine.track;
    if (!t || t === lastTrack) return;
    lastTrack = t;
    const n = engine.nbars;
    el.strip.style.gridTemplateColumns = `repeat(${n},1fr)`;
    el.strip.innerHTML = engine.bars.map(b => `<div class="bar">${b.chord}</div>`).join('');
    document.documentElement.style.setProperty('--nbars', n);
    document.documentElement.style.setProperty('--nbeats', n * 4);
    lanes.forEach(l => { l.html = null; });
    lastBar = -1;
  }

  function syncSlots(sel, pick) {
    const t = engine.track, fb = engine.formBeats;
    engine.slots.forEach((s, i) => {
      const l = lanes[i], st = stateOf(s), col = LANE_COLOURS[i];
      l.root.classList.toggle('sel', i === sel);
      l.root.classList.toggle('empty', s.st === 'empty');
      l.root.classList.toggle('rec', s.st === 'rec' || s.st === 'dub');
      l.root.classList.toggle('pending', !!st.pending);
      l.head.style.borderColor = i === sel ? col : '';
      l.head.style.boxShadow = i === sel ? `inset 2px 0 0 ${col}` : '';
      l.dot.style.background = st.col;
      l.dot.style.boxShadow = (s.st === 'rec' || s.st === 'dub') ? `0 0 8px ${st.col}` : '';
      if (l.name !== document.activeElement) l.name.textContent = s.name || '–';
      l.name.dataset.tip = s.st === 'empty' ? '' : 'Double-click to rename';
      l.st.textContent = st.label;
      l.st.style.color = st.col;
      const taking = s.st === 'rec' || s.st === 'dub';
      l.span.textContent = s.st === 'empty' ? 'no material'
        : taking ? `from bar ${mod(Math.floor(s.recStart / 4), engine.nbars) + 1} · …`
        : `${s.lenBars} bar · from bar ${s.fromBar + 1}`
          + (s.layers.length > 1 ? ` · ${s.layers.length} layers` : '')
          + (s.mode === 'phrase' && s.lenBars < engine.nbars ? ' · once' : '');
      l.follow.hidden = s.st === 'empty' || taking || !canFill(s.lenBars, engine.nbars);
      l.follow.classList.toggle('on', s.follow);
      l.mute.classList.toggle('on', s.mute);
      l.solo.classList.toggle('on', s.solo);
      l.lev.forEach((b, k) => {
        b.style.height = (4 + k * 2) + 'px';
        b.style.background = (k <= s.level && s.st !== 'empty' && !s.mute) ? col : '#3a3f4a';
      });
      l.oct.textContent = s.oct === 0 ? '8ve 0' : (s.oct > 0 ? `8ve +${s.oct}` : `8ve ${s.oct}`);
      l.empty.hidden = s.st !== 'empty';

      if (s.st !== 'rec' && s.st !== 'dub') {
        const html = rollHtml(engine.notesOf(i), fb, col, pick?.i === i ? pick.src : null);
        if (html !== l.html) { l.notes.innerHTML = html; l.html = html; }
      }

      if (s.st === 'empty') { l.spanbox.style.display = 'none'; }
      else {
        l.spanbox.style.display = '';
        const rec = s.st === 'rec' || s.st === 'dub';
        const from = rec ? mod(s.recStart, fb) : s.fromBar * 4;
        l.spanbox.style.left = (from / fb * 100).toFixed(3) + '%';
        l.spanbox.style.background = rec ? 'rgba(230,61,64,.10)' : 'rgba(255,255,255,.028)';
        l.spanbox.style.borderLeft = `1px solid ${rec ? REC : col}`;
        l.spanbox.style.borderRight = rec ? 'none' : `1px solid ${col}`;
        if (!rec) l.spanbox.style.width = (s.lenBars * 4 / fb * 100).toFixed(3) + '%';
      }
    });
  }

  /** The per-frame work: playhead, live take, chord box, keys, buffer. */
  function frame(sel) {
    const t = engine.track;
    if (!t) return;
    const fb = engine.formBeats;
    const abs = clock.beat();
    const inCycle = mod(abs, fb);
    const pct = inCycle / fb * 100;
    const bar = Math.floor(inCycle / 4);
    const counting = abs < 0;

    el.rhead.style.left = pct + '%';
    lanes.forEach((l, i) => {
      const s = engine.slots[i];
      l.head2.style.left = pct + '%';
      if (s.st === 'rec' || s.st === 'dub') {
        l.notes.innerHTML = rollHtml(engine.liveNotes(i), fb, s.st === 'dub' ? DUB : REC);
        l.html = null;
        const beats = Math.max(0, abs - s.recStart);
        l.spanbox.style.width = Math.min(100, beats / fb * 100).toFixed(3) + '%';
        const bars = Math.max(1, Math.ceil(beats / 4));
        l.span.textContent = `taking ${bars} bar${bars === 1 ? '' : 's'}`
          + ` · from bar ${mod(Math.floor(s.recStart / 4), engine.nbars) + 1}`;
      }
    });

    if (bar !== lastBar) {
      lastBar = bar;
      el.strip.querySelectorAll('.bar').forEach((n, i) => n.classList.toggle('cur', i === bar));
    }
    el.pos.textContent = counting
      ? `count in ${Math.max(1, Math.ceil(-abs))}`
      : `bar ${bar + 1}/${engine.nbars} · ${engine.bars[bar]?.chord ?? ''}`;

    // the key strip: backing in blue, each lane in its own colour, your hands on top
    const loopNotes = engine.sounding(abs);
    const colours = new Map();
    for (const [p, i] of loopNotes) colours.set(p, LANE_COLOURS[i]);
    paintKeys(el.kb, {
      scale: t.scale, root: mod(t.root, 12),
      sounding: clock.running ? engine.backingSounding(abs) : new Set(),
      held: opts.held, colours,
    });

    drawBuffer();
  }

  function drawBuffer() {
    const fb = engine.formBeats;
    if (!fb) return;
    const now = clock.beat();
    const span = engine.nbars * 4;
    const from = Math.round(now / 4) * 4 - span;
    let h = '';
    for (const n of opts.buffer.notes) {
      const b = n.b - from;
      if (b < 0 || b >= span) continue;
      const t = Math.max(0, Math.min(1, (n.p - LO) / SPAN));
      const len = n.len ?? Math.max(0.05, now - n.b);
      h += `<i style="left:${(b / span * 100).toFixed(3)}%;`
        + `width:${Math.max(.5, len / span * 100).toFixed(3)}%;`
        + `top:${(4 + (1 - t) * 25).toFixed(1)}px"></i>`;
    }
    el.bufnotes.innerHTML = h;
    const cap = opts.capBars(), off = opts.capOff();
    el.bufwin.style.right = (off * 4 / span * 100).toFixed(2) + '%';
    el.bufwin.style.width = (cap * 4 / span * 100).toFixed(2) + '%';
  }

  return {
    lanes,
    /** Cheap to call every frame: the static pass only runs when something changed. */
    sync(sel, force, pick = null) {
      syncTrack();
      const held = pick === lastPick
        || (!!pick && !!lastPick && pick.i === lastPick.i && pick.src === lastPick.src);
      if (engine.rev === lastRev && sel === lastSel && held && !force) return;
      lastRev = engine.rev; lastSel = sel; lastPick = pick;
      syncSlots(sel, pick);
    },
    frame,
    stateOf,
    setPlayed(text) {
      if (text === lastPlayed) return;
      lastPlayed = text;
      el.played.textContent = text;
    },
  };
}
