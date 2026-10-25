import type { Collection } from '@tanstack/db'
import { createPartyDb, partyTransport } from 'party-db/client'
import {
  COLLECTOR_PARTY,
  COLLECTOR_ROOM,
  liveCollections,
  type NewestPositionFix,
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
    newestPositionFixes: db.newest_position_fixes as Collection<
      NewestPositionFix,
      string
    >,
  }
}

// Browser only: opens the collector's WebSocket on first use.
export function getLiveDb() {
  liveDb ??= connect()
  return liveDb
}
