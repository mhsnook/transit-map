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
  last_stop_id: text(),
  last_pattern_stop_id: integer(),
  // at last_stop_id, not next_stop_id
  at_stop: integer({ mode: 'boolean' }).notNull(),
  // minutes; negative is late
  on_schedule: integer(),
  // passengers aboard and seats, as the feed vendor reports them
  load: integer(),
  capacity: integer(),
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
    // JSON API only; null for the GTFS-RT feed
    last_stop_id: text(),
    last_pattern_stop_id: integer(),
    route_id: integer(),
    pattern_id: integer(),
    at_stop: integer({ mode: 'boolean' }),
    on_schedule: integer(),
    load: integer(),
    capacity: integer(),
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

export const pollSources = [...sources, 'reference', 'schedule', 'stop_etas', 'watched_stop_etas'] as const
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

// The current schedule's timepoint stops, trip by trip, for showing
// timetables. Unlike scheduled stops this keeps trips and stop order, and is
// replaced rather than versioned.
export const timetableStops = sqliteTable('timetable_stops', {
  // `${trip_id}:${stop_sequence}`
  id: text().primaryKey(),
  trip_id: text().notNull(),
  // GTFS trip_short_name, the feed vendor's scheduleNumber, or '' for a trip
  // without one; null on rows stored before it was kept, until the next
  // gtfs.zip parse
  schedule_number: text(),
  route: text().notNull(),
  days: text().notNull(),
  direction: integer().notNull(),
  headsign: text().notNull(),
  stop_id: text().notNull(),
  stop_sequence: integer().notNull(),
  arrival_time: text().notNull(),
  departure_time: text().notNull(),
})

// Arrival predictions and observed arrivals are made for a scheduled call:
// one scheduled trip (schedule_number) at one pattern stop at one scheduled
// time. The schedule number repeats every service day; scheduled_at doesn't.

export function scheduledCallId(call: { schedule_number: string; pattern_stop_id: number; scheduled_at: number }) {
  return `${call.schedule_number}:${call.pattern_stop_id}:${call.scheduled_at}`
}

const scheduledCallColumns = {
  schedule_number: text().notNull(),
  // the feed vendor's patternStopID: a bus stop's place in a route pattern,
  // so a route pattern that passes a bus stop twice has two
  pattern_stop_id: integer().notNull(),
  scheduled_at: integer().notNull(),
  stop_id: text().notNull(),
  route_id: integer().notNull(),
  equipment_id: text().notNull(),
}

// The arrival predictions get_vehicles serves now, for each transit
// vehicle's next five bus stops, plus get_stop_etas for the bus stops
// browsers have open.
export const currentArrivalPredictions = sqliteTable('current_arrival_predictions', {
  // `${schedule_number}:${pattern_stop_id}`
  id: text().primaryKey(),
  ...scheduledCallColumns,
  predicted_at: integer().notNull(),
  // the feed vendor's "Inbound" or "Outbound", not the GTFS direction_id
  direction: text(),
  timepoint: integer({ mode: 'boolean' }).notNull(),
  // see todays_arrivals
  slot_at: integer(),
})

export const predictionSources = ['get_vehicles', 'get_stop_etas'] as const

// get_vehicles rows are written when an arrival prediction is first served
// and each time it changes, from a poll every 10 s, so the newest row made
// before a moment is the prediction showing then. A restart writes the
// current ones again. get_stop_etas rows are
// every arrival prediction in a snapshot taken every ten minutes; a gap
// between them says nothing about what was showing.
export const arrivalPredictions = sqliteTable(
  'arrival_predictions',
  {
    id: integer().primaryKey(),
    // when the collector saw this prediction served
    made_at: integer().notNull(),
    // rows recorded before this column existed all came from get_stop_etas
    source: text({ enum: predictionSources }).notNull().default('get_stop_etas'),
    ...scheduledCallColumns,
    predicted_at: integer().notNull(),
    direction: text(),
    timepoint: integer({ mode: 'boolean' }).notNull(),
  },
  (t) => [
    index('arrival_predictions_stop').on(t.stop_id, t.scheduled_at),
    index('arrival_predictions_made_at').on(t.made_at),
  ],
)

export const arrivalRules = [
  // a position fix within ARRIVAL_RADIUS_M of the bus stop
  'distance',
  // the feed vendor's atStop at this pattern stop
  'at_stop',
  // the feed vendor's lastPatternStopID reached this pattern stop
  'passed',
] as const

// One row per rule that fired for a scheduled call, so the rules can be
// compared. The observed arrival is the earliest of them.
export const observedArrivals = sqliteTable(
  'observed_arrivals',
  {
    ...scheduledCallColumns,
    rule: text({ enum: arrivalRules }).notNull(),
    // the fix_time of the position fix that fired the rule
    arrived_at: integer().notNull(),
    distance_m: real().notNull(),
    // see todays_arrivals
    slot_at: integer(),
  },
  (t) => [
    primaryKey({ columns: [t.schedule_number, t.pattern_stop_id, t.scheduled_at, t.rule] }),
    index('observed_arrivals_stop').on(t.stop_id, t.scheduled_at),
    index('observed_arrivals_arrived_at').on(t.arrived_at),
  ],
)

// The first position fix after a scheduled call's observed arrival at which
// the bus is clear of the stop (see arrivals.ts). One row per call.
export const observedDepartures = sqliteTable(
  'observed_departures',
  {
    ...scheduledCallColumns,
    departed_at: integer().notNull(),
    // the last fix before departed_at still at the stop: the bus left between the two
    last_near_at: integer().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.schedule_number, t.pattern_stop_id, t.scheduled_at] }),
    index('observed_departures_stop').on(t.stop_id, t.scheduled_at),
    index('observed_departures_departed_at').on(t.departed_at),
  ],
)

// Each scheduled call's observed arrival, for the stop and bus views and the
// timetable: timepoints for 20 hours, other bus stops for 2.
//
// slot_at is the matched slot: the scheduled time at this bus stop, for this
// bus route and direction, that the arrival served (see slots.ts). The feed
// vendor keeps a transit vehicle on its block's scheduled trip, so a bus that
// falls a whole headway behind, or swaps with another, is reported that many
// minutes late while a bus still passes each stop near its scheduled time.
// Lateness is measured against the matched slot. Null when the bus route is
// unknown.
export const todaysArrivals = sqliteTable('todays_arrivals', {
  // scheduledCallId
  id: text().primaryKey(),
  schedule_number: text().notNull(),
  equipment_id: text().notNull(),
  route_id: integer().notNull(),
  stop_id: text().notNull(),
  arrived_at: integer().notNull(),
  // null while the bus is still at the stop
  departed_at: integer(),
  slot_at: integer(),
  timepoint: integer({ mode: 'boolean' }).notNull(),
})

export type TodaysArrival = typeof todaysArrivals.$inferSelect
