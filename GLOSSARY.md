# Transit Map

A live bus map for Charlottesville Area Transit (CAT) that also records what the vendor's feeds claimed, so that display errors can be told apart from data errors.

Terms are two words where possible. The second word scopes the first, so the term does not claim a common word for itself.

## Language

### Sources

**Feed vendor**:
ETA Transit, the company whose SPOT product runs `catpublic.etaspot.net` and publishes CAT's feeds.
_Avoid_: ETA, SPOT, vendor (alone)

**Vendor site**:
The public web page at `catpublic.etaspot.net` that riders use today.
_Avoid_: the old site, the official site

**JSON API**:
The undocumented `service.php` endpoints the vendor site calls.
_Avoid_: service.php API, private API, internal API

**GTFS feed**:
The feed vendor's published static GTFS zip: routes, stops, shapes, stop times.
_Avoid_: static feed, schedule feed

**GTFS-RT feed**:
The feed vendor's published GTFS-realtime protobuf files: vehicle positions, trip updates, alerts.
_Avoid_: realtime feed, protobuf feed

### Transit objects

**Transit vehicle**:
One bus, identified by the feed vendor's equipment id.
_Avoid_: bus (in code), unit, vehicle (alone)

**Bus route**:
A named public line, such as the Yellow line, that riders know by name and color.
_Avoid_: line, route (alone)

**Route pattern**:
One ordered path of bus stops and the shape a transit vehicle follows for it. A bus route has one or more route patterns.
_Avoid_: shape (for the whole thing), variant, direction, pattern (alone)

**Bus stop**:
A place where a transit vehicle picks up or drops off riders.
_Avoid_: stop (alone), station

**Scheduled trip**:
One scheduled run of a transit vehicle along a route pattern, identified by the GTFS trip id.
_Avoid_: run, journey, trip (alone)

**Terminal layover**:
A hold at a terminal bus stop between two scheduled trips, during which the feed vendor already reports the next scheduled trip and its scheduled departure as the next arrival.
_Avoid_: layover (alone), dwell, break

### Schedule

**Scheduled stop**:
One published fact of the form "this bus route arrives at and departs from this bus stop at these times on these weekdays, going this way", with whether the bus stop is a timepoint, joined from the GTFS feed's stop times, trips, routes and calendar. Trip ids, shapes and stop names are not part of it.
_Avoid_: stop time (for this), timetable entry, trip stop

**Schedule version**:
One distinct set of scheduled stops, identified by the SHA-256 of the sorted set.
_Avoid_: feed version (that is the feed vendor's own label), schedule (alone), timetable

**Schedule change**:
An observed move from one schedule version to another, or a new feed vendor `feed_version` with the same scheduled stops.
_Avoid_: update, revision, version bump

**Schedule delta**:
The scheduled stops a schedule change added or removed. A retimed stop is one removed and one added.
_Avoid_: diff, changeset

### Observations

**Position fix**:
One GPS position report for a transit vehicle, with the time the vehicle recorded it.
_Avoid_: position, ping, update, location, fix (alone)

**Arrival prediction**:
A feed vendor claim, made at a known time, that a transit vehicle will arrive at a bus stop at a given time.
_Avoid_: ETA (in code), estimate, prediction (alone)

**Observed arrival**:
The first position fix at which a transit vehicle is judged to have reached a bus stop.
_Avoid_: stop event, visit, arrival (alone)

**Position staleness**:
The age of a transit vehicle's newest position fix at the moment it is served or displayed.
_Avoid_: lag, delay, latency, staleness (alone)

**Datasource divergence**:
The distance between the positions the JSON API and the GTFS-RT feed report for the same transit vehicle and the same fix time.
_Avoid_: mismatch, drift, divergence (alone)

**Prediction error**:
The signed difference between an arrival prediction's time and the observed arrival for the same transit vehicle and bus stop.
_Avoid_: ETA error, accuracy, error (alone)

**Poll attempt**:
One request the collector made to the JSON API or the GTFS-RT feed, with its outcome, whether or not it returned new position fixes.
_Avoid_: request, fetch, poll (alone)

**Monitoring record**:
The stored history of position fixes, arrival predictions, observed arrivals, position staleness, datasource divergence, and poll attempts that monitoring queries read.
_Avoid_: log, telemetry, history, recording
