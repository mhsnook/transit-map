import { drizzle, type DrizzleSqliteDODatabase } from 'drizzle-orm/durable-sqlite'
import { migrate } from 'drizzle-orm/durable-sqlite/migrator'
import { lt } from 'drizzle-orm'
import { PartyDbServer } from 'party-db/server'
import {
  busRouteCollection,
  busStopCollection,
  liveCollections,
  newestPositionFixCollection,
  routePatternCollection,
  routeStopCollection,
} from '../live/collections'
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

const TICK_MS = 10_000
const FETCH_TIMEOUT_MS = 5_000
const RETENTION_MS = 14 * 24 * 60 * 60 * 1000
const PRUNE_EVERY_MS = 60 * 60 * 1000
const REFERENCE_EVERY_MS = 60 * 60 * 1000
const REFERENCE_RETRY_MS = 60 * 1000

type PollResult = typeof schema.pollAttempts.$inferInsert

export class Collector extends PartyDbServer<Env> {
  collections = liveCollections
  // Five minutes of ticks. Each tick's batch carries every moving transit
  // vehicle, so replaying more than this costs more than the ~120 KB fresh
  // snapshot a client gets instead.
  oplogRetention = 30

  db!: DrizzleSqliteDODatabase<typeof schema>
  #gtfsRtEtag: string | null = null
  #lastPrunedAt = 0
  #referenceDueAt = 0

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
        this.#pollGtfsRt(),
        this.#refreshReferenceIfDue(),
      ])
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
      async (response) => parseJsonApi(await readJson(response), Date.now()),
      (fixes) => this.#storeFixes(fixes.map(jsonApiHistoryRow)),
    )
    if (polled) await this.#syncNewestFixes(polled.value)
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
    if (polled) this.#gtfsRtEtag = polled.response.headers.get('etag')
  }

  // Records the poll attempt, plus whatever `store` reports. Returns null when
  // there was nothing to parse or parsing failed.
  async #poll<T>(
    source: schema.PollSource,
    url: string,
    headers: Record<string, string>,
    parse: (response: Response) => Promise<T>,
    store?: (value: T) => Partial<PollResult>,
  ): Promise<{ response: Response; value: T } | null> {
    const { attempt, response } = await this.#fetch(source, url, headers)
    if (!response) {
      this.#recordAttempt(attempt)
      return null
    }
    let value: T
    try {
      value = await parse(response)
    } catch (error) {
      this.#recordAttempt({ ...attempt, outcome: 'parse_error', error: String(error) })
      return null
    }
    this.#recordAttempt({ ...attempt, ...store?.(value) })
    return { response, value }
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
    if (!patterns || !abbrs || !stops) return false

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

  #pruneIfDue() {
    const now = Date.now()
    if (now - this.#lastPrunedAt < PRUNE_EVERY_MS) return
    this.#lastPrunedAt = now
    const cutoff = now - RETENTION_MS
    this.db.delete(schema.positionFixes).where(lt(schema.positionFixes.fix_time, cutoff)).run()
    this.db.delete(schema.pollAttempts).where(lt(schema.pollAttempts.started_at, cutoff)).run()
  }
}

// unknown JSON API services answer 200 with an HTML error page
async function readJson(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.includes('json')) throw new Error(`content-type ${contentType}`)
  return response.json()
}
