# Transit Map

A live bus map for Charlottesville Area Transit (CAT) that also keeps a monitoring record of what the feed vendor's JSON API and GTFS-RT feed claimed. See [`GLOSSARY.md`](GLOSSARY.md) for terms.

Built with TanStack Start on Cloudflare Workers, with one Durable Object (`Collector`) as the collector and realtime hub.

## Run locally

```bash
pnpm install
pnpm dev
```

The app runs at http://localhost:3000 inside the Workers runtime (via `@cloudflare/vite-plugin`), so Durable Objects work locally. Local Durable Object storage lives in `.wrangler/`; delete that folder to start fresh.

## Deploy

Pushes to `main` deploy to https://transit-map.msnook-xyz.workers.dev via Workers Builds.

## Layout

- `src/server.ts`: the Worker entry. It wraps TanStack Start's handler and exports the Durable Object classes, which Cloudflare requires to be exported from the main module.
- `src/collector/`: the `Collector` Durable Object, bound as `env.COLLECTOR`. It polls the feed vendor every 10 s and keeps the monitoring record. See [`docs/adr/0001-collector-topology.md`](docs/adr/0001-collector-topology.md).
- `src/collector/schema.ts`: Drizzle tables. After changing them, run `pnpm db:generate` to add a migration; the Collector applies migrations on start.
- `src/collector/schedule.ts`: turns the published GTFS feed into scheduled stops for schedule versions. See [`docs/adr/0002-schedule-versions.md`](docs/adr/0002-schedule-versions.md).
- `src/collector/predictions.ts` and `src/collector/arrivals.ts`: arrival predictions from `get_stop_etas`, and the rules that turn position fixes into observed arrivals. See [`docs/adr/0003-arrival-predictions-and-observed-arrivals.md`](docs/adr/0003-arrival-predictions-and-observed-arrivals.md).
- `src/live/`: the party-db collections browsers sync, shared by the Collector and the client.
- `src/components/TransitMap.tsx`: the MapLibre map (OpenFreeMap tiles) of route patterns, bus stops and transit vehicles.
- `src/components/InfoPanel.tsx`: the side panel (desktop) or bottom sheet (phone, via vaul): bus routes, buses running now, bus stops, the selected bus route's timetable (`RouteSchedule.tsx`), and the selected bus stop (`StopPanel.tsx`, `StopHistory.tsx`).
- `src/lib/stop-details.ts`: server functions the stop view uses to read the schedule and monitoring record from the Collector. The selected bus stop is in the URL as `?stop=`, with `&history=true` when its history is shown.
- `src/routes/`: TanStack Router file routes.
- `wrangler.jsonc`: Worker config, bindings and Durable Object migrations.

After changing bindings in `wrangler.jsonc`, run `pnpm cf-typegen` to regenerate `worker-configuration.d.ts`.
