import { strFromU8, unzipSync } from 'fflate'
import Papa from 'papaparse'
import type { scheduledStops } from './schema'

export const GTFS_STATIC_URL =
  'https://s3.amazonaws.com/etatransit.gtfs/catpublic.etaspot.net/gtfs.zip'

export type ScheduledStop = typeof scheduledStops.$inferSelect

export type PublishedSchedule = {
  scheduledStops: ScheduledStop[]
  feedVersion: string | null
  feedStartDate: string | null
  feedEndDate: string | null
}

const WEEKDAYS = [
  ['monday', 'M'],
  ['tuesday', 'T'],
  ['wednesday', 'W'],
  ['thursday', 'T'],
  ['friday', 'F'],
  ['saturday', 'S'],
  ['sunday', 'S'],
] as const

function readCsv(files: Record<string, Uint8Array>, name: string): Record<string, string>[] {
  const file = files[name]
  if (!file) throw new Error(`gtfs.zip has no ${name}`)
  return Papa.parse<Record<string, string>>(strFromU8(file), {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header) => header.replace(/^﻿/, '').trim(),
  }).data
}

export function parsePublishedSchedule(zip: Uint8Array): PublishedSchedule {
  const files = unzipSync(zip, {
    filter: (file) =>
      ['stop_times.txt', 'trips.txt', 'routes.txt', 'calendar.txt', 'feed_info.txt'].includes(
        file.name,
      ),
  })
  const routeNames = new Map(
    readCsv(files, 'routes.txt').map((r) => [r.route_id, r.route_short_name]),
  )
  const serviceDays = new Map(
    readCsv(files, 'calendar.txt').map((c) => [
      c.service_id,
      WEEKDAYS.map(([day, letter]) => (c[day] === '1' ? letter : '-')).join(''),
    ]),
  )
  const trips = new Map(readCsv(files, 'trips.txt').map((t) => [t.trip_id, t]))

  const stops = readCsv(files, 'stop_times.txt').map((st) => {
    const trip = trips.get(st.trip_id)
    if (!trip) throw new Error(`stop_times.txt names unknown trip ${st.trip_id}`)
    return {
      route: routeNames.get(trip.route_id) ?? trip.route_id,
      days: serviceDays.get(trip.service_id) ?? trip.service_id,
      direction: Number(trip.direction_id),
      stop_id: st.stop_id,
      arrival_time: st.arrival_time,
      departure_time: st.departure_time,
      timepoint: st.timepoint === '1',
    }
  })
  const feedInfo = files['feed_info.txt'] ? readCsv(files, 'feed_info.txt')[0] : undefined
  return {
    // a set: two trips can share every field a scheduled stop has
    scheduledStops: [...new Map(stops.map((s) => [scheduledStopKey(s), s])).values()],
    feedVersion: feedInfo?.feed_version || null,
    feedStartDate: feedInfo?.feed_start_date || null,
    feedEndDate: feedInfo?.feed_end_date || null,
  }
}

export function scheduledStopKey(s: ScheduledStop): string {
  return [s.route, s.days, s.direction, s.stop_id, s.arrival_time, s.departure_time, s.timepoint].join('|')
}

// Order-independent identity for a set of scheduled stops.
export async function scheduleVersionId(stops: ScheduledStop[]): Promise<string> {
  const canonical = stops.map(scheduledStopKey).sort().join('\n')
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
