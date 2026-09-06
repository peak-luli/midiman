#!/usr/bin/env node
// End-to-end smoke check for the phone-mirroring "Learn" flow: a laptop hosts a
// room (learn.html) and a phone mirrors it over the relay in serve.py
// (learn-m.html). Every worker touching that flow so far has hand-rolled this
// exact dance -- launch Chrome, drive two tabs over CDP, tear down -- so this is
// the one reusable version. Node only: Node's global WebSocket (stable since
// Node 22) talks CDP directly, so there is nothing to npm install.
//
//   node scripts/smoke.mjs [--port 8810] [--keep] [--shots <dir>] [--chrome <path>]
//
// --keep leaves the server and Chrome running (for poking at with a real
// browser's devtools); --shots saves one screenshot per tab. Exits 1 if any
// check fails.

import { spawn, execSync } from 'node:child_process';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

if (typeof WebSocket === 'undefined') {
  // Node 22+ has a global WebSocket; below that there is none, and the task this
  // file exists for is to avoid a hand-rolled CDP client per worker -- so fail
  // loudly rather than half-support an older Node.
  console.error(`No global WebSocket (Node ${process.version}); this needs Node >= 22.`);
  process.exit(1);
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ROOM = 'smoke1';
const sleep = ms => new Promise(r => setTimeout(r, ms));

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const PORT = Number(opt('--port', 8810));
const CDP_PORT = PORT + 1000;
const KEEP = args.includes('--keep');
const SHOTS = opt('--shots', null);
const PROFILE = join(tmpdir(), `mm-smoke-${process.pid}`);
const BASE = `http://127.0.0.1:${PORT}`;

/**
 * Which browser to drive. This started as one hard-coded path to Chrome on a Mac,
 * which is where the piano is -- but the same check is worth running wherever the
 * code is being changed, and that is not always a Mac. So: `--chrome <path>`, then
 * $CHROME, then the usual places, and a clear word if none of them is there.
 */
const CHROME = opt('--chrome', process.env.CHROME) ?? [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/opt/pw-browsers/chromium',                    // Playwright's, if it has been installed
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
].find(p => existsSync(p));

const results = [];
const ok = (name, pass, note = '') => {
  console.log(`${pass ? 'ok  ' : 'FAIL'}  ${name}${note ? ' — ' + note : ''}`);
  results.push(pass);
};

let server = null, chrome = null;

function killAll() {
  if (KEEP) { console.log(`(--keep: server on :${PORT}, Chrome on :${CDP_PORT} left running)`); return; }
  try { server?.kill(); } catch { /* already gone */ }
  try { chrome?.kill(); } catch { /* already gone */ }
  try { execSync(`pkill -f "${PROFILE}"`, { stdio: 'ignore' }); } catch { /* none running */ }
  try { rmSync(PROFILE, { recursive: true, force: true }); } catch { /* nothing to clean up */ }
}
// belt and braces: a thrown error still runs the `finally` below, but Ctrl-C doesn't
process.on('SIGINT', () => { killAll(); process.exit(130); });

async function waitFor(url, tries = 80) {
  for (let i = 0; i < tries; i++) {
    try { if ((await fetch(url)).ok) return; } catch { /* not up yet */ }
    await sleep(250);
  }
  throw new Error(`nothing answering at ${url}`);
}

/** Poll `fn` until `pass` likes its value or `ms` runs out. Swallows mid-navigation errors. */
async function poll(fn, pass, ms, step = 250) {
  const t0 = Date.now();
  let v;
  do {
    try { v = await fn(); } catch { v = undefined; }
    if (pass(v)) return { ok: true, v };
    await sleep(step);
  } while (Date.now() - t0 < ms);
  return { ok: false, v };
}

/** A CDP connection to one page target: evaluate, navigate, click, screenshot, console errors. */
async function attach(target, metrics) {
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0;
  const waiting = new Map();
  const errors = [];
  ws.onmessage = m => {
    const msg = JSON.parse(m.data);
    if (msg.id && waiting.has(msg.id)) {
      const { res, rej } = waiting.get(msg.id); waiting.delete(msg.id);
      msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result);
    } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      errors.push(msg.params.args.map(a => a.value ?? a.description ?? '').join(' '));
    } else if (msg.method === 'Runtime.exceptionThrown') {
      errors.push(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text);
    }
  };
  const send = (method, params = {}) => new Promise((res, rej) => {
    const i = ++id;
    waiting.set(i, { res, rej });
    ws.send(JSON.stringify({ id: i, method, params }));
  });
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  if (metrics) await send('Emulation.setDeviceMetricsOverride', metrics);
  return {
    errors,
    async goto(url, wait = 1200) { await send('Page.navigate', { url }); await sleep(wait); },
    /** Evaluate an expression in the page; async expressions are awaited. */
    async ev(expr) {
      const r = await send('Runtime.evaluate', { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
      return r.result.value;
    },
    /** A real, trusted click -- some of what this drives (AudioContext) refuses a synthetic one. */
    async click(sel) {
      const box = await this.ev(`const e = ${sel === 'body' ? 'document.body' : `document.querySelector(${JSON.stringify(sel)})`};
        if (!e) return null; e.scrollIntoView?.({ block: 'center' }); const r = e.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };`);
      if (!box) throw new Error('no element ' + sel);
      for (const type of ['mousePressed', 'mouseReleased'])
        await send('Input.dispatchMouseEvent', { type, x: box.x, y: box.y, button: 'left', clickCount: 1 });
      await sleep(80);
    },
    /** Make this the visible tab: a hidden one has no rAF and barely any timers. */
    async front() { await send('Page.bringToFront'); await sleep(150); },
    /**
     * Straight through to CDP, for the few things no page expression can do -- cutting
     * one endpoint off this tab, say, to see what it does when a command cannot leave.
     */
    cdp: send,
    async shot(path) {
      const r = await send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(path, Buffer.from(r.data, 'base64'));
    },
    close() { ws.close(); },
  };
}

async function main() {
  if (!CHROME) throw new Error('no Chrome or Chromium found — pass --chrome <path> or set $CHROME');
  mkdirSync(PROFILE, { recursive: true });
  if (SHOTS) mkdirSync(SHOTS, { recursive: true });          // the run saves some as it goes

  // ---------------------------------------------------------------- launch
  server = spawn('python3', ['serve.py', String(PORT), '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
  await waitFor(`${BASE}/learn.html`);
  chrome = spawn(CHROME, [
    '--headless=new', '--mute-audio', `--remote-debugging-port=${CDP_PORT}`,   // --mute-audio always: this is muted for a reason
    `--user-data-dir=${PROFILE}`, '--no-first-run', '--disable-gpu',
    // Two tabs, one browser, and only one of them can be in front -- so the other is
    // a *hidden* page, and Chrome throttles a hidden page's timers to roughly one
    // tick a second. The engine's scheduler ticks every 25 ms and only looks about
    // 120 ms ahead, so at one tick a second nearly every app note is already in the
    // past when the tick that would have sent it finally runs, and is dropped. That
    // is right on a real laptop and wrong here: the laptop in this check is a window
    // in front of a pianist, not a background tab. Hence these, and the
    // `laptop.front()` before the Hear check below.
    '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-features=IntensiveWakeUpThrottling,CalculateNativeWinOcclusion',
    // as root -- which is what a container is -- Chrome's own sandbox refuses to start
    // at all, and there is nothing here but this checkout and a local server
    ...(process.getuid?.() === 0 ? ['--no-sandbox'] : []),
    'about:blank',
  ], { stdio: 'ignore' });
  await waitFor(`http://127.0.0.1:${CDP_PORT}/json/version`);
  const targets = async () => (await (await fetch(`http://127.0.0.1:${CDP_PORT}/json`)).json()).filter(t => t.type === 'page');

  // ---------------------------------------------------------------- the laptop
  // hosting has to be set before app.js's own boot runs, so it comes up already
  // sharing rather than needing a click on "Put it on the phone"
  const laptop = await attach((await targets())[0], { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await laptop.goto(`${BASE}/learn.html`);
  await laptop.ev(`localStorage.setItem('middleman.learn.hosting', '1');
    localStorage.setItem('middleman.learn.room', '${ROOM}'); return 1;`);
  await laptop.goto(`${BASE}/learn.html`, 2000);
  if (!(await poll(() => laptop.ev('return !!window.__mm;'), v => v, 5000)).ok)
    throw new Error('laptop never exposed window.__mm');

  // ---------------------------------------------------------------- the phone
  // mobile.js writes middleman.learn.remote itself off the ?room= query, so
  // there is nothing to set by hand before this navigation
  await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?${encodeURIComponent(`${BASE}/learn-m.html?room=${ROOM}`)}`, { method: 'PUT' });
  await sleep(800);
  const phoneTarget = (await targets()).find(t => t.url.includes('learn-m.html'));
  if (!phoneTarget) throw new Error('the phone tab never showed up');
  const phone = await attach(phoneTarget, { width: 844, height: 390, deviceScaleFactor: 2, mobile: true });
  if (!(await poll(() => phone.ev('return !!window.__mm;'), v => v, 5000)).ok)
    throw new Error('phone never exposed window.__mm');
  // a fresh load lands on the song list; the stage only engraves notes (and so
  // only has noteheads to mark 'hit') once it is actually the screen showing
  await phone.ev(`__mm.go('play'); return 1;`);

  // ---------------------------------------------------------------- checks
  const mode = await poll(() => phone.ev(`return document.getElementById('modeLine').textContent;`),
    v => v && v.includes('showing the laptop'), 5000);
  ok('phone\'s mode line says it is showing the laptop', mode.ok, mode.v);

  // ---------------------------------------------------------------- song pick (I49)
  // The phone used to only re-letter its path. The laptop stayed on City of Stars
  // (it boots pick(0)) and the next snapshot put it back. A tap must move both ends.
  const pickOnPhone = title => phone.ev(`
    const i = [...document.querySelectorAll('.songcard')]
      .findIndex(c => c.querySelector('.st1')?.textContent === ${JSON.stringify(title)});
    if (i < 0) throw new Error('no song card for ' + ${JSON.stringify(title)});
    __mm.pick(i); return { i, id: __mm.song?.id, title: __mm.song?.title };
  `);
  await phone.ev(`__mm.go('home'); return 1;`);
  const pickedLet = await pickOnPhone('Let It Be');
  const letLaptop = await poll(() => laptop.ev('return __mm.song?.id;'), v => v === 'let-it-be', 5000);
  const letPhone = await poll(() => phone.ev('return __mm.song?.id;'), v => v === 'let-it-be', 3000);
  ok('phone Let It Be tap loads Let It Be on the laptop', letLaptop.ok, `laptop=${letLaptop.v}`);
  ok('phone Let It Be tap keeps Let It Be on the phone',
    letPhone.ok && pickedLet.id === 'let-it-be', `phone=${letPhone.v}`);
  await phone.ev(`__mm.go('play'); return 1;`);
  if (SHOTS) {
    await phone.front(); await sleep(400);
    await phone.shot(join(SHOTS, 'ac1-phone-let-it-be.png'));
    await laptop.front(); await sleep(200);
    await laptop.shot(join(SHOTS, 'ac3-laptop-let-it-be.png'));
  }

  await phone.ev(`__mm.go('home'); return 1;`);
  const pickedCity = await pickOnPhone('City of Stars');
  const cityLaptop = await poll(() => laptop.ev('return __mm.song?.id;'), v => v === 'city-of-stars', 5000);
  const cityPhone = await poll(() => phone.ev('return __mm.song?.id;'), v => v === 'city-of-stars', 3000);
  ok('phone City of Stars tap loads City of Stars on the laptop', cityLaptop.ok, `laptop=${cityLaptop.v}`);
  ok('phone City of Stars tap keeps City of Stars on the phone',
    cityPhone.ok && pickedCity.id === 'city-of-stars', `phone=${cityPhone.v}`);
  await phone.ev(`__mm.go('play'); return 1;`);
  if (SHOTS) {
    await phone.front(); await sleep(400);
    await phone.shot(join(SHOTS, 'ac2-phone-city-of-stars.png'));
    await laptop.front(); await sleep(200);
    await laptop.shot(join(SHOTS, 'ac3-laptop-city-of-stars.png'));
  }

  // standalone phone, upright: no room, so this page is the app. The same tap
  // must still open Let It Be — that is AC1 without the laptop in the way.
  await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?${encodeURIComponent(`${BASE}/learn-m.html`)}`, { method: 'PUT' });
  await sleep(800);
  const aloneTarget = (await targets()).find(t => t.url.includes('learn-m.html') && !t.url.includes('room='));
  if (!aloneTarget) throw new Error('the standalone phone tab never showed up');
  const alone = await attach(aloneTarget, { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  if (!(await poll(() => alone.ev('return !!window.__mm;'), v => v, 5000)).ok)
    throw new Error('standalone phone never exposed window.__mm');
  await alone.ev(`
    const i = [...document.querySelectorAll('.songcard')]
      .findIndex(c => c.querySelector('.st1')?.textContent === 'Let It Be');
    if (i < 0) throw new Error('no Let It Be card');
    __mm.pick(i); return 1;
  `);
  const aloneLet = await alone.ev('return { id: __mm.song?.id, title: document.getElementById("pathTitle").textContent, screen: __mm.screen };');
  ok('standalone phone Let It Be pick opens Let It Be',
    aloneLet.id === 'let-it-be' && aloneLet.title === 'Let It Be',
    `${aloneLet.id} · ${aloneLet.title} · ${aloneLet.screen}`);
  await alone.ev(`__mm.go('play'); return 1;`);
  if (SHOTS) {
    await alone.front(); await sleep(400);
    await alone.shot(join(SHOTS, 'ac1-phone-let-it-be-portrait.png'));
  }
  await alone.ev(`
    __mm.go('home');
    const i = [...document.querySelectorAll('.songcard')]
      .findIndex(c => c.querySelector('.st1')?.textContent === 'City of Stars');
    __mm.pick(i); return __mm.song?.id;
  `);
  const aloneCity = await alone.ev('return { id: __mm.song?.id, title: document.getElementById("pathTitle").textContent };');
  ok('standalone phone City of Stars pick still opens City of Stars',
    aloneCity.id === 'city-of-stars' && aloneCity.title === 'City of Stars',
    `${aloneCity.id} · ${aloneCity.title}`);
  await alone.ev(`__mm.go('play'); return 1;`);
  if (SHOTS) {
    await alone.front(); await sleep(400);
    await alone.shot(join(SHOTS, 'ac2-phone-city-of-stars-portrait.png'));
  }
  alone.close();

  await laptop.ev('__mm.applyStep(2, true); return 1;');
  const step = await poll(() => phone.ev('return __mm.si;'), v => v === 2, 2000);
  ok('phone\'s step follows a laptop step change', step.ok, `phone si=${step.v}`);

  // every step starts with a 4-beat count-in, which would eat into the 6 s budget
  // below for nothing measurable -- so let it finish before timing demo()'s own delay
  await poll(() => laptop.ev('return __mm.engine.position().countIn;'), v => v === false, 6000, 200);
  await phone.ev(`window.__smokeHits = 0; __mm.engine.on('hit', () => window.__smokeHits++); return 1;`);
  await laptop.ev('window.__demoStop = __mm.demo(0.9); return 1;');
  const demo = await poll(
    () => phone.ev(`return { hits: window.__smokeHits, heads: document.querySelectorAll('.hit').length };`),
    v => v && v.hits > 0 && v.heads > 0, 6000, 300);
  ok('demo() on the laptop produces hit events and green noteheads on the phone', demo.ok,
    `hits=${demo.v?.hits ?? 0} heads=${demo.v?.heads ?? 0}`);
  await laptop.ev('window.__demoStop?.(); __mm.engine.stop(); return 1;');   // done with it -- stray notes would confuse Hear, next

  let viewErr = '';
  try { for (const v of ['scroll', 'staff', 'roll', 'fall']) await phone.ev(`__mm.setView('${v}'); return 1;`); }
  catch (e) { viewErr = e.message; }
  ok('phone switches through every view without throwing', !viewErr, viewErr);

  await laptop.click('#outsel [data-out="audio"]');   // Out: Computer -- and the gesture the AudioContext wants
  await sleep(500);                                   // the snapshot with out:'audio' has to reach the phone first
  await phone.click('body');                          // the phone's own gesture, now that it knows sound is coming its way
  // and now the laptop takes the front, because from here on it is the laptop's
  // scheduler being measured and the phone only has to receive. (The checks above are
  // the other way round: they read what the phone *drew*, which needs its rAF.)
  await laptop.front();
  const before = await phone.ev('return window.__synth?.scheduled ?? 0;');
  await laptop.click('#hearBtn');
  // Hear has the same count-in; wait it out so this isn't just re-measuring that
  await poll(() => laptop.ev('return __mm.engine.position().countIn;'), v => v === false, 6000, 200);
  const sched = await poll(() => phone.ev('return window.__synth?.scheduled ?? 0;'), v => v > before, 6000, 300);
  ok('Hear on the laptop schedules notes on the phone\'s synth', sched.ok, `${before} → ${sched.v}`);

  // ---------------------------------------------------------------- the Intro, coached
  // The whole of the pianist's first sitting, driven through the page's own controls:
  // Start over, then Listen, find the notes, and the left hand in time until two passes
  // in a row are clean -- with the phone on the music stand watching it happen. The
  // piano is the one thing that cannot be a click, so demo() and demoWait() stand in
  // for the hands; everything else here is a button or the tempo slider.
  await laptop.ev('__mm.engine.stop(); return 1;');
  await laptop.click('#resetBtn');
  const landed = await laptop.ev(`const q = s => document.querySelector('#overlay ' + s).textContent;
    const p = __mm.plan[__mm.si];
    return { si: __mm.si, title: p.title, kind: p.kind, bars: [p.from + 1, p.to + 1],
             section: __mm.song.sections[p.section].name, done: __mm.done.size,
             otitle: q('.otitle'), osub: q('.osub'), ocoach: q('.ocoach'),
             state: document.getElementById('stepState').textContent };`);
  ok('Start over lands on the Intro: bars 1–4, Listen, nothing to hunt for',
    landed.si === 0 && landed.kind === 'listen' && landed.section === 'Intro'
    && landed.bars[0] === 1 && landed.bars[1] === 4 && landed.done === 0
    && landed.otitle === 'Intro · Listen' && landed.osub.startsWith('bars 1–4')
    && /Intro/.test(landed.state),
    `${landed.otitle} · ${landed.osub} · "${landed.state}"`);
  ok('the coach says what the Intro is for, before a note is played',
    landed.ocoach.includes('vamp'), landed.ocoach);
  if (SHOTS) await laptop.shot(join(SHOTS, 'intro-landing.png'));

  // each step's transport is the step's own: no loop while the app plays it to you,
  // loop for both of yours, and no clock at all while you are finding the notes
  const stepFlags = i => laptop.ev(`__mm.applyStep(${i});
    const on = id => document.getElementById(id).classList.contains('on');
    return { title: __mm.plan[__mm.si].title, loop: __mm.engine.loop, wait: __mm.engine.wait,
             loopBtn: on('loopBtn'), waitBtn: on('waitBtn'),
             slots: [...document.querySelectorAll('#stepMeter .slabel')].map(e => e.textContent) };`);
  const [f0, f1, f2] = [await stepFlags(0), await stepFlags(1), await stepFlags(2)];
  ok('Listen plays once; both of the left hand\'s steps loop, and only "find the notes" waits',
    f0.loop === false && f0.wait === false
    && f1.loop === true && f1.wait === true && f1.loopBtn && f1.waitBtn
    && f2.loop === true && f2.wait === false && f2.loopBtn && !f2.waitBtn,
    `${f0.title}: loop=${f0.loop} · ${f1.title}: loop=${f1.loop} wait=${f1.wait} · ${f2.title}: loop=${f2.loop} wait=${f2.wait}`);
  ok('the meter asks for two passes, and says which one you are on',
    f2.slots.join(' ') === 'Pass 1/2 Pass 2/2', f2.slots.join(' ') || '(no slots)');
  // the step chooses the loop, it does not own it: Loop is still a switch you can throw
  await laptop.click('#loopBtn');
  const loopOff = await laptop.ev('return { loop: __mm.engine.loop, on: document.getElementById(\'loopBtn\').classList.contains(\'on\') };');
  await laptop.click('#loopBtn');
  const loopBack = await laptop.ev('return { loop: __mm.engine.loop, on: document.getElementById(\'loopBtn\').classList.contains(\'on\') };');
  ok('Loop is still yours to turn off and on again on a looping step',
    loopOff.loop === false && !loopOff.on && loopBack.loop === true && loopBack.on,
    `off -> ${loopOff.loop} · on again -> ${loopBack.loop}`);

  // the tempo slider is a control like any other, and 60 bpm is four minutes of check
  await laptop.ev(`__mm.applyStep(0);
    const t = document.getElementById('tempo'); t.value = 200; t.dispatchEvent(new Event('input')); return 1;`);
  // a piano note used to start the idle step; it must not
  await laptop.ev('__mm.receive([0x90, 60, 80]); __mm.receive([0x80, 60, 0]); return 1;');
  const noteIdle = await laptop.ev('return { running: __mm.engine.running, pending: __mm.pending, si: __mm.si };');
  ok('a piano note does not start a waiting step',
    noteIdle.si === 0 && !noteIdle.running && !noteIdle.pending,
    `si=${noteIdle.si} running=${noteIdle.running} pending=${noteIdle.pending}`);
  if (SHOTS) {
    await laptop.shot(join(SHOTS, 'ac3-laptop-note-idle.png'));
    await phone.shot(join(SHOTS, 'ac3-phone-note-idle.png'));
  }
  await laptop.click('#startBtn');
  const startedIdle = await poll(() => laptop.ev('return __mm.engine.running;'), v => v, 4000, 150);
  ok('Start still starts a waiting step', startedIdle.ok, startedIdle.ok ? 'running' : 'still idle');
  if (SHOTS) {
    await laptop.shot(join(SHOTS, 'ac4-laptop-start-starts.png'));
    await phone.shot(join(SHOTS, 'ac4-phone-start-starts.png'));
  }
  const heard = await poll(() => laptop.ev(`const q = s => document.querySelector('#overlay ' + s).textContent;
      return { cls: document.getElementById('overlay').className, hidden: document.getElementById('overlay').hidden,
               title: q('.otitle'), coach: q('.ocoach'), done: [...__mm.done] };`),
    v => v && !v.hidden && v.cls === 'done', 25000, 200);
  ok('listening through once finishes the step and puts the done card up',
    heard.ok && heard.v.done.includes(0) && heard.v.title.startsWith('✓ Listen'),
    `${heard.v?.title} · done ${JSON.stringify(heard.v?.done ?? [])}`);
  ok('the card hands over the next step in the coach\'s words',
    !!heard.v?.coach && /left hand/i.test(heard.v.coach), heard.v?.coach);
  // the same card, on the music stand: the phone reads it off the laptop's overlay
  const card = await poll(() => phone.ev(`return document.getElementById('card').hidden ? null : {
      title: document.getElementById('cTitle').textContent,
      coach: document.getElementById('cCoach').textContent,
      where: document.getElementById('stepWhere').textContent,
      slots: [...document.querySelectorAll('#meter .slabel')].map(e => e.textContent).join(' ') };`),
    v => v && v.title, 4000, 200);
  ok('the phone shows the same done card, and says where in the song it is',
    card.ok && card.v.title === heard.v.title && card.v.coach === heard.v.coach
    && /Intro/.test(card.v.where) && /bars 1–4/.test(card.v.where),
    `${card.v?.title} · ${card.v?.where}`);
  if (SHOTS) { await laptop.shot(join(SHOTS, 'intro-done.png')); await phone.shot(join(SHOTS, 'intro-done-phone.png')); }

  // longer than the old 3 s countdown (10 s when shooting AC1): still on the done card
  await sleep(SHOTS ? 10000 : 4000);
  const stayed = await laptop.ev(`return { si: __mm.si, running: __mm.engine.running, pending: __mm.pending,
    hidden: document.getElementById('overlay').hidden, cls: document.getElementById('overlay').className };`);
  ok('the done card does not auto-advance',
    stayed.si === 0 && !stayed.running && stayed.pending && !stayed.hidden && stayed.cls === 'done',
    `si=${stayed.si} running=${stayed.running} pending=${stayed.pending} ${stayed.cls}`);
  if (SHOTS) {
    await laptop.shot(join(SHOTS, 'ac1-laptop-done-wait.png'));
    await phone.shot(join(SHOTS, 'ac1-phone-done-wait.png'));
  }
  await laptop.ev('__mm.receive([0x90, 62, 80]); __mm.receive([0x80, 62, 0]); return 1;');
  const noteHandoff = await laptop.ev('return { si: __mm.si, running: __mm.engine.running, pending: __mm.pending };');
  ok('a piano note does not skip the done-card handoff',
    noteHandoff.si === 0 && !noteHandoff.running && noteHandoff.pending,
    `si=${noteHandoff.si} running=${noteHandoff.running} pending=${noteHandoff.pending}`);
  await laptop.click('#startBtn');
  const advanced = await poll(() => laptop.ev('return { si: __mm.si, running: __mm.engine.running, pending: __mm.pending };'),
    v => v && v.si === 1 && v.running, 4000, 150);
  ok('Start from the done card loads and starts the next step',
    advanced.ok && advanced.v.running && !advanced.v.pending,
    `si=${advanced.v?.si} running=${advanced.v?.running}`);
  if (SHOTS) {
    await laptop.shot(join(SHOTS, 'ac2-laptop-start-advances.png'));
    await phone.shot(join(SHOTS, 'ac2-phone-start-advances.png'));
  }

  // "find the notes": no clock, the song waits on each group until it is played
  await laptop.ev('__mm.demoWait(); return 1;');
  const found = await poll(() => laptop.ev('return { si: __mm.si, done: [...__mm.done], pending: __mm.pending };'),
    v => v && v.done.includes(1), 30000, 250);
  ok('playing the notes it waits on finishes "find the notes"', found.ok,
    `done ${JSON.stringify(found.v?.done ?? [])}`);
  await poll(() => laptop.ev('return __mm.pending;'), v => v, 4000, 150);
  await laptop.click('#startBtn');
  await poll(() => laptop.ev('return __mm.si;'), v => v === 2, 6000, 150);

  // "in time": one ragged pass first, which has to send the streak back to pass 1
  await poll(() => laptop.ev('return __mm.engine.position().countIn;'), v => v === false, 8000, 150);
  await laptop.ev('window.__ragged = __mm.demo(0.4); return 1;');
  const ragged = await poll(() => laptop.ev(`return { state: document.getElementById('stepState').textContent,
      done: [...__mm.done] };`), v => v && /Pass 1/.test(v.state), 20000, 200);
  ok('a pass under 85% says so and sends the count back to pass 1',
    ragged.ok && /again from pass 1/.test(ragged.v.state) && !ragged.v.done.includes(2), ragged.v?.state);

  // and now two clean ones in a row, which is the step. demo() covers the rest of the
  // pass it is called in, so it is called again as each pass comes round -- and every
  // call's cancel is kept, because a stray lesson note left in flight would land in
  // whatever check runs next
  await laptop.ev(`window.__play = { stops: [] };
    window.__play.id = setInterval(() => { if (__mm.engine.running) window.__play.stops.push(__mm.demo(1)); }, 1200);
    return 1;`);
  const live = await poll(() => laptop.ev(`const s = document.querySelector('#stepMeter .slot');
      return s && { label: s.querySelector('.slabel').textContent, val: s.querySelector('.sval').textContent,
                    cls: s.className };`),
    v => v && /live/.test(v.cls) && /^\d+%$/.test(v.val), 20000, 150);
  ok('the meter fills with the live hit rate while the pass runs',
    live.ok && live.v.label === 'Pass 1/2', `${live.v?.label}: ${live.v?.val}`);
  if (SHOTS) { await laptop.shot(join(SHOTS, 'intro-in-time.png')); await phone.shot(join(SHOTS, 'intro-in-time-phone.png')); }
  const passed2 = await poll(() => laptop.ev('return { done: [...__mm.done], si: __mm.si };'),
    v => v && v.done.includes(2), 40000, 250);
  await laptop.ev(`clearInterval(window.__play?.id); window.__play?.stops.forEach(f => f());
    window.__ragged?.(); return 1;`);
  // "Back to stay": the lesson is over for this run, and the next section starting by
  // itself would play notes under the checks below
  await laptop.click('#prevBtn');
  await laptop.ev('__mm.engine.stop(); return 1;');
  ok('two clean passes in a row finish "left hand in time" — the Intro is done',
    passed2.ok && [0, 1, 2].every(i => passed2.v.done.includes(i)),
    `done ${JSON.stringify(passed2.v?.done ?? [])}`);

  // ---------------------------------------------------------------- the phone drives
  // The laptop is the only writer of the lesson (see host.js / remote.js), so every
  // control on the phone is a command and the value comes back on the next snapshot.
  // Two things that costs, both of which have been on screen:
  //
  //   * a stepper counted from what was on screen, so a second tap inside one round
  //     trip computed the same absolute value and the laptop stepped once for three
  //     presses. It counts from what was *asked for* now, and a burst goes out as one
  //     command -- three POSTs a millisecond apart get a thread each in serve.py and
  //     can be applied in any order, which was the same bug by another route. Both in
  //     `asked` / `ASK_MS` in remote.js.
  //   * the "loaded and waiting" plate is the tutor's, and it used to survive the
  //     laptop leaving the tutor: an "Intro · Listen" plate over free practice.
  await laptop.ev('__mm.setMode("tutor"); __mm.applyStep(0); __mm.engine.stop(); return 1;');
  await laptop.ev(`const t = document.getElementById('tempo'); t.value = 90;
    t.dispatchEvent(new Event('input')); return 1;`);
  await phone.ev('__mm.go("play"); return 1;');
  const sawTempo = await poll(() => phone.ev('return __mm.clock.bpm;'), v => v === 90, 6000, 200);
  ok('the phone is showing the laptop\'s tempo before the taps', sawTempo.ok, `${sawTempo.v} bpm`);
  // three taps in one go, which is three taps inside one round trip
  await phone.ev(`const b = document.getElementById('bpmUp'); b.click(); b.click(); b.click(); return 1;`);
  const stepped = await poll(() => laptop.ev('return __mm.clock.bpm;'), v => v === 105, 6000, 200);
  ok('three quick taps on the phone move the laptop three steps, not one',
    stepped.ok, `90 → ${stepped.v} bpm (want 105)`);
  const settledBpm = await poll(() => phone.ev('return document.getElementById("bpmv").textContent;'),
    v => v === '105', 6000, 200);
  ok('and the phone\'s readout ends up on the laptop\'s answer', settledBpm.ok, `reads ${settledBpm.v}`);

  // A snapshot the laptop published *before* the tap, delivered after it. It leaves the
  // ask standing -- the laptop has not answered yet -- so the number must stay on what
  // was asked for. `syncPlay` used to write clock.bpm flat and put the old tempo back.
  //
  // Arranged rather than waited for: the tap's command is cut off at this tab so the
  // laptop cannot answer, and the crossing snapshot is posted into the room from here
  // with a stamp from before the tap. Timed off a fresh heartbeat, so there is a clear
  // second of runway before the next real one.
  const room = await phone.ev('return __mm.remote.room;');
  const lapBpm = await laptop.ev('return __mm.clock.bpm;');
  const seq0 = await phone.ev('return __mm.remote.state.seq;');
  await poll(() => phone.ev('return __mm.remote.state.seq;'), v => v > seq0, 4000, 100);
  const st = await phone.ev('return { ...__mm.remote.state };');
  await phone.cdp('Network.enable');
  await phone.cdp('Network.setBlockedURLs', { urls: ['*/relay/send*'] });
  await phone.ev('document.getElementById("bpmUp").click(); return 1;');
  await fetch(`${BASE}/relay/send?room=${encodeURIComponent(room)}&client=smoke`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...st, at: st.at + 1, seq: st.seq + 1 }),
  });
  const crossed = await poll(() => phone.ev(`return { seq: __mm.remote.state.seq,
      asked: __mm.remote.asked.bpm ?? null,
      reads: document.getElementById('bpmv').textContent };`),
    v => v && v.seq === st.seq + 1, 4000, 100);
  ok('a heartbeat that crossed a tempo tap is applied, and leaves the ask standing',
    crossed.ok && crossed.v.asked === lapBpm + 5,
    `seq ${st.seq} → ${crossed.v?.seq} · asked=${crossed.v?.asked} (want ${lapBpm + 5})`);
  ok('and it does not put the old tempo back on the readout',
    crossed.v?.reads === String(lapBpm + 5), `reads ${crossed.v?.reads}, want ${lapBpm + 5}`);
  // Held past the coalescing window and a heartbeat, so the command really never left:
  // a burst goes out once, ASK_MS after the last tap, and lifting the block before
  // then would just let it through late.
  await sleep(1400);
  await phone.cdp('Network.setBlockedURLs', { urls: [] });
  // a tap the laptop never heard is not left standing either: a heartbeat published
  // after the ask answers it, with the tempo nobody changed
  const snapped = await poll(async () => ({
    lap: await laptop.ev('return __mm.clock.bpm;'),
    reads: await phone.ev('return document.getElementById("bpmv").textContent;'),
    asked: await phone.ev('return __mm.remote.asked.bpm ?? null;'),
  }), v => v && v.asked === null && v.reads === String(v.lap), 8000, 200);
  ok('a tap the laptop never heard snaps back within a heartbeat',
    snapped.ok && snapped.v.lap === lapBpm,
    `phone reads ${snapped.v?.reads}, the laptop is on ${snapped.v?.lap} (was ${lapBpm})`);

  const plateUp = await poll(() => phone.ev(`return { hidden: document.getElementById('idle').hidden,
      title: document.getElementById('iTitle').textContent };`), v => v && !v.hidden, 6000, 200);
  ok('a paused tutor step puts the plate up on the phone', plateUp.ok, plateUp.v?.title);
  await laptop.ev('__mm.setMode("free"); return 1;');
  const plateGone = await poll(() => phone.ev(`return { hidden: document.getElementById('idle').hidden,
      step: document.getElementById('stepTitle').textContent };`), v => v && v.hidden, 8000, 200);
  ok('and it comes down when the laptop leaves the tutor for free practice',
    plateGone.ok, `idle hidden=${plateGone.v?.hidden} · the phone says "${plateGone.v?.step}"`);
  await laptop.ev('__mm.setMode("tutor"); __mm.engine.stop(); return 1;');

  // ---------------------------------------------------------------- the jam
  // A second player is a second *machine*, and the closest one browser gets to that is
  // a second origin: `localhost` and `127.0.0.1` are the same server, the same room
  // (the server names it, see /relay/info) and two separate localStorages. So the
  // player tab never picks up the remembered "Put it on the phone", and there is only
  // ever one brain in the room -- which is the arrangement the jam is designed around.
  await laptop.ev('__mm.engine.stop(); return 1;');       // no lesson notes under the check
  await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?${encodeURIComponent(`http://localhost:${PORT}/learn.html`)}`, { method: 'PUT' });
  await sleep(800);
  const playerTarget = (await targets()).find(t => t.url.includes('localhost'));
  if (!playerTarget) throw new Error('the second player tab never showed up');
  const player = await attach(playerTarget, { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  if (!(await poll(() => player.ev('return !!window.__mm;'), v => v, 5000)).ok)
    throw new Error('the second player never exposed window.__mm');

  // a real click, because it is also the gesture the AudioContext wants before the
  // other player's notes can come out of this machine's speakers
  await laptop.click('#jamBtn');
  await player.click('#jamBtn');
  const met = await poll(async () => ({
    a: await laptop.ev('return { room: __mm.jam.room, client: __mm.jam.client, players: __mm.jam.players };'),
    b: await player.ev('return { room: __mm.jam.room, client: __mm.jam.client, players: __mm.jam.players };'),
  }), v => v?.a?.players > 0 && v?.b?.players > 0, 8000, 300);
  ok('jam: both players land in the same room and see each other', met.ok
    && met.v.a.room === met.v.b.room, `room ${met.v?.a?.room}/${met.v?.b?.room}`);
  const A = met.v?.a?.client, B = met.v?.b?.client;

  const injectC = 'window.__mm.receive([0x90, 60, 90]); setTimeout(() => window.__mm.receive([0x80, 60, 0]), 120); return 1;';
  const heardOn = tab => tab.ev('return { heard: __mm.jam.heard, from: __mm.jam.last?.from ?? null, n: __mm.jam.last?.data?.[1] ?? null, synth: window.__synth?.scheduled ?? 0 };');

  const bBefore = await heardOn(player);
  const phoneSynth = () => phone.ev('return window.__synth?.scheduled ?? 0;');
  const pBefore = await phoneSynth();
  await laptop.ev(injectC);
  const toB = await poll(() => heardOn(player), v => v && v.heard > bBefore.heard, 5000, 200);
  ok('jam: a note played on the laptop reaches the second player, signed', toB.ok
    && toB.v?.from === A && toB.v?.n === 60, `from=${toB.v?.from} want=${A} n=${toB.v?.n}`);
  ok('jam: the second player actually sounds it', (toB.v?.synth ?? 0) > bBefore.synth,
    `${bBefore.synth} → ${toB.v?.synth}`);

  const aAfterOwn = await heardOn(laptop);
  ok('jam: your own notes are never echoed back to you', aAfterOwn.heard === 0,
    `the laptop heard ${aAfterOwn.heard}`);

  // the phone on the music stand is a screen, not a player: the room's playing goes
  // straight past it. What it does play is the *laptop's* sound, which is why the
  // second player's note reaches it a moment later -- through the laptop's own Out,
  // exactly as a note from the lesson would.
  ok('jam: the phone ignores the room\'s playing', (await phoneSynth()) === pBefore,
    `${pBefore} → ${await phoneSynth()}`);

  await player.ev(injectC);
  const toA = await poll(() => heardOn(laptop), v => v && v.heard > 0, 5000, 200);
  ok('jam: a note played on the second player reaches the laptop, signed', toA.ok
    && toA.v?.from === B && toA.v?.n === 60, `from=${toA.v?.from} want=${B} n=${toA.v?.n}`);
  const onStand = await poll(phoneSynth, v => v > pBefore, 5000, 200);
  ok('jam: and comes out of the phone, because that is where the laptop\'s Out is',
    onStand.ok, `${pBefore} → ${onStand.v}`);

  // over the whole run, not just this instant -- so it has to come last
  const errs = [...laptop.errors, ...phone.errors, ...player.errors];
  ok('no console errors on any tab', errs.length === 0, errs.slice(0, 2).join(' | '));

  if (SHOTS) {
    mkdirSync(SHOTS, { recursive: true });
    await laptop.shot(join(SHOTS, 'laptop.png'));
    await phone.shot(join(SHOTS, 'phone.png'));
  }
  laptop.close(); phone.close();
}

const t0 = Date.now();
main()
  .catch(err => { ok('the run completed', false, err.message); console.error(err); })
  .finally(() => {
    const passed = results.filter(Boolean).length;
    console.log(`\n${passed}/${results.length} checks passed · ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    killAll();
    process.exit(passed === results.length ? 0 : 1);
  });
