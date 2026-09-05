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
// Every bar has to sum to exactly 8 eighths.

import { pitchOf } from './theory.js';

const BAR_EIGHTHS = 8;

function parseLen(s, where) {
  if (s === undefined) return 1;
  const m = /^(\d+(?:\.\d+)?)(?:\/(\d+))?$/.exec(s);
  if (!m) throw new Error(`${where}: bad length ":${s}"`);
  return m[2] ? +m[1] / +m[2] : +m[1];
}

/** One bar of one hand -> cells of { at (eighths into the bar), d, ns, tie, roll }. */
function parseBar(text, where) {
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
  if (Math.abs(at - BAR_EIGHTHS) > 1e-6)
    throw new Error(`${where}: bar sums to ${+at.toFixed(3)} eighths, want ${BAR_EIGHTHS}`);
  return cells;
}

/**
 * Parse a song document. Returns the document plus, per hand, a flat note list
 *   { b, len, n, bar, hand, roll }   -- b and len in beats (a quarter = 1 beat), so
 * b = bar * 4 + eighths / 2. Ties are resolved: a tied cell extends the open note.
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

  const hands = {}, cells = {};
  for (const hand of ['rh', 'lh']) {
    const notes = [];
    const open = new Map();                       // pitch -> note still sounding (for ties)
    cells[hand] = doc[hand].map((text, bi) => {
      const at = `${where}: ${hand} bar ${bi + 1}`;
      const bar = parseBar(text, at);
      for (const c of bar) {
        const b = bi * 4 + c.at / 2, len = c.d / 2;
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
