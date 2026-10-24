CREATE TABLE `invoice_designs` (
	`id` char(36) NOT NULL,
	`org_id` char(36) NOT NULL,
	`template` enum('classic','modern','boxed') NOT NULL DEFAULT 'classic',
	`accent_color` varchar(7) NOT NULL DEFAULT '#A3142B',
	`logo` mediumtext,
	`signature` mediumtext,
	`show_hsn` boolean NOT NULL DEFAULT true,
	`show_discount` boolean NOT NULL DEFAULT true,
	`show_amount_in_words` boolean NOT NULL DEFAULT true,
	`show_upi_qr` boolean NOT NULL DEFAULT true,
	`bank_name` varchar(100),
	`bank_account_name` varchar(200),
	`bank_account_number` varchar(30),
	`bank_ifsc` varchar(11),
	`bank_branch` varchar(100),
	`upi_id` varchar(100),
	`terms` text,
	`footer` varchar(300),
	`signatory_label` varchar(100),
	`updated_at` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `invoice_designs_id` PRIMARY KEY(`id`),
	CONSTRAINT `invoice_designs_org_key` UNIQUE(`org_id`)
);
--> statement-breakpoint
ALTER TABLE `invoice_designs` ADD CONSTRAINT `invoice_designs_org_id_orgs_id_fk` FOREIGN KEY (`org_id`) REFERENCES `orgs`(`id`) ON DELETE cascade ON UPDATE no action;