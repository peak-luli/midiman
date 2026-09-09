// Getting a piece out of the composer: the draft that survives a reload, and the three
// ways out described in the architecture doc -- a download you drop into `songs/`, a
// melody on the clipboard, and the POST that asks `serve.py` to write the file itself.
//
// Nothing here understands music except `guessKey`, which fills the one header field a
// pianist should not have to think about. The server understands even less: the page
// has already written the bars and can `parseSong` them back, so a file that arrives
// is a file that plays.
//
// Every browser-only step is guarded rather than assumed: these functions are imported
// under `node --test` along with the rest of the module graph, where there is no
// document, no clipboard and, in a private window, no localStorage either.

import { songText } from './write.js';

export const DRAFT_KEY = 'middleman.composer.draft';

/** The piece the composer was last holding, or null when there is none to be had. */
export function loadDraft() {
  try { return JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); }
  catch { return null; }              // private mode, or a draft we cannot read
}

/** Keep the piece for the next visit. False when the browser would not have it. */
export function saveDraft(piece) {
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify(piece)); return true; }
  catch { return false; }             // quota, or private mode
}

export function clearDraft() {
  try { localStorage.removeItem(DRAFT_KEY); } catch { /* nothing to clear */ }
}

// ---------------------------------------------------------------- names
/**
 * A file name from a title: lower case, letters, digits and single dashes. Accents are
 * folded first, so "Café" is `cafe` rather than `caf`. The id is what `songs/<id>.json`
 * is called and what the Learn page's progress is filed under, so it has to be the
 * plainest possible spelling of the title.
 */
export const slugOf = (title = '') =>
  String(title).normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’`]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'untitled';

// ---------------------------------------------------------------- the key signature
// The fifteen major signatures, easiest first: C, then one sharp and one flat, then
// two of each, and so on. `n` is the position on the circle of fifths, which is both
// the number of accidentals and -- times seven, modulo twelve -- the tonic's pitch
// class. Keys that sound the same (C#/Db, F#/Gb, B/Cb) are all here because a song
// file has to pick one, and this order picks the one with less to write down.
const KEYS = [
  ['C', 0], ['G', 1], ['F', -1], ['D', 2], ['Bb', -2], ['A', 3], ['Eb', -3], ['E', 4],
  ['Ab', -4], ['B', 5], ['Db', -5], ['F#', 6], ['Gb', -6], ['C#', 7], ['Cb', -7],
];
const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const mod12 = x => ((x % 12) + 12) % 12;

/**
 * The signature that fits the notes best: the one whose scale covers most of what was
 * played, counting every note, and where two do equally well the one with fewer sharps
 * or flats. It is a guess and the Save form says so -- the pianist can change it, and a
 * piece that came out of a song file keeps the key the file already chose.
 */
export function guessKey(notes = []) {
  const count = new Array(12).fill(0);
  for (const x of notes) {
    const n = typeof x === 'number' ? x : x?.n;
    if (Number.isFinite(n)) count[mod12(n)]++;
  }
  let best = null, bestScore = -1;
  for (const [key, n] of KEYS) {
    const tonic = mod12(7 * n);
    let score = 0;
    for (const step of MAJOR) score += count[mod12(tonic + step)];
    if (score > bestScore) { bestScore = score; best = { key, sharps: n > 0 }; }
  }
  return best;
}

/**
 * What the Save-as-sheet form opens with. The title is the one thing a piece cannot
 * guess; everything else follows from it or from the notes -- an id from the title, a
 * practice tempo at 60 % of the real one, and the key, kept when the piece came from a
 * song file and guessed when it came from the piano.
 */
export function sheetDefaults(piece) {
  const title = piece?.title || 'Untitled';
  const bpm = piece?.bpm > 0 ? piece.bpm : 90;
  const { key, sharps } = piece?.key
    ? { key: piece.key, sharps: !!piece.sharps }
    : guessKey(piece?.notes ?? []);
  // a piece that came from a song file keeps the practice tempo the file chose
  const practiceBpm = piece?.practiceBpm > 0 ? piece.practiceBpm : Math.round(bpm * 0.6);
  return { id: slugOf(title), title, key, sharps, practiceBpm };
}

// ---------------------------------------------------------------- the ways out
/**
 * The song file as a download, named after its id. Returns the text either way, so the
 * page can show it (and a test can read it) where there is no document to click.
 */
export function downloadSong(doc) {
  const text = songText(doc);
  const name = `${doc?.id || 'song'}.json`;
  if (typeof document === 'undefined' || typeof URL?.createObjectURL !== 'function')
    return { ok: false, name, text };
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  return { ok: true, name, text };
}

/**
 * A melody on the clipboard, keyed the way `tracks.json` keys its melodies -- paste it
 * into the `melodies` block and name it from a track. Same shape and same fallback as
 * the Looper's Copy lane as melody: when the clipboard says no, the text comes back
 * anyway and the page can put it on the console.
 */
export async function copyMelody(melody, key = slugOf(melody?.name ?? 'melody')) {
  const text = JSON.stringify({ [key]: melody }, null, 2);
  try {
    await globalThis.navigator.clipboard.writeText(text);
    return { ok: true, text };
  } catch {
    return { ok: false, text };       // no clipboard, or permission refused
  }
}

/**
 * Hand the file to the local server, which writes it into `songs/` and adds it to the
 * index. An existing file comes back 409 until `overwrite` is set, which is what turns
 * the page's Save into "Replace?" rather than a silent clobber.
 *
 * It resolves for every answer, including no answer at all: the composer runs off a
 * plain file:// page too, where there is no server to post to, and that is a sentence
 * on screen rather than an exception in the console.
 */
export async function postSong(doc, { overwrite = false } = {}) {
  const url = `/songs/${doc?.id}.json${overwrite ? '?overwrite=1' : ''}`;
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: songText(doc),
    });
    return { ok: r.ok, status: r.status, text: await r.text() };
  } catch (e) {
    return { ok: false, status: 0, text: e?.message ?? 'no server answered' };
  }
}
