import { useLiveQuery } from '@tanstack/react-db'
import { useMemo, useState } from 'react'
import { getLiveDb } from '../live/db'
import { useNow } from '../lib/use-now'
import { BusPanel } from './BusPanel'
import { CloseButton } from './CloseButton'
import { RoutePicker } from './RoutePicker'
import { RouteSchedule } from './RouteSchedule'
import { StopList } from './StopList'
import { StopPanel } from './StopPanel'
import { VehicleList } from './VehicleList'

export function InfoPanel({
  selectedRoute,
  onSelectRoute,
  selectedStop,
  onSelectStop,
  selectedBus,
  onSelectBus,
  title,
}: {
  selectedRoute: number | null
  onSelectRoute: (routeId: number | null) => void
  selectedStop: string | null
  onSelectStop: (stopId: string | null) => void
  selectedBus: string | null
  onSelectBus: (equipmentId: string | null) => void
  // the drawer passes its accessible Drawer.Title here
  title: React.ReactNode
}) {
  const live = getLiveDb()
  const { data: busRoutes } = useLiveQuery((q) =>
    q.from({ r: live.busRoutes }).orderBy(({ r }) => r.id),
  )
  const { data: stops } = useLiveQuery((q) => q.from({ s: live.busStops }))
  const { data: fixes } = useLiveQuery((q) => q.from({ f: live.newestPositionFixes }))
  const { data: routeStops } = useLiveQuery((q) => q.from({ rs: live.routeStops }))
  const now = useNow(1000)
  const [homeTab, setHomeTab] = useState<'buses' | 'stops'>('buses')

  const routesById = useMemo(() => new Map(busRoutes.map((r) => [r.id, r])), [busRoutes])
  const stopsById = useMemo(() => new Map(stops.map((s) => [s.id, s])), [stops])
  const runningByRoute = useMemo(() => {
    const counts = new Map<number, number>()
    for (const f of fixes) if (f.route_id != null) counts.set(f.route_id, (counts.get(f.route_id) ?? 0) + 1)
    return counts
  }, [fixes])
  const routesByStop = useMemo(() => {
    const byStop = new Map<string, typeof busRoutes>()
    for (const rs of routeStops) {
      const r = routesById.get(rs.route_id)
      if (r) byStop.set(rs.stop_id, [...(byStop.get(rs.stop_id) ?? []), r])
    }
    for (const list of byStop.values()) list.sort((a, b) => a.id - b.id)
    return byStop
  }, [routeStops, routesById])
  const route = selectedRoute == null ? undefined : routesById.get(selectedRoute)
  const stop = selectedStop == null ? undefined : stopsById.get(selectedStop)
  const routeFixes = route ? fixes.filter((f) => f.route_id === route.id) : fixes

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="space-y-3 px-4 pt-1 pb-3">
        <div className="flex items-baseline justify-between gap-3">
          {title}
          <span className="shrink-0 text-xs text-gray-500 tabular-nums">
            {fixes.length === 0 ? 'No buses running' : `${fixes.length} buses running`}
          </span>
        </div>
        <RoutePicker
          busRoutes={busRoutes}
          selectedRoute={selectedRoute}
          onSelectRoute={onSelectRoute}
          runningByRoute={runningByRoute}
        />
      </div>

      <div className="flex min-h-0 flex-1 flex-col border-t border-gray-200">
        {selectedStop != null ? (
          <StopPanel
            stopId={selectedStop}
            stop={stop}
            routes={routesByStop.get(selectedStop) ?? []}
            routesById={routesById}
            now={now}
            onClose={() => onSelectStop(null)}
          />
        ) : selectedBus != null ? (
          <BusPanel
            equipmentId={selectedBus}
            fix={fixes.find((f) => f.equipment_id === selectedBus)}
            routesById={routesById}
            stopsById={stopsById}
            now={now}
            onSelectStop={onSelectStop}
            onClose={() => onSelectBus(null)}
          />
        ) : route ? (
          <>
            <div className="flex items-center gap-3 px-4 pt-3">
              <span
                className="grid size-9 shrink-0 place-items-center rounded-full text-sm font-bold text-white"
                style={{ background: route.color }}
              >
                {route.short_name}
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="truncate font-semibold">{route.name}</h2>
                <p className="text-xs text-gray-500">
                  {routeFixes.length === 0
                    ? 'Not running right now'
                    : `${routeFixes.length} running now`}
                </p>
              </div>
              <CloseButton label="Close route" onClick={() => onSelectRoute(null)} />
            </div>
            <RouteSchedule
              route={route}
              stopsById={stopsById}
              fixes={routeFixes}
              now={now}
              onSelectStop={onSelectStop}
            />
          </>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col">
            <div role="tablist" className="mx-4 mt-3 mb-1 flex h-9 shrink-0 rounded-lg bg-gray-100 p-0.5 text-sm">
              {(
                [
                  ['buses', 'Running now'],
                  ['stops', 'Bus stops'],
                ] as const
              ).map(([tab, label]) => (
                <button
                  key={tab}
                  type="button"
                  role="tab"
                  aria-selected={homeTab === tab}
                  onClick={() => setHomeTab(tab)}
                  className={`flex-1 rounded-md font-medium ${homeTab === tab ? 'bg-white shadow-sm' : 'text-gray-600'}`}
                >
                  {label}
                </button>
              ))}
            </div>
            {homeTab === 'buses' ? (
              <div className="min-h-0 flex-1 overflow-y-auto">
                <VehicleList
                  fixes={fixes}
                  routesById={routesById}
                  now={now}
                  onSelectBus={onSelectBus}
                />
              </div>
            ) : (
              <StopList stops={stops} routesByStop={routesByStop} onSelectStop={onSelectStop} />
            )}
          </div>
        )}
      </div>
    </div>
  )
}
