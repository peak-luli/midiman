// The loop model: what a lane holds, where its material lands inside the form, and
// how it is bent on the way out (quantised, transposed, moved an octave, softened).
//
// A loop is never rewritten. Everything here is applied at expansion time to the
// notes exactly as they were played, so any of it can be turned back off.

import { swung } from '../tracks.js';
import { mod } from '../clock.js';
import { noteName } from '../theory.js';

/** Four lanes, on a ramp between the app's own --you and --barhl. */
export const LANE_COLOURS = ['#ff2fd6', '#d250ec', '#a563ee', '#7c6fe0'];
export const LEVELS = [0.45, 0.65, 0.85, 1.0, 1.2];

export const SNAPS = [
  { name: 'bar', bars: 1 },
  { name: '2 bars', bars: 2 },
  { name: '4 bars', bars: 4 },
  { name: 'chorus', bars: 0 },      // 0 means "the whole form"
];

export const GRIDS = [
  { name: 'off', div: 0 },
  { name: '1/8', div: 8 },
  { name: '1/16', div: 16 },
  { name: '1/8T', div: 12 },
];

export function newSlot(i) {
  return {
    i,
    name: '',
    st: 'empty',            // empty | rec | dub | play
    pend: null,             // rec | dub | play, queued for pendAt
    pendAt: 0,
    recStart: 0,
    fromBar: 0,
    lenBars: 4,
    mode: 'fill',           // fill: tiles the form | phrase: plays once, in its own bars
    follow: false,
    mute: false,
    solo: false,
    level: 3,
    oct: 0,
    layers: [],             // each overdub pass is its own layer, so undo is exact
    undo: [],               // layers (and whole lanes) taken off, for U to put back
    sched: 0,
  };
}

/**
 * Where the grid actually falls in a bar. The backing tracks shuffle, so a straight
 * 1/8 grid would fight the feel -- the offbeat has to land where the bass line puts it.
 *
 * `gridOffsets(div, 0.5)` is therefore the same grid *written down*, which is what the
 * composer stores: it quantises to where a note was heard and keeps where it is written.
 */
export function gridOffsets(div, sw) {
  if (div === 8) return [0, sw];
  if (div === 16) return [0, sw / 2, sw, sw + (1 - sw) / 2];
  if (div === 12) return [0, 1 / 3, 2 / 3];
  return [0];
}

/** Pull `b` toward the nearest grid point, by `strength` (0 = as played, 1 = on it). */
export function quantize(b, div, sw, strength) {
  if (!div || !strength) return b;
  const offs = gridOffsets(div, sw);
  const base = Math.floor(b), f = b - base;
  let best = 0, bd = Infinity;
  for (const o of offs.concat([1])) {          // 1 catches notes that round up a beat
    const d = Math.abs(f - o);
    if (d < bd) { bd = d; best = o; }
  }
  return b + (base + best - b) * strength;
}

/** A loop can only tile the form if it divides it. */
export const canFill = (lenBars, nbars) => lenBars < nbars && nbars % lenBars === 0;

export function defaultMode(lenBars, nbars) {
  return canFill(lenBars, nbars) ? 'fill' : 'phrase';
}

/** Following only means anything where the harmony actually moves. */
export function defaultFollow(lenBars, form) {
  return canFill(lenBars, form.length) && new Set(form).size > 1;
}

/**
 * Every place a loop's material shows up in one chorus, and by how much each repeat
 * moves. A repeat lands on a different chord, so with `follow` on it is transposed by
 * the interval between the chord it was played over and the chord underneath it now.
 */
export function placements(slot, form) {
  const nb = form.length;
  const starts = [slot.fromBar];
  if (slot.mode === 'fill' && canFill(slot.lenBars, nb))
    for (let s = mod(slot.fromBar, slot.lenBars); s + slot.lenBars <= nb; s += slot.lenBars)
      if (s !== slot.fromBar) starts.push(s);
  return starts.map(start => ({
    start,
    ghost: start !== slot.fromBar,
    shift: bil => (start === slot.fromBar || !slot.follow) ? 0
      : form[mod(start + bil, nb)] - form[mod(slot.fromBar + bil, nb)],
  }));
}

/**
 * A loop expanded into one chorus: notes stamped with the beat they fall on inside
 * the form, ready to be scheduled or drawn.
 */
export function slotNotes(slot, track, q) {
  if (slot.st === 'empty' || !slot.layers.length) return [];
  const form = track.form, formBeats = form.length * 4;
  const gain = LEVELS[slot.level] ?? 1;
  const raw = slot.layers.flat();
  const out = [];
  for (const pl of placements(slot, form)) {
    for (const n of raw) {
      const qb = quantize(n.b, q.div, track.swing, q.strength);
      const b = pl.start * 4 + qb;
      if (b >= formBeats || b < 0) continue;
      const p = n.p + pl.shift(Math.floor(qb / 4)) + slot.oct * 12;
      if (p < 0 || p > 127) continue;
      out.push({
        b, p, ghost: pl.ghost,
        len: Math.max(0.03, Math.min(n.len, formBeats - b)),
        v: Math.max(1, Math.min(127, Math.round(n.v * gain))),
      });
    }
  }
  return out.sort((a, b) => a.b - b.b);
}

/**
 * An overdub pass folded onto the loop's own length. You might dub over three passes
 * of a two-bar loop; all three land on the same two bars.
 */
export function foldTake(take, slot, absStart, formBeats) {
  const span = slot.lenBars * 4;
  const out = [];
  for (const n of take) {
    const abs = absStart + n.b;
    let rel;
    if (slot.mode === 'fill') rel = mod(abs - mod(slot.fromBar, slot.lenBars) * 4, span);
    else {
      const r = mod(abs - slot.fromBar * 4, formBeats);
      if (r >= span) continue;                  // played outside the phrase's own bars
      rel = r;
    }
    out.push({ b: rel, len: Math.min(n.len, span - rel), p: n.p, v: n.v });
  }
  return out.sort((a, b) => a.b - b.b);
}

/**
 * A line as a `melodies` entry for tracks.json: eight cells to the bar,
 * `[name, eighths]`, held until the next onset, and where two notes land on the same
 * eighth the top one wins -- it is a melody. Notes are `{ b, p }` in beats from the
 * top of the form, and `swing` says where the eighths of a bar actually fall, so a
 * line played over a shuffle is written on the beats it was heard on.
 *
 * The looper hands it a lane and the composer hands it one hand of a piece: it is the
 * same list of notes and the same file at the other end, so it is one function.
 */
export function melodyOf(notes, { bars, swing = 0.5, name = 'captured line' }) {
  const per = 8;
  const cells = new Array(bars * per).fill(null);
  for (const n of notes) {
    const bar = Math.floor(n.b / 4);
    if (bar < 0 || bar >= bars) continue;
    const inBar = n.b - bar * 4;
    let best = 0, bd = Infinity;
    for (let k = 0; k < per; k++) {
      const d = Math.abs(inBar - swung(k, swing));
      if (d < bd) { bd = d; best = k; }
    }
    const idx = bar * per + best;
    if (!cells[idx] || n.p > cells[idx].p) cells[idx] = n;
  }

  const out = [];
  for (let bar = 0; bar < bars; bar++) {
    const row = [];
    let k = 0;
    while (k < per) {
      const here = cells[bar * per + k];
      let d = 1;
      while (k + d < per && !cells[bar * per + k + d]) d++;   // hold until the next onset
      row.push([here ? noteName(here.p) : null, d]);
      k += d;
    }
    out.push(row);
  }
  return { name, bars: out };
}

/**
 * The loop as a `melodies` entry, so a captured line comes back engraved on the staff
 * to practise against.
 *
 * It engraves a whole chorus rather than the bare loop: partly because the loader only
 * accepts a melody that is a multiple of the form, and partly because that is what the
 * loop actually sounds like -- repeats and all, transposed if it follows the changes.
 */
export function toMelody(slot, track, q, name) {
  return melodyOf(slotNotes(slot, track, q ?? { div: 0, strength: 0 }), {
    bars: track.form.length,
    swing: track.swing,
    name: name || slot.name || 'captured line',
  });
}
