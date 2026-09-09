// The beaming engine: beat groups, the merge exceptions, rests, tuplets and the
// secondary beams. All of it is pure, so none of this needs a browser.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { beamBar, meter, tupletOf, tupletsIn, flagsOf, FOUR_FOUR, DEFAULT_RULES,
         BEAM_STYLES, beamRulesOf } from '../src/notation/beams.js';
import { parseSong } from '../src/song.js';

/** A bar of cells from lengths in eighths; `r(d)` is a rest, `ch(d)` a chord. */
const r = d => ({ d, ns: [] });
const ch = (d = 1) => ({ d, ns: [60, 64, 67] });
const bar = (...specs) => {
  let at = 0;
  return specs.map(s => {
    const { d, ns = [60], tie = false } = typeof s === 'number' ? { d: s } : s;
    const c = { at, d, ns, tie, roll: false };
    at += d;
    return c;
  });
};
/** Groups as [from, to] pairs, which is all most of these tests care about. */
const gs = plan => plan.groups.map(g => [g.from, g.to]);

// ---------------------------------------------------------------- values
test('a value needs as many beams as it has flags; dots do not count', () => {
  assert.equal(flagsOf(4), 0);                  // half note
  assert.equal(flagsOf(3), 0);                  // dotted quarter
  assert.equal(flagsOf(2), 0);                  // quarter -- never beams
  assert.equal(flagsOf(1.5), 1);                // dotted eighth
  assert.equal(flagsOf(1), 1);                  // eighth
  assert.equal(flagsOf(0.75), 2);               // dotted sixteenth
  assert.equal(flagsOf(0.5), 2);                // sixteenth
  assert.equal(flagsOf(0.25), 3);               // 32nd
  assert.equal(flagsOf(0.125), 4);              // 64th
  assert.equal(flagsOf(1.75), 1);               // double-dotted eighth
  assert.equal(flagsOf(5), 0);                  // not a value anyone writes
});

test('meters group by the beat, and compound meters group in threes', () => {
  assert.deepEqual(meter(4, 4).groups, [2, 2, 2, 2]);
  assert.deepEqual(meter(3, 4).groups, [2, 2, 2]);
  assert.deepEqual(meter(2, 4).groups, [2, 2]);
  assert.deepEqual(meter(6, 8).groups, [3, 3]);
  assert.deepEqual(meter(9, 8).groups, [3, 3, 3]);
  assert.deepEqual(meter(12, 8).groups, [3, 3, 3, 3]);
  assert.deepEqual(meter(4, 4).edges, [0, 2, 4, 6, 8]);
  // the merge spans are the halves in 4/4 and the whole bar in 3/4; 6/8 has none
  assert.deepEqual(meter(4, 4).merges.map(s => [s.from, s.to]), [[0, 4], [4, 8]]);
  assert.deepEqual(meter(3, 4).merges.map(s => [s.from, s.to]), [[0, 6]]);
  assert.deepEqual(meter(6, 8).merges, []);
});

// ---------------------------------------------------------------- 4/4, the beat
test('two eighths on a beat are one group; a quarter beside them is not in it', () => {
  assert.deepEqual(gs(beamBar(bar(1, 1, 2, 2, 2))), [[0, 1]]);
  assert.deepEqual(gs(beamBar(bar(2, 2, 1, 1, 2))), [[2, 3]]);   // the same on beat 3
});

test('a quarter never beams, so quarter-eighth-eighth beams only the last two', () => {
  assert.deepEqual(gs(beamBar(bar(2, 1, 1, 2, 2))), [[1, 2]]);
});

test('a lone eighth is flagged, not beamed', () => {
  assert.deepEqual(gs(beamBar(bar(1, 3, 2, 2))), []);
});

test('the syncopated eighth-quarter-eighth is written unbeamed', () => {
  assert.deepEqual(gs(beamBar(bar(1, 2, 1, 2, 2))), []);
});

// ---------------------------------------------------------------- the half-bar merge
test('four eighths filling half a bar beam as one group, or per beat with the rule off', () => {
  const cells = bar(1, 1, 1, 1, 2, 2);
  assert.deepEqual(gs(beamBar(cells)), [[0, 3]]);
  assert.deepEqual(gs(beamBar(cells, FOUR_FOUR, { mergeHalfBar: false })), [[0, 1], [2, 3]]);
});

test('a bar of eighths is two groups of four -- nothing beams across the middle', () => {
  assert.deepEqual(gs(beamBar(bar(1, 1, 1, 1, 1, 1, 1, 1))), [[0, 3], [4, 7]]);
  // and the eighths either side of the middle stay apart even when the halves differ
  assert.deepEqual(gs(beamBar(bar(2, 1, 1, 1, 1, 2))), [[1, 2], [3, 4]]);
});

test('the merge is off the moment anything shorter than an eighth is in the half', () => {
  // 8 8 8 16 16 : the half has sixteenths in it, so it beams by the beat
  assert.deepEqual(gs(beamBar(bar(1, 1, 1, 0.5, 0.5, 2, 2))), [[0, 1], [2, 4]]);
});

// ---------------------------------------------------------------- the named styles
/** One bar of one hand, as a song document writes it. */
const written = (text, beams) => parseSong({
  id: 'x', title: 'x', bpm: 90, key: 'C', ...(beams ? { beams } : {}),
  rh: [text], lh: ['r:8'],
}).cells.rh[0];

test('the beat style stops every beam at the beat, and half is the default', () => {
  assert.deepEqual(beamRulesOf('half'), DEFAULT_RULES);
  assert.deepEqual(beamRulesOf('beat'), { ...DEFAULT_RULES, mergeHalfBar: false, mergeWholeBar: false });
  assert.deepEqual(beamRulesOf(), DEFAULT_RULES);          // no name = the default
  assert.equal(beamRulesOf('nonsense'), null);
  assert.deepEqual(Object.keys(BEAM_STYLES), ['half', 'beat']);
});

test('the vamp beams 3+3 by the half bar and 2 + a flagged eighth by the beat', () => {
  // the reason the option exists: "G2 Bb2 D3 G3:2 ..." beams its first three
  // eighths together, which a reader takes for a triplet
  const cells = written('G2 Bb2 D3 G3:2 G3 F3 D3');
  assert.deepEqual(gs(beamBar(cells)), [[0, 2], [4, 6]]);
  const beat = beamRulesOf('beat');
  const p = beamBar(cells, FOUR_FOUR, beat);
  // beat 1 keeps its pair; the third eighth belongs to beat 2, which the quarter
  // fills out, so it is left alone with its flag -- and the beat is visible again
  assert.deepEqual(gs(p), [[0, 1], [5, 6]]);
  assert.equal(p.of[2], null);
  assert.equal(p.flags[2], 1);
  assert.deepEqual(p.joined, [false, true, false, false, false, false, true]);
});

test('a rest opening the bar does not stretch a beat group over the second half', () => {
  const cells = written('r:2 E5 F5 D5 E5 C5 D5');
  assert.deepEqual(gs(beamBar(cells)), [[1, 2], [3, 6]]);              // 2 + 4
  assert.deepEqual(gs(beamBar(cells, FOUR_FOUR, beamRulesOf('beat'))), [[1, 2], [3, 4], [5, 6]]);
});

test('a song carries the style it names, and an unknown one is refused', () => {
  const beat = parseSong({ id: 'x', title: 'x', bpm: 90, rh: ['C5 C5 C5 C5 r:4'], lh: ['r:8'], beams: 'beat' });
  assert.equal(beat.beams, 'beat');
  assert.deepEqual(beat.beamRules, beamRulesOf('beat'));
  const plain = parseSong({ id: 'x', title: 'x', bpm: 90, rh: ['C5 C5 C5 C5 r:4'], lh: ['r:8'] });
  assert.equal(plain.beams, 'half');
  assert.deepEqual(plain.beamRules, DEFAULT_RULES);
  assert.throws(() => parseSong({ id: 'x', title: 'x', bpm: 90, rh: ['r:8'], lh: ['r:8'], beams: 'bar' }),
                /bad beams "bar"/);
});

// ---------------------------------------------------------------- rests
test('a rest breaks the beam by default, and may sit inside one when the rule is on', () => {
  assert.deepEqual(gs(beamBar(bar(1, r(1), 1, r(1), 4))), []);
  assert.deepEqual(gs(beamBar(bar(1, r(1), 1, 1, 4))), [[2, 3]]);
  const over = { beamOverRests: true };
  assert.deepEqual(gs(beamBar(bar(1, r(1), 1, 1, 4), FOUR_FOUR, over)), [[0, 3]]);
  // even then a group never opens or closes on a rest
  assert.deepEqual(gs(beamBar(bar(r(1), 1, 1, r(1), 4), FOUR_FOUR, over)), [[1, 2]]);
});

// ---------------------------------------------------------------- secondary beams
test('a dotted eighth and a sixteenth beam together, the sixteenth with a beamlet', () => {
  const p = beamBar(bar(1.5, 0.5, 2, 2, 2));
  assert.deepEqual(gs(p), [[0, 1]]);
  assert.equal(p.groups[0].level, 2);
  assert.deepEqual(p.groups[0].beams, [
    { level: 1, from: 0, to: 1, partial: null },
    { level: 2, from: 1, to: 1, partial: 'left' },        // a backward hook
  ]);
});

test('a sixteenth before a dotted eighth hooks the other way', () => {
  const p = beamBar(bar(0.5, 1.5, 2, 2, 2));
  assert.deepEqual(p.groups[0].beams[1], { level: 2, from: 0, to: 0, partial: 'right' });
});

test('sixteenths get two full beams, one group per beat', () => {
  const p = beamBar(bar(0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 2, 2));
  assert.deepEqual(gs(p), [[0, 3], [4, 7]]);
  assert.deepEqual(p.groups[0].beams, [
    { level: 1, from: 0, to: 3, partial: null },
    { level: 2, from: 0, to: 3, partial: null },
  ]);
});

test('a mixed group draws the secondary beam only over the notes that need it', () => {
  // 16 16 8 on one beat: one primary beam, a secondary over the two sixteenths
  const p = beamBar(bar(0.5, 0.5, 1, 2, 2, 2));
  assert.deepEqual(gs(p), [[0, 2]]);
  assert.deepEqual(p.groups[0].beams, [
    { level: 1, from: 0, to: 2, partial: null },
    { level: 2, from: 0, to: 1, partial: null },
  ]);
});

test('32nds get three beams', () => {
  const p = beamBar(bar(2, 2, 0.25, 0.25, 0.25, 0.25, r(3)));
  assert.deepEqual(gs(p), [[2, 5]]);
  assert.equal(p.groups[0].level, 3);
  assert.equal(p.groups[0].beams.length, 3);
});

// ---------------------------------------------------------------- tuplets
test('tuplet members are recognised by their odd denominators', () => {
  assert.deepEqual(tupletOf(2 / 3), { p: 3, q: 2, v: 1 });
  assert.deepEqual(tupletOf(4 / 3), { p: 3, q: 2, v: 2 });
  assert.deepEqual(tupletOf(2 / 7), { p: 7, q: 4, v: 0.5 });
  assert.equal(tupletOf(1), null);
  assert.equal(tupletOf(0.25), null);
});

test('a triplet of eighths is its own group, with its own tuplet span', () => {
  const p = beamBar(bar(2 / 3, 2 / 3, 2 / 3, 2, 2, 2));
  assert.deepEqual(gs(p), [[0, 2]]);
  assert.deepEqual(p.tuplets, [{ from: 0, to: 2, p: 3, q: 2, v: 1 }]);
  assert.deepEqual(p.groups[0].tuplet, p.tuplets[0]);
});

test('a triplet never joins the eighths beside it, even inside one beat group', () => {
  // 8 8 | triplet-8 x3 -- both fill their own half; the triplet stays separate
  const p = beamBar(bar(1, 1, 1, 1, 2 / 3, 2 / 3, 2 / 3, 2));
  assert.deepEqual(gs(p), [[0, 3], [4, 6]]);
});

test('a tuplet written in quarters gets a span but no beam', () => {
  const p = beamBar(bar(2, 2, 4 / 3, 4 / 3, 4 / 3));
  assert.deepEqual(gs(p), []);
  assert.deepEqual(p.tuplets, [{ from: 2, to: 4, p: 3, q: 2, v: 2 }]);
});

test('a rest inside a tuplet still breaks its beam, and the bracket still spans three', () => {
  const p = beamBar(bar(2, 2, r(2 / 3), 2 / 3, 2 / 3, 2 / 3, 2 / 3, 2 / 3));
  assert.deepEqual(gs(p), [[3, 4], [5, 7]]);
  assert.deepEqual(p.tuplets.map(t => [t.from, t.to]), [[2, 4], [5, 7]]);
});

test('the seven-tuplet of bar 34 is one group of seven with two beams', () => {
  const p = beamBar(bar(3, 1, 2, ...Array(7).fill(2 / 7)));
  assert.deepEqual(gs(p), [[3, 9]]);
  assert.equal(p.groups[0].level, 2);
  assert.deepEqual(p.groups[0].beams, [
    { level: 1, from: 3, to: 9, partial: null },
    { level: 2, from: 3, to: 9, partial: null },
  ]);
  assert.equal(p.groups[0].tuplet.p, 7);
});

test('a septuplet of 32nds inside one eighth is also one group', () => {
  const p = beamBar(bar(2, 2, 2, 1, ...Array(7).fill(1 / 7)));
  assert.deepEqual(gs(p), [[4, 10]]);
  assert.equal(p.groups[0].level, 3);
});

// ---------------------------------------------------------------- other meters
test('3/4 beams by the beat, or the whole bar when the rule is on -- never 3+3', () => {
  const cells = bar(1, 1, 1, 1, 1, 1);
  const m = meter(3, 4);
  assert.deepEqual(gs(beamBar(cells, m)), [[0, 1], [2, 3], [4, 5]]);
  assert.deepEqual(gs(beamBar(cells, m, { mergeWholeBar: true })), [[0, 5]]);
  // a quarter anywhere in the bar still cuts the merged span into runs
  assert.deepEqual(gs(beamBar(bar(1, 1, 2, 1, 1), m, { mergeWholeBar: true })), [[0, 1], [3, 4]]);
});

test('6/8 beams in two groups of three, and a beam never crosses the dotted-quarter beat', () => {
  const m = meter(6, 8);
  assert.deepEqual(gs(beamBar(bar(1, 1, 1, 1, 1, 1), m)), [[0, 2], [3, 5]]);
  // a quarter, then four eighths: the third eighth of beat 1 is left alone rather
  // than joining the eighths of beat 2
  assert.deepEqual(gs(beamBar(bar(2, 1, 1, 1, 1), m)), [[2, 4]]);
});

// ---------------------------------------------------------------- transparent things
test('ties do not change the groups', () => {
  const plain = bar(1, 1, 1, 1, 2, 2);
  const tied = bar(1, { d: 1, tie: true }, { d: 1, tie: true }, 1, 2, 2);
  assert.deepEqual(gs(beamBar(tied)), gs(beamBar(plain)));
});

test('chords beam exactly like single notes', () => {
  assert.deepEqual(gs(beamBar(bar(ch(), ch(), ch(), ch(), 2, 2))), gs(beamBar(bar(1, 1, 1, 1, 2, 2))));
});

test('every cell of a group knows its role, and `joined` says where the spaces go', () => {
  const p = beamBar(bar(1, 1, 1, 1, 2, 2));
  assert.deepEqual(p.of.map(o => o?.role ?? null), ['start', 'inner', 'inner', 'end', null, null]);
  assert.deepEqual(p.joined, [false, true, true, true, false, false]);
});

// ---------------------------------------------------------------- the real song
test('City of Stars beams the vamp per beat and never crosses a bar or a half bar', () => {
  const s = parseSong(JSON.parse(readFileSync(new URL('../songs/city-of-stars.json', import.meta.url), 'utf8')));
  for (const hand of ['rh', 'lh']) {
    s.cells[hand].forEach((cells, bi) => {
      const p = beamBar(cells);
      for (const g of p.groups) {
        assert.ok(g.to > g.from, `${hand} bar ${bi + 1}: a group of one`);
        const start = cells[g.from].at, end = cells[g.to].at + cells[g.to].d;
        assert.ok(end <= 8 + 1e-6, `${hand} bar ${bi + 1}: a group past the bar line`);
        if (!g.tuplet) assert.ok(start >= 4 || end <= 4 + 1e-6,
          `${hand} bar ${bi + 1}: a group across the middle of the bar`);
      }
    });
  }
  // the bass vamp "G2 Bb2 D3 G3:2 G3 F3 D3": three eighths (the quarter that
  // straddles the middle of the bar ends the first group), then three more
  assert.deepEqual(gs(beamBar(s.cells.lh[0])), [[0, 2], [4, 6]]);
  // bar 34's right hand: the septuplet on beat 4
  const b34 = beamBar(s.cells.rh[33]);
  assert.equal(b34.groups.at(-1).tuplet.p, 7);
  assert.equal(b34.groups.at(-1).to - b34.groups.at(-1).from, 6);
});

test('the default rules are the documented ones', () => {
  assert.deepEqual(DEFAULT_RULES, { mergeHalfBar: true, mergeWholeBar: false, beamOverRests: false });
  assert.deepEqual(tupletsIn(bar(1, 2 / 3, 2 / 3, 2 / 3, 1, 1, 1, 1, 1)).map(t => [t.from, t.to]), [[1, 3]]);
});
