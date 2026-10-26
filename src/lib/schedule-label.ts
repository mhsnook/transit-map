// The feed vendor's schedule deviation, in minutes; negative is late.
export function scheduleLabel(minutes: number | null): string {
  if (minutes == null) return 'no schedule'
  if (minutes === 0) return 'on time'
  return minutes < 0 ? `${-minutes} min late` : `${minutes} min early`
}
