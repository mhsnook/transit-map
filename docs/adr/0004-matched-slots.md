# 4. Matched slots

Date: 2026-10-26.

## Context

The feed vendor keeps each transit vehicle on its block's scheduled trip. When a bus falls a whole headway behind, or two buses on a bus route swap slots, the feed vendor reports it that many minutes late, while a bus still passes each bus stop near its scheduled time. On 2026-10-26 at 4:43p, route 4's buses 212 and 213 were reported 33 and 29 minutes late. Each was within 3 minutes of the other's slot.

## Decision

- **Lateness is measured against the matched slot**: the scheduled time at the bus stop, for the bus route and direction, that an arrival served. The direction comes from the scheduled trip the feed vendor assigned (its schedule number is the GTFS `trip_short_name`, which never spans two directions), and the time from the scheduled stops.
- **The matched slot starts as the feed vendor's scheduled time and only ever moves later**: to the latest scheduled time up to 5 minutes after the arrival, when that is later than the vendor's. Not the nearest one: a bus 21 minutes late on a 30-minute headway is nearer the next slot, but buses run that late far more often than 9 minutes early. So a bus moves to the next slot once it is more than a headway, less 5 minutes, behind. A bus early for the vendor's scheduled call keeps it; most of those are waiting out a terminal layover at their next trip's first stop, and moving them back a slot read them as nearly a headway late.
- **`todays_arrivals` is a live collection** of each scheduled call's observed arrival (its earliest rule) with its matched slot: timepoints for 20 hours, other bus stops for 2 hours. It feeds the timetable, the bus view and the bus list. `current_arrival_predictions` and `observed_arrivals` carry the matched slot too, so the stop view's upcoming list and history measure against it.
- **Each trip in today's timetable gets an outcome**: its lateness at the last timepoint a bus reached, or "skipped". The trip's first timepoint is left out of the lateness, since a bus waits out its terminal layover there. A trip no bus reached is skipped only when trips before and after it in the same direction were reached, so trips from before recording started are not marked skipped.
- **Observed departures** are recorded for each observed arrival: the first position fix at which the transit vehicle is more than 50 m from the bus stop, or 30 m further than where it arrived, and the feed vendor no longer has it at that stop. `observed_departures` keeps the departure and the last fix still at the stop, and `todays_arrivals` gets `departed_at`. A transit vehicle only seen past a bus stop departs at its arrival. At the first stop of a trip the bus view compares the departure with the matched slot, since a bus there early is waiting out a layover.
- **`timetable_stops` keeps the schedule number**, so the collector can tell a schedule number's direction. A timetable stored before this is refetched once.

## Consequences

- A bus more than a headway (less 5 minutes) late reads as a few minutes late for the next trip, with the trip before it skipped. That is what a rider at the stop sees; the feed vendor's number stays visible in the bus view.
- A collector outage in the middle of the day makes the trips it missed look skipped.
- Arrival predictions and prediction error still use the feed vendor's scheduled call, since a prediction and its observed arrival share it.
