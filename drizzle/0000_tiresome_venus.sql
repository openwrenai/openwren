CREATE TABLE `task_deps` (
	`task_id` integer NOT NULL,
	`depends_on` integer NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`depends_on`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_taskdeps_task` ON `task_deps` (`task_id`);--> statement-breakpoint
CREATE INDEX `idx_taskdeps_depends` ON `task_deps` (`depends_on`);--> statement-breakpoint
CREATE TABLE `task_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`task_id` integer NOT NULL,
	`agent_id` text NOT NULL,
	`timestamp` integer NOT NULL,
	`entry` text NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_tasklog_task` ON `task_log` (`task_id`);--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`slug` text NOT NULL,
	`workflow_id` integer NOT NULL,
	`agent_id` text NOT NULL,
	`assigned_by` text NOT NULL,
	`parent_task` integer,
	`prompt` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`created_at` integer NOT NULL,
	`started_at` integer,
	`completed_at` integer,
	`result_summary` text,
	`deliverables` text,
	`error` text,
	`session_path` text,
	FOREIGN KEY (`workflow_id`) REFERENCES `workflows`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tasks_slug_unique` ON `tasks` (`slug`);--> statement-breakpoint
CREATE INDEX `idx_tasks_workflow` ON `tasks` (`workflow_id`);--> statement-breakpoint
CREATE TABLE `workflows` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`manager_agent_id` text NOT NULL,
	`status` text DEFAULT 'running' NOT NULL,
	`started_at` integer NOT NULL,
	`completed_at` integer,
	`summary` text,
	`session_path` text,
	`metadata` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workflows_slug_unique` ON `workflows` (`slug`);