import type { NewestPositionFixRow } from './feeds'
import type { CurrentArrivalPredictionRow } from './predictions'
import type { arrivalRules, busStops, observedArrivals } from './schema'

type BusStopRow = typeof busStops.$inferSelect
type ObservedArrivalRow = typeof observedArrivals.$inferInsert
type ArrivalRule = (typeof arrivalRules)[number]

export const ARRIVAL_RADIUS_M = 30
// A later scheduled trip of the same transit vehicle can have a scheduled call
// at a bus stop it is passing now; its prediction is too far off to match.
const PREDICTION_WINDOW_MS = 15 * 60_000
// How long a scheduled call stays watched after its last arrival prediction.
// minutesToNextStops drops a call once the transit vehicle has passed it,
// which can be before the position fix that shows it there arrives.
const WATCH_MS = 20 * 60_000

type Watched = { call: CurrentArrivalPredictionRow; lastPredictedAt: number; fired: Set<ArrivalRule> }

// Matches JSON API position fixes against the scheduled calls that their
// transit vehicles are predicted to make. Held in memory: after a restart a
// rule can fire again, which the observed_arrivals primary key absorbs.
export class ArrivalWatch {
  #watched = new Map<string, Watched>()
  #lastFixTime = new Map<string, number>()

  predicted(calls: CurrentArrivalPredictionRow[], at: number) {
    for (const call of calls) {
      const watched = this.#watched.get(call.id)
      // a schedule number recurs every service day
      if (watched?.call.scheduled_at === call.scheduled_at) {
        watched.call = call
        watched.lastPredictedAt = at
      } else {
        this.#watched.set(call.id, { call, lastPredictedAt: at, fired: new Set() })
      }
    }
    for (const [id, watched] of this.#watched) {
      if (at - watched.lastPredictedAt > WATCH_MS) this.#watched.delete(id)
    }
  }

  observe(fixes: NewestPositionFixRow[], stopsById: Map<string, BusStopRow>): ObservedArrivalRow[] {
    const byVehicle = new Map<string, Watched[]>()
    for (const watched of this.#watched.values()) {
      const list = byVehicle.get(watched.call.equipment_id) ?? []
      list.push(watched)
      byVehicle.set(watched.call.equipment_id, list)
    }

    const arrivals: ObservedArrivalRow[] = []
    for (const fix of fixes) {
      if (this.#lastFixTime.get(fix.equipment_id) === fix.fix_time) continue
      this.#lastFixTime.set(fix.equipment_id, fix.fix_time)

      // Only the earliest scheduled call at each bus stop that the vendor has
      // not marked passed, so a bus dwelling at a stop doesn't also arrive
      // for its next call there.
      const candidates = new Map<string, Watched>()
      for (const watched of byVehicle.get(fix.equipment_id) ?? []) {
        if (watched.fired.has('passed')) continue
        if (Math.abs(fix.fix_time - watched.call.predicted_at) > PREDICTION_WINDOW_MS) continue
        const other = candidates.get(watched.call.stop_id)
        if (!other || watched.call.scheduled_at < other.call.scheduled_at) {
          candidates.set(watched.call.stop_id, watched)
        }
      }

      for (const watched of candidates.values()) {
        const stop = stopsById.get(watched.call.stop_id)
        if (!stop) continue
        const distance = distanceMeters(fix, stop)
        const fire = (rule: ArrivalRule) => {
          if (watched.fired.has(rule)) return
          watched.fired.add(rule)
          const { call } = watched
          arrivals.push({
            schedule_number: call.schedule_number,
            pattern_stop_id: call.pattern_stop_id,
            scheduled_at: call.scheduled_at,
            stop_id: call.stop_id,
            route_id: call.route_id,
            equipment_id: call.equipment_id,
            rule,
            arrived_at: fix.fix_time,
            distance_m: distance,
          })
        }
        if (distance <= ARRIVAL_RADIUS_M) fire('distance')
        if (fix.last_pattern_stop_id === watched.call.pattern_stop_id) {
          if (fix.at_stop) fire('at_stop')
          fire('passed')
        }
      }
    }
    return arrivals
  }
}

export function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = Math.PI / 180
  const x = (b.lng - a.lng) * rad * Math.cos(((a.lat + b.lat) / 2) * rad)
  const y = (b.lat - a.lat) * rad
  return 6_371_000 * Math.hypot(x, y)
}
