import type { BusRoute, NewestPositionFix, TodaysArrival } from '../live/collections'
import { lateLabel, minutesLate, scheduleLabel } from '../lib/schedule-label'
import { RouteChip } from './RouteChip'

// Older than this, a bus's last observed arrival no longer says how late it is.
const LATEST_ARRIVAL_MS = 30 * 60_000

export function VehicleList({
  fixes,
  routesById,
  latestArrivals,
  now,
  onSelectBus,
}: {
  fixes: NewestPositionFix[]
  routesById: Map<number, BusRoute>
  // each bus's newest observed arrival with a matched slot
  latestArrivals: Map<string, TodaysArrival>
  now: number
  onSelectBus: (equipmentId: string) => void
}) {
  if (fixes.length === 0) {
    return <p className="px-4 py-6 text-sm text-gray-500">No buses are running right now.</p>
  }
  const sorted = [...fixes].sort(
    (a, b) => (a.route_id ?? 0) - (b.route_id ?? 0) || a.equipment_id.localeCompare(b.equipment_id),
  )
  return (
    <ul className="divide-y divide-gray-100">
      {sorted.map((fix) => {
        const route = fix.route_id == null ? undefined : routesById.get(fix.route_id)
        const arrival = latestArrivals.get(fix.equipment_id)
        const lateness =
          arrival && arrival.slot_at != null && now - arrival.arrived_at <= LATEST_ARRIVAL_MS
            ? lateLabel(minutesLate(arrival.arrived_at, arrival.slot_at))
            : scheduleLabel(fix.on_schedule)
        return (
          <li key={fix.equipment_id}>
            <button
              type="button"
              onClick={() => onSelectBus(fix.equipment_id)}
              className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm hover:bg-gray-50"
            >
              <RouteChip route={route} />
              <span className="min-w-0 flex-1">
                <span className="font-medium">Bus {fix.equipment_id}</span>
                <span className="block truncate text-xs text-gray-500">
                  {fix.at_stop ? 'At a stop' : 'Moving'} · {lateness}
                </span>
              </span>
              <span className="text-xs text-gray-500 tabular-nums">
                {Math.round((now - fix.fix_time) / 1000)}s ago
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}
