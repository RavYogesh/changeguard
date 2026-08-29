import { env } from 'cloudflare:workers';
import { recordRunEvent, type RunEvent } from '@/db/store';

export async function POST(request: Request) {
  if (env.RUNNER_INGEST_TOKEN) {
    const expected = `Bearer ${env.RUNNER_INGEST_TOKEN}`;
    if (request.headers.get('authorization') !== expected) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (Number(request.headers.get('content-length') ?? 0) > 1_000_000) return Response.json({ error: 'Payload too large' }, { status: 413 });

  const event = await request.json() as RunEvent;
  const error = validate(event);
  if (error) return Response.json({ error }, { status: 400 });
  await recordRunEvent(event);
  if (event.alerts?.length && env.SLACK_WEBHOOK_URL) await sendSlackAlert(event);
  return Response.json({ ok: true }, { status: 202 });
}

function validate(event: RunEvent) {
  if (!event || typeof event !== 'object') return 'Expected a JSON object';
  if (!event.runId || event.runId.length > 100) return 'runId is required';
  if (!event.repository || event.repository.length > 200) return 'repository is required';
  if (!['queued', 'running', 'passed', 'failed'].includes(event.status)) return 'status is invalid';
  if ((event.tests?.length ?? 0) > 500 || (event.alerts?.length ?? 0) > 100) return 'Event exceeds item limits';
  return null;
}

async function sendSlackAlert(event: RunEvent) {
  const alert = event.alerts?.[0];
  const more = Math.max(0, (event.alerts?.length ?? 1) - 1);
  await fetch(env.SLACK_WEBHOOK_URL!, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: `ChangeGuard found ${event.alerts?.length} breaking risk(s) in ${event.repository}. ${alert?.severity.toUpperCase()}: ${alert?.title}${more ? ` (+${more} more)` : ''}` }),
  });
}
