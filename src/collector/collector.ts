import { drizzle, type DrizzleSqliteDODatabase } from 'drizzle-orm/durable-sqlite'
import { migrate } from 'drizzle-orm/durable-sqlite/migrator'
import { and, desc, eq, lt } from 'drizzle-orm'
import { PartyDbServer } from 'party-db/server'
import {
  busRouteCollection,
  busStopCollection,
  currentArrivalPredictionCollection,
  liveCollections,
  newestPositionFixCollection,
  routePatternCollection,
  routeStopCollection,
  timetableStopCollection,
} from '../live/collections'
import { ArrivalWatch } from './arrivals'
import { syncBatch } from './diff'
import migrations from './migrations/migrations'
import * as schema from './schema'
import {
  GTFS_RT_POSITIONS_URL,
  JSON_API_URL,
  jsonApiHistoryRow,
  parseGtfsRtPositions,
  parseJsonApi,
  type NewestPositionFixRow,
  type PositionFixRow,
} from './feeds'
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
import {
  parseStopEtas,
  parseVehicleEtas,
  stopEtasUrl,
  type CurrentArrivalPredictionRow,
} from './predictions'
import { stopHistory, stopSchedule } from './stop-details'

const TICK_MS = 10_000
const FETCH_TIMEOUT_MS = 5_000
const RETENTION_MS = 14 * 24 * 60 * 60 * 1000
const PRUNE_EVERY_MS = 60 * 60 * 1000
const REFERENCE_EVERY_MS = 60 * 60 * 1000
const REFERENCE_RETRY_MS = 60 * 1000
const SCHEDULE_EVERY_MS = 60 * 60 * 1000
const SCHEDULE_RETRY_MS = 10 * 60 * 1000
const STOP_ETAS_EVERY_MS = 10 * 60 * 1000
const STOP_ETAS_RETRY_MS = 60 * 1000
// A browser showing a bus stop renews its watch more often than this.
const STOP_WATCH_MS = 60 * 1000

type PollResult = typeof schema.pollAttempts.$inferInsert
type Polled<T> =
  | { ok: true; response: Response; value: T }
  | { ok: false; outcome: PollResult['outcome'] }

export class Collector extends PartyDbServer<Env> {
  collections = liveCollections
  // Five minutes of ticks, at one batch each for position fixes and arrival
  // predictions. Each position fix batch carries every moving transit
  // vehicle, so replaying more than this costs more than the fresh snapshot
  // a client gets instead.
  oplogRetention = 60

  db!: DrizzleSqliteDODatabase<typeof schema>
  #gtfsRtEtag: string | null = null
  #lastPrunedAt = 0
  #referenceDueAt = 0
  #scheduleDueAt = 0
  #stopEtasDueAt = 0
  #gtfsStaticEtag: string | null | undefined
  #arrivals = new ArrivalWatch()
  // null until the first get_vehicles poll after a start, so a failed poll
  // doesn't empty current_arrival_predictions
  #vehiclePredictions: CurrentArrivalPredictionRow[] | null = null
  #watchedStopPredictions: CurrentArrivalPredictionRow[] = []
  // bus stop id -> when a browser last asked to watch it
  #watchedStops = new Map<string, number>()
  // arrival prediction id -> the last get_vehicles prediction recorded for it
  #recordedPredictions = new Map<string, string>()

  async onStart() {
    this.db = drizzle(this.ctx.storage, { schema })
    await migrate(this.db, migrations)
    await super.onStart()
    await this.ensurePolling()
  }

  async ensurePolling() {
    if ((await this.ctx.storage.getAlarm()) === null) {
      await this.ctx.storage.setAlarm(Date.now())
    }
  }

  async onAlarm() {
    // Schedule the next tick before doing any work, so a failure below can't
    // stop the loop.
    await this.ctx.storage.setAlarm(Date.now() + TICK_MS)
    try {
      await Promise.all([
        this.#pollJsonApi(),
        this.#pollWatchedStops(),
        this.#pollGtfsRt(),
        this.#snapshotStopEtasIfDue(),
        this.#refreshReferenceIfDue(),
        this.#checkScheduleIfDue(),
      ])
      await this.#syncPredictions()
      this.#pruneIfDue()
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
    this.#recordArrivals(fixes)
    this.#recordVehiclePredictions(predictions)
    this.#vehiclePredictions = predictions
    await this.#syncNewestFixes(fixes)
  }

  // get_vehicles only predicts each transit vehicle's next five bus stops,
  // a few minutes out; a bus stop someone has open gets the feed vendor's
  // full list for it, as the vendor site does.
  async #pollWatchedStops() {
    const now = Date.now()
    for (const [stopId, at] of this.#watchedStops) {
      if (now - at > STOP_WATCH_MS) this.#watchedStops.delete(stopId)
    }
    if (this.#watchedStops.size === 0) {
      this.#watchedStopPredictions = []
      return
    }
    const polled = await this.#poll(
      'watched_stop_etas',
      stopEtasUrl([...this.#watchedStops.keys()]),
      {},
      async (response) => parseStopEtas(await readJson(response), Date.now()),
    )
    this.#watchedStopPredictions = polled.ok ? polled.value : []
  }

  // RPC: a browser showing this bus stop calls it at least once a minute.
  watchStop(stopId: string) {
    const known = this.db.select({ id: schema.busStops.id }).from(schema.busStops).where(eq(schema.busStops.id, stopId)).get()
    if (known) this.#watchedStops.set(stopId, Date.now())
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
    const running = this.db.select({ id: schema.newestPositionFixes.equipment_id }).from(schema.newestPositionFixes).limit(1).get()
    const stopIds = this.db.select({ id: schema.busStops.id }).from(schema.busStops).all()
    if (!running || stopIds.length === 0) return
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

  // Transit vehicles that leave the feed are deleted; a fix is only written
  // when it is newer than the one held.
  async #syncNewestFixes(fixes: NewestPositionFixRow[]) {
    const batch = syncBatch(
      newestPositionFixCollection,
      this.db.select().from(schema.newestPositionFixes).all(),
      fixes,
      (prev, fix) => fix.fix_time > prev.fix_time,
    )
    if (batch.ops.length > 0) await this.commit([batch])
  }

  // The current_arrival_predictions ops double as the record of when each
  // arrival prediction was first served or changed.
  // Where both sources predict a scheduled call, get_vehicles wins.
  async #syncPredictions() {
    if (!this.#vehiclePredictions) return
    const rows = new Map(this.#watchedStopPredictions.map((p) => [p.id, p]))
    for (const p of this.#vehiclePredictions) rows.set(p.id, p)
    const batch = syncBatch(
      currentArrivalPredictionCollection,
      this.db.select().from(schema.currentArrivalPredictions).all(),
      [...rows.values()],
    )
    if (batch.ops.length > 0) await this.commit([batch])
  }

  // Each get_vehicles arrival prediction is recorded when first served and
  // when it changes. Watched bus stops are not recorded: they are sampled
  // only while someone looks.
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

  #recordArrivals(fixes: NewestPositionFixRow[]) {
    const stops = new Map(this.db.select().from(schema.busStops).all().map((s) => [s.id, s]))
    for (const arrival of this.#arrivals.observe(fixes, stops)) {
      this.db.insert(schema.observedArrivals).values(arrival).onConflictDoNothing().run()
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
    // An empty timetable needs the file even if it hasn't changed.
    const timetableEmpty = !this.db.select({ id: schema.timetableStops.id }).from(schema.timetableStops).limit(1).get()
    this.#gtfsStaticEtag ??= timetableEmpty ? null : (latest?.gtfs_etag ?? null)
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
    if (timetable.ops.length > 0) await this.commit([timetable])

    const versionId = await scheduleVersionId(schedule.scheduledStops)
    if (latest?.to_version_id === versionId && latest.feed_version === schedule.feedVersion) {
      return true
    }
    this.#recordScheduleChange(latest?.to_version_id ?? null, versionId, schedule)
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

  #pruneIfDue() {
    const now = Date.now()
    if (now - this.#lastPrunedAt < PRUNE_EVERY_MS) return
    this.#lastPrunedAt = now
    const cutoff = now - RETENTION_MS
    this.db.delete(schema.positionFixes).where(lt(schema.positionFixes.fix_time, cutoff)).run()
    this.db.delete(schema.pollAttempts).where(lt(schema.pollAttempts.started_at, cutoff)).run()
    this.db.delete(schema.arrivalPredictions).where(lt(schema.arrivalPredictions.made_at, cutoff)).run()
    this.db.delete(schema.observedArrivals).where(lt(schema.observedArrivals.arrived_at, cutoff)).run()
  }
}

// unknown JSON API services answer 200 with an HTML error page
async function readJson(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.includes('json')) throw new Error(`content-type ${contentType}`)
  return response.json()
}
