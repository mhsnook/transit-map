import { gtfsMinutes, serviceDaysAround } from '../lib/charlottesville-time'
import type { ScheduledStop } from './schedule'

// A later slot further than this from the arrival is never its matched slot.
const MAX_SLOT_DISTANCE_MS = 90 * 60_000
// A bus moves to a later slot than the feed vendor's when that slot is at
// most this long after the arrival, not when it is merely nearer: a bus 21
// minutes late on a 30-minute headway is nearer the next slot, but buses
// that early are much rarer than buses that late.
const EARLY_TOLERANCE_MS = 5 * 60_000

type Slot = { days: string; minutes: number; timepoint: boolean }
export type MatchedSlot = { slot_at: number; timepoint: boolean }

// Finds matched slots (see todays_arrivals in schema.ts), starting from the
// scheduled call the feed vendor assigned. Its direction is right even when
// its time is a whole headway off. A bus only ever moves to a later slot: one
// early for the vendor's call, like a bus waiting out a terminal layover,
// keeps it.
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

  match(call: { route: string; scheduleNumber: string; stopId: string; scheduledAt: number }, at: number): MatchedSlot {
    const direction = this.#directions.get(call.scheduleNumber)
    const slots = (direction != null && this.#slots.get(slotKey(call.route, direction, call.stopId))) || []
    let vendors: MatchedSlot = { slot_at: call.scheduledAt, timepoint: false }
    let latest: MatchedSlot | null = null
    for (const { start, weekday } of serviceDaysAround(at)) {
      for (const slot of slots) {
        if (slot.days[weekday] === '-') continue
        const slotAt = start + slot.minutes * 60_000
        if (slotAt === call.scheduledAt) vendors = { slot_at: slotAt, timepoint: slot.timepoint }
        if (slotAt <= call.scheduledAt || slotAt > at + EARLY_TOLERANCE_MS || at - slotAt > MAX_SLOT_DISTANCE_MS) continue
        if (!latest || slotAt > latest.slot_at) latest = { slot_at: slotAt, timepoint: slot.timepoint }
      }
    }
    return latest ?? vendors
  }
}

function slotKey(route: string, direction: number, stopId: string) {
  return `${route}|${direction}|${stopId}`
}
