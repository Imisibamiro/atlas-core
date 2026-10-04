import { pathToFileURL } from 'node:url';

// All jobs in an attempt must derive the same context without masked job outputs.
export async function resolveRunContext(env, fetcher = fetch) {
  const attempt = Number(env.GITHUB_RUN_ATTEMPT || 1);
  if (!Number.isSafeInteger(attempt) || attempt < 1) throw new Error('Invalid run attempt');
  const id = String(env.RUN_CONTEXT_ID || '').trim();
  if (!id || /[\r\n]/.test(id)) throw new Error('Invalid run context ID');
  if (attempt === 1 && env.RUN_CONTEXT_STARTED_AT) return { id, startedAt: env.RUN_CONTEXT_STARTED_AT };
  const response = await fetcher(`${env.GITHUB_API_URL || 'https://api.github.com'}/repos/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}/attempts/${attempt}`, {
    headers: { Authorization: `Bearer ${env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Run context lookup failed (${response.status})`);
  const run = await response.json();
  if (Number(run.run_attempt) !== attempt || !Number.isFinite(Date.parse(run.run_started_at))) {
    throw new Error('Run context lookup returned an invalid attempt');
  }
  return { id: attempt === 1 ? id : `${id}:attempt:${env.GITHUB_RUN_ID}:${attempt}`, startedAt: new Date(run.run_started_at).toISOString() };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify(await resolveRunContext(process.env)));
}
