ALTER TABLE `work_entries` ADD `countsAsWork` boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `work_settings` ADD `nonWorkingMarkTypes` json;