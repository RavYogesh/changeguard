import { env } from 'cloudflare:workers';

export type DashboardRepository = {
  id: string;
  name: string;
  stack: string;
  coverage: number;
  tests: number;
  added: number;
  status: string;
  lastScanAt: string | null;
};

export type DashboardSnapshot = {
  summary: { protectionScore: number; tests: number; repositories: number; risks: number; acceptedLastRun: number };
  repositories: DashboardRepository[];
  alerts: Array<{ id: string; repository: string; severity: string; title: string; evidence: string; createdAt: string }>;
  trend: number[];
};

export type RunEvent = {
  runId: string;
  repository: string;
  stack?: string;
  testCommand?: string;
  trigger?: string;
  commitSha?: string;
  status: 'queued' | 'running' | 'passed' | 'failed';
  existingPassed?: boolean;
  coverage?: number;
  candidates?: number;
  accepted?: number;
  rejected?: number;
  durationMs?: number;
  tests?: Array<{ id?: string; path: string; targetFile: string; framework: string; status: string; mutationKills?: number; confidence?: number }>;
  alerts?: Array<{ id?: string; severity: 'high' | 'medium' | 'low'; title: string; evidence: string }>;
};

function d1() {
  if (!env.DB) throw new Error('D1 binding DB is required.');
  return env.DB;
}

let initialized = false;

export async function ensureSchema() {
  if (initialized) return;
  const db = d1();
  const statements = [
    `CREATE TABLE IF NOT EXISTS repositories (id TEXT PRIMARY KEY, full_name TEXT NOT NULL UNIQUE, stack TEXT NOT NULL, test_command TEXT NOT NULL, coverage INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'healthy', active INTEGER NOT NULL DEFAULT 1, last_scan_at TEXT, created_at TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, repository_id TEXT NOT NULL REFERENCES repositories(id), trigger TEXT NOT NULL, commit_sha TEXT, status TEXT NOT NULL, existing_passed INTEGER NOT NULL DEFAULT 0, candidates INTEGER NOT NULL DEFAULT 0, accepted INTEGER NOT NULL DEFAULT 0, rejected INTEGER NOT NULL DEFAULT 0, duration_ms INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, completed_at TEXT)`,
    `CREATE TABLE IF NOT EXISTS generated_tests (id TEXT PRIMARY KEY, repository_id TEXT NOT NULL REFERENCES repositories(id), run_id TEXT NOT NULL REFERENCES runs(id), path TEXT NOT NULL, target_file TEXT NOT NULL, framework TEXT NOT NULL, status TEXT NOT NULL, mutation_kills INTEGER NOT NULL DEFAULT 0, confidence REAL NOT NULL DEFAULT 0, created_at TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS alerts (id TEXT PRIMARY KEY, repository_id TEXT NOT NULL REFERENCES repositories(id), run_id TEXT NOT NULL REFERENCES runs(id), severity TEXT NOT NULL, title TEXT NOT NULL, evidence TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open', created_at TEXT NOT NULL)`,
    `CREATE INDEX IF NOT EXISTS idx_runs_repository_created ON runs(repository_id, created_at)`,
    `CREATE INDEX IF NOT EXISTS idx_runs_status_created ON runs(status, created_at)`,
    `CREATE INDEX IF NOT EXISTS idx_tests_repository_status ON generated_tests(repository_id, status)`,
    `CREATE INDEX IF NOT EXISTS idx_tests_run ON generated_tests(run_id)`,
    `CREATE INDEX IF NOT EXISTS idx_alerts_status_created ON alerts(status, created_at)`,
    `CREATE INDEX IF NOT EXISTS idx_alerts_repository ON alerts(repository_id)`,
  ];
  await db.batch(statements.map((statement) => db.prepare(statement)));
  await db.prepare('PRAGMA optimize').run();
  await seedIfEmpty();
  initialized = true;
}

async function seedIfEmpty() {
  const db = d1();
  const row = await db.prepare('SELECT COUNT(*) AS count FROM repositories').first<{ count: number }>();
  if ((row?.count ?? 0) > 0) return;
  const now = new Date();
  const completedAt = new Date(now.getTime() - 18 * 60_000).toISOString();
  const createdAt = new Date(now.getTime() - 24 * 60_000).toISOString();
  const repositories = [
    ['repo_checkout', 'checkout-web', 'React · Playwright', 'pnpm test', 84, 'healthy'],
    ['repo_payments', 'payments-api', 'Node · Vitest', 'pnpm test', 78, 'risk'],
    ['repo_identity', 'identity-service', 'Python · Pytest', 'python -m pytest -q', 91, 'healthy'],
  ] as const;
  const statements = repositories.map((repo) => db.prepare(`INSERT INTO repositories (id, full_name, stack, test_command, coverage, status, active, last_scan_at, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`).bind(...repo, completedAt, createdAt));
  for (const [index, repo] of repositories.entries()) {
    const runId = `seed_run_${index}`;
    statements.push(db.prepare(`INSERT INTO runs (id, repository_id, trigger, commit_sha, status, existing_passed, candidates, accepted, rejected, duration_ms, created_at, completed_at) VALUES (?, ?, 'schedule', 'seed', 'passed', 1, ?, ?, ?, ?, ?, ?)`).bind(runId, repo[0], 24 - index * 5, 18 - index * 3, 6 - index * 2, 145000 + index * 23000, createdAt, completedAt));
    for (let testIndex = 0; testIndex < 18 - index * 3; testIndex += 1) {
      statements.push(db.prepare(`INSERT INTO generated_tests (id, repository_id, run_id, path, target_file, framework, status, mutation_kills, confidence, created_at) VALUES (?, ?, ?, ?, ?, ?, 'accepted', ?, ?, ?)`).bind(`seed_test_${index}_${testIndex}`, repo[0], runId, `tests/generated/test_${testIndex}.spec`, `src/module_${testIndex}.ts`, index === 2 ? 'pytest' : 'vitest', testIndex % 4 === 0 ? 1 : 0, 0.82, completedAt));
    }
  }
  statements.push(db.prepare(`INSERT INTO alerts (id, repository_id, run_id, severity, title, evidence, status, created_at) VALUES ('seed_alert_1', 'repo_payments', 'seed_run_1', 'high', 'Retry path can double-capture payment', 'Generated regression fails when the capture request times out after the provider accepted it.', 'open', ?), ('seed_alert_2', 'repo_checkout', 'seed_run_0', 'medium', 'Expired coupon can be reused', 'Boundary test reproduces reuse at the exact expiry timestamp.', 'open', ?)`).bind(completedAt, completedAt));
  await db.batch(statements);
}

export async function getDashboardSnapshot(): Promise<DashboardSnapshot> {
  await ensureSchema();
  const db = d1();
  const [summary, repoResult, alertResult, trendResult] = await Promise.all([
    db.prepare(`SELECT (SELECT COUNT(*) FROM repositories WHERE active = 1) repositories, (SELECT COUNT(*) FROM generated_tests WHERE status = 'accepted') tests, (SELECT COUNT(*) FROM alerts WHERE status = 'open') risks, COALESCE((SELECT accepted FROM runs WHERE status IN ('passed','failed') ORDER BY created_at DESC LIMIT 1), 0) accepted_last_run`).first<Record<string, number>>(),
    db.prepare(`SELECT r.id, r.full_name name, r.stack, r.coverage, r.status, r.last_scan_at lastScanAt, COUNT(t.id) tests, COALESCE((SELECT accepted FROM runs ru WHERE ru.repository_id = r.id ORDER BY ru.created_at DESC LIMIT 1), 0) added FROM repositories r LEFT JOIN generated_tests t ON t.repository_id = r.id AND t.status = 'accepted' WHERE r.active = 1 GROUP BY r.id ORDER BY r.last_scan_at DESC LIMIT 8`).all<DashboardRepository>(),
    db.prepare(`SELECT a.id, r.full_name repository, a.severity, a.title, a.evidence, a.created_at createdAt FROM alerts a JOIN repositories r ON r.id = a.repository_id WHERE a.status = 'open' ORDER BY CASE a.severity WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, a.created_at DESC LIMIT 5`).all<{ id: string; repository: string; severity: string; title: string; evidence: string; createdAt: string }>(),
    db.prepare(`SELECT SUM(accepted) accepted FROM runs WHERE status IN ('passed','failed') GROUP BY substr(created_at, 1, 10) ORDER BY substr(created_at, 1, 10) DESC LIMIT 12`).all<{ accepted: number }>(),
  ]);
  const repositories = Number(summary?.repositories ?? 0);
  const tests = Number(summary?.tests ?? 0);
  const risks = Number(summary?.risks ?? 0);
  const acceptedLastRun = Number(summary?.accepted_last_run ?? 0);
  const averageCoverage = repoResult.results.length ? repoResult.results.reduce((sum, repo) => sum + Number(repo.coverage), 0) / repoResult.results.length : 0;
  const protectionScore = Math.max(0, Math.min(100, Math.round(averageCoverage - risks * 2 + Math.min(8, Math.log10(tests + 1) * 2))));
  const observed = trendResult.results.map((row) => Number(row.accepted)).reverse();
  const trend = [...[54, 61, 57, 68, 64, 72, 76, 73, 82, 79, 88, 91].slice(observed.length), ...observed].slice(-12);
  return { summary: { protectionScore, tests, repositories, risks, acceptedLastRun }, repositories: repoResult.results, alerts: alertResult.results, trend };
}

export async function queueOrganizationScan() {
  await ensureSchema();
  const db = d1();
  const repos = await db.prepare('SELECT id, full_name name FROM repositories WHERE active = 1').all<{ id: string; name: string }>();
  const createdAt = new Date().toISOString();
  const runs = repos.results.map((repo) => ({ id: crypto.randomUUID(), repository: repo.name, repositoryId: repo.id }));
  if (runs.length) await db.batch(runs.map((run) => db.prepare(`INSERT INTO runs (id, repository_id, trigger, status, created_at) VALUES (?, ?, 'manual', 'queued', ?)`).bind(run.id, run.repositoryId, createdAt)));
  return runs;
}

export async function recordRunEvent(event: RunEvent) {
  await ensureSchema();
  const db = d1();
  const repoId = `repo_${await sha256(event.repository)}`.slice(0, 40);
  const now = new Date().toISOString();
  await db.prepare(`INSERT INTO repositories (id, full_name, stack, test_command, coverage, status, active, last_scan_at, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?) ON CONFLICT(full_name) DO UPDATE SET stack = excluded.stack, test_command = excluded.test_command, coverage = excluded.coverage, status = excluded.status, last_scan_at = excluded.last_scan_at`).bind(repoId, event.repository, event.stack ?? 'Unknown', event.testCommand ?? 'configured in CI', event.coverage ?? 0, event.alerts?.length ? 'risk' : 'healthy', now, now).run();
  await db.prepare(`INSERT INTO runs (id, repository_id, trigger, commit_sha, status, existing_passed, candidates, accepted, rejected, duration_ms, created_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET status = excluded.status, existing_passed = excluded.existing_passed, candidates = excluded.candidates, accepted = excluded.accepted, rejected = excluded.rejected, duration_ms = excluded.duration_ms, completed_at = excluded.completed_at`).bind(event.runId, repoId, event.trigger ?? 'schedule', event.commitSha ?? null, event.status, event.existingPassed ? 1 : 0, event.candidates ?? 0, event.accepted ?? 0, event.rejected ?? 0, event.durationMs ?? 0, now, ['passed', 'failed'].includes(event.status) ? now : null).run();
  const statements: D1PreparedStatement[] = [];
  for (const test of event.tests ?? []) statements.push(db.prepare(`INSERT OR REPLACE INTO generated_tests (id, repository_id, run_id, path, target_file, framework, status, mutation_kills, confidence, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(test.id ?? crypto.randomUUID(), repoId, event.runId, test.path, test.targetFile, test.framework, test.status, test.mutationKills ?? 0, test.confidence ?? 0, now));
  for (const alert of event.alerts ?? []) statements.push(db.prepare(`INSERT OR REPLACE INTO alerts (id, repository_id, run_id, severity, title, evidence, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'open', ?)`).bind(alert.id ?? crypto.randomUUID(), repoId, event.runId, alert.severity, alert.title, alert.evidence, now));
  if (statements.length) await db.batch(statements);
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
