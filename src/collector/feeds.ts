import GtfsRealtimeBindings from 'gtfs-realtime-bindings'
import type { NewestPositionFix } from '../live/vehicles'
import type { positionFixes } from './schema'

export const GTFS_RT_POSITIONS_URL =
  'https://s3.amazonaws.com/etatransit.gtfs/catpublic.etaspot.net/position_updates.pb'

export type PositionFixRow = typeof positionFixes.$inferInsert

export function jsonApiHistoryRow(fix: NewestPositionFix): PositionFixRow {
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
