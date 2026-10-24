CREATE TABLE `accounts` (
	`id` char(36) NOT NULL,
	`org_id` char(36) NOT NULL,
	`code` varchar(20) NOT NULL,
	`name` varchar(200) NOT NULL,
	`type` enum('asset','liability','equity','income','expense') NOT NULL,
	`system_tag` varchar(40),
	`archived` boolean NOT NULL DEFAULT false,
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `accounts_id` PRIMARY KEY(`id`),
	CONSTRAINT `accounts_org_code_key` UNIQUE(`org_id`,`code`),
	CONSTRAINT `accounts_org_tag_key` UNIQUE(`org_id`,`system_tag`)
);
--> statement-breakpoint
CREATE TABLE `audit_log` (
	`id` char(36) NOT NULL,
	`org_id` char(36) NOT NULL,
	`user_id` char(36),
	`action` varchar(20) NOT NULL,
	`entity` varchar(40) NOT NULL,
	`entity_id` varchar(64),
	`data` json,
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `audit_log_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `contacts` (
	`id` char(36) NOT NULL,
	`org_id` char(36) NOT NULL,
	`kind` enum('customer','vendor','both') NOT NULL,
	`name` varchar(200) NOT NULL,
	`gstin` varchar(15),
	`pan` varchar(10),
	`email` varchar(200),
	`phone` varchar(30),
	`address_line1` varchar(200),
	`address_line2` varchar(200),
	`city` varchar(100),
	`state_code` varchar(2),
	`pincode` varchar(6),
	`tds_rate_bps` int,
	`notes` text,
	`archived` boolean NOT NULL DEFAULT false,
	`external_ref` varchar(100),
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	`updated_at` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `contacts_id` PRIMARY KEY(`id`),
	CONSTRAINT `contacts_org_external_ref_key` UNIQUE(`org_id`,`external_ref`)
);
--> statement-breakpoint
CREATE TABLE `journal_entries` (
	`id` char(36) NOT NULL,
	`org_id` char(36) NOT NULL,
	`journal_id` char(36) NOT NULL,
	`number` varchar(30),
	`date` date NOT NULL,
	`reference` varchar(100),
	`narration` text,
	`status` enum('draft','posted','cancelled') NOT NULL DEFAULT 'draft',
	`source_ref` varchar(60),
	`external_ref` varchar(100),
	`created_by` char(36),
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	`posted_at` timestamp(3),
	CONSTRAINT `journal_entries_id` PRIMARY KEY(`id`),
	CONSTRAINT `journal_entries_org_number_key` UNIQUE(`org_id`,`journal_id`,`number`),
	CONSTRAINT `journal_entries_org_external_ref_key` UNIQUE(`org_id`,`external_ref`)
);
--> statement-breakpoint
CREATE TABLE `journal_lines` (
	`id` char(36) NOT NULL,
	`org_id` char(36) NOT NULL,
	`entry_id` char(36) NOT NULL,
	`account_id` char(36) NOT NULL,
	`contact_id` char(36),
	`description` varchar(300),
	`debit` bigint NOT NULL DEFAULT 0,
	`credit` bigint NOT NULL DEFAULT 0,
	CONSTRAINT `journal_lines_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `journals` (
	`id` char(36) NOT NULL,
	`org_id` char(36) NOT NULL,
	`code` varchar(10) NOT NULL,
	`name` varchar(100) NOT NULL,
	`type` enum('sales','purchase','bank','cash','general') NOT NULL,
	`default_account_id` char(36),
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `journals_id` PRIMARY KEY(`id`),
	CONSTRAINT `journals_org_code_key` UNIQUE(`org_id`,`code`)
);
--> statement-breakpoint
CREATE TABLE `memberships` (
	`org_id` char(36) NOT NULL,
	`user_id` char(36) NOT NULL,
	`role` enum('admin','accountant','staff','viewer') NOT NULL,
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `memberships_org_id_user_id_pk` PRIMARY KEY(`org_id`,`user_id`)
);
--> statement-breakpoint
CREATE TABLE `orgs` (
	`id` char(36) NOT NULL,
	`name` varchar(200) NOT NULL,
	`legal_name` varchar(200) NOT NULL,
	`gstin` varchar(15),
	`pan` varchar(10),
	`tan` varchar(10),
	`state_code` varchar(2) NOT NULL,
	`address_line1` varchar(200),
	`address_line2` varchar(200),
	`city` varchar(100),
	`pincode` varchar(6),
	`email` varchar(200),
	`phone` varchar(30),
	`fy_start_month` int NOT NULL DEFAULT 4,
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `orgs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `products` (
	`id` char(36) NOT NULL,
	`org_id` char(36) NOT NULL,
	`name` varchar(200) NOT NULL,
	`type` enum('service','goods') NOT NULL DEFAULT 'service',
	`hsn_sac` varchar(8),
	`unit` varchar(20) NOT NULL DEFAULT 'NOS',
	`sale_price` bigint NOT NULL DEFAULT 0,
	`purchase_price` bigint NOT NULL DEFAULT 0,
	`gst_rate_bps` int NOT NULL DEFAULT 1800,
	`income_account_id` char(36),
	`expense_account_id` char(36),
	`archived` boolean NOT NULL DEFAULT false,
	`external_ref` varchar(100),
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	`updated_at` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `products_id` PRIMARY KEY(`id`),
	CONSTRAINT `products_org_external_ref_key` UNIQUE(`org_id`,`external_ref`)
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` char(64) NOT NULL,
	`user_id` char(36) NOT NULL,
	`org_id` char(36) NOT NULL,
	`expires_at` timestamp(3) NOT NULL,
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `sessions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` char(36) NOT NULL,
	`email` varchar(200) NOT NULL,
	`name` varchar(200) NOT NULL,
	`password_hash` varchar(255) NOT NULL,
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `users_email_key` UNIQUE(`email`)
);
--> statement-breakpoint
ALTER TABLE `accounts` ADD CONSTRAINT `accounts_org_id_orgs_id_fk` FOREIGN KEY (`org_id`) REFERENCES `orgs`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `audit_log` ADD CONSTRAINT `audit_log_org_id_orgs_id_fk` FOREIGN KEY (`org_id`) REFERENCES `orgs`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `audit_log` ADD CONSTRAINT `audit_log_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `contacts` ADD CONSTRAINT `contacts_org_id_orgs_id_fk` FOREIGN KEY (`org_id`) REFERENCES `orgs`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `journal_entries` ADD CONSTRAINT `journal_entries_org_id_orgs_id_fk` FOREIGN KEY (`org_id`) REFERENCES `orgs`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `journal_entries` ADD CONSTRAINT `journal_entries_journal_id_journals_id_fk` FOREIGN KEY (`journal_id`) REFERENCES `journals`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `journal_entries` ADD CONSTRAINT `journal_entries_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `journal_lines` ADD CONSTRAINT `journal_lines_org_id_orgs_id_fk` FOREIGN KEY (`org_id`) REFERENCES `orgs`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `journal_lines` ADD CONSTRAINT `journal_lines_entry_id_journal_entries_id_fk` FOREIGN KEY (`entry_id`) REFERENCES `journal_entries`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `journal_lines` ADD CONSTRAINT `journal_lines_account_id_accounts_id_fk` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `journal_lines` ADD CONSTRAINT `journal_lines_contact_id_contacts_id_fk` FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `journals` ADD CONSTRAINT `journals_org_id_orgs_id_fk` FOREIGN KEY (`org_id`) REFERENCES `orgs`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `journals` ADD CONSTRAINT `journals_default_account_id_accounts_id_fk` FOREIGN KEY (`default_account_id`) REFERENCES `accounts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `memberships` ADD CONSTRAINT `memberships_org_id_orgs_id_fk` FOREIGN KEY (`org_id`) REFERENCES `orgs`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `memberships` ADD CONSTRAINT `memberships_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `products` ADD CONSTRAINT `products_org_id_orgs_id_fk` FOREIGN KEY (`org_id`) REFERENCES `orgs`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `products` ADD CONSTRAINT `products_income_account_id_accounts_id_fk` FOREIGN KEY (`income_account_id`) REFERENCES `accounts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `products` ADD CONSTRAINT `products_expense_account_id_accounts_id_fk` FOREIGN KEY (`expense_account_id`) REFERENCES `accounts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `sessions` ADD CONSTRAINT `sessions_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `sessions` ADD CONSTRAINT `sessions_org_id_orgs_id_fk` FOREIGN KEY (`org_id`) REFERENCES `orgs`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `audit_log_org_at_idx` ON `audit_log` (`org_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `contacts_org_name_idx` ON `contacts` (`org_id`,`name`);--> statement-breakpoint
CREATE INDEX `journal_entries_org_date_idx` ON `journal_entries` (`org_id`,`date`);--> statement-breakpoint
CREATE INDEX `journal_lines_entry_idx` ON `journal_lines` (`entry_id`);--> statement-breakpoint
CREATE INDEX `journal_lines_org_account_idx` ON `journal_lines` (`org_id`,`account_id`);--> statement-breakpoint
CREATE INDEX `products_org_name_idx` ON `products` (`org_id`,`name`);