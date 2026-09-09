// Beaming: which notes are joined under a beam, and with how many beams.
//
// Pure notation logic -- no DOM, no abcjs, no song loading. In: one bar as
// `song.js` parses it (cells of { at, d, ns, ... }), a meter, and a rules object.
// Out: beam groups. Everything downstream reads those groups -- the ABC that
// abcjs engraves, and the beams the staff view redraws after it has moved the
// notes onto its proportional time grid -- so there is one place that decides
// where a beam goes, and it can be tested without a browser.
//
// ---------------------------------------------------------------- the idea
// A beam shows the beat. That single purpose generates every rule below, which
// is why the engine is "cut the bar into beat groups, then beam the runs inside
// a group" and not a list of special cases:
//
//   1. Only values shorter than a quarter beam -- a beam is flags, joined up, and
//      a quarter has none. A dotted eighth beams; a quarter never does. A lone
//      beamable note is flagged, not beamed.
//   2. A beam never crosses a beat group, and never a bar line. The beat group
//      comes from the meter: the quarter in 4/4 and 3/4, the dotted quarter in
//      6/8 and 12/8 (3+3, never 2+2+2).
//   3. Merge, by meter, and only when nothing in the span is shorter than an
//      eighth: in 4/4 the two *halves* of the bar (beats 1-2 and 3-4) are single
//      spans, so four plain eighths beam as one -- `mergeHalfBar`, on by default.
//      Because the spans are the halves, nothing can beam across the middle of
//      the bar. In 3/4 the span is the whole bar -- `mergeWholeBar`, off by
//      default. Merging widens the *segment*; it does not force a group, so a
//      quarter inside the span still breaks the run and 3/4 can never come out
//      3+3 (which would read as 6/8).
//   4. Rests break beams (`beamOverRests: false`). With it on, a rest may sit
//      inside a group but never open or close one.
//   5. A tuplet is beamed as its own group and never joins the notes beside it;
//      a tuplet segment overrides the beat groups, so a triplet that straddles a
//      beat still beams as one. A tuplet written in quarters gets a bracket and
//      no beam.
//   6. Secondary beams follow the values: inside a group, level L is drawn over
//      each maximal run of notes needing L beams. A run of one is a *beamlet*,
//      pointing inward at the note it shares the beat with -- which is exactly
//      how a dotted eighth + sixteenth comes out (MusicXML calls the two
//      directions "forward hook" and "backward hook").
//   7. Ties are invisible here: a tied-into note is a note, and beams by its
//      written value.
//   8. Chords are notes. Only `d` and "is it a rest" matter, never `ns.length`.
//
// Syncopation (eighth - quarter - eighth) needs no rule: the quarter is not
// beamable, so it breaks the run and each outer eighth is left alone with a flag.
// That falls out of rules 1 and 2, which is the point of stating them that way.
//
// ---------------------------------------------------------------- where sources differ
// Two real disagreements, both settled here as rule parameters.
//
// 4/4, eighths: beam per beat, or per half bar? Per half bar, and it is what
// every engine does. LilyPond's `time-signature-settings.scm` carries the comment
// "in 4 4 (common) time: use defaults, but combine beats 1,2 and 3,4 if only 8th
// notes" and the exception `(1/8 . (4 4))`; MuseScore's `noteGroups` table for
// 4/4 lets eighths run through beats 2 and 4 and breaks everything at beat 3;
// Sibelius ships `4,4`; Gould and Dolmetsch both say to separate beat 2 from
// beat 3 and beam the halves. Crucially all of them key the exception on nothing
// shorter than an eighth being present -- sixteenths go back to one group per
// beat -- which is the `nothing shorter than an eighth` test in `mergeSpans`.
// An edition that ties across the beat wants the beat drawn instead, so a song can
// ask for per-beat beaming by name: `BEAM_STYLES.beat`.
//
// 3/4: LilyPond and Dolmetsch beam all six eighths as one; MuseScore and Sibelius
// beam 2+2+2. The default here is 2+2+2 because it is never ambiguous, with
// `mergeWholeBar` for the other reading. 3+3 is never emitted by either: Gould
// (p. 153) warns it gives the false impression of 6/8.
//
// Rests: traditionally a rest ends the beam, and that is the default. Gould
// allows the beam to run over an interior rest "only when it is essential to help
// the reader to identify the beats", so it is the `beamOverRests` switch.
//
// Sources consulted:
//   Elaine Gould, Behind Bars: The Definitive Guide to Music Notation, Faber 2011
//   Gardner Read, Music Notation: A Manual of Modern Practice, 2nd ed., ch. 6
//   Wikipedia, "Beam (music)"      https://en.wikipedia.org/wiki/Beam_(music)
//   Dolmetsch Online, "Note groupings"  https://www.dolmetsch.com/musictheory15.htm
//   LilyPond 2.24 Notation Reference, "Beams" (baseMoment, beatStructure,
//     beamExceptions, beamHalfMeasure, subdivideBeams)
//                                  https://lilypond.org/doc/v2.24/Documentation/notation/beams
//   LilyPond source, scm/time-signature-settings.scm (the per-meter exceptions)
//   MuseScore source, src/engraving/dom/groups.cpp (the `noteGroups` default table)
//   MusicXML 4.0, the <beam> element: begin/continue/end/forward hook/backward hook
//                                  https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/beam/
//   SMuFL 1.4 engraving defaults, and Bravura's metadata: beamThickness 0.5 staff
//     spaces, beamSpacing 0.25, so beams sit 0.75 spaces apart
//                                  https://w3c.github.io/smufl/latest/specification/engravingdefaults.html

// ---------------------------------------------------------------- data model
/**
 * @typedef {Object} Cell  one written token, as `song.js` parses it
 * @property {number} at   eighths into the bar
 * @property {number} d    sounding length in eighths (2/3 for a triplet eighth)
 * @property {number[]} ns MIDI pitches; `[]` is a rest
 */

/**
 * @typedef {Object} MergeSpan  a stretch the meter allows to beam as one
 * @property {number} from   eighths into the bar
 * @property {number} to     eighths into the bar
 * @property {string} rule   the flag in the rules object that turns it on
 */

/**
 * @typedef {Object} Meter
 * @property {number} beats     the numerator (4 in 4/4)
 * @property {number} unit      the denominator (4 in 4/4)
 * @property {number} bar       the bar's length in eighths
 * @property {number[]} groups  beat-group lengths in eighths, summing to `bar`
 * @property {number[]} edges   the group boundaries, 0 .. bar
 * @property {MergeSpan[]} merges
 */

/**
 * @typedef {Object} Tuplet
 * @property {number} from  first cell index of the run
 * @property {number} to    last cell index, inclusive
 * @property {number} p     notes in the run
 * @property {number} q     in the time of q notes of the written value
 * @property {number} v     the written value, in eighths
 */

/**
 * @typedef {Object} Beam  one beam line inside a group
 * @property {number} level  1 = the eighth beam, 2 = the sixteenth beam, ...
 * @property {number} from   first cell index it spans
 * @property {number} to     last cell index, inclusive
 * @property {?('left'|'right')} partial  a beamlet (`from === to`), pointing this way
 */

/**
 * @typedef {Object} Group  the notes under one beam
 * @property {number} from   first cell index
 * @property {number} to     last cell index, inclusive
 * @property {number} level  the most beams any of its notes needs
 * @property {Beam[]} beams  every line to draw, level 1 first
 * @property {?Tuplet} tuplet  the tuplet this group is, or null
 */

/**
 * @typedef {Object} Plan
 * @property {Group[]} groups
 * @property {Tuplet[]} tuplets  every tuplet run in the bar, beamed or not
 * @property {number[]} flags    per cell: how many beams (or flags) its value needs
 * @property {Array<?{group:number, role:'start'|'inner'|'end'}>} of  per cell
 * @property {boolean[]} joined  per cell: is it beamed to the cell before it?
 */

const EPS = 1e-6;

// ---------------------------------------------------------------- meters
/**
 * A meter's beat groups, in eighths. Compound meters (numerator > 3 and divisible
 * by 3, over an 8) group in threes; everything else groups by the denominator.
 */
export function meter(beats = 4, unit = 4) {
  const bar = beats * 8 / unit;
  const compound = unit === 8 && beats % 3 === 0 && beats > 3;
  const per = compound ? 3 : 8 / unit;                  // one beat group, in eighths
  const groups = Array.from({ length: Math.round(bar / per) }, () => per);
  const edges = [0];
  for (const g of groups) edges.push(edges[edges.length - 1] + g);
  const merges = [];
  if (!compound && per === 2 && groups.length === 4)     // 4/4, 4/8-shaped: the two halves
    merges.push({ from: 0, to: bar / 2, rule: 'mergeHalfBar' }, { from: bar / 2, to: bar, rule: 'mergeHalfBar' });
  if (!compound && per === 2 && groups.length === 3)     // 3/4: the whole bar, or nothing
    merges.push({ from: 0, to: bar, rule: 'mergeWholeBar' });
  return { beats, unit, bar, groups, edges, merges };
}

export const FOUR_FOUR = meter(4, 4);

export const DEFAULT_RULES = {
  /** 4/4: a half bar with nothing shorter than an eighth in it beams as one. */
  mergeHalfBar: true,
  /** 3/4: the whole bar beams as one, on the same condition. Off: 2+2+2. */
  mergeWholeBar: false,
  /** false = a rest ends the beam; true = an interior rest stays under it. */
  beamOverRests: false,
};

/**
 * The named readings a score may ask for, since the disagreement above comes down
 * to one question: how far past the beat a beam may run.
 *
 *   half  the default -- 4/4 beams by the half bar, 3/4 by the beat (2+2+2)
 *   beat  every beam stops at the beat, in every meter
 *
 * `beat` is not a worse engraving, it is a different edition: an arrangement that
 * ties across the beat wants the beat drawn, because a half-bar beam over three
 * eighths and a quarter reads as a triplet to whoever is sight-reading it. Songs
 * name a style rather than the flags (`"beams": "beat"` -- see `song.js`), so the
 * two readings stay here with the sources that justify them.
 */
export const BEAM_STYLES = {
  half: {},
  beat: { mergeHalfBar: false, mergeWholeBar: false },
};

/** A style name -> a full rules object, or null if nobody has heard of the name. */
export function beamRulesOf(style = 'half') {
  const s = BEAM_STYLES[style];
  return s ? { ...DEFAULT_RULES, ...s } : null;
}

// ---------------------------------------------------------------- values
const isPow2 = x => x > 0 && Math.abs(Math.log2(x) - Math.round(Math.log2(x))) < 1e-9;

/**
 * How many beams (or flags) a written value of `w` eighths needs: an eighth 1, a
 * sixteenth 2, a 32nd 3; a quarter and anything longer 0. Dots do not change the
 * count, so the dot is divided back out first (1.5x for one, 1.75x for two).
 */
export function flagsOf(w) {
  let base = 0;
  for (const f of [1, 2 / 3, 4 / 7]) if (isPow2(w * f)) { base = w * f; break; }
  if (!base) return 0;                                  // not a value anyone writes
  return Math.max(0, Math.round(-Math.log2(base)) + 1);
}

/**
 * Is `d` eighths a tuplet member? `{ p, q, v }`: p notes in the time of q, each
 * written as a `v`-eighths note. A plain binary length is not a tuplet.
 */
export function tupletOf(d) {
  if (Math.abs(d * 4 - Math.round(d * 4)) < 1e-9) return null;
  for (const p of [3, 5, 6, 7, 9]) {
    const q = p === 3 ? 2 : p <= 7 ? 4 : 8;
    const v = d * p / q;
    if (Math.abs(v * 4 - Math.round(v * 4)) < 1e-9 && v > 0) return { p, q, v };
  }
  return null;
}

/** The tuplet runs of a bar: consecutive same-p members, cut into groups of p. */
export function tupletsIn(cells) {
  const runs = [];
  for (let i = 0; i < cells.length;) {
    const t = tupletOf(cells[i].d);
    if (!t) { i++; continue; }
    let j = i;
    while (j < cells.length && tupletOf(cells[j].d)?.p === t.p && j - i < t.p) j++;
    runs.push({ from: i, to: j - 1, p: t.p, q: t.q, v: t.v });
    i = j;
  }
  return runs;
}

// ---------------------------------------------------------------- the engine
/**
 * Beam one bar. `cells` is `song.cells[hand][bar]`. Returns a Plan; the cells are
 * never touched.
 */
export function beamBar(cells, m = FOUR_FOUR, rules = DEFAULT_RULES) {
  const r = { ...DEFAULT_RULES, ...rules };
  const tuplets = tupletsIn(cells);
  const tupOf = cells.map(() => -1);
  tuplets.forEach((t, k) => { for (let i = t.from; i <= t.to; i++) tupOf[i] = k; });

  const written = cells.map((c, i) => (tupOf[i] >= 0 ? tuplets[tupOf[i]].v : c.d));
  const flags = written.map(flagsOf);
  const rest = cells.map(c => !c.ns.length);

  // 1. cut the bar into segments no beam may cross. Normally the meter's beat
  //    groups; a merge span that qualifies counts as one; and every tuplet run is
  //    a segment of its own, which wins over both.
  const spans = m.edges.slice(0, -1).map((from, k) => ({ from, to: m.edges[k + 1] }));
  for (const s of m.merges) {
    if (!r[s.rule]) continue;
    const inside = cells.map((_, i) => i).filter(i => cells[i].at >= s.from - EPS && cells[i].at < s.to - EPS);
    // the exception only holds while nothing in the span is shorter than an eighth
    if (!inside.length || inside.some(i => tupOf[i] >= 0 || written[i] < 1 - EPS)) continue;
    spans.push(s);
  }
  const spanOf = at => spans.reduce((best, s) =>            // the widest span holding `at`
    (at >= s.from - EPS && at < s.to - EPS && (!best || s.to - s.from > best.to - best.from) ? s : best), null);

  const seg = [];
  let key = null, id = -1;
  cells.forEach((c, i) => {
    const s = spanOf(c.at);
    const k = tupOf[i] >= 0 ? `t${tupOf[i]}` : `s${s ? s.from : c.at}-${s ? s.to : c.at}`;
    if (k !== key) { key = k; id++; }
    seg.push(id);
  });

  // 2. inside each segment, the maximal runs of beamable cells
  const beamable = i => !rest[i] && flags[i] >= 1;
  const runs = [];
  for (let i = 0; i < cells.length;) {
    if (!beamable(i)) { i++; continue; }
    let j = i, last = i;
    while (j + 1 < cells.length && seg[j + 1] === seg[i]
           && (beamable(j + 1) || (r.beamOverRests && rest[j + 1] && flags[j + 1] >= 1))) {
      j++;
      if (beamable(j)) last = j;                          // a group never ends on a rest
    }
    if (last > i) runs.push({ from: i, to: last });
    i = j + 1;
  }

  // 3. the beams of each group: level by level, a run of one being a beamlet
  const groups = runs.map(s => {
    const level = Math.max(...span(s.from, s.to).map(i => flags[i]));
    const beams = [];
    for (let L = 1; L <= level; L++) {
      for (let i = s.from; i <= s.to;) {
        if (flags[i] < L) { i++; continue; }
        let j = i;
        while (j + 1 <= s.to && flags[j + 1] >= L) j++;
        // a beamlet points inward, at the note it shares the beat with: back
        // towards the beat unless it opens the group and has nothing behind it
        beams.push({ level: L, from: i, to: j, partial: j > i ? null : (i > s.from ? 'left' : 'right') });
        i = j + 1;
      }
    }
    return { ...s, level, beams, tuplet: tuplets.find(t => t.from <= s.from && t.to >= s.to) ?? null };
  });

  const of = cells.map(() => null);
  const joined = cells.map(() => false);
  groups.forEach((g, k) => {
    for (let i = g.from; i <= g.to; i++) {
      of[i] = { group: k, role: i === g.from ? 'start' : i === g.to ? 'end' : 'inner' };
      if (i > g.from) joined[i] = true;
    }
  });
  return { groups, tuplets, flags, of, joined };
}

const span = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
