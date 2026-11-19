# 5. Browsers read the feed vendor, and the collector is opt-in

Date: 2026-11-19. Part of [#19](https://github.com/mhsnook/transit-map/issues/19).

## Context

Every deployment ran a collector: production, and each preview for as long as the preview existed. Each one ran a 10 s alarm loop and wrote to Durable Object storage on every tick, which Cloudflare bills by the row. In November 2026 six collectors together went past the amounts the plan includes.

The map needed a collector to show a bus: the collector wrote each poll into `newest_position_fixes` and `current_arrival_predictions`, and browsers synced those tables over party-db. So a collector could not be stopped without emptying the map.

The feed vendor's JSON API answers with `access-control-allow-origin: *` (checked 2026-11-19), and the vendor's own site reads it from the browser.

## Decision

- **The browser polls `get_vehicles` every 10 s** for position fixes and each transit vehicle's next five arrival predictions (`src/live/vendor.ts`). It does not poll while the tab is hidden. A failed poll leaves the rows as they are, as a failed collector poll did.
- **An open bus stop adds `get_stop_etas` for that bus stop** to each browser poll. This replaces the collector's watched stops and the `watchStop` RPC.
- **`newest_position_fixes` and `current_arrival_predictions` are dropped** as tables and as party-db collections. The browser holds both as TanStack DB collections that the poll fills, so the views read them as before.
- **The browser computes the matched slot** for a live arrival prediction (`src/lib/use-slot-matcher.ts`). An open bus stop uses that bus stop's scheduled stops, as the collector did. Elsewhere only the timetable is in the browser, so a bus's next stops get a matched slot at timepoints and the feed vendor's scheduled time between them.
- **The collector runs only when `COLLECTOR_ENABLED` is `"true"`.** The var is in the top-level `vars` of `wrangler.jsonc`, which previews do not inherit, so a preview's collector is always off. This supersedes ADR 1's "Any browser connect also starts the loop".
- **Reference data does not need the alarm loop.** While the collector is off, a browser's connect makes the `Collector` refresh bus routes, route patterns, bus stops and the timetable when the last successful poll is more than an hour old. The connect does not wait for the refresh.

## Consequences

- The map shows buses in production, in previews and in local development with no collector running.
- Each open browser polls the feed vendor, where one collector polled for all of them.
- A stopped collector costs no storage rows and no compute duration beyond page loads.
- `todays_arrivals`, the stop history and trip outcomes still come from the collector. While it is off they show what it last recorded.
- The GTFS-RT feed on S3 sends no CORS header. Only the collector reads it.
