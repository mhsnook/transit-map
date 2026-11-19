import { useLiveQuery } from '@tanstack/react-db'
import { useMemo } from 'react'
import type { ScheduledStop } from '../collector/schedule'
import { SlotIndex } from '../collector/slots'
import type { BusRoute, CurrentArrivalPrediction } from '../live/collections'
import { getLiveDb } from '../live/db'
import type { CurrentArrivalPredictionRow } from '../live/predictions'

// Adds the matched slot to arrival predictions from the feed vendor. Pass a
// bus stop's scheduled stops to match at that bus stop. Without them the
// timetable is used, which only has timepoints: elsewhere the slot is the
// feed vendor's scheduled time.
export function useSlotMatcher(routesById: Map<number, BusRoute>, scheduledStops?: ScheduledStop[]) {
  const live = getLiveDb()
  const { data: timetable } = useLiveQuery((q) => q.from({ t: live.timetableStops }))
  return useMemo(() => {
    const directions = new Map<string, number>()
    for (const t of timetable) if (t.schedule_number) directions.set(t.schedule_number, t.direction)
    const index = new SlotIndex(scheduledStops ?? timetable.map((t) => ({ ...t, timepoint: true })), directions)
    return (p: CurrentArrivalPredictionRow): CurrentArrivalPrediction => {
      // Bus routes are matched by short name: the JSON API's route ids are
      // not the GTFS feed's.
      const route = routesById.get(p.route_id)?.short_name
      const slot =
        route == null
          ? null
          : index.match({ route, scheduleNumber: p.schedule_number, stopId: p.stop_id, scheduledAt: p.scheduled_at }, p.predicted_at)
      return { ...p, slot_at: slot?.slot_at ?? null }
    }
  }, [timetable, scheduledStops, routesById])
}
