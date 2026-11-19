import { z } from 'zod'

export const JSON_API_BASE = 'https://catpublic.etaspot.net/service.php?token=TESTING&service='
export const JSON_API_URL = `${JSON_API_BASE}get_vehicles&includeETAData=1&inService=1&orderedETAArray=1`

// A transit vehicle's newest position fix from get_vehicles. Times are ms
// since the epoch.
export type NewestPositionFix = {
  equipment_id: string
  fix_time: number
  received_at: number
  lat: number
  lng: number
  heading: number | null
  route_id: number | null
  pattern_id: number | null
  trip_id: string | null
  schedule_number: string | null
  next_stop_id: string | null
  last_stop_id: string | null
  last_pattern_stop_id: number | null
  // at last_stop_id, not next_stop_id
  at_stop: boolean
  // minutes; negative is late
  on_schedule: number | null
  // passengers aboard and seats, as the feed vendor reports them
  load: number | null
  capacity: number | null
}

const jsonApiVehicle = z.object({
  equipmentID: z.string(),
  receiveTime: z.number(),
  lat: z.number(),
  lng: z.number(),
  h: z.number().nullish(),
  routeID: z.number().nullish(),
  patternID: z.number().nullish(),
  tripID: z.string().nullish(),
  scheduleNumber: z.string().nullish(),
  nextStopID: z.number().nullish(),
  lastStopID: z.number().nullish(),
  lastPatternStopID: z.number().nullish(),
  // absent, never 0, while the transit vehicle is moving
  atStop: z.literal(1).optional(),
  onSchedule: z.number().nullish(),
  load: z.number().nullish(),
  capacity: z.number().nullish(),
})

const jsonApiResponse = z.object({ get_vehicles: z.array(jsonApiVehicle) })

export function parseJsonApi(body: unknown, receivedAt: number): NewestPositionFix[] {
  return jsonApiResponse.parse(body).get_vehicles.map((v) => ({
    equipment_id: v.equipmentID,
    fix_time: v.receiveTime,
    received_at: receivedAt,
    lat: v.lat,
    lng: v.lng,
    heading: v.h ?? null,
    route_id: v.routeID ?? null,
    pattern_id: v.patternID ?? null,
    trip_id: v.tripID ?? null,
    schedule_number: v.scheduleNumber ?? null,
    next_stop_id: v.nextStopID == null ? null : String(v.nextStopID),
    last_stop_id: v.lastStopID == null ? null : String(v.lastStopID),
    last_pattern_stop_id: v.lastPatternStopID ?? null,
    at_stop: v.atStop === 1,
    on_schedule: v.onSchedule ?? null,
    load: v.load ?? null,
    capacity: v.capacity ?? null,
  }))
}

// unknown JSON API services answer 200 with an HTML error page
export async function readJson(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.includes('json')) throw new Error(`content-type ${contentType}`)
  return response.json()
}
