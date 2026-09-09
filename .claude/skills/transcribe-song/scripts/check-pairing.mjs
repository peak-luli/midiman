#!/usr/bin/env node
// The engraving gate: every bar of the song must engrave with one glyph per cell.
//
// The staff view pairs what abcjs engraved with the song's own cells so it can move
// each note onto the time grid and colour it. When the counts disagree it gives up
// on that voice and says so:
//
//     staff: voice 0 has 9 engraved elements for 8 cells
//
// which means the ABC the notation built from the bar did not come out as the bar
// says it is -- a tie the engraver split, a duration it could not express, a tuplet
// it re-grouped. The notes may still sound right, so no test catches it; the reader
// gets a staff with the highlighting silently switched off. Zero warnings over the
// whole song is the bar to clear.
//
//   node .claude/skills/transcribe-song/scripts/check-pairing.mjs --song city-of-stars
//
//   --song / --bars / --per / --beams / --port / --root   as in shot-staff.mjs
//
// Exits non-zero if the page said anything at all, and names the ranges it said it
// in, so the bar to look at is in the output.

import { args, barRange, withStaff } from './lib/staff-session.mjs';

const opt = args();
const PER = Number(opt('per', 4));
const song = String(opt('song', null) || 'city-of-stars');

const bad = await withStaff({ song, root: opt('root', null) || undefined,
                              port: Number(opt('port', 8850)),
                              beams: opt('beams', null) || null }, async d => {
  const [from, to] = barRange(opt('bars', null), d.info.nbars);
  console.log(`${d.info.id}: ${d.info.nbars} bars, beams=${d.info.beams}; checking ${from}-${to} in ${PER}s`);
  const found = [];
  for (let a = from; a <= to; a += PER) {
    const b = Math.min(to, a + PER - 1);
    const before = d.warnings.length;
    await d.over(a, b);
    for (const w of d.warnings.slice(before)) found.push(`bars ${a}-${b}: ${w}`);
  }
  return found;
});

if (bad.length) {
  console.log(`\n${bad.length} warnings:`);
  for (const w of bad) console.log(`  ${w}`);
  console.log('\nA pairing warning is a bar whose written text and engraving disagree.');
  console.log('Screenshot that range (shot-staff.mjs --per 1) and compare it with the score.');
  process.exit(1);
}
console.log('\nOK: every bar engraves one element per cell, and the page said nothing.');
