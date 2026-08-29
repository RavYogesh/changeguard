CREATE TABLE `alerts` (
	`id` text PRIMARY KEY NOT NULL,
	`repository_id` text NOT NULL,
	`run_id` text NOT NULL,
	`severity` text NOT NULL,
	`title` text NOT NULL,
	`evidence` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`repository_id`) REFERENCES `repositories`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_alerts_status_created` ON `alerts` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_alerts_repository` ON `alerts` (`repository_id`);--> statement-breakpoint
CREATE TABLE `generated_tests` (
	`id` text PRIMARY KEY NOT NULL,
	`repository_id` text NOT NULL,
	`run_id` text NOT NULL,
	`path` text NOT NULL,
	`target_file` text NOT NULL,
	`framework` text NOT NULL,
	`status` text NOT NULL,
	`mutation_kills` integer DEFAULT 0 NOT NULL,
	`confidence` real DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`repository_id`) REFERENCES `repositories`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_tests_repository_status` ON `generated_tests` (`repository_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_tests_run` ON `generated_tests` (`run_id`);--> statement-breakpoint
CREATE TABLE `repositories` (
	`id` text PRIMARY KEY NOT NULL,
	`full_name` text NOT NULL,
	`stack` text NOT NULL,
	`test_command` text NOT NULL,
	`coverage` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'healthy' NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`last_scan_at` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `repositories_full_name_unique` ON `repositories` (`full_name`);--> statement-breakpoint
CREATE TABLE `runs` (
	`id` text PRIMARY KEY NOT NULL,
	`repository_id` text NOT NULL,
	`trigger` text NOT NULL,
	`commit_sha` text,
	`status` text NOT NULL,
	`existing_passed` integer DEFAULT false NOT NULL,
	`candidates` integer DEFAULT 0 NOT NULL,
	`accepted` integer DEFAULT 0 NOT NULL,
	`rejected` integer DEFAULT 0 NOT NULL,
	`duration_ms` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`completed_at` text,
	FOREIGN KEY (`repository_id`) REFERENCES `repositories`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_runs_repository_created` ON `runs` (`repository_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_runs_status_created` ON `runs` (`status`,`created_at`);