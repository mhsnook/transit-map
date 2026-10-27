// Minutes after the time a bus was due; negative is early.
export function lateLabel(minutes: number): string {
  if (minutes === 0) return 'on time'
  return minutes > 0 ? `${minutes}m late` : `${-minutes}m early`
}

export function minutesLate(arrivedAt: number, dueAt: number): number {
  return Math.round((arrivedAt - dueAt) / 60_000)
}

export function lateLabelAt(arrivedAt: number, dueAt: number): string {
  return lateLabel(minutesLate(arrivedAt, dueAt))
}

// The feed vendor's deviation, against its block's scheduled trip rather than
// a matched slot; in minutes, negative is late.
export function vendorScheduleLabel(minutes: number | null): string {
  return minutes == null ? 'no schedule' : lateLabel(-minutes)
}
