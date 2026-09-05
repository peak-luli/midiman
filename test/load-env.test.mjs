// The serve path loads a gitignored .env so a token can live on the laptop
// without being typed on every ./serve.sh. Non-empty shell-exported vars win;
// values are never printed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync as run } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LOADER = join(ROOT, 'scripts', 'load-env.sh');

const DUMMY_KEYS = [
  'MIDIMAN_FROM_FILE',
  'MIDIMAN_ALREADY',
  'MIDIMAN_COMMENTED',
  'MIDIMAN_QUOTED_DOUBLE',
  'MIDIMAN_QUOTED_SINGLE',
  'MIDIMAN_EMPTY_THEN',
  'MIDIMAN_TRIMMED',
  'MIDIMAN_KEPT_INNER',
];

function dumpAfterLoad(envFile, extraEnv = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'midiman-env-'));
  writeFileSync(join(dir, '.env'), envFile);
  const env = { ...process.env, ...extraEnv };
  // Isolate the dummy keys so a developer's real .env cannot leak into the assert.
  for (const k of DUMMY_KEYS) {
    if (!(k in extraEnv)) delete env[k];
  }
  const script = [
    'set -euo pipefail',
    `cd ${JSON.stringify(dir)}`,
    `. ${JSON.stringify(LOADER)}`,
    'printf "FROM_FILE=%s\\n" "${MIDIMAN_FROM_FILE-UNSET}"',
    'printf "ALREADY=%s\\n" "${MIDIMAN_ALREADY-UNSET}"',
    'printf "COMMENTED=%s\\n" "${MIDIMAN_COMMENTED-UNSET}"',
    'printf "QUOTED_DOUBLE=%s\\n" "${MIDIMAN_QUOTED_DOUBLE-UNSET}"',
    'printf "QUOTED_SINGLE=%s\\n" "${MIDIMAN_QUOTED_SINGLE-UNSET}"',
    'printf "EMPTY_THEN=%s\\n" "${MIDIMAN_EMPTY_THEN-UNSET}"',
    'printf "TRIMMED=%s\\n" "${MIDIMAN_TRIMMED-UNSET}"',
    'printf "KEPT_INNER=%s\\n" "${MIDIMAN_KEPT_INNER-UNSET}"',
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

test('load-env.sh strips matching single or double quotes around a value', () => {
  const out = dumpAfterLoad([
    'MIDIMAN_QUOTED_DOUBLE="double-quoted"',
    "MIDIMAN_QUOTED_SINGLE='single-quoted'",
    'MIDIMAN_FROM_FILE="github_pat_dummy_not_a_secret"',
    'MIDIMAN_ALREADY=  \'padded-quoted\'  ',
    'MIDIMAN_KEPT_INNER="  inner spaces  "',
  ].join('\n'));
  assert.match(out, /QUOTED_DOUBLE=double-quoted/);
  assert.match(out, /QUOTED_SINGLE=single-quoted/);
  assert.match(out, /FROM_FILE=github_pat_dummy_not_a_secret/);
  assert.match(out, /ALREADY=padded-quoted/);
  assert.match(out, /KEPT_INNER=  inner spaces  /);
  assert.doesNotMatch(out, /QUOTED_DOUBLE="/);
  assert.doesNotMatch(out, /QUOTED_SINGLE='/);
  assert.doesNotMatch(out, /FROM_FILE="/);
});

test('load-env.sh leaves mismatched quotes on the value', () => {
  const out = dumpAfterLoad('MIDIMAN_FROM_FILE="no-close\nMIDIMAN_ALREADY=\'mixed"\n');
  assert.match(out, /FROM_FILE="no-close/);
  assert.match(out, /ALREADY='mixed"/);
});

test('load-env.sh treats empty as unset so a later real value can fill it', () => {
  const fromFileAfterBlank = dumpAfterLoad([
    'MIDIMAN_EMPTY_THEN=',
    'MIDIMAN_EMPTY_THEN=later-wins',
    'MIDIMAN_FROM_FILE=from-file',
  ].join('\n'));
  assert.match(fromFileAfterBlank, /EMPTY_THEN=later-wins/);
  assert.match(fromFileAfterBlank, /FROM_FILE=from-file/);

  const emptyShellThenFile = dumpAfterLoad(
    'MIDIMAN_FROM_FILE=from-file\nMIDIMAN_ALREADY=from-file\n',
    { MIDIMAN_FROM_FILE: '' },
  );
  assert.match(emptyShellThenFile, /FROM_FILE=from-file/);
  assert.match(emptyShellThenFile, /ALREADY=from-file/);
});

test('load-env.sh trims whitespace around unquoted values', () => {
  const out = dumpAfterLoad('MIDIMAN_TRIMMED=  padded-value  \nMIDIMAN_FROM_FILE=from-file\n');
  assert.match(out, /TRIMMED=padded-value/);
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
  assert.match(example, /MIDIMAN_FEEDBACK_WEBHOOK_URL/);
  assert.match(example, /MIDIMAN_FEEDBACK_WEBHOOK_KEY/);
  assert.match(example, /MIDIMAN_FEEDBACK_WEBHOOK_HEADER/);
  assert.doesNotMatch(example, /ghp_|github_pat_[A-Za-z0-9]/);
  assert.doesNotMatch(example, /crsr_[A-Za-z0-9]/);
});

test('load-env.sh never prints assignment values', () => {
  const src = readFileSync(LOADER, 'utf8');
  assert.doesNotMatch(src, /\becho\b/);
  assert.doesNotMatch(src, /\bprintf\b/);
});
