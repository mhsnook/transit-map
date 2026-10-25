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
// Durable Object SQLite allows at most 100 bound parameters per statement
const HISTORY_ROWS_PER_INSERT = 9

type PollResult = Omit<typeof schema.pollAttempts.$inferInsert, 'id'>

export class Collector extends PartyDbServer<Env> {
  collections = liveCollections

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
    const startedAt = Date.now()
    const result = await this.#fetch('json_api', JSON_API_URL, startedAt, {})
    if (!result.response) return this.#recordAttempt(result.attempt)

    let fixes: NewestPositionFixRow[]
    try {
      const contentType = result.response.headers.get('content-type') ?? ''
      // unknown services answer 200 with an HTML error page
      if (!contentType.includes('json')) throw new Error(`content-type ${contentType}`)
      fixes = parseJsonApi(await result.response.json(), Date.now())
    } catch (error) {
      return this.#recordAttempt({ ...result.attempt, outcome: 'parse_error', error: String(error) })
    }

    const fixesNew = this.#insertHistory(fixes.map(jsonApiHistoryRow))
    this.#recordAttempt({ ...result.attempt, fixes_seen: fixes.length, fixes_new: fixesNew })
    await this.#syncNewestFixes(fixes)
  }

  async #pollGtfsRt() {
    const startedAt = Date.now()
    const headers: Record<string, string> = this.#gtfsRtEtag
      ? { 'if-none-match': this.#gtfsRtEtag }
      : {}
    const result = await this.#fetch('gtfs_rt', GTFS_RT_POSITIONS_URL, startedAt, headers)
    if (!result.response) return this.#recordAttempt(result.attempt)

    let fixes: PositionFixRow[]
    try {
      const body = new Uint8Array(await result.response.arrayBuffer())
      fixes = parseGtfsRtPositions(body, Date.now())
    } catch (error) {
      return this.#recordAttempt({ ...result.attempt, outcome: 'parse_error', error: String(error) })
    }
    this.#gtfsRtEtag = result.response.headers.get('etag')

    const fixesNew = this.#insertHistory(fixes)
    this.#recordAttempt({ ...result.attempt, fixes_seen: fixes.length, fixes_new: fixesNew })
  }

  // Resolves with a response only for a 2xx; anything else is a finished attempt.
  async #fetch(
    source: schema.Source,
    url: string,
    startedAt: number,
    headers: Record<string, string>,
  ): Promise<{ attempt: PollResult; response?: Response }> {
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
    for (let i = 0; i < rows.length; i += HISTORY_ROWS_PER_INSERT) {
      inserted += this.db
        .insert(schema.positionFixes)
        .values(rows.slice(i, i + HISTORY_ROWS_PER_INSERT))
        .onConflictDoNothing()
        .returning({ fix_time: schema.positionFixes.fix_time })
        .all().length
    }
    return inserted
  }

  // party-db has no upsert, and an update that hits no row fails the whole
  // commit, so ops are chosen against what the table holds now.
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
    // transit vehicles no longer in service
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
