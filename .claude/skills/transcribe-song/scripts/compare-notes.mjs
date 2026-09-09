#!/usr/bin/env node
// Did the sound change, or only the writing?
//
// Rewriting a transcription "as written" changes almost every bar's text -- an
// eighth tied over the beat replaces a syncopated quarter, and so on -- while the
// music is meant to stay exactly as it was in every bar you did not deliberately
// correct. Reading 59 bars of diff cannot tell those apart. This can: it parses both
// versions, resolves the ties, and compares the flat note lists bar by bar. What
// comes out is the classification to review against the score:
//
//   SAME          the bar's text is byte-identical
//   DISPLAY-ONLY  the text changed, the notes sounded are identical
//   SOUND-DIFF    the notes changed -- this bar had better be one you meant
//
// (The fourth class, UNSURE, is yours: a SOUND-DIFF you cannot settle from the
// score. Mark it in your own notes and go back to the crop.)
//
//   node .claude/skills/transcribe-song/scripts/compare-notes.mjs \
//        --old HEAD --new songs/city-of-stars.json --expect 18,28,29,30,33,41,42,46,56 --table
//
//   --old     a file, a git ref (the same path is read from it), or ref:path
//   --new     the file as it is now (default: the working-tree copy of --old's path)
//   --expect  bar numbers you intend to have changed in sound; the run fails if the
//             set that actually changed is not exactly this one
//   --table   print the per-bar classification, not just the differences
//
// With --expect this is a gate: an unexpected SOUND-DIFF is a bar you broke while
// rewriting, and an expected bar that did not change is a correction you dropped.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { args, repoRoot } from './lib/staff-session.mjs';

const opt = args();
const ROOT = repoRoot(opt('root', null) || undefined);
const { parseSong } = await import(new URL('src/song.js', `file://${ROOT}/`).href);

const oldSpec = String(opt('old', 'HEAD'));
const newPath = resolve(String(opt('new', null) || (oldSpec.includes(':') ? oldSpec.split(':')[1] : '')));
if (!opt('new', null) && !oldSpec.includes(':')) {
  console.error('need --new <file> (or an --old of the form <ref>:<path>)');
  process.exit(2);
}
const rel = relative(ROOT, newPath);

function load(spec) {
  if (spec.includes(':')) {
    const [ref, path] = [spec.slice(0, spec.indexOf(':')), spec.slice(spec.indexOf(':') + 1)];
    return JSON.parse(execFileSync('git', ['-C', ROOT, 'show', `${ref}:${path}`], { encoding: 'utf8' }));
  }
  try { return JSON.parse(readFileSync(spec, 'utf8')); }
  catch { return JSON.parse(execFileSync('git', ['-C', ROOT, 'show', `${spec}:${rel}`], { encoding: 'utf8' })); }
}

const warns = [];
const realWarn = console.warn;
console.warn = (...a) => warns.push(a.join(' '));
const oldDoc = load(oldSpec);
const newDoc = JSON.parse(readFileSync(newPath, 'utf8'));
const A = parseSong(oldDoc), B = parseSong(newDoc);
console.warn = realWarn;

// what a note *is*, for comparison: when it starts, how long it sounds, which pitch,
// and whether it is rolled. Everything else is writing.
const key = n => `${n.hand} b=${+n.b.toFixed(6)} len=${+n.len.toFixed(6)} n=${n.n} roll=${n.roll}`;
const byBar = song => {
  const m = new Map();
  for (const n of song.notes) (m.get(n.bar) ?? m.set(n.bar, []).get(n.bar)).push(key(n));
  for (const v of m.values()) v.sort();
  return m;
};
const a = byBar(A), b = byBar(B);
const nbars = Math.max(A.nbars, B.nbars);

const rows = [];
for (let i = 0; i < nbars; i++) {
  const ka = a.get(i) ?? [], kb = b.get(i) ?? [];
  const ca = new Map(), cb = new Map();
  for (const k of ka) ca.set(k, (ca.get(k) ?? 0) + 1);
  for (const k of kb) cb.set(k, (cb.get(k) ?? 0) + 1);
  const only = (x, y) => [...x].flatMap(([k, c]) => Array(Math.max(0, c - (y.get(k) ?? 0))).fill(k));
  const gone = only(ca, cb), came = only(cb, ca);
  // a bar reads best as one line when nothing moved, and as old -> new when it did
  const text = h => {
    const o = (oldDoc[h] ?? [])[i] ?? '', n = (newDoc[h] ?? [])[i] ?? '';
    return o === n ? o : `${o}   ->   ${n}`;
  };
  const sameText = ['rh', 'lh'].every(h => (oldDoc[h] ?? [])[i] === (newDoc[h] ?? [])[i]);
  rows.push({ bar: i + 1, gone, came, na: ka.length, nb: kb.length,
              cls: gone.length || came.length ? 'SOUND-DIFF' : sameText ? 'SAME' : 'DISPLAY-ONLY',
              rh: text('rh'), lh: text('lh') });
}

const count = c => rows.filter(r => r.cls === c).length;
console.log(`old  ${oldSpec}: ${A.nbars} bars, ${A.notes.length} notes`);
console.log(`new  ${rel}: ${B.nbars} bars, ${B.notes.length} notes`);
console.log(`SAME ${count('SAME')} · DISPLAY-ONLY ${count('DISPLAY-ONLY')} · SOUND-DIFF ${count('SOUND-DIFF')}`);

if (opt('table', false)) {
  console.log('\nbar  class          rh   ||   lh      (old -> new where they differ)');
  for (const r of rows)
    console.log(`${String(r.bar).padStart(3)}  ${r.cls.padEnd(13)}  ${r.rh}   ||   ${r.lh}`);
}

const changed = rows.filter(r => r.cls === 'SOUND-DIFF');
if (changed.length) console.log('');
for (const r of changed) {
  console.log(`--- bar ${r.bar}  (attacks ${r.na} -> ${r.nb})`);
  for (const g of r.gone) console.log(`    - ${g}`);
  for (const g of r.came) console.log(`    + ${g}`);
}

if (warns.length) console.log(`\nparser warnings: ${JSON.stringify(warns)}`);

const expectRaw = opt('expect', null);
if (expectRaw === null || expectRaw === true) {
  console.log(`\nsound changed in bars: ${changed.map(r => r.bar).join(', ') || '(none)'}`);
  console.log('Re-run with --expect <those bars> once you have checked each against the score.');
  process.exit(warns.length ? 1 : 0);
}
const want = new Set(String(expectRaw).split(/[,\s]+/).filter(Boolean).map(Number));
const got = new Set(changed.map(r => r.bar));
const unexpected = [...got].filter(x => !want.has(x));
const missing = [...want].filter(x => !got.has(x));
console.log(`\nunexpected changed bars: ${unexpected.join(', ') || 'none'}`);
console.log(`expected-but-unchanged:  ${missing.join(', ') || 'none'}`);
const ok = !unexpected.length && !missing.length && !warns.length;
console.log(ok ? `\nOK: ${nbars - got.size} of ${nbars} bars identical in sound, and the ${got.size} that `
                 + 'changed are exactly the ones you verified.'
               : '\nFAIL: the sound changed somewhere you did not intend, or a correction did not land.');
process.exit(ok ? 0 : 1);
