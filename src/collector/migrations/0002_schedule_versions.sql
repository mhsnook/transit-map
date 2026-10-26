CREATE TABLE `schedule_changes` (
	`id` integer PRIMARY KEY NOT NULL,
	`observed_at` integer NOT NULL,
	`from_version_id` text,
	`to_version_id` text NOT NULL,
	`feed_version` text,
	`feed_start_date` text,
	`feed_end_date` text,
	`gtfs_etag` text
);
--> statement-breakpoint
CREATE TABLE `schedule_deltas` (
	`change_id` integer NOT NULL,
	`change` text NOT NULL,
	`route` text NOT NULL,
	`days` text NOT NULL,
	`direction` integer NOT NULL,
	`stop_id` text NOT NULL,
	`arrival_time` text NOT NULL,
	`departure_time` text NOT NULL,
	`timepoint` integer NOT NULL,
	PRIMARY KEY(`change_id`, `route`, `days`, `direction`, `stop_id`, `arrival_time`, `departure_time`, `timepoint`)
);
--> statement-breakpoint
CREATE TABLE `schedule_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`first_seen_at` integer NOT NULL,
	`scheduled_stop_count` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `scheduled_stops` (
	`route` text NOT NULL,
	`days` text NOT NULL,
	`direction` integer NOT NULL,
	`stop_id` text NOT NULL,
	`arrival_time` text NOT NULL,
	`departure_time` text NOT NULL,
	`timepoint` integer NOT NULL,
	PRIMARY KEY(`route`, `days`, `direction`, `stop_id`, `arrival_time`, `departure_time`, `timepoint`)
);
