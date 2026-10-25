CREATE TABLE `bus_stops` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`lat` real NOT NULL,
	`lng` real NOT NULL
);
--> statement-breakpoint
CREATE TABLE `route_patterns` (
	`id` integer PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`route_id` integer NOT NULL,
	`route_name` text NOT NULL,
	`color` text NOT NULL,
	`enc_line` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `route_stops` (
	`id` integer PRIMARY KEY NOT NULL,
	`route_id` integer NOT NULL,
	`stop_id` text NOT NULL
);
