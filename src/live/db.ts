import type { Collection } from '@tanstack/db'
import type { PartyCollection } from 'party-db'
import { createPartyDb, partyTransport } from 'party-db/client'
import {
  COLLECTOR_PARTY,
  COLLECTOR_ROOM,
  busRouteCollection,
  busStopCollection,
  currentArrivalPredictionCollection,
  liveCollections,
  newestPositionFixCollection,
  routePatternCollection,
  routeStopCollection,
  timetableStopCollection,
} from './collections'

let liveDb: ReturnType<typeof connect> | undefined

function connect() {
  const transport = partyTransport({
    host: window.location.host,
    party: COLLECTOR_PARTY,
    room: COLLECTOR_ROOM,
  })
  const { db } = createPartyDb(transport, liveCollections)
  // createPartyDb returns untyped collections; take the row type from each definition.
  const typed = <T extends object>(definition: PartyCollection<T>) =>
    db[definition.name] as Collection<T, string | number>
  return {
    newestPositionFixes: typed(newestPositionFixCollection),
    busRoutes: typed(busRouteCollection),
    routePatterns: typed(routePatternCollection),
    busStops: typed(busStopCollection),
    routeStops: typed(routeStopCollection),
    timetableStops: typed(timetableStopCollection),
    currentArrivalPredictions: typed(currentArrivalPredictionCollection),
  }
}

// Browser only: opens the collector's WebSocket on first use.
export function getLiveDb() {
  liveDb ??= connect()
  return liveDb
}
