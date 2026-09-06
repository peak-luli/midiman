// Putting the phone's playhead on the laptop's beat, without streaming anything.
//
// In remote mode the laptop owns the transport. Sending it its position every frame
// would put the Wi-Fi between the clock and the playhead, and the playhead would
// stutter with the network. So the laptop says *once* where beat 0 was, and the
// phone runs its own `makeClock` from that anchor at 60 fps. Nothing accumulates,
// because the phone's clock is anchored rather than driven.
//
// That only works if the two ends agree what "now" is. `performance.now()` counts
// from when each page loaded, so the two origins are unrelated -- but the relay has
// one monotonic clock both can measure themselves against, NTP-style:
//
//     offset = server - client        so   server = client + offset
//
// Both ends measure their own offset and the anchor travels in *relay* time; neither
// end ever has to know the other's page-load moment.
//
// Round trips on a home LAN are a few milliseconds, but the tail is long: a sample
// that waited behind a retransmit is tens of milliseconds out, and it is always out
// in the same direction, because half of whatever the packet waited lands in the
// estimate. The shortest round trips are therefore the honest ones -- keep the best
// half by RTT and take their median, which is the standard NTP filter in miniature.

/** One round trip: the client's clock before and after, and the server's stamp inside. */
export const offsetOf = ({ sent, server, recv }) => server - (sent + recv) / 2;
export const rttOf = ({ sent, recv }) => recv - sent;

const median = xs => {
  const s = [...xs].sort((a, b) => a - b);
  const h = s.length >> 1;
  return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
};

/**
 * Estimate the offset from a handful of round trips. Returns
 * `{ offset, rtt, n, spread }` -- `rtt` is the median round trip of the samples that
 * were kept and `spread` how far apart their offsets were, which is the honest
 * measure of how much the number can be trusted.
 */
export function estimateOffset(samples, { keep = 0.5 } = {}) {
  const ok = samples.filter(s => Number.isFinite(offsetOf(s)) && rttOf(s) >= 0);
  if (!ok.length) return { offset: 0, rtt: 0, n: 0, spread: 0 };
  const byRtt = [...ok].sort((a, b) => rttOf(a) - rttOf(b));
  const best = byRtt.slice(0, Math.max(1, Math.round(byRtt.length * keep)));
  const offs = best.map(offsetOf);
  return {
    offset: median(offs),
    rtt: median(best.map(rttOf)),
    n: best.length,
    spread: Math.max(...offs) - Math.min(...offs),
  };
}

/** A local `performance.now()` stamp in relay time, and back again. */
export const toServer = (local, offset) => local + offset;
export const toLocal = (server, offset) => server - offset;

/**
 * How old a snapshot is, in milliseconds, on the relay's clock. The publisher stamps
 * `at` as it sends; this converts the reader's own `now` into the same base, so the
 * two never have to know each other's page-load moment.
 *
 * A few milliseconds negative is an honest clock estimate being slightly out, not a
 * stamp from the future.
 */
export const stateAge = (at, offset, now = performance.now()) => toServer(now, offset) - at;

/**
 * How stale an anchor may be before the beat it names is not the beat anybody is on.
 * Comfortably more than the host's heartbeat, so a snapshot that merely queued behind
 * something is still trusted, and far less than the age of a snapshot the relay kept
 * from a page that has since been closed.
 */
export const MAX_ANCHOR_AGE_MS = 2500;

/**
 * May the follower run its playhead from this snapshot's anchor?
 *
 * Three ways an anchor is worthless, and all three have been on screen:
 *
 *   * **the publisher had not measured the relay clock.** `t0` is written as
 *     `local + offset`, and until the NTP rounds land that offset is 0 -- so `t0` is
 *     the laptop's own page-lifetime milliseconds, which mean nothing here. The host
 *     publishes the moment its stream goes live, which is before its first
 *     measurement completes, so the very first snapshot of a session is this.
 *   * **this device has not measured it either.** Same arithmetic, other end: with
 *     `offset` still 0 the reader compares relay time against its own page lifetime
 *     and lands thousands of beats away.
 *   * **the snapshot is old.** serve.py keeps a room's last snapshot and replays it
 *     to whoever connects next, and a room outlives the page that filled it. A phone
 *     opened later is handed a picture published minutes ago; anchoring on it puts
 *     the playhead wherever `(now - then)` happens to divide.
 *
 * The state in such a snapshot is still worth applying -- which step, which mode,
 * whether the laptop is playing -- so this answers only the narrower question of
 * whether to start a clock from it. `why` is for the mode line and the tests.
 *
 * @returns {{ ok: boolean, why: string, age: number|null }}
 */
export function anchorState(s, { synced, offset = 0, now = performance.now(),
                                 maxAge = MAX_ANCHOR_AGE_MS } = {}) {
  if (!s || !Number.isFinite(s.t0) || !Number.isFinite(s.bpm)) return { ok: false, why: 'no anchor', age: null };
  // `synced` is absent from a host too old to send it; only an explicit false is a
  // laptop saying its own estimate was not ready
  if (s.synced === false) return { ok: false, why: 'the laptop had not measured the relay clock', age: null };
  if (!synced) return { ok: false, why: 'this device has not measured the relay clock', age: null };
  if (!Number.isFinite(s.at)) return { ok: true, why: 'unstamped', age: null };
  const age = stateAge(s.at, offset, now);
  if (age > maxAge) return { ok: false, why: 'stale', age };
  return { ok: true, why: 'fresh', age };
}

/**
 * The absolute beat the anchor puts us on right now. `t0` is the relay-time stamp of
 * beat 0, as the laptop published it; `now` is this device's `performance.now()`.
 * This is the whole of the sync: one subtraction and one division, per frame, local.
 */
export const beatAt = ({ t0, bpm }, offset, now) => (toServer(now, offset) - t0) / (60000 / bpm);

/**
 * Anchor a `makeClock` on the laptop's beat. Sets the tempo and starts (or freezes)
 * the clock at the beat the anchor puts us on, so `clock.beat()` reads the same on
 * both machines from here on with no further traffic.
 */
export function anchorClock(clock, anchor, offset, now = performance.now()) {
  const beat = beatAt(anchor, offset, now);
  clock.setBpm(anchor.bpm);
  if (anchor.running) clock.start(beat); else { clock.stop(); clock.start(beat); clock.stop(); }
  return beat;
}

/**
 * The measuring side: `fetchTime()` resolves to the relay's monotonic milliseconds.
 * Kept behind injected dependencies so the estimator can be tested without a network
 * and re-measured on a timer without a second copy of the filter.
 */
export function makeSync({ fetchTime, now = () => performance.now(), rounds = 8, gap = 30 }) {
  let est = { offset: 0, rtt: 0, n: 0, spread: 0 };
  let measuring = null;

  async function once() {
    const sent = now();
    const server = await fetchTime();
    return { sent, server, recv: now() };
  }

  return {
    get offset() { return est.offset; },
    get rtt() { return est.rtt; },
    get ready() { return est.n > 0; },
    get last() { return est; },

    /** Run `rounds` round trips and adopt the filtered estimate. Never runs twice at once. */
    measure() {
      return measuring ||= (async () => {
        const samples = [];
        for (let i = 0; i < rounds; i++) {
          try { samples.push(await once()); }
          catch {
            // a dropped probe among good ones is just a lost sample -- but a failure
            // with nothing yet in hand is the endpoint saying it is not there, and
            // seven more requests will not change its mind
            if (!samples.length) break;
          }
          if (gap) await new Promise(r => setTimeout(r, gap));
        }
        if (samples.length) est = estimateOffset(samples);
        measuring = null;
        return est;
      })();
    },
  };
}
