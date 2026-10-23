# catpublic.etaspot.net — endpoint notes (captured 2026-10-23)

Vendor: ETA Transit ("SPOT"). Agency: Charlottesville Area Transit (CAT).
Samples of every response are in this folder (`get_*.json`, `poll_*.json`, `gtfs/`).

## JSON API used by the site

Base: `https://catpublic.etaspot.net/service.php?service=<name>&token=TESTING`
The token `TESTING` is hardcoded in the page source (index.html line 630). No other auth.

| service | params the site sends | notes |
| --- | --- | --- |
| get_vehicles | includeETAData=1, inService=1, orderedETAArray=1, [equipmentID] | site polls every 8 s. 17 buses. lat/lng already map-matched to the pattern polyline (0–1 m off) |
| get_routes | — | 12 routes; id, name, abbr, stops[], encLine (Google encoded polyline) |
| get_patterns | — | 35 patterns; id, name, length (miles), color, encLine, routes[], stopIDs[] |
| get_stops | [stopID] | 454 rows keyed by rsid (route-stop), with rid, id, name, lat, lng |
| get_stop_etas | stopID or stopIDs=comma list, statusData=1 | per-stop enRoute[] with minutes, schedule, time, status, equipmentID |
| get_schedules | stopID, includeETAData=1, orderedETAArray=1 | full day timetable for one stop |
| get_detour_metadata | — | empty today |
| get_service_announcements | — | alerts text with start/end |
| get_version_id | — | site polls this; bump means reload static data |
| get_stopimages | — | only when StopDetails is on |
| save_rider_feedback | POST | not explored |

### get_vehicles field decode
- `receiveTime` ms epoch of the GPS fix. Buses report every ~15 s. Served 1–16 s after the fix.
- `nextStopETA` = predicted arrival as minutes past midnight (520 = 08:40).
- `onSchedule` minutes; negative = running late (−6 with scheduled 08:34, predicted 08:40).
- `nextStopPctProg` 0–100 progress from lastStop toward nextStop along the pattern.
- `h` heading degrees. `load`/`capacity` passenger count. `atStop` 1 when dwelling.
- `minutesToNextStops[]` per upcoming stop: minutes, schedule, time, status, statuscolor.
- `tripID` matches GTFS trip_id. `scheduleNumber` ("08:30:00-12") matches GTFS-RT vehicle label.

## Standard feeds (same vendor, on S3)

- Static GTFS: https://s3.amazonaws.com/etatransit.gtfs/catpublic.etaspot.net/gtfs.zip (257 KB, shapes + stop_times, dated 2026-10-09)
- GTFS-RT vehicles: https://s3.amazonaws.com/etatransit.gtfs/catpublic.etaspot.net/position_updates.pb
- GTFS-RT trip updates: https://s3.amazonaws.com/etatransit.gtfs/catpublic.etaspot.net/trip_updates.pb
- GTFS-RT alerts: https://s3.amazonaws.com/etatransit.gtfs/catpublic.etaspot.net/alerts.pb
- Regenerated about every 15 s (Last-Modified was 2 s before fetch). 17 vehicle entities, 18 trip updates.
- Gaps seen: VehiclePosition.trip.route_id is empty, position.speed is always 0, stop_id missing on some.
- Listed on Transitland as f-dqb0q-charlottesvilleareatransit. The city's GTFS page 404s after their site move.
