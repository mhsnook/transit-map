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
- `src/live/`: the party-db collections browsers sync, shared by the Collector and the client.
- `src/routes/`: TanStack Router file routes.
- `wrangler.jsonc`: Worker config, bindings and Durable Object migrations.

After changing bindings in `wrangler.jsonc`, run `pnpm cf-typegen` to regenerate `worker-configuration.d.ts`.
