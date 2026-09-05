// The other half of Feedback: serve.py's /feedback, from the POST the page makes to
// the comment that lands on the issue.
//
// It is driven end to end against a stub GitHub -- `MIDIMAN_GITHUB_API` points the
// server at a Node server here instead of api.github.com -- because the thing worth
// testing is exactly the seam: the payload the page sends, the markdown that comes
// out of it, and the requests that actually go to GitHub. A unit test of the body
// renderer alone would pass while the endpoint 404s.
//
// The token never appears in the repository. It arrives through the environment, and
// the no-token path is a test of its own: that is the state every laptop is in until
// somebody sets it, and it has to be quiet rather than broken.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const sleep = ms => new Promise(r => setTimeout(r, ms));

/** A note the way the page makes one; see buildPayload in src/learn/feedback.js. */
const NOTE = {
  v: 1,
  chip: 'friction',
  note: 'wait mode lost me at bar 9',
  at: '2026-09-05T10:11:12.000Z',
  context: {
    device: 'phone', mirroring: true,
    songId: 'city-of-stars', songTitle: 'City of Stars',
    practice: 'tutor', section: 'Verse', bars: '1–4',
    step: 'Right hand, bars 1–4', stepNo: 4, stepCount: 22,
    success: '86% last pass', bpm: 72, view: 'scroll',
  },
};

/** api.github.com, small enough to assert against: it records what it was asked. */
function fakeGitHub() {
  const calls = [];
  const srv = createServer((req, res) => {
    let body = '';
    req.on('data', d => { body += d; });
    req.on('end', () => {
      calls.push({ method: req.method, path: req.url, auth: req.headers.authorization,
                   body: body ? JSON.parse(body) : null });
      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ number: 10, html_url: 'https://github.com/peak-luli/midiman/issues/10#c1' }));
    });
  });
  return new Promise(r => srv.listen(0, '127.0.0.1', () =>
    r({ calls, url: `http://127.0.0.1:${srv.address().port}`, close: () => srv.close() })));
}

/** A Grok Bot routine trigger: POST JSON, Authorization Bearer, records what arrived. */
function fakeWebhook({ status = 200, hangMs = 0 } = {}) {
  const calls = [];
  const srv = createServer((req, res) => {
    let body = '';
    req.on('data', d => { body += d; });
    req.on('end', () => {
      calls.push({ method: req.method, path: req.url, auth: req.headers.authorization,
                   type: req.headers['content-type'],
                   body: body ? JSON.parse(body) : null });
      if (hangMs) {
        setTimeout(() => {
          res.writeHead(status, { 'Content-Type': 'application/json' });
          res.end('{"ok":true}');
        }, hangMs);
        return;
      }
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end('{"ok":true}');
    });
  });
  return new Promise(r => srv.listen(0, '127.0.0.1', () =>
    r({ calls, url: `http://127.0.0.1:${srv.address().port}`, close: () => srv.close() })));
}

/** serve.py on a free port, with the environment a laptop would have. */
async function serve(port, env) {
  const p = spawn('python3', [join(ROOT, 'serve.py'), String(port)],
    { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], env: {
      ...process.env,
      // a developer's real webhook must not fire from these tests
      MIDIMAN_FEEDBACK_WEBHOOK_URL: '',
      MIDIMAN_FEEDBACK_WEBHOOK_KEY: '',
      MIDIMAN_FEEDBACK_WEBHOOK_HEADER: '',
      ...env,
    } });
  let log = '';
  p.stdout.on('data', d => { log += d; });
  p.stderr.on('data', d => { log += d; });
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`http://127.0.0.1:${port}/relay/info`)).ok) break; } catch { /* not up */ }
    await sleep(100);
  }
  return { proc: p, get log() { return log; }, kill: () => p.kill('SIGKILL') };
}

const send = (port, payload) =>
  fetch(`http://127.0.0.1:${port}/feedback`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

test('a note becomes a comment on the standing issue, with its context attached', async () => {
  const gh = await fakeGitHub();
  const srv = await serve(8891, {
    MIDIMAN_GITHUB_API: gh.url,
    MIDIMAN_GITHUB_TOKEN: 'test-token-not-a-real-one',
    MIDIMAN_FEEDBACK_REPO: 'peak-luli/midiman',
    MIDIMAN_FEEDBACK_ISSUE: '10',
  });
  try {
    const r = await send(8891, NOTE);
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(),
      { ok: true, issue: 10, url: 'https://github.com/peak-luli/midiman/issues/10#c1' });

    // one request, straight at the configured issue: the standing inbox is #10 and
    // nothing has to be searched for or created
    assert.equal(gh.calls.length, 1);
    assert.equal(gh.calls[0].method, 'POST');
    assert.equal(gh.calls[0].path, '/repos/peak-luli/midiman/issues/10/comments');
    assert.equal(gh.calls[0].auth, 'Bearer test-token-not-a-real-one');

    const body = gh.calls[0].body.body;
    assert.match(body, /Friction/, 'the chip');
    assert.match(body, /^> wait mode lost me at bar 9$/m, 'the note, as its own line');
    assert.match(body, /phone \(mirroring the laptop\)/, 'which device it came from');
    assert.match(body, /City of Stars/);
    assert.match(body, /`city-of-stars`/);
    assert.match(body, /Tutor · step 4 of 22 · “Right hand, bars 1–4”/);
    assert.match(body, /Verse · bars 1–4/);
    assert.match(body, /86% last pass/);
    assert.match(body, /72 bpm/);
    assert.match(body, /2026-09-05T10:11:12/);
  } finally { srv.kill(); gh.close(); }
});

test('a chip on its own is a whole note, and free practice leaves the step out', async () => {
  const gh = await fakeGitHub();
  const srv = await serve(8892, { MIDIMAN_GITHUB_API: gh.url, MIDIMAN_GITHUB_TOKEN: 't' });
  try {
    const r = await send(8892, {
      v: 1, chip: 'well', note: '', at: '2026-09-05T10:00:00.000Z',
      context: { device: 'laptop', mirroring: false, songId: 'city-of-stars',
                 songTitle: 'City of Stars', practice: 'free', section: 'Chorus',
                 bars: '9–16', step: null, stepNo: null, stepCount: null,
                 success: null, bpm: 60, view: 'staff' },
    });
    assert.equal(r.status, 200);
    const body = gh.calls[0].body.body;
    assert.match(body, /Went well/);
    assert.match(body, /Free practice/);
    assert.ok(!body.includes('>'), 'no empty blockquote where a note was not written');
    assert.ok(!/How it was going/.test(body), 'nothing played yet is left out, not made up');
    assert.match(body, /Chorus · bars 9–16/);
  } finally { srv.kill(); gh.close(); }
});

test('with no token the note is refused quietly, and nothing is sent anywhere', async () => {
  const gh = await fakeGitHub();
  const srv = await serve(8893, { MIDIMAN_GITHUB_API: gh.url, MIDIMAN_GITHUB_TOKEN: '' });
  try {
    const r = await send(8893, NOTE);
    // 202, not 500: the note arrived, GitHub is simply not configured. The page turns
    // this into one grey line and gets out of the way.
    assert.equal(r.status, 202);
    const j = await r.json();
    assert.equal(j.ok, false);
    assert.match(j.reason, /token/);
    assert.equal(gh.calls.length, 0, 'no half-authenticated request goes out');
    // and the laptop says, once, in its own log, how to fix it
    await sleep(150);
    assert.match(srv.log, /MIDIMAN_GITHUB_TOKEN/);
  } finally { srv.kill(); gh.close(); }
});

test('a GitHub that is down is a 202 as well, and never a crash', async () => {
  // nothing is listening on this port, which is a laptop with no internet
  const srv = await serve(8894, { MIDIMAN_GITHUB_API: 'http://127.0.0.1:9', MIDIMAN_GITHUB_TOKEN: 't' });
  try {
    const r = await send(8894, NOTE);
    assert.equal(r.status, 202);
    assert.equal((await r.json()).ok, false);
    // the server is still serving the lesson, which is the only thing that matters here
    assert.ok((await fetch('http://127.0.0.1:8894/relay/info')).ok);
  } finally { srv.kill(); }
});

test('a successful note POSTs a small JSON ping to the Grok Bot webhook', async () => {
  const gh = await fakeGitHub();
  const hook = await fakeWebhook();
  const srv = await serve(8901, {
    MIDIMAN_GITHUB_API: gh.url,
    MIDIMAN_GITHUB_TOKEN: 't',
    MIDIMAN_FEEDBACK_ISSUE: '10',
    MIDIMAN_FEEDBACK_WEBHOOK_URL: hook.url,
    MIDIMAN_FEEDBACK_WEBHOOK_KEY: 'crsr_test_sender_key_not_real',
  });
  try {
    const r = await send(8901, NOTE);
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(),
      { ok: true, issue: 10, url: 'https://github.com/peak-luli/midiman/issues/10#c1' });

    assert.equal(hook.calls.length, 1, 'the routine is woken once, after the comment lands');
    assert.equal(hook.calls[0].method, 'POST');
    assert.equal(hook.calls[0].auth, 'Bearer crsr_test_sender_key_not_real');
    assert.match(hook.calls[0].type, /application\/json/);

    const ping = hook.calls[0].body;
    assert.equal(ping.chip, 'friction');
    assert.equal(ping.note, 'wait mode lost me at bar 9');
    assert.deepEqual(ping.context, NOTE.context);
    assert.equal(ping.issue, 10);
    assert.equal(ping.url, 'https://github.com/peak-luli/midiman/issues/10#c1');
    assert.equal(ping.at, NOTE.at);
  } finally { srv.kill(); gh.close(); hook.close(); }
});

test('HEADER wins over KEY for the Authorization value', async () => {
  const gh = await fakeGitHub();
  const hook = await fakeWebhook();
  const srv = await serve(8902, {
    MIDIMAN_GITHUB_API: gh.url,
    MIDIMAN_GITHUB_TOKEN: 't',
    MIDIMAN_FEEDBACK_WEBHOOK_URL: hook.url,
    MIDIMAN_FEEDBACK_WEBHOOK_KEY: 'key-must-not-be-sent',
    MIDIMAN_FEEDBACK_WEBHOOK_HEADER: 'Authorization: Bearer from-the-trigger-card',
  });
  try {
    assert.equal((await send(8902, NOTE)).status, 200);
    assert.equal(hook.calls[0].auth, 'Bearer from-the-trigger-card');
  } finally { srv.kill(); gh.close(); hook.close(); }
});

test('a webhook 500 still returns ok once GitHub has the comment', async () => {
  const gh = await fakeGitHub();
  const hook = await fakeWebhook({ status: 500 });
  const srv = await serve(8903, {
    MIDIMAN_GITHUB_API: gh.url,
    MIDIMAN_GITHUB_TOKEN: 't',
    MIDIMAN_FEEDBACK_WEBHOOK_URL: hook.url,
    MIDIMAN_FEEDBACK_WEBHOOK_KEY: 'k',
  });
  try {
    const r = await send(8903, NOTE);
    assert.equal(r.status, 200);
    assert.equal((await r.json()).ok, true);
    assert.equal(gh.calls.length, 1);
    assert.equal(hook.calls.length, 1);
  } finally { srv.kill(); gh.close(); hook.close(); }
});

test('a webhook that never answers still returns ok', async () => {
  const gh = await fakeGitHub();
  // longer than serve.py's WEBHOOK_TIMEOUT (4s); the pianist must not wait on it
  const hook = await fakeWebhook({ hangMs: 20_000 });
  const srv = await serve(8904, {
    MIDIMAN_GITHUB_API: gh.url,
    MIDIMAN_GITHUB_TOKEN: 't',
    MIDIMAN_FEEDBACK_WEBHOOK_URL: hook.url,
    MIDIMAN_FEEDBACK_WEBHOOK_KEY: 'k',
  });
  try {
    const t0 = Date.now();
    const r = await send(8904, NOTE);
    const ms = Date.now() - t0;
    assert.equal(r.status, 200);
    assert.equal((await r.json()).ok, true);
    assert.ok(ms < 12_000, `webhook hang leaked into the response (${ms}ms)`);
  } finally { srv.kill(); gh.close(); hook.close(); }
});

test('with no webhook URL nothing is posted, and GitHub still gets the note', async () => {
  const gh = await fakeGitHub();
  const hook = await fakeWebhook();
  const srv = await serve(8905, {
    MIDIMAN_GITHUB_API: gh.url,
    MIDIMAN_GITHUB_TOKEN: 't',
    // URL left blank by serve() — today's laptop, no Grok Bot routine configured
  });
  try {
    const r = await send(8905, NOTE);
    assert.equal(r.status, 200);
    assert.equal((await r.json()).ok, true);
    assert.equal(gh.calls.length, 1);
    assert.equal(hook.calls.length, 0, 'an unconfigured webhook is not guessed at');
  } finally { srv.kill(); gh.close(); hook.close(); }
});

test('something that is not a note is a 400, and the relay is untouched', async () => {
  const gh = await fakeGitHub();
  const srv = await serve(8895, { MIDIMAN_GITHUB_API: gh.url, MIDIMAN_GITHUB_TOKEN: 't' });
  try {
    for (const bad of [{ chip: 'meh' }, { note: 'no chip' }, null, [1, 2]])
      assert.equal((await send(8895, bad)).status, 400, JSON.stringify(bad));
    const raw = await fetch('http://127.0.0.1:8895/feedback',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: 'not json' });
    assert.equal(raw.status, 400);
    assert.equal(gh.calls.length, 0);
    // the endpoint is additive: /relay/send is exactly as it was
    const relay = await fetch('http://127.0.0.1:8895/relay/send?room=r',
      { method: 'POST', body: JSON.stringify({ type: 'state' }) });
    assert.equal((await relay.json()).ok, true);
  } finally { srv.kill(); gh.close(); }
});
