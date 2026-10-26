import { z } from 'zod'
import { charlottesvilleClockNear, clockMinutes } from '../lib/charlottesville-time'
import { JSON_API_BASE } from './feeds'
import type { currentArrivalPredictions } from './schema'

export type CurrentArrivalPredictionRow = typeof currentArrivalPredictions.$inferSelect

// One request covers every bus stop; the feed vendor caps each at five.
export function stopEtasUrl(stopIds: string[]): string {
  return `${JSON_API_BASE}get_stop_etas&statusData=1&stopIDs=${stopIds.join(',')}`
}

const stopEta = z.object({
  stopID: z.number(),
  patternStopID: z.number(),
  routeID: z.number(),
  equipmentID: z.string().nullish(),
  scheduleNumber: z.string().nullish(),
  timePoint: z.number().nullish(),
  minutes: z.number(),
  time: z.string().nullish(),
  schedule: z.string().nullish(),
  direction: z.string().nullish(),
})

const stopEtasResponse = z.object({
  get_stop_etas: z.array(z.object({ id: z.string(), enRoute: z.array(stopEta).nullish() })),
})

export function parseStopEtas(body: unknown, receivedAt: number): CurrentArrivalPredictionRow[] {
  const rows = new Map<string, CurrentArrivalPredictionRow>()
  for (const stop of stopEtasResponse.parse(body).get_stop_etas) {
    for (const eta of stop.enRoute ?? []) {
      // a scheduled call needs a scheduled trip and a transit vehicle
      if (!eta.equipmentID || !eta.scheduleNumber || !eta.schedule) continue
      // `minutes` is rounded, so it only picks which day `time` is on
      const roughly = receivedAt + eta.minutes * 60_000
      const predictedAt = eta.time
        ? charlottesvilleClockNear(clockMinutes(eta.time), roughly)
        : Math.floor(roughly / 60_000) * 60_000
      const id = `${eta.scheduleNumber}:${eta.patternStopID}`
      rows.set(id, {
        id,
        schedule_number: eta.scheduleNumber,
        pattern_stop_id: eta.patternStopID,
        scheduled_at: charlottesvilleClockNear(clockMinutes(eta.schedule), predictedAt),
        stop_id: String(eta.stopID),
        route_id: eta.routeID,
        equipment_id: eta.equipmentID,
        predicted_at: predictedAt,
        direction: eta.direction ?? null,
        timepoint: eta.timePoint === 1,
      })
    }
  }
  return [...rows.values()]
}
