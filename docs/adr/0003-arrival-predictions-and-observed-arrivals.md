# 3. Arrival predictions and observed arrivals

Date: 2026-10-26. Part of [#7](https://github.com/mhsnook/transit-map/issues/7).

## Decision

- **Live arrival predictions come from `get_vehicles`**, which the collector already polls every 10 s. Its `minutesToNextStops` holds each transit vehicle's next five bus stops, rarely more than ten minutes out, at no extra traffic.
- **Longer lead times come from a `get_stop_etas` snapshot every ten minutes**, for every bus stop in one request with `noLimit=1`: ≈227 KB and ≈800 arrival predictions up to ≈80 minutes out (2026-10-26, afternoon). Without `noLimit` the feed vendor caps each bus stop at five, which at a hub reaches only about ten minutes out. The snapshot is skipped while no transit vehicle is running. At every 10 s this request would have been ≈1 GB a day, about four times the rest of the collector's traffic; every ten minutes it is ≈25 MB. The feed vendor does not compress responses. `get_stop_etas` takes `stopID` or `stopIDs`, `statusData` and `noLimit`; there is no lookahead parameter.
- **Arrival predictions and observed arrivals are made for a scheduled call**: schedule number, pattern stop and scheduled time. The pattern stop tells apart the two calls a route pattern makes at one bus stop; the scheduled time tells apart service days, since schedule numbers repeat daily.
- **`current_arrival_predictions` is a live collection** of the `get_vehicles` arrival predictions (≈100 rows), synced each tick, so browsers get them without asking the collector. Each row the sync inserts or changes is also written to `arrival_predictions` with `source = 'get_vehicles'` and `made_at` set to the poll time, so the newest row made before a moment is the prediction showing then; one served unchanged for many ticks is stored once. Every row of a `get_stop_etas` snapshot is written with `source = 'get_stop_etas'`; a gap between snapshots says nothing about what was showing. The feed vendor's clock times ("10:41AM") are resolved to the instant nearest its rounded `minutes`.
- **Prediction error is measured two ways.** At 1, 3 and 6 minutes out: the `get_vehicles` prediction showing at that moment. From 5 to 14 minutes out: each `get_stop_etas` snapshot taken that long before the observed arrival. Snapshots are ten minutes apart and the band is nine wide, so each arrival contributes at most one sample, at whatever lead it fell.
- **Each observed-arrival rule is recorded separately** in `observed_arrivals`, one row per scheduled call and rule, with the position fix's time and its distance to the bus stop:
  - `distance`: the first position fix within 30 m of the bus stop.
  - `at_stop`: the first position fix with `atStop` set and `lastPatternStopID` equal to the call's pattern stop. `atStop` refers to the last bus stop, not the next one (seen on 2026-10-26).
  - `passed`: the first position fix with `lastPatternStopID` equal to the call's pattern stop.

  The observed arrival is the earliest of them. With 10–15 s between position fixes, a transit vehicle that passes a bus stop without stopping is often never within 30 m of it: in the first ten minutes of recording, 35 of 105 observed arrivals fired only `passed`.
- **Matching runs in memory in the Collector.** A scheduled call is watched from its first arrival prediction until 20 minutes after its last. Only the transit vehicle the arrival prediction names can fire it, only within 15 minutes of the predicted time, and only while it is that vehicle's earliest call at that bus stop not yet `passed`.
- **Position fixes keep `last_stop_id` and `last_pattern_stop_id`**, so observed arrivals can be derived again from `position_fixes` under other rules.
- **Retention.** Both tables join the hourly 14-day delete.
- **The stop view reads through RPC, not party-db.** The Collector's `stopSchedule` and `stopHistory` methods are called by TanStack Start server functions from the `/` route's loader when `?stop=` is set. The loader doesn't await them, so a bus stop opens on its live arrival predictions while the schedule and history load. History loads whether or not it is shown.

## Consequences

- Terminal layovers are not handled yet. During a layover the transit vehicle is already within 30 m of the next scheduled trip's first bus stop, so that call's observed arrival is when the layover started, minutes before the scheduled departure. At hubs like Downtown Transit Station this shows up as buses arriving early. Recording departures belongs with the terminal layover decision in #7.
- The collector makes one more request to the feed vendor every ten minutes during service. A snapshot writes ≈800 rows, ≈90,000 a day.
- The stop view's live arrival predictions reach only each transit vehicle's next five bus stops. Further out it shows the schedule.
- After a collector restart, rules can fire again for calls already observed; the primary key keeps those from adding rows.
- An arrival prediction that never resolves shows up as a scheduled call with arrival predictions and no observed arrival. It is not recorded on its own.
- Predicted times are whole minutes, so prediction error carries up to ±30 s of rounding.
