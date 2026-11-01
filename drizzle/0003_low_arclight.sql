CREATE TABLE `tenant_holidays` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tenantId` int NOT NULL,
	`holidayDate` date NOT NULL,
	`name` varchar(160) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `tenant_holidays_id` PRIMARY KEY(`id`),
	CONSTRAINT `tenant_holidays_tenant_date_unique` UNIQUE(`tenantId`,`holidayDate`)
);
--> statement-breakpoint
CREATE TABLE `tenant_subscriptions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tenantId` int NOT NULL,
	`plan` enum('starter','growth','business') NOT NULL DEFAULT 'starter',
	`status` enum('trialing','active','past_due','canceled') NOT NULL DEFAULT 'trialing',
	`seatLimit` int NOT NULL DEFAULT 10,
	`trialEndsAt` timestamp,
	`currentPeriodEnd` timestamp,
	`notes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `tenant_subscriptions_id` PRIMARY KEY(`id`),
	CONSTRAINT `tenant_subscriptions_tenant_unique` UNIQUE(`tenantId`)
);
--> statement-breakpoint
ALTER TABLE `reimbursements` ADD `paymentReference` varchar(160);--> statement-breakpoint
ALTER TABLE `reimbursements` ADD `paymentNote` text;--> statement-breakpoint
ALTER TABLE `users` ADD `passwordHash` varchar(255);--> statement-breakpoint
ALTER TABLE `users` ADD CONSTRAINT `users_email_unique` UNIQUE(`email`);--> statement-breakpoint
ALTER TABLE `tenant_holidays` ADD CONSTRAINT `tenant_holidays_tenantId_tenants_id_fk` FOREIGN KEY (`tenantId`) REFERENCES `tenants`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `tenant_subscriptions` ADD CONSTRAINT `tenant_subscriptions_tenantId_tenants_id_fk` FOREIGN KEY (`tenantId`) REFERENCES `tenants`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `tenant_holidays_tenant_idx` ON `tenant_holidays` (`tenantId`);