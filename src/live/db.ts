import type { Collection } from '@tanstack/db'
import type { PartyCollection } from 'party-db'
import { createPartyDb, partyTransport } from 'party-db/client'
import {
  COLLECTOR_PARTY,
  COLLECTOR_ROOM,
  busRouteCollection,
  busStopCollection,
  liveCollections,
  routePatternCollection,
  routeStopCollection,
  timetableStopCollection,
  todaysArrivalCollection,
} from './collections'
import { createVendorCollections } from './vendor'

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
    ...createVendorCollections(),
    busRoutes: typed(busRouteCollection),
    routePatterns: typed(routePatternCollection),
    busStops: typed(busStopCollection),
    routeStops: typed(routeStopCollection),
    timetableStops: typed(timetableStopCollection),
    todaysArrivals: typed(todaysArrivalCollection),
  }
}

// Browser only: opens the collector's WebSocket on first use, and polls the
// feed vendor while a view reads buses or arrival predictions.
export function getLiveDb() {
  liveDb ??= connect()
  return liveDb
}
