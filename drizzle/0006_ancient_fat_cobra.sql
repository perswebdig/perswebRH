CREATE TABLE `billing_events` (
	`id` int AUTO_INCREMENT NOT NULL,
	`provider` varchar(32) NOT NULL,
	`externalId` varchar(160) NOT NULL,
	`eventType` varchar(40) NOT NULL,
	`invoiceId` int,
	`result` varchar(40) NOT NULL,
	`detail` text,
	`processedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `billing_events_id` PRIMARY KEY(`id`),
	CONSTRAINT `billing_events_provider_external_unique` UNIQUE(`provider`,`externalId`)
);
--> statement-breakpoint
CREATE TABLE `billing_invoices` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tenantId` int NOT NULL,
	`subscriptionId` int,
	`orderNsu` varchar(64) NOT NULL,
	`periodStart` date NOT NULL,
	`periodEnd` date NOT NULL,
	`planCode` varchar(32) NOT NULL,
	`amountCents` int NOT NULL,
	`status` enum('pending','paid','failed','canceled','refunded','partially_refunded') NOT NULL DEFAULT 'pending',
	`checkoutUrl` varchar(500),
	`slug` varchar(120),
	`externalTransactionId` varchar(120),
	`paidAmountCents` int,
	`paidAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `billing_invoices_id` PRIMARY KEY(`id`),
	CONSTRAINT `billing_invoices_order_nsu_unique` UNIQUE(`orderNsu`)
);
--> statement-breakpoint
CREATE TABLE `platform_settings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`key` varchar(80) NOT NULL,
	`value` varchar(500) NOT NULL,
	`updatedByUserId` int,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `platform_settings_id` PRIMARY KEY(`id`),
	CONSTRAINT `platform_settings_key_unique` UNIQUE(`key`)
);
--> statement-breakpoint
CREATE TABLE `tenant_addons` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tenantId` int NOT NULL,
	`addonCode` varchar(60) NOT NULL,
	`status` enum('available','needs_configuration','connection_test','active','error','suspended','disconnected') NOT NULL DEFAULT 'available',
	`priceCents` int,
	`config` json,
	`enabledByMembershipId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `tenant_addons_id` PRIMARY KEY(`id`),
	CONSTRAINT `tenant_addons_tenant_addon_unique` UNIQUE(`tenantId`,`addonCode`)
);
--> statement-breakpoint
CREATE TABLE `terms_acceptances` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tenantId` int,
	`userId` int NOT NULL,
	`version` varchar(20) NOT NULL,
	`acceptedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `terms_acceptances_id` PRIMARY KEY(`id`),
	CONSTRAINT `terms_acceptances_user_version_unique` UNIQUE(`userId`,`version`)
);
--> statement-breakpoint
ALTER TABLE `tenant_subscriptions` MODIFY COLUMN `status` enum('trialing','active','past_due','suspended','canceled') NOT NULL DEFAULT 'trialing';--> statement-breakpoint
ALTER TABLE `tenant_subscriptions` MODIFY COLUMN `seatLimit` int NOT NULL DEFAULT 25;--> statement-breakpoint
ALTER TABLE `tenant_subscriptions` ADD `priceCents` int DEFAULT 15000 NOT NULL;--> statement-breakpoint
ALTER TABLE `tenant_subscriptions` ADD `cancelAtPeriodEnd` enum('0','1') DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE `tenant_subscriptions` ADD `canceledAt` timestamp;--> statement-breakpoint
ALTER TABLE `billing_events` ADD CONSTRAINT `billing_events_invoiceId_billing_invoices_id_fk` FOREIGN KEY (`invoiceId`) REFERENCES `billing_invoices`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `billing_invoices` ADD CONSTRAINT `billing_invoices_tenantId_tenants_id_fk` FOREIGN KEY (`tenantId`) REFERENCES `tenants`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `billing_invoices` ADD CONSTRAINT `billing_invoices_subscriptionId_tenant_subscriptions_id_fk` FOREIGN KEY (`subscriptionId`) REFERENCES `tenant_subscriptions`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `tenant_addons` ADD CONSTRAINT `tenant_addons_tenantId_tenants_id_fk` FOREIGN KEY (`tenantId`) REFERENCES `tenants`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `terms_acceptances` ADD CONSTRAINT `terms_acceptances_tenantId_tenants_id_fk` FOREIGN KEY (`tenantId`) REFERENCES `tenants`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `terms_acceptances` ADD CONSTRAINT `terms_acceptances_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `billing_invoices_tenant_status_idx` ON `billing_invoices` (`tenantId`,`status`);