# 1. Collector topology

Date: 2026-10-25. Resolves [#8](https://github.com/mhsnook/transit-map/issues/8).

## Decision

- **One Durable Object for the whole city.** `Collector`, room `cat`, bound as `env.COLLECTOR`. It polls, stores the monitoring record, and serves browsers. At 17 transit vehicles and two feeds, splitting by bus route would add coordination and buy nothing.
- **One 10 s alarm tick polls both sources.** The JSON API is fetched every tick. The GTFS-RT feed is fetched every tick with `If-None-Match`, so the ≈30 s regeneration cadence costs a `304` and no rows in between. Each tick schedules the next alarm before doing any work, so a failure cannot stop the loop.
- **A per-minute Cron Trigger is the watchdog.** It calls `ensurePolling()`, which sets an alarm only when none is pending. Any browser connect also starts the loop.
- **Deduplication** is the primary key `(fix_time, source, equipment_id)` with `ON CONFLICT DO NOTHING`. A position fix served on several polls is stored once.
- **Browsers subscribe over party-db** (0.0.6) on the Collector's hibernatable WebSocket, into TanStack DB collections. Only `newest_position_fixes` (one row per transit vehicle, from the JSON API) is declared as a collection. The monitoring record tables are owned by Drizzle and are never sent to browsers. Browsers cannot write: the collection's access is `{ read: 'public' }`, and the Collector writes through the privileged `commit()`.
- **Failure behavior.** Each fetch times out after 5 s. Every poll attempt is recorded with its outcome (`ok`, `not_modified`, `http_error`, `timeout`, `network_error`, `parse_error`), so feed vendor outages are visible in the monitoring record. A failed JSON API poll leaves `newest_position_fixes` untouched, and position staleness keeps growing on the map. A successful poll that omits a transit vehicle removes it from the collection.
- **Retention.** Once an hour, the tick deletes position fixes and poll attempts older than 14 days.

## Consequences

- Each preview deployment gets its own Collector, which polls the feed vendor once someone opens the preview, and keeps polling for as long as the preview exists.
- Arrival predictions, observed arrivals and terminal layovers are not recorded yet. They depend on [#7](https://github.com/mhsnook/transit-map/issues/7).
