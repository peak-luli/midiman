// The ABC the staff view hands abcjs. abcjs breaks a system exactly where the source
// breaks a line, so how many `[V:V1]` lines the tune has *is* how many systems get
// engraved -- which is what the scrolling view depends on when it asks for one.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildAbc, colsFor, systemGrid, staffSepSpaces, staffSepFor,
         SEP_MIN, SEP_MARGIN } from '../src/learn/staff.js';
import { parseSong } from '../src/song.js';

const song = parseSong(JSON.parse(readFileSync(new URL('../songs/city-of-stars.json', import.meta.url), 'utf8')));
/** The voice lines of a tune: one pair per system. */
const systems = abc => abc.split('\n').filter(l => l.startsWith('[V:V1]'));
const bars = line => line.split('|').length - 1;

test('cols = the number of bars puts the whole range on one system', () => {
  for (const [a, b] of [[0, 3], [0, 7], [4, 15], [0, 31]]) {
    const n = b - a + 1;
    const rows = systems(buildAbc(song, a, b, n));
    assert.equal(rows.length, 1, `bars ${a + 1}-${b + 1} came out as ${rows.length} systems`);
    assert.equal(bars(rows[0]), n);
    // both hands are there, and the tune is still a grand staff of two voices
    const abc = buildAbc(song, a, b, n);
    assert.equal(abc.split('\n').filter(l => l.startsWith('[V:V2]')).length, 1);
    assert.ok(abc.includes('V:V1 clef=treble') && abc.includes('V:V2 clef=bass'));
  }
});

test('the same range wraps as before when cols is the reading width', () => {
  // the multi-system mode is untouched: 8 bars at 4 to a line is still two lines
  assert.equal(systems(buildAbc(song, 0, 7, colsFor(8))).length, 2);
  assert.equal(systems(buildAbc(song, 0, 5, colsFor(6))).length, 2);
  assert.equal(systems(buildAbc(song, 0, 3, colsFor(4))).length, 1);
  assert.equal(colsFor(4), 4);
  assert.equal(colsFor(6), 3);
  assert.equal(colsFor(8), 4);
});

test('each voice declares the clef its hand is read in', () => {
  // a sheet that writes both hands up top: only the V2 line changes, and the notes
  // it carries are the same ones, at the octave they were written at
  const both = parseSong({ id: 'x', title: 'x', bpm: 1, key: 'C', clefs: { lh: 'treble' },
                           rh: ['G5:8'], lh: ['C4 E4 G4 C4:5'] });
  const abc = buildAbc(both, 0, 0, 1);
  assert.ok(abc.includes('V:V1 clef=treble'));
  assert.ok(abc.includes('V:V2 clef=treble'));
  assert.equal(abc.split('\n').find(l => l.startsWith('[V:V2]')), '[V:V2] CEG C5 |');
});

test('a 6/8 song engraves M:6/8 and two beats to the bar', () => {
  const perfect = parseSong(JSON.parse(readFileSync(new URL('../songs/perfect.json', import.meta.url), 'utf8')));
  const abc = buildAbc(perfect, 0, 3, 4);
  assert.ok(abc.startsWith('X:1\nM:6/8\n'));
  assert.ok(abc.includes('K:C'));
  const g = systemGrid(0, 80, 4, perfect.beatsPerBar);
  assert.equal(g.barW, 20);
  assert.equal(g.pxPerBeat, 10);
  assert.equal(g.x(perfect.beatsPerBar), g.barW);
});

test('a song asking for per-beat beams gets a space at every beat', () => {
  // ABC says "beam these" by writing the tokens with no space between them, so the
  // song's beam style is visible in the tune itself
  const doc = beams => ({
    id: 't', title: 't', bpm: 90, key: 'C', ...(beams ? { beams } : {}),
    rh: ['r:2 E5 F5 D5 E5 C5 D5'], lh: ['G2 Bb2 D3 G3:2 G3 F3 D3'],
  });
  const voice = (song, v) => buildAbc(song, 0, 0, 1).split('\n').find(l => l.startsWith(`[V:V${v}]`)).slice(7);
  const half = parseSong(doc()), beat = parseSong(doc('beat'));
  assert.equal(voice(half, 1), 'z2 ef decd |');             // beat 2, then the whole second half
  assert.equal(voice(beat, 1), 'z2 ef de cd |');            // 2 + 2 + 2
  assert.equal(voice(half, 2), 'G,,_B,,D, G,2 G,F,D, |');   // the three that read as a triplet
  assert.equal(voice(beat, 2), 'G,,_B,, D, G,2 G, F,D, |');
  // and the real song asks for it. City of Stars is engraved as the printed score
  // writes it, so its vamp is four beamed pairs with a tie across the beat 2/3 line
  // -- not the three-eighths-and-a-quarter beam the default rules would draw
  assert.equal(song.beams, 'beat');
  assert.equal(buildAbc(song, 0, 1, 2).split('\n').at(-1).slice(7),
    'G,,B,, D,G,- G,G, F,D, |G,,B,, D,G,- G,G, F,D, |');
});

test('one system of n bars is n bars wide, at the pixels per beat asked for', () => {
  // what the strip promises the camera: the grid is linear, and a beat is a beat
  const ppb = 60, n = 8;
  const g = systemGrid(30, 30 + n * 4 * ppb, n);
  assert.equal(g.pxPerBeat, ppb);
  assert.equal(g.barW, ppb * 4);
  assert.equal(g.x(0), 30);
  assert.equal(g.x(n * 4), g.right);
  for (let b = 0; b < n * 4; b++) assert.equal(g.x(b + 1) - g.x(b), ppb);
  // and it extrapolates both ways, which is how a count-in and the last bar work
  assert.equal(g.x(-4), 30 - 4 * ppb);
  assert.equal(g.beat(g.x(37.5)), 37.5);
});

// ------------------------------------------------------- the two staves apart
// The two staves of a grand staff stand as far apart as the music between them needs,
// the way an engraver sets them: a left hand climbing on ledger lines and a right hand
// hanging on them must not meet in the middle. The rule is measured in staff spaces
// against each hand's own clef, so these are synthetic bars rather than screenshots.

const sepSong = (rh, lh, clefs) => parseSong({ id: 'x', title: 'x', bpm: 1, key: 'C',
                                               ...(clefs ? { clefs } : {}), rh, lh });

test('nothing between the staves leaves them a printed score apart', () => {
  // a right hand on its own staff over a left hand on its own: neither reaches into
  // the gap, so it is the minimum -- and the minimum is what abcjs draws unasked
  const s = sepSong(['G4 A4 B4 C5:5'], ['C3 E3 G3 C3:5']);
  assert.equal(staffSepSpaces(s, 0, 0), SEP_MIN);
  assert.equal(staffSepFor(s, 0, 0), 36);
  assert.ok(buildAbc(s, 0, 0, 1).includes('%%sysstaffsep 36'));
});

test('a left hand on ledger lines pushes the staves apart by what it climbs', () => {
  // D4 is 3 steps over the bass staff's top line, F4 is 5, A4 is 7, C5 is 9 -- and
  // every one of those half-spaces has to be given back before the margin is counted
  for (const [top, over] of [['D4', 1.5], ['F4', 2.5], ['A4', 3.5], ['C5', 4.5]]) {
    const s = sepSong(['G5:8'], [`C3 ${top}:7`]);
    assert.equal(staffSepSpaces(s, 0, 0), Math.max(SEP_MIN, over + SEP_MARGIN), top);
  }
});

test('both hands count: what hangs, what climbs, and the margin between them', () => {
  // a right hand down on B3 (a space and a half under the treble staff) over a left
  // hand up on A4 (three and a half over the bass one) needs all of it at once
  const s = sepSong(['B3 C4 D4 E4:5'], ['C3 A4:7']);
  assert.equal(staffSepSpaces(s, 0, 0), 1.5 + 3.5 + SEP_MARGIN);
  assert.ok(staffSepSpaces(s, 0, 0) > SEP_MIN);            // and this one really is wider
  // it is the whole range being engraved that decides, not its last bar
  const two = sepSong(['B3 C4 D4 E4:5', 'G4:8'], ['C3 A4:7', 'C3:8']);
  assert.equal(staffSepSpaces(two, 0, 1), staffSepSpaces(s, 0, 0));
  assert.equal(staffSepSpaces(two, 1, 1), SEP_MIN);        // a range with nothing in it does not pay
});

test('each hand is measured against its own clef, so two treble hands do not collide', () => {
  // Perfect's sheet: both hands in treble, the left hand climbing to C5 -- higher in
  // pitch than the right hand's C4, and still nothing on a ledger line between the
  // staves, because each hand is read on its own
  const both = sepSong(['C4 D4 E4 F4:5'], ['C4 E4 G4 C5:5'], { lh: 'treble' });
  assert.deepEqual(both.clefs, { rh: 'treble', lh: 'treble' });
  assert.equal(staffSepSpaces(both, 0, 0), SEP_MIN);
  // the same notes read in bass would be four and a half spaces of ledger lines
  const bass = sepSong(['C4 D4 E4 F4:5'], ['C4 E4 G4 C5:5'], { lh: 'bass' });
  assert.equal(staffSepSpaces(bass, 0, 0), 1 + 4.5 + SEP_MARGIN);
});

test('the songs on the shelf keep their staves clear of each other', () => {
  for (const [file, from, to] of [['city-of-stars', 4, 11], ['city-of-stars', 28, 33],
                                  ['perfect', 0, 7], ['perfect', 40, 50], ['let-it-be', 0, 7]]) {
    const s = parseSong(JSON.parse(readFileSync(new URL(`../songs/${file}.json`, import.meta.url), 'utf8')));
    const spaces = staffSepSpaces(s, from, to);
    assert.ok(spaces >= SEP_MIN, `${file} ${from + 1}-${to + 1}: ${spaces} spaces`);
    assert.ok(buildAbc(s, from, to, to - from + 1).includes(`%%sysstaffsep ${staffSepFor(s, from, to)}`));
  }
});
