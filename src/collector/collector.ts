import { drizzle, type DrizzleSqliteDODatabase } from 'drizzle-orm/durable-sqlite'
import { migrate } from 'drizzle-orm/durable-sqlite/migrator'
import { lt } from 'drizzle-orm'
import { PartyDbServer } from 'party-db/server'
import type { WriteEvent } from 'party-db'
import { liveCollections, newestPositionFixCollection } from '../live/collections'
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

const TICK_MS = 10_000
const FETCH_TIMEOUT_MS = 5_000
const RETENTION_MS = 14 * 24 * 60 * 60 * 1000
const PRUNE_EVERY_MS = 60 * 60 * 1000

type PollResult = typeof schema.pollAttempts.$inferInsert

export class Collector extends PartyDbServer<Env> {
  collections = liveCollections
  // One hour of ticks. A client away longer gets a fresh snapshot, which is
  // one row per transit vehicle.
  oplogRetention = 360

  db!: DrizzleSqliteDODatabase<typeof schema>
  #gtfsRtEtag: string | null = null
  #lastPrunedAt = 0

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
      await Promise.all([this.#pollJsonApi(), this.#pollGtfsRt()])
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
        const contentType = response.headers.get('content-type') ?? ''
        // unknown services answer 200 with an HTML error page
        if (!contentType.includes('json')) throw new Error(`content-type ${contentType}`)
        return parseJsonApi(await response.json(), Date.now())
      },
      jsonApiHistoryRow,
    )
    if (polled) await this.#syncNewestFixes(polled.rows)
  }

  async #pollGtfsRt() {
    const polled = await this.#poll(
      'gtfs_rt',
      GTFS_RT_POSITIONS_URL,
      this.#gtfsRtEtag ? { 'if-none-match': this.#gtfsRtEtag } : {},
      async (response) =>
        parseGtfsRtPositions(new Uint8Array(await response.arrayBuffer()), Date.now()),
      (row) => row,
    )
    if (polled) this.#gtfsRtEtag = polled.response.headers.get('etag')
  }

  // Records the poll attempt and its position fixes. Returns null when there
  // was nothing to parse or parsing failed.
  async #poll<T>(
    source: schema.Source,
    url: string,
    headers: Record<string, string>,
    parse: (response: Response) => Promise<T[]>,
    toHistory: (row: T) => PositionFixRow,
  ): Promise<{ response: Response; rows: T[] } | null> {
    const { attempt, response } = await this.#fetch(source, url, headers)
    if (!response) {
      this.#recordAttempt(attempt)
      return null
    }
    let rows: T[]
    try {
      rows = await parse(response)
    } catch (error) {
      this.#recordAttempt({ ...attempt, outcome: 'parse_error', error: String(error) })
      return null
    }
    const fixesNew = this.#insertHistory(rows.map(toHistory))
    this.#recordAttempt({ ...attempt, fixes_seen: rows.length, fixes_new: fixesNew })
    return { response, rows }
  }

  // Resolves with a response only for a 2xx; anything else is a finished attempt.
  async #fetch(
    source: schema.Source,
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

  // Returns how many rows were new; a fix served twice is stored once.
  #insertHistory(rows: PositionFixRow[]): number {
    let inserted = 0
    for (const row of rows) {
      inserted += this.db
        .insert(schema.positionFixes)
        .values(row)
        .onConflictDoNothing()
        .returning({ fix_time: schema.positionFixes.fix_time })
        .all().length
    }
    return inserted
  }

  // Ops are chosen against what the table holds now: deletes need the
  // transit vehicles that dropped out, unchanged fixes are skipped, and an
  // update that hits no row would fail the whole commit.
  async #syncNewestFixes(fixes: NewestPositionFixRow[]) {
    const current = new Map(
      this.db
        .select()
        .from(schema.newestPositionFixes)
        .all()
        .map((row) => [row.equipment_id, row]),
    )
    const ops: WriteEvent[] = []
    for (const fix of fixes) {
      const existing = current.get(fix.equipment_id)
      if (!existing) ops.push({ type: 'insert', value: fix })
      else if (fix.fix_time > existing.fix_time) ops.push({ type: 'update', value: fix })
      current.delete(fix.equipment_id)
    }
    for (const value of current.values()) ops.push({ type: 'delete', value })
    if (ops.length === 0) return
    await this.commit([{ channel: newestPositionFixCollection.name, ops }])
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
