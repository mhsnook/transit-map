import type { BusRoute, CurrentArrivalPrediction } from '../live/collections'
import type { ScheduledStop } from '../collector/schedule'
import { DAY_MS, scheduledInstant, serviceDaysAround } from './charlottesville-time'

export type UpcomingCall = {
  key: string
  route: BusRoute | undefined
  headsign: string | null
  scheduledAt: number | null
  predictedAt: number | null
  equipmentId: string | null
  // false: the scheduled time is the feed vendor's estimate between timepoints
  timepoint: boolean
}


// Arrival predictions, and the scheduled stops that have none, soonest first.
// Predictions name a bus route by its JSON API id and scheduled stops by its
// short name, so the two are matched on short name and the prediction's
// matched slot.
export function upcomingCalls({
  now,
  predictions,
  scheduledStops,
  routesById,
  headsign,
  limit,
}: {
  now: number
  predictions: CurrentArrivalPrediction[]
  scheduledStops: ScheduledStop[]
  routesById: Map<number, BusRoute>
  headsign: (route: string, direction: number) => string | undefined
  limit: number
}): UpcomingCall[] {
  const routesByShortName = new Map([...routesById.values()].map((r) => [r.short_name, r]))
  const scheduled = new Map<string, UpcomingCall>()
  for (const day of serviceDaysAround(now)) {
    for (const s of scheduledStops) {
      if (s.days[day.weekday] === '-') continue
      // matched slots are measured from arrival times
      const at = scheduledInstant(day.start, s.arrival_time)
      if (at < now || at > now + DAY_MS) continue
      const key = `${s.route}@${at}`
      if (scheduled.has(key)) continue
      scheduled.set(key, {
        key,
        route: routesByShortName.get(s.route),
        headsign: headsign(s.route, s.direction) ?? null,
        scheduledAt: at,
        predictedAt: null,
        equipmentId: null,
        timepoint: s.timepoint,
      })
    }
  }

  const calls: UpcomingCall[] = []
  for (const p of predictions) {
    const route = routesById.get(p.route_id)
    const scheduledAt = p.slot_at ?? p.scheduled_at
    const key = `${route?.short_name}@${scheduledAt}`
    const match = scheduled.get(key)
    scheduled.delete(key)
    calls.push({
      key: p.id,
      route,
      headsign: match?.headsign ?? p.direction,
      scheduledAt,
      predictedAt: p.predicted_at,
      equipmentId: p.equipment_id,
      timepoint: p.timepoint,
    })
  }
  calls.push(...scheduled.values())
  return calls
    .sort((a, b) => (a.predictedAt ?? a.scheduledAt!) - (b.predictedAt ?? b.scheduledAt!))
    .slice(0, limit)
}
