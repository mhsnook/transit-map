import { useLiveQuery } from '@tanstack/react-db'
import { useMemo } from 'react'
import { getLiveDb } from '../live/db'
import { useNow } from '../lib/use-now'
import { RoutePicker } from './RoutePicker'
import { RouteSchedule } from './RouteSchedule'
import { VehicleList } from './VehicleList'

export function InfoPanel({
  selectedRoute,
  onSelectRoute,
  title,
}: {
  selectedRoute: number | null
  onSelectRoute: (routeId: number | null) => void
  // the drawer passes its accessible Drawer.Title here
  title: React.ReactNode
}) {
  const live = getLiveDb()
  const { data: busRoutes } = useLiveQuery((q) =>
    q.from({ r: live.busRoutes }).orderBy(({ r }) => r.id),
  )
  const { data: stops } = useLiveQuery((q) => q.from({ s: live.busStops }))
  const { data: fixes } = useLiveQuery((q) => q.from({ f: live.newestPositionFixes }))
  const now = useNow(1000)

  const routesById = useMemo(() => new Map(busRoutes.map((r) => [r.id, r])), [busRoutes])
  const stopsById = useMemo(() => new Map(stops.map((s) => [s.id, s])), [stops])
  const runningByRoute = useMemo(() => {
    const counts = new Map<number, number>()
    for (const f of fixes) if (f.route_id != null) counts.set(f.route_id, (counts.get(f.route_id) ?? 0) + 1)
    return counts
  }, [fixes])
  const route = selectedRoute == null ? undefined : routesById.get(selectedRoute)
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
        {route ? (
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
              <button
                type="button"
                onClick={() => onSelectRoute(null)}
                aria-label="Close route"
                className="grid size-8 place-items-center rounded-full text-gray-500 hover:bg-gray-100"
              >
                ✕
              </button>
            </div>
            <RouteSchedule route={route} stopsById={stopsById} fixes={routeFixes} now={now} />
          </>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto">
            <p className="px-4 pt-3 pb-1 text-xs font-medium tracking-wide text-gray-500 uppercase">
              Running now
            </p>
            <VehicleList fixes={fixes} routesById={routesById} now={now} />
          </div>
        )}
      </div>
    </div>
  )
}
