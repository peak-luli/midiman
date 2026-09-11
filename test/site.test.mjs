// scripts/site.sh is the list of what the internet gets. It is a list rather than a
// copy of the tree on purpose (docs/ is the company wiki), which means it can go
// stale: a module added to sw.js's shell or a sheet linked from a page that the
// script never learned to copy. So the assembled site is checked against the two
// places the pages say what they need -- the service worker's SHELL and the HTML.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = mkdtempSync(join(tmpdir(), 'midiman-site-'));
execFileSync('bash', [join(ROOT, 'scripts', 'site.sh'), OUT], { cwd: ROOT, stdio: 'pipe' });
test.after(() => rmSync(OUT, { recursive: true, force: true }));

const PAGES = readdirSync(ROOT).filter(f => f.endsWith('.html'));

test('every page in the repo is in the site', () => {
  for (const p of PAGES) assert.ok(existsSync(join(OUT, p)), `${p} missing from the site`);
});

test('everything the pages link is in the site', () => {
  for (const p of PAGES) {
    const html = readFileSync(join(ROOT, p), 'utf8');
    for (const [, ref] of html.matchAll(/\b(?:src|href)="([^"#?]+)"/g)) {
      if (/^(https?:|data:|mailto:)/.test(ref)) continue;
      assert.ok(existsSync(join(OUT, ref)), `${p} needs ${ref}, not in the site`);
    }
  }
});

test('everything the service worker shells is in the site', () => {
  const sw = readFileSync(join(ROOT, 'sw.js'), 'utf8');
  const list = sw.match(/const SHELL = \[([\s\S]*?)\];/)?.[1];
  assert.ok(list, 'sw.js has no SHELL list');
  const files = [...list.matchAll(/'([^']+)'/g)].map(m => m[1]);
  assert.ok(files.length > 20, 'the SHELL list read empty');
  for (const f of files) assert.ok(existsSync(join(OUT, f)), `sw.js shells ${f}, not in the site`);
});

test('every song the index lists is in the site', () => {
  const index = JSON.parse(readFileSync(join(ROOT, 'songs', 'index.json'), 'utf8'));
  const files = (Array.isArray(index) ? index : index.songs ?? []).map(s => s.file ?? s);
  assert.ok(files.length > 0, 'songs/index.json lists nothing');
  for (const f of files) assert.ok(existsSync(join(OUT, 'songs', f)), `songs/${f} not in the site`);
});

test('the laptop-only things stay off the internet', () => {
  for (const f of ['serve.py', 'serve.sh', 'phone.sh', 'docs', 'design', 'test', '.env', '.env.example', 'scripts', '.github', 'certs'])
    assert.ok(!existsSync(join(OUT, f)), `${f} is in the site`);
});
