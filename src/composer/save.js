// PLACEHOLDER. The real save module is being written in parallel and replaces this
// file wholesale; nothing here is meant to survive. It exists only so the composer
// page runs and `npm test` links: every export is the name and signature the module
// contract fixes, implemented in the fewest honest lines, and the page must not lean
// on anything beyond them.
//
// The one that lands does the same jobs properly -- a real key guess, the download
// named and dated, the POST's errors read back in English.

import { songText } from './write.js';

export const DRAFT_KEY = 'middleman.composer.draft';

export function loadDraft() {
  try { const raw = localStorage.getItem(DRAFT_KEY); return raw ? JSON.parse(raw) : null; }
  catch { return null; }
}

export function saveDraft(piece) {
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify(piece)); return true; }
  catch { return false; }        // no storage, or the quota is full
}

export function clearDraft() {
  try { localStorage.removeItem(DRAFT_KEY); } catch { /* nothing to clear */ }
}

/** The song file as a download, named after its id. */
export function downloadSong(doc) {
  const url = URL.createObjectURL(new Blob([songText(doc)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${doc.id || 'song'}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** A `tracks.json` melody entry on the clipboard, as the looper's copy button does. */
export async function copyMelody(melody) {
  const text = JSON.stringify(melody, null, 2);
  try { await navigator.clipboard.writeText(text); return true; }
  catch { console.log(text); return false; }
}

/** POST the song into `songs/`. The dev server owns the side effect; this reads it back. */
export async function postSong(doc, { overwrite = false } = {}) {
  const url = `/songs/${doc.id}.json${overwrite ? '?overwrite=1' : ''}`;
  try {
    const res = await fetch(url, { method: 'POST', body: songText(doc) });
    return { ok: res.ok, status: res.status, text: await res.text() };
  } catch (e) {
    return { ok: false, status: 0, text: e.message };
  }
}

export const slugOf = title => (title || 'untitled')
  .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'untitled';

/** Naive on purpose: the real module counts accidentals over the pitches present. */
export function guessKey(_notes) {
  return { key: 'C', sharps: false };
}

export function sheetDefaults(piece) {
  const g = guessKey(piece?.notes ?? []);
  return {
    id: piece?.id && piece.id !== 'untitled' ? piece.id : slugOf(piece?.title),
    title: piece?.title ?? '',
    key: piece?.key ?? g.key,
    sharps: piece?.sharps ?? g.sharps,
    practiceBpm: piece?.practiceBpm ?? Math.round((piece?.bpm ?? 90) * 0.6),
  };
}
