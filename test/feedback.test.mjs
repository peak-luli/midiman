// The Feedback control: what it puts on the wire, and what it does when nothing is
// listening.
//
// Two properties are the whole feature and both are easy to lose in a refactor:
//
//   * the payload carries the *context*. A note that says "this bit is hard" and
//     nothing else is a note nobody can act on a week later, and the pianist is not
//     going to type out the song, the step, the bars and the percentage by hand
//     while the loop is going. So every one of those has a test here.
//   * nothing throws and nothing is queued. A laptop with no token, no internet or
//     no server at all must cost one grey line, because the alternative is a dialog
//     over the music. Every failure below is asserted to come back as `{ok:false}`
//     with a reason, never as a rejection.
//
// The sheet itself needs a DOM and is checked in the browser smoke run
// (scripts/smoke.mjs); everything a payload is made of is here, where it is cheap.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { CHIPS, NOTE_MAX, cleanNote, successOf, successText, contextOf, buildPayload,
         postFeedback, mountFeedback } from '../src/learn/feedback.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** A page mid-lesson: the tutor, four bars in, with a pass just finished. */
const tutorCtx = {
  device: 'laptop',
  song: () => ({ id: 'city-of-stars', title: 'City of Stars' }),
  mode: () => 'tutor',
  step: () => ({ id: 'v-rh-1', title: 'Right hand, bars 1–4' }),
  stepNo: () => 4,
  stepCount: () => 22,
  section: () => 'Verse',
  bars: () => [1, 4],
  bpm: () => 72,
  view: () => 'staff',
  success: () => successOf({ lastPass: { accuracy: 0.86 } }),
};

// ---------------------------------------------------------------- the chips
test('one of two chips is required, and nothing else is a chip', () => {
  assert.deepEqual(CHIPS.map(c => c.k), ['well', 'friction']);
  for (const chip of ['well', 'friction'])
    assert.equal(buildPayload({ chip, ctx: tutorCtx })?.chip, chip);
  // the sheet cannot produce these; the payload is the contract, so it holds the line
  for (const chip of [null, undefined, '', 'meh', 'WELL', 0])
    assert.equal(buildPayload({ chip, ctx: tutorCtx }), null, `${chip} is not a chip`);
});

// ---------------------------------------------------------------- the note
test('the note is optional, one line, and short', () => {
  const p = buildPayload({ chip: 'well', ctx: tutorCtx });
  assert.equal(p.note, '', 'a chip on its own is a whole note');
  assert.equal(cleanNote('  the  turn\nat bar 9\tlost me  '), 'the turn at bar 9 lost me');
  assert.equal(cleanNote('x'.repeat(NOTE_MAX + 50)).length, NOTE_MAX);
  assert.equal(cleanNote(null), '');
  // a newline in the note would break out of the blockquote the comment puts it in
  assert.ok(!cleanNote('a\nb\r\nc').includes('\n'));
});

// ---------------------------------------------------------------- the context
test('the payload carries what was on screen, not just the chip', () => {
  const p = buildPayload({ chip: 'friction', note: 'wait mode lost me', ctx: tutorCtx,
                           now: new Date('2026-09-05T10:11:12Z') });
  assert.equal(p.v, 1);
  assert.equal(p.at, '2026-09-05T10:11:12.000Z');
  assert.deepEqual(p.context, {
    device: 'laptop', mirroring: false,
    songId: 'city-of-stars', songTitle: 'City of Stars',
    practice: 'tutor', section: 'Verse', bars: '1–4',
    step: 'Right hand, bars 1–4', stepNo: 4, stepCount: 22,
    success: '86% last pass', bpm: 72, view: 'staff',
  });
});

test('free practice has no step, and says so by leaving it out', () => {
  const c = contextOf({ ...tutorCtx, mode: () => 'free', step: () => null });
  assert.equal(c.practice, 'free');
  assert.equal(c.step, null);
  assert.equal(c.stepNo, null, 'a step number without a step is noise');
  assert.equal(c.stepCount, null);
  assert.equal(c.bars, '1–4', 'the bars are still the bars');
});

test('the phone says it is the phone, and whether it is mirroring', () => {
  assert.equal(contextOf({ ...tutorCtx, device: 'phone' }).device, 'phone');
  assert.equal(contextOf({ ...tutorCtx, device: 'phone' }).mirroring, false);
  assert.equal(contextOf({ ...tutorCtx, device: 'phone', mirroring: true }).mirroring, true);
});

test('a page with nothing loaded still sends a usable note', () => {
  // the songs failed to load, or a note written before anything was picked: every
  // field is optional on the way in and present on the way out
  const p = buildPayload({ chip: 'friction', note: 'the songs never loaded', ctx: { device: 'laptop' } });
  assert.equal(p.context.songTitle, null);
  assert.equal(p.context.bars, null);
  assert.equal(p.context.success, null);
  assert.equal(p.note, 'the songs never loaded');
});

test('a getter that throws does not take the note down with it', () => {
  const c = contextOf({ ...tutorCtx, song: () => { throw new Error('mid-load'); } });
  assert.equal(c.songTitle, null);
  assert.equal(c.section, 'Verse', 'the rest of the page is still readable');
});

// ---------------------------------------------------------------- the success hint
test('the success hint is live, then the last pass, then the best so far', () => {
  assert.deepEqual(successOf({ live: { due: 12, pct: 0.91 }, lastPass: { accuracy: 0.5 }, best: 0.7 }),
    { kind: 'live', pct: 0.91 });
  // a running pass with nothing due yet is not a measurement of anything
  assert.deepEqual(successOf({ live: { due: 0, pct: 0 }, lastPass: { accuracy: 0.5 }, best: 0.7 }),
    { kind: 'pass', pct: 0.5 });
  assert.deepEqual(successOf({ best: 0.7 }), { kind: 'best', pct: 0.7 });
  assert.equal(successOf({}), null, 'nothing played yet is worth saying by omission');
  assert.equal(successOf(), null);

  assert.equal(successText({ kind: 'live', pct: 0.912 }), '91% live');
  assert.equal(successText({ kind: 'pass', pct: 0.86 }), '86% last pass');
  assert.equal(successText({ kind: 'best', pct: 1 }), '100% best so far');
  assert.equal(successText(null), null);
});

// ---------------------------------------------------------------- the post
const okResponse = (body = { ok: true, issue: 10, url: 'https://example/c/1' }) =>
  ({ ok: true, status: 200, json: async () => body });

test('a note goes to the laptop as JSON on /feedback', async () => {
  const sent = [];
  const fetch = async (url, opts) => { sent.push({ url, opts }); return okResponse(); };
  const payload = buildPayload({ chip: 'well', ctx: tutorCtx });
  const r = await postFeedback(payload, { fetch });
  assert.deepEqual(r, { ok: true, url: 'https://example/c/1', issue: 10 });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, '/feedback');
  assert.equal(sent[0].opts.method, 'POST');
  assert.equal(sent[0].opts.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(sent[0].opts.body), payload);
});

test('every way this can fail is one line, never a throw', async () => {
  const cases = [
    ['no server at all', async () => { throw new TypeError('Failed to fetch'); }],
    ['a plain file server', async () => ({ ok: false, status: 501 })],
    ['a server that broke', async () => ({ ok: false, status: 500 })],
    ['no token on the laptop', async () => ({ ok: true, status: 202,
      json: async () => ({ ok: false, reason: 'no GitHub token on the laptop' }) })],
    ['GitHub unreachable', async () => ({ ok: true, status: 202,
      json: async () => ({ ok: false, reason: 'GitHub could not be reached' }) })],
    ['an HTML error page', async () => ({ ok: true, status: 200,
      json: async () => { throw new SyntaxError('Unexpected token <'); } })],
  ];
  for (const [what, fetch] of cases) {
    const r = await postFeedback(buildPayload({ chip: 'well', ctx: tutorCtx }), { fetch });
    assert.equal(r.ok, false, what);
    assert.ok(r.reason, `${what} says why`);
  }
  // and nothing is kept for later: there is no queue in the module to keep it in
  const src = readFileSync(join(ROOT, 'src/learn/feedback.js'), 'utf8');
  assert.ok(!/localStorage|sessionStorage|indexedDB/i.test(src),
    'a note that did not send is not stored anywhere');
});

test('nothing to send sends nothing', async () => {
  let called = 0;
  const fetch = async () => { called++; return okResponse(); };
  const r = await postFeedback(buildPayload({ chip: 'nope', ctx: tutorCtx }), { fetch });
  assert.equal(called, 0, 'cancel, and a chipless sheet, post nothing');
  assert.equal(r.ok, false);
});

// ---------------------------------------------------------------- piano-safe
test('a page with no Feedback button mounts an inert one rather than throwing', () => {
  // mountFeedback runs from the middle of each page's wiring: a throw here would
  // leave the transport, the MIDI and the song list unbuilt, like mountHost's guard
  const fb = mountFeedback(null, tutorCtx);
  assert.equal(fb.open, false);
  fb.show(); fb.hide(); fb.send();
  assert.equal(fb.open, false);
});

/** A source file with its comments taken out, so the prose can say what the code may not. */
const codeOf = f => readFileSync(join(ROOT, f), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');

test('the module cannot stop the loop, because it never reaches the engine', () => {
  // The one promise this feature makes at the piano: opening Feedback does not stop
  // the loop, wipe the streak or reset the meter. It is kept structurally -- the
  // module is handed getters and a button, and there is no engine in it to call.
  const src = codeOf('src/learn/feedback.js');
  for (const forbidden of ['engine', '.stop(', '.play(', 'setMode', 'streak', 'meter', 'clearMarks'])
    assert.ok(!src.includes(forbidden), `feedback.js must not reach for ${forbidden}`);
  assert.ok(!/^import .*from/m.test(src), 'and it imports nothing it could reach through');
});

test('the pages hand the same shape in, and both have the button', () => {
  for (const [mod, page, device] of [['src/learn/app.js', 'learn.html', 'laptop'],
                                     ['src/learn/mobile.js', 'learn-m.html', 'phone']]) {
    const src = readFileSync(join(ROOT, mod), 'utf8');
    assert.match(src, /mountFeedback\(/, `${mod} mounts it`);
    assert.match(src, new RegExp(`device: '${device}'`), `${mod} says which device it is`);
    assert.match(readFileSync(join(ROOT, page), 'utf8'), /id="fbBtn"/, `${page} has the button`);
  }
  // and the phone's shell has to carry the module, or an installed app will not boot
  assert.match(readFileSync(join(ROOT, 'sw.js'), 'utf8'), /src\/learn\/feedback\.js/);
});
