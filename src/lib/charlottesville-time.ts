const TIME_ZONE = 'America/New_York'

const partsFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  hourCycle: 'h23',
})

function charlottesvilleParts(at: number) {
  const parts = Object.fromEntries(partsFormat.formatToParts(at).map((p) => [p.type, p.value]))
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  }
}

export type ServiceDay = {
  // 0 is Monday, matching the weekday patterns of scheduled stops
  weekday: number
  label: string
  date: string
}

const weekdayName = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'long' })
const shortDate = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' })

// Today and the six days after it, in Charlottesville.
export function upcomingServiceDays(at: number): ServiceDay[] {
  const { year, month, day } = charlottesvilleParts(at)
  return Array.from({ length: 7 }, (_, i) => {
    // noon UTC keeps the calendar date stable across DST changes
    const date = new Date(Date.UTC(year, month - 1, day + i, 12))
    return {
      weekday: (date.getUTCDay() + 6) % 7,
      label: i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : weekdayName.format(date),
      date: shortDate.format(date),
    }
  })
}

export function charlottesvilleMinutes(at: number): number {
  return charlottesvilleParts(at).minutes
}

// GTFS times can pass 24:00:00 for service after midnight.
export function gtfsMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number)
  return hours * 60 + minutes
}

export function formatGtfsTime(time: string): string {
  return formatMinutes(gtfsMinutes(time))
}

export function formatClockAt(at: number): string {
  return formatMinutes(charlottesvilleMinutes(at))
}

export function formatMinutes(total: number): string {
  const hours = Math.floor(total / 60) % 24
  const minutes = String(total % 60).padStart(2, '0')
  return `${hours % 12 || 12}:${minutes}${hours < 12 ? 'a' : 'p'}`
}

// The feed vendor's clock times, like "10:41AM".
export function clockMinutes(clock: string): number {
  const match = /^(\d{1,2}):(\d{2})\s*([AP])M$/i.exec(clock.trim())
  if (!match) throw new Error(`not a clock time: ${clock}`)
  const hours = (Number(match[1]) % 12) + (match[3].toUpperCase() === 'P' ? 12 : 0)
  return hours * 60 + Number(match[2])
}

// The instant within twelve hours of `near` at which Charlottesville's clock
// reads `minutesOfDay`. Off by an hour across a DST change.
export function charlottesvilleClockNear(minutesOfDay: number, near: number): number {
  let delta = minutesOfDay - charlottesvilleMinutes(near)
  if (delta > 720) delta -= 1440
  if (delta < -720) delta += 1440
  return Math.floor(near / 60_000) * 60_000 + delta * 60_000
}

// Midnight in Charlottesville on the day of `at`. Off by an hour across a DST change.
export function charlottesvilleMidnight(at: number): number {
  return Math.floor(at / 60_000) * 60_000 - charlottesvilleMinutes(at) * 60_000
}

export const DAY_MS = 24 * 60 * 60 * 1000

export type ServiceDayStart = {
  // 0 is Monday, matching the weekday patterns of scheduled stops
  weekday: number
  // midnight in Charlottesville; off by an hour across a DST change
  start: number
}

// Yesterday, today and tomorrow in Charlottesville. Service runs past
// midnight, so a time near `at` can belong to yesterday's service day.
export function serviceDaysAround(at: number): ServiceDayStart[] {
  const { year, month, day, minutes } = charlottesvilleParts(at)
  const midnight = Math.floor(at / 60_000) * 60_000 - minutes * 60_000
  return [-1, 0, 1].map((offset) => ({
    weekday: (new Date(Date.UTC(year, month - 1, day + offset)).getUTCDay() + 6) % 7,
    start: midnight + offset * DAY_MS,
  }))
}

// When a GTFS time falls on the service day that began at `dayStart`.
export function scheduledInstant(dayStart: number, gtfsTime: string): number {
  return dayStart + gtfsMinutes(gtfsTime) * 60_000
}
