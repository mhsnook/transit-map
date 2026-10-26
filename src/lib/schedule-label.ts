// The feed vendor's schedule deviation, in minutes; negative is late.
export function scheduleLabel(minutes: number | null): string {
  if (minutes == null) return 'no schedule'
  if (minutes === 0) return 'on time'
  return minutes < 0 ? `${-minutes} min late` : `${minutes} min early`
}

// Minutes after a matched slot; negative is early. Unlike the feed vendor's
// deviation, this is measured against when a bus was due, not its block's trip.
export function lateLabel(minutes: number): string {
  if (minutes === 0) return 'on time'
  return minutes > 0 ? `${minutes}m late` : `${-minutes}m early`
}

export function minutesLate(arrivedAt: number, slotAt: number): number {
  return Math.round((arrivedAt - slotAt) / 60_000)
}
