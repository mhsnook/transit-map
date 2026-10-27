import type { NewestPositionFixRow } from './feeds'
import type { CurrentArrivalPredictionRow } from './predictions'
import type { arrivalRules, busStops, observedArrivals, observedDepartures } from './schema'

type BusStopRow = typeof busStops.$inferSelect
type ObservedArrivalRow = typeof observedArrivals.$inferInsert
type ObservedDepartureRow = typeof observedDepartures.$inferInsert
type ArrivalRule = (typeof arrivalRules)[number]

export const ARRIVAL_RADIUS_M = 30
// A bus has left a stop once a fix is this far from it, or this much further
// than where it arrived (DEPARTURE_MARGIN_M): a bus laying over can park
// further from the stop's pin than ARRIVAL_RADIUS_M.
const DEPARTURE_RADIUS_M = 50
const DEPARTURE_MARGIN_M = 30
// A later scheduled trip of the same transit vehicle can have a scheduled call
// at a bus stop it is passing now; its prediction is too far off to match.
const PREDICTION_WINDOW_MS = 15 * 60_000
// How long a scheduled call stays watched after its last arrival prediction.
// minutesToNextStops drops a call once the transit vehicle has passed it,
// which can be before the position fix that shows it there arrives.
const WATCH_MS = 20 * 60_000

type Watched = {
  call: CurrentArrivalPredictionRow
  lastPredictedAt: number
  fired: Set<ArrivalRule>
  // from the first rule that fired until the bus leaves
  arrival?: { distance: number; lastNearAt: number }
  departed: boolean
}

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
        this.#watched.set(call.id, { call, lastPredictedAt: at, fired: new Set(), departed: false })
      }
    }
    for (const [id, watched] of this.#watched) {
      if (at - watched.lastPredictedAt > WATCH_MS) this.#watched.delete(id)
    }
  }

  observe(
    fixes: NewestPositionFixRow[],
    stopsById: Map<string, BusStopRow>,
  ): { arrivals: ObservedArrivalRow[]; departures: ObservedDepartureRow[] } {
    const byVehicle = new Map<string, Watched[]>()
    for (const watched of this.#watched.values()) {
      const list = byVehicle.get(watched.call.equipment_id) ?? []
      list.push(watched)
      byVehicle.set(watched.call.equipment_id, list)
    }

    const arrivals: ObservedArrivalRow[] = []
    const departures: ObservedDepartureRow[] = []
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
        if (watched.fired.size > 0 && !watched.arrival) {
          watched.arrival = { distance, lastNearAt: fix.fix_time }
        }
      }

      // After the arrival rules, so a bus first seen already past a stop
      // departs at the fix it arrived at.
      for (const watched of byVehicle.get(fix.equipment_id) ?? []) {
        const stop = stopsById.get(watched.call.stop_id)
        if (!watched.arrival || watched.departed || !stop) continue
        const distance = distanceMeters(fix, stop)
        const stillThere =
          (fix.at_stop && fix.last_pattern_stop_id === watched.call.pattern_stop_id) ||
          distance <= Math.max(DEPARTURE_RADIUS_M, watched.arrival.distance + DEPARTURE_MARGIN_M)
        const seenOnlyPast = watched.arrival.lastNearAt === fix.fix_time && distance > DEPARTURE_RADIUS_M && !fix.at_stop
        if (stillThere && !seenOnlyPast) {
          watched.arrival.lastNearAt = fix.fix_time
          continue
        }
        watched.departed = true
        const { call } = watched
        departures.push({
          schedule_number: call.schedule_number,
          pattern_stop_id: call.pattern_stop_id,
          scheduled_at: call.scheduled_at,
          stop_id: call.stop_id,
          route_id: call.route_id,
          equipment_id: call.equipment_id,
          departed_at: fix.fix_time,
          last_near_at: watched.arrival.lastNearAt,
        })
      }
    }
    return { arrivals, departures }
  }
}

export function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = Math.PI / 180
  const x = (b.lng - a.lng) * rad * Math.cos(((a.lat + b.lat) / 2) * rad)
  const y = (b.lat - a.lat) * rad
  return 6_371_000 * Math.hypot(x, y)
}
