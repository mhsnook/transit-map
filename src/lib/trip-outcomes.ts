import type { TimetableStop, TodaysArrival } from '../live/collections'
import { scheduledInstant } from './charlottesville-time'
import { minutesLate } from './schedule-label'

export type TripOutcome =
  // `minutes` late at the last timepoint reached
  | { kind: 'served'; minutes: number; equipmentId: string; done: boolean }
  // only seen at its first timepoint, where a bus waits out its layover
  | { kind: 'started'; equipmentId: string }
  | { kind: 'skipped' }

type Trip = { tripId: string; stops: TimetableStop[] }

// A trip ends this long after its last scheduled time if no bus reaches it.
const SETTLE_MS = 10 * 60_000

// Today's observed arrivals at timepoints, keyed by bus stop and matched slot.
export type TimepointArrivals = Map<string, TodaysArrival>

const arrivalKey = (stopId: string, slotAt: number) => `${stopId}@${slotAt}`

export function timepointArrivals(arrivals: TodaysArrival[]): TimepointArrivals {
  const byKey: TimepointArrivals = new Map()
  for (const a of arrivals) {
    if (a.slot_at == null) continue
    const key = arrivalKey(a.stop_id, a.slot_at)
    const other = byKey.get(key)
    if (!other || a.arrived_at < other.arrived_at) byKey.set(key, a)
  }
  return byKey
}

// The arrival that served a timetable stop on the service day that began at
// `dayStart`, with the time it was due.
export function arrivalAt(arrivals: TimepointArrivals, stop: TimetableStop, dayStart: number) {
  const dueAt = scheduledInstant(dayStart, stop.arrival_time)
  return { dueAt, arrival: arrivals.get(arrivalKey(stop.stop_id, dueAt)) }
}

// How each of a direction's trips went, in their order of departure. A trip
// no bus reached is skipped only when trips before and after it were
// reached, so trips from before recording started aren't.
export function tripOutcomes(
  trips: Trip[],
  arrivals: TimepointArrivals,
  dayStart: number,
  now: number,
): Map<string, TripOutcome> {
  const reached = trips.map((trip) => trip.stops.map((stop) => arrivalAt(arrivals, stop, dayStart)))
  const anyReached = reached.map((stops) => stops.some((s) => s.arrival))
  const firstReached = anyReached.indexOf(true)
  const lastReached = anyReached.lastIndexOf(true)

  const outcomes = new Map<string, TripOutcome>()
  trips.forEach((trip, i) => {
    const stops = reached[i]
    const over = now > scheduledInstant(dayStart, trip.stops[trip.stops.length - 1].arrival_time) + SETTLE_MS
    let lastIndex = -1
    for (let j = 1; j < stops.length; j++) if (stops[j].arrival) lastIndex = j
    if (lastIndex > 0) {
      const { arrival, dueAt } = stops[lastIndex]
      outcomes.set(trip.tripId, {
        kind: 'served',
        minutes: minutesLate(arrival!.arrived_at, dueAt),
        equipmentId: arrival!.equipment_id,
        done: lastIndex === stops.length - 1 || over,
      })
    } else if (stops[0]?.arrival) {
      outcomes.set(trip.tripId, { kind: 'started', equipmentId: stops[0].arrival.equipment_id })
    } else if (over && firstReached < i && i < lastReached) {
      outcomes.set(trip.tripId, { kind: 'skipped' })
    }
  })
  return outcomes
}
