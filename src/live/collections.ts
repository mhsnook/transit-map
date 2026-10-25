import { definePartyCollection } from 'party-db'
import type { StandardSchemaV1 } from '@standard-schema/spec'
import { createSelectSchema } from 'drizzle-zod'
import type { z } from 'zod'
import {
  busStops,
  newestPositionFixes,
  routePatterns,
  routeStops,
} from '../collector/schema'

// Browsers only read; the Collector writes through commit(), which skips
// access checks.
function readOnlyCollection<T extends object>(
  name: string,
  key: keyof T & string,
  schema: StandardSchemaV1<T>,
) {
  return definePartyCollection<T>({ name, key, schema, access: { read: 'public' } })
}

const newestPositionFixSchema = createSelectSchema(newestPositionFixes)
export type NewestPositionFix = z.infer<typeof newestPositionFixSchema>
export const newestPositionFixCollection = readOnlyCollection(
  'newest_position_fixes',
  'equipment_id',
  newestPositionFixSchema,
)

const routePatternSchema = createSelectSchema(routePatterns)
export type RoutePattern = z.infer<typeof routePatternSchema>
export const routePatternCollection = readOnlyCollection(
  'route_patterns',
  'id',
  routePatternSchema,
)

const busStopSchema = createSelectSchema(busStops)
export type BusStop = z.infer<typeof busStopSchema>
export const busStopCollection = readOnlyCollection('bus_stops', 'id', busStopSchema)

const routeStopSchema = createSelectSchema(routeStops)
export type RouteStop = z.infer<typeof routeStopSchema>
export const routeStopCollection = readOnlyCollection('route_stops', 'id', routeStopSchema)

export const liveCollections = [
  newestPositionFixCollection,
  routePatternCollection,
  busStopCollection,
  routeStopCollection,
]

export const COLLECTOR_PARTY = 'collector'
export const COLLECTOR_ROOM = 'cat'
