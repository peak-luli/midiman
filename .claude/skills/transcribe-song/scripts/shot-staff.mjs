#!/usr/bin/env node
// Screenshots of the Learn page's staff, a few bars at a time, so a transcription
// can be held against the printed score with your own eyes.
//
// A transcription that parses can still be wrong in ways only the engraving shows:
// a beam group that reads as a triplet, a tie the notation dropped, a chord an
// octave out. The shots are of the real staff pane the pianist reads -- serve.py
// serving this repo, Chromium on learn.html -- not of a re-drawn approximation.
//
//   node .claude/skills/transcribe-song/scripts/shot-staff.mjs \
//        --song city-of-stars --bars 1-59 --per 4 --out /tmp/shots
//
//   --song    song id (default: the first in songs/index.json)
//   --bars    range, 1-based inclusive (default: the whole song)
//   --per     bars per shot (default 4; 2 when you are checking pitches closely)
//   --out     directory for the PNGs (default: the current directory)
//   --prefix  file name prefix (default "staff")
//   --beams   override the song's beaming for this run only ("beat" / "half")
//   --port    port for serve.py (default 8850)
//   --root    repo root, if this skill is not inside it
//
// Writes <out>/<prefix>-<from>-<to>.png, one per window. Read them: that is the
// point of the script, and nothing downstream checks them for you.

import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { args, barRange, withStaff } from './lib/staff-session.mjs';

const opt = args();
const SONG = opt('song', null);
const PER = Number(opt('per', 4));
const OUT = resolve(String(opt('out', '.')));
const PREFIX = String(opt('prefix', 'staff'));

const song = SONG ?? 'city-of-stars';
await withStaff({ song, root: opt('root', null) || undefined, port: Number(opt('port', 8850)),
                  beams: opt('beams', null) || null }, async d => {
  console.log(`${d.info.id}: ${d.info.nbars} bars, beams=${d.info.beams}`);
  const [from, to] = barRange(opt('bars', null), d.info.nbars);
  mkdirSync(OUT, { recursive: true });
  for (let a = from; a <= to; a += PER) {
    const b = Math.min(to, a + PER - 1);
    await d.over(a, b);
    const file = join(OUT, `${PREFIX}-${a}-${b}.png`);
    await d.shot(file);
    console.log(`bars ${a}-${b} -> ${file}`);
  }
  if (d.warnings.length) {
    console.log(`\n${d.warnings.length} page warnings (run check-pairing.mjs for these):`);
    for (const w of [...new Set(d.warnings)].slice(0, 10)) console.log(`  ${w}`);
  }
});
