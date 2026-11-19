import { definePartyCollection } from 'party-db'
import type { StandardSchemaV1 } from '@standard-schema/spec'
import { getTableName, type InferSelectModel } from 'drizzle-orm'
import type { SQLiteTable } from 'drizzle-orm/sqlite-core'
import { createSelectSchema } from 'drizzle-zod'
import {
  busRoutes,
  busStops,
  routePatterns,
  routeStops,
  timetableStops,
  todaysArrivals,
} from '../collector/schema'

// What browsers sync from the Collector: reference data, the timetable and
// today's observed arrivals. Buses and arrival predictions come from the feed
// vendor (see vendor.ts). Browsers only read; the Collector writes through
// commit(), which skips access checks.
function readOnlyCollection<T extends SQLiteTable>(
  table: T,
  key: keyof InferSelectModel<T> & string,
) {
  return definePartyCollection<InferSelectModel<T>>({
    name: getTableName(table),
    key,
    // drizzle-zod's select schema parses to the select model; TypeScript can't
    // prove that for a generic table.
    schema: createSelectSchema(table) as StandardSchemaV1<InferSelectModel<T>>,
    access: { read: 'public' },
  })
}

export const busRouteCollection = readOnlyCollection(busRoutes, 'id')
export const routePatternCollection = readOnlyCollection(routePatterns, 'id')
export const busStopCollection = readOnlyCollection(busStops, 'id')
export const routeStopCollection = readOnlyCollection(routeStops, 'id')
export const timetableStopCollection = readOnlyCollection(timetableStops, 'id')
export const todaysArrivalCollection = readOnlyCollection(todaysArrivals, 'id')

export const liveCollections = [
  busRouteCollection,
  routePatternCollection,
  busStopCollection,
  routeStopCollection,
  timetableStopCollection,
  todaysArrivalCollection,
]

export const COLLECTOR_PARTY = 'collector'
export const COLLECTOR_ROOM = 'cat'

export type BusRoute = InferSelectModel<typeof busRoutes>
export type BusStop = InferSelectModel<typeof busStops>
export type TimetableStop = InferSelectModel<typeof timetableStops>
export type TodaysArrival = InferSelectModel<typeof todaysArrivals>

export type { CurrentArrivalPrediction } from './predictions'
export type { NewestPositionFix } from './vehicles'
