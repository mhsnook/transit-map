import { eq } from '@tanstack/db'
import { useLiveQuery } from '@tanstack/react-db'
import type { BusRoute, BusStop, NewestPositionFix } from '../live/collections'
import { getLiveDb } from '../live/db'
import { formatClockAt, formatGtfsTime, gtfsMinutes } from '../lib/charlottesville-time'
import { useStopHover } from '../lib/hovered-stop'
import { lateLabelAt, vendorScheduleLabel } from '../lib/schedule-label'
import { CloseButton } from './CloseButton'
import { PredictionTime } from './PredictionTime'
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
  const { data: vendorTrip } = useLiveQuery(
    (q) => q.from({ t: live.timetableStops }).where(({ t }) => eq(t.trip_id, fix?.trip_id ?? '')),
    [fix?.trip_id],
  )
  const route = fix?.route_id == null ? undefined : routesById.get(fix.route_id)
  const upcoming = predictions
    .filter((p) => p.predicted_at >= now - 60_000)
    .sort((a, b) => a.predicted_at - b.predicted_at)
  const recent = arrivals.filter((a) => a.arrived_at >= now - RECENT_MS).sort((a, b) => b.arrived_at - a.arrived_at)
  const stopName = (stopId: string) => stopsById.get(stopId)?.name ?? `Stop ${stopId}`
  const vendorTripStart = vendorTrip.reduce<string | undefined>(
    (first, t) => (first == null || gtfsMinutes(t.departure_time) < gtfsMinutes(first) ? t.departure_time : first),
    undefined,
  )

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
        <CloseButton label="Close bus" onClick={onClose} />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pb-6 text-sm">
        <p className="px-4 pt-1 pb-1 text-xs font-medium tracking-wide text-gray-500 uppercase">Next stops</p>
        {upcoming.length === 0 ? (
          <p className="px-4 py-3 text-gray-500">No arrival predictions for this bus right now.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {upcoming.map((p) => (
              <StopRow key={p.id} stopId={p.stop_id} name={stopName(p.stop_id)} onSelect={onSelectStop}>
                <PredictionTime predictedAt={p.predicted_at} dueAt={p.slot_at} now={now} />
              </StopRow>
            ))}
          </ul>
        )}

        <p className="px-4 pt-4 pb-1 text-xs font-medium tracking-wide text-gray-500 uppercase">Recent stops</p>
        {recent.length === 0 ? (
          <p className="px-4 py-3 text-gray-500">No arrivals observed in the last 90 minutes.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {recent.map((a) => (
              <StopRow key={a.id} stopId={a.stop_id} name={stopName(a.stop_id)} onSelect={onSelectStop}>
                <span className="shrink-0 text-right tabular-nums">
                  <span className="block">{a.slot_at == null ? 'unscheduled' : lateLabelAt(a.arrived_at, a.slot_at)}</span>
                  <span className="block text-xs text-gray-500">
                    {formatClockAt(a.arrived_at)}
                    {a.slot_at != null && ` · due ${formatClockAt(a.slot_at)}`}
                  </span>
                </span>
              </StopRow>
            ))}
          </ul>
        )}

        {fix && vendorTripStart && (
          <p className="px-4 pt-4 text-xs text-gray-500">
            The feed vendor has this bus on its {formatGtfsTime(vendorTripStart)} trip,{' '}
            {vendorScheduleLabel(fix.on_schedule)}. Lateness here is against when a bus was due at each stop.
          </p>
        )}
      </div>
    </div>
  )
}

function StopRow({
  stopId,
  name,
  onSelect,
  children,
}: {
  stopId: string
  name: string
  onSelect: (stopId: string) => void
  children: React.ReactNode
}) {
  const { highlighted, ...hover } = useStopHover(stopId)
  return (
    <li {...hover} className={`flex items-center gap-3 px-4 py-2 ${highlighted ? 'bg-gray-100' : ''}`}>
      <button
        type="button"
        onClick={() => onSelect(stopId)}
        className="min-w-0 flex-1 truncate text-left hover:underline"
      >
        {name}
      </button>
      {children}
    </li>
  )
}
