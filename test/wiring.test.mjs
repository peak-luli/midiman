// Does each page's entry module actually fit the page and the modules around it?
//
// The three pages have no build step: nothing links them, nothing type-checks them,
// and a browser only finds out when it loads. Two mistakes then look identical from
// the piano -- the page draws, and nothing works:
//
//   * an entry module imports a name a module no longer exports. The whole graph
//     fails to link, so not one line of app.js runs: no song list, no handlers, no
//     step can be started.
//   * an entry module reaches for an element id the page has lost. The reach throws
//     in the middle of the wiring, and everything below it -- the transport, the
//     MIDI, loading the song -- never happens. Same symptom.
//
// Both come from one file changing without the other, which is exactly what happens
// when several changes land in quick succession. So they are checked here, cheaply,
// on every `npm test`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const rel = f => relative(root, f);
const read = f => readFileSync(f, 'utf8');

/** Every `import ... from '<relative>'` in a source file, with the names it takes. */
function importsOf(src) {
  const re = /import\s*(?:([\w$]+)\s*,\s*)?(?:\{([^}]*)\}|\*\s*as\s*[\w$]+|([\w$]+))?\s*from\s*['"]([^'"]+)['"]/g;
  const out = [];
  for (const m of src.matchAll(re)) {
    if (!m[4].startsWith('.')) continue;                 // bare specifiers are not ours
    out.push({
      spec: m[4],
      names: (m[2] ?? '').split(',').map(s => s.trim().split(/\s+as\s+/)[0].trim()).filter(Boolean),
      dflt: m[1] || m[3] || null,
    });
  }
  return out;
}

/** The whole module graph reachable from `entry`, walked breadth-first. */
async function walk(entry, seen = new Set(), problems = []) {
  if (seen.has(entry)) return problems;
  seen.add(entry);
  for (const { spec, names, dflt } of importsOf(read(entry))) {
    const file = resolve(dirname(entry), spec);
    if (!existsSync(file)) { problems.push(`${rel(entry)} imports a file that is not there: ${spec}`); continue; }
    let mod;
    try { mod = await import(pathToFileURL(file).href); }
    catch (e) { problems.push(`${rel(entry)} -> ${spec}: ${e.message.split('\n')[0]}`); await walk(file, seen, problems); continue; }
    for (const n of names) if (!(n in mod)) problems.push(`${rel(entry)} imports { ${n} } from ${spec}, which does not export it`);
    if (dflt && !('default' in mod)) problems.push(`${rel(entry)} imports a default from ${spec}, which has none`);
    await walk(file, seen, problems);
  }
  return problems;
}

// A module that touches the DOM at import time cannot be imported under node; none of
// ours do, and this test is also what keeps it that way.
const ENTRIES = [
  'src/learn/app.js', 'src/learn/mobile.js', 'src/learn/remote.js',
  'src/app.js', 'src/looper/app.js',
];

for (const entry of ENTRIES) {
  test(`every module ${entry} reaches exports what it is asked for`, async () => {
    const problems = await walk(resolve(root, entry));
    assert.deepEqual(problems, [], '\n  ' + problems.join('\n  '));
  });
}

// ---------------------------------------------------------------- ids
// `$('x')` / `getElementById('x')` in the module, `id="x"` in the page it belongs to.
//
// `mobile.js` reaches almost nothing that way: it goes through the `el` Proxy, where
// the property name *is* the id (`el.leaveBtn`). Matching only `$('x')` left the whole
// phone page unchecked -- renaming an id in the module and not in the page passed
// `npm test` and broke only at the music stand -- so `el.<name>` counts too, in the
// modules that build `el` as that Proxy. The other three name their bag by hand
// (`rec: $('recBtn')`), where the property is not the id and `$('x')` already covers
// it. The one exception is `el.<name>?.`: the `?.` is how this codebase says "if the
// page happens to have one", so those reaches are deliberately optional.
const PAGES = [
  ['src/learn/app.js', 'learn.html'],
  ['src/learn/mobile.js', 'learn-m.html'],
  ['src/app.js', 'index.html'],
  ['src/looper/app.js', 'looper.html'],
];

const byProxy = src => /\bel\s*=\s*new Proxy\b/.test(src);

const idsWanted = src => new Set([
  ...[...src.matchAll(/(?:\$|getElementById)\(\s*['"]([\w-]+)['"]\s*\)/g)].map(m => m[1]),
  ...(byProxy(src)
    ? [...src.matchAll(/\bel\.([A-Za-z_$][\w$]*)\b(?!\s*\?\.)/g)].map(m => m[1])
    : []),
]);

for (const [mod, page] of PAGES) {
  test(`${page} has every element ${mod} reaches for`, () => {
    const html = read(resolve(root, page));
    const has = new Set([...html.matchAll(/\sid=["']([\w-]+)["']/g)].map(m => m[1]));
    const missing = [...idsWanted(read(resolve(root, mod)))].filter(id => !has.has(id));
    assert.deepEqual(missing, [], `${page} is missing: ${missing.join(', ')}`);
  });
}

// ---------------------------------------------------------------- the overlay
// The step overlay is a contract between three files with nothing linking them: app.js
// writes its parts by class, learn.html has to have them, and host.js reads two of
// them straight back out of the DOM to build the phone's done card. Losing one of
// those classes takes the coach's line off the laptop *and* off the music stand, and
// silently -- `querySelector(...)?.textContent ?? ''` is an empty string, not an error.
test('the step overlay has every part app.js writes and host.js reads', () => {
  const html = read(resolve(root, 'learn.html'));
  const app = read(resolve(root, 'src/learn/app.js'));
  const host = read(resolve(root, 'src/learn/host.js'));
  for (const part of ['otitle', 'osub', 'ocoach', 'ohint']) {
    assert.match(html, new RegExp(`class="${part}"`), `learn.html has no .${part}`);
    assert.ok(app.includes(`.${part}`), `app.js never writes .${part}`);
  }
  for (const part of ['otitle', 'osub', 'ocoach', 'ohint'])
    assert.ok(host.includes(`.${part}`), `host.js never reads .${part} into the phone's card`);
});
