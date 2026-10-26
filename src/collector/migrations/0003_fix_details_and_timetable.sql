CREATE TABLE `timetable_stops` (
	`id` text PRIMARY KEY NOT NULL,
	`trip_id` text NOT NULL,
	`route` text NOT NULL,
	`days` text NOT NULL,
	`direction` integer NOT NULL,
	`headsign` text NOT NULL,
	`stop_id` text NOT NULL,
	`stop_sequence` integer NOT NULL,
	`arrival_time` text NOT NULL,
	`departure_time` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `newest_position_fixes` ADD `load` integer;--> statement-breakpoint
ALTER TABLE `newest_position_fixes` ADD `capacity` integer;--> statement-breakpoint
ALTER TABLE `position_fixes` ADD `route_id` integer;--> statement-breakpoint
ALTER TABLE `position_fixes` ADD `pattern_id` integer;--> statement-breakpoint
ALTER TABLE `position_fixes` ADD `at_stop` integer;--> statement-breakpoint
ALTER TABLE `position_fixes` ADD `on_schedule` integer;--> statement-breakpoint
ALTER TABLE `position_fixes` ADD `load` integer;--> statement-breakpoint
ALTER TABLE `position_fixes` ADD `capacity` integer;