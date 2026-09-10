// The composer's model and its way back out to a file. The law this whole slice is
// built on is at the top: a song written from a piece has to *sound* the same as the
// song the piece came from, note for note, though the text is spelled the composer's
// own way. Everything below it tests one clause of that spelling.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

import { parseSong } from '../src/song.js';
import { newSlot, slotNotes, toMelody } from '../src/looper/loops.js';
import {
  beatsPerBarOf, eighthsPerBeatOf, swingOf, barsOf, notesIn,
  emptyPiece, fromSong, fromTake, validate, sortNotes,
} from '../src/composer/piece.js';
import { writeSong, canWrite, songText, writeMelody } from '../src/composer/write.js';

const songDir = new URL('../songs/', import.meta.url);
const SONGS = readdirSync(songDir).filter(f => f.endsWith('.json') && f !== 'index.json').sort();
const load = f => JSON.parse(readFileSync(new URL(f, songDir), 'utf8'));

/** The sound of a song, and nothing else: no bars, no ties, no spelling. */
const sound = song => song.notes
  .map(n => ({ b: +n.b.toFixed(6), len: +n.len.toFixed(6), n: n.n, hand: n.hand }))
  .sort((a, b) => a.b - b.b || a.n - b.n || (a.hand < b.hand ? -1 : a.hand > b.hand ? 1 : 0));

// a one-bar 4/4 piece, so a test is one line of notes
const N = (b, len, n, hand = 'rh') => ({ b, len, n, hand, v: 80 });
const piece = (notes, header = {}) => emptyPiece({ id: 'x', title: 'X', ...header, notes });
const rh = (notes, header) => writeSong(piece(notes, header)).rh;

// ------------------------------------------------------------------ the law
test('every song in songs/ comes back the same sound through a piece', () => {
  assert.ok(SONGS.length >= 3, `only found ${SONGS.length} songs`);
  for (const f of SONGS) {
    const doc = load(f);
    const back = parseSong(writeSong(fromSong(doc)));
    assert.deepEqual(sound(back), sound(parseSong(doc)), `${f} came back a different piece of music`);
  }
});

test('the written song is a whole song file, not just the bars', () => {
  const doc = writeSong(fromSong(load('city-of-stars.json')));
  assert.equal(doc.id, 'city-of-stars');
  assert.equal(doc.swing, '2/3');
  assert.equal(doc.meter, undefined, '4/4 is the default and stays out of the file');
  assert.equal(doc.rh.length, doc.lh.length);
  assert.equal(doc.rh.length, 59);
  assert.deepEqual(doc.sections[0], { name: 'Intro', from: 1, to: 4, hint: doc.sections[0].hint,
    coach: doc.sections[0].coach });
  const six = writeSong(fromSong(load('perfect.json')));
  assert.equal(six.meter, '6/8');                      // anything but 4/4 is written
});

// ------------------------------------------------------------------ house rule
test('an offbeat quarter is an eighth tied over the beat line', () => {
  assert.deepEqual(rh([N(0.5, 1, 67)]), ['r G4 ~G4 r:5']);
  // and the tie is heard as one note again, not two
  const back = parseSong(writeSong(piece([N(0.5, 1, 67)])));
  assert.deepEqual(sound(back), [{ b: 0.5, len: 1, n: 67, hand: 'rh' }]);
});

test('an on-beat quarter takes its plain length', () => {
  assert.deepEqual(rh([N(0, 1, 67)]), ['G4:2 r:6']);
  assert.deepEqual(rh([N(0, 3, 67)]), ['G4:6 r:2']);   // a dotted half, not three ties
});

test('a swing song gets its beats drawn', () => {
  assert.equal(writeSong(piece([N(0, 1, 67)], { swing: '2/3' })).beams, 'beat');
  assert.equal(writeSong(piece([N(0, 1, 67)])).beams, 'half');
  assert.equal(writeSong(piece([N(0, 1, 67)], { beams: 'beat' })).beams, 'beat');
});

test('the house rule survives the whole of City of Stars', () => {
  const doc = writeSong(fromSong(load('city-of-stars.json')));
  assert.equal(doc.lh[0], 'G2 Bb2 D3 G3 ~G3 G3 F3 D3', 'the vamp is spelled as the score prints it');
  assert.equal(doc.rh[4], 'G4 A4 Bb4 D5 ~D5:2 r:2');
});

// ------------------------------------------------------------------ the cells
test('a note across the bar line is cut and continues as a ~ cell', () => {
  const doc = writeSong(piece([N(3.5, 1, 67)]));
  assert.deepEqual(doc.rh, ['r:7 G4', '~G4 r:7']);
  assert.deepEqual(sound(parseSong(doc)), [{ b: 3.5, len: 1, n: 67, hand: 'rh' }]);
});

test('silence is a rest, and a whole silent bar is one', () => {
  assert.deepEqual(rh([N(1, 1, 67)]), ['r:2 G4:2 r:4']);
  assert.deepEqual(rh([N(4, 1, 67)]), ['r:8', 'G4:2 r:6']);
});

test('notes that start together are one chord cell', () => {
  assert.deepEqual(rh([N(0, 1, 60), N(0, 1, 64), N(0, 1, 67)]), ['[C4 E4 G4]:2 r:6']);
  // a hand with sharps spells them that way
  assert.deepEqual(rh([N(0, 1, 61)], { sharps: true }), ['C#4:2 r:6']);
  assert.deepEqual(rh([N(0, 1, 61)]), ['Db4:2 r:6']);
});

test('sixteenths and triplet eighths are written as the fractions parseSong reads', () => {
  const t = 1 / 3;
  assert.deepEqual(rh([N(0, 0.25, 67), N(0.25, 0.25, 69)]), ['G4:1/2 A4:1/2 r:7']);
  assert.deepEqual(rh([N(0, t, 67), N(t, t, 69), N(2 * t, t, 71)]), ['G4:2/3 A4:2/3 B4:2/3 r:6']);
  const doc = writeSong(piece([N(0, t, 67), N(t, t, 69), N(2 * t, t, 71)]));
  assert.deepEqual(sound(parseSong(doc)).map(n => n.n), [67, 69, 71]);
});

test('a chord where only some pitches carry on is one tied cell', () => {
  // parseSong ties per pitch: in ~[G4 B4] the open G4 is extended and the B4 attacks
  const doc = writeSong(piece([N(0, 2, 67), N(1, 1, 71)]));
  assert.deepEqual(doc.rh, ['G4:2 ~[G4 B4]:2 r:4']);
  assert.deepEqual(sound(parseSong(doc)), [
    { b: 0, len: 2, n: 67, hand: 'rh' },
    { b: 1, len: 1, n: 71, hand: 'rh' },
  ]);
});

// ------------------------------------------------------------------ refusals
test('a note off the grid is refused by hand, bar and name', () => {
  const p = piece([N(2.37, 1, 67)]);
  assert.throws(() => writeSong(p),
    /^Error: rh bar 1: note G4 at beat 2\.37 is off the grid — Quantise first$/);
  assert.equal(canWrite(p), 'rh bar 1: note G4 at beat 2.37 is off the grid — Quantise first');
  assert.equal(canWrite(piece([N(0, 1, 67)])), null);
  // the bar is the 1-based bar the note is in, whichever hand it is in
  assert.match(canWrite(piece([N(8 + 2.37, 1, 67, 'lh')])), /^lh bar 3: note G4 at beat 2\.37 /);
});

test('what one voice per hand cannot say is refused, not written wrong', () => {
  // B4 stops and is struck again exactly where G4 is still holding: a tie would eat it
  assert.match(canWrite(piece([N(0, 2, 67), N(0, 1, 71), N(1, 1, 71)])),
    /^rh bar 1: note B4 at beat 1 is struck again under a tie — that needs a second voice$/);
  assert.match(canWrite(piece([N(0, 2, 67), N(1, 2, 67)])),
    /overlaps another of the same pitch — that needs a second voice$/);
  // the same two notes in different hands are fine
  assert.equal(canWrite(piece([N(0, 2, 67), N(1, 2, 67, 'lh')])), null);
});

// ------------------------------------------------------------------ the file
test('songText parses back and puts one bar on a line', () => {
  const doc = writeSong(fromSong(load('let-it-be.json')));
  const text = songText(doc);
  assert.deepEqual(JSON.parse(text), doc);
  const lines = text.split('\n');
  assert.equal(lines.filter(l => /^ {4}"/.test(l)).length, doc.rh.length + doc.lh.length);
  assert.equal(lines.filter(l => l.startsWith('  "bpm"')).length, 1);
  assert.ok(text.endsWith('\n'));
});

// ------------------------------------------------------------------ the piece
test('a song file becomes a piece with its header and its notes', () => {
  const p = fromSong(load('let-it-be.json'));
  assert.equal(p.v, 1);
  assert.equal(p.title, 'Let It Be');
  assert.equal(p.meter, '4/4');
  assert.equal(p.raw, null);
  assert.equal(p.sections[0].from, 1, 'sections stay 1-based, as the file writes them');
  assert.equal(barsOf(p), 16);
  assert.equal(beatsPerBarOf(p), 4);
  assert.equal(eighthsPerBeatOf(p), 2);
  assert.equal(swingOf(p), 0.5);
  assert.deepEqual(p.notes, sortNotes(p.notes));
  assert.ok(p.notes.every(n => n.v === (n.hand === 'lh' ? 68 : 80)));
  assert.deepEqual(notesIn(p, 0, 0, ['rh']).map(n => n.n), [60, 64, 67, 60, 64, 67]);
  assert.equal(notesIn(p, 0, 0).length, 7);           // the left hand's held root as well
});

test('the grid a piece arrives on is the coarsest one all its notes fit', () => {
  assert.equal(fromSong(load('let-it-be.json')).grid, '1/8');
  assert.equal(fromSong(load('perfect.json')).grid, '1/16');   // dotted eighth + sixteenth
  assert.equal(fromSong(load('city-of-stars.json')).grid, null, 'septuplets fit no grid');
  assert.equal(emptyPiece().grid, '1/8');
});

test('swing is read however the header spells it', () => {
  assert.equal(swingOf(fromSong(load('city-of-stars.json'))), 2 / 3);
  assert.equal(swingOf({ swing: 0.62 }), 0.62);
  assert.equal(swingOf({}), 0.5);
  assert.throws(() => swingOf({ swing: 'shuffle' }), /neither a number/);
});

test('a take becomes a piece split between the hands, with the take kept', () => {
  const take = [
    { b: 0, len: 0.9, p: 43, v: 70 },
    { b: 0.51, len: 0.4, p: 67, v: 90 },
    { b: 4.02, len: 2, p: 72, v: 88 },
  ];
  const p = fromTake(take, { bpm: 96, split: 60 });
  assert.deepEqual(p.notes.map(n => [n.n, n.hand]), [[43, 'lh'], [67, 'rh'], [72, 'rh']]);
  assert.equal(p.grid, null, 'a take is not on any grid until it is quantised');
  assert.equal(p.bpm, 96);
  assert.deepEqual(p.raw, { notes: take, bpm: 96 });
  assert.notEqual(p.raw.notes[0], take[0], 'the take is copied, not held by reference');
  assert.deepEqual(p.sections, [{ name: 'Whole song', from: 1, to: 2, hint: '', coach: '' }]);
  // one hand can be forced, for a looper lane that is already a hand
  assert.ok(fromTake(take, { hand: 'lh' }).notes.every(n => n.hand === 'lh'));
});

test('validate says in English what is wrong with a piece', () => {
  assert.equal(validate(emptyPiece({ title: 'X' })).title, 'X');
  assert.throws(() => validate({ ...emptyPiece(), title: '' }), /needs a title/);
  assert.throws(() => validate({ ...emptyPiece(), bpm: 0 }), /is not a tempo/);
  assert.throws(() => validate({ ...emptyPiece(), meter: '4/0' }), /bad meter/);
  assert.throws(() => validate({ ...emptyPiece(), grid: '1/32' }), /grid "1\/32"/);
  assert.throws(() => validate({ ...emptyPiece(), notes: [N(-1, 1, 60)] }), /starts at beat -1/);
  assert.throws(() => validate({ ...emptyPiece(), notes: [N(0, 0, 60)] }), /is 0 beats long/);
  assert.throws(() => validate({ ...emptyPiece(), notes: [N(0, 1, 60, 'left')] }), /not lh or rh/);
  assert.throws(() => validate({ ...emptyPiece(), sections: [] }), /at least one section/);
});

// ------------------------------------------------------------------ the melody
test('a hand comes out as the melody loops.js would have made of the same lane', () => {
  const track = { form: [0, 0, 5, 7], swing: 0.5 };
  const q = { div: 0, strength: 0 };
  const slot = {
    ...newSlot(0), st: 'play', fromBar: 0, lenBars: 4, mode: 'phrase',
    layers: [[
      { b: 0, len: 1, p: 67, v: 80 },
      { b: 1.5, len: 0.5, p: 72, v: 80 },
      { b: 1.5, len: 0.5, p: 60, v: 80 },      // same eighth, lower: the top note wins
      { b: 6, len: 2, p: 64, v: 70 },
      { b: 13, len: 1, p: 69, v: 70 },
    ]],
  };
  const lane = slotNotes(slot, track, q).map(n => ({ b: n.b, len: n.len, p: n.p, v: n.v }));
  const p = fromTake(lane, { hand: 'rh', header: { title: 'captured line' } });
  assert.deepEqual(writeMelody(p, 'rh', track.form.length), toMelody(slot, track, q, 'captured line'));
  assert.equal(writeMelody(p, 'rh', 4).bars.length, 4);
  assert.equal(writeMelody(p, 'lh', 4).bars[0][0][0], null, 'the other hand is empty');
});

test('a melody is 4/4 or nothing', () => {
  assert.throws(() => writeMelody(fromSong(load('perfect.json')), 'rh', 4), /4\/4 only.*6\/8/);
});
