import { drizzle, type DrizzleSqliteDODatabase } from 'drizzle-orm/durable-sqlite'
import { migrate } from 'drizzle-orm/durable-sqlite/migrator'
import { and, desc, eq, inArray, isNull, lt, or } from 'drizzle-orm'
import type { WriteBatch, WriteEvent } from 'party-db'
import { PartyDbServer } from 'party-db/server'
import type { Connection, ConnectionContext } from 'partyserver'
import {
  busRouteCollection,
  busStopCollection,
  liveCollections,
  routePatternCollection,
  routeStopCollection,
  timetableStopCollection,
  todaysArrivalCollection,
} from '../live/collections'
import { ArrivalWatch } from './arrivals'
import { syncBatch } from './diff'
import migrations from './migrations/migrations'
import * as schema from './schema'
import { parseStopEtas, parseVehicleEtas, stopEtasUrl, type CurrentArrivalPredictionRow } from '../live/predictions'
import { JSON_API_URL, parseJsonApi, readJson, type NewestPositionFix } from '../live/vehicles'
import { GTFS_RT_POSITIONS_URL, jsonApiHistoryRow, parseGtfsRtPositions, type PositionFixRow } from './feeds'
import {
  PATTERNS_URL,
  ROUTES_URL,
  STOPS_URL,
  parsePatterns,
  parseRouteAbbrs,
  parseStops,
  referenceRows,
} from './reference'
import {
  GTFS_STATIC_URL,
  parsePublishedSchedule,
  scheduledStopKey,
  scheduleVersionId,
  type PublishedSchedule,
  type ScheduledStop,
} from './schedule'
import { SlotIndex } from './slots'
import { stopHistory, stopSchedule } from './stop-details'

const TICK_MS = 10_000
const FETCH_TIMEOUT_MS = 5_000
const REFERENCE_EVERY_MS = 60 * 60 * 1000
const REFERENCE_RETRY_MS = 60 * 1000
const SCHEDULE_EVERY_MS = 60 * 60 * 1000
const SCHEDULE_RETRY_MS = 10 * 60 * 1000
const STOP_ETAS_EVERY_MS = 10 * 60 * 1000
const STOP_ETAS_RETRY_MS = 60 * 1000
const TODAYS_TIMEPOINTS_MS = 20 * 60 * 60 * 1000
const TODAYS_OTHER_STOPS_MS = 2 * 60 * 60 * 1000

// COLLECTOR_ENABLED is a var in wrangler.jsonc. Unless it is "true" the
// collector runs no alarm loop and records nothing: the map does not need it,
// since browsers read buses from the feed vendor.
export function collectorEnabled(env: Env): boolean {
  return String(env.COLLECTOR_ENABLED) === 'true'
}

type PollResult = typeof schema.pollAttempts.$inferInsert
type Polled<T> =
  | { ok: true; response: Response; value: T }
  | { ok: false; outcome: PollResult['outcome'] }

export class Collector extends PartyDbServer<Env> {
  collections = liveCollections
  // A reconnecting browser replays at most this many batches; past that it
  // gets a fresh snapshot.
  oplogRetention = 60

  db!: DrizzleSqliteDODatabase<typeof schema>
  #gtfsRtEtag: string | null = null
  #referenceDueAt = 0
  #scheduleDueAt = 0
  #stopEtasDueAt = 0
  #gtfsStaticEtag: string | null | undefined
  #arrivals = new ArrivalWatch()
  // whether the newest get_vehicles poll served any transit vehicle
  #busesRunning = false
  #refreshing: Promise<void> | null = null
  // arrival prediction id -> the last get_vehicles prediction recorded for it
  #recordedPredictions = new Map<string, string>()
  // built from the schedule on first use; dropped when the schedule changes
  #slotIndex: SlotIndex | null = null

  async onStart() {
    this.db = drizzle(this.ctx.storage, { schema })
    await migrate(this.db, migrations)
    await super.onStart()
    if (collectorEnabled(this.env)) {
      await this.ensurePolling()
    } else {
      // Every wake starts a new instance, so the due times come from storage.
      this.#referenceDueAt = this.#lastPolledAt('reference', ['ok']) + REFERENCE_EVERY_MS
      this.#scheduleDueAt = this.#lastPolledAt('schedule', ['ok', 'not_modified']) + SCHEDULE_EVERY_MS
    }
  }

  async ensurePolling() {
    if (!collectorEnabled(this.env)) return
    if ((await this.ctx.storage.getAlarm()) === null) {
      await this.ctx.storage.setAlarm(Date.now())
    }
  }

  // Without the alarm loop, a browser that connects is what keeps bus routes,
  // bus stops and the timetable current. The connect does not wait for it.
  onConnect(connection: Connection, ctx: ConnectionContext) {
    if (!collectorEnabled(this.env)) void this.#refreshReferenceAndSchedule()
    return super.onConnect(connection, ctx)
  }

  #refreshReferenceAndSchedule(): Promise<void> {
    this.#refreshing ??= Promise.all([this.#refreshReferenceIfDue(), this.#checkScheduleIfDue()])
      .then(
        () => {},
        (error) => console.error('collector reference refresh failed', error),
      )
      .finally(() => {
        this.#refreshing = null
      })
    return this.#refreshing
  }

  // 0 when this source has never been polled with one of these outcomes.
  #lastPolledAt(source: schema.PollSource, outcomes: PollResult['outcome'][]): number {
    const t = schema.pollAttempts
    const row = this.db
      .select({ at: t.started_at })
      .from(t)
      .where(and(eq(t.source, source), inArray(t.outcome, outcomes)))
      .orderBy(desc(t.started_at))
      .limit(1)
      .get()
    return row?.at ?? 0
  }

  async onAlarm() {
    // A collector that was turned off sets no next alarm, so this is its last tick.
    if (!collectorEnabled(this.env)) return
    // Schedule the next tick before doing any work, so a failure below can't
    // stop the loop.
    await this.ctx.storage.setAlarm(Date.now() + TICK_MS)
    try {
      await Promise.all([
        this.#pollJsonApi(),
        this.#pollGtfsRt(),
        this.#snapshotStopEtasIfDue(),
        this.#refreshReferenceIfDue(),
        this.#checkScheduleIfDue(),
      ])
    } catch (error) {
      console.error('collector tick failed', error)
    }
  }

  async #pollJsonApi() {
    const polled = await this.#poll(
      'json_api',
      JSON_API_URL,
      {},
      async (response) => {
        const body = await readJson(response)
        const receivedAt = Date.now()
        return { fixes: parseJsonApi(body, receivedAt), predictions: parseVehicleEtas(body, receivedAt) }
      },
      ({ fixes }) => this.#storeFixes(fixes.map(jsonApiHistoryRow)),
    )
    if (!polled.ok) return
    const { fixes, predictions } = polled.value
    // a scheduled call has to be watched before a fix can arrive at it
    this.#arrivals.predicted(predictions, Date.now())
    this.#recordVehiclePredictions(predictions)
    this.#busesRunning = fixes.length > 0
    const batch = this.#todaysArrivalsBatch(fixes)
    if (batch.ops.length > 0) await this.commit([batch])
  }

  async #pollGtfsRt() {
    const polled = await this.#poll(
      'gtfs_rt',
      GTFS_RT_POSITIONS_URL,
      this.#gtfsRtEtag ? { 'if-none-match': this.#gtfsRtEtag } : {},
      async (response) =>
        parseGtfsRtPositions(new Uint8Array(await response.arrayBuffer()), Date.now()),
      (fixes) => this.#storeFixes(fixes),
    )
    if (polled.ok) this.#gtfsRtEtag = polled.response.headers.get('etag')
  }

  // Every arrival prediction for every bus stop, up to ~80 minutes out. The
  // live ones come from get_vehicles; this is a sample of longer lead times
  // for prediction error, so it is taken rarely and not while nothing runs.
  async #snapshotStopEtasIfDue() {
    const now = Date.now()
    if (now < this.#stopEtasDueAt) return
    const stopIds = this.db.select({ id: schema.busStops.id }).from(schema.busStops).all()
    if (!this.#busesRunning || stopIds.length === 0) return
    const polled = await this.#poll(
      'stop_etas',
      stopEtasUrl(stopIds.map((s) => s.id)),
      {},
      async (response) => parseStopEtas(await readJson(response), Date.now()),
    )
    this.#stopEtasDueAt = now + (polled.ok ? STOP_ETAS_EVERY_MS : STOP_ETAS_RETRY_MS)
    if (!polled.ok) return
    for (const { id: _, ...prediction } of polled.value) {
      this.db
        .insert(schema.arrivalPredictions)
        .values({ made_at: now, source: 'get_stop_etas', ...prediction })
        .run()
    }
  }

  // Records the poll attempt, plus whatever `store` reports.
  async #poll<T>(
    source: schema.PollSource,
    url: string,
    headers: Record<string, string>,
    parse: (response: Response) => Promise<T>,
    store?: (value: T) => Partial<PollResult>,
  ): Promise<Polled<T>> {
    const { attempt, response } = await this.#fetch(source, url, headers)
    if (!response) {
      this.#recordAttempt(attempt)
      return { ok: false, outcome: attempt.outcome }
    }
    let value: T
    try {
      value = await parse(response)
    } catch (error) {
      this.#recordAttempt({ ...attempt, outcome: 'parse_error', error: String(error) })
      return { ok: false, outcome: 'parse_error' }
    }
    this.#recordAttempt({ ...attempt, ...store?.(value) })
    return { ok: true, response, value }
  }

  // Resolves with a response only for a 2xx; anything else is a finished attempt.
  async #fetch(
    source: schema.PollSource,
    url: string,
    headers: Record<string, string>,
  ): Promise<{ attempt: PollResult; response?: Response }> {
    const startedAt = Date.now()
    const attempt = (fields: Partial<PollResult>): PollResult => ({
      source,
      started_at: startedAt,
      duration_ms: Date.now() - startedAt,
      outcome: 'ok',
      ...fields,
    })
    try {
      const response = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      })
      if (response.status === 304) {
        return { attempt: attempt({ outcome: 'not_modified', http_status: 304 }) }
      }
      if (!response.ok) {
        return { attempt: attempt({ outcome: 'http_error', http_status: response.status }) }
      }
      return { attempt: attempt({ http_status: response.status }), response }
    } catch (error) {
      const outcome = error instanceof DOMException && error.name === 'TimeoutError' ? 'timeout' : 'network_error'
      return { attempt: attempt({ outcome, error: String(error) }) }
    }
  }

  #recordAttempt(attempt: PollResult) {
    this.db.insert(schema.pollAttempts).values(attempt).run()
  }

  // A fix served twice is stored once.
  #storeFixes(rows: PositionFixRow[]): Partial<PollResult> {
    let inserted = 0
    for (const row of rows) {
      inserted += this.db
        .insert(schema.positionFixes)
        .values(row)
        .onConflictDoNothing()
        .returning({ fix_time: schema.positionFixes.fix_time })
        .all().length
    }
    return { fixes_seen: rows.length, fixes_new: inserted }
  }

  // Each get_vehicles arrival prediction is recorded when first served and
  // when it changes.
  #recordVehiclePredictions(predictions: CurrentArrivalPredictionRow[]) {
    const madeAt = Date.now()
    const seen = new Set<string>()
    for (const { id, ...prediction } of predictions) {
      seen.add(id)
      const signature = `${prediction.predicted_at}|${prediction.scheduled_at}|${prediction.equipment_id}`
      if (this.#recordedPredictions.get(id) === signature) continue
      this.#recordedPredictions.set(id, signature)
      this.db.insert(schema.arrivalPredictions).values({ made_at: madeAt, source: 'get_vehicles', ...prediction }).run()
    }
    for (const id of this.#recordedPredictions.keys()) if (!seen.has(id)) this.#recordedPredictions.delete(id)
  }

  // Every rule that fires goes to observed_arrivals; the first one for a
  // scheduled call, which is the earliest, also goes to todays_arrivals.
  // Departures go to observed_departures and fill in todays_arrivals, and
  // todays_arrivals rows past their window are deleted in the same batch.
  #todaysArrivalsBatch(fixes: NewestPositionFix[]): WriteBatch<schema.TodaysArrival> {
    const stops = new Map(this.db.select().from(schema.busStops).all().map((s) => [s.id, s]))
    const match = this.#slotMatcher()
    const t = schema.todaysArrivals
    const inserts = new Map<string, schema.TodaysArrival>()
    const { arrivals, departures } = this.#arrivals.observe(fixes, stops)
    for (const arrival of arrivals) {
      const slot = match(arrival, arrival.arrived_at)
      this.db
        .insert(schema.observedArrivals)
        .values({ ...arrival, slot_at: slot?.slot_at ?? null })
        .onConflictDoNothing()
        .run()
      const id = schema.scheduledCallId(arrival)
      if (inserts.has(id) || this.db.select({ id: t.id }).from(t).where(eq(t.id, id)).get()) continue
      inserts.set(id, {
        id,
        schedule_number: arrival.schedule_number,
        equipment_id: arrival.equipment_id,
        route_id: arrival.route_id,
        stop_id: arrival.stop_id,
        arrived_at: arrival.arrived_at,
        departed_at: null,
        slot_at: slot?.slot_at ?? null,
        timepoint: slot?.timepoint ?? false,
      })
    }
    const updates = new Map<string, schema.TodaysArrival>()
    for (const departure of departures) {
      this.db.insert(schema.observedDepartures).values(departure).onConflictDoNothing().run()
      const id = schema.scheduledCallId(departure)
      const inserted = inserts.get(id)
      if (inserted) {
        inserted.departed_at = departure.departed_at
        continue
      }
      const row = this.db.select().from(t).where(eq(t.id, id)).get()
      if (row && row.departed_at == null) updates.set(id, { ...row, departed_at: departure.departed_at })
    }
    const now = Date.now()
    const expired = this.db
      .select()
      .from(t)
      .where(
        or(
          and(eq(t.timepoint, true), lt(t.arrived_at, now - TODAYS_TIMEPOINTS_MS)),
          and(eq(t.timepoint, false), lt(t.arrived_at, now - TODAYS_OTHER_STOPS_MS)),
        ),
      )
      .all()
    for (const row of expired) updates.delete(row.id)
    const ops: WriteEvent<schema.TodaysArrival>[] = [
      ...[...inserts.values()].map((value) => ({ type: 'insert' as const, value })),
      ...[...updates.values()].map((value) => ({ type: 'update' as const, value })),
      ...expired.map((value) => ({ type: 'delete' as const, value })),
    ]
    return { channel: todaysArrivalCollection.name, ops }
  }

  // Bus routes are matched by short name: the JSON API's route ids are not
  // the GTFS feed's.
  #slotMatcher() {
    this.#slotIndex ??= new SlotIndex(
      this.db.select().from(schema.scheduledStops).all(),
      new Map(
        this.db
          .selectDistinct({ schedule_number: schema.timetableStops.schedule_number, direction: schema.timetableStops.direction })
          .from(schema.timetableStops)
          .all()
          .filter((t) => t.schedule_number)
          .map((t) => [t.schedule_number!, t.direction]),
      ),
    )
    const index = this.#slotIndex
    const shortNames = new Map(this.db.select().from(schema.busRoutes).all().map((r) => [r.id, r.short_name]))
    type Call = { route_id: number; schedule_number: string; stop_id: string; scheduled_at: number }
    return (call: Call, at: number) => {
      const route = shortNames.get(call.route_id)
      return route == null
        ? null
        : index.match({ route, scheduleNumber: call.schedule_number, stopId: call.stop_id, scheduledAt: call.scheduled_at }, at)
    }
  }

  // RPCs for the stop view.
  stopSchedule(stopId: string) {
    return stopSchedule(this.db, stopId)
  }

  stopHistory(stopId: string) {
    return stopHistory(this.db, stopId)
  }

  // Bus routes, route patterns and bus stops change with the schedule, a few
  // times a year.
  async #refreshReferenceIfDue() {
    const now = Date.now()
    if (now < this.#referenceDueAt) return
    const refreshed = await this.#refreshReference()
    this.#referenceDueAt = now + (refreshed ? REFERENCE_EVERY_MS : REFERENCE_RETRY_MS)
  }

  async #refreshReference(): Promise<boolean> {
    const fetchReference = <T>(url: string, parse: (body: unknown) => T) =>
      this.#poll('reference', url, {}, async (response) => parse(await readJson(response)))
    const [patterns, abbrs, stops] = await Promise.all([
      fetchReference(PATTERNS_URL, parsePatterns),
      fetchReference(ROUTES_URL, parseRouteAbbrs),
      fetchReference(STOPS_URL, parseStops),
    ])
    if (!patterns.ok || !abbrs.ok || !stops.ok) return false

    const currentRoutes = this.db.select().from(schema.busRoutes).all()
    const { busRoutes, routePatterns } = referenceRows(patterns.value, abbrs.value, currentRoutes)
    const batches = [
      syncBatch(busRouteCollection, currentRoutes, busRoutes),
      syncBatch(routePatternCollection, this.db.select().from(schema.routePatterns).all(), routePatterns),
      syncBatch(busStopCollection, this.db.select().from(schema.busStops).all(), stops.value.busStops),
      syncBatch(routeStopCollection, this.db.select().from(schema.routeStops).all(), stops.value.routeStops),
    ].filter((batch) => batch.ops.length > 0)
    if (batches.length > 0) await this.commit(batches)
    return true
  }

  async #checkScheduleIfDue() {
    const now = Date.now()
    if (now < this.#scheduleDueAt) return
    const checked = await this.#checkSchedule()
    this.#scheduleDueAt = now + (checked ? SCHEDULE_EVERY_MS : SCHEDULE_RETRY_MS)
  }

  // The ETag is checked first; a changed file is parsed into scheduled stops,
  // and only a changed set (or feed_version) is recorded as a change.
  async #checkSchedule(): Promise<boolean> {
    const latest = this.db
      .select()
      .from(schema.scheduleChanges)
      .orderBy(desc(schema.scheduleChanges.id))
      .limit(1)
      .get()
    // An empty or outdated timetable needs the file even if it hasn't changed.
    const t = schema.timetableStops
    const timetableStale =
      !this.db.select({ id: t.id }).from(t).limit(1).get() ||
      !!this.db.select({ id: t.id }).from(t).where(isNull(t.schedule_number)).limit(1).get()
    this.#gtfsStaticEtag ??= timetableStale ? null : (latest?.gtfs_etag ?? null)
    const polled = await this.#poll(
      'schedule',
      GTFS_STATIC_URL,
      this.#gtfsStaticEtag ? { 'if-none-match': this.#gtfsStaticEtag } : {},
      async (response) => parsePublishedSchedule(new Uint8Array(await response.arrayBuffer())),
    )
    if (!polled.ok) return polled.outcome === 'not_modified'
    this.#gtfsStaticEtag = polled.response.headers.get('etag')

    const schedule = polled.value
    const timetable = syncBatch(
      timetableStopCollection,
      this.db.select().from(schema.timetableStops).all(),
      schedule.timetableStops,
    )
    if (timetable.ops.length > 0) {
      await this.commit([timetable])
      this.#slotIndex = null
    }

    const versionId = await scheduleVersionId(schedule.scheduledStops)
    if (latest?.to_version_id === versionId && latest.feed_version === schedule.feedVersion) {
      return true
    }
    this.#recordScheduleChange(latest?.to_version_id ?? null, versionId, schedule)
    this.#slotIndex = null
    return true
  }

  #recordScheduleChange(fromVersionId: string | null, toVersionId: string, schedule: PublishedSchedule) {
    const next = new Map(schedule.scheduledStops.map((s) => [scheduledStopKey(s), s]))
    const removed: ScheduledStop[] = []
    for (const s of this.db.select().from(schema.scheduledStops).all()) {
      if (!next.delete(scheduledStopKey(s))) removed.push(s)
    }
    const added = [...next.values()]

    this.db
      .insert(schema.scheduleVersions)
      .values({
        id: toVersionId,
        first_seen_at: Date.now(),
        scheduled_stop_count: schedule.scheduledStops.length,
      })
      .onConflictDoNothing()
      .run()
    const change = this.db
      .insert(schema.scheduleChanges)
      .values({
        observed_at: Date.now(),
        from_version_id: fromVersionId,
        to_version_id: toVersionId,
        feed_version: schedule.feedVersion,
        feed_start_date: schedule.feedStartDate,
        feed_end_date: schedule.feedEndDate,
        gtfs_etag: this.#gtfsStaticEtag,
      })
      .returning({ id: schema.scheduleChanges.id })
      .get()
    for (const s of added) {
      this.db.insert(schema.scheduleDeltas).values({ change_id: change.id, change: 'added', ...s }).run()
      this.db.insert(schema.scheduledStops).values(s).run()
    }
    for (const s of removed) {
      this.db.insert(schema.scheduleDeltas).values({ change_id: change.id, change: 'removed', ...s }).run()
      this.db
        .delete(schema.scheduledStops)
        .where(
          and(
            eq(schema.scheduledStops.route, s.route),
            eq(schema.scheduledStops.days, s.days),
            eq(schema.scheduledStops.direction, s.direction),
            eq(schema.scheduledStops.stop_id, s.stop_id),
            eq(schema.scheduledStops.arrival_time, s.arrival_time),
            eq(schema.scheduledStops.departure_time, s.departure_time),
            eq(schema.scheduledStops.timepoint, s.timepoint),
          ),
        )
        .run()
    }
  }

}
