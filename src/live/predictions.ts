import { z } from 'zod'
import { charlottesvilleClockNear, clockMinutes } from '../lib/charlottesville-time'
import { JSON_API_BASE } from './vehicles'

// An arrival prediction the feed vendor serves now, for a scheduled call (see
// scheduledCallColumns in the collector's schema).
export type CurrentArrivalPredictionRow = {
  // `${schedule_number}:${pattern_stop_id}`
  id: string
  schedule_number: string
  pattern_stop_id: number
  scheduled_at: number
  stop_id: string
  route_id: number
  equipment_id: string
  predicted_at: number
  // the feed vendor's "Inbound" or "Outbound", not the GTFS direction_id
  direction: string | null
  timepoint: boolean
}

// With the matched slot (see todays_arrivals in the collector's schema), or
// null when the bus route is not known yet.
export type CurrentArrivalPrediction = CurrentArrivalPredictionRow & { slot_at: number | null }

// One request covers every bus stop. Without noLimit the feed vendor caps
// each bus stop at five, which at a hub reaches only about ten minutes out.
export function stopEtasUrl(stopIds: string[]): string {
  return `${JSON_API_BASE}get_stop_etas&statusData=1&noLimit=1&stopIDs=${stopIds.join(',')}`
}

// get_stop_etas and get_vehicles' minutesToNextStops share this shape.
const eta = z.object({
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
  get_stop_etas: z.array(z.object({ enRoute: z.array(eta).nullish() })),
})

const vehiclesResponse = z.object({
  get_vehicles: z.array(z.object({ minutesToNextStops: z.array(eta).nullish() })),
})

export function parseStopEtas(body: unknown, receivedAt: number): CurrentArrivalPredictionRow[] {
  const etas = stopEtasResponse.parse(body).get_stop_etas.flatMap((stop) => stop.enRoute ?? [])
  return predictionRows(etas, receivedAt)
}

// Each transit vehicle's next five bus stops.
export function parseVehicleEtas(body: unknown, receivedAt: number): CurrentArrivalPredictionRow[] {
  const etas = vehiclesResponse.parse(body).get_vehicles.flatMap((v) => v.minutesToNextStops ?? [])
  return predictionRows(etas, receivedAt)
}

function predictionRows(etas: z.infer<typeof eta>[], receivedAt: number): CurrentArrivalPredictionRow[] {
  const rows = new Map<string, CurrentArrivalPredictionRow>()
  for (const eta of etas) {
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
  return [...rows.values()]
}
