CREATE TABLE `observed_departures` (
	`schedule_number` text NOT NULL,
	`pattern_stop_id` integer NOT NULL,
	`scheduled_at` integer NOT NULL,
	`stop_id` text NOT NULL,
	`route_id` integer NOT NULL,
	`equipment_id` text NOT NULL,
	`departed_at` integer NOT NULL,
	`last_near_at` integer NOT NULL,
	PRIMARY KEY(`schedule_number`, `pattern_stop_id`, `scheduled_at`)
);
--> statement-breakpoint
CREATE INDEX `observed_departures_stop` ON `observed_departures` (`stop_id`,`scheduled_at`);--> statement-breakpoint
CREATE INDEX `observed_departures_departed_at` ON `observed_departures` (`departed_at`);--> statement-breakpoint
ALTER TABLE `todays_arrivals` ADD `departed_at` integer;