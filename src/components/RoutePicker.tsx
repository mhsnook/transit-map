import type { BusRoute } from '../live/collections'

export function RoutePicker({
  busRoutes,
  selectedRoute,
  onSelectRoute,
  runningByRoute,
}: {
  busRoutes: BusRoute[]
  selectedRoute: number | null
  onSelectRoute: (routeId: number | null) => void
  runningByRoute: Map<number, number>
}) {
  return (
    <div
      role="listbox"
      aria-label="Bus routes"
      className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 lg:mx-0 lg:flex-wrap lg:overflow-visible lg:px-0"
    >
      {busRoutes.map((r) => {
        const selected = selectedRoute === r.id
        const running = runningByRoute.get(r.id) ?? 0
        return (
          <button
            key={r.id}
            type="button"
            role="option"
            aria-selected={selected}
            title={r.name}
            onClick={() => onSelectRoute(selected ? null : r.id)}
            className="relative h-9 min-w-9 shrink-0 rounded-full border-2 px-2.5 text-sm font-semibold tabular-nums transition-colors"
            style={{
              borderColor: r.color,
              background: selected ? r.color : 'white',
              color: selected ? 'white' : '#111',
            }}
          >
            {r.short_name}
            {running > 0 && (
              <span
                aria-label={`${running} running`}
                className="absolute -top-0.5 -right-0.5 size-2.5 rounded-full border-2 border-white bg-emerald-500"
              />
            )}
          </button>
        )
      })}
    </div>
  )
}
