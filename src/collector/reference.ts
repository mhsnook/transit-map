import { z } from 'zod'
import { JSON_API_BASE } from './feeds'
import type { busRoutes, busStops, routePatterns, routeStops } from './schema'

export const PATTERNS_URL = `${JSON_API_BASE}get_patterns`
export const STOPS_URL = `${JSON_API_BASE}get_stops`
export const ROUTES_URL = `${JSON_API_BASE}get_routes`

type BusRouteRow = typeof busRoutes.$inferSelect

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

export function parsePatterns(body: unknown) {
  return patternsResponse.parse(body).get_patterns
}

const routesResponse = z.object({
  get_routes: z.array(z.object({ id: z.number(), abbr: z.string() })),
})

export function parseRouteAbbrs(body: unknown): Map<number, string> {
  return new Map(routesResponse.parse(body).get_routes.map((r) => [r.id, r.abbr]))
}

// get_routes leaves out bus routes that are not running, so route patterns
// decide which bus routes exist and get_routes only supplies short names.
export function referenceRows(
  patterns: ReturnType<typeof parsePatterns>,
  abbrs: Map<number, string>,
  currentRoutes: BusRouteRow[],
): {
  routePatterns: (typeof routePatterns.$inferSelect)[]
  busRoutes: BusRouteRow[]
} {
  const knownShortNames = new Map(currentRoutes.map((r) => [r.id, r.short_name]))
  const routes = new Map<number, BusRouteRow>()
  for (const p of patterns) {
    const [id] = p.routes
    const [name] = p.routeNames
    routes.set(id, {
      id,
      name,
      // a bus route never seen running falls back to its leading number
      short_name: abbrs.get(id) ?? knownShortNames.get(id) ?? name.split(' ')[0],
      color: p.color,
    })
  }
  return {
    routePatterns: patterns.map((p) => ({
      id: p.id,
      name: p.name,
      route_id: p.routes[0],
      color: p.color,
      enc_line: p.encLine,
    })),
    busRoutes: [...routes.values()],
  }
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
  busStops: (typeof busStops.$inferSelect)[]
  routeStops: (typeof routeStops.$inferSelect)[]
} {
  const rows = stopsResponse.parse(body).get_stops
  return {
    busStops: [
      ...new Map(
        rows.map((s) => [s.id, { id: String(s.id), name: s.name, lat: s.lat, lng: s.lng }]),
      ).values(),
    ],
    routeStops: rows.map((s) => ({ id: s.rsid, route_id: s.rid, stop_id: String(s.id) })),
  }
}
