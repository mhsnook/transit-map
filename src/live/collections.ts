import { definePartyCollection } from 'party-db'
import type { StandardSchemaV1 } from '@standard-schema/spec'
import { getTableName, type InferSelectModel } from 'drizzle-orm'
import type { SQLiteTable } from 'drizzle-orm/sqlite-core'
import { createSelectSchema } from 'drizzle-zod'
import {
  busRoutes,
  busStops,
  currentArrivalPredictions,
  newestPositionFixes,
  routePatterns,
  routeStops,
  timetableStops,
} from '../collector/schema'

// Browsers only read; the Collector writes through commit(), which skips
// access checks.
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

export const newestPositionFixCollection = readOnlyCollection(newestPositionFixes, 'equipment_id')
export const busRouteCollection = readOnlyCollection(busRoutes, 'id')
export const routePatternCollection = readOnlyCollection(routePatterns, 'id')
export const busStopCollection = readOnlyCollection(busStops, 'id')
export const routeStopCollection = readOnlyCollection(routeStops, 'id')
export const timetableStopCollection = readOnlyCollection(timetableStops, 'id')
export const currentArrivalPredictionCollection = readOnlyCollection(currentArrivalPredictions, 'id')

export const liveCollections = [
  newestPositionFixCollection,
  busRouteCollection,
  routePatternCollection,
  busStopCollection,
  routeStopCollection,
  timetableStopCollection,
  currentArrivalPredictionCollection,
]

export const COLLECTOR_PARTY = 'collector'
export const COLLECTOR_ROOM = 'cat'

export type NewestPositionFix = InferSelectModel<typeof newestPositionFixes>
export type BusRoute = InferSelectModel<typeof busRoutes>
export type BusStop = InferSelectModel<typeof busStops>
export type TimetableStop = InferSelectModel<typeof timetableStops>
export type CurrentArrivalPrediction = InferSelectModel<typeof currentArrivalPredictions>
