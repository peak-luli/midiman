// The serve path loads a gitignored .env so a token can live on the laptop
// without being typed on every ./serve.sh. Shell-exported vars win; values
// are never printed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync as run } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LOADER = join(ROOT, 'scripts', 'load-env.sh');

function dumpAfterLoad(envFile, extraEnv = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'midiman-env-'));
  writeFileSync(join(dir, '.env'), envFile);
  const env = { ...process.env, ...extraEnv };
  // Isolate the dummy keys so a developer's real .env cannot leak into the assert.
  for (const k of ['MIDIMAN_FROM_FILE', 'MIDIMAN_ALREADY', 'MIDIMAN_COMMENTED']) {
    if (!(k in extraEnv)) delete env[k];
  }
  const script = [
    'set -euo pipefail',
    `cd ${JSON.stringify(dir)}`,
    `. ${JSON.stringify(LOADER)}`,
    'printf "FROM_FILE=%s\\n" "${MIDIMAN_FROM_FILE-UNSET}"',
    'printf "ALREADY=%s\\n" "${MIDIMAN_ALREADY-UNSET}"',
    'printf "COMMENTED=%s\\n" "${MIDIMAN_COMMENTED-UNSET}"',
  ].join('\n');
  return run('bash', ['-c', script], { encoding: 'utf8', env });
}

test('load-env.sh exports KEY=VALUE and skips comments and blanks', () => {
  const out = dumpAfterLoad([
    '# a comment',
    '',
    'MIDIMAN_FROM_FILE=from-file',
    '  # indented comment',
    '# MIDIMAN_COMMENTED=should-not-load-if-commented',
    '',
  ].join('\n'));
  assert.match(out, /FROM_FILE=from-file/);
  assert.match(out, /COMMENTED=UNSET/);
  assert.doesNotMatch(out, /should-not-load/);
});

test('load-env.sh does not override a variable already set in the shell', () => {
  const out = dumpAfterLoad(
    'MIDIMAN_ALREADY=from-file\nMIDIMAN_FROM_FILE=from-file\n',
    { MIDIMAN_ALREADY: 'from-shell' },
  );
  assert.match(out, /ALREADY=from-shell/);
  assert.match(out, /FROM_FILE=from-file/);
});

test('serve.sh and phone.sh source the loader before exec', () => {
  for (const name of ['serve.sh', 'phone.sh']) {
    const src = readFileSync(join(ROOT, name), 'utf8');
    assert.match(src, /scripts\/load-env\.sh/, `${name} sources load-env.sh`);
    assert.match(src, /\. \.\/scripts\/load-env\.sh/, `${name} sources it, not execs it`);
  }
});

test('.gitignore lists .env and .env.example is placeholders only', () => {
  const ignore = readFileSync(join(ROOT, '.gitignore'), 'utf8');
  assert.match(ignore, /^\.env$/m);
  const example = readFileSync(join(ROOT, '.env.example'), 'utf8');
  assert.match(example, /^MIDIMAN_GITHUB_TOKEN=$/m);
  assert.match(example, /MIDIMAN_FEEDBACK_REPO/);
  assert.match(example, /MIDIMAN_FEEDBACK_ISSUE/);
  assert.match(example, /MIDIMAN_FEEDBACK_LABEL/);
  assert.doesNotMatch(example, /ghp_|github_pat_[A-Za-z0-9]/);
});
