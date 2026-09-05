// "How did that go?" — one control on the Learn page, laptop and phone, that puts a
// line into the standing GitHub issue without anyone leaving the piano.
//
// The whole point is that it costs nothing to use *while playing*. Two people are
// testing this at a real instrument, and the moment a note about friction means
// stopping the loop, losing the streak and finding a laptop, the note does not get
// written. So:
//
//   * opening the sheet touches nothing. No engine call, no meter reset, no
//     streak. It is a panel over the page and that is all it is.
//   * the page's own hotkeys are held off while it is open -- `t`, `f`, `w`, `l`
//     and Space all reach into the transport, and `f` restarts the whole mode. The
//     keydown listener below is on the capture phase so it gets the key before
//     app.js's does, and stops it there.
//   * Send closes immediately and posts in the background. Nothing is awaited,
//     nothing is queued, and a laptop with no token -- or no internet -- costs one
//     quiet line under the button rather than a dialog.
//
// The context is attached rather than typed. What was on screen when the note was
// written is the half of a bug report nobody remembers to include afterwards: which
// song, tutor or free practice, which bars, which step, and how it was actually
// going. Every one of those is already on the page; the getters in `ctx` read them.
//
// The token never comes near this file. The POST goes to the laptop's own serve.py,
// which holds the GitHub credential and does the talking (see serve.py's /feedback).
// A phone on the music stand is served by that same laptop, so `''` -- this page's
// own origin -- is the right base at both ends.

/** The one required answer. Two chips, because a third would make it a form. */
export const CHIPS = [
  { k: 'well', label: '👍 Went well' },
  { k: 'friction', label: '⚠️ Friction' },
];

const CHIP_KEYS = new Set(CHIPS.map(c => c.k));

/** One line, and a short one: this is a note at a piano, not a bug report. */
export const NOTE_MAX = 200;

/** Newlines out, runs of space collapsed, capped. A textarea would invite an essay. */
export const cleanNote = s =>
  String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, NOTE_MAX);

/**
 * How it was actually going, in one number, in the order the pianist would say it:
 * what the meter shows right now, else the pass that just finished, else the best
 * this step has ever been. Null when the answer is "we have not played it yet",
 * which is worth knowing too and is better said by leaving the line out.
 *
 * `live` and `lastPass` are the engine's own shapes -- `stats().live` / `.win`, and a
 * pass off the streak -- so neither page has to reshape anything to ask.
 */
export function successOf({ live = null, lastPass = null, best = null } = {}) {
  if (live && live.due) return { kind: 'live', pct: live.pct };
  if (lastPass && typeof lastPass.accuracy === 'number') return { kind: 'pass', pct: lastPass.accuracy };
  if (typeof best === 'number') return { kind: 'best', pct: best };
  return null;
}

/** The success hint as the sheet and the comment both say it. */
export const successText = s => !s ? null
  : `${Math.round(s.pct * 100)}% ${s.kind === 'live' ? 'live' : s.kind === 'pass' ? 'last pass' : 'best so far'}`;

/**
 * Everything the page knows about where you are, read through `ctx`'s getters at the
 * moment Send is pressed rather than when the sheet was opened -- a pianist who
 * opened it, played the phrase once more and then typed the note means the second
 * one.
 *
 * Every field is optional on the way in and every field is present on the way out:
 * the server renders whatever it is given, and a page mid-load with no song must
 * still be able to send "the songs did not load".
 */
export function contextOf(ctx = {}) {
  const get = (k, d = null) => { try { return ctx[k]?.() ?? d; } catch { return d; } };
  const song = get('song');
  const step = get('step');
  const bars = get('bars');
  return {
    device: ctx.device ?? 'laptop',
    mirroring: !!ctx.mirroring,
    songId: song?.id ?? null,
    songTitle: song?.title ?? null,
    practice: get('mode') === 'free' ? 'free' : 'tutor',
    section: get('section'),
    bars: Array.isArray(bars) && bars.length === 2 ? `${bars[0]}–${bars[1]}` : null,
    // the step title is the tutor's; free practice has no step and says so by omission
    step: step?.title ?? null,
    stepNo: step ? get('stepNo') : null,
    stepCount: step ? get('stepCount') : null,
    success: successText(get('success')),
    bpm: get('bpm'),
    view: get('view'),
  };
}

/**
 * The thing that goes over the wire. `null` for anything that is not one of the two
 * chips: the sheet cannot produce that, but the payload is the contract with
 * serve.py and it is the payload that has to hold the line.
 */
export function buildPayload({ chip, note = '', ctx = {}, now = new Date() } = {}) {
  if (!CHIP_KEYS.has(chip)) return null;
  return {
    v: 1,
    chip,
    note: cleanNote(note),
    at: new Date(now).toISOString(),
    context: contextOf(ctx),
  };
}

/**
 * Post it, and never throw. Every failure -- no server, no relay, a 500, an HTML
 * error page where JSON was expected -- comes back as `{ ok: false }` with a reason,
 * because the caller's whole error handling is one grey line that fades.
 *
 * A 202 is serve.py saying "I heard you and GitHub did not": no token configured, or
 * the API could not be reached. That is a `false` here as much as a 500 is, and it
 * carries its reason through so the line can say which.
 */
export async function postFeedback(payload, { fetch = globalThis.fetch, base = '' } = {}) {
  if (!payload) return { ok: false, reason: 'nothing to send' };
  let r;
  try {
    r = await fetch(`${base}/feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch {
    return { ok: false, reason: 'the laptop did not answer' };
  }
  if (!r?.ok) return { ok: false, reason: `the laptop answered ${r?.status ?? 0}` };
  let body = null;
  try { body = await r.json(); } catch { /* not JSON: treat it as a server that said nothing */ }
  if (body?.ok) return { ok: true, url: body.url ?? null, issue: body.issue ?? null };
  return { ok: false, reason: body?.reason ?? 'GitHub did not take it' };
}

// ---------------------------------------------------------------- the sheet
const SHEET_HTML = `
<div class="fbrow fbchips"></div>
<label class="fbnote">
  <span>Anything to add?</span>
  <input type="text" maxlength="${NOTE_MAX}" autocomplete="off"
         placeholder="one line, optional — e.g. “wait mode lost me at bar 9”">
</label>
<div class="fbctx"></div>
<div class="fbfoot">
  <button type="button" class="fbcancel">Cancel</button>
  <button type="button" class="fbsend" disabled>Send</button>
</div>`;

const HOW_LONG_MS = 4000;

/** The same shape, doing nothing, for a page with no Feedback button in it. */
const inertFeedback = () => ({ get open() { return false; }, show() {}, hide() {}, send() {} });

/**
 * @param btn  the page's Feedback button. The sheet itself is built here, so the two
 *             pages agree on it by construction rather than by two copies of markup.
 * @param ctx  `device`, `mirroring`, and getters onto the page's state; see contextOf.
 *             `post` and `now` are the seams the tests come in through.
 */
export function mountFeedback(btn, ctx = {}) {
  // Mounted from the middle of each page's wiring, like mountHost: a page without the
  // button must not throw here, or the transport and the song list below never get
  // wired. Feedback is an extra; the lesson is not.
  if (!btn || typeof document === 'undefined') return inertFeedback();
  const post = ctx.post ?? postFeedback;

  const scrim = document.createElement('div');
  scrim.className = 'fbscrim';
  scrim.hidden = true;
  const sheet = document.createElement('div');
  sheet.className = 'fbsheet';
  sheet.hidden = true;
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'true');
  sheet.setAttribute('aria-label', 'Feedback');
  sheet.innerHTML = SHEET_HTML;
  document.body.append(scrim, sheet);

  const q = s => sheet.querySelector(s);
  const chipBox = q('.fbchips'), note = q('.fbnote input'), ctxLine = q('.fbctx');
  const sendBtn = q('.fbsend'), cancelBtn = q('.fbcancel');
  chipBox.innerHTML = CHIPS.map(c => `<button type="button" class="fbchip" data-chip="${c.k}">${c.label}</button>`).join('');

  let open = false, chip = null, sayTimer = 0;

  /** The grey line under the button: the whole of this feature's error reporting. */
  function say(text, cls = '') {
    let line = btn.nextElementSibling;
    if (!line?.classList.contains('fbsaid')) {
      line = document.createElement('div');
      line.className = 'fbsaid';
      line.setAttribute('role', 'status');
      btn.after(line);
    }
    line.textContent = text;
    line.className = 'fbsaid' + (cls ? ' ' + cls : '');
    clearTimeout(sayTimer);
    sayTimer = setTimeout(() => { line.textContent = ''; line.className = 'fbsaid'; }, HOW_LONG_MS);
  }

  /** What is about to be attached, said in the sheet, so nothing is a surprise. */
  function paintContext() {
    const c = contextOf(ctx);
    const bits = [
      c.device === 'phone' ? (c.mirroring ? 'phone · mirroring' : 'phone') : 'laptop',
      c.songTitle,
      c.practice === 'free' ? 'free practice' : 'tutor',
      c.section && c.bars ? `${c.section} · bars ${c.bars}` : c.bars ? `bars ${c.bars}` : c.section,
      c.step,
      c.success,
    ].filter(Boolean);
    ctxLine.textContent = 'Attached: ' + bits.join(' · ');
  }

  function paintChips() {
    chipBox.querySelectorAll('[data-chip]').forEach(b => b.classList.toggle('on', b.dataset.chip === chip));
    sendBtn.disabled = !chip;                // one chip is required; the note never is
  }

  function show() {
    if (open) return;
    open = true;
    chip = null;
    note.value = '';
    paintChips();
    paintContext();
    scrim.hidden = false;
    sheet.hidden = false;
    btn.classList.add('on');
    // the input, not a chip: a keyboard here is the one thing that makes the page's
    // hotkeys safe by themselves, and the pianist can still tap a chip first
    note.focus({ preventScroll: true });
  }

  /** Close, sending nothing. Cancel and the scrim and Escape all land here. */
  function hide() {
    if (!open) return;
    open = false;
    scrim.hidden = true;
    sheet.hidden = true;
    btn.classList.remove('on');
  }

  /**
   * Fire and forget. The sheet is gone before the request leaves, because the answer
   * is not something anyone is waiting at a piano to read -- and because a sheet that
   * stays up until GitHub replies is a sheet that is up while the loop goes round.
   */
  function send() {
    const payload = buildPayload({ chip, note: note.value, ctx, now: ctx.now?.() ?? new Date() });
    hide();
    if (!payload) return;
    say('Sending…');
    Promise.resolve(post(payload, { base: ctx.base ?? '' })).then(r => {
      if (r?.ok) say('Thanks — sent to the feedback issue.', 'ok');
      else say(`Not sent: ${r?.reason ?? 'unknown'}. Nothing is queued.`, 'no');
    });
  }

  btn.onclick = () => (open ? hide() : show());
  cancelBtn.onclick = hide;
  scrim.onclick = hide;
  chipBox.onclick = e => {
    const b = e.target.closest('[data-chip]');
    if (!b) return;
    chip = b.dataset.chip;
    paintChips();
  };
  sendBtn.onclick = send;

  /**
   * The page's hotkeys are the transport's: `f` swaps to free practice, which stops
   * the engine and rebuilds the step. None of them may fire into a sheet. Capture on
   * the window runs before app.js's own listener on the same window, so stopping the
   * event here is enough -- and it stops nothing else, since the sheet is the only
   * thing on screen that wants a key while it is up.
   */
  addEventListener('keydown', e => {
    if (!open) return;
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); hide(); }
    else if (e.key === 'Enter' && chip) { e.preventDefault(); send(); }
  }, true);

  return { get open() { return open; }, show, hide, send };
}
