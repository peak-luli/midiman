// A song is a two-hand score: per hand, one string per bar in a compact notation
// (see songs/*.json). This file parses and validates it, and turns it into the flat
// note lists everything else works from.
//
// Notation, per token, separated by spaces:
//   G4 / Bb3 / C#5         a pitch (scientific), one eighth long
//   [G4 Bb4 D5]            a chord
//   r                      a rest
//   :n                     length suffix, in eighths; fractions allowed (:2/3, :1/2)
//   ~                      prefix: tied from the previous token of the same pitch,
//                          so no new attack -- the earlier note is just extended
//   /                      prefix: rolled chord (bottom to top, a little apart)
// Every bar has to sum to the meter: 8 eighths in 4/4 (the default), 6 in 6/8.

import { pitchOf } from './theory.js';

const DEFAULT_BAR_EIGHTHS = 8;

/**
 * Song meter. `4/4` (default) is four quarter-note beats, eight eighths.
 * Compound meters over 8 (6/8, 9/8, 12/8) use the dotted quarter as the beat,
 * so 6/8 is two beats and six eighths — the click and the staff stay in 2.
 */
export function parseMeter(raw = '4/4') {
  let beats, unit;
  if (Array.isArray(raw) && raw.length >= 2) { beats = +raw[0]; unit = +raw[1]; }
  else {
    const m = /^(\d+)\s*\/\s*(\d+)$/.exec(String(raw).trim());
    if (!m) throw new Error(`bad meter "${raw}"`);
    beats = +m[1]; unit = +m[2];
  }
  if (!(beats > 0 && unit > 0 && Number.isFinite(beats) && Number.isFinite(unit)))
    throw new Error(`bad meter "${raw}"`);
  const barEighths = beats * 8 / unit;
  if (Math.abs(barEighths - Math.round(barEighths * 1e6) / 1e6) > 1e-9)
    throw new Error(`meter ${beats}/${unit} is not a whole number of eighths`);
  const compound = unit === 8 && beats % 3 === 0 && beats > 3;
  const eighthsPerBeat = compound ? 3 : 8 / unit;
  const beatsPerBar = barEighths / eighthsPerBeat;
  return { beats, unit, barEighths, beatsPerBar, eighthsPerBeat, label: `${beats}/${unit}` };
}

export const beatsPerBarOf = song => song?.beatsPerBar ?? 4;
export const eighthsPerBeatOf = song => song?.eighthsPerBeat ?? 2;

function parseLen(s, where) {
  if (s === undefined) return 1;
  const m = /^(\d+(?:\.\d+)?)(?:\/(\d+))?$/.exec(s);
  if (!m) throw new Error(`${where}: bad length ":${s}"`);
  return m[2] ? +m[1] / +m[2] : +m[1];
}

/** One bar of one hand -> cells of { at (eighths into the bar), d, ns, tie, roll }. */
function parseBar(text, where, barEighths = DEFAULT_BAR_EIGHTHS) {
  const cells = [];
  let at = 0;
  // a chord holds spaces, so tokens are matched rather than split
  const toks = String(text ?? '').match(/[~\/]*(?:\[[^\]]*\]|[^\s\[\]]+)(?::[\d.\/]+)?/g) ?? [];
  for (let tok of toks) {
    let tie = false, roll = false;
    while (tok[0] === '~' || tok[0] === '/') {
      if (tok[0] === '~') tie = true; else roll = true;
      tok = tok.slice(1);
    }
    let body = tok, len;
    // a chord's ":n" sits after the closing bracket
    const m = /^(\[[^\]]*\]|[^:]+)(?::(.+))?$/.exec(tok);
    if (!m) throw new Error(`${where}: bad token "${tok}"`);
    body = m[1]; len = parseLen(m[2], where);
    let ns;
    if (body === 'r') ns = [];
    else if (body[0] === '[') {
      ns = body.slice(1, -1).trim().split(/\s+/).map(p => pitchOf(p, where));
    } else ns = [pitchOf(body, where)];
    ns.sort((a, b) => a - b);
    cells.push({ at, d: len, ns, tie, roll });
    at += len;
  }
  if (Math.abs(at - barEighths) > 1e-6)
    throw new Error(`${where}: bar sums to ${+at.toFixed(3)} eighths, want ${barEighths}`);
  return cells;
}

/**
 * Parse a song document. Returns the document plus, per hand, a flat note list
 *   { b, len, n, bar, hand, roll }   -- b and len in beats (a quarter = 1 beat), so
 * b = bar * beatsPerBar + eighths / eighthsPerBeat. Ties are resolved: a tied
 * cell extends the open note.
 * `cells[hand][bar]` keeps the bars as written (rests, ties, tuplets), each cell
 * carrying `refs`, the notes its pitches belong to.
 */
export function parseSong(doc) {
  const where = `song "${doc.id ?? doc.title ?? '?'}"`;
  for (const key of ['id', 'title', 'bpm', 'rh', 'lh'])
    if (doc[key] === undefined) throw new Error(`${where}: missing "${key}"`);
  if (!Array.isArray(doc.rh) || !Array.isArray(doc.lh) || doc.rh.length !== doc.lh.length)
    throw new Error(`${where}: rh has ${doc.rh?.length} bars, lh has ${doc.lh?.length}`);
  const nbars = doc.rh.length;
  let meter;
  try { meter = parseMeter(doc.meter ?? '4/4'); }
  catch (e) { throw new Error(`${where}: ${e.message}`); }
  const { barEighths, beatsPerBar, eighthsPerBeat } = meter;

  const hands = {}, cells = {};
  for (const hand of ['rh', 'lh']) {
    const notes = [];
    const open = new Map();                       // pitch -> note still sounding (for ties)
    cells[hand] = doc[hand].map((text, bi) => {
      const at = `${where}: ${hand} bar ${bi + 1}`;
      const bar = parseBar(text, at, barEighths);
      for (const c of bar) {
        const b = bi * beatsPerBar + c.at / eighthsPerBeat, len = c.d / eighthsPerBeat;
        // `refs` pairs each pitch of the cell with the song note it belongs to --
        // for a tied cell that is the note it extends -- so an engraving of the
        // cells can be coloured by note
        c.refs = [];
        if (!c.ns.length) continue;
        if (c.tie) {
          let extended = 0;
          for (const n of c.ns) {
            const o = open.get(n);
            if (o && Math.abs(o.b + o.len - b) < 1e-6) { o.len += len; extended++; c.refs.push(o); }
            else { const nn = { b, len, n, bar: bi, hand, roll: -1 }; notes.push(nn); open.set(n, nn); c.refs.push(nn); }
          }
          if (!extended) console.warn(`${at}: tie with nothing to tie to`);
          continue;
        }
        c.ns.forEach((n, i) => {
          const nn = { b, len, n, bar: bi, hand, roll: c.roll ? i : -1 };
          notes.push(nn);
          open.set(n, nn);
          c.refs.push(nn);
        });
      }
      return bar;
    });
    notes.sort((a, b) => a.b - b.b || a.n - b.n);
    hands[hand] = notes;
  }

  const sections = (doc.sections ?? [{ name: 'Whole song', from: 1, to: nbars }]).map(s => {
    if (!(s.from >= 1 && s.to <= nbars && s.from <= s.to))
      throw new Error(`${where}: section "${s.name}" spans bars ${s.from}-${s.to} of ${nbars}`);
    // `hint` explains the section in the panel; `coach` is the one line said over the
    // music at the section's first step, and is optional -- see plan.js
    return { name: s.name, from: s.from - 1, to: s.to - 1, hint: s.hint ?? '', coach: s.coach ?? '' };
  });

  const swing = typeof doc.swing === 'number' ? doc.swing
    : doc.swing ? (([a, b]) => +a / +b)(String(doc.swing).split('/')) : 0.5;

  return {
    id: doc.id, title: doc.title, sub: doc.sub ?? '', credit: doc.credit ?? '',
    bpm: doc.bpm, practiceBpm: doc.practiceBpm ?? Math.round(doc.bpm * 0.6),
    swing, sharps: !!doc.sharps, key: doc.key ?? 'C',
    meter: meter.label, meterBeats: meter.beats, meterUnit: meter.unit,
    barEighths, beatsPerBar, eighthsPerBeat,
    nbars, sections, rh: hands.rh, lh: hands.lh,
    // the bars as written -- rests, ties and tuplets included -- for engraving
    cells,
    notes: [...hands.rh, ...hands.lh].sort((a, b) => a.b - b.b || a.n - b.n),
  };
}

export async function loadSong(url) {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return parseSong(await res.json());
}

/**
 * Where a beat position actually lands once the eighths are swung: the offbeat
 * eighth of every beat is pushed to `sw` of the way through it. Positions that
 * aren't on the eighth grid (triplets, sixteenths) are left straight.
 */
export function swungBeat(b, sw) {
  const frac = b - Math.floor(b);
  if (Math.abs(frac - 0.5) < 1e-6) return Math.floor(b) + sw;
  return b;
}

/** The notes of `hand` (or both) inside [fromBar, toBar], in time order. */
export function notesIn(song, fromBar, toBar, hand) {
  const src = hand === 'rh' ? song.rh : hand === 'lh' ? song.lh : song.notes;
  return src.filter(n => n.bar >= fromBar && n.bar <= toBar);
}

/**
 * Which catalog entry a song id names.
 *
 * `list` is either parsed songs or the `{ song }` wrappers both Learn pages keep.
 * A missing or unknown id is `-1`: the caller leaves the loaded piece alone.
 */
export function songIndexById(list, id) {
  if (!id) return -1;
  return list.findIndex(x => (x.song ?? x).id === id);
}

/**
 * Which catalog entry a song command should load.
 *
 * Same id as the piece already loaded, or an id the catalog has never heard of,
 * is a no-op: a retried command must not restart the piece.
 */
export function songPickIndex(list, currentId, id) {
  const i = songIndexById(list, id);
  if (i < 0) return -1;
  return (list[i].song ?? list[i]).id === currentId ? -1 : i;
}
