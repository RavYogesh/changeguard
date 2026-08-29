import { index, integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const repositories = sqliteTable('repositories', {
  id: text('id').primaryKey(),
  fullName: text('full_name').notNull().unique(),
  stack: text('stack').notNull(),
  testCommand: text('test_command').notNull(),
  coverage: integer('coverage').notNull().default(0),
  status: text('status').notNull().default('healthy'),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  lastScanAt: text('last_scan_at'),
  createdAt: text('created_at').notNull(),
});

export const runs = sqliteTable('runs', {
  id: text('id').primaryKey(),
  repositoryId: text('repository_id').notNull().references(() => repositories.id),
  trigger: text('trigger').notNull(),
  commitSha: text('commit_sha'),
  status: text('status').notNull(),
  existingPassed: integer('existing_passed', { mode: 'boolean' }).notNull().default(false),
  candidates: integer('candidates').notNull().default(0),
  accepted: integer('accepted').notNull().default(0),
  rejected: integer('rejected').notNull().default(0),
  durationMs: integer('duration_ms').notNull().default(0),
  createdAt: text('created_at').notNull(),
  completedAt: text('completed_at'),
}, (table) => [
  index('idx_runs_repository_created').on(table.repositoryId, table.createdAt),
  index('idx_runs_status_created').on(table.status, table.createdAt),
]);

export const generatedTests = sqliteTable('generated_tests', {
  id: text('id').primaryKey(),
  repositoryId: text('repository_id').notNull().references(() => repositories.id),
  runId: text('run_id').notNull().references(() => runs.id),
  path: text('path').notNull(),
  targetFile: text('target_file').notNull(),
  framework: text('framework').notNull(),
  status: text('status').notNull(),
  mutationKills: integer('mutation_kills').notNull().default(0),
  confidence: real('confidence').notNull().default(0),
  createdAt: text('created_at').notNull(),
}, (table) => [
  index('idx_tests_repository_status').on(table.repositoryId, table.status),
  index('idx_tests_run').on(table.runId),
]);

export const alerts = sqliteTable('alerts', {
  id: text('id').primaryKey(),
  repositoryId: text('repository_id').notNull().references(() => repositories.id),
  runId: text('run_id').notNull().references(() => runs.id),
  severity: text('severity').notNull(),
  title: text('title').notNull(),
  evidence: text('evidence').notNull(),
  status: text('status').notNull().default('open'),
  createdAt: text('created_at').notNull(),
}, (table) => [
  index('idx_alerts_status_created').on(table.status, table.createdAt),
  index('idx_alerts_repository').on(table.repositoryId),
]);
