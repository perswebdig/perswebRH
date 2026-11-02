CREATE TABLE `payroll_items` (
	`id` int AUTO_INCREMENT NOT NULL,
	`runId` int NOT NULL,
	`tenantId` int NOT NULL,
	`membershipId` int NOT NULL,
	`baseSalaryCents` int NOT NULL DEFAULT 0,
	`workingDays` int NOT NULL DEFAULT 0,
	`expectedMinutes` int NOT NULL DEFAULT 0,
	`workedMinutes` int NOT NULL DEFAULT 0,
	`overtimeMinutes` int NOT NULL DEFAULT 0,
	`nightMinutes` int NOT NULL DEFAULT 0,
	`absenceDays` int NOT NULL DEFAULT 0,
	`absenceDeductionCents` int NOT NULL DEFAULT 0,
	`overtimeCents` int NOT NULL DEFAULT 0,
	`nightAdditionCents` int NOT NULL DEFAULT 0,
	`manualAdditionsCents` int NOT NULL DEFAULT 0,
	`manualDeductionsCents` int NOT NULL DEFAULT 0,
	`additionsNote` varchar(240),
	`grossCents` int NOT NULL DEFAULT 0,
	`inssBaseCents` int NOT NULL DEFAULT 0,
	`inssCents` int NOT NULL DEFAULT 0,
	`irrfCents` int NOT NULL DEFAULT 0,
	`totalDeductionsCents` int NOT NULL DEFAULT 0,
	`netCents` int NOT NULL DEFAULT 0,
	`employerInssCents` int NOT NULL DEFAULT 0,
	`fgtsCents` int NOT NULL DEFAULT 0,
	`employerCostCents` int NOT NULL DEFAULT 0,
	`breakdown` json,
	CONSTRAINT `payroll_items_id` PRIMARY KEY(`id`),
	CONSTRAINT `payroll_items_run_member_unique` UNIQUE(`runId`,`membershipId`)
);
--> statement-breakpoint
CREATE TABLE `payroll_runs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tenantId` int NOT NULL,
	`referenceMonth` varchar(7) NOT NULL,
	`type` enum('normal','complementar','13_salario','ferias') NOT NULL DEFAULT 'normal',
	`status` enum('draft','closed','canceled') NOT NULL DEFAULT 'draft',
	`grossCents` int NOT NULL DEFAULT 0,
	`totalDeductionsCents` int NOT NULL DEFAULT 0,
	`netCents` int NOT NULL DEFAULT 0,
	`employerCostCents` int NOT NULL DEFAULT 0,
	`itemTotal` int NOT NULL DEFAULT 0,
	`notes` text,
	`createdByMembershipId` int,
	`generatedAt` timestamp NOT NULL DEFAULT (now()),
	`closedAt` timestamp,
	CONSTRAINT `payroll_runs_id` PRIMARY KEY(`id`),
	CONSTRAINT `payroll_runs_month_unique` UNIQUE(`tenantId`,`referenceMonth`,`type`)
);
--> statement-breakpoint
CREATE TABLE `work_schedules` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tenantId` int NOT NULL,
	`name` varchar(120) NOT NULL,
	`daysOfWeek` json NOT NULL,
	`blocks` json NOT NULL,
	`active` int NOT NULL DEFAULT 1,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `work_schedules_id` PRIMARY KEY(`id`),
	CONSTRAINT `work_schedules_tenant_name_unique` UNIQUE(`tenantId`,`name`)
);
--> statement-breakpoint
ALTER TABLE `memberships` ADD `scheduleId` int;--> statement-breakpoint
ALTER TABLE `memberships` ADD `salaryCents` int;--> statement-breakpoint
ALTER TABLE `payroll_items` ADD CONSTRAINT `payroll_items_runId_payroll_runs_id_fk` FOREIGN KEY (`runId`) REFERENCES `payroll_runs`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `payroll_items` ADD CONSTRAINT `payroll_items_tenantId_tenants_id_fk` FOREIGN KEY (`tenantId`) REFERENCES `tenants`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `payroll_items` ADD CONSTRAINT `payroll_items_membershipId_memberships_id_fk` FOREIGN KEY (`membershipId`) REFERENCES `memberships`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `payroll_runs` ADD CONSTRAINT `payroll_runs_tenantId_tenants_id_fk` FOREIGN KEY (`tenantId`) REFERENCES `tenants`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `payroll_runs` ADD CONSTRAINT `payroll_runs_createdByMembershipId_memberships_id_fk` FOREIGN KEY (`createdByMembershipId`) REFERENCES `memberships`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `work_schedules` ADD CONSTRAINT `work_schedules_tenantId_tenants_id_fk` FOREIGN KEY (`tenantId`) REFERENCES `tenants`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `payroll_items_tenant_idx` ON `payroll_items` (`tenantId`);--> statement-breakpoint
CREATE INDEX `payroll_runs_tenant_idx` ON `payroll_runs` (`tenantId`);