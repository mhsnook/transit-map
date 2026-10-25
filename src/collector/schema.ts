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

export const pollSources = [...sources, 'reference'] as const
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
