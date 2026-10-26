import { asc, eq } from 'drizzle-orm'
import type { DrizzleSqliteDODatabase } from 'drizzle-orm/durable-sqlite'
import * as schema from './schema'
import type { ScheduledStop } from './schedule'

export type ScheduledCallHistory = {
  schedule_number: string
  pattern_stop_id: number
  scheduled_at: number
  route_id: number
  equipment_id: string
  // oldest first
  predictions: { made_at: number; predicted_at: number }[]
  arrivals: { rule: (typeof schema.arrivalRules)[number]; arrived_at: number; distance_m: number }[]
}

type Db = DrizzleSqliteDODatabase<typeof schema>

export function stopSchedule(db: Db, stopId: string): ScheduledStop[] {
  return db.select().from(schema.scheduledStops).where(eq(schema.scheduledStops.stop_id, stopId)).all()
}

// The bus stop's scheduled calls in the monitoring record.
export function stopHistory(db: Db, stopId: string): ScheduledCallHistory[] {
  const calls = new Map<string, ScheduledCallHistory>()
  const callFor = (row: Omit<ScheduledCallHistory, 'predictions' | 'arrivals'>) => {
    const key = `${row.schedule_number}:${row.pattern_stop_id}:${row.scheduled_at}`
    let call = calls.get(key)
    if (!call) {
      call = {
        schedule_number: row.schedule_number,
        pattern_stop_id: row.pattern_stop_id,
        scheduled_at: row.scheduled_at,
        route_id: row.route_id,
        equipment_id: row.equipment_id,
        predictions: [],
        arrivals: [],
      }
      calls.set(key, call)
    }
    return call
  }

  const p = schema.arrivalPredictions
  for (const row of db
    .select()
    .from(p)
    .where(eq(p.stop_id, stopId))
    .orderBy(asc(p.made_at))
    .all()) {
    const call = callFor(row)
    // a transit vehicle can be swapped onto a scheduled trip
    call.equipment_id = row.equipment_id
    call.predictions.push({ made_at: row.made_at, predicted_at: row.predicted_at })
  }

  const o = schema.observedArrivals
  for (const row of db
    .select()
    .from(o)
    .where(eq(o.stop_id, stopId))
    .orderBy(asc(o.arrived_at))
    .all()) {
    callFor(row).arrivals.push({ rule: row.rule, arrived_at: row.arrived_at, distance_m: row.distance_m })
  }

  return [...calls.values()].sort((a, b) => a.scheduled_at - b.scheduled_at)
}
