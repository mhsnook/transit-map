import { useMemo, useState } from 'react'
import type { BusRoute, BusStop } from '../live/collections'
import { useStopHover } from '../lib/hovered-stop'
import { RouteChip } from './RouteChip'

export function StopList({
  stops,
  routesByStop,
  onSelectStop,
}: {
  stops: BusStop[]
  routesByStop: Map<string, BusRoute[]>
  onSelectStop: (stopId: string) => void
}) {
  const [query, setQuery] = useState('')
  const sorted = useMemo(() => [...stops].sort((a, b) => a.name.localeCompare(b.name)), [stops])
  const needle = query.trim().toLowerCase()
  const shown = needle
    ? sorted.filter((s) => s.name.toLowerCase().includes(needle) || s.id === needle)
    : sorted

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-4 pt-2 pb-2">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Find a bus stop"
          aria-label="Find a bus stop"
          className="h-9 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm"
        />
      </div>
      <ul className="min-h-0 flex-1 divide-y divide-gray-100 overflow-y-auto">
        {shown.map((stop) => (
          <StopListRow key={stop.id} stop={stop} routes={routesByStop.get(stop.id) ?? []} onSelect={onSelectStop} />
        ))}
        {shown.length === 0 && <li className="px-4 py-6 text-sm text-gray-500">No bus stops match.</li>}
      </ul>
    </div>
  )
}

function StopListRow({
  stop,
  routes,
  onSelect,
}: {
  stop: BusStop
  routes: BusRoute[]
  onSelect: (stopId: string) => void
}) {
  const { highlighted, ...hover } = useStopHover(stop.id)
  return (
    <li {...hover}>
      <button
        type="button"
        onClick={() => onSelect(stop.id)}
        className={`flex w-full items-center gap-3 px-4 py-2 text-left text-sm hover:bg-gray-50 ${highlighted ? 'bg-gray-100' : ''}`}
      >
        <span className="min-w-0 flex-1 truncate">{stop.name}</span>
        <span className="flex shrink-0 gap-1">
          {routes.map((r) => (
            <RouteChip key={r.id} route={r} size="xs" />
          ))}
        </span>
      </button>
    </li>
  )
}
