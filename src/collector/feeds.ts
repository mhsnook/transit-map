import GtfsRealtimeBindings from 'gtfs-realtime-bindings'
import { z } from 'zod'
import type { newestPositionFixes, positionFixes } from './schema'

export const JSON_API_BASE = 'https://catpublic.etaspot.net/service.php?token=TESTING&service='
export const JSON_API_URL = `${JSON_API_BASE}get_vehicles&includeETAData=1&inService=1&orderedETAArray=1`
export const GTFS_RT_POSITIONS_URL =
  'https://s3.amazonaws.com/etatransit.gtfs/catpublic.etaspot.net/position_updates.pb'

export type PositionFixRow = typeof positionFixes.$inferInsert
export type NewestPositionFixRow = typeof newestPositionFixes.$inferSelect

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
  // absent, never 0, while the transit vehicle is moving
  atStop: z.literal(1).optional(),
  onSchedule: z.number().nullish(),
})

const jsonApiResponse = z.object({ get_vehicles: z.array(jsonApiVehicle) })

export function parseJsonApi(
  body: unknown,
  receivedAt: number,
): NewestPositionFixRow[] {
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
    at_stop: v.atStop === 1,
    on_schedule: v.onSchedule ?? null,
  }))
}

export function jsonApiHistoryRow({
  route_id,
  pattern_id,
  at_stop,
  on_schedule,
  ...fix
}: NewestPositionFixRow): PositionFixRow {
  return { source: 'json_api', ...fix }
}

const { FeedMessage } = GtfsRealtimeBindings.transit_realtime

// protobufjs decodes uint64 as a Long object when the long package is present
function toNumber(value: number | { toNumber(): number }): number {
  return typeof value === 'number' ? value : value.toNumber()
}

export function parseGtfsRtPositions(
  body: Uint8Array,
  receivedAt: number,
): PositionFixRow[] {
  const feed = FeedMessage.decode(body)
  const rows: PositionFixRow[] = []
  for (const entity of feed.entity) {
    const v = entity.vehicle
    const id = v?.vehicle?.id
    if (!v || !id || !v.position || v.timestamp == null) continue
    rows.push({
      source: 'gtfs_rt',
      equipment_id: id,
      // GTFS-RT timestamps are seconds; everything we store is ms
      fix_time: toNumber(v.timestamp) * 1000,
      received_at: receivedAt,
      lat: v.position.latitude,
      lng: v.position.longitude,
      heading: v.position.bearing ?? null,
      trip_id: v.trip?.tripId || null,
      schedule_number: v.vehicle?.label || null,
      next_stop_id: v.stopId || null,
    })
  }
  return rows
}
