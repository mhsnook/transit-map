import { useLiveQuery } from '@tanstack/react-db'
import { useMemo } from 'react'
import type { BusRoute, NewestPositionFix } from '../live/collections'
import { getLiveDb } from '../live/db'
import { lateLabelAt, vendorScheduleLabel } from '../lib/schedule-label'
import { RouteChip } from './RouteChip'

// Older than this, a bus's last observed arrival no longer says how late it is.
const LATEST_ARRIVAL_MS = 30 * 60_000

export function VehicleList({
  fixes,
  routesById,
  now,
  onSelectBus,
}: {
  fixes: NewestPositionFix[]
  routesById: Map<number, BusRoute>
  now: number
  onSelectBus: (equipmentId: string) => void
}) {
  const live = getLiveDb()
  const { data: arrivals } = useLiveQuery((q) => q.from({ a: live.todaysArrivals }))
  // each bus's newest observed arrival that has a matched slot
  const latest = useMemo(() => {
    const byBus = new Map<string, { arrivedAt: number; slotAt: number }>()
    for (const a of arrivals) {
      if (a.slot_at == null || a.arrived_at <= (byBus.get(a.equipment_id)?.arrivedAt ?? 0)) continue
      byBus.set(a.equipment_id, { arrivedAt: a.arrived_at, slotAt: a.slot_at })
    }
    return byBus
  }, [arrivals])

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
        const arrival = latest.get(fix.equipment_id)
        const lateness =
          arrival && now - arrival.arrivedAt <= LATEST_ARRIVAL_MS
            ? lateLabelAt(arrival.arrivedAt, arrival.slotAt)
            : `${vendorScheduleLabel(fix.on_schedule)} (vendor)`
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
