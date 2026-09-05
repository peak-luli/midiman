// The lesson plan: the sequence of steps the tutor walks you through for a song.
//
// Each section is learned the same way -- hear it, find the notes of each hand at
// your own pace, play each hand in time, put the hands together slowly, then bring
// it up to speed. Every few sections a "join" step plays what you have so far as one
// piece, so the song grows in phrases rather than staying a pile of fragments.
//
// A step is data: what bars, which hands you play, which hands the app plays,
// whether the clock waits for you, the tempo, and what counts as passing.
//
// Two sentences come with every step, and they are not the same sentence. `text` is
// the panel's: it has room to explain, and it sits there for as long as you are on
// the step. `coach` is the one said out loud at the boundaries -- when the step is
// loaded, and again on the card that hands you the next one -- so it is short enough
// to read with your hands already on the keys. A section may put its own words on its
// listening step (`coach` in the song), which is how the Intro can say why the vamp
// matters before you have played a note of it.

/** How the app treats each hand in a step: you play it, the app plays it, or it is silent. */
export const YOU = 'you', APP = 'app', OFF = 'off';

export const PASS_ACCURACY = 0.85;     // fraction of expected notes hit, per pass
export const PASS_STREAK = 2;          // consecutive passes at that level to move on

export function buildPlan(song) {
  const steps = [];
  // three tempo tiers; each step names its own, so a tempo you set by hand can be
  // remembered for the tier rather than guessed back from the bpm (see tempo.js)
  const slow = song.practiceBpm, mid = Math.round(song.bpm * 0.8), full = song.bpm;
  const hasRh = song.rh.length > 0, hasLh = song.lh.length > 0;

  song.sections.forEach((sec, si) => {
    const base = { section: si, from: sec.from, to: sec.to };
    const inSec = h => song[h].some(n => n.bar >= sec.from && n.bar <= sec.to);
    const rh = hasRh && inSec('rh'), lh = hasLh && inSec('lh');

    const bars = `bars ${sec.from + 1}–${sec.to + 1}`;

    steps.push({ ...base, kind: 'listen', title: 'Listen', bpm: slow, tier: 'slow',
      lh: APP, rh: APP, wait: false, passes: 1,
      text: `Hear bars ${sec.from + 1}–${sec.to + 1} slowly, both hands. ${sec.hint}`,
      coach: sec.coach ? `Hands in your lap — just listen. ${sec.coach}`
        : `Hands in your lap — just listen. ${cap(bars)}, both hands, at ${slow} bpm.` });

    for (const [hand, name] of [['lh', 'left hand'], ['rh', 'right hand']]) {
      if (!(hand === 'lh' ? lh : rh)) continue;
      const other = hand === 'lh' ? 'rh' : 'lh';
      steps.push({ ...base, kind: 'notes', title: `${cap(name)}: find the notes`, bpm: slow, tier: 'slow',
        [hand]: YOU, [other]: OFF, wait: true, passes: 1,
        text: `No clock. The next notes to play light up on the keys and on the roll; ` +
              `the song moves on when you have played them. Take all the time you want.`,
        coach: `No clock, no rush. Play the lit ${name} notes and the song waits for you.` });
      steps.push({ ...base, kind: 'hand', title: `${cap(name)} in time`, bpm: slow, tier: 'slow',
        [hand]: YOU, [other]: OFF, wait: false, passes: PASS_STREAK,
        text: `Same notes, now with the click at ${slow} bpm, looping. ` +
              `Two passes with ${Math.round(PASS_ACCURACY * 100)}% of the notes in time and you're through.` ,
        coach: `${cap(name)} alone, with the click at ${slow}. ${PASS_STREAK} passes at `
             + `${Math.round(PASS_ACCURACY * 100)}% and the step is yours.` });
    }

    if (rh && lh) {
      steps.push({ ...base, kind: 'both', title: 'Hands together, slowly', bpm: slow, tier: 'slow',
        lh: YOU, rh: YOU, wait: false, passes: PASS_STREAK,
        text: `Both hands at ${slow} bpm. If it falls apart, drop the tempo further with the slider; ` +
              `the step still counts.`,
        coach: `Both hands at ${slow} bpm. Slow enough to be right — drop it further if you need to.` });
      steps.push({ ...base, kind: 'both', title: 'Hands together, faster', bpm: mid, tier: 'mid',
        lh: YOU, rh: YOU, wait: false, passes: PASS_STREAK,
        text: `Up to ${mid} bpm.`,
        coach: `The same ${bars}, now at ${mid} bpm. Keep the feel, not just the notes.` });
    }

    // every second section, play everything learned so far in one go
    if (si > 0 && (si % 2 === 1 || si === song.sections.length - 1)) {
      const from = song.sections[Math.max(0, si - (si % 2 === 1 ? 1 : 2))].from;
      steps.push({ section: si, from, to: sec.to, kind: 'join', title: 'Join the sections', bpm: mid, tier: 'mid',
        lh: rh && lh ? YOU : (lh ? YOU : OFF), rh: rh ? YOU : OFF, wait: false, passes: 1,
        text: `Bars ${from + 1}–${sec.to + 1} as one piece, at ${mid} bpm. One pass through is enough here; ` +
              `this is about the seams between sections.`,
        coach: `Bars ${from + 1}–${sec.to + 1} in one go, at ${mid} bpm. The seams are the point.` });
    }
  });

  steps.push({ section: song.sections.length - 1, from: 0, to: song.nbars - 1, kind: 'song',
    title: 'The whole song', bpm: full, tier: 'full', lh: YOU, rh: YOU, wait: false, passes: 1,
    text: `All ${song.nbars} bars at ${full} bpm. Play it through.`,
    coach: `Everything you have learned, at ${full} bpm. Play it through.` });

  // `passes` is how many clean passes in a row the step wants; the challenge is
  // the same thing in the shape the meter and free practice share
  return steps.map((s, i) => ({ ...s, id: i, challenge: { kind: 'passes', n: s.passes, accuracy: PASS_ACCURACY } }));
}

const cap = s => s[0].toUpperCase() + s.slice(1);

/**
 * How the phone's lesson path draws one step: ticked, the one you are on, or still
 * ahead. Done wins over current, because a step you have passed and come back to is
 * still passed -- and the mark is what says so at a glance from the music stand.
 */
export function nodeState(step, i, si, doneIds) {
  const done = doneIds.has(step.id), cur = i === si;
  return { done, cur, mark: done ? '✓' : cur ? '▸' : '' };
}

/** Where a step sits in the plan, for the progress line: "step 4 of 31". */
export function progress(plan, doneIds) {
  const done = plan.filter(s => doneIds.has(s.id)).length;
  return { done, total: plan.length, pct: plan.length ? done / plan.length : 0 };
}
