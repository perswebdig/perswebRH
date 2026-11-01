CREATE TABLE `api_clients` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tenantId` int NOT NULL,
	`name` varchar(160) NOT NULL,
	`clientId` varchar(120) NOT NULL,
	`clientSecretHash` varchar(255) NOT NULL,
	`scopes` json NOT NULL,
	`active` int NOT NULL DEFAULT 1,
	`lastUsedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `api_clients_id` PRIMARY KEY(`id`),
	CONSTRAINT `api_clients_clientId_unique` UNIQUE(`clientId`)
);
--> statement-breakpoint
CREATE TABLE `directory_sync_configs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tenantId` int NOT NULL,
	`provider` enum('entra','ad') NOT NULL,
	`config` json,
	`lastSyncAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `directory_sync_configs_id` PRIMARY KEY(`id`),
	CONSTRAINT `directory_sync_tenant_provider_unique` UNIQUE(`tenantId`,`provider`)
);
--> statement-breakpoint
CREATE TABLE `import_jobs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tenantId` int NOT NULL,
	`type` enum('csv','entra','ad') NOT NULL,
	`status` enum('preview','processing','completed','failed') NOT NULL DEFAULT 'preview',
	`fileName` varchar(255),
	`createdByMembershipId` int,
	`summary` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `import_jobs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `platform_audit_logs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`actorUserId` int,
	`tenantId` int,
	`action` varchar(120) NOT NULL,
	`resource` varchar(120),
	`resourceId` int,
	`result` varchar(40) DEFAULT 'success',
	`metadata` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `platform_audit_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `signature_events` (
	`id` int AUTO_INCREMENT NOT NULL,
	`requestId` int NOT NULL,
	`event` varchar(120) NOT NULL,
	`metadata` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `signature_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `signature_requests` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tenantId` int NOT NULL,
	`documentType` varchar(80) NOT NULL,
	`documentId` int,
	`status` enum('draft','pending','signed','rejected','expired') NOT NULL DEFAULT 'draft',
	`provider` varchar(80) DEFAULT 'internal',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `signature_requests_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `signature_signers` (
	`id` int AUTO_INCREMENT NOT NULL,
	`requestId` int NOT NULL,
	`membershipId` int,
	`email` varchar(320) NOT NULL,
	`signerOrder` int NOT NULL DEFAULT 1,
	`status` enum('pending','signed','rejected') NOT NULL DEFAULT 'pending',
	`signedAt` timestamp,
	CONSTRAINT `signature_signers_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `tenant_sso_connections` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tenantId` int NOT NULL,
	`provider` enum('microsoft') NOT NULL,
	`microsoftTenantId` varchar(120) NOT NULL,
	`clientId` varchar(200) NOT NULL,
	`clientSecretEncrypted` text,
	`redirectUri` varchar(500) NOT NULL,
	`allowedDomains` json,
	`loginMode` enum('optional','required') NOT NULL DEFAULT 'optional',
	`jitProvisioning` int NOT NULL DEFAULT 0,
	`groupMappings` json,
	`enabled` int NOT NULL DEFAULT 1,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `tenant_sso_connections_id` PRIMARY KEY(`id`),
	CONSTRAINT `tenant_sso_tenant_provider_unique` UNIQUE(`tenantId`,`provider`)
);
--> statement-breakpoint
CREATE TABLE `webhook_deliveries` (
	`id` int AUTO_INCREMENT NOT NULL,
	`webhookId` int NOT NULL,
	`event` varchar(120) NOT NULL,
	`payload` json,
	`status` enum('pending','delivered','failed') NOT NULL DEFAULT 'pending',
	`attempts` int NOT NULL DEFAULT 0,
	`nextRetryAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `webhook_deliveries_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `webhooks` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tenantId` int NOT NULL,
	`url` varchar(500) NOT NULL,
	`secretEncrypted` text NOT NULL,
	`events` json NOT NULL,
	`active` int NOT NULL DEFAULT 1,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `webhooks_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `tenants` ADD `locale` varchar(12) DEFAULT 'pt-BR';--> statement-breakpoint
ALTER TABLE `tenants` ADD `dateFormat` varchar(20) DEFAULT 'dd/MM/yyyy';--> statement-breakpoint
ALTER TABLE `tenants` ADD `legalName` varchar(200);--> statement-breakpoint
ALTER TABLE `tenants` ADD `tradeName` varchar(160);--> statement-breakpoint
ALTER TABLE `tenants` ADD `cnpj` varchar(18);--> statement-breakpoint
ALTER TABLE `tenants` ADD `stateRegistration` varchar(40);--> statement-breakpoint
ALTER TABLE `tenants` ADD `municipalRegistration` varchar(40);--> statement-breakpoint
ALTER TABLE `tenants` ADD `cnae` varchar(20);--> statement-breakpoint
ALTER TABLE `tenants` ADD `legalNature` varchar(120);--> statement-breakpoint
ALTER TABLE `tenants` ADD `taxRegime` varchar(80);--> statement-breakpoint
ALTER TABLE `tenants` ADD `addressStreet` varchar(200);--> statement-breakpoint
ALTER TABLE `tenants` ADD `addressNumber` varchar(30);--> statement-breakpoint
ALTER TABLE `tenants` ADD `addressComplement` varchar(120);--> statement-breakpoint
ALTER TABLE `tenants` ADD `addressDistrict` varchar(120);--> statement-breakpoint
ALTER TABLE `tenants` ADD `addressCity` varchar(120);--> statement-breakpoint
ALTER TABLE `tenants` ADD `addressState` varchar(2);--> statement-breakpoint
ALTER TABLE `tenants` ADD `addressPostalCode` varchar(12);--> statement-breakpoint
ALTER TABLE `tenants` ADD `addressCountry` varchar(60) DEFAULT 'Brasil';--> statement-breakpoint
ALTER TABLE `tenants` ADD `billingAddressStreet` varchar(200);--> statement-breakpoint
ALTER TABLE `tenants` ADD `billingAddressNumber` varchar(30);--> statement-breakpoint
ALTER TABLE `tenants` ADD `billingAddressComplement` varchar(120);--> statement-breakpoint
ALTER TABLE `tenants` ADD `billingAddressDistrict` varchar(120);--> statement-breakpoint
ALTER TABLE `tenants` ADD `billingAddressCity` varchar(120);--> statement-breakpoint
ALTER TABLE `tenants` ADD `billingAddressState` varchar(2);--> statement-breakpoint
ALTER TABLE `tenants` ADD `billingAddressPostalCode` varchar(12);--> statement-breakpoint
ALTER TABLE `tenants` ADD `corporateEmail` varchar(320);--> statement-breakpoint
ALTER TABLE `tenants` ADD `phone` varchar(40);--> statement-breakpoint
ALTER TABLE `tenants` ADD `website` varchar(255);--> statement-breakpoint
ALTER TABLE `tenants` ADD `verifiedDomains` json;--> statement-breakpoint
ALTER TABLE `tenants` ADD `logoUrl` text;--> statement-breakpoint
ALTER TABLE `tenants` ADD `adminContactName` varchar(160);--> statement-breakpoint
ALTER TABLE `tenants` ADD `adminContactEmail` varchar(320);--> statement-breakpoint
ALTER TABLE `tenants` ADD `adminContactPhone` varchar(40);--> statement-breakpoint
ALTER TABLE `tenants` ADD `workCalendar` json;--> statement-breakpoint
ALTER TABLE `tenants` ADD CONSTRAINT `tenants_cnpj_unique` UNIQUE(`cnpj`);--> statement-breakpoint
ALTER TABLE `api_clients` ADD CONSTRAINT `api_clients_tenantId_tenants_id_fk` FOREIGN KEY (`tenantId`) REFERENCES `tenants`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `directory_sync_configs` ADD CONSTRAINT `directory_sync_configs_tenantId_tenants_id_fk` FOREIGN KEY (`tenantId`) REFERENCES `tenants`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `import_jobs` ADD CONSTRAINT `import_jobs_tenantId_tenants_id_fk` FOREIGN KEY (`tenantId`) REFERENCES `tenants`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `import_jobs` ADD CONSTRAINT `import_jobs_createdByMembershipId_memberships_id_fk` FOREIGN KEY (`createdByMembershipId`) REFERENCES `memberships`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `platform_audit_logs` ADD CONSTRAINT `platform_audit_logs_actorUserId_users_id_fk` FOREIGN KEY (`actorUserId`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `platform_audit_logs` ADD CONSTRAINT `platform_audit_logs_tenantId_tenants_id_fk` FOREIGN KEY (`tenantId`) REFERENCES `tenants`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `signature_events` ADD CONSTRAINT `signature_events_requestId_signature_requests_id_fk` FOREIGN KEY (`requestId`) REFERENCES `signature_requests`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `signature_requests` ADD CONSTRAINT `signature_requests_tenantId_tenants_id_fk` FOREIGN KEY (`tenantId`) REFERENCES `tenants`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `signature_signers` ADD CONSTRAINT `signature_signers_requestId_signature_requests_id_fk` FOREIGN KEY (`requestId`) REFERENCES `signature_requests`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `signature_signers` ADD CONSTRAINT `signature_signers_membershipId_memberships_id_fk` FOREIGN KEY (`membershipId`) REFERENCES `memberships`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `tenant_sso_connections` ADD CONSTRAINT `tenant_sso_connections_tenantId_tenants_id_fk` FOREIGN KEY (`tenantId`) REFERENCES `tenants`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `webhook_deliveries` ADD CONSTRAINT `webhook_deliveries_webhookId_webhooks_id_fk` FOREIGN KEY (`webhookId`) REFERENCES `webhooks`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `webhooks` ADD CONSTRAINT `webhooks_tenantId_tenants_id_fk` FOREIGN KEY (`tenantId`) REFERENCES `tenants`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `api_clients_tenant_idx` ON `api_clients` (`tenantId`);--> statement-breakpoint
CREATE INDEX `import_jobs_tenant_idx` ON `import_jobs` (`tenantId`);--> statement-breakpoint
CREATE INDEX `platform_audit_tenant_idx` ON `platform_audit_logs` (`tenantId`);--> statement-breakpoint
CREATE INDEX `signature_events_request_idx` ON `signature_events` (`requestId`);--> statement-breakpoint
CREATE INDEX `signature_requests_tenant_idx` ON `signature_requests` (`tenantId`);--> statement-breakpoint
CREATE INDEX `signature_signers_request_idx` ON `signature_signers` (`requestId`);--> statement-breakpoint
CREATE INDEX `webhook_deliveries_webhook_idx` ON `webhook_deliveries` (`webhookId`);--> statement-breakpoint
CREATE INDEX `webhooks_tenant_idx` ON `webhooks` (`tenantId`);