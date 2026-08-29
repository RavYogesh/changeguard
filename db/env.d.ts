declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    GITHUB_TOKEN?: string;
    GITHUB_ORG?: string;
    RUNNER_REPOSITORY?: string;
    RUNNER_INGEST_TOKEN?: string;
    SLACK_WEBHOOK_URL?: string;
  }
}
