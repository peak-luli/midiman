#!/usr/bin/env node
// The parse gate, plus everything else about a song document that a machine can
// decide on its own.
//
// `parseSong` already refuses a bar that does not sum to the meter and names the
// hand and bar, which is the single most useful check there is -- a bar that does
// not sum is a bar you misread. But it only *warns* about a tie with nothing to tie
// to, and it says nothing about the things that make a song actually appear in the
// app: the id matching the file name, the file being listed in songs/index.json,
// the sections covering the piece, the coach lines being short enough for the tutor
// to say. This gathers all of it into one pass/fail.
//
//   node .claude/skills/transcribe-song/scripts/song-check.mjs                 # every song
//   node .claude/skills/transcribe-song/scripts/song-check.mjs songs/my.json   # just one
//
// Exits non-zero on any FAIL. Warnings that are judgement calls (a section with no
// hint, a song missing from the service worker's precache) print as WARN and do not
// fail the run -- decide those yourself.

import { readFileSync, readdirSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { repoRoot } from './lib/staff-session.mjs';

const raw = process.argv.slice(2);
const ri = raw.indexOf('--root');
const ROOT = repoRoot(ri >= 0 ? raw[ri + 1] : undefined);
// positionals are the songs to check; --root and its value are not among them
const argv = raw.filter((a, i) => !a.startsWith('--') && !(ri >= 0 && i === ri + 1));
const { parseSong } = await import(new URL('src/song.js', `file://${ROOT}/`).href);

const files = argv.length ? argv.map(f => resolve(f))
  : readdirSync(join(ROOT, 'songs')).filter(f => f.endsWith('.json') && f !== 'index.json')
      .map(f => join(ROOT, 'songs', f));

const index = JSON.parse(readFileSync(join(ROOT, 'songs', 'index.json'), 'utf8'));
let sw = '';
try { sw = readFileSync(join(ROOT, 'sw.js'), 'utf8'); } catch { /* no service worker */ }

let fails = 0;
for (const file of files) {
  const name = basename(file);
  const say = (level, msg) => { if (level === 'FAIL') fails++; console.log(`  ${level}  ${msg}`); };
  console.log(`\n${name}`);

  let doc, song;
  try { doc = JSON.parse(readFileSync(file, 'utf8')); }
  catch (e) { say('FAIL', `not valid JSON: ${e.message}`); continue; }

  // parseSong warns rather than throws for a dangling tie, so catch the warnings
  const warns = [];
  const realWarn = console.warn;
  console.warn = (...a) => warns.push(a.join(' '));
  try { song = parseSong(doc); }
  catch (e) { console.warn = realWarn; say('FAIL', e.message); continue; }
  console.warn = realWarn;

  say('ok  ', `parses: ${song.nbars} bars, ${song.meter}, key ${song.key}${song.sharps ? ' (sharps)' : ''}, `
    + `${song.notes.length} notes, bpm ${song.bpm}/${song.practiceBpm}, swing ${song.swing}`);
  if (warns.length) for (const w of warns) say('FAIL', `parser warning: ${w}`);
  else say('ok  ', 'no tie warnings (every ~ extends a note that was sounding)');

  // --- identity and registration: what makes the song show up at all
  if (doc.id !== name.replace(/\.json$/, ''))
    say('FAIL', `id "${doc.id}" does not match the file name "${name}"`);
  if (file.startsWith(join(ROOT, 'songs'))) {
    if (!index.songs.includes(name)) say('FAIL', `songs/index.json does not list ${name}`);
    else say('ok  ', `listed in songs/index.json at position ${index.songs.indexOf(name) + 1}`);
    if (sw && !sw.includes(`songs/${name}`))
      say('WARN', `sw.js does not precache songs/${name} -- it will not open offline`);
  }
  for (const k of ['title', 'bpm']) if (!doc[k]) say('FAIL', `missing "${k}"`);
  if (!doc.sub) say('WARN', 'no "sub" -- the catalog row will have no second line');
  if (!doc.credit) say('WARN', 'no "credit" -- say where the score came from');

  // --- sections: the tutor's plan is built from these
  const secs = song.sections;
  if (secs[0].from !== 0) say('FAIL', `first section starts at bar ${secs[0].from + 1}, not 1`);
  if (secs.at(-1).to !== song.nbars - 1)
    say('FAIL', `last section ends at bar ${secs.at(-1).to + 1}, not ${song.nbars}`);
  for (let i = 1; i < secs.length; i++)
    if (secs[i].from !== secs[i - 1].to + 1)
      say('FAIL', `sections "${secs[i - 1].name}" and "${secs[i].name}" leave a gap or overlap `
        + `at bars ${secs[i - 1].to + 1}/${secs[i].from + 1}`);
  for (const s of secs) {
    if (!s.hint) say('WARN', `section "${s.name}" has no hint`);
    if (s.coach && s.coach.length > 120)
      say('FAIL', `section "${s.name}" coach line is ${s.coach.length} chars (max 120)`);
  }
  if (secs.length > 1 || doc.sections) say('ok  ', `${secs.length} sections cover bars 1-${song.nbars}`);
  else say('WARN', 'no sections -- the tutor will treat the piece as one block');

  // --- shape: the numbers worth a second look before anyone plays it
  const empty = [];
  for (const hand of ['rh', 'lh'])
    doc[hand].forEach((t, i) => { if (!String(t).trim()) empty.push(`${hand} bar ${i + 1}`); });
  if (empty.length) say('FAIL', `empty bars: ${empty.join(', ')}`);
  const range = h => { const ns = song[h].map(n => n.n); return ns.length ? [Math.min(...ns), Math.max(...ns)] : null; };
  const [rlo, rhi] = range('rh') ?? [0, 0], [llo, lhi] = range('lh') ?? [0, 0];
  say('ok  ', `rh midi ${rlo}-${rhi}, lh midi ${llo}-${lhi}`
    + (llo && rlo && llo > rlo ? '   <- lh sits above rh: hands swapped?' : ''));
  if (rhi > 96 || llo < 21) say('WARN', 'a note is outside the 88-key range -- check the octave');
}

console.log(fails ? `\n${fails} FAIL(s)` : `\nOK: ${files.length} song(s) clean.`);
process.exit(fails ? 1 : 0);
