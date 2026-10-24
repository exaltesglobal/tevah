CREATE TABLE `app_payments` (
	`id` char(36) NOT NULL,
	`org_id` char(36) NOT NULL,
	`app_id` char(36) NOT NULL,
	`external_id` varchar(100) NOT NULL,
	`event` varchar(60) NOT NULL,
	`status` enum('invoiced','ignored','failed') NOT NULL,
	`amount` bigint NOT NULL DEFAULT 0,
	`customer_name` varchar(200),
	`customer_email` varchar(200),
	`document_id` char(36),
	`payment_id` char(36),
	`error` text,
	`email_status` enum('pending','sent','failed','off') NOT NULL DEFAULT 'off',
	`email_error` text,
	`emailed_at` timestamp(3),
	`payload` text,
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `app_payments_id` PRIMARY KEY(`id`),
	CONSTRAINT `app_payments_app_external_key` UNIQUE(`org_id`,`app_id`,`external_id`)
);
--> statement-breakpoint
CREATE TABLE `connected_apps` (
	`id` char(36) NOT NULL,
	`org_id` char(36) NOT NULL,
	`name` varchar(100) NOT NULL,
	`source` enum('razorpay','api') NOT NULL,
	`secret` varchar(100) NOT NULL,
	`notes_filter` varchar(100),
	`sac` varchar(8) NOT NULL,
	`gst_rate_bps` int NOT NULL DEFAULT 1800,
	`income_account_id` char(36) NOT NULL,
	`journal_id` char(36) NOT NULL,
	`bank_journal_id` char(36),
	`fee_account_id` char(36),
	`email_invoices` boolean NOT NULL DEFAULT true,
	`active` boolean NOT NULL DEFAULT true,
	`created_by` char(36) NOT NULL,
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	`last_event_at` timestamp(3),
	CONSTRAINT `connected_apps_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `documents` MODIFY COLUMN `supply_type` enum('intra','inter','export') NOT NULL;--> statement-breakpoint
ALTER TABLE `documents` ADD `share_token` varchar(64);--> statement-breakpoint
ALTER TABLE `orgs` ADD `lut` varchar(30);--> statement-breakpoint
ALTER TABLE `documents` ADD CONSTRAINT `documents_org_share_token_key` UNIQUE(`org_id`,`share_token`);--> statement-breakpoint
ALTER TABLE `app_payments` ADD CONSTRAINT `app_payments_org_id_orgs_id_fk` FOREIGN KEY (`org_id`) REFERENCES `orgs`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `app_payments` ADD CONSTRAINT `app_payments_app_id_connected_apps_id_fk` FOREIGN KEY (`app_id`) REFERENCES `connected_apps`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `app_payments` ADD CONSTRAINT `app_payments_document_id_documents_id_fk` FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `app_payments` ADD CONSTRAINT `app_payments_payment_id_payments_id_fk` FOREIGN KEY (`payment_id`) REFERENCES `payments`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `connected_apps` ADD CONSTRAINT `connected_apps_org_id_orgs_id_fk` FOREIGN KEY (`org_id`) REFERENCES `orgs`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `connected_apps` ADD CONSTRAINT `connected_apps_income_account_id_accounts_id_fk` FOREIGN KEY (`income_account_id`) REFERENCES `accounts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `connected_apps` ADD CONSTRAINT `connected_apps_journal_id_journals_id_fk` FOREIGN KEY (`journal_id`) REFERENCES `journals`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `connected_apps` ADD CONSTRAINT `connected_apps_bank_journal_id_journals_id_fk` FOREIGN KEY (`bank_journal_id`) REFERENCES `journals`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `connected_apps` ADD CONSTRAINT `connected_apps_fee_account_id_accounts_id_fk` FOREIGN KEY (`fee_account_id`) REFERENCES `accounts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `connected_apps` ADD CONSTRAINT `connected_apps_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `app_payments_org_received_idx` ON `app_payments` (`org_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `connected_apps_org_idx` ON `connected_apps` (`org_id`);