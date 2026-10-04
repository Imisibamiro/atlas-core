import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveRunContext } from '../scripts/resolve-run-context.mjs';

const env = { RUN_CONTEXT_ID: 'scheduled-id', RUN_CONTEXT_STARTED_AT: '2026-10-04T19:30:00Z', GITHUB_RUN_ID: '123', GITHUB_REPOSITORY: 'example/runner', GITHUB_RUN_ATTEMPT: '1' };
test('first dispatch keeps the scheduler identity without making API calls', async () => {
  assert.deepEqual(await resolveRunContext(env, () => assert.fail('unexpected lookup')), { id: env.RUN_CONTEXT_ID, startedAt: env.RUN_CONTEXT_STARTED_AT });
});
test('every job in a full rerun shares a fresh identity and observation timestamp', async () => {
  const fetcher = async url => {
    assert.equal(url, 'https://api.github.com/repos/example/runner/actions/runs/123/attempts/3');
    return Response.json({ run_attempt: 3, run_started_at: '2026-10-04T20:14:41Z' });
  };
  const rerun = { ...env, GITHUB_RUN_ATTEMPT: '3' };
  const contexts = await Promise.all([1, 2, 3].map(() => resolveRunContext(rerun, fetcher)));
  for (const context of contexts) assert.deepEqual(context, { id: 'scheduled-id:attempt:123:3', startedAt: '2026-10-04T20:14:41.000Z' });
  assert.notEqual(contexts[0].id, (await resolveRunContext(env)).id);
});
test('failed or mismatched attempt lookup cannot reuse stale context', async () => {
  const rerun = { ...env, GITHUB_RUN_ATTEMPT: '2' };
  await assert.rejects(resolveRunContext(rerun, async () => new Response('', { status: 403 })), /lookup failed/);
  for (const response of [{ run_attempt: 1, run_started_at: env.RUN_CONTEXT_STARTED_AT }, { run_attempt: 2, run_started_at: 'invalid' }]) {
    await assert.rejects(resolveRunContext(rerun, async () => Response.json(response)), /invalid attempt/);
  }
});

test('manual dispatch without a timestamp uses the shared GitHub attempt start', async () => {
  const context = await resolveRunContext({ ...env, RUN_CONTEXT_STARTED_AT: '' }, async () => Response.json({ run_attempt: 1, run_started_at: '2026-10-04T21:00:00Z' }));
  assert.deepEqual(context, { id: env.RUN_CONTEXT_ID, startedAt: '2026-10-04T21:00:00.000Z' });
});
