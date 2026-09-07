// One writer per room, worked out at both ends from the same rule.
//
// The room belongs to the *machine* now: the server mints it into `certs/room` and
// answers `/relay/info` with it, so every origin and every restart gets the same id
// (see `pickRoom` in host.js). "Put it on the phone" is remembered too. Put those
// together and every Learn page a laptop has open -- a second tab, the same page on
// `localhost` and on the LAN address, a window left open since the morning -- arms
// itself into the one room and starts publishing snapshots into it.
//
// Nothing in the relay says which of them is the lesson: the phone applies whichever
// snapshot landed last. So a room with two writers in it shows a lesson that changes
// under the pianist's hands -- a step nobody is on, held for as long as it takes the
// other page to publish again, and back. Idle after Stop that is every half minute,
// because a resync makes every page in the room publish; mid-practice it is every
// pass. Both ends of the same bug.
//
// It is not a race worth winning: which page is on the phone is a fact somebody
// established, not something to guess from arrival order. So a page *claims* the
// room, and the claim rides on everything it publishes -- who published it (`by`, the
// relay client id) and when that page took the room (`since`, a wall clock stamp).
// `by` rather than the `from` a note already signs itself with, because `from` is
// spoken for inside a snapshot: there it is the first bar of the range.
//
// The newest claim owns the room, and each end acts on that alone:
//
//   the laptop   a page that hears a newer claim goes quiet -- no snapshots, no
//                marks, no commands obeyed -- and says so in its share panel.
//   the phone    a snapshot from anything but the claim it is following is dropped,
//                and so is one from that claim that it has already moved past.
//
// Newest rather than oldest, because a claim is minted when a page is *told* to host
// -- by the button or by the remembered flag on load -- so the newest claim is the
// page the pianist last acted on, and reloading is how you take the phone back. The
// other way round, a tab forgotten since the morning would hold the phone for the
// evening and the tab in front of the pianist would be the one to go quiet.
//
// Wall clocks are comparable here because the contenders are pages on one laptop.
// Two that claimed in the same millisecond are separated by their client ids, which
// are random: the tie-break is there so both ends pick the *same* winner, not
// because either of them is the better answer.

/** The claim a message carries, or null when it is unsigned -- a laptop on an older build. */
export function claimOf(ev) {
  const client = ev?.by;
  if (typeof client !== 'string' || !client) return null;
  const since = Number(ev.since);
  return { client, since: Number.isFinite(since) ? since : 0 };
}

/** The snapshot counter, or null on a message that carries none. */
export function seqOf(ev) {
  const n = Number(ev?.seq);
  return Number.isFinite(n) ? n : null;
}

/** Does claim `a` beat claim `b`? Any claim at all beats no claim. */
export function newerClaim(a, b) {
  if (!a) return false;
  if (!b) return true;
  if (a.since !== b.since) return a.since > b.since;
  return a.client > b.client;
}

/**
 * What a follower should do with a snapshot: `null` to drop it, or the `{ claim, seq }`
 * to hold on to from here. `held` is what it is following now, or null for a phone
 * that has not seen a snapshot yet.
 */
export function follow(held, ev) {
  const claim = claimOf(ev);
  const seq = seqOf(ev);
  // an unsigned writer is followed only while nobody has claimed the room, and is
  // beaten by the first page that does: a signed claim is a page that said so
  if (!claim) return held?.claim ? null : { claim: null, seq };
  if (held?.claim && held.claim.client === claim.client) {
    // the page we are following. Its snapshots cross one stream, in order, so a seq
    // that has not moved is the one the server kept and handed us on reconnect, and
    // one that has gone backwards lost a race inside this page (see `apply`).
    if (seq !== null && held.seq !== null && seq <= held.seq) return null;
    return { claim, seq: seq ?? held.seq };
  }
  return newerClaim(claim, held?.claim ?? null) ? { claim, seq } : null;
}

/**
 * Is this mark -- a hit, a miss, a pass, an `end` -- from the page we are following?
 *
 * An unsigned one is taken: an older laptop, and there is nothing better to go on.
 * One signed by somebody else is not, and that matters most for the messages that
 * move the phone on their own: an `end` from a forgotten tab stops the playhead
 * mid-practice, and a `pass` rebuilds the tally under it.
 */
export function fromOwner(held, ev) {
  const claim = claimOf(ev);
  if (!claim || !held?.claim) return true;
  return claim.client === held.claim.client;
}

/**
 * A newer page has taken the room: the claim that beats `mine`, or null to keep it.
 * `mine` is this page's own claim.
 */
export function beatenBy(mine, ev) {
  const claim = claimOf(ev);
  if (!claim || claim.client === mine?.client) return null;
  return newerClaim(claim, mine) ? claim : null;
}
