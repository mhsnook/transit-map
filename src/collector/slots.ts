import { gtfsMinutes, serviceDaysAround } from '../lib/charlottesville-time'
import type { ScheduledStop } from './schedule'

// Further than this from any scheduled time, an arrival has no matched slot.
export const MAX_SLOT_DISTANCE_MS = 90 * 60_000
// The matched slot is the latest scheduled time up to this long after the
// arrival, not the nearest: a bus 21 minutes late on a 30-minute headway is
// nearer the next slot, but buses this early are much rarer than buses that
// late. A bus a whole headway late, less this, moves to the next slot.
const EARLY_TOLERANCE_MS = 5 * 60_000

type Slot = { days: string; minutes: number; timepoint: boolean }
export type MatchedSlot = { slot_at: number; timepoint: boolean }

// Finds matched slots (see todays_arrivals in schema.ts). Direction comes from
// the scheduled trip the feed vendor assigned, which is right even when its
// time is a whole headway off.
export class SlotIndex {
  #slots = new Map<string, Slot[]>()
  #directions: Map<string, number>

  constructor(scheduledStops: ScheduledStop[], directions: Map<string, number>) {
    this.#directions = directions
    for (const s of scheduledStops) {
      const key = slotKey(s.route, s.direction, s.stop_id)
      const list = this.#slots.get(key) ?? []
      list.push({ days: s.days, minutes: gtfsMinutes(s.arrival_time), timepoint: s.timepoint })
      this.#slots.set(key, list)
    }
  }

  match(route: string, scheduleNumber: string, stopId: string, at: number): MatchedSlot | null {
    const direction = this.#directions.get(scheduleNumber)
    const slots = direction == null ? undefined : this.#slots.get(slotKey(route, direction, stopId))
    if (!slots) return null
    let latest: MatchedSlot | null = null
    // only when no slot qualifies as latest: a bus more than EARLY_TOLERANCE_MS early
    let earliest: MatchedSlot | null = null
    for (const { start, weekday } of serviceDaysAround(at)) {
      for (const slot of slots) {
        if (slot.days[weekday] === '-') continue
        const slotAt = start + slot.minutes * 60_000
        if (Math.abs(slotAt - at) > MAX_SLOT_DISTANCE_MS) continue
        const matched = { slot_at: slotAt, timepoint: slot.timepoint }
        if (slotAt <= at + EARLY_TOLERANCE_MS) {
          if (!latest || slotAt > latest.slot_at) latest = matched
        } else if (!earliest || slotAt < earliest.slot_at) {
          earliest = matched
        }
      }
    }
    return latest ?? earliest
  }
}

function slotKey(route: string, direction: number, stopId: string) {
  return `${route}|${direction}|${stopId}`
}
