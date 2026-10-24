CREATE TABLE `document_lines` (
	`id` char(36) NOT NULL,
	`org_id` char(36) NOT NULL,
	`document_id` char(36) NOT NULL,
	`position` int NOT NULL,
	`product_id` char(36),
	`description` varchar(500) NOT NULL,
	`hsn_sac` varchar(8),
	`quantity_milli` int NOT NULL,
	`unit` varchar(20) NOT NULL DEFAULT 'NOS',
	`unit_price` bigint NOT NULL DEFAULT 0,
	`discount_bps` int NOT NULL DEFAULT 0,
	`gst_rate_bps` int NOT NULL,
	`account_id` char(36) NOT NULL,
	`taxable` bigint NOT NULL DEFAULT 0,
	`cgst` bigint NOT NULL DEFAULT 0,
	`sgst` bigint NOT NULL DEFAULT 0,
	`igst` bigint NOT NULL DEFAULT 0,
	`total` bigint NOT NULL DEFAULT 0,
	CONSTRAINT `document_lines_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `documents` (
	`id` char(36) NOT NULL,
	`org_id` char(36) NOT NULL,
	`type` enum('invoice','credit_note','bill','debit_note') NOT NULL,
	`status` enum('draft','posted','cancelled') NOT NULL DEFAULT 'draft',
	`number` varchar(16),
	`vendor_reference` varchar(50),
	`contact_id` char(36) NOT NULL,
	`date` date NOT NULL,
	`due_date` date,
	`place_of_supply` varchar(2) NOT NULL,
	`supply_type` enum('intra','inter') NOT NULL,
	`reverse_charge` boolean NOT NULL DEFAULT false,
	`original_document_id` char(36),
	`taxable` bigint NOT NULL DEFAULT 0,
	`cgst` bigint NOT NULL DEFAULT 0,
	`sgst` bigint NOT NULL DEFAULT 0,
	`igst` bigint NOT NULL DEFAULT 0,
	`round_off` bigint NOT NULL DEFAULT 0,
	`total` bigint NOT NULL DEFAULT 0,
	`tds_amount` bigint NOT NULL DEFAULT 0,
	`tds_rate_bps` int NOT NULL DEFAULT 0,
	`tds_section` varchar(10),
	`amount_paid` bigint NOT NULL DEFAULT 0,
	`notes` text,
	`journal_entry_id` char(36),
	`external_ref` varchar(100),
	`created_by` char(36),
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	`updated_at` timestamp(3) NOT NULL DEFAULT (now()),
	`posted_at` timestamp(3),
	CONSTRAINT `documents_id` PRIMARY KEY(`id`),
	CONSTRAINT `documents_org_type_number_key` UNIQUE(`org_id`,`type`,`number`),
	CONSTRAINT `documents_org_external_ref_key` UNIQUE(`org_id`,`external_ref`)
);
--> statement-breakpoint
CREATE TABLE `payment_allocations` (
	`id` char(36) NOT NULL,
	`org_id` char(36) NOT NULL,
	`payment_id` char(36) NOT NULL,
	`document_id` char(36) NOT NULL,
	`amount` bigint NOT NULL DEFAULT 0,
	CONSTRAINT `payment_allocations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `payments` (
	`id` char(36) NOT NULL,
	`org_id` char(36) NOT NULL,
	`direction` enum('received','paid') NOT NULL,
	`status` enum('draft','posted','cancelled') NOT NULL DEFAULT 'posted',
	`number` varchar(30),
	`contact_id` char(36) NOT NULL,
	`date` date NOT NULL,
	`amount` bigint NOT NULL DEFAULT 0,
	`tds_amount` bigint NOT NULL DEFAULT 0,
	`journal_id` char(36) NOT NULL,
	`reference` varchar(100),
	`notes` text,
	`journal_entry_id` char(36),
	`external_ref` varchar(100),
	`created_by` char(36),
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `payments_id` PRIMARY KEY(`id`),
	CONSTRAINT `payments_org_external_ref_key` UNIQUE(`org_id`,`external_ref`)
);
--> statement-breakpoint
CREATE TABLE `sequences` (
	`org_id` char(36) NOT NULL,
	`key` varchar(40) NOT NULL,
	`last_value` int NOT NULL DEFAULT 0,
	CONSTRAINT `sequences_org_id_key_pk` PRIMARY KEY(`org_id`,`key`)
);
--> statement-breakpoint
ALTER TABLE `document_lines` ADD CONSTRAINT `document_lines_org_id_orgs_id_fk` FOREIGN KEY (`org_id`) REFERENCES `orgs`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `document_lines` ADD CONSTRAINT `document_lines_document_id_documents_id_fk` FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `document_lines` ADD CONSTRAINT `document_lines_product_id_products_id_fk` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `document_lines` ADD CONSTRAINT `document_lines_account_id_accounts_id_fk` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `documents` ADD CONSTRAINT `documents_org_id_orgs_id_fk` FOREIGN KEY (`org_id`) REFERENCES `orgs`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `documents` ADD CONSTRAINT `documents_contact_id_contacts_id_fk` FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `documents` ADD CONSTRAINT `documents_journal_entry_id_journal_entries_id_fk` FOREIGN KEY (`journal_entry_id`) REFERENCES `journal_entries`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `documents` ADD CONSTRAINT `documents_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `payment_allocations` ADD CONSTRAINT `payment_allocations_org_id_orgs_id_fk` FOREIGN KEY (`org_id`) REFERENCES `orgs`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `payment_allocations` ADD CONSTRAINT `payment_allocations_payment_id_payments_id_fk` FOREIGN KEY (`payment_id`) REFERENCES `payments`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `payment_allocations` ADD CONSTRAINT `payment_allocations_document_id_documents_id_fk` FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `payments` ADD CONSTRAINT `payments_org_id_orgs_id_fk` FOREIGN KEY (`org_id`) REFERENCES `orgs`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `payments` ADD CONSTRAINT `payments_contact_id_contacts_id_fk` FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `payments` ADD CONSTRAINT `payments_journal_id_journals_id_fk` FOREIGN KEY (`journal_id`) REFERENCES `journals`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `payments` ADD CONSTRAINT `payments_journal_entry_id_journal_entries_id_fk` FOREIGN KEY (`journal_entry_id`) REFERENCES `journal_entries`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `payments` ADD CONSTRAINT `payments_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `sequences` ADD CONSTRAINT `sequences_org_id_orgs_id_fk` FOREIGN KEY (`org_id`) REFERENCES `orgs`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `document_lines_document_idx` ON `document_lines` (`document_id`);--> statement-breakpoint
CREATE INDEX `documents_org_type_date_idx` ON `documents` (`org_id`,`type`,`date`);--> statement-breakpoint
CREATE INDEX `documents_org_contact_idx` ON `documents` (`org_id`,`contact_id`);--> statement-breakpoint
CREATE INDEX `payment_allocations_document_idx` ON `payment_allocations` (`document_id`);--> statement-breakpoint
CREATE INDEX `payment_allocations_payment_idx` ON `payment_allocations` (`payment_id`);--> statement-breakpoint
CREATE INDEX `payments_org_date_idx` ON `payments` (`org_id`,`date`);