// Chrome on Android auto-translates English UI when the system language is not
// English. MidiMan is English-only for now; the shells opt out so coach copy
// and control names stay as written. #51.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = f => readFileSync(join(ROOT, f), 'utf8');

const PAGES = [
  'learn-m.html',
  'learn.html',
  'index.html',
  'looper.html',
  'guitar.html',
];

for (const page of PAGES) {
  test(`${page} opts out of browser auto-translate`, () => {
    const html = read(page);
    const root = html.match(/<html\b[^>]*>/)?.[0];
    assert.ok(root, `${page} has an <html> tag`);
    assert.match(root, /\btranslate="no"/, `${page} <html> has translate="no"`);
    assert.match(root, /\bclass="[^"]*\bnotranslate\b/, `${page} <html> has class="notranslate"`);
    assert.match(html, /<meta\s+name="google"\s+content="notranslate"\s*>/,
      `${page} has Google notranslate meta`);
    assert.match(html, /<meta\s+name="robots"\s+content="notranslate"\s*>/,
      `${page} has robots notranslate meta`);
  });
}
