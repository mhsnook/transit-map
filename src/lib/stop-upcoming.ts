import type { BusRoute, CurrentArrivalPrediction } from '../live/collections'
import type { ScheduledStop } from '../collector/schedule'
import { charlottesvilleMidnight, gtfsMinutes, upcomingServiceDays } from './charlottesville-time'

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

const DAY_MS = 24 * 60 * 60 * 1000

// Arrival predictions, and the scheduled stops that have none, soonest first.
// Predictions name a bus route by its JSON API id and scheduled stops by its
// short name, so the two are matched on short name and scheduled minute.
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
  const [today, tomorrow] = upcomingServiceDays(now)
  const midnight = charlottesvilleMidnight(now)
  // yesterday's service can run past midnight
  const serviceDays = [
    { weekday: (today.weekday + 6) % 7, start: midnight - DAY_MS },
    { weekday: today.weekday, start: midnight },
    { weekday: tomorrow.weekday, start: midnight + DAY_MS },
  ]

  const scheduled = new Map<string, UpcomingCall>()
  for (const day of serviceDays) {
    for (const s of scheduledStops) {
      if (s.days[day.weekday] === '-') continue
      const at = day.start + gtfsMinutes(s.departure_time) * 60_000
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
    const key = `${route?.short_name}@${p.scheduled_at}`
    const match = scheduled.get(key)
    scheduled.delete(key)
    calls.push({
      key: p.id,
      route,
      headsign: match?.headsign ?? p.direction,
      scheduledAt: p.scheduled_at,
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
