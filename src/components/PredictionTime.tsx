import { formatClockAt } from '../lib/charlottesville-time'
import { lateLabelAt } from '../lib/schedule-label'

// Minutes away, then the predicted time and its lateness against `dueAt`.
export function PredictionTime({ predictedAt, dueAt, now }: { predictedAt: number; dueAt: number | null; now: number }) {
  const away = Math.round((predictedAt - now) / 60_000)
  return (
    <span className="shrink-0 text-right tabular-nums">
      <span className="flex items-center justify-end gap-1.5 font-semibold">
        <span aria-hidden className="size-2 animate-pulse rounded-full bg-emerald-500" />
        {away <= 0 ? 'Due' : `${away} min`}
      </span>
      <span className="block text-xs text-gray-500">
        {formatClockAt(predictedAt)}
        {dueAt != null && ` · ${lateLabelAt(predictedAt, dueAt)}`}
      </span>
    </span>
  )
}
