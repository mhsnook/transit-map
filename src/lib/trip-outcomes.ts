import type { TimetableStop, TodaysArrival } from '../live/collections'
import { gtfsMinutes } from './charlottesville-time'
import { minutesLate } from './schedule-label'

export type TripOutcome =
  // `minutes` late at the last timepoint reached
  | { kind: 'served'; minutes: number; equipmentId: string; done: boolean }
  // only seen at its first timepoint, where a bus waits out its layover
  | { kind: 'started'; equipmentId: string }
  | { kind: 'skipped' }

type Trip = { tripId: string; stops: TimetableStop[]; last: number }

// A trip ends this long after its last scheduled time if no bus reaches it.
const SETTLE_MS = 10 * 60_000

export function arrivalKey(stopId: string, slotAt: number) {
  return `${stopId}@${slotAt}`
}

export function timepointArrivals(arrivals: TodaysArrival[]): Map<string, TodaysArrival> {
  const byKey = new Map<string, TodaysArrival>()
  for (const a of arrivals) {
    if (a.slot_at == null) continue
    const key = arrivalKey(a.stop_id, a.slot_at)
    const other = byKey.get(key)
    if (!other || a.arrived_at < other.arrived_at) byKey.set(key, a)
  }
  return byKey
}

// How each of a direction's trips went, in their order of departure. A trip
// no bus reached is skipped only when trips before and after it were
// reached, so trips from before recording started aren't.
export function tripOutcomes(
  trips: Trip[],
  arrivals: Map<string, TodaysArrival>,
  midnight: number,
  now: number,
): Map<string, TripOutcome> {
  const slotAt = (stop: TimetableStop) => midnight + gtfsMinutes(stop.arrival_time) * 60_000
  const outcomes = new Map<string, TripOutcome>()
  const reached = trips.map((trip) =>
    trip.stops.map((stop) => arrivals.get(arrivalKey(stop.stop_id, slotAt(stop)))),
  )

  trips.forEach((trip, i) => {
    const seen = reached[i]
    let lastIndex = -1
    for (let j = 1; j < seen.length; j++) if (seen[j]) lastIndex = j
    if (lastIndex > 0) {
      const arrival = seen[lastIndex]!
      outcomes.set(trip.tripId, {
        kind: 'served',
        minutes: minutesLate(arrival.arrived_at, slotAt(trip.stops[lastIndex])),
        equipmentId: arrival.equipment_id,
        done: lastIndex === trip.stops.length - 1 || now > midnight + trip.last * 60_000 + SETTLE_MS,
      })
    } else if (seen[0]) {
      outcomes.set(trip.tripId, { kind: 'started', equipmentId: seen[0].equipment_id })
    } else if (
      now > midnight + trip.last * 60_000 + SETTLE_MS &&
      reached.slice(0, i).some((r) => r.some(Boolean)) &&
      reached.slice(i + 1).some((r) => r.some(Boolean))
    ) {
      outcomes.set(trip.tripId, { kind: 'skipped' })
    }
  })
  return outcomes
}
