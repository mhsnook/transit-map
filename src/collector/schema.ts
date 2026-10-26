import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
} from 'drizzle-orm/sqlite-core'

export const sources = ['json_api', 'gtfs_rt'] as const
export type Source = (typeof sources)[number]

// Times are ms since the epoch throughout.

export const newestPositionFixes = sqliteTable('newest_position_fixes', {
  equipment_id: text().primaryKey(),
  fix_time: integer().notNull(),
  received_at: integer().notNull(),
  lat: real().notNull(),
  lng: real().notNull(),
  heading: real(),
  route_id: integer(),
  pattern_id: integer(),
  trip_id: text(),
  schedule_number: text(),
  next_stop_id: text(),
  at_stop: integer({ mode: 'boolean' }).notNull(),
  on_schedule: integer(),
})

export const positionFixes = sqliteTable(
  'position_fixes',
  {
    source: text({ enum: sources }).notNull(),
    equipment_id: text().notNull(),
    fix_time: integer().notNull(),
    received_at: integer().notNull(),
    lat: real().notNull(),
    lng: real().notNull(),
    heading: real(),
    trip_id: text(),
    schedule_number: text(),
    next_stop_id: text(),
  },
  (t) => [
    // fix_time leads so the retention delete can use the primary key
    primaryKey({ columns: [t.fix_time, t.source, t.equipment_id] }),
  ],
)

export const pollOutcomes = [
  'ok',
  'not_modified',
  'http_error',
  'timeout',
  'network_error',
  'parse_error',
] as const

export const pollSources = [...sources, 'reference', 'schedule'] as const
export type PollSource = (typeof pollSources)[number]

export const pollAttempts = sqliteTable(
  'poll_attempts',
  {
    id: integer().primaryKey(),
    source: text({ enum: pollSources }).notNull(),
    started_at: integer().notNull(),
    duration_ms: integer().notNull(),
    outcome: text({ enum: pollOutcomes }).notNull(),
    http_status: integer(),
    fixes_seen: integer(),
    fixes_new: integer(),
    error: text(),
  },
  (t) => [index('poll_attempts_started_at').on(t.started_at)],
)

// Reference data from the JSON API.

export const busRoutes = sqliteTable('bus_routes', {
  id: integer().primaryKey(),
  name: text().notNull(),
  short_name: text().notNull(),
  color: text().notNull(),
})

export const routePatterns = sqliteTable('route_patterns', {
  id: integer().primaryKey(),
  name: text().notNull(),
  route_id: integer().notNull(),
  color: text().notNull(),
  enc_line: text().notNull(),
})

export const busStops = sqliteTable('bus_stops', {
  id: text().primaryKey(),
  name: text().notNull(),
  lat: real().notNull(),
  lng: real().notNull(),
})

export const routeStops = sqliteTable('route_stops', {
  id: integer().primaryKey(),
  route_id: integer().notNull(),
  stop_id: text().notNull(),
})

// The published schedule, as a set of scheduled stops. A scheduled stop is
// "this bus route arrives at and departs from this bus stop at these times on
// these days, going this way"; trip ids, shapes and stop names are
// deliberately not part of it,
// so vendor-side renumbering or re-encoding is not a schedule change.

const scheduledStopColumns = {
  route: text().notNull(),
  // seven characters, Monday first: "MTWTF--"
  days: text().notNull(),
  direction: integer().notNull(),
  stop_id: text().notNull(),
  // GTFS times, which can pass 24:00:00 for service after midnight
  arrival_time: text().notNull(),
  departure_time: text().notNull(),
  // false: the feed vendor's time here is an estimate between timepoints
  timepoint: integer({ mode: 'boolean' }).notNull(),
}

// One row per distinct set of scheduled stops ever seen.
export const scheduleVersions = sqliteTable('schedule_versions', {
  // SHA-256 of the sorted scheduled stops
  id: text().primaryKey(),
  first_seen_at: integer().notNull(),
  scheduled_stop_count: integer().notNull(),
})

// One row per observed change to the published schedule: the set of
// scheduled stops changed, or the feed vendor's feed_version did. A change
// with no deltas is a version bump that left the schedule as it was.
export const scheduleChanges = sqliteTable('schedule_changes', {
  id: integer().primaryKey(),
  observed_at: integer().notNull(),
  // null for the first schedule version seen
  from_version_id: text(),
  to_version_id: text().notNull(),
  feed_version: text(),
  feed_start_date: text(),
  feed_end_date: text(),
  gtfs_etag: text(),
})

// The scheduled stops of the latest change's to_version_id.
export const scheduledStops = sqliteTable('scheduled_stops', scheduledStopColumns, (t) => [
  primaryKey({ columns: [t.route, t.days, t.direction, t.stop_id, t.arrival_time, t.departure_time, t.timepoint] }),
])

// The scheduled stops each change added or removed. The first change adds
// every scheduled stop.
export const scheduleDeltas = sqliteTable(
  'schedule_deltas',
  {
    change_id: integer().notNull(),
    change: text({ enum: ['added', 'removed'] }).notNull(),
    ...scheduledStopColumns,
  },
  (t) => [
    primaryKey({
      columns: [
        t.change_id,
        t.route,
        t.days,
        t.direction,
        t.stop_id,
        t.arrival_time,
        t.departure_time,
        t.timepoint,
      ],
    }),
  ],
)
