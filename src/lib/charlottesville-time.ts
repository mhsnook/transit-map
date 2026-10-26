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
  const total = gtfsMinutes(time)
  const hours = Math.floor(total / 60) % 24
  const minutes = String(total % 60).padStart(2, '0')
  return `${hours % 12 || 12}:${minutes}${hours < 12 ? 'a' : 'p'}`
}
