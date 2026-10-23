# Vendor API catalog: JSON API, GTFS feed, GTFS-RT feed

Resolves [#2](https://github.com/mhsnook/transit-map/issues/2). Verified live on 2026-10-23 between 14:58 and 16:21 UTC (10:58 to 12:21 local) against the feed vendor's servers, at no more than one request per endpoint every 10 s. Trimmed samples of every response are in [`samples/vendor-api/`](samples/vendor-api/). The raw GTFS zip and `.pb` files are not committed.

`API-NOTES.md` (repo root) is the survey this re-checks. Section 8 lists every point where today's data contradicts it.

## 1. Answers in brief

| Ticket item | Answer |
| --- | --- |
| Every `service.php` service the vendor site calls | 11 services: `get_vehicles`, `get_routes`, `get_patterns`, `get_stops`, `get_stop_etas`, `get_schedules`, `get_detour_metadata`, `get_service_announcements`, `get_version_id`, `get_stopimages`, `save_rider_feedback` (POST). Found by grepping the vendor site's `index.html` and its eight first-party scripts; no service name is missing from `API-NOTES.md`. Parameters, poll intervals and samples: section 2. |
| `get_vehicles` field decodes | All six confirmed, with two corrections: `atStop` is absent (not `0`) when the transit vehicle is moving, and `nextStopPctProg` (with `seq`) is sometimes absent. Section 3. |
| Join keys to the GTFS-RT feed | All three hold 17/17 on two mid-trip samples: `equipmentID` = `vehicle.id`, `scheduleNumber` = `vehicle.label`, `tripID` = `trip.trip_id`. Only `equipmentID` is safe across a terminal layover; the other two miss for a poll at trip rollover (seen once today as a stale trip update). `scheduleNumber` is also `trips.txt` `trip_short_name`. Section 4. |
| GTFS-RT fields missing or constant | `trip.route_id` and `position.speed` are never set (absent, not empty or zero). `stop_id`, `current_status` and `current_stop_sequence` drop out together on 1 of 17 transit vehicles. Trip updates carry only `stop_sequence` + `arrival.delay`. Section 5. |
| `shapes.txt` vs `get_patterns.encLine` | Same 35 geometries. `shape_id` equals the route pattern `name`, and every pair is within 8.4 m (most within 3.5 m). Use `get_patterns.encLine` for display; use the name/`shape_id` equality to join to GTFS. Section 6. |

## 2. JSON API

Base URL: `https://catpublic.etaspot.net/service.php?service=<name>&token=TESTING`. All reads are HTTP GET with query parameters (`$.get(serviceURL, paramsObject)`, `index.html` line 1523). Responses are `application/json` with `access-control-allow-origin: *` and no cache headers, served by IIS 10 / ARR 3.0. Response time today was 0.15 to 0.9 s.

**The token is not enforced.** `get_vehicles` with no `token` and `get_version_id` with `token=WRONG` return the same payload as with `TESTING`. The vendor site hardcodes `var serviceTOK = 'TESTING'` (`index.html` line 630).

**Unknown service names** return HTTP 200 with an HTML body `<pre>Internal Server Error</pre>`, not JSON. Callers must check the content type.

Every response is an object with one key named after the service (`{"get_vehicles": [...]}`), except `get_version_id` (`{"versionID": "95"}`) and `get_schedules`, which adds a `digest` key.

| Service | Parameters the vendor site sends (source line in `index.html`) | When the vendor site calls it | Today | Sample |
| --- | --- | --- | --- | --- |
| `get_vehicles` | `includeETAData=1&inService=1&orderedETAArray=1` (1710-1714); for an opened popup `equipmentID=<id>&includeETAData=1&orderedETAArray=1` (2662-2666); bare at page load (806) | every 8 s (`vehiclePollingIntervalMs = 8000`, line 728) | 17 transit vehicles in service; 39 rows without `inService=1` (22 not in service: `routeID 777`, `patternID 9998`, `scheduleNumber "NIS"`, `tripID null`) | [get_vehicles.json](samples/vendor-api/get_vehicles.json), [get_vehicles_noparams.json](samples/vendor-api/get_vehicles_noparams.json) |
| `get_routes` | none (807) | page load | 12 bus routes: `id`, `name`, `abbr`, `stops[]`, `vType`, `encLine`, `color`, `type`, `order`, `showDirection`, `showPlatform`, `showScheduleNumber`, `useCustomShape` | [get_routes.json](samples/vendor-api/get_routes.json) |
| `get_patterns` | none (808) | page load | 35 route patterns: `id`, `name`, `extID`, `type`, `length` (miles), `color`, `encLine`, `decLine` (always `[]`), `routes[]`, `routeNames[]`, `stations` (always `[]`), `stopIDs[]` | [get_patterns.json](samples/vendor-api/get_patterns.json) |
| `get_stops` | none, or `stopIDs=<comma list>` when the URL names stops (782, 809); `stopID=<id>` also works | page load | 454 rows = one per (bus route, bus stop) pair, keyed by `rsid`; 313 distinct `id`; `rid` is the bus route id; `extID` and `shortName` equal `id` | [get_stops.json](samples/vendor-api/get_stops.json), [get_stops_one.json](samples/vendor-api/get_stops_one.json) |
| `get_stop_etas` | `stopID=<id>` or `stopIDs=<comma list>`, `statusData=1`, and `noLimit=1` only for "custom" sites (4077-4087, 4518-4531) | every 5 s while a bus stop panel is open (`pollArrTime = 5000`, line 4062) | one element per bus stop with `enRoute[]` of arrival predictions (same fields as `minutesToNextStops[]`). Without `noLimit=1` the hub stop 17333 returned 5 rows (one per bus route); with it, 13 | [get_stop_etas.json](samples/vendor-api/get_stop_etas.json), [get_stop_etas_multi.json](samples/vendor-api/get_stop_etas_multi.json) |
| `get_schedules` | `stopID=<id>&includeETAData=1&orderedETAArray=1` (4869-4873) | when a bus stop's schedule tab is opened | 86 timetable rows for stop 19444 plus `digest: "f661e5"`. The two extra parameters change nothing: the plain call is byte-identical | [get_schedules.json](samples/vendor-api/get_schedules.json) |
| `get_detour_metadata` | none (810) | page load | `{"version": null, "ready": false, "complete": false, "detours": []}` | [get_detour_metadata.json](samples/vendor-api/get_detour_metadata.json) |
| `get_service_announcements` | none (1818) | every 10 s (`pollAlerts`) | 3 alerts, each `{type, announcements: [{text, start, end, source}]}`; times are local with no zone marker | [get_service_announcements.json](samples/vendor-api/get_service_announcements.json) |
| `get_version_id` | none (811, 1763) | page load, then every 30 s (`pollVersion`); a change reloads the page | `{"versionID": "95"}`, which equals `feed_version` in the GTFS feed | [get_version_id.json](samples/vendor-api/get_version_id.json) |
| `get_stopimages` | none (813) | page load, when `StopDetails` is set; it is `'1'` on this site (line 756), so it is always called | 322 rows: `stopid`, `type` ("Basic" x321, "Transit Center" x1), `stoplocdesc`, `amenities`, `comments`, `images[4]`; only one row has an image | [get_stopimages.json](samples/vendor-api/get_stopimages.json) |
| `save_rider_feedback` | POST `subject, email, feedback, rating, location, actions, platform, token` (5581-5600) | feedback form submit | not exercised: it would file real feedback with the agency | none |

### 2.1 Reference data in the JSON API

- Bus route ids 1-11 match GTFS `route_id` 1-11 by value. The Trolley is `id 12, abbr "T"` in the JSON API but `route_id "Trolley", route_short_name "T"` in the GTFS feed: join bus routes on `abbr` = `route_short_name`, not on id.
- `get_routes.stops[]` is a subset of the union of its route patterns' `stopIDs[]` (e.g. route 1: 44 of 47). `get_routes.encLine` is a route-level composite polyline that equals no single route pattern; `useCustomShape` is 0 for all.
- Bus stop `id` in the JSON API equals GTFS `stop_id` and `stop_code` (313 of 313 found). Coordinates are identical to the metre. The GTFS feed has 24 extra bus stops (such as "Shop 5" to "Shop 8") that no `stop_times.txt` row uses.
- Route pattern `name` equals GTFS `shape_id` for all 35 (section 6). `extID` differs from `name` on 3 route patterns (ids 31, 51, 52), so use `name`.

## 3. `get_vehicles` field decodes

Checked on three full polls (15:18:40, 15:20:45, 15:22:58 UTC), one `equipmentID=101` poll, and a 13-poll cadence run at 10 s spacing (16:19:22 to 16:21:29 UTC). Local time is EDT (UTC-4).

| Field | Confirmed meaning | Evidence |
| --- | --- | --- |
| `receiveTime` | ms epoch of the position fix, always a whole second (`% 1000 == 0` on 17/17). | 1792768712000 = 15:18:32 UTC, fetched at 15:18:40. Position staleness at fetch: 3 to 21 s (medians 9, 9, 14 s on the three polls). Transit vehicles report a new fix every ~15 s: over 13 polls the gaps between distinct `receiveTime` values had median 15 s, range 1 to 30 s. |
| `nextStopETA` | predicted arrival at `nextStopID`, in minutes past local midnight; `-1` when not in service. | 678 = 11:18 local while `minutesToNextStops[0].time` = "11:19AM" (within 1 min of rounding on 17/17). |
| `onSchedule` | minutes of schedule deviation, **negative = late**; `null` when not in service. | Equals `schedule - time` of `minutesToNextStops[0]` within 1 min on 17/17 (e.g. -9 for scheduled 11:10AM, predicted 11:19AM). Equals minus the GTFS-RT `arrival.delay` for the same bus stop: -9 vs 540 s, -11 vs 660 s, -4 vs 240 s. |
| `nextStopPctProg` | 0-100 float, progress from `lastStopID` toward `nextStopID` along the route pattern. | Values 0 to 100 seen; 100 appears just before the bus stop changes. **Absent on some polls** together with `seq`, `lastStopExtID`, `nextStopExtID` (transit vehicle 210 on polls 2 and 3), at the same moments its GTFS-RT entity lacked `stop_id`, `current_status` and `current_stop_sequence`. |
| `atStop` | `1` when dwelling at a bus stop. **The key is absent otherwise; it is never `0`.** | 9 of 17 had `atStop: 1`, 8 had no key (poll 1); 7/10 on polls 2 and 3. |
| `minutesToNextStops[]` | the next 5 arrival predictions along the route pattern (always exactly 5 with `includeETAData=1`, with or without `orderedETAArray=1`). Each: `blockID, stopID, patternStopID, timePoint, minutes, time, status, schedule, scheduleNumber, statuscolor, track, direction, directionAbbr, equipmentID, routeID`. | `minutes` is non-decreasing. `status` is `"On Time"` or, when late, the predicted time string. `statuscolor`: `#39B139` green, `#D58803` amber, `#B91D1D` red. `[0].stopID == nextStopID` on 15, 16 and 17 of 17 (the two fields are computed at slightly different moments). `schedule` matches `stop_times.txt` `arrival_time` to the minute. |
| `h` | heading, degrees. | Within a few degrees of GTFS-RT `position.bearing` when timestamps match. |
| `load` / `capacity` | passengers / seats. | 0 / 25 or 32 today; `0/0` on three transit vehicles. `eLoad`, `bkSlots`, `wcSlots`, `bkUsed`, `wcUsed` were 0 or null. |
| `lat` / `lng` | map-matched to the route pattern. | 0.0 to 0.6 m from the `patternID` polyline on all 34 rows checked. GTFS-RT positions are map-matched too (0.0 to 0.8 m). |
| `tripID` | GTFS `trip_id`. | 17/17 found in `trips.txt`. |
| `scheduleNumber` | `"HH:MM:SS-N"`: scheduled trip start time plus a run number. Equals GTFS `trips.txt` `trip_short_name` and GTFS-RT `vehicle.label`. | 17/17. The suffix is not `blockID`. |
| `blockID` | GTFS `block_id`. | 17/17 (e.g. 192). |
| `trainID` | the feed vendor's internal run id; equals `get_schedules.runID` for the same scheduled trip. | 29651 for trip 27581 in both. |
| `routeID`, `patternID` | JSON-API ids; `patternID` has no GTFS column but the route pattern's `name` is the `shape_id`. | section 2.1, 6. |
| `lastStopID`, `nextStopID` | GTFS `stop_id`. `lastPatternStopID`, `nextPatternStopID` are route-pattern-stop ids (also `patternStopID` in `minutesToNextStops` and `get_schedules`). | 17/17. |
| `seq` | index of `nextStopID` within the route pattern. **Not** GTFS `stop_sequence`: it was 1 or 2 higher than `stop_times.txt` on 13 of 17 transit vehicles. | e.g. transit vehicle 101: `seq 15`, GTFS `stop_sequence 14`. |
| `inService`, `deadHead` | 1/0 flags. | `inService=1` filter drops the 22 NIS rows. |
| `aID` | device hardware id (redacted in samples). | |

Parameter effects on `get_vehicles`: `inService=1` filters rows; `includeETAData=1` adds `seq`, `lastStopExtID`, `nextStopExtID`, `nextStopPctProg`, `atStop`, `minutesToNextStops`, `direction`, `directionAbbr`; `orderedETAArray=1` changes only the order of `minutesToNextStops` (pattern order), not its shape or length.

## 4. Join keys between a JSON-API transit vehicle and GTFS-RT entities

Two live pairs were checked: poll 1 (JSON 15:18:40, `position_updates.pb` 15:18:51 UTC) and poll 3 (JSON 15:22:58, `.pb` 15:22:59 UTC, 1 s apart).

| JSON API field | GTFS-RT field | Result |
| --- | --- | --- |
| `equipmentID` | `VehiclePosition.vehicle.id`; also `TripUpdate.vehicle.id`; entity id is `vehicle_position_<equipmentID>` | 17/17 on both polls, no unmatched entities either way |
| `scheduleNumber` | `VehiclePosition.vehicle.label` (not set on TripUpdate) | 17/17 on both polls |
| `tripID` | `VehiclePosition.trip.trip_id` and `TripUpdate.trip.trip_id` | 17/17 on both polls |
| `nextStopID` | `VehiclePosition.stop_id` | 15/17 and 13/17: the mismatches are transit vehicles whose GTFS-RT fix is older |
| `seq` | `VehiclePosition.current_stop_sequence` | equal whenever `stop_id` matches, but neither equals `stop_times.txt` `stop_sequence` (section 3) |
| `onSchedule` (min, negative late) | `TripUpdate.stop_time_update[].arrival.delay` (s, positive late) at the same `stop_sequence` | `onSchedule = -delay/60` on every checked row |
| `receiveTime/1000` | `VehiclePosition.timestamp` | equal on 6/17 (poll 1) and 0/17 (poll 3). The GTFS-RT fix was 0 to 34 s older than the JSON fix, never newer |
| `lat`,`lng` | `position.latitude`, `longitude` | datasource divergence 0.1 to 0.3 m when timestamps are equal; up to 607 m when the GTFS-RT fix is 34 s older (the transit vehicle moved) |

**Trip rollover.** The 17/17 figures were taken mid-trip. At a terminal layover the two sources advance to the next scheduled trip at different moments, so `scheduleNumber` = `label` and `tripID` = `trip_id` can miss for one poll while `equipmentID` = `vehicle.id` still holds. Today's data shows that case once: on poll 3 `trip_updates.pb` still carried trip 27700 for transit vehicle 121 (timestamp 50 s old) while the JSON API already reported it on trip 27708 (`scheduleNumber "11:26:00-18"`). The lag research in #3 saw the same pattern over a longer run: `equipmentID` matched 100 %, the other two keys missed at rollover.

Recommended join: `equipmentID` = `vehicle.id` for the transit vehicle (the only key that never misses), `tripID` = `trip_id` for the scheduled trip once both sources agree, and treat the two position fixes as different observations keyed by (`equipmentID`, fix timestamp). Compare positions only when `receiveTime/1000 == timestamp`.

## 5. GTFS-RT feed

Files at `https://s3.amazonaws.com/etatransit.gtfs/catpublic.etaspot.net/`: `position_updates.pb`, `trip_updates.pb`, `alerts.pb`. Served by S3 with `Last-Modified`, `ETag`, object versioning, no `Cache-Control`. Header: `gtfs_realtime_version "1.0"`, `incrementality FULL_DATASET`, header `timestamp` about 9 s before `Last-Modified`.

**Regeneration cadence is about 30 s, not 15 s.** Thirteen HEAD requests 10 s apart saw `Last-Modified` change at 16:19:04, 16:19:36, 16:20:05, 16:20:36, 16:21:05 UTC. On the three GET polls the file was 16, 20 and 25 s old at fetch, so GTFS-RT position staleness is roughly `0-30 s` on top of the fix's own age.

### 5.1 `position_updates.pb` (17 entities)

Set on every entity: `trip.trip_id`, `vehicle.id`, `vehicle.label`, `position.latitude`, `position.longitude`, `position.bearing`, `timestamp`.

| Field | Status | Detail |
| --- | --- | --- |
| `trip.route_id` | **never set** | `HasField` is false on 17/17; a naive reader sees `""`. Get the bus route via `trip_id` -> `trips.txt`, or via the JSON API |
| `trip.start_date`, `trip.start_time`, `trip.schedule_relationship` | never set | |
| `position.speed` | **never set** | `HasField` false on 17/17; a naive reader sees `0.0` |
| `position.odometer` | never set | |
| `stop_id`, `current_status`, `current_stop_sequence` | set on 17/17 (poll 1), **16/17** (polls 2 and 3) | the three vanish together (transit vehicle 210, which at that moment was also missing `seq` and `nextStopPctProg` in the JSON API) |
| `current_status` | `IN_TRANSIT_TO`, `INCOMING_AT`, rarely `STOPPED_AT` | |
| `current_stop_sequence` | off by 1-2 from `stop_times.txt` on most entities | the spec says it is "the stop sequence index of the current stop" (gtfs.org reference); here it is the route-pattern index |
| `occupancy_status`, `congestion_level`, `multi_carriage_details` | never set | |

### 5.2 `trip_updates.pb` (17 entities; 18 once)

Entity ids are `"1"`, `"2"`, ... Each `trip_update` sets only `trip.trip_id`, `vehicle.id`, `timestamp` and `stop_time_update[]`. Each `stop_time_update` sets only `stop_sequence` and `arrival.delay`; there is no `stop_id`, no `arrival.time`, no `departure`, no `schedule_relationship`, no trip-level `delay`, no `route_id`, no `vehicle.label`. `arrival.delay` is always a multiple of 60 s (values today: 0, 60, 120, 240, 480, 540, 600, 660, 720) and, in the rows inspected, was the same for every remaining bus stop of the scheduled trip. `stop_sequence` runs are sometimes non-contiguous (a sequence number is skipped). Poll 3 held 18 entities: the extra one was the previous scheduled trip (27700) of transit vehicle 121, with a 50 s older timestamp, after the JSON API had already moved that vehicle to trip 27708. Readers should prefer the entity whose `trip_id` matches `position_updates.pb`.

### 5.3 `alerts.pb` (3 entities)

Mirrors `get_service_announcements`: same three texts. `id` is `alert_<n>`; `header_text` is the bus route name ("Route 4"); `description_text` is the announcement text; `active_period.start/end` are the announcement's local `start`/`end` as epoch seconds (06:23 EDT = 1792750980); `informed_entity` is only `agency_id "1"`, so alerts are not linked to a `route_id`.

## 6. GTFS feed and `shapes.txt` vs `get_patterns.encLine`

`https://s3.amazonaws.com/etatransit.gtfs/catpublic.etaspot.net/gtfs.zip`: 256,987 bytes, S3 `Last-Modified` 2026-10-10 07:06:45 UTC, member files dated 2026-10-09 15:04. `feed_info.txt`: publisher ETA Transit Systems, `feed_version 95` (= `get_version_id`), valid 2024-11-09 to 2027-10-09. `agency.txt`: Charlottesville Area Transit, `America/New_York`, `agency_id 1`.

| Table | Rows | Notes |
| --- | --- | --- |
| `routes.txt` | 12 | `route_id` 1-11 and `Trolley`; colors equal the JSON API `color` without `#` |
| `stops.txt` | 337 | `stop_code == stop_id` for all; `location_type 0` for all |
| `shapes.txt` | 5,446 points, 35 `shape_id` | `shape_dist_traveled` filled; 36 to 286 points per shape |
| `trips.txt` | 1,034 | `trip_short_name` = JSON `scheduleNumber`; `block_id` = JSON `blockID`; `shape_id` = route pattern `name`; `direction_id`, `trip_headsign` ("Inbound"/"Outbound"), `block_name` ("4 4001") |
| `stop_times.txt` | 19,023 | `arrival_time` matches `minutesToNextStops[].schedule` to the minute; `timepoint`, `shape_dist_traveled` present |
| `calendar.txt` | 3 | `SA` (Sat), `WE` (Mon-Fri), `18` (Mon-Sat) |
| `calendar_dates.txt`, `fare_attributes.txt`, `fare_rules.txt`, `frequencies.txt`, `transfers.txt` | 0 | header only |

**Shapes vs `encLine`.** Decoding each of the 35 `encLine` strings (Google encoded polyline, precision 5) and comparing with the same-named `shape_id`:

- The set of 35 route pattern `name`s equals the set of 35 `shape_id`s exactly.
- Symmetric Hausdorff distance between each pair is at most 8.4 m ("8 Stonefield"); 27 of 35 are within 5 m and 19 within 0.5 m (per-pattern values measured on sampled points; the five worst pairs were re-measured on every point). These are the same drawn lines; differences are point-thinning (GTFS keeps 3-10 % more points) and 5-decimal rounding.
- Path lengths agree within 20 m, and both agree with the JSON `length` (miles).
- Both the JSON API and GTFS-RT position fixes sit on these lines (section 3), so either source works for snapping.

**Which to use for route patterns:** `get_patterns.encLine`, because `get_vehicles.patternID` points at it directly, it carries `color`, `routes[]` and the ordered `stopIDs[]`, and it changes with `get_version_id`. Keep the `name == shape_id` equality as the bridge to GTFS trips (`trips.txt.shape_id`) when a scheduled trip, not a transit vehicle, is the starting point. Do not use `get_routes.encLine` (a composite) or `decLine` (empty).

## 7. Vendor site facts worth keeping

- Scripts fetched: `Scripts/eta_main.js`, `context.js`, `events.js`, `EventManager.js`, `MapLoadCheck.js`, `CustomPopup.js`, `InfoBubble.js`, `MarkerCluster.js`. Only `index.html` builds `service.php` calls; `eta_main.js` holds Google Places/Distance Matrix code.
- Poll intervals: transit vehicles 8 s, `get_version_id` 30 s, `get_service_announcements` 10 s, `get_stop_etas` 5 s while a bus stop panel is open.
- The page de-duplicates fixes by `receiveTime` and animates between them (`movementData`, lines 2296-2305), which is why the vendor site looks smoother than an 8 s poll.
- Transitland lists this GTFS feed and the three `.pb` files as `f-dqb0q-charlottesvilleareatransit`.

## 8. Where today's data contradicts `API-NOTES.md`

1. **GTFS-RT cadence**: notes say "regenerated about every 15 s"; measured about every 30 s, and files were 16-25 s old at fetch.
2. **Trip update count**: notes say 18; it is 17, matching the transit vehicles, with a stale 18th seen once.
3. **`route_id` empty, `speed` always 0**: both fields are never set at all (`HasField` false). The zero/empty are protobuf defaults, which matters for "is this field present" checks.
4. **`atStop` "1 when dwelling"**: true, but the key is absent (not `0`) otherwise.
5. **`nextStopPctProg`, `seq`**: not always present; they drop out with the GTFS-RT `stop_id` trio.
6. **Auth**: notes say the `TESTING` token is the only auth; the token is not checked at all.
7. **`get_stopimages` "only when StopDetails is on"**: `StopDetails = '1'` on this site, so it is called on every page load.
8. **`get_stop_etas`**: the `noLimit=1` parameter is missing from the notes; without it the response is capped (5 vs 13 rows at the Downtown Transit Station).
9. **`get_schedules`**: `includeETAData` and `orderedETAArray` have no effect.
10. **`get_vehicles` "17 buses"**: 17 in service; the unfiltered call returns 39 rows including 22 not in service.
11. **Position staleness "served 1-16 s after the fix"**: observed 3-21 s.
12. **`scheduleNumber`**: confirmed equal to the GTFS-RT label, and additionally equal to `trips.txt` `trip_short_name` (not noted).
13. **Trolley route id**: JSON `12`/`T` vs GTFS `Trolley`/`T`; the notes do not flag that bus route ids do not all join by value.
14. **`get_patterns` fields**: `extID`, `type`, `decLine` (always `[]`), `routeNames`, `stations` (always `[]`) are not in the notes; `extID != name` on 3 route patterns.
15. **City GTFS page "404s"**: the `agency_url` in `agency.txt` (`https://charlottesville.gov/470/Transit`) returned 200 today; whichever page the notes meant was not identified.
16. **"Samples of every response are in this folder"**: none were in the repo; they are now under `docs/research/samples/vendor-api/`.

## 9. Method

- `curl` for every fetch, one request per endpoint per 10 s, headers and fetch time recorded per file.
- GTFS-RT decoded with `gtfs-realtime-bindings` (protobuf 6.33) in a venv, run with `python -I` from a directory outside the downloads; field presence checked with `HasField`, not by value.
- Polylines decoded with the `polyline` package; distances by equirectangular projection (sub-metre error at this scale); Hausdorff computed point-to-segment both ways over every point.
- Join checks compare the full JSON row set against the full entity set for each pair of polls.

## Sources

- Vendor site page and scripts: https://catpublic.etaspot.net/ , https://catpublic.etaspot.net/Scripts/eta_main.js , https://catpublic.etaspot.net/Scripts/context.js , https://catpublic.etaspot.net/Scripts/events.js (line numbers above refer to `index.html` as served 2026-10-23 14:58 UTC)
- JSON API, each fetched 2026-10-23 15:18-15:46 UTC: https://catpublic.etaspot.net/service.php?service=get_vehicles&token=TESTING&includeETAData=1&inService=1&orderedETAArray=1 , `...service=get_routes` , `...service=get_patterns` , `...service=get_stops` , `...service=get_stop_etas&stopID=19444&statusData=1` , `...service=get_stop_etas&stopID=17333&statusData=1&noLimit=1` , `...service=get_schedules&stopID=19444` , `...service=get_detour_metadata` , `...service=get_service_announcements` , `...service=get_version_id` , `...service=get_stopimages`
- GTFS feed: https://s3.amazonaws.com/etatransit.gtfs/catpublic.etaspot.net/gtfs.zip (fetched 2026-10-23 15:19:32 UTC, `Last-Modified` 2026-10-10 07:06:45 GMT)
- GTFS-RT feed: https://s3.amazonaws.com/etatransit.gtfs/catpublic.etaspot.net/position_updates.pb , https://s3.amazonaws.com/etatransit.gtfs/catpublic.etaspot.net/trip_updates.pb , https://s3.amazonaws.com/etatransit.gtfs/catpublic.etaspot.net/alerts.pb (fetched 15:18-15:23 UTC; HEAD cadence poll 16:19-16:21 UTC)
- GTFS Realtime reference, definitions of `delay`, `current_stop_sequence`, `stop_id`, `VehicleDescriptor.label`: https://gtfs.org/documentation/realtime/reference/
- Transitland feed record: https://www.transit.land/feeds/f-dqb0q-charlottesvilleareatransit
- Decoder: https://pypi.org/project/gtfs-realtime-bindings/ ; polyline codec: https://pypi.org/project/polyline/
- Starting survey: `API-NOTES.md` in this repo (commit e3d2f5c)
