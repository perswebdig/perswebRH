CREATE TABLE `approval_rules` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tenantId` int NOT NULL,
	`categoryId` int,
	`approverLabel` varchar(100) NOT NULL,
	`assignedMembershipId` int,
	`minAmount` decimal(12,2),
	`maxAmount` decimal(12,2),
	`priority` int NOT NULL DEFAULT 10,
	`active` int NOT NULL DEFAULT 1,
	CONSTRAINT `approval_rules_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `approval_steps` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tenantId` int NOT NULL,
	`reimbursementId` int NOT NULL,
	`sequence` int NOT NULL,
	`approverMembershipId` int,
	`approverLabel` varchar(100) NOT NULL,
	`status` enum('pending','approved','rejected','skipped') NOT NULL DEFAULT 'pending',
	`note` text,
	`decidedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `approval_steps_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `departments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tenantId` int NOT NULL,
	`name` varchar(120) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `departments_id` PRIMARY KEY(`id`),
	CONSTRAINT `departments_tenant_name_unique` UNIQUE(`tenantId`,`name`)
);
--> statement-breakpoint
CREATE TABLE `expense_attachments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tenantId` int NOT NULL,
	`reimbursementId` int NOT NULL,
	`itemId` int,
	`uploadedByMembershipId` int NOT NULL,
	`objectKey` varchar(512) NOT NULL,
	`originalName` varchar(255) NOT NULL,
	`contentType` varchar(120) NOT NULL,
	`sizeBytes` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `expense_attachments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `expense_categories` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tenantId` int NOT NULL,
	`name` varchar(120) NOT NULL,
	`limitAmount` decimal(12,2),
	`active` int NOT NULL DEFAULT 1,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `expense_categories_id` PRIMARY KEY(`id`),
	CONSTRAINT `expense_categories_tenant_name_unique` UNIQUE(`tenantId`,`name`)
);
--> statement-breakpoint
CREATE TABLE `expense_items` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tenantId` int NOT NULL,
	`reimbursementId` int NOT NULL,
	`categoryId` int NOT NULL,
	`description` varchar(240) NOT NULL,
	`amount` decimal(12,2) NOT NULL,
	`expenseDate` date NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `expense_items_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `memberships` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tenantId` int NOT NULL,
	`userId` int,
	`email` varchar(320) NOT NULL,
	`name` varchar(160) NOT NULL,
	`role` enum('tenant_admin','manager','employee','finance','administrative') NOT NULL DEFAULT 'employee',
	`departmentId` int,
	`managerMembershipId` int,
	`active` int NOT NULL DEFAULT 1,
	`invitedAt` timestamp NOT NULL DEFAULT (now()),
	`joinedAt` timestamp,
	CONSTRAINT `memberships_id` PRIMARY KEY(`id`),
	CONSTRAINT `memberships_tenant_user_unique` UNIQUE(`tenantId`,`userId`),
	CONSTRAINT `memberships_tenant_email_unique` UNIQUE(`tenantId`,`email`)
);
--> statement-breakpoint
CREATE TABLE `reimbursements` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tenantId` int NOT NULL,
	`membershipId` int NOT NULL,
	`title` varchar(180) NOT NULL,
	`status` enum('draft','submitted','in_approval','approved','paid','rejected') NOT NULL DEFAULT 'draft',
	`totalAmount` decimal(12,2) NOT NULL DEFAULT '0.00',
	`currentApproverMembershipId` int,
	`paymentMembershipId` int,
	`rejectionReason` text,
	`submittedAt` timestamp,
	`approvedAt` timestamp,
	`paidAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `reimbursements_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `tenant_audit_logs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tenantId` int NOT NULL,
	`actorMembershipId` int,
	`entityType` varchar(80) NOT NULL,
	`entityId` int,
	`action` varchar(80) NOT NULL,
	`metadata` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `tenant_audit_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `tenants` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(160) NOT NULL,
	`slug` varchar(80) NOT NULL,
	`customDomain` varchar(255),
	`timezone` varchar(80) NOT NULL DEFAULT 'America/Sao_Paulo',
	`currency` varchar(3) NOT NULL DEFAULT 'BRL',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `tenants_id` PRIMARY KEY(`id`),
	CONSTRAINT `tenants_slug_unique` UNIQUE(`slug`),
	CONSTRAINT `tenants_custom_domain_unique` UNIQUE(`customDomain`)
);
--> statement-breakpoint
CREATE TABLE `work_entries` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tenantId` int NOT NULL,
	`periodId` int NOT NULL,
	`membershipId` int NOT NULL,
	`workDate` date NOT NULL,
	`startedAt` timestamp NOT NULL,
	`endedAt` timestamp NOT NULL,
	`activity` text NOT NULL,
	`markType` varchar(80) NOT NULL DEFAULT 'Entrada',
	`project` varchar(160),
	`costCenter` varchar(120),
	`locationMode` enum('preset','geolocation','manual') NOT NULL DEFAULT 'preset',
	`locationName` varchar(180) NOT NULL,
	`latitude` double,
	`longitude` double,
	`customFields` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `work_entries_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `work_periods` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tenantId` int NOT NULL,
	`membershipId` int NOT NULL,
	`periodStart` date NOT NULL,
	`periodEnd` date NOT NULL,
	`status` enum('draft','submitted','approved','rejected') NOT NULL DEFAULT 'draft',
	`managerNote` text,
	`reviewedByMembershipId` int,
	`submittedAt` timestamp,
	`reviewedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `work_periods_id` PRIMARY KEY(`id`),
	CONSTRAINT `work_periods_tenant_member_period_unique` UNIQUE(`tenantId`,`membershipId`,`periodStart`)
);
--> statement-breakpoint
CREATE TABLE `work_settings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tenantId` int NOT NULL,
	`dailyHours` decimal(4,2) NOT NULL DEFAULT '8.00',
	`toleranceMinutes` int NOT NULL DEFAULT 10,
	`shiftStart` varchar(5) NOT NULL DEFAULT '09:00',
	`markTypes` json NOT NULL,
	`customFields` json NOT NULL,
	`locations` json NOT NULL,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `work_settings_id` PRIMARY KEY(`id`),
	CONSTRAINT `work_settings_tenant_unique` UNIQUE(`tenantId`)
);
--> statement-breakpoint
ALTER TABLE `approval_rules` ADD CONSTRAINT `approval_rules_tenantId_tenants_id_fk` FOREIGN KEY (`tenantId`) REFERENCES `tenants`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `approval_rules` ADD CONSTRAINT `approval_rules_categoryId_expense_categories_id_fk` FOREIGN KEY (`categoryId`) REFERENCES `expense_categories`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `approval_rules` ADD CONSTRAINT `approval_rules_assignedMembershipId_memberships_id_fk` FOREIGN KEY (`assignedMembershipId`) REFERENCES `memberships`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `approval_steps` ADD CONSTRAINT `approval_steps_tenantId_tenants_id_fk` FOREIGN KEY (`tenantId`) REFERENCES `tenants`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `approval_steps` ADD CONSTRAINT `approval_steps_reimbursementId_reimbursements_id_fk` FOREIGN KEY (`reimbursementId`) REFERENCES `reimbursements`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `approval_steps` ADD CONSTRAINT `approval_steps_approverMembershipId_memberships_id_fk` FOREIGN KEY (`approverMembershipId`) REFERENCES `memberships`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `departments` ADD CONSTRAINT `departments_tenantId_tenants_id_fk` FOREIGN KEY (`tenantId`) REFERENCES `tenants`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `expense_attachments` ADD CONSTRAINT `expense_attachments_tenantId_tenants_id_fk` FOREIGN KEY (`tenantId`) REFERENCES `tenants`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `expense_attachments` ADD CONSTRAINT `expense_attachments_reimbursementId_reimbursements_id_fk` FOREIGN KEY (`reimbursementId`) REFERENCES `reimbursements`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `expense_attachments` ADD CONSTRAINT `expense_attachments_itemId_expense_items_id_fk` FOREIGN KEY (`itemId`) REFERENCES `expense_items`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `expense_attachments` ADD CONSTRAINT `expense_attachments_uploadedByMembershipId_memberships_id_fk` FOREIGN KEY (`uploadedByMembershipId`) REFERENCES `memberships`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `expense_categories` ADD CONSTRAINT `expense_categories_tenantId_tenants_id_fk` FOREIGN KEY (`tenantId`) REFERENCES `tenants`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `expense_items` ADD CONSTRAINT `expense_items_tenantId_tenants_id_fk` FOREIGN KEY (`tenantId`) REFERENCES `tenants`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `expense_items` ADD CONSTRAINT `expense_items_reimbursementId_reimbursements_id_fk` FOREIGN KEY (`reimbursementId`) REFERENCES `reimbursements`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `expense_items` ADD CONSTRAINT `expense_items_categoryId_expense_categories_id_fk` FOREIGN KEY (`categoryId`) REFERENCES `expense_categories`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `memberships` ADD CONSTRAINT `memberships_tenantId_tenants_id_fk` FOREIGN KEY (`tenantId`) REFERENCES `tenants`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `memberships` ADD CONSTRAINT `memberships_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `memberships` ADD CONSTRAINT `memberships_departmentId_departments_id_fk` FOREIGN KEY (`departmentId`) REFERENCES `departments`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `reimbursements` ADD CONSTRAINT `reimbursements_tenantId_tenants_id_fk` FOREIGN KEY (`tenantId`) REFERENCES `tenants`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `reimbursements` ADD CONSTRAINT `reimbursements_membershipId_memberships_id_fk` FOREIGN KEY (`membershipId`) REFERENCES `memberships`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `reimbursements` ADD CONSTRAINT `reimbursements_currentApproverMembershipId_memberships_id_fk` FOREIGN KEY (`currentApproverMembershipId`) REFERENCES `memberships`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `reimbursements` ADD CONSTRAINT `reimbursements_paymentMembershipId_memberships_id_fk` FOREIGN KEY (`paymentMembershipId`) REFERENCES `memberships`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `tenant_audit_logs` ADD CONSTRAINT `tenant_audit_logs_tenantId_tenants_id_fk` FOREIGN KEY (`tenantId`) REFERENCES `tenants`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `tenant_audit_logs` ADD CONSTRAINT `tenant_audit_logs_actorMembershipId_memberships_id_fk` FOREIGN KEY (`actorMembershipId`) REFERENCES `memberships`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `work_entries` ADD CONSTRAINT `work_entries_tenantId_tenants_id_fk` FOREIGN KEY (`tenantId`) REFERENCES `tenants`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `work_entries` ADD CONSTRAINT `work_entries_periodId_work_periods_id_fk` FOREIGN KEY (`periodId`) REFERENCES `work_periods`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `work_entries` ADD CONSTRAINT `work_entries_membershipId_memberships_id_fk` FOREIGN KEY (`membershipId`) REFERENCES `memberships`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `work_periods` ADD CONSTRAINT `work_periods_tenantId_tenants_id_fk` FOREIGN KEY (`tenantId`) REFERENCES `tenants`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `work_periods` ADD CONSTRAINT `work_periods_membershipId_memberships_id_fk` FOREIGN KEY (`membershipId`) REFERENCES `memberships`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `work_periods` ADD CONSTRAINT `work_periods_reviewedByMembershipId_memberships_id_fk` FOREIGN KEY (`reviewedByMembershipId`) REFERENCES `memberships`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `work_settings` ADD CONSTRAINT `work_settings_tenantId_tenants_id_fk` FOREIGN KEY (`tenantId`) REFERENCES `tenants`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `approval_rules_tenant_priority_idx` ON `approval_rules` (`tenantId`,`priority`);--> statement-breakpoint
CREATE INDEX `approval_steps_tenant_request_idx` ON `approval_steps` (`tenantId`,`reimbursementId`);--> statement-breakpoint
CREATE INDEX `departments_tenant_idx` ON `departments` (`tenantId`);--> statement-breakpoint
CREATE INDEX `expense_attachments_tenant_request_idx` ON `expense_attachments` (`tenantId`,`reimbursementId`);--> statement-breakpoint
CREATE INDEX `expense_categories_tenant_idx` ON `expense_categories` (`tenantId`);--> statement-breakpoint
CREATE INDEX `expense_items_tenant_request_idx` ON `expense_items` (`tenantId`,`reimbursementId`);--> statement-breakpoint
CREATE INDEX `memberships_user_idx` ON `memberships` (`userId`);--> statement-breakpoint
CREATE INDEX `memberships_tenant_idx` ON `memberships` (`tenantId`);--> statement-breakpoint
CREATE INDEX `reimbursements_tenant_status_idx` ON `reimbursements` (`tenantId`,`status`);--> statement-breakpoint
CREATE INDEX `reimbursements_tenant_member_idx` ON `reimbursements` (`tenantId`,`membershipId`);--> statement-breakpoint
CREATE INDEX `tenant_audit_created_idx` ON `tenant_audit_logs` (`tenantId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `work_entries_tenant_period_idx` ON `work_entries` (`tenantId`,`periodId`);--> statement-breakpoint
CREATE INDEX `work_entries_tenant_member_date_idx` ON `work_entries` (`tenantId`,`membershipId`,`workDate`);--> statement-breakpoint
CREATE INDEX `work_periods_tenant_status_idx` ON `work_periods` (`tenantId`,`status`);