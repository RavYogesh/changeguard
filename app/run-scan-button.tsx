'use client';

import { Check, LoaderCircle, Play, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';

type State = 'idle' | 'running' | 'queued' | 'error';

export function RunScanButton() {
  const [state, setState] = useState<State>('idle');
  const [message, setMessage] = useState('');

  async function runScan() {
    setState('running');
    setMessage('');
    try {
      const response = await fetch('/api/scans', { method: 'POST' });
      const result = await response.json() as { dispatch?: string; runs?: unknown[]; error?: string };
      if (!response.ok) throw new Error(result.error ?? 'Could not start the scan');
      setState('queued');
      setMessage(`${result.runs?.length ?? 0} repositories queued via ${result.dispatch === 'github' ? 'GitHub Actions' : 'the local queue'}.`);
      window.setTimeout(() => setState('idle'), 4000);
    } catch (error) {
      setState('error');
      setMessage(error instanceof Error ? error.message : 'Could not start the scan');
    }
  }

  return <div className="relative">
    <Button size="lg" onClick={runScan} disabled={state === 'running'} aria-describedby={message ? 'scan-status' : undefined}>
      {state === 'running' ? <LoaderCircle className="animate-spin" /> : state === 'queued' ? <Check /> : state === 'error' ? <TriangleAlert /> : <Play />}
      {state === 'running' ? 'Queuing…' : state === 'queued' ? 'Queued' : state === 'error' ? 'Retry scan' : 'Run scan'}
    </Button>
    {message && <output id="scan-status" className={`absolute right-0 top-11 z-20 w-72 rounded-lg border bg-card p-3 text-xs shadow-xl ${state === 'error' ? 'text-destructive' : 'text-foreground'}`}>{message}</output>}
  </div>;
}
