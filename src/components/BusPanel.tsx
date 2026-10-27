import { eq, inArray } from '@tanstack/db'
import { useLiveQuery } from '@tanstack/react-db'
import { distanceMeters } from '../collector/arrivals'
import { scheduledCallId } from '../collector/schema'
import type { BusRoute, BusStop, NewestPositionFix, TodaysArrival } from '../live/collections'
import { getLiveDb } from '../live/db'
import { formatClockAt, formatGtfsTime, gtfsMinutes } from '../lib/charlottesville-time'
import { useStopHover } from '../lib/hovered-stop'
import { lateLabelAt, vendorScheduleLabel } from '../lib/schedule-label'
import { CloseButton } from './CloseButton'
import { PredictionTime } from './PredictionTime'
import { RouteChip } from './RouteChip'

const PREVIOUS_STOPS = 5
// so a bus back from a break doesn't list stops from before it
const PREVIOUS_WITHIN_MS = 90 * 60_000
// A bus parked for a layover can be further from the stop's pin than an
// arrival needs (ARRIVAL_RADIUS_M).
const STILL_HERE_M = 60

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
  const recent = arrivals
    .filter((a) => a.arrived_at >= now - PREVIOUS_WITHIN_MS)
    .sort((a, b) => a.arrived_at - b.arrived_at)
    .slice(-PREVIOUS_STOPS)
  const { data: recentTrips } = useLiveQuery(
    (q) =>
      q.from({ t: live.timetableStops }).where(({ t }) => inArray(t.schedule_number, recent.map((a) => a.schedule_number))),
    [recent.map((a) => a.schedule_number).join()],
  )
  // where each recent scheduled trip starts: a bus there early is waiting out a layover
  const tripStarts = new Map<string, { stopId: string; sequence: number }>()
  for (const t of recentTrips) {
    const start = tripStarts.get(t.schedule_number!)
    if (!start || t.stop_sequence < start.sequence) {
      tripStarts.set(t.schedule_number!, { stopId: t.stop_id, sequence: t.stop_sequence })
    }
  }
  const isLayover = (a: TodaysArrival) =>
    a.slot_at != null && a.arrived_at < a.slot_at && tripStarts.get(a.schedule_number)?.stopId === a.stop_id

  const upcomingAll = predictions
    .filter((p) => p.predicted_at >= now - 60_000)
    .sort((a, b) => a.predicted_at - b.predicted_at)
  // The feed vendor never predicts early, so it can keep predicting a call
  // the bus has already passed; only a bus still at the stop is waiting there.
  const atStop = (stopId: string) => {
    const stop = stopsById.get(stopId)
    if (!fix || !stop) return false
    return (fix.at_stop && fix.last_stop_id === stopId) || distanceMeters(fix, stop) <= STILL_HERE_M
  }
  const here = recent
    .map((arrival) => ({ arrival, prediction: upcomingAll.find((p) => scheduledCallId(p) === arrival.id) }))
    .filter(({ arrival, prediction }) => prediction && atStop(arrival.stop_id))
    .at(-1)
  const reached = new Set(recent.map((a) => a.id))
  const previous = recent.filter((a) => a !== here?.arrival)
  const upcoming = upcomingAll.filter((p) => !reached.has(scheduledCallId(p)))
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
        <ul className="divide-y divide-gray-100">
          {previous.map((a) => (
            <StopRow key={a.id} stopId={a.stop_id} name={stopName(a.stop_id)} onSelect={onSelectStop} past>
              <span className="shrink-0 text-right tabular-nums">
                <span className="block">
                  {a.slot_at == null ? 'unscheduled' : isLayover(a) ? 'layover' : lateLabelAt(a.arrived_at, a.slot_at)}
                </span>
                <span className="block text-xs text-gray-500">
                  {formatClockAt(a.arrived_at)}
                  {a.slot_at != null && ` · ${isLayover(a) ? 'due out' : 'due'} ${formatClockAt(a.slot_at)}`}
                </span>
              </span>
            </StopRow>
          ))}
          <li className="flex items-center gap-2 px-4 py-1.5 text-[11px] font-medium tracking-wide text-gray-500 uppercase">
            <span className="size-2 rounded-full" style={{ background: route?.color ?? '#555' }} />
            Now
            <span className="h-px flex-1 bg-gray-200" />
          </li>
          {here && (
            <StopRow stopId={here.arrival.stop_id} name={stopName(here.arrival.stop_id)} onSelect={onSelectStop}>
              <span className="shrink-0 text-right tabular-nums">
                <span className="block font-semibold">
                  {here.prediction!.predicted_at <= now
                    ? 'leaving now'
                    : `leaves in ${Math.round((here.prediction!.predicted_at - now) / 60_000)} min`}
                </span>
                <span className="block text-xs text-gray-500">here since {formatClockAt(here.arrival.arrived_at)}</span>
              </span>
            </StopRow>
          )}
          {upcoming.map((p) => (
            <StopRow key={p.id} stopId={p.stop_id} name={stopName(p.stop_id)} onSelect={onSelectStop}>
              <PredictionTime predictedAt={p.predicted_at} dueAt={p.slot_at} now={now} />
            </StopRow>
          ))}
          {upcoming.length === 0 && !here && <li className="px-4 py-3 text-gray-500">No arrival predictions for this bus right now.</li>}
        </ul>

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
  past = false,
  children,
}: {
  stopId: string
  name: string
  onSelect: (stopId: string) => void
  past?: boolean
  children: React.ReactNode
}) {
  const { highlighted, ...hover } = useStopHover(stopId)
  return (
    <li
      {...hover}
      className={`flex items-center gap-3 px-4 py-2 ${past ? 'text-gray-500' : ''} ${highlighted ? 'bg-gray-100' : ''}`}
    >
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
