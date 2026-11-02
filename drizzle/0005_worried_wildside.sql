CREATE TABLE `punch_events` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tenantId` int NOT NULL,
	`membershipId` int NOT NULL,
	`workDate` date NOT NULL,
	`eventType` enum('ENTRY','EXIT','BREAK_START','BREAK_END') NOT NULL,
	`occurredAt` timestamp NOT NULL,
	`source` enum('web','retroactive_approval','admin_correction','import') NOT NULL DEFAULT 'web',
	`status` enum('valid','cancelled') NOT NULL DEFAULT 'valid',
	`note` text,
	`meta` json,
	`requestId` int,
	`timezone` varchar(64) NOT NULL,
	`clientToken` varchar(64),
	`createdByMembershipId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `punch_events_id` PRIMARY KEY(`id`),
	CONSTRAINT `punch_events_idempotency_unique` UNIQUE(`tenantId`,`membershipId`,`clientToken`)
);
--> statement-breakpoint
CREATE TABLE `punch_requests` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tenantId` int NOT NULL,
	`membershipId` int NOT NULL,
	`workDate` date NOT NULL,
	`events` json NOT NULL,
	`reason` text NOT NULL,
	`status` enum('pending','approved','rejected','cancelled') NOT NULL DEFAULT 'pending',
	`reviewedByMembershipId` int,
	`reviewedAt` timestamp,
	`reviewNote` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `punch_requests_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `work_entries` ADD `source` varchar(32) DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE `punch_events` ADD CONSTRAINT `punch_events_tenantId_tenants_id_fk` FOREIGN KEY (`tenantId`) REFERENCES `tenants`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `punch_events` ADD CONSTRAINT `punch_events_membershipId_memberships_id_fk` FOREIGN KEY (`membershipId`) REFERENCES `memberships`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `punch_events` ADD CONSTRAINT `punch_events_requestId_punch_requests_id_fk` FOREIGN KEY (`requestId`) REFERENCES `punch_requests`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `punch_requests` ADD CONSTRAINT `punch_requests_tenantId_tenants_id_fk` FOREIGN KEY (`tenantId`) REFERENCES `tenants`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `punch_requests` ADD CONSTRAINT `punch_requests_membershipId_memberships_id_fk` FOREIGN KEY (`membershipId`) REFERENCES `memberships`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `punch_requests` ADD CONSTRAINT `punch_requests_reviewedByMembershipId_memberships_id_fk` FOREIGN KEY (`reviewedByMembershipId`) REFERENCES `memberships`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `punch_events_tenant_member_date_idx` ON `punch_events` (`tenantId`,`membershipId`,`workDate`);--> statement-breakpoint
CREATE INDEX `punch_requests_tenant_status_idx` ON `punch_requests` (`tenantId`,`status`);--> statement-breakpoint
CREATE INDEX `punch_requests_tenant_member_idx` ON `punch_requests` (`tenantId`,`membershipId`);