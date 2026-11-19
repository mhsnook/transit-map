import { createCollection } from '@tanstack/db'
import { useSyncExternalStore } from 'react'
import { parseStopEtas, parseVehicleEtas, stopEtasUrl, type CurrentArrivalPredictionRow } from './predictions'
import { JSON_API_URL, parseJsonApi, readJson, type NewestPositionFix } from './vehicles'

// The browser reads buses and arrival predictions from the feed vendor's JSON
// API, as the vendor's own site does, so the map needs no collector. Browser
// only.

const POLL_MS = 10_000
const FETCH_TIMEOUT_MS = 8_000

type Op<T> = { type: 'insert' | 'update' | 'delete'; value: T }
type Sink<T> = { begin(): void; write(op: Op<T>): void; commit(): void; markReady(): void }

// One collection's rows, replaced as a whole after each poll.
class Feed<T extends object> {
  #rows = new Map<string, T>()
  #sink: Sink<T> | null = null
  #ready = false
  #key: (row: T) => string
  #changed: (prev: T, row: T) => boolean

  constructor(key: (row: T) => string, changed: (prev: T, row: T) => boolean) {
    this.#key = key
    this.#changed = changed
  }

  // A collection that starts syncing again starts empty.
  attach(sink: Sink<T>) {
    this.#sink = sink
    this.#ready = false
    this.#rows.clear()
  }

  detach() {
    this.#sink = null
  }

  get attached() {
    return this.#sink != null
  }

  // Rows missing from `next` are deleted.
  replace(next: T[]) {
    const sink = this.#sink
    if (!sink) return
    const ops: Op<T>[] = []
    const gone = new Map(this.#rows)
    for (const row of next) {
      const key = this.#key(row)
      const prev = gone.get(key)
      if (!prev) ops.push({ type: 'insert', value: row })
      else if (this.#changed(prev, row)) ops.push({ type: 'update', value: row })
      else continue
      this.#rows.set(key, row)
    }
    for (const row of next) gone.delete(this.#key(row))
    for (const [key, value] of gone) {
      ops.push({ type: 'delete', value })
      this.#rows.delete(key)
    }
    if (ops.length === 0) return
    sink.begin()
    for (const op of ops) sink.write(op)
    sink.commit()
  }

  // After the first poll, whether or not it worked, so a view never waits on
  // a feed vendor outage.
  ready() {
    if (this.#ready || !this.#sink) return
    this.#ready = true
    this.#sink.markReady()
  }
}

const anyFieldChanged = <T extends object>(prev: T, row: T) =>
  (Object.keys(row) as (keyof T)[]).some((k) => prev[k] !== row[k])

// A fix is only replaced by a newer one, so a poll that serves the same fix
// again changes nothing.
const fixes = new Feed<NewestPositionFix>(
  (f) => f.equipment_id,
  (prev, fix) => fix.fix_time > prev.fix_time,
)
const predictions = new Feed<CurrentArrivalPredictionRow>((p) => p.id, anyFieldChanged)

// 'error': the newest poll failed, so the rows shown are from the last good
// one, or there are none.
export type VendorStatus = 'loading' | 'ok' | 'error'
let status: VendorStatus = 'loading'
const statusListeners = new Set<() => void>()

function setStatus(next: VendorStatus) {
  if (status === next) return
  status = next
  for (const listener of statusListeners) listener()
}

export function useVendorStatus(): VendorStatus {
  return useSyncExternalStore(
    (listener) => {
      statusListeners.add(listener)
      return () => statusListeners.delete(listener)
    },
    () => status,
    () => 'loading',
  )
}

// bus stop id -> how many open views watch it
const watchedStops = new Map<string, number>()

// get_vehicles only predicts each transit vehicle's next five bus stops, a
// few minutes out. A bus stop someone has open gets the feed vendor's full
// list for it. Returns the function that stops the watch.
export function watchStop(stopId: string): () => void {
  watchedStops.set(stopId, (watchedStops.get(stopId) ?? 0) + 1)
  void poll()
  return () => {
    const count = (watchedStops.get(stopId) ?? 1) - 1
    if (count > 0) watchedStops.set(stopId, count)
    else watchedStops.delete(stopId)
  }
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return readJson(response)
}

let polling = false
// a poll was asked for while one was running
let pollAgain = false

// A failed get_vehicles poll leaves the rows as they are, and position
// staleness keeps growing on the map. A hidden tab does not poll.
async function poll() {
  if (document.visibilityState === 'hidden') return
  if (!fixes.attached && !predictions.attached) return
  if (polling) {
    pollAgain = true
    return
  }
  polling = true
  try {
    const stopIds = [...watchedStops.keys()]
    const [vehicles, stopEtas] = await Promise.all([
      fetchJson(JSON_API_URL),
      stopIds.length === 0 ? null : fetchJson(stopEtasUrl(stopIds)).catch(() => null),
    ])
    const now = Date.now()
    // Where both sources predict a scheduled call, get_vehicles wins.
    const rows = new Map((stopEtas == null ? [] : parseStopEtasOrNone(stopEtas, now)).map((p) => [p.id, p]))
    for (const p of parseVehicleEtas(vehicles, now)) rows.set(p.id, p)
    fixes.replace(parseJsonApi(vehicles, now))
    predictions.replace([...rows.values()])
    setStatus('ok')
  } catch (error) {
    console.error('feed vendor poll failed', error)
    setStatus('error')
  } finally {
    polling = false
    fixes.ready()
    predictions.ready()
    if (pollAgain) {
      pollAgain = false
      void poll()
    }
  }
}

function parseStopEtasOrNone(body: unknown, now: number): CurrentArrivalPredictionRow[] {
  try {
    return parseStopEtas(body, now)
  } catch {
    return []
  }
}

let timer: ReturnType<typeof setInterval> | undefined

function attach<T extends object>(feed: Feed<T>, sink: Sink<T>) {
  feed.attach(sink)
  if (timer === undefined) {
    timer = setInterval(() => void poll(), POLL_MS)
    document.addEventListener('visibilitychange', onVisibilityChange)
  }
  void poll()
  return () => {
    feed.detach()
    if (fixes.attached || predictions.attached) return
    clearInterval(timer)
    timer = undefined
    document.removeEventListener('visibilitychange', onVisibilityChange)
  }
}

function onVisibilityChange() {
  if (document.visibilityState === 'visible') void poll()
}

export function createVendorCollections() {
  return {
    newestPositionFixes: createCollection<NewestPositionFix, string>({
      id: 'vendor_newest_position_fixes',
      getKey: (fix) => fix.equipment_id,
      sync: { rowUpdateMode: 'full', sync: (sink) => attach(fixes, sink) },
    }),
    currentArrivalPredictions: createCollection<CurrentArrivalPredictionRow, string>({
      id: 'vendor_current_arrival_predictions',
      getKey: (prediction) => prediction.id,
      sync: { rowUpdateMode: 'full', sync: (sink) => attach(predictions, sink) },
    }),
  }
}
