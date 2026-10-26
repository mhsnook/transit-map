# 3. Arrival predictions and observed arrivals

Date: 2026-10-26. Part of [#7](https://github.com/mhsnook/transit-map/issues/7).

## Decision

- **Arrival predictions come from `get_stop_etas`, for every bus stop in one request per tick.** All 315 bus stops fit in one request (≈165 KB, 0.2–0.7 s). It returns up to five arrival predictions per bus stop, up to ≈75 minutes ahead, which is what the vendor site shows for a bus stop. `minutesToNextStops` in `get_vehicles` covers only each transit vehicle's next five bus stops (≈10 minutes), so it is not used.
- **Arrival predictions and observed arrivals are made for a scheduled call**: schedule number, pattern stop and scheduled time. The pattern stop tells apart the two calls a route pattern makes at one bus stop; the scheduled time tells apart service days, since schedule numbers repeat daily.
- **`current_arrival_predictions` is a live collection** (≈600 rows), synced each tick, so browsers get arrival predictions without asking the collector. Each row the sync inserts or changes is also written to `arrival_predictions` with `made_at` set to the poll time. An arrival prediction served unchanged for many ticks is stored once. The feed vendor's clock times ("10:41AM") are resolved to the instant nearest its rounded `minutes`.
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
- The collector makes one more request to the feed vendor every 10 s.
- After a collector restart, rules can fire again for calls already observed; the primary key keeps those from adding rows.
- An arrival prediction that never resolves shows up as a scheduled call with arrival predictions and no observed arrival. It is not recorded on its own.
- Predicted times are whole minutes, so prediction error carries up to ±30 s of rounding.
