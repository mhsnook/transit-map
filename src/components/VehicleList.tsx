import type { BusRoute, NewestPositionFix } from '../live/collections'
import { scheduleLabel } from '../lib/schedule-label'

export function VehicleList({
  fixes,
  routesById,
  now,
}: {
  fixes: NewestPositionFix[]
  routesById: Map<number, BusRoute>
  now: number
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
        return (
          <li key={fix.equipment_id} className="flex items-center gap-3 px-4 py-2 text-sm">
            <span
              className="grid size-7 shrink-0 place-items-center rounded-full text-xs font-semibold text-white"
              style={{ background: route?.color ?? '#555' }}
            >
              {route?.short_name ?? '?'}
            </span>
            <span className="min-w-0 flex-1">
              <span className="font-medium">Bus {fix.equipment_id}</span>
              <span className="block truncate text-xs text-gray-500">
                {fix.at_stop ? 'At a stop' : 'Moving'} · {scheduleLabel(fix.on_schedule)}
              </span>
            </span>
            <span className="text-xs text-gray-500 tabular-nums">
              {Math.round((now - fix.fix_time) / 1000)}s ago
            </span>
          </li>
        )
      })}
    </ul>
  )
}
