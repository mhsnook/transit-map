import { decode } from '@googlemaps/polyline-codec'
import { useLiveQuery } from '@tanstack/react-db'
import { useMemo, useState } from 'react'
import Map, { Layer, Source } from 'react-map-gl/maplibre'
// MapLibre finds its worker next to its own module, which bundling moves.
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import type { FeatureCollection, LineString, Point } from 'geojson'
import { getLiveDb } from '../live/db'
import { useNow } from '../lib/use-now'

const MAP_STYLE = 'https://tiles.openfreemap.org/styles/positron'
const CHARLOTTESVILLE = { longitude: -78.49, latitude: 38.037, zoom: 12.3 }

// From #3: JSON API position staleness had a median of 11 s and a max of 42 s.
const FRESH_MS = 45_000
const STALE_MS = 120_000

export function TransitMap() {
  const { newestPositionFixes, routePatterns, busStops, routeStops } = getLiveDb()
  const { data: patterns } = useLiveQuery((q) => q.from({ p: routePatterns }))
  const { data: stops } = useLiveQuery((q) => q.from({ s: busStops }))
  const { data: servedStops } = useLiveQuery((q) => q.from({ rs: routeStops }))
  const { data: fixes } = useLiveQuery((q) => q.from({ f: newestPositionFixes }))
  const [selectedRoute, setSelectedRoute] = useState<number | null>(null)
  const now = useNow(1000)

  const busRoutes = useMemo(() => {
    const byId = new globalThis.Map<number, { id: number; name: string; color: string }>()
    for (const p of patterns) byId.set(p.route_id, { id: p.route_id, name: p.route_name, color: p.color })
    return [...byId.values()].sort((a, b) => a.id - b.id)
  }, [patterns])

  const routeColor = useMemo(
    () => new globalThis.Map(busRoutes.map((r) => [r.id, r.color])),
    [busRoutes],
  )

  const lines = useMemo<FeatureCollection<LineString>>(
    () => ({
      type: 'FeatureCollection',
      features: patterns.map((p) => ({
        type: 'Feature',
        properties: { route_id: p.route_id, color: p.color },
        geometry: {
          type: 'LineString',
          coordinates: decode(p.enc_line, 5).map(([lat, lng]) => [lng, lat]),
        },
      })),
    }),
    [patterns],
  )

  const selectedStopIds = useMemo(
    () => new Set(servedStops.filter((rs) => rs.route_id === selectedRoute).map((rs) => rs.stop_id)),
    [servedStops, selectedRoute],
  )

  const stopPoints = useMemo<FeatureCollection<Point>>(
    () => ({
      type: 'FeatureCollection',
      features: stops.map((s) => ({
        type: 'Feature',
        properties: { name: s.name, selected: selectedStopIds.has(s.id) },
        geometry: { type: 'Point', coordinates: [s.lng, s.lat] },
      })),
    }),
    [stops, selectedStopIds],
  )

  const vehiclePoints: FeatureCollection<Point> = {
    type: 'FeatureCollection',
    features: fixes.map((f) => {
      const ageMs = now - f.fix_time
      return {
        type: 'Feature',
        properties: {
          color: (f.route_id != null && routeColor.get(f.route_id)) || '#555',
          staleness: ageMs <= FRESH_MS ? 'fresh' : ageMs <= STALE_MS ? 'aging' : 'stale',
          dimmed: selectedRoute != null && f.route_id !== selectedRoute,
          label: `${Math.round(ageMs / 1000)}s`,
        },
        geometry: { type: 'Point', coordinates: [f.lng, f.lat] },
      }
    }),
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-2">
        {busRoutes.map((r) => (
          <button
            key={r.id}
            type="button"
            onClick={() => setSelectedRoute(selectedRoute === r.id ? null : r.id)}
            className="rounded-full border-2 px-3 py-1 text-sm"
            style={{
              borderColor: r.color,
              background: selectedRoute === r.id ? r.color : 'white',
              color: selectedRoute === r.id ? 'white' : 'black',
            }}
          >
            {r.name}
          </button>
        ))}
      </div>
      <div className="h-[70vh] overflow-hidden rounded-lg border">
        <Map
          initialViewState={CHARLOTTESVILLE}
          mapStyle={MAP_STYLE}
          workerUrl={maplibreWorkerUrl}
        >
          <Source id="route-patterns" type="geojson" data={lines}>
            <Layer
              id="route-patterns"
              type="line"
              layout={{ 'line-join': 'round', 'line-cap': 'round' }}
              paint={{
                'line-color': ['get', 'color'],
                'line-width': ['case', ['==', ['get', 'route_id'], selectedRoute ?? -1], 5, 3],
                'line-opacity':
                  selectedRoute == null
                    ? 0.8
                    : ['case', ['==', ['get', 'route_id'], selectedRoute], 0.9, 0.15],
              }}
            />
          </Source>
          <Source id="bus-stops" type="geojson" data={stopPoints}>
            <Layer
              id="bus-stops"
              type="circle"
              minzoom={selectedRoute == null ? 14 : 0}
              filter={selectedRoute == null ? ['literal', true] : ['get', 'selected']}
              paint={{
                'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, 2.5, 16, 5],
                'circle-color': 'white',
                'circle-stroke-color': '#444',
                'circle-stroke-width': 1,
              }}
            />
          </Source>
          <Source id="transit-vehicles" type="geojson" data={vehiclePoints}>
            <Layer
              id="transit-vehicles"
              type="circle"
              paint={{
                'circle-radius': 8,
                'circle-color': ['get', 'color'],
                'circle-stroke-width': ['match', ['get', 'staleness'], 'fresh', 2, 4],
                'circle-stroke-color': [
                  'match',
                  ['get', 'staleness'],
                  'fresh',
                  'white',
                  'aging',
                  '#F5A300',
                  '#D7263D',
                ],
                'circle-opacity': [
                  'case',
                  ['get', 'dimmed'],
                  0.25,
                  ['==', ['get', 'staleness'], 'stale'],
                  0.5,
                  1,
                ],
              }}
            />
            <Layer
              id="transit-vehicle-ages"
              type="symbol"
              layout={{
                'text-field': ['get', 'label'],
                'text-font': ['Noto Sans Regular'],
                'text-size': 11,
                'text-offset': [0, 1.5],
                'text-allow-overlap': true,
              }}
              paint={{ 'text-color': '#222', 'text-halo-color': 'white', 'text-halo-width': 1.5 }}
            />
          </Source>
        </Map>
      </div>
    </div>
  )
}
