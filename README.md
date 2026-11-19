# Transit Map

A live bus map for Charlottesville Area Transit (CAT) that can also keep a monitoring record of what the feed vendor's JSON API and GTFS-RT feed claimed. See [`GLOSSARY.md`](GLOSSARY.md) for terms.

Built with TanStack Start on Cloudflare Workers. The browser reads buses and arrival predictions from the feed vendor's JSON API. One Durable Object (`Collector`) serves bus routes, bus stops and the timetable, and keeps the monitoring record when it is turned on.

## Run locally

```bash
pnpm install
pnpm dev
```

The map shows buses without the collector. To run the collector locally, copy `.dev.vars.example` to `.dev.vars`.

The app runs at http://localhost:3000 inside the Workers runtime (via `@cloudflare/vite-plugin`), so Durable Objects work locally. Local Durable Object storage lives in `.wrangler/`; delete that folder to start fresh.

## Deploy

Pushes to `main` deploy to https://transit-map.msnook-xyz.workers.dev via Workers Builds.

## Turn the collector on

The collector is off unless `COLLECTOR_ENABLED` is `"true"`. Set it in the top-level `vars` of `wrangler.jsonc` and deploy to record in production; the Cron Trigger starts the 10 s alarm loop within a minute. Set it back to `"false"` and deploy to stop. The monitoring record has a gap for as long as the collector is off.

While the collector is off, the map still works. A browser that connects makes the `Collector` refresh bus routes, bus stops and the timetable when they are more than an hour old. Previews do not inherit `vars`, so a preview's collector is always off.

Each running collector writes to Durable Object storage every 10 s, which Cloudflare bills by the row. See [#19](https://github.com/mhsnook/transit-map/issues/19) before turning it on.

## Layout

- `src/server.ts`: the Worker entry. It wraps TanStack Start's handler and exports the Durable Object classes, which Cloudflare requires to be exported from the main module.
- `src/collector/`: the `Collector` Durable Object, bound as `env.COLLECTOR`. When turned on, it polls the feed vendor every 10 s and keeps the monitoring record. See [`docs/adr/0001-collector-topology.md`](docs/adr/0001-collector-topology.md).
- `src/collector/schema.ts`: Drizzle tables. After changing them, run `pnpm db:generate` to add a migration; the Collector applies migrations on start.
- `src/collector/schedule.ts`: turns the published GTFS feed into scheduled stops for schedule versions. See [`docs/adr/0002-schedule-versions.md`](docs/adr/0002-schedule-versions.md).
- `src/live/predictions.ts` and `src/collector/arrivals.ts`: arrival predictions from `get_vehicles` (live) and `get_stop_etas` (a snapshot every ten minutes), and the rules that turn position fixes into observed arrivals. See [`docs/adr/0003-arrival-predictions-and-observed-arrivals.md`](docs/adr/0003-arrival-predictions-and-observed-arrivals.md).
- `src/live/`: what the map reads. `vendor.ts` polls the feed vendor from the browser for buses and arrival predictions ([ADR 5](docs/adr/0005-browsers-read-the-feed-vendor.md)); `collections.ts` holds the party-db collections browsers sync from the Collector; `vehicles.ts` and `predictions.ts` parse the JSON API for both.
- `src/components/TransitMap.tsx`: the MapLibre map (OpenFreeMap tiles) of route patterns, bus stops and transit vehicles.
- `src/collector/slots.ts`: matched slots, the scheduled times lateness is measured against. See [`docs/adr/0004-matched-slots.md`](docs/adr/0004-matched-slots.md).
- `docs/findings/`: what the monitoring record has shown about the feed vendor's data.
- `src/components/InfoPanel.tsx`: the side panel (desktop) or bottom sheet (phone, via vaul): bus routes, buses running now, bus stops, the selected bus route's timetable with how each of today's trips went (`RouteSchedule.tsx`, `lib/trip-outcomes.ts`), the selected bus stop (`StopPanel.tsx`, `StopHistory.tsx`), and the selected bus (`BusPanel.tsx`).
- `src/lib/stop-details.ts`: server functions the stop view uses to read the schedule and monitoring record from the Collector. The selected bus stop is in the URL as `?stop=`, with `&history=true` when its history is shown; the selected bus is `?bus=`.
- `src/routes/`: TanStack Router file routes.
- `wrangler.jsonc`: Worker config, bindings and Durable Object migrations.

After changing bindings in `wrangler.jsonc`, run `pnpm cf-typegen` to regenerate `worker-configuration.d.ts`.
