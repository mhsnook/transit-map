CREATE TABLE `todays_arrivals` (
	`id` text PRIMARY KEY NOT NULL,
	`schedule_number` text NOT NULL,
	`equipment_id` text NOT NULL,
	`route_id` integer NOT NULL,
	`stop_id` text NOT NULL,
	`arrived_at` integer NOT NULL,
	`slot_at` integer,
	`timepoint` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `current_arrival_predictions` ADD `slot_at` integer;--> statement-breakpoint
ALTER TABLE `observed_arrivals` ADD `slot_at` integer;--> statement-breakpoint
ALTER TABLE `timetable_stops` ADD `schedule_number` text;