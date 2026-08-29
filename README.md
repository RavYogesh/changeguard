# ChangeGuard

ChangeGuard is a working control plane and repository runner for continuously growing a reviewed regression-test corpus. It supports mixed frontend/backend estates, records scan history in D1, reports evidence-backed risks, and exposes a responsive dashboard.

The key design decision is conservative admission: generated tests are untrusted until they pass path/side-effect checks, run with the complete suite twice, and optionally pass your mutation-testing command.

## What is included

- Vinext/React dashboard with live D1-backed repository, corpus, run, and alert data.
- `POST /api/scans` to queue manual organization scans and optionally dispatch an explicitly configured runner workflow.
- Authenticated `POST /api/events` for CI run/test/alert ingestion, plus optional Slack-compatible webhook alerts.
- Standalone Python runner with no third-party Python dependencies.
- Automatic React/Node, Python/Pytest, and Go test-command detection, plus explicit monorepo configuration.
- Strict Responses API structured output, bounded changed-file context, secret redaction, safe-path checks, repeatability checks, and optional mutation/usefulness validation.
- Reviewable local artifacts under `.changeguard/artifacts/<run-id>/`; no branch or PR is pushed automatically.

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the full flow and rationale.

## Run the dashboard

```bash
pnpm install
pnpm dev
```

The local dashboard is served at `http://localhost:3000`. Local D1 data is initialized and seeded on first use.

## Run a repository scan

Copy `runner/changeguard.py` into an opted-in repository as `.changeguard/changeguard.py`, copy `.changeguard/config.example.json` to `.changeguard/config.json`, and tailor the setup/test commands. Then run:

```bash
export OPENAI_API_KEY="..."
export CHANGEGUARD_API_URL="https://your-changeguard-site.example"
export CHANGEGUARD_INGEST_TOKEN="..."
python .changeguard/changeguard.py --repo .
```

By default the runner cleans generated test files after packaging accepted candidates. Pass `--write-accepted` only in an ephemeral checkout when you want the validated candidates left in place for a reviewed test-only change.

For a PR, add `--base-ref origin/main` (or the actual base branch). For a daily run, omit it; the runner analyzes production files changed during `daily_change_hours`.

## Schedule safely

Add the runner command to each repository's existing CI scheduler only after that repository opts in and its owners approve the source-egress policy. Give the job read-only repository permissions. Upload `.changeguard/artifacts/` for review and use the runner's exit code as the status check. Do not grant organization-wide write access merely to automate corpus promotion.

Recommended cadence:

- Pull request: `--base-ref` scan, baseline suite, and reproducible regression blocking.
- Nightly: recent-change mining and full suite, leaving candidates in a reviewable artifact.
- Weekly: mutation testing and a larger end-to-end/contract suite.

## Configuration

The example configuration covers a React/Playwright frontend plus Python backend. Important keys:

- `setup_commands` and `test_commands`: the authoritative project commands.
- `test_roots`: the only top-level directories generated tests may use.
- `exclude`: files never sent as generation context.
- `max_files`, `max_file_bytes`, `max_context_bytes`: source-egress budgets.
- `validation_command`: project command with `{test_path}` and `{target_file}` placeholders.
- `require_validation`: reject every candidate unless the validation command succeeds.
- `product_context`: short invariants such as money units, authorization behavior, and compatibility promises.

The generator uses the OpenAI Responses API with strict JSON-schema output. Set `OPENAI_MODEL` to a model available to your project; the sample default is `gpt-5-mini`. The implementation follows the [official Responses API create contract](https://developers.openai.com/api/reference/cli/resources/responses/methods/create).

## Control-plane environment

Copy `.env.example` to `.env.local` for local use. Hosted secrets should be configured through the hosting control plane.

- `RUNNER_INGEST_TOKEN`: bearer token required by `/api/events` in production.
- `SLACK_WEBHOOK_URL`: optional breaking-risk alert destination.
- `GITHUB_TOKEN`, `GITHUB_ORG`, `RUNNER_REPOSITORY`: optional manual dispatch integration; leave unset for queue-only mode.

## API event shape

```json
{
  "runId": "daily-123",
  "repository": "acme/payments-api",
  "status": "failed",
  "existingPassed": true,
  "candidates": 7,
  "accepted": 3,
  "rejected": 3,
  "tests": [
    { "path": "tests/retry.spec.ts", "targetFile": "src/retry.ts", "framework": "vitest", "status": "accepted", "mutationKills": 1, "confidence": 0.9 }
  ],
  "alerts": [
    { "severity": "high", "title": "Retry can double-capture", "evidence": "Reproducible failing assertion..." }
  ]
}
```

## What to add before broad production use

- GitHub App installation flow and per-repository consent UI.
- Ephemeral container sandbox with outbound network disabled for generated tests.
- Language-specific mutation adapters (Stryker, mutmut, PIT, or equivalent).
- OpenAPI/GraphQL and event-schema compatibility gates.
- SSO/RBAC and per-organization data isolation.
- Cost budgets, test deduplication, and flaky-test quarantine history.
