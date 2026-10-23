# Characterize the lag riders see

Resolves wayfinder ticket #3. Question: when the vendor site shows a transit vehicle minutes from where it is, is the delay in the data (old position fixes, wrong arrival predictions) or in the display (client-side animation)?

Sample: Friday 2026-10-23, 10:59:28 to 11:39:18 US Eastern (39.8 min), 240 ticks 10 s apart, 17 transit vehicles in service throughout, both sources fetched on every tick with no errors.

## Answer in short

- **Position staleness is seconds, not minutes.** The JSON API served position fixes that were a median 11.2 s old (p90 18.2 s, max 42.2 s). No transit vehicle went more than 45 s between fixes; there were zero gaps over 60 s and zero over 300 s across 2,795 fix intervals. The GTFS-RT feed is about 19 s further behind (median 30.2 s, max 72.2 s) because the file is rebuilt every ~30 s.
- **Datasource divergence is a time offset, not a position disagreement.** Matched by `equipmentID` = GTFS-RT `vehicle.id` (100% of rows). For the same fix time the two sources are 0.2 m apart (max 8.6 m). Compared at the same fetch instant they are a median 20 m apart (p90 214 m, max 949 m) purely because the GTFS-RT fix is a median 16 s older (max 65 s).
- **Arrival predictions are rough.** For 210 in-trip observed arrivals, `nextStopETA` 1 min before arrival was off by more than 60 s in 39% of cases (median +14 s, p10 −58 s, p90 +174 s). At 6 min out the prediction ran optimistic: median −65 s, 25% off by more than 3 min.
- **"6 minutes" for a bus that is already at the stop is in the data, and it is a terminal layover.** While a transit vehicle dwells at a terminal between trips the JSON API already carries the next scheduled trip, names the terminal it is sitting at as `nextStopID`, and sets `nextStopETA` to that trip's scheduled departure. The vendor site renders that as "N mins" to a stop the bus is already at. Ten such arrivals held for 60–530 s (median 10 s for all arrivals; p90 140 s). During the layover `seq`, `atStop` and `nextStopPctProg` are null and `lastStopID` is 0.
- **No in-service transit vehicle's fixes stopped.** All 17 appeared in every tick (one missed a single tick), all with `inService = 1`, and the newest fix was never more than 45 s old.
- **Display adds tens of seconds, not minutes.** The vendor site polls every 8 s and tweens each marker between its two most recent fixes at about real-time speed, so the drawn position trails the newest fix by roughly one fix interval (15 s) plus poll latency (0–8 s) plus position staleness (11 s): about 25–45 s, matching the earlier 90 s sample.

Verdict: neither the data nor the display explains a transit vehicle drawn *minutes* behind its true position; the worst case we measured is about 45 s of position staleness plus about 30 s of display tweening. The arrival-prediction complaints are explained by the data: terminal layovers are shown as arrivals at the stop the bus is sitting at, and ordinary 6-minute-out predictions are optimistic by a minute at the median and by more than 3 min a quarter of the time.

## Position staleness

Position staleness = fetch wall time − `receiveTime` (JSON API) or − `vehicle.timestamp` (GTFS-RT feed). Wall clock agreed with the JSON API's HTTP `Date` header to +0.2 s.

JSON API, all transit vehicles pooled (4,079 vehicle-samples): median 11.2 s, p90 18.2 s, p99 29.2 s, max 42.2 s. Share over 60 s: 0.0%. Share over 300 s: 0.0%.

Fix intervals (gap between consecutive distinct `receiveTime` values per transit vehicle, 2,795 intervals): median 15 s, p90 19 s, max 45 s. Gaps > 60 s: 0. Gaps > 300 s: 0.

Per transit vehicle (JSON API; full table in `data/lag-staleness-per-vehicle.csv`):

| equipmentID | ticks | fixes | staleness median | p90 | max | gaps >60 s | gaps >300 s | longest gap |
|---|---|---|---|---|---|---|---|---|
| 101 | 240 | 161 | 10.2 | 19.2 | 33.2 | 0 | 0 | 34 |
| 105 | 240 | 172 | 11.2 | 19.2 | 32.2 | 0 | 0 | 37 |
| 107 | 240 | 164 | 11.2 | 17.2 | 32.2 | 0 | 0 | 35 |
| 114 | 240 | 168 | 10.2 | 18.2 | 32.2 | 0 | 0 | 32 |
| 117 | 240 | 168 | 10.2 | 18.2 | 30.2 | 0 | 0 | 39 |
| 118 | 240 | 158 | 11.2 | 17.2 | 41.2 | 0 | 0 | 45 |
| 120 | 240 | 158 | 11.2 | 19.2 | 42.2 | 0 | 0 | 42 |
| 121 | 240 | 164 | 10.2 | 19.2 | 30.2 | 0 | 0 | 32 |
| 122 | 240 | 157 | 11.2 | 19.2 | 32.2 | 0 | 0 | 36 |
| 123 | 240 | 160 | 12.2 | 19.2 | 32.2 | 0 | 0 | 30 |
| 124 | 240 | 172 | 10.2 | 17.2 | 30.2 | 0 | 0 | 30 |
| 126 | 239 | 172 | 10.2 | 17.2 | 32.2 | 0 | 0 | 31 |
| 200 | 240 | 169 | 10.2 | 18.2 | 29.2 | 0 | 0 | 30 |
| 206 | 240 | 169 | 10.2 | 18.2 | 42.2 | 0 | 0 | 42 |
| 210 | 240 | 164 | 10.2 | 19.2 | 33.2 | 0 | 0 | 30 |
| 213 | 240 | 162 | 11.2 | 18.3 | 31.2 | 0 | 0 | 31 |
| 401 | 240 | 174 | 10.2 | 18.2 | 32.2 | 0 | 0 | 33 |

All seconds. Every transit vehicle reported a fix every ~15 s and the JSON API served it within about 10 s on average.

GTFS-RT feed, pooled (4,080 vehicle-samples): `vehicle.timestamp` age median 30.2 s, p90 43.2 s, max 72.2 s. `header.timestamp` age median 22.2 s, max 32.2 s. S3 `Last-Modified` age median 13.7 s, max 25.2 s. Only 81 distinct files (by ETag) were seen across 240 fetches, so the feed was regenerated about every 30 s during this sample, not every 15 s as API-NOTES.md observed earlier in the day.

## Datasource divergence

Datasource divergence = distance between the JSON API and GTFS-RT positions for the same transit vehicle, and the difference between their fix times.

Matching: three keys were tried on every tick.

| key | matched / 4,079 JSON rows |
|---|---|
| `equipmentID` = GTFS-RT `vehicle.id` | 4,079 (100%) |
| `scheduleNumber` = GTFS-RT `vehicle.label` | 4,036 |
| `tripID` = GTFS-RT `trip.trip_id` | 4,036 |

`equipmentID` ↔ `vehicle.id` is the reliable key. All 43 label misses were also trip misses and occur at trip rollover: the JSON API switches to the next scheduled trip (and its `scheduleNumber`) one or two ticks before the GTFS-RT file does.

Same fetch tick (4,079 pairs): distance median 20 m, p90 214 m, max 949 m. Fix time, JSON minus GTFS-RT: median +16 s, p90 +32 s, max +65 s; the JSON fix was newer in 85% of rows and identical in 15%.

Same fix time, matched across ticks (1,308 distinct fixes): distance median 0.2 m, p90 0.3 m, max 8.6 m. The two sources publish the same position fix; the meters of divergence at any instant are the bus moving during the 16–65 s by which the GTFS-RT feed lags.

## Prediction error

Observed arrival = the first position fix within 30 m of a bus stop that the JSON API listed as the transit vehicle's `nextStopID`, `lastStopID`, or one of the next three stops in `minutesToNextStops`. Stop coordinates from `get_stops`. 227 observed arrivals: 210 in-trip, 17 at a terminal layover (the JSON API showed `seq` null or `lastStopID` 0 within 90 s after the arrival fix).

For each arrival the arrival prediction made 1, 3 and 6 min earlier was taken from the sample nearest that time (within ±6 s): `nextStopETA` (minutes past local midnight) when the stop was `nextStopID`, otherwise `minutes` from `minutesToNextStops`. Prediction error = predicted − observed arrival; positive means the vendor said the bus would arrive later than it did. Both fields are whole minutes, so individual errors carry ±30 s of quantization.

In-trip arrivals:

| lookback | n | median | mean | p10 | p90 | abs error > 60 s | abs error > 180 s |
|---|---|---|---|---|---|---|---|
| 1 min | 192 | +14 s | +35 s | −58 s | +174 s | 39% | 7% |
| 3 min | 130 | −2 s | −15 s | −125 s | +120 s | 54% | 6% |
| 6 min | 56 | −65 s | −103 s | −240 s | +3 s | 66% | 25% |

Terminal-layover arrivals (14 / 10 / 2 at the three lookbacks) look similar at 1 and 3 min, but the number that matters for them is below.

Selection caveat: a stop only has a 6-min-earlier prediction if it was already among the next three stops 6 min before arrival, which favours slow approaches and makes the 6-min row look worse than a random stop would. Treat the 6-min line as "when the bus is close but slow, the prediction is optimistic by about a minute."

At the arrival fix itself, `nextStopETA` for the stop the bus had just reached was a median −3 s (that is, correct) but p90 +368 s and max +828 s ahead of the observed arrival (n=71). Those tails are the layover cases:

| equipmentID | bus stop | arrived | `nextStopID` kept naming it for | ETA shown | scheduled |
|---|---|---|---|---|---|
| 118 | Downtown Transit Station | 11:01:12 | 530 s | 11:15 | 11:15 |
| 120 | Walmart | 10:59:21 | 450 s | 11:12 | 11:12 |
| 114 | Downtown Transit Station | 11:04:32 | 340 s | 11:15 | 11:15 |
| 210 | Downtown Transit Station | 11:19:42 | 320 s | 11:30 | 11:30 |
| 213 | Downtown Transit Station | 11:05:31 | 280 s | 11:15 | 11:15 |
| 107 | Downtown Transit Station | 11:05:36 | 270 s | 11:15 | 11:15 |
| 123 | Walmart | 11:34:23 | 150 s | 11:42 | 11:42 |
| 126 | Rio Rd at Glen Wood Station | 11:11:41 | 140 s | 11:15 | 11:15 |
| 124 | Downtown Transit Station | 11:23:52 | 70 s | 11:30 | 11:30 |
| 107 | Sentara Martha Jefferson Hospital | 11:38:16 | 60 s | 11:40 | 11:40 |

Worked example, transit vehicle 118: within 30 m of Downtown Transit Station from 11:01:12 and stationary at 38.02891, −78.47748 for the next ten minutes. From 11:01 the JSON API reported `tripID` 28010, `scheduleNumber` 11:15:00-4, `nextStopID` 17333 (the station it was sitting at), `nextStopETA` 675 (= 11:15), `minutesToNextStops[0].minutes` counting down 14, 13, … 5, with `lastStopID` 0, `seq` null, `atStop` null, `nextStopPctProg` null, `onSchedule` 0. At 11:10:28, still stationary, it flipped to `lastStopID` 17333, `nextStopID` 11015, `nextStopETA` 676, `atStop` 1. A rider looking at the site saw "14 mins" shrinking to "5 mins" for a bus parked at the stop. This is the vendor's arrival prediction for the *next trip's departure*, served in the field the site labels as the next arrival.

Within-trip dwell is not the cause: `atStop` was 1 at only 108 of 227 arrival fixes, and across all arrivals `nextStopID` moved on a median 10 s after the fix within 30 m.

## In-service transit vehicles whose fixes stopped

None. Each of the 17 transit vehicles was served in 239 or 240 of 240 ticks with `inService = 1` throughout. The longest run without a new fix was 45 s (equipmentID 118). At the last tick, every vehicle's newest fix was 4–18 s old (`last_fix_before_last_seen_s` in `data/lag-staleness-per-vehicle.csv`).

## Display side

From the vendor site's page source (`https://catpublic.etaspot.net/`, fetched during the sample):

- Line 727–728: `vehiclePollingIntervalMs = 8000`, so the client refetches `get_vehicles` every 8 s.
- `moveAsset()` (lines 1047–1230) keeps a queue of position fixes per transit vehicle and lerps the marker from fix *i* to fix *i+1*, advancing 260 ms of fix time every 250 ms (≈1.04× real time). It only speeds up when the queue spans more than 10 s and only drops fixes when it spans more than 60 s.

So the marker is always drawn somewhere between the previous fix and the newest one, and it reaches the newest fix roughly one fix interval after the client received it. Expected drawn-position age ≈ position staleness (11 s) + poll latency (0–8 s) + fix interval (15 s) ≈ 25–45 s. That matches the 25–45 s display lag from the earlier 90 s sample and cannot grow to minutes because the 60 s cap discards the backlog.

## What this means for the map

1. Serve the newest fix immediately and show the fix age; the data supports a marker about 11 s behind reality instead of 25–45 s.
2. Prefer the JSON API for positions: same fixes as GTFS-RT, about 19 s fresher.
3. Treat a transit vehicle with `lastStopID = 0` / `seq = null`, or sitting within ~30 m of its `nextStopID` with an ETA minutes away, as laying over; label the time as the scheduled departure, not an arrival.
4. Record prediction error in the monitoring record. The vendor's 6-min predictions are optimistic by about a minute at the median; riders arriving on the vendor's number will often watch the bus come 1–4 min later than promised.

## Method

- Sampler: `scripts/lag-sampler.py`, run as `python3 -I lag-sampler.py <out_dir> --minutes 40 --interval 10`. Each tick fetched `get_vehicles` (JSON API) then `position_updates.pb` (GTFS-RT feed, decoded with `gtfs-realtime-bindings` 2.2.0 / protobuf 6.33), and appended one JSON line with the wall time, HTTP `Date`/`Last-Modified`/`ETag` headers, and per-vehicle `equipmentID`, `scheduleNumber`, `tripID`, lat/lng, `receiveTime`, `nextStopID`, `nextStopETA`, `nextStopPctProg`, `lastStopID`, `seq`, `atStop`, `onSchedule`, the first three `minutesToNextStops` entries, and the GTFS-RT `vehicle.id`, `label`, `trip_id`, position, `timestamp`, `stop_id`, `current_status`. `get_stops` was fetched once for bus stop coordinates.
- Analysis: `scripts/lag-analyze.py <data_dir> <out_dir>` computes everything above and writes `staleness-per-vehicle.csv`, `divergence.csv`, `arrivals.csv`. The first and last are committed under `data/` as `lag-staleness-per-vehicle.csv` and `lag-arrivals.csv`. The raw sample (`samples.jsonl`, 3.6 MB) is not committed.
- Clocks: all ages are against the sampling machine's clock, which agreed with the JSON API `Date` header within 0.2 s. GTFS-RT timestamps are whole seconds; `receiveTime` is whole seconds in ms.
- Distances are haversine on the served lat/lng. The JSON API positions are map-matched to the route pattern; the same fix in GTFS-RT differed by at most 8.6 m, so the 30 m arrival radius is safe.
- Limits: one 40-minute midday weekday window, 17 transit vehicles, no peak or late-night service, no detours active. Predictions are whole minutes. The 6-min lookback is biased toward slow approaches (see above). Display lag was not re-measured in a browser this time; the display section reads the client code and reuses the earlier 90 s measurement.

## Sources

- JSON API `get_vehicles`: `https://catpublic.etaspot.net/service.php?service=get_vehicles&includeETAData=1&inService=1&orderedETAArray=1&token=TESTING` (240 fetches, 2026-10-23 14:59–15:39 UTC)
- JSON API `get_stops`: `https://catpublic.etaspot.net/service.php?service=get_stops&token=TESTING` (454 rows)
- GTFS-RT feed, vehicle positions: `https://s3.amazonaws.com/etatransit.gtfs/catpublic.etaspot.net/position_updates.pb` (240 fetches, 81 distinct ETags)
- Vendor site page source: `https://catpublic.etaspot.net/` (index.html, 237,781 bytes; lines 727–728 polling interval, 1047–1230 `moveAsset`)
- GTFS-realtime bindings: `gtfs-realtime-bindings` on PyPI, `google.transit.gtfs_realtime_pb2`
- Repo: `API-NOTES.md` (field decode for `receiveTime`, `nextStopETA`, `scheduleNumber`), `GLOSSARY.md` (terms used here)
- Data and scripts in this folder: `scripts/lag-sampler.py`, `scripts/lag-analyze.py`, `data/lag-staleness-per-vehicle.csv`, `data/lag-arrivals.csv`
