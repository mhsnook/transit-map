# 2. Schedule versions

Date: 2026-10-26.

## Decision

- **The published schedule is a set of scheduled stops.** A scheduled stop is (bus route short name, weekday pattern, direction, bus stop id, arrival time, departure time, timepoint), joined from the GTFS feed's `stop_times.txt`, `trips.txt`, `routes.txt` and `calendar.txt`. Direction is part of it because at terminals one trip arrives and the next departs at the same bus stop and minute (122 such pairs in feed version 95).
- **Arrival and departure are kept separately,** although they are equal on every row of feed version 95. Late arrival and early departure are different failures, and a scheduled hold at a bus stop (departure after arrival) is a schedule change worth seeing.
- **The timepoint flag is kept** because it says which times are commitments: 3,535 of 19,023 scheduled stops are timepoints, and GTFS treats the rest as estimates between them. Early departure means most at a timepoint.
- **Left out on purpose:** trip ids, shapes, stop names and coordinates, the feed vendor's service-id codes, and stop sequence. Renumbering, re-encoding or renaming those is a change to the data, not to when buses stop where.
- **A schedule version is identified by the SHA-256 of the sorted set**, so its identity doesn't depend on file order or formatting.
- **Checking is a cascade, hourly:** a conditional GET of `gtfs.zip` with the last ETag; a `304` ends the check. A new file is parsed into scheduled stops; an unchanged set (and unchanged `feed_version`) ends the check. Otherwise a schedule change is recorded.
- **Storage.** `schedule_versions` holds each distinct set once. `schedule_changes` records each observed transition with the feed vendor's `feed_version`, feed dates and ETag, so a revert to an earlier version is its own change, and a new `feed_version` over an unchanged set is a change with no deltas. `schedule_deltas` holds the scheduled stops each change added or removed; the first change adds all of them, so any version can be rebuilt. `scheduled_stops` is the current set.

## Consequences

- The baseline costs about 19,000 scheduled stops written twice (current set and first delta), once.
- Schedule changes the feed vendor makes without publishing a new `gtfs.zip` are not seen here. Comparing the scheduled times in arrival predictions against `scheduled_stops` is how those get found; that belongs with #7.
