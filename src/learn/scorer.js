// Matching what you played against what the score asks for.
//
// The expected notes of a pass are the onsets of the hands you are playing, inside
// the loop, at their swung positions. A played note-on counts as a hit when an
// expected note of the same pitch has its onset within WINDOW beats of it and has
// not already been claimed. Anything else you play is an extra; anything expected
// that nobody claimed by the time its window closes is a miss. A note the transport
// was seeked past is `skipped`: it leaves the pass entirely rather than counting
// against you for music you never had the chance to play.
//
// Everything here is in beats, not milliseconds, so the same tolerance is more
// forgiving at slow tempos in absolute time -- which is what you want while
// learning -- and tightens as the tempo comes up.

export const WINDOW = 0.28;       // beats either side of an onset

/**
 * Expected onsets for a hand set inside [from, to] bars:
 * { b, n, hand, len, note, hit, missed, skipped }. `skipped` is set when the
 * transport is seeked past a note -- it is then neither a hit nor a miss.
 */
export function expectedOf(song, from, to, hands, swung) {
  const out = [];
  for (const hand of hands) {
    for (const note of song[hand]) {
      if (note.bar < from || note.bar > to) continue;
      out.push({ b: swung(note.b), n: note.n, hand, len: note.len, hit: null, missed: false, skipped: false, note });
    }
  }
  return out.sort((a, b) => a.b - b.b || a.n - b.n);
}

/**
 * A live tally for one pass. `expected` is the list above with `b` relative to
 * the loop start. Feed it note-ons with their beat position inside the loop.
 */
export function makeTally(expected, wrap = Infinity) {
  const extras = [];
  let hits = 0;

  return {
    expected, extras,
    get hits() { return hits; },

    /** Try to claim an expected note for a played one. Returns the note hit, or null. */
    onNote(n, beat) {
      let best = null, bd = WINDOW + 1e-9;
      for (const e of expected) {
        if (e.n !== n || e.hit || e.skipped) continue;
        // a note just before the loop wraps can be an early hit on the loop's first onset
        const d = Math.min(Math.abs(e.b - beat), Math.abs(e.b - (beat - wrap)));
        if (d < bd) { bd = d; best = e; }
        if (e.b - beat > WINDOW && e.b - (beat - wrap) > WINDOW) break;
      }
      if (best) { const off = Math.abs(beat - best.b) <= WINDOW ? beat - best.b : beat - wrap - best.b;
        best.hit = { beat, off }; hits++; return best; }
      extras.push({ n, beat });
      return null;
    },

    /** Expected notes whose window has closed without a hit. */
    missesBefore(beat) {
      return expected.filter(e => !e.hit && !e.skipped && e.b + WINDOW < beat);
    },

    /**
     * Take the unplayed notes in [from, to) out of this pass: the transport jumped
     * over them, so they were never yours to play. They are neither hits nor misses,
     * and the pass total shrinks by that many.
     */
    skip(from, to) {
      for (const e of expected)
        if (!e.hit && e.b >= from && e.b < to) { e.skipped = true; e.missed = false; }
    },

    /**
     * Put the notes in [from, to) back up for scoring: the transport jumped *back*
     * over them, so that stretch is being played again. Returns what it un-scored,
     * for the views to clear.
     */
    reset(from, to) {
      const out = [];
      for (const e of expected) {
        if (e.b < from || e.b >= to || (!e.hit && !e.missed && !e.skipped)) continue;
        if (e.hit) hits--;
        e.hit = null; e.missed = false; e.skipped = false;
        out.push(e);
      }
      return out;
    },

    result() {
      const skipped = expected.filter(e => e.skipped).length;
      const total = expected.length - skipped;
      // empty is 0, not 1: a wrap with nothing to score must not read as 100%
      // and then fail the 85% challenge (the lying "100%, needs 85%" copy)
      const accuracy = total ? hits / total : 0;
      const offs = expected.filter(e => e.hit).map(e => e.hit.off);
      const early = offs.filter(o => o < -0.08).length, late = offs.filter(o => o > 0.08).length;
      return { total, hits, misses: total - hits, extras: extras.length, skipped, accuracy, early, late,
               spread: offs.length ? Math.sqrt(offs.reduce((s, o) => s + o * o, 0) / offs.length) : 0 };
    },
  };
}

/**
 * A pass counts on accuracy alone: the share of expected notes that were hit.
 * Extras are reported, never penalised -- on a real piano most of them are the
 * other hand, a pedal re-trigger, an octave or a grace note, not mistakes.
 *
 * An empty pass (nothing left to score) only counts when the step asked for
 * nothing: listening uses minAccuracy 0, because none of the notes are yours.
 * A play step at 85% must not treat a skipped-all or never-armed wrap as a hit
 * -- that is how find-a-note used to jump while the player was still hunting.
 */
export function passed(result, minAccuracy) {
  if (!result.total) return minAccuracy <= 0;
  return result.accuracy >= minAccuracy;
}

/**
 * Sort a pass's extras into notes that belong to a hand the app kept silent --
 * played at the right moment for that part -- and genuinely wrong notes. `other`
 * is expectedOf() for the silent hands, with `b` relative to the loop like the
 * extras; `wrap` lets a note just before the loop end match the next loop's start.
 */
export function splitExtras(extras, other, wrap = Infinity) {
  const outside = [], wrong = [];
  for (const x of extras) {
    const near = other.some(e => e.n === x.n
      && (Math.abs(e.b - x.beat) <= WINDOW || Math.abs(e.b - (x.beat - wrap)) <= WINDOW));
    (near ? outside : wrong).push(x);
  }
  return { outside, wrong };
}

/**
 * Group expected notes by onset for wait mode: each group is the set of pitches
 * that has to be down before the cursor moves on.
 */
export function groupsOf(expected) {
  const groups = [];
  for (const e of expected) {
    const g = groups[groups.length - 1];
    if (g && Math.abs(g.b - e.b) < 1e-6) g.notes.push(e);
    else groups.push({ b: e.b, notes: [e] });
  }
  return groups;
}

/**
 * Progress inside a pass, while it is still running: of the notes that have come
 * due so far (their window closed, or they were hit early), how many were hit.
 * `due` is 0 at the top of the loop, so the percentage settles as the pass goes.
 *
 * `beat` is the playhead inside the loop. When it is given, a note whose window
 * has already closed counts as due even if nobody has set `missed` yet -- the
 * engine marks those on its own tick, but the phone's mirror can drop a `miss`
 * and the meter used to freeze on the opening hits. Without `beat`, only the
 * flags are read, so a unit test that sets `missed` by hand still holds.
 */
export function liveOf(tally, beat) {
  if (!tally) return { hits: 0, due: 0, total: 0, pct: 0, extras: 0 };
  const at = Number.isFinite(beat) ? beat : null;
  let due = 0, hits = 0, total = 0;
  for (const e of tally.expected) {
    if (e.skipped) continue;                   // jumped over: not due, never counted
    total++;
    const closed = at != null && e.b + WINDOW < at;
    if (e.hit) { hits++; due++; } else if (e.missed || closed) due++;
  }
  return { hits, due, total, extras: tally.extras.length, pct: due ? hits / due : 0 };
}

/**
 * A sliding-window challenge: the hit rate over everything that came due in the
 * last `seconds`. `hist` is a list of { t, k } with k one of hit | miss | extra,
 * in time order. Extras are reported but do not count against the rate.
 */
export function windowStats(hist, now, seconds) {
  const from = now - seconds * 1000;
  let hits = 0, misses = 0, extras = 0;
  for (let i = hist.length - 1; i >= 0 && hist[i].t >= from; i--) {
    const k = hist[i].k;
    if (k === 'hit') hits++; else if (k === 'miss') misses++; else extras++;
  }
  const due = hits + misses;
  return { hits, misses, extras, due, pct: due ? hits / due : 0 };
}

/** The challenge a step or a practice loop sets. */
export const CHALLENGES = {
  none:   { kind: 'none', label: 'no challenge' },
  passes: { kind: 'passes', n: 2, accuracy: 0.85, label: '2 passes in a row at 85%' },
  window: { kind: 'window', seconds: 10, accuracy: 0.8, minDue: 8, label: '80% over the last 10 s' },
};
