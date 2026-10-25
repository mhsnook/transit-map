import { z } from 'zod'
import type { busStops, routePatterns, routeStops } from './schema'

const JSON_API_BASE = 'https://catpublic.etaspot.net/service.php?token=TESTING&service='
export const PATTERNS_URL = `${JSON_API_BASE}get_patterns`
export const STOPS_URL = `${JSON_API_BASE}get_stops`

export type RoutePatternRow = typeof routePatterns.$inferSelect
export type BusStopRow = typeof busStops.$inferSelect
export type RouteStopRow = typeof routeStops.$inferSelect

const patternsResponse = z.object({
  get_patterns: z.array(
    z.object({
      id: z.number(),
      name: z.string(),
      color: z.string(),
      encLine: z.string(),
      // one bus route per route pattern in every response seen so far
      routes: z.tuple([z.number()]),
      routeNames: z.tuple([z.string()]),
    }),
  ),
})

export function parsePatterns(body: unknown): RoutePatternRow[] {
  return patternsResponse.parse(body).get_patterns.map((p) => ({
    id: p.id,
    name: p.name,
    route_id: p.routes[0],
    route_name: p.routeNames[0],
    color: p.color,
    enc_line: p.encLine,
  }))
}

// get_stops has one row per (bus route, bus stop) pair, keyed by rsid.
const stopsResponse = z.object({
  get_stops: z.array(
    z.object({
      rsid: z.number(),
      rid: z.number(),
      id: z.number(),
      name: z.string(),
      lat: z.number(),
      lng: z.number(),
    }),
  ),
})

export function parseStops(body: unknown): {
  busStops: BusStopRow[]
  routeStops: RouteStopRow[]
} {
  const rows = stopsResponse.parse(body).get_stops
  const stops = new Map<string, BusStopRow>()
  for (const s of rows) {
    stops.set(String(s.id), { id: String(s.id), name: s.name, lat: s.lat, lng: s.lng })
  }
  return {
    busStops: [...stops.values()],
    routeStops: rows.map((s) => ({ id: s.rsid, route_id: s.rid, stop_id: String(s.id) })),
  }
}
