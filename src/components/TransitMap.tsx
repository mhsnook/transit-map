import { decode } from '@googlemaps/polyline-codec'
import { useLiveQuery } from '@tanstack/react-db'
import { useEffect, useMemo, useRef, useState } from 'react'
import MapGL, { Layer, Source, type MapRef } from 'react-map-gl/maplibre'
// MapLibre finds its worker next to its own module, which bundling moves.
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import type { FeatureCollection, LineString, Point } from 'geojson'
import type { ExpressionSpecification, FilterSpecification, PaddingOptions } from 'maplibre-gl'
import { getLiveDb } from '../live/db'
import { useHoveredStop } from '../lib/hovered-stop'
import { useNow } from '../lib/use-now'

const MAP_STYLE = 'https://tiles.openfreemap.org/styles/positron'
const CHARLOTTESVILLE = { longitude: -78.49, latitude: 38.037, zoom: 12.3 }

// From #3: JSON API position staleness had a median of 11 s and a max of 42 s.
const FRESH_MS = 45_000
const STALE_MS = 120_000

function staleness(ageMs: number) {
  if (ageMs <= FRESH_MS) return 'fresh'
  if (ageMs <= STALE_MS) return 'aging'
  return 'stale'
}

export function TransitMap({
  selectedRoute,
  onSelectRoute,
  selectedStop,
  onSelectStop,
  selectedBus,
  onSelectBus,
  fitPadding,
}: {
  selectedRoute: number | null
  onSelectRoute: (routeId: number) => void
  selectedStop: string | null
  onSelectStop: (stopId: string) => void
  selectedBus: string | null
  onSelectBus: (equipmentId: string) => void
  // keeps a fitted route clear of whatever covers the map, like the drawer
  fitPadding: PaddingOptions
}) {
  const live = getLiveDb()
  const mapRef = useRef<MapRef>(null)
  const { data: busRoutes } = useLiveQuery((q) => q.from({ r: live.busRoutes }))
  const { data: patterns } = useLiveQuery((q) => q.from({ p: live.routePatterns }))
  const { data: stops } = useLiveQuery((q) => q.from({ s: live.busStops }))
  const { data: servedStops } = useLiveQuery((q) => q.from({ rs: live.routeStops }))
  const { data: fixes } = useLiveQuery((q) => q.from({ f: live.newestPositionFixes }))
  const now = useNow(1000)
  const [hovering, setHovering] = useState(false)
  const { stopId: hoveredStop, setStopId: setHoveredStop } = useHoveredStop()
  const [mapLoaded, setMapLoaded] = useState(false)

  const routeColor = useMemo(() => new Map(busRoutes.map((r) => [r.id, r.color])), [busRoutes])
  const isSelectedRoute: ExpressionSpecification = ['==', ['get', 'route_id'], selectedRoute ?? -1]

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

  useEffect(() => {
    if (selectedRoute == null) return
    const coordinates = lines.features
      .filter((f) => f.properties?.route_id === selectedRoute)
      .flatMap((f) => f.geometry.coordinates)
    if (coordinates.length === 0) return
    const lngs = coordinates.map(([lng]) => lng)
    const lats = coordinates.map(([, lat]) => lat)
    mapRef.current?.fitBounds(
      [
        [Math.min(...lngs), Math.min(...lats)],
        [Math.max(...lngs), Math.max(...lats)],
      ],
      { padding: fitPadding, duration: 600 },
    )
    // fitPadding changes with the drawer; refitting on every drag would fight the user
  }, [selectedRoute, lines])

  // Whether a point is on screen and not under the drawer.
  const inView = (map: MapRef, lng: number, lat: number) => {
    const { x, y } = map.project([lng, lat])
    const { clientWidth, clientHeight } = map.getContainer()
    return (
      x >= (fitPadding.left ?? 0) &&
      x <= clientWidth - (fitPadding.right ?? 0) &&
      y >= (fitPadding.top ?? 0) &&
      y <= clientHeight - (fitPadding.bottom ?? 0)
    )
  }

  // A bus stop picked from the panel may be off screen or under the drawer;
  // one clicked on the map isn't.
  useEffect(() => {
    const map = mapRef.current
    const stop = stops.find((s) => s.id === selectedStop)
    if (!map || !stop || inView(map, stop.lng, stop.lat)) return
    map.easeTo({
      center: [stop.lng, stop.lat],
      zoom: Math.max(map.getZoom(), 15),
      padding: fitPadding,
      duration: 600,
    })
  }, [selectedStop, stops, mapLoaded])

  // Zooms in on a newly selected bus, then follows it only when it leaves the view.
  const followedBus = useRef<string | null>(null)
  const selectedFix = fixes.find((f) => f.equipment_id === selectedBus)
  useEffect(() => {
    const map = mapRef.current
    if (!map || !selectedFix) {
      if (!selectedBus) followedBus.current = null
      return
    }
    const isNew = followedBus.current !== selectedFix.equipment_id
    if (!isNew && inView(map, selectedFix.lng, selectedFix.lat)) return
    followedBus.current = selectedFix.equipment_id
    map.easeTo({
      center: [selectedFix.lng, selectedFix.lat],
      zoom: isNew ? Math.max(map.getZoom(), 15) : map.getZoom(),
      padding: fitPadding,
      duration: 600,
    })
  }, [selectedBus, selectedFix?.lng, selectedFix?.lat, mapLoaded])

  const selectedStopIds = useMemo(
    () => servedStops.filter((rs) => rs.route_id === selectedRoute).map((rs) => rs.stop_id),
    [servedStops, selectedRoute],
  )

  const stopFilter: FilterSpecification =
    selectedRoute == null ? ['literal', true] : ['in', ['get', 'id'], ['literal', selectedStopIds]]

  const stopPoints = useMemo<FeatureCollection<Point>>(
    () => ({
      type: 'FeatureCollection',
      features: stops.map((s) => ({
        type: 'Feature',
        properties: { id: s.id, name: s.name },
        geometry: { type: 'Point', coordinates: [s.lng, s.lat] },
      })),
    }),
    [stops],
  )

  const vehiclePoints: FeatureCollection<Point> = {
    type: 'FeatureCollection',
    features: fixes.map((f) => {
      const ageMs = now - f.fix_time
      return {
        type: 'Feature',
        properties: {
          equipment_id: f.equipment_id,
          color: routeColor.get(f.route_id ?? -1) ?? '#555',
          staleness: staleness(ageMs),
          dimmed: selectedRoute != null && f.route_id !== selectedRoute,
          label: `${Math.round(ageMs / 1000)}s`,
        },
        geometry: { type: 'Point', coordinates: [f.lng, f.lat] },
      }
    }),
  }

  return (
    <MapGL
      ref={mapRef}
      initialViewState={CHARLOTTESVILLE}
      mapStyle={MAP_STYLE}
      workerUrl={maplibreWorkerUrl}
      onLoad={() => setMapLoaded(true)}
      interactiveLayerIds={['transit-vehicle-targets', 'bus-stop-targets', 'route-pattern-targets']}
      cursor={hovering ? 'pointer' : 'grab'}
      onMouseMove={(event) => {
        const features = event.features ?? []
        setHovering(features.length > 0)
        const onBus = features.some((f) => f.layer.id === 'transit-vehicle-targets')
        const stopId = features.find((f) => f.layer.id === 'bus-stop-targets')?.properties?.id
        setHoveredStop(!onBus && typeof stopId === 'string' ? stopId : null)
      }}
      onMouseLeave={() => {
        setHovering(false)
        setHoveredStop(null)
      }}
      onClick={(event) => {
        const features = event.features ?? []
        // buses sit on bus stops and lines, and bus stops on lines; the one on top wins
        const equipmentId = features.find((f) => f.layer.id === 'transit-vehicle-targets')?.properties?.equipment_id
        if (typeof equipmentId === 'string') return onSelectBus(equipmentId)
        const stopId = features.find((f) => f.layer.id === 'bus-stop-targets')?.properties?.id
        if (typeof stopId === 'string') return onSelectStop(stopId)
        const routeId = features[0]?.properties?.route_id
        if (typeof routeId === 'number') onSelectRoute(routeId)
      }}
    >
      <Source id="route-patterns" type="geojson" data={lines}>
        <Layer
          id="route-pattern-targets"
          type="line"
          paint={{ 'line-width': 16, 'line-opacity': 0 }}
        />
        <Layer
          id="route-patterns"
          type="line"
          layout={{ 'line-join': 'round', 'line-cap': 'round' }}
          paint={{
            'line-color': ['get', 'color'],
            'line-width': ['case', isSelectedRoute, 5, 4],
            'line-opacity': selectedRoute == null ? 0.5 : ['case', isSelectedRoute, 0.9, 0.12],
          }}
        />
      </Source>
      <Source id="bus-stops" type="geojson" data={stopPoints}>
        <Layer
          id="bus-stop-targets"
          type="circle"
          minzoom={selectedRoute == null ? 14 : 0}
          filter={stopFilter}
          paint={{ 'circle-radius': 12, 'circle-opacity': 0 }}
        />
        <Layer
          id="bus-stops"
          type="circle"
          minzoom={selectedRoute == null ? 14 : 0}
          filter={stopFilter}
          paint={{
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, 2.5, 16, 5],
            'circle-color': 'white',
            'circle-stroke-color': '#444',
            'circle-stroke-width': 1,
          }}
        />
        <Layer
          id="hovered-bus-stop"
          type="circle"
          filter={['==', ['get', 'id'], hoveredStop ?? '']}
          paint={{
            'circle-radius': 8,
            'circle-color': 'white',
            'circle-stroke-color': '#111',
            'circle-stroke-width': 3,
          }}
        />
        <Layer
          id="selected-bus-stop"
          type="circle"
          filter={['==', ['get', 'id'], selectedStop ?? '']}
          paint={{
            'circle-radius': 8,
            'circle-color': '#111',
            'circle-stroke-color': 'white',
            'circle-stroke-width': 3,
          }}
        />
      </Source>
      <Source id="transit-vehicles" type="geojson" data={vehiclePoints}>
        <Layer
          id="selected-transit-vehicle"
          type="circle"
          filter={['==', ['get', 'equipment_id'], selectedBus ?? '']}
          paint={{
            'circle-radius': 14,
            'circle-color': 'white',
            'circle-opacity': 0.9,
            'circle-stroke-color': '#111',
            'circle-stroke-width': 3,
          }}
        />
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
        <Layer id="transit-vehicle-targets" type="circle" paint={{ 'circle-radius': 16, 'circle-opacity': 0 }} />
      </Source>
    </MapGL>
  )
}
