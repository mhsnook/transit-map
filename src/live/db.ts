import type { Collection } from '@tanstack/db'
import { createPartyDb, partyTransport } from 'party-db/client'
import {
  COLLECTOR_PARTY,
  COLLECTOR_ROOM,
  busStopCollection,
  liveCollections,
  newestPositionFixCollection,
  routePatternCollection,
  routeStopCollection,
  type BusStop,
  type NewestPositionFix,
  type RoutePattern,
  type RouteStop,
} from './collections'

let liveDb: ReturnType<typeof connect> | undefined

function connect() {
  const transport = partyTransport({
    host: window.location.host,
    party: COLLECTOR_PARTY,
    room: COLLECTOR_ROOM,
  })
  const { db } = createPartyDb(transport, liveCollections)
  return {
    newestPositionFixes: db[newestPositionFixCollection.name] as Collection<NewestPositionFix, string>,
    routePatterns: db[routePatternCollection.name] as Collection<RoutePattern, number>,
    busStops: db[busStopCollection.name] as Collection<BusStop, string>,
    routeStops: db[routeStopCollection.name] as Collection<RouteStop, number>,
  }
}

// Browser only: opens the collector's WebSocket on first use.
export function getLiveDb() {
  liveDb ??= connect()
  return liveDb
}
