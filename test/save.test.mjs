// The save path, everywhere except the server: the guessed key, the file name, what
// the Save-as-sheet form opens with, the draft, and the three ways out.
//
// The key guess is checked against the three songs in the repository rather than
// against invented note lists, because those are the only pitch sets anybody has
// actually played here, and each one already carries the answer in its `key` field.
//
// Everything a browser has and node does not -- localStorage, a document, a clipboard,
// fetch -- is stubbed rather than skipped: these functions are imported by the page
// module graph, and "it does not crash under node" is exactly the property that keeps
// `wiring.test.mjs` honest.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { fromSong, emptyPiece } from '../src/composer/piece.js';
import { writeSong, writeMelody } from '../src/composer/write.js';
import {
  DRAFT_KEY, loadDraft, saveDraft, clearDraft,
  slugOf, guessKey, sheetDefaults, downloadSong, copyMelody, postSong,
} from '../src/composer/save.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const song = id => JSON.parse(readFileSync(join(ROOT, 'songs', `${id}.json`), 'utf8'));

/** localStorage, the way a browser has one -- and, on demand, the way a locked-down
 *  browser has one: every call throws. */
function fakeStorage({ broken = false } = {}) {
  const map = new Map();
  const guard = () => { if (broken) throw new Error('the browser said no'); };
  return {
    map,
    getItem: k => { guard(); return map.has(k) ? map.get(k) : null; },
    setItem: (k, v) => { guard(); map.set(k, String(v)); },
    removeItem: k => { guard(); map.delete(k); },
  };
}

const useStorage = store => { globalThis.localStorage = store; };

// ---------------------------------------------------------------- the key guess
test('the key guess agrees with the three songs in the repository', () => {
  for (const id of ['city-of-stars', 'let-it-be', 'perfect']) {
    const doc = song(id);
    const piece = fromSong(doc);
    assert.deepEqual(guessKey(piece.notes), { key: doc.key, sharps: doc.sharps },
      `${id} is written in ${doc.key}`);
  }
});

test('City of Stars is F and Let It Be is C, right hand alone as well', () => {
  const rh = id => fromSong(song(id)).notes.filter(n => n.hand === 'rh');
  assert.equal(guessKey(rh('city-of-stars')).key, 'F');
  assert.equal(guessKey(rh('let-it-be')).key, 'C');
});

test('the guess takes plain MIDI numbers too, and counts every note', () => {
  // a G major scale: one F#, and it is the F# that rules out C
  assert.deepEqual(guessKey([67, 69, 71, 72, 74, 76, 78, 79]), { key: 'G', sharps: true });
  // the same notes but F natural instead: C, and no sharps
  assert.deepEqual(guessKey([67, 69, 71, 72, 74, 77, 79]), { key: 'C', sharps: false });
});

test('a tie goes to the signature with fewer accidentals, and nothing at all is C', () => {
  // Db and C# hold the same seven pitch classes; Db writes five flats, C# seven sharps
  assert.deepEqual(guessKey([61, 63, 65, 66, 68, 70, 72]), { key: 'Db', sharps: false });
  assert.deepEqual(guessKey([]), { key: 'C', sharps: false });
});

// ---------------------------------------------------------------- names and defaults
test('a title becomes a file name: lower case, dashes, nothing else', () => {
  assert.equal(slugOf('City of Stars'), 'city-of-stars');
  assert.equal(slugOf("  Don't Stop — Believin'!  "), 'dont-stop-believin');
  assert.equal(slugOf('Café del Mar'), 'cafe-del-mar');
  assert.equal(slugOf('...'), 'untitled');
  assert.match(slugOf('Prelude No. 1 (BWV 846)'), /^[a-z0-9-]+$/);
});

test('the sheet form opens on the piece: an id from the title, 60 % for practice', () => {
  const piece = { ...emptyPiece({ bpm: 100 }), title: 'My New Song', key: undefined, notes: [] };
  assert.deepEqual(sheetDefaults(piece),
    { id: 'my-new-song', title: 'My New Song', key: 'C', sharps: false, practiceBpm: 60 });
});

test('a piece off the piano gets a guessed key; one from a song file keeps its own', () => {
  const doc = song('city-of-stars');
  const piece = fromSong(doc);
  assert.equal(sheetDefaults(piece).key, 'F', 'the file already chose F');
  assert.equal(sheetDefaults(piece).id, 'city-of-stars');
  assert.equal(sheetDefaults(piece).practiceBpm, doc.practiceBpm, 'the file chose its own practice tempo');

  // the same notes with no key on the header: guessed, and to the same answer
  assert.equal(sheetDefaults({ ...piece, key: undefined }).key, 'F');
});

// ---------------------------------------------------------------- the draft
test('a draft survives a reload, and clearing it takes it away', () => {
  const store = fakeStorage();
  useStorage(store);
  clearDraft();
  assert.equal(loadDraft(), null, 'nothing saved yet');

  const piece = { ...emptyPiece(), title: 'Draft', notes: [{ b: 0, len: 1, n: 60, hand: 'rh', v: 80 }] };
  assert.equal(saveDraft(piece), true);
  assert.ok(store.map.has(DRAFT_KEY), `it is filed under ${DRAFT_KEY}`);
  // a draft is JSON: the fields a piece leaves undefined (clefs, raw) come back missing
  assert.deepEqual(loadDraft(), JSON.parse(JSON.stringify(piece)));
  assert.deepEqual(loadDraft().notes, piece.notes);

  clearDraft();
  assert.equal(loadDraft(), null);
});

test('a browser that refuses storage loses the draft and nothing else', () => {
  useStorage(fakeStorage({ broken: true }));
  assert.equal(saveDraft(emptyPiece()), false);
  assert.equal(loadDraft(), null);
  clearDraft();                          // and this does not throw either
});

test('a draft that is not a piece reads as no draft', () => {
  const store = fakeStorage();
  useStorage(store);
  store.map.set(DRAFT_KEY, '{not json');
  assert.equal(loadDraft(), null);
});

// ---------------------------------------------------------------- the ways out
test('download hands back the file text even where there is no document to click', () => {
  const doc = writeSong(fromSong(song('let-it-be')));
  const out = downloadSong(doc);
  assert.equal(out.ok, false, 'node has no document; the page does the clicking');
  assert.equal(out.name, 'let-it-be.json');
  assert.deepEqual(JSON.parse(out.text), doc, 'and the text is the song file');
});

test('copy melody makes the tracks.json block, clipboard or no clipboard', async () => {
  const piece = fromSong(song('let-it-be'));
  const melody = writeMelody(piece, 'rh', 4);

  const blocked = await copyMelody(melody);      // node: navigator has no clipboard
  assert.equal(blocked.ok, false);
  const parsed = JSON.parse(blocked.text);
  const key = Object.keys(parsed)[0];
  assert.match(key, /^[a-z0-9-]+$/, 'keyed the way tracks.json keys a melody');
  assert.deepEqual(parsed[key], melody);

  const written = [];
  Object.defineProperty(globalThis, 'navigator', {
    value: { clipboard: { writeText: async t => { written.push(t); } } },
    configurable: true,
  });
  const copied = await copyMelody(melody, 'my-line');
  assert.equal(copied.ok, true);
  assert.equal(written.length, 1);
  assert.deepEqual(JSON.parse(written[0]), { 'my-line': melody });
});

test('posting a song sends the file text, and answers rather than throwing', async () => {
  const doc = writeSong(fromSong(song('perfect')));
  const seen = [];
  const realFetch = globalThis.fetch;

  globalThis.fetch = async (url, opts) => {
    seen.push({ url, opts });
    return { ok: false, status: 409, text: async () => '{"ok":false,"reason":"already there"}' };
  };
  const clash = await postSong(doc);
  assert.equal(seen[0].url, '/songs/perfect.json');
  assert.equal(seen[0].opts.method, 'POST');
  assert.deepEqual(JSON.parse(seen[0].opts.body), doc, 'the body is the song file itself');
  assert.deepEqual(clash, { ok: false, status: 409, text: '{"ok":false,"reason":"already there"}' },
    'an HTTP error is an answer, not an exception');

  globalThis.fetch = async url => {
    seen.push({ url });
    return { ok: true, status: 201, text: async () => '{"ok":true}' };
  };
  const ok = await postSong(doc, { overwrite: true });
  assert.equal(seen[1].url, '/songs/perfect.json?overwrite=1');
  assert.equal(ok.status, 201);

  globalThis.fetch = async () => { throw new TypeError('failed to fetch'); };
  const offline = await postSong(doc);
  assert.equal(offline.ok, false, 'no server at all is still an answer');
  assert.equal(offline.status, 0);

  globalThis.fetch = realFetch;
});
