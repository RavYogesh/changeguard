import { env } from 'cloudflare:workers';
import { queueOrganizationScan } from '@/db/store';

export async function POST() {
  const runs = await queueOrganizationScan();
  let dispatch: 'github' | 'local_queue' = 'local_queue';

  if (env.GITHUB_TOKEN && env.RUNNER_REPOSITORY) {
    const response = await fetch(`https://api.github.com/repos/${env.RUNNER_REPOSITORY}/actions/workflows/changeguard-org.yml/dispatches`, {
      method: 'POST',
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${env.GITHUB_TOKEN}`,
        'content-type': 'application/json',
        'user-agent': 'ChangeGuard-Control-Plane',
        'x-github-api-version': '2022-11-28',
      },
      body: JSON.stringify({ ref: 'main', inputs: { organization: env.GITHUB_ORG ?? '', run_ids: runs.map((run) => run.id).join(',') } }),
    });
    if (!response.ok) return Response.json({ error: `GitHub dispatch failed with ${response.status}`, runs }, { status: 502 });
    dispatch = 'github';
  }

  return Response.json({ dispatch, runs }, { status: 202 });
}
