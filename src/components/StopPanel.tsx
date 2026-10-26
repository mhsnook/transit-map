import { eq } from '@tanstack/db'
import { useLiveQuery } from '@tanstack/react-db'
import { Await, getRouteApi } from '@tanstack/react-router'
import { useMemo } from 'react'
import type { ScheduledStop } from '../collector/schedule'
import type { BusRoute, BusStop } from '../live/collections'
import { getLiveDb } from '../live/db'
import { formatClockAt } from '../lib/charlottesville-time'
import { upcomingCalls, type UpcomingCall } from '../lib/stop-upcoming'
import { RouteChip } from './RouteChip'
import { StopHistory } from './StopHistory'

const routeApi = getRouteApi('/')
const UPCOMING_LIMIT = 15

export function StopPanel({
  stopId,
  stop,
  routes,
  routesById,
  now,
  onClose,
}: {
  stopId: string
  // undefined until bus stops have synced
  stop: BusStop | undefined
  routes: BusRoute[]
  routesById: Map<number, BusRoute>
  now: number
  onClose: () => void
}) {
  const { schedule, history } = routeApi.useLoaderData()
  const showHistory = routeApi.useSearch({ select: (s) => s.history ?? false })
  const navigate = routeApi.useNavigate()

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-3 px-4 pt-3 pb-2">
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-semibold">{stop?.name ?? `Stop ${stopId}`}</h2>
          <div className="mt-1 flex flex-wrap gap-1">
            {routes.map((r) => (
              <RouteChip key={r.id} route={r} size="xs" />
            ))}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close bus stop"
          className="grid size-8 shrink-0 place-items-center rounded-full text-gray-500 hover:bg-gray-100"
        >
          ✕
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pb-6">
        {schedule ? (
          <Await
            promise={schedule}
            fallback={<Upcoming stopId={stopId} scheduledStops={[]} routesById={routesById} now={now} loading />}
          >
            {(rows) => <Upcoming stopId={stopId} scheduledStops={rows} routesById={routesById} now={now} />}
          </Await>
        ) : null}

        <div className="border-t border-gray-200 px-4 pt-3">
          <button
            type="button"
            aria-expanded={showHistory}
            onClick={() =>
              navigate({ search: (prev) => ({ ...prev, history: showHistory ? undefined : true }), replace: true })
            }
            className="flex w-full items-center justify-between text-left text-sm font-medium"
          >
            <span>Schedule, predictions and arrivals</span>
            <span className="text-gray-500">{showHistory ? 'Hide' : 'Show'}</span>
          </button>
          {showHistory && history && (
            <Await promise={history} fallback={<p className="py-4 text-sm text-gray-500">Loading history…</p>}>
              {(calls) => <StopHistory calls={calls} routesById={routesById} now={now} />}
            </Await>
          )}
        </div>
      </div>
    </div>
  )
}

function Upcoming({
  stopId,
  scheduledStops,
  routesById,
  now,
  loading = false,
}: {
  stopId: string
  scheduledStops: ScheduledStop[]
  routesById: Map<number, BusRoute>
  now: number
  loading?: boolean
}) {
  const live = getLiveDb()
  const { data: predictions } = useLiveQuery(
    (q) => q.from({ p: live.currentArrivalPredictions }).where(({ p }) => eq(p.stop_id, stopId)),
    [stopId],
  )
  const { data: timetable } = useLiveQuery((q) => q.from({ t: live.timetableStops }))
  const headsigns = useMemo(() => {
    const byDirection = new Map<string, string>()
    for (const t of timetable) {
      const key = `${t.route}|${t.direction}`
      if (!byDirection.has(key)) byDirection.set(key, t.headsign)
    }
    return byDirection
  }, [timetable])

  const calls = upcomingCalls({
    now,
    predictions,
    scheduledStops,
    routesById,
    headsign: (route, direction) => headsigns.get(`${route}|${direction}`),
    limit: UPCOMING_LIMIT,
  })

  return (
    <section aria-label="Upcoming buses">
      <p className="px-4 pt-1 pb-1 text-xs font-medium tracking-wide text-gray-500 uppercase">Upcoming</p>
      {calls.length === 0 ? (
        <p className="px-4 py-4 text-sm text-gray-500">
          {loading ? 'Loading the schedule…' : 'No buses scheduled here in the next day.'}
        </p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {calls.map((call) => (
            <UpcomingRow key={call.key} call={call} now={now} />
          ))}
        </ul>
      )}
    </section>
  )
}

function UpcomingRow({ call, now }: { call: UpcomingCall; now: number }) {
  const minutesAway = call.predictedAt == null ? null : Math.round((call.predictedAt - now) / 60_000)
  const deviation =
    call.predictedAt == null || call.scheduledAt == null
      ? null
      : Math.round((call.predictedAt - call.scheduledAt) / 60_000)

  return (
    <li className="flex items-center gap-3 px-4 py-2 text-sm">
      <RouteChip route={call.route} />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{call.headsign ?? call.route?.name ?? 'Bus'}</span>
        <span className="block truncate text-xs text-gray-500">
          {call.equipmentId == null
            ? 'Scheduled'
            : `Bus ${call.equipmentId} · ${formatClockAt(call.scheduledAt!)} scheduled`}
        </span>
      </span>
      <span className="shrink-0 text-right tabular-nums">
        {minutesAway == null ? (
          <span
            className="text-gray-600"
            title={call.timepoint ? undefined : 'The feed vendor’s estimate between timepoints'}
          >
            {call.timepoint ? '' : '~'}
            {formatClockAt(call.scheduledAt!)}
          </span>
        ) : (
          <>
            <span className="flex items-center justify-end gap-1.5 font-semibold">
              <span aria-hidden className="size-2 animate-pulse rounded-full bg-emerald-500" />
              {minutesAway <= 0 ? 'Due' : `${minutesAway} min`}
            </span>
            <span className="block text-xs text-gray-500">
              {formatClockAt(call.predictedAt!)}
              {deviation != null && ` · ${deviationLabel(deviation)}`}
            </span>
          </>
        )}
      </span>
    </li>
  )
}

export function deviationLabel(minutes: number): string {
  if (minutes === 0) return 'on time'
  return minutes > 0 ? `${minutes} min late` : `${-minutes} min early`
}
