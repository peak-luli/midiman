// The other half of Save as sheet: serve.py's `POST /songs/<id>.json`, from the text
// the composer sends to the file on the disk and the line in the index.
//
// It runs the real server against a temporary folder -- serve.py serves whatever it is
// started in -- because the thing worth testing is the seam: the name in the URL, the
// bytes that land, the index that the Learn page reads next, and the two answers a
// pianist can actually get (409 "that one exists" and 400 "that is not a song").
// Nothing here is allowed to touch the repository's own `songs/`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { fromSong } from '../src/composer/piece.js';
import { writeSong, songText } from '../src/composer/write.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const sleep = ms => new Promise(r => setTimeout(r, ms));

const INDEX = {
  _comment: 'The songs the Learn page offers, in order. Each is a file in this folder; see README for the notation.',
  songs: ['city-of-stars.json'],
};

/** A throwaway checkout: a songs folder with an index, and nothing else. */
function scratch() {
  const dir = mkdtempSync(join(tmpdir(), 'midiman-songs-'));
  mkdirSync(join(dir, 'songs'));
  writeFileSync(join(dir, 'songs', 'index.json'),
    `{\n  "_comment": ${JSON.stringify(INDEX._comment)},\n  "songs": ${JSON.stringify(INDEX.songs)}\n}\n`);
  return dir;
}

/** serve.py on a free port, serving `dir` -- the folder is what it writes into. */
async function serve(port, dir) {
  const p = spawn('python3', [join(ROOT, 'serve.py'), String(port)],
    { cwd: dir, stdio: ['ignore', 'ignore', 'ignore'] });
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`http://127.0.0.1:${port}/relay/info`)).ok) break; } catch { /* not up */ }
    await sleep(100);
  }
  return { kill: () => p.kill('SIGKILL') };
}

const post = (port, name, body, q = '') =>
  fetch(`http://127.0.0.1:${port}/songs/${name}${q}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
  });

/** A real song, renamed, exactly as the composer would send it. */
function sheet(id) {
  const doc = writeSong(fromSong(JSON.parse(readFileSync(join(ROOT, 'songs', 'let-it-be.json'), 'utf8'))));
  return { ...doc, id, title: 'A New Song' };
}

const index = dir => JSON.parse(readFileSync(join(dir, 'songs', 'index.json'), 'utf8'));

test('a song posted from the composer lands in songs/ and in the index', async () => {
  const dir = scratch();
  const srv = await serve(8894, dir);
  try {
    const doc = sheet('a-new-song');
    const r = await post(8894, 'a-new-song.json', songText(doc));
    assert.equal(r.status, 201, 'a song that was not there is created');
    assert.deepEqual(await r.json(), { ok: true, path: 'songs/a-new-song.json', added: true });

    const written = readFileSync(join(dir, 'songs', 'a-new-song.json'), 'utf8');
    assert.equal(written, songText(doc), 'the bytes are the ones the page sent, formatting and all');
    assert.deepEqual(JSON.parse(written), doc);

    const idx = index(dir);
    assert.deepEqual(idx.songs, ['city-of-stars.json', 'a-new-song.json'], 'appended, in order');
    assert.equal(idx._comment, INDEX._comment, 'and the comment above it is left alone');

    // saving again is the one thing that must never happen quietly
    const again = await post(8894, 'a-new-song.json', songText({ ...doc, title: 'Something else' }));
    assert.equal(again.status, 409);
    assert.match((await again.json()).reason, /already there/);
    assert.equal(readFileSync(join(dir, 'songs', 'a-new-song.json'), 'utf8'), songText(doc),
      'and the file on the disk is untouched');

    const replaced = await post(8894, 'a-new-song.json',
      songText({ ...doc, title: 'Something else' }), '?overwrite=1');
    assert.equal(replaced.status, 200, 'overwriting an existing song is not a creation');
    assert.deepEqual(await replaced.json(),
      { ok: true, path: 'songs/a-new-song.json', added: false });
    assert.equal(JSON.parse(readFileSync(join(dir, 'songs', 'a-new-song.json'), 'utf8')).title,
      'Something else');
    assert.deepEqual(index(dir).songs, ['city-of-stars.json', 'a-new-song.json'],
      'and it is listed once, not twice');
  } finally { srv.kill(); rmSync(dir, { recursive: true, force: true }); }
});

test('the server refuses anything that is not a song at that name', async () => {
  const dir = scratch();
  const srv = await serve(8895, dir);
  try {
    const doc = sheet('a-new-song');

    const badName = await post(8895, 'Not A Song.json', songText(doc));
    assert.equal(badName.status, 400, 'a song id is lower case, digits and dashes');

    const escape = await post(8895, '..%2f..%2fserve.json', songText(doc));
    assert.equal(escape.status, 400, 'and nothing that could point out of songs/');

    const mismatch = await post(8895, 'other-name.json', songText(doc));
    assert.equal(mismatch.status, 400, 'the id in the file has to be the name of the file');
    assert.match((await mismatch.json()).reason, /calls itself/);

    const notJson = await post(8895, 'a-new-song.json', 'this is not json');
    assert.equal(notJson.status, 400);

    const noHands = await post(8895, 'a-new-song.json',
      JSON.stringify({ id: 'a-new-song', title: 'A New Song' }));
    assert.equal(noHands.status, 400, 'a song is two hands of bars');
    assert.match((await noHands.json()).reason, /rh/);

    assert.deepEqual(index(dir).songs, ['city-of-stars.json'], 'nothing was written or listed');
  } finally { srv.kill(); rmSync(dir, { recursive: true, force: true }); }
});

test('a songs folder that cannot be written says so, in one plain sentence', async () => {
  // no folder to write into: here because something else is sitting at that name, on
  // a laptop more likely because the app was started somewhere that is not a checkout
  const dir = mkdtempSync(join(tmpdir(), 'midiman-songs-'));
  writeFileSync(join(dir, 'songs'), 'not a folder\n');
  const srv = await serve(8896, dir);
  try {
    const r = await post(8896, 'a-new-song.json', songText(sheet('a-new-song')));
    assert.equal(r.status, 500);
    const body = await r.json();
    assert.equal(body.ok, false);
    assert.match(body.reason, /cannot write songs\//);
  } finally { srv.kill(); rmSync(dir, { recursive: true, force: true }); }
});

test('a read-only songs folder is the same answer, where the file system says so', async () => {
  const dir = scratch();
  chmodSync(join(dir, 'songs'), 0o555);
  const srv = await serve(8897, dir);
  try {
    const r = await post(8897, 'a-new-song.json', songText(sheet('a-new-song')));
    // root ignores the mode bits; then there is no refusal here to check
    if (r.status === 201) return;
    assert.equal(r.status, 500);
    assert.match((await r.json()).reason, /cannot write songs\//);
  } finally {
    srv.kill();
    chmodSync(join(dir, 'songs'), 0o755);
    rmSync(dir, { recursive: true, force: true });
  }
});
