CREATE TABLE `newest_position_fixes` (
	`equipment_id` text PRIMARY KEY NOT NULL,
	`fix_time` integer NOT NULL,
	`received_at` integer NOT NULL,
	`lat` real NOT NULL,
	`lng` real NOT NULL,
	`heading` real,
	`route_id` integer,
	`pattern_id` integer,
	`trip_id` text,
	`schedule_number` text,
	`next_stop_id` text,
	`at_stop` integer NOT NULL,
	`on_schedule` integer
);
--> statement-breakpoint
CREATE TABLE `poll_attempts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source` text NOT NULL,
	`started_at` integer NOT NULL,
	`duration_ms` integer NOT NULL,
	`outcome` text NOT NULL,
	`http_status` integer,
	`fixes_seen` integer,
	`fixes_new` integer,
	`error` text
);
--> statement-breakpoint
CREATE INDEX `poll_attempts_started_at` ON `poll_attempts` (`started_at`);--> statement-breakpoint
CREATE TABLE `position_fixes` (
	`source` text NOT NULL,
	`equipment_id` text NOT NULL,
	`fix_time` integer NOT NULL,
	`received_at` integer NOT NULL,
	`lat` real NOT NULL,
	`lng` real NOT NULL,
	`heading` real,
	`trip_id` text,
	`schedule_number` text,
	`next_stop_id` text,
	PRIMARY KEY(`source`, `equipment_id`, `fix_time`)
);
--> statement-breakpoint
CREATE INDEX `position_fixes_fix_time` ON `position_fixes` (`fix_time`);