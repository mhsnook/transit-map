import { eq } from '@tanstack/db'
import { useLiveQuery } from '@tanstack/react-db'
import type { BusRoute, BusStop, NewestPositionFix } from '../live/collections'
import { getLiveDb } from '../live/db'
import { formatClockAt, formatGtfsTime } from '../lib/charlottesville-time'
import { lateLabel, minutesLate, scheduleLabel } from '../lib/schedule-label'
import { RouteChip } from './RouteChip'

const RECENT_MS = 90 * 60_000

export function BusPanel({
  equipmentId,
  fix,
  routesById,
  stopsById,
  now,
  onSelectStop,
  onClose,
}: {
  equipmentId: string
  // undefined once the bus has left the feed
  fix: NewestPositionFix | undefined
  routesById: Map<number, BusRoute>
  stopsById: Map<string, BusStop>
  now: number
  onSelectStop: (stopId: string) => void
  onClose: () => void
}) {
  const live = getLiveDb()
  const { data: predictions } = useLiveQuery(
    (q) => q.from({ p: live.currentArrivalPredictions }).where(({ p }) => eq(p.equipment_id, equipmentId)),
    [equipmentId],
  )
  const { data: arrivals } = useLiveQuery(
    (q) => q.from({ a: live.todaysArrivals }).where(({ a }) => eq(a.equipment_id, equipmentId)),
    [equipmentId],
  )
  const route = fix?.route_id == null ? undefined : routesById.get(fix.route_id)
  const upcoming = predictions
    .filter((p) => p.predicted_at >= now - 60_000)
    .sort((a, b) => a.predicted_at - b.predicted_at)
  const recent = arrivals.filter((a) => a.arrived_at >= now - RECENT_MS).sort((a, b) => b.arrived_at - a.arrived_at)
  const stopName = (stopId: string) => stopsById.get(stopId)?.name ?? `Stop ${stopId}`
  // the feed vendor's schedule number starts with its trip's start time
  const vendorTrip = fix?.schedule_number?.split('-')[0]

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-3 px-4 pt-3 pb-2">
        <RouteChip route={route} />
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-semibold">Bus {equipmentId}</h2>
          <p className="truncate text-xs text-gray-500">
            {fix
              ? `${route?.name ?? 'No bus route'} · ${fix.at_stop ? 'At a stop' : 'Moving'} · seen ${Math.round((now - fix.fix_time) / 1000)}s ago`
              : 'Not running now'}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close bus"
          className="grid size-8 shrink-0 place-items-center rounded-full text-gray-500 hover:bg-gray-100"
        >
          ✕
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pb-6 text-sm">
        <p className="px-4 pt-1 pb-1 text-xs font-medium tracking-wide text-gray-500 uppercase">Next stops</p>
        {upcoming.length === 0 ? (
          <p className="px-4 py-3 text-gray-500">No arrival predictions for this bus right now.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {upcoming.map((p) => {
              const away = Math.round((p.predicted_at - now) / 60_000)
              return (
                <li key={p.id} className="flex items-center gap-3 px-4 py-2">
                  <StopButton name={stopName(p.stop_id)} onClick={() => onSelectStop(p.stop_id)} />
                  <span className="shrink-0 text-right tabular-nums">
                    <span className="block font-semibold">{away <= 0 ? 'Due' : `${away} min`}</span>
                    <span className="block text-xs text-gray-500">
                      {formatClockAt(p.predicted_at)}
                      {p.slot_at != null && ` · ${lateLabel(minutesLate(p.predicted_at, p.slot_at))}`}
                    </span>
                  </span>
                </li>
              )
            })}
          </ul>
        )}

        <p className="px-4 pt-4 pb-1 text-xs font-medium tracking-wide text-gray-500 uppercase">Recent stops</p>
        {recent.length === 0 ? (
          <p className="px-4 py-3 text-gray-500">No arrivals observed in the last 90 minutes.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {recent.map((a) => (
              <li key={a.id} className="flex items-center gap-3 px-4 py-2">
                <StopButton name={stopName(a.stop_id)} onClick={() => onSelectStop(a.stop_id)} />
                <span className="shrink-0 text-right tabular-nums">
                  <span className="block">{a.slot_at == null ? 'unscheduled' : lateLabel(minutesLate(a.arrived_at, a.slot_at))}</span>
                  <span className="block text-xs text-gray-500">
                    {formatClockAt(a.arrived_at)}
                    {a.slot_at != null && ` · due ${formatClockAt(a.slot_at)}`}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}

        {fix && vendorTrip && (
          <p className="px-4 pt-4 text-xs text-gray-500">
            The feed vendor has this bus on its {formatGtfsTime(vendorTrip)} trip, {scheduleLabel(fix.on_schedule)}.
            Lateness here is against when a bus was due at each stop.
          </p>
        )}
      </div>
    </div>
  )
}

function StopButton({ name, onClick }: { name: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="min-w-0 flex-1 truncate text-left hover:underline">
      {name}
    </button>
  )
}
