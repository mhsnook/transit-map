import { useMemo, useState } from 'react'
import type { ScheduledCallHistory } from '../collector/stop-details'
import type { BusRoute } from '../live/collections'
import { charlottesvilleMinutes, formatClockAt, formatMinutes } from '../lib/charlottesville-time'
import { RouteChip } from './RouteChip'

const LEADS = [1, 3, 6, 10] as const
type Lead = (typeof LEADS)[number]
// A scheduled call predicted this recently may still arrive.
const UNRESOLVED_AFTER_MS = 30 * 60_000
const TABLE_PAGE = 30
const SERIES = '#2a78d6'

const dayFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  weekday: 'short',
  month: 'short',
  day: 'numeric',
})

type Observed = {
  call: ScheduledCallHistory
  arrivedAt: number
  // the arrival prediction in force `lead` minutes before the observed arrival
  predictedAt: Map<Lead, number>
}

function observe(call: ScheduledCallHistory): Observed | null {
  if (call.arrivals.length === 0) return null
  const arrivedAt = Math.min(...call.arrivals.map((a) => a.arrived_at))
  const predictedAt = new Map<Lead, number>()
  for (const lead of LEADS) {
    const madeBy = arrivedAt - lead * 60_000
    // predictions are oldest first
    let inForce: number | undefined
    for (const p of call.predictions) if (p.made_at <= madeBy) inForce = p.predicted_at
    if (inForce != null) predictedAt.set(lead, inForce)
  }
  return { call, arrivedAt, predictedAt }
}

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

const minutesBetween = (later: number, earlier: number) => (later - earlier) / 60_000

function signedMinutes(minutes: number): string {
  const rounded = Math.round(minutes * 10) / 10
  if (rounded === 0) return '0 min'
  return `${rounded > 0 ? '+' : '−'}${Math.abs(rounded)} min`
}

export function StopHistory({
  calls,
  routesById,
  now,
}: {
  calls: ScheduledCallHistory[]
  routesById: Map<number, BusRoute>
  now: number
}) {
  const observed = useMemo(() => calls.map(observe).filter((o) => o != null), [calls])
  const unresolved = calls.filter(
    (c) => c.arrivals.length === 0 && c.predictions.length > 0 && c.predictions.at(-1)!.made_at < now - UNRESOLVED_AFTER_MS,
  ).length

  if (calls.length === 0) {
    return (
      <p className="py-4 text-sm text-gray-500">
        Nothing recorded at this bus stop yet. Arrival predictions and arrivals are kept for 14 days from when the
        collector started recording them.
      </p>
    )
  }

  const lateness = observed.map((o) => minutesBetween(o.arrivedAt, o.call.scheduled_at))
  const onTime = lateness.filter((m) => m >= -1 && m <= 5).length
  const medianLate = median(lateness)
  const since = calls[0].scheduled_at

  return (
    <div className="space-y-4 pt-3 text-sm">
      <p className="text-xs text-gray-500">
        {observed.length} observed arrivals since {dayFormat.format(since)}
        {unresolved > 0 && `; ${unresolved} predicted calls with no observed arrival`}.
      </p>

      {observed.length > 0 && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <StatTile
              label="Median vs schedule"
              value={medianLate == null ? '—' : signedMinutes(medianLate)}
              note="+ is late"
            />
            <StatTile
              label="On time"
              value={`${Math.round((onTime / observed.length) * 100)}%`}
              note="1 min early to 5 min late"
            />
          </div>
          <LatenessChart observed={observed} routesById={routesById} />
          <PredictionErrors observed={observed} />
          <ArrivalTable observed={observed} routesById={routesById} />
        </>
      )}
    </div>
  )
}

function StatTile({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="rounded-lg bg-gray-50 px-3 py-2">
      <p className="text-xs text-gray-600">{label}</p>
      <p className="text-lg font-semibold">{value}</p>
      <p className="text-[11px] text-gray-500">{note}</p>
    </div>
  )
}

// Prediction error: the arrival prediction in force `lead` minutes before the
// observed arrival, minus the observed arrival. Positive: the bus came early.
function PredictionErrors({ observed }: { observed: Observed[] }) {
  return (
    <div>
      <h3 className="text-xs font-medium tracking-wide text-gray-500 uppercase">Prediction error</h3>
      <p className="mt-0.5 text-xs text-gray-500">
        How far the prediction shown some minutes before the bus arrived was from when it did. + means the bus came
        sooner than predicted.
      </p>
      <table className="mt-2 w-full text-left tabular-nums">
        <thead className="text-xs text-gray-500">
          <tr>
            <th className="py-1 font-medium">Shown</th>
            <th className="py-1 font-medium">Median</th>
            <th className="py-1 font-medium">Within 1 min</th>
            <th className="py-1 text-right font-medium">Arrivals</th>
          </tr>
        </thead>
        <tbody>
          {LEADS.map((lead) => {
            const errors = observed
              .filter((o) => o.predictedAt.has(lead))
              .map((o) => minutesBetween(o.predictedAt.get(lead)!, o.arrivedAt))
            const m = median(errors)
            const within = errors.filter((e) => Math.abs(e) <= 1).length
            return (
              <tr key={lead} className="border-t border-gray-100">
                <td className="py-1.5">{lead} min before</td>
                <td className="py-1.5">{m == null ? '—' : signedMinutes(m)}</td>
                <td className="py-1.5">{errors.length ? `${Math.round((within / errors.length) * 100)}%` : '—'}</td>
                <td className="py-1.5 text-right text-gray-500">{errors.length}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

const W = 360
const H = 170
const PAD = { top: 10, right: 8, bottom: 22, left: 30 }

// Minutes late at each observed arrival, by scheduled time of day, all days overlaid.
function LatenessChart({ observed, routesById }: { observed: Observed[]; routesById: Map<number, BusRoute> }) {
  const [hovered, setHovered] = useState<number | null>(null)
  const points = observed.map((o) => ({
    o,
    x: charlottesvilleMinutes(o.call.scheduled_at),
    y: minutesBetween(o.arrivedAt, o.call.scheduled_at),
  }))

  const xMin = Math.floor(Math.min(...points.map((p) => p.x)) / 120) * 120
  const xMax = Math.max(xMin + 120, Math.ceil(Math.max(...points.map((p) => p.x)) / 120) * 120)
  const yMin = Math.min(-2, Math.floor(Math.min(...points.map((p) => p.y))))
  const yMax = Math.max(5, Math.ceil(Math.max(...points.map((p) => p.y))))
  const sx = (x: number) => PAD.left + ((x - xMin) / (xMax - xMin)) * (W - PAD.left - PAD.right)
  const sy = (y: number) => PAD.top + ((yMax - y) / (yMax - yMin)) * (H - PAD.top - PAD.bottom)

  const yStep = niceStep((yMax - yMin) / 4)
  const yTicks: number[] = []
  for (let t = Math.ceil(yMin / yStep) * yStep; t <= yMax; t += yStep) yTicks.push(t)
  const xStep = xMax - xMin > 720 ? 240 : 120
  const xTicks: number[] = []
  for (let t = xMin; t <= xMax; t += xStep) xTicks.push(t)

  const active = hovered == null ? null : points[hovered]

  return (
    <figure>
      <figcaption className="text-xs font-medium tracking-wide text-gray-500 uppercase">
        Minutes late, by time of day
      </figcaption>
      <div className="relative mt-1">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Minutes late at each observed arrival">
          {yTicks.map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={W - PAD.right} y1={sy(t)} y2={sy(t)} stroke={t === 0 ? '#9ca3af' : '#eceae6'} />
              <text x={PAD.left - 4} y={sy(t)} dy="0.32em" textAnchor="end" fontSize="10" fill="#52514e">
                {t > 0 ? `+${t}` : t}
              </text>
            </g>
          ))}
          {xTicks.map((t) => (
            <text key={t} x={sx(t)} y={H - 6} textAnchor="middle" fontSize="10" fill="#52514e">
              {formatMinutes(t).replace(':00', '')}
            </text>
          ))}
          {points.map((p, i) => (
            <g key={i}>
              <circle
                cx={sx(p.x)}
                cy={sy(p.y)}
                r={i === hovered ? 5.5 : 4}
                fill={SERIES}
                fillOpacity={hovered == null || i === hovered ? 0.85 : 0.35}
                stroke="#fcfcfb"
                strokeWidth={2}
              />
              <circle
                cx={sx(p.x)}
                cy={sy(p.y)}
                r={12}
                fill="transparent"
                tabIndex={0}
                aria-label={`${dayFormat.format(p.o.call.scheduled_at)} ${formatClockAt(p.o.call.scheduled_at)}: ${signedMinutes(p.y)}`}
                onPointerEnter={() => setHovered(i)}
                onPointerLeave={() => setHovered(null)}
                onFocus={() => setHovered(i)}
                onBlur={() => setHovered(null)}
                className="outline-none"
              />
            </g>
          ))}
        </svg>
        {active && (
          <div
            className="pointer-events-none absolute z-10 w-max -translate-x-1/2 -translate-y-full rounded-md bg-white px-2 py-1 text-xs shadow-md ring-1 ring-gray-200"
            style={{ left: `${(sx(active.x) / W) * 100}%`, top: `${(sy(active.y) / H) * 100}%`, marginTop: -10 }}
          >
            <p className="font-semibold tabular-nums">{signedMinutes(active.y)}</p>
            <p className="text-gray-600">
              {routesById.get(active.o.call.route_id)?.short_name ?? '?'} · {dayFormat.format(active.o.call.scheduled_at)}{' '}
              · {formatClockAt(active.o.call.scheduled_at)} scheduled
            </p>
          </div>
        )}
      </div>
    </figure>
  )
}

function niceStep(raw: number): number {
  for (const step of [1, 2, 5, 10, 15, 30, 60]) if (step >= raw) return step
  return 60
}

function ArrivalTable({ observed, routesById }: { observed: Observed[]; routesById: Map<number, BusRoute> }) {
  const [lead, setLead] = useState<Lead>(3)
  const [shown, setShown] = useState(TABLE_PAGE)
  const newestFirst = useMemo(() => [...observed].reverse(), [observed])

  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-xs font-medium tracking-wide text-gray-500 uppercase">Arrivals</h3>
        <label className="text-xs text-gray-600">
          Prediction shown{' '}
          <select
            value={lead}
            onChange={(e) => setLead(Number(e.target.value) as Lead)}
            className="rounded border border-gray-300 bg-white px-1 py-0.5"
          >
            {LEADS.map((l) => (
              <option key={l} value={l}>
                {l} min
              </option>
            ))}
          </select>{' '}
          before
        </label>
      </div>
      <table className="mt-2 w-full text-left text-xs tabular-nums">
        <thead className="text-gray-500">
          <tr>
            <th className="py-1 font-medium">Day</th>
            <th className="py-1 font-medium" aria-label="Bus route" />
            <th className="py-1 font-medium">Scheduled</th>
            <th className="py-1 font-medium">Predicted</th>
            <th className="py-1 font-medium">Arrived</th>
            <th className="py-1 text-right font-medium">Late</th>
          </tr>
        </thead>
        <tbody>
          {newestFirst.slice(0, shown).map((o) => {
            const predicted = o.predictedAt.get(lead)
            return (
              <tr
                key={`${o.call.schedule_number}:${o.call.pattern_stop_id}:${o.call.scheduled_at}`}
                className="border-t border-gray-100"
              >
                <td className="py-1.5 whitespace-nowrap">{dayFormat.format(o.call.scheduled_at)}</td>
                <td className="py-1.5">
                  <RouteChip route={routesById.get(o.call.route_id)} size="xs" />
                </td>
                <td className="py-1.5">{formatClockAt(o.call.scheduled_at)}</td>
                <td className="py-1.5">{predicted == null ? '—' : formatClockAt(predicted)}</td>
                <td className="py-1.5" title={o.call.arrivals.map((a) => a.rule).join(', ')}>
                  {formatClockAt(o.arrivedAt)}
                </td>
                <td className="py-1.5 text-right">{signedMinutes(minutesBetween(o.arrivedAt, o.call.scheduled_at))}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {shown < newestFirst.length && (
        <button
          type="button"
          onClick={() => setShown(shown + TABLE_PAGE)}
          className="mt-2 w-full rounded-lg border border-gray-200 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
        >
          Show more
        </button>
      )}
    </div>
  )
}
