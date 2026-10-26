CREATE TABLE `arrival_predictions` (
	`id` integer PRIMARY KEY NOT NULL,
	`made_at` integer NOT NULL,
	`schedule_number` text NOT NULL,
	`pattern_stop_id` integer NOT NULL,
	`scheduled_at` integer NOT NULL,
	`stop_id` text NOT NULL,
	`route_id` integer NOT NULL,
	`equipment_id` text NOT NULL,
	`predicted_at` integer NOT NULL,
	`direction` text,
	`timepoint` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `arrival_predictions_stop` ON `arrival_predictions` (`stop_id`,`scheduled_at`);--> statement-breakpoint
CREATE INDEX `arrival_predictions_made_at` ON `arrival_predictions` (`made_at`);--> statement-breakpoint
CREATE TABLE `current_arrival_predictions` (
	`id` text PRIMARY KEY NOT NULL,
	`schedule_number` text NOT NULL,
	`pattern_stop_id` integer NOT NULL,
	`scheduled_at` integer NOT NULL,
	`stop_id` text NOT NULL,
	`route_id` integer NOT NULL,
	`equipment_id` text NOT NULL,
	`predicted_at` integer NOT NULL,
	`direction` text,
	`timepoint` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `observed_arrivals` (
	`schedule_number` text NOT NULL,
	`pattern_stop_id` integer NOT NULL,
	`scheduled_at` integer NOT NULL,
	`stop_id` text NOT NULL,
	`route_id` integer NOT NULL,
	`equipment_id` text NOT NULL,
	`rule` text NOT NULL,
	`arrived_at` integer NOT NULL,
	`distance_m` real NOT NULL,
	PRIMARY KEY(`schedule_number`, `pattern_stop_id`, `scheduled_at`, `rule`)
);
--> statement-breakpoint
CREATE INDEX `observed_arrivals_stop` ON `observed_arrivals` (`stop_id`,`scheduled_at`);--> statement-breakpoint
CREATE INDEX `observed_arrivals_arrived_at` ON `observed_arrivals` (`arrived_at`);--> statement-breakpoint
ALTER TABLE `newest_position_fixes` ADD `last_stop_id` text;--> statement-breakpoint
ALTER TABLE `newest_position_fixes` ADD `last_pattern_stop_id` integer;--> statement-breakpoint
ALTER TABLE `position_fixes` ADD `last_stop_id` text;--> statement-breakpoint
ALTER TABLE `position_fixes` ADD `last_pattern_stop_id` integer;