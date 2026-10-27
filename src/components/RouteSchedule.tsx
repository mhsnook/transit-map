import { eq } from '@tanstack/db'
import { useLiveQuery } from '@tanstack/react-db'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { BusRoute, BusStop, NewestPositionFix, TimetableStop } from '../live/collections'
import { getLiveDb } from '../live/db'
import {
  charlottesvilleMidnight,
  charlottesvilleMinutes,
  formatClockAt,
  formatGtfsTime,
  gtfsMinutes,
  upcomingServiceDays,
} from '../lib/charlottesville-time'
import { useStopHover } from '../lib/hovered-stop'
import { lateLabel, lateLabelAt } from '../lib/schedule-label'
import { arrivalAt, timepointArrivals, tripOutcomes, type TripOutcome } from '../lib/trip-outcomes'

type Column = { key: string; stopId: string }
type Run = {
  tripId: string
  cells: Map<string, TimetableStop>
  // in stop order
  stops: TimetableStop[]
  first: number
  last: number
}
type Direction = { direction: number; headsign: string; columns: Column[]; runs: Run[] }

// A timepoint can come up twice in one run (a loop through the same station),
// so a column is a stop plus which visit it is.
function buildDirections(rows: TimetableStop[]): Direction[] {
  const trips = new Map<string, TimetableStop[]>()
  for (const row of rows) trips.set(row.trip_id, [...(trips.get(row.trip_id) ?? []), row])

  const byDirection = new Map<number, Direction>()
  const positions = new Map<number, Map<string, { stopId: string; sum: number; n: number }>>()
  for (const [tripId, stops] of trips) {
    stops.sort((a, b) => a.stop_sequence - b.stop_sequence)
    const { direction, headsign } = stops[0]
    const dir = byDirection.get(direction) ?? { direction, headsign, columns: [], runs: [] }
    byDirection.set(direction, dir)
    const pos = positions.get(direction) ?? new Map()
    positions.set(direction, pos)

    const visits = new Map<string, number>()
    const cells = new Map<string, TimetableStop>()
    stops.forEach((stop, i) => {
      const visit = (visits.get(stop.stop_id) ?? 0) + 1
      visits.set(stop.stop_id, visit)
      const key = `${stop.stop_id}#${visit}`
      cells.set(key, stop)
      const p = pos.get(key) ?? { stopId: stop.stop_id, sum: 0, n: 0 }
      p.sum += stops.length > 1 ? i / (stops.length - 1) : 0
      p.n += 1
      pos.set(key, p)
    })
    dir.runs.push({
      tripId,
      cells,
      stops,
      first: gtfsMinutes(stops[0].departure_time),
      last: gtfsMinutes(stops[stops.length - 1].arrival_time),
    })
  }
  for (const dir of byDirection.values()) {
    dir.runs.sort((a, b) => a.first - b.first)
    dir.columns = [...positions.get(dir.direction)!.entries()]
      .sort(([, a], [, b]) => a.sum / a.n - b.sum / b.n)
      .map(([key, p]) => ({ key, stopId: p.stopId }))
  }
  return [...byDirection.values()].sort((a, b) => a.direction - b.direction)
}

export function RouteSchedule({
  route,
  stopsById,
  fixes,
  now,
  onSelectStop,
}: {
  route: BusRoute
  stopsById: Map<string, BusStop>
  fixes: NewestPositionFix[]
  now: number
  onSelectStop: (stopId: string) => void
}) {
  const live = getLiveDb()
  const { data: rows } = useLiveQuery(
    (q) => q.from({ t: live.timetableStops }).where(({ t }) => eq(t.route, route.short_name)),
    [route.short_name],
  )
  const days = upcomingServiceDays(now)
  const [dayIndex, setDayIndex] = useState(0)
  const [directionIndex, setDirectionIndex] = useState(0)
  const day = days[dayIndex]

  const directions = useMemo(
    () => buildDirections(rows.filter((r) => r.days[day.weekday] !== '-')),
    [rows, day.weekday],
  )
  const dir = directions[Math.min(directionIndex, directions.length - 1)]
  const { data: todays } = useLiveQuery(
    (q) => q.from({ a: live.todaysArrivals }).where(({ a }) => eq(a.route_id, route.id)),
    [route.id],
  )
  const arrivals = useMemo(() => timepointArrivals(todays), [todays])
  const running = useMemo(() => new Set(fixes.map((f) => f.equipment_id)), [fixes])

  const isToday = dayIndex === 0
  const nowMinutes = charlottesvilleMinutes(now)
  const midnight = charlottesvilleMidnight(now)
  // trips settle on the minute, so the per-second clock needn't recompute this
  const minute = Math.floor(now / 60_000)
  const outcomes = useMemo(
    () => (isToday && dir ? tripOutcomes(dir.runs, arrivals, midnight, minute * 60_000) : new Map<string, TripOutcome>()),
    [isToday, dir, arrivals, midnight, minute],
  )
  const nextRun = isToday ? dir?.runs.find((r) => r.first >= nowMinutes) : undefined

  const scrollRef = useRef<HTMLDivElement>(null)
  const nextRowRef = useRef<HTMLTableRowElement>(null)
  useEffect(() => {
    const container = scrollRef.current
    const row = nextRowRef.current
    if (container) container.scrollTop = row ? row.offsetTop - 48 : 0
    // only when what's shown changes, not on every clock tick
  }, [route.id, dayIndex, dir?.direction])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 px-4 pt-3 pb-2">
        <label className="sr-only" htmlFor="schedule-day">
          Day
        </label>
        <select
          id="schedule-day"
          value={dayIndex}
          onChange={(e) => setDayIndex(Number(e.target.value))}
          className="h-9 min-w-0 flex-1 rounded-lg border border-gray-300 bg-white px-2 text-sm"
        >
          {days.map((d, i) => (
            <option key={d.date} value={i}>
              {d.label} · {d.date}
            </option>
          ))}
        </select>
        {directions.length > 1 && (
          <div role="tablist" className="flex h-9 shrink-0 rounded-lg bg-gray-100 p-0.5 text-sm">
            {directions.map((d, i) => (
              <button
                key={d.direction}
                type="button"
                role="tab"
                aria-selected={d === dir}
                onClick={() => setDirectionIndex(i)}
                className={`rounded-md px-3 font-medium ${d === dir ? 'bg-white shadow-sm' : 'text-gray-600'}`}
              >
                {d.headsign}
              </button>
            ))}
          </div>
        )}
      </div>

      {!dir ? (
        <p className="px-4 py-6 text-sm text-gray-500">
          No route {route.short_name} service {isToday ? 'today' : `on ${day.label}`}.
        </p>
      ) : (
        <div ref={scrollRef} className="relative min-h-0 flex-1 overflow-auto">
          <table className="w-full border-separate border-spacing-0 text-sm tabular-nums">
            <thead className="sticky top-0 z-10 bg-white">
              <tr>
                {dir.columns.map((c) => (
                  <StopHeader
                    key={c.key}
                    stopId={c.stopId}
                    name={stopsById.get(c.stopId)?.name ?? `Stop ${c.stopId}`}
                    onSelect={onSelectStop}
                  />
                ))}
                {outcomes.size > 0 && (
                  <th
                    scope="col"
                    className="sticky right-0 border-b border-l border-gray-200 bg-white px-2 pb-2 pr-4 text-left align-bottom text-[11px] font-medium text-gray-600"
                  >
                    How it went
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {dir.runs.map((run) => {
                const past = isToday && run.last < nowMinutes
                const next = run === nextRun
                const outcome = outcomes.get(run.tripId)
                return (
                  <tr
                    key={run.tripId}
                    ref={next ? nextRowRef : undefined}
                    className={past ? 'text-gray-400' : next ? 'bg-amber-50 font-semibold' : ''}
                  >
                    {dir.columns.map((c) => {
                      const stop = run.cells.get(c.key)
                      const { arrival, dueAt } = isToday && stop ? arrivalAt(arrivals, stop, midnight) : {}
                      return (
                        <td
                          key={c.key}
                          title={
                            arrival &&
                            `Bus ${arrival.equipment_id} arrived ${formatClockAt(arrival.arrived_at)}, ${lateLabelAt(arrival.arrived_at, dueAt!)}`
                          }
                          className="border-b border-gray-100 px-2 py-1.5 whitespace-nowrap first:pl-4"
                        >
                          {stop ? formatGtfsTime(stop.departure_time) : <span className="text-gray-300">—</span>}
                        </td>
                      )
                    })}
                    {outcomes.size > 0 && (
                      <td
                        className={`sticky right-0 border-b border-l border-gray-100 px-2 py-1.5 pr-4 text-xs font-normal whitespace-nowrap ${next ? 'bg-amber-50' : 'bg-white'}`}
                      >
                        {outcome && (
                          <OutcomeLabel
                            outcome={outcome}
                            live={
                              outcome.kind !== 'skipped' &&
                              running.has(outcome.equipmentId) &&
                              (outcome.kind === 'started' || !outcome.done)
                            }
                            color={route.color}
                          />
                        )}
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function OutcomeLabel({ outcome, live, color }: { outcome: TripOutcome; live: boolean; color: string }) {
  if (outcome.kind === 'skipped') return <span className="text-gray-700 italic">skipped</span>
  return (
    <span className="inline-flex items-center gap-1.5 text-gray-700" title={`Bus ${outcome.equipmentId}`}>
      {live && <span className="size-2 animate-pulse rounded-full" style={{ background: color }} />}
      {outcome.kind === 'started' ? (live ? 'starting' : '—') : lateLabel(outcome.minutes)}
    </span>
  )
}

function StopHeader({ stopId, name, onSelect }: { stopId: string; name: string; onSelect: (stopId: string) => void }) {
  const { highlighted, ...hover } = useStopHover(stopId)
  return (
    <th
      {...hover}
      scope="col"
      className={`border-b border-gray-200 px-2 pt-1 pb-2 text-left align-bottom text-[11px] leading-tight font-medium first:pl-4 ${highlighted ? 'bg-gray-100 text-gray-900' : 'text-gray-600'}`}
    >
      <button type="button" onClick={() => onSelect(stopId)} className="text-left hover:text-gray-900 hover:underline">
        {name}
      </button>
    </th>
  )
}
