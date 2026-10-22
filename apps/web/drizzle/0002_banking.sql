CREATE TABLE `bank_statement_lines` (
	`id` char(36) NOT NULL,
	`org_id` char(36) NOT NULL,
	`journal_id` char(36) NOT NULL,
	`date` date NOT NULL,
	`description` varchar(300) NOT NULL,
	`reference` varchar(100),
	`amount` bigint NOT NULL DEFAULT 0,
	`balance` bigint,
	`row_key` char(64) NOT NULL,
	`matched_line_id` char(36),
	`import_batch` char(36) NOT NULL,
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `bank_statement_lines_id` PRIMARY KEY(`id`),
	CONSTRAINT `bank_statement_lines_org_row_key` UNIQUE(`org_id`,`journal_id`,`row_key`),
	CONSTRAINT `bank_statement_lines_org_matched_key` UNIQUE(`org_id`,`matched_line_id`)
);
--> statement-breakpoint
ALTER TABLE `bank_statement_lines` ADD CONSTRAINT `bank_statement_lines_org_id_orgs_id_fk` FOREIGN KEY (`org_id`) REFERENCES `orgs`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `bank_statement_lines` ADD CONSTRAINT `bank_statement_lines_journal_id_journals_id_fk` FOREIGN KEY (`journal_id`) REFERENCES `journals`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `bank_statement_lines` ADD CONSTRAINT `bank_statement_lines_matched_line_id_journal_lines_id_fk` FOREIGN KEY (`matched_line_id`) REFERENCES `journal_lines`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `bank_statement_lines_org_journal_date_idx` ON `bank_statement_lines` (`org_id`,`journal_id`,`date`);