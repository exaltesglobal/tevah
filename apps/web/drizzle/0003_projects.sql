CREATE TABLE `projects` (
	`id` char(36) NOT NULL,
	`org_id` char(36) NOT NULL,
	`name` varchar(200) NOT NULL,
	`contact_id` char(36),
	`description` text,
	`status` enum('active','on_hold','done') NOT NULL DEFAULT 'active',
	`start_date` date,
	`due_date` date,
	`archived` boolean NOT NULL DEFAULT false,
	`external_ref` varchar(100),
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	`updated_at` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `projects_id` PRIMARY KEY(`id`),
	CONSTRAINT `projects_org_external_ref_key` UNIQUE(`org_id`,`external_ref`)
);
--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` char(36) NOT NULL,
	`org_id` char(36) NOT NULL,
	`project_id` char(36) NOT NULL,
	`title` varchar(300) NOT NULL,
	`description` text,
	`status` enum('todo','in_progress','waiting','done','cancelled') NOT NULL DEFAULT 'todo',
	`priority` int NOT NULL DEFAULT 0,
	`assignee_id` char(36),
	`due_date` date,
	`position` int NOT NULL DEFAULT 0,
	`estimate_minutes` int,
	`completed_at` timestamp(3),
	`created_by` char(36),
	`external_ref` varchar(100),
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	`updated_at` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `tasks_id` PRIMARY KEY(`id`),
	CONSTRAINT `tasks_org_external_ref_key` UNIQUE(`org_id`,`external_ref`)
);
--> statement-breakpoint
CREATE TABLE `time_entries` (
	`id` char(36) NOT NULL,
	`org_id` char(36) NOT NULL,
	`project_id` char(36) NOT NULL,
	`task_id` char(36),
	`user_id` char(36) NOT NULL,
	`date` date NOT NULL,
	`minutes` int NOT NULL,
	`note` varchar(500),
	`billable` boolean NOT NULL DEFAULT true,
	`external_ref` varchar(100),
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `time_entries_id` PRIMARY KEY(`id`),
	CONSTRAINT `time_entries_org_external_ref_key` UNIQUE(`org_id`,`external_ref`)
);
--> statement-breakpoint
ALTER TABLE `projects` ADD CONSTRAINT `projects_org_id_orgs_id_fk` FOREIGN KEY (`org_id`) REFERENCES `orgs`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `projects` ADD CONSTRAINT `projects_contact_id_contacts_id_fk` FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `tasks` ADD CONSTRAINT `tasks_org_id_orgs_id_fk` FOREIGN KEY (`org_id`) REFERENCES `orgs`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `tasks` ADD CONSTRAINT `tasks_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `tasks` ADD CONSTRAINT `tasks_assignee_id_users_id_fk` FOREIGN KEY (`assignee_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `tasks` ADD CONSTRAINT `tasks_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `time_entries` ADD CONSTRAINT `time_entries_org_id_orgs_id_fk` FOREIGN KEY (`org_id`) REFERENCES `orgs`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `time_entries` ADD CONSTRAINT `time_entries_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `time_entries` ADD CONSTRAINT `time_entries_task_id_tasks_id_fk` FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `time_entries` ADD CONSTRAINT `time_entries_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `projects_org_name_idx` ON `projects` (`org_id`,`name`);--> statement-breakpoint
CREATE INDEX `tasks_org_project_status_idx` ON `tasks` (`org_id`,`project_id`,`status`,`position`);--> statement-breakpoint
CREATE INDEX `tasks_org_assignee_idx` ON `tasks` (`org_id`,`assignee_id`,`status`);--> statement-breakpoint
CREATE INDEX `time_entries_org_project_date_idx` ON `time_entries` (`org_id`,`project_id`,`date`);--> statement-breakpoint
CREATE INDEX `time_entries_org_user_date_idx` ON `time_entries` (`org_id`,`user_id`,`date`);