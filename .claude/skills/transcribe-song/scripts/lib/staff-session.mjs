// A headless Learn page with a song loaded and the staff showing.
//
// Both engraving checks want the same thing: the real app, serving the real repo,
// with the real song document -- not a re-implementation of the view. So they share
// this: serve.py on the loopback, Chromium on learn.html, the song picked from the
// catalog, free practice + staff view, and `window.__mm.setRange` (the hook the app
// already exposes for headless checks) to move over the piece a few bars at a time.
//
// Console warnings are collected rather than printed, because the one that matters
// -- "staff: voice N has X engraved elements for Y cells" -- is how the staff says
// abcjs engraved a different number of things than the song has cells, which means
// the bar's written text and its engraving have come apart.

import { execSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

/** The repo root: whatever is above this skill, or MIDIMAN_ROOT, or --root. */
export function repoRoot(override) {
  const tries = [override, process.env.MIDIMAN_ROOT].filter(Boolean).map(p => resolve(p));
  for (let d = HERE; d !== dirname(d); d = dirname(d)) tries.push(d);
  for (const d of tries) if (existsSync(join(d, 'songs', 'index.json'))) return d;
  throw new Error('no repo root found (no songs/index.json above this script); pass --root');
}

/** Playwright lives on the box, not in this repo, which has no dependencies. */
async function playwright() {
  try { return await import('playwright'); } catch { /* not resolvable from here */ }
  const g = execSync('npm root -g', { encoding: 'utf8' }).trim();
  return import(join(g, 'playwright', 'index.mjs'));
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function serve(root, port, base) {
  const p = spawn('python3', [join(root, 'serve.py'), String(port), '127.0.0.1'],
                  { cwd: root, stdio: 'ignore' });
  for (let i = 0; i < 150; i++) {
    try { if ((await fetch(`${base}/learn.html`)).ok) return p; } catch { /* not up yet */ }
    await sleep(100);
  }
  p.kill();
  throw new Error(`serve.py never answered on ${base} -- is the port taken?`);
}

/**
 * Open the staff on `song` and hand `fn` a driver.
 *
 * `over(from, to)` sets the visible bar range (1-based, inclusive) and waits for the
 * engraving to settle; `shot(path)` writes a PNG of the sheet; `warnings` is
 * everything the page has said so far. Options that are not the song document itself
 * -- `beams` -- are injected by intercepting the JSON on its way to the browser, so
 * a check never edits the file on disk.
 */
export async function withStaff({ song, root, port = 8850, beams = null, headless = true },
                                fn) {
  const ROOT = repoRoot(root);
  const base = `http://127.0.0.1:${port}`;
  const server = await serve(ROOT, port, base);
  const { chromium } = await playwright();
  const browser = await chromium.launch({ headless });
  const warnings = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
    page.on('console', m => {
      if (m.type() === 'warning' || m.type() === 'error') warnings.push(`${m.type()}: ${m.text()}`);
    });
    page.on('pageerror', e => warnings.push(`pageerror: ${e.message}`));

    if (beams) {
      await page.route(`**/songs/${song}.json`, async route => {
        const res = await route.fetch();
        const doc = JSON.parse(await res.text());
        doc.beams = beams;
        await route.fulfill({ response: res, body: JSON.stringify(doc),
                              headers: { ...res.headers(), 'content-type': 'application/json' } });
      });
    }

    await page.goto(`${base}/learn.html`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__mm?.song?.nbars > 0, null, { timeout: 30000 });

    // the catalog's first song is the one that loads; the picker is the .trk row at
    // the song's own position in songs/index.json, which is the order it renders in
    if (await page.evaluate(() => window.__mm.song.id) !== song) {
      const idx = await (await fetch(`${base}/songs/index.json`)).json();
      const i = idx.songs.indexOf(`${song}.json`);
      if (i < 0) throw new Error(`songs/index.json does not list ${song}.json`);
      await page.evaluate(n => document.querySelector(`.trk[data-i="${n}"]`).click(), i);
      await page.waitForFunction(id => window.__mm.song?.id === id, song, { timeout: 15000 });
    }

    const info = await page.evaluate(() => ({ id: window.__mm.song.id, nbars: window.__mm.song.nbars,
                                              beams: window.__mm.song.beams ?? 'half' }));
    await page.evaluate(() => { window.__mm.setMode('free'); window.__mm.setView('staff'); });

    const PAD = 24;   // the redrawn beams paint outside the sheet's own box
    const driver = {
      page, info, warnings,
      async over(from, to) {
        await page.evaluate(([a, b]) => window.__mm.setRange(a - 1, b - 1), [from, to]);
        await page.waitForFunction(() => document.querySelector('#viewStaff svg .abcjs-note'),
                                   null, { timeout: 15000 });
        // abcjs draws, then the view moves every note onto its time grid and redraws
        // the beams; both are synchronous, so one frame is enough
        await page.evaluate(() => new Promise(requestAnimationFrame));
      },
      async shot(path) {
        const clip = await page.evaluate(pad => {
          const r = document.querySelector('#viewStaff .ssheet').getBoundingClientRect();
          return { x: Math.max(0, r.x - pad), y: Math.max(0, r.y - pad),
                   width: r.width + 2 * pad, height: r.height + 2 * pad };
        }, PAD);
        await page.screenshot({ path, clip });
      },
    };
    return await fn(driver);
  } finally {
    await browser.close();
    server.kill();
  }
}

/** `--name value` / `--flag` parsing, small enough not to be worth a dependency. */
export function args(argv = process.argv.slice(2)) {
  const opt = (name, def) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : (i >= 0 ? true : def);
  };
  return opt;
}

/** "12", "12-30" or "" -> [from, to] clamped to the song. */
export function barRange(spec, nbars) {
  const m = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(String(spec ?? '').trim());
  if (!m) return [1, nbars];
  const from = Math.max(1, Math.min(+m[1], nbars));
  return [from, Math.max(from, Math.min(+(m[2] ?? nbars), nbars))];
}
