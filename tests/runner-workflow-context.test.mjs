import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const workflow = readFileSync(new URL('../.github/workflows/runner.yml', import.meta.url), 'utf8');

test('provider and finalize jobs consume the prepared refresh context', () => {
  assert.match(workflow, /refresh_id: \$\{\{ steps\.capture-context\.outputs\.refresh_id \}\}/);
  assert.match(workflow, /snapshot_at: \$\{\{ steps\.capture-context\.outputs\.snapshot_at \}\}/);
  assert.match(workflow, /PREPARED_REFRESH_ID: \$\{\{ needs\.prepare-fanout\.outputs\.refresh_id \}\}/);
  assert.match(workflow, /run: node src\/atlas\/scripts\/resolve-fanout-context\.mjs/);
  assert.match(workflow, /RUN_CONTEXT_ID: \$\{\{ github\.event\.inputs\.job_run_id \|\| format\('\{0\}:\{1\}', github\.event\.inputs\.job, github\.run_id\) \}\}/);
});

test('installed bundle cache uses the fetched archive SHA and lockfiles', () => {
  assert.equal((workflow.match(/id: bundle-deps-cache/g) || []).length, 3);
  assert.match(workflow, /path: \.runner-bundle\/node_modules/);
  assert.match(workflow, /steps\.fetch-bundle\.outputs\.sha256/);
  assert.match(workflow, /hashFiles\('\.runner-bundle\/package-lock\.json'/);
});

test('provider retries set the existing incomplete-part recovery flag', () => {
  assert.match(workflow, /PREPARED_RUN_ATTEMPT: \$\{\{ needs\.prepare-fanout\.outputs\.context_attempt \}\}/);
  assert.match(workflow, /Resolve prepared fanout context/);
});
