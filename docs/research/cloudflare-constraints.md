# Cloudflare constraints for a 10-second collector

Research for [ticket #5](https://github.com/mhsnook/transit-map/issues/5), part of [#1](https://github.com/mhsnook/transit-map/issues/1). Read on 2026-10-23 from developers.cloudflare.com, tanstack.com, the npm registry, and the MobilityData `gtfs-realtime-bindings` repo. Every number below was read on the page linked beside it this session. Where a limit differs between the Workers Free and Workers Paid plans, both are given.

The question: one Durable Object polls the JSON API about every 10 s and the GTFS-RT feed about every 15 s, decodes GTFS-RT protobuf, and keeps 14 days of monitoring records. What platform limits shape it?

## 1. Durable Object alarms

Source: [Alarms API](https://developers.cloudflare.com/durable-objects/api/alarms/), [SQLite storage API (alarm methods)](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/), [Durable Object lifecycle](https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/), [Pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/), [Limits](https://developers.cloudflare.com/durable-objects/platform/limits/).

**Minimum interval.** No minimum is documented. `setAlarm()` takes a `Date` or integer milliseconds; "Alarms have millisecond granularity." A time at or before `Date.now()` schedules the alarm immediately. ([sqlite-storage-api](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/)) So a 10 s loop is within the documented range; the practical floor is the handler's own run time, since "Only one instance of `alarm()` will ever run at a given time per Durable Object instance." ([alarms](https://developers.cloudflare.com/durable-objects/api/alarms/))

**One alarm per object.** "Each Durable Object is able to schedule a single alarm at a time by calling `setAlarm()`." A second `setAlarm()` overrides the first. ([alarms](https://developers.cloudflare.com/durable-objects/api/alarms/)) The 10 s JSON API poll and the 15 s GTFS-RT poll must therefore share one loop (for example, poll the GTFS-RT feed on every tick or every other tick) or live in two objects.

**Drift.** Alarms "can be delayed by up to a minute due to maintenance or failures while failover takes place." ([sqlite-storage-api](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/)) No tighter precision figure is published. To avoid cumulative drift, schedule the next tick from the intended time of the current one (`scheduled + 10_000`), not from `Date.now()` after the fetches finish.

**Retries.** "Alarms have guaranteed at-least-once execution and are retried automatically when the `alarm()` handler throws." Retries use exponential backoff "starting at a 2 second delay from the first failure with up to 6 retries allowed." Retries apply only when the handler throws an uncaught exception and only for the most recent `setAlarm()`. The handler receives `retryCount` and `isRetry`. The page recommends catching exceptions and rescheduling yourself, because a long outage "can exhaust the limited number of retries." `deleteAlarm()` does not cancel a handler already running. ([alarms](https://developers.cloudflare.com/durable-objects/api/alarms/)) For the collector: a feed-vendor outage must not throw out of `alarm()`; record the failure, set the next alarm, return.

**Behavior on eviction.** Alarms are storage operations: "alarm operations follow the same rules as other storage operations." ([alarms](https://developers.cloudflare.com/durable-objects/api/alarms/)) An object is evicted "after 70-140 seconds of inactivity (no incoming requests or events)"; "Pending I/O and open outbound connections prevent a Durable Object from being evicted"; and the "first incoming request or event (like an alarm) will execute the `constructor()`" before the handler runs. ([lifecycle](https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/)) On unexpected termination mid-handler, the alarm "may be re-instantiated on another machine" and reruns from the beginning. ([alarms](https://developers.cloudflare.com/durable-objects/api/alarms/)) Two consequences: (a) a 10 s loop keeps the object from ever reaching the 70 s idle threshold, so in practice it stays resident; (b) the constructor must not call `setAlarm()` unconditionally, because that can override a pending alarm; check `getAlarm()` first. In-memory state does not survive eviction or hibernation; anything needed across ticks (last-seen position fix per transit vehicle, for datasource divergence) goes to storage. ([in-memory state](https://developers.cloudflare.com/durable-objects/reference/in-memory-state/))

**Wall time and CPU per alarm.** "Alarm handler invocations have a maximum wall time of 15 minutes." ([workers limits](https://developers.cloudflare.com/workers/platform/limits/)) CPU time per Durable Object invocation (HTTP request, WebSocket message, or alarm) is 30 seconds by default, configurable via `limits.cpu_ms` up to 5 minutes (300,000 ms) for SQLite-backed objects. The Durable Object limits page lists one CPU value with no Free/Paid column. ([DO limits](https://developers.cloudflare.com/durable-objects/platform/limits/))

**Cost per alarm.** "Alarm invocations count toward the request total," and each `setAlarm()` is billed as one row written on SQLite-backed objects. ([pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/)) So one tick costs: 1 request + 1 row written (the reschedule) + the rows it writes + duration.

| Metric | Workers Free | Workers Paid | Page |
| --- | --- | --- | --- |
| Durable Object requests | 100,000 / day | 1 million / month included, then $0.15 per million | [pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/) |
| Duration | 13,000 GB-s / day | 400,000 GB-s / month included, then $12.50 per million GB-s | [pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/) |

Duration is wall-clock time while an object is active, "or idle but not eligible for hibernation"; every object is billed at 128 MB regardless of use, so 1 GB-s is about 7.8 s of residency. Idle objects that are eligible for hibernation are not billed. Pending I/O can keep an object in memory for up to 15 minutes. Daily Free limits reset at 00:00 UTC, and on Free "operations of a type fail once that type exceeds its free limit." Paid also carries the $5 / month Workers Paid minimum. ([pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/))

## 2. Subrequest and CPU limits per alarm invocation

Source: [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [Durable Object limits](https://developers.cloudflare.com/durable-objects/platform/limits/).

| Limit | Workers Free | Workers Paid | Page |
| --- | --- | --- | --- |
| Subrequests per invocation | 50 | 10,000 (up to 10M) | [workers limits](https://developers.cloudflare.com/workers/platform/limits/) |
| Subrequests to internal services (KV, D1, R2, ...) | 1,000 | matches configured limit (default 10,000) | [workers limits](https://developers.cloudflare.com/workers/platform/limits/) |
| Simultaneous outgoing connections per invocation | 6 | 6 | [workers limits](https://developers.cloudflare.com/workers/platform/limits/), [DO limits](https://developers.cloudflare.com/durable-objects/platform/limits/) |
| CPU time per Durable Object invocation (incl. alarm) | 30 s default, up to 5 min via `limits.cpu_ms` | same | [DO limits](https://developers.cloudflare.com/durable-objects/platform/limits/) |
| Alarm wall time | 15 min | 15 min | [workers limits](https://developers.cloudflare.com/workers/platform/limits/) |
| Memory per isolate | 128 MB | 128 MB | [workers limits](https://developers.cloudflare.com/workers/platform/limits/) |
| Soft limit, requests per object | 1,000 / s | 1,000 / s | [DO limits](https://developers.cloudflare.com/durable-objects/platform/limits/) |

"A subrequest is any request a Worker makes using the Fetch API or to Cloudflare services like R2, KV, or D1." Each hop of a redirect chain counts, and "There is no set time limit on individual subrequests." ([workers limits](https://developers.cloudflare.com/workers/platform/limits/)) Fetching two or three URLs per tick (JSON API vehicles, JSON API predictions, GTFS-RT vehicle positions) plus one D1 write is 3–4 subrequests, far under 50. The 6-connection cap means the fetches can run in parallel. CPU time excludes time waiting on the network, so the CPU budget covers only JSON parsing, protobuf decoding, and SQL; the HTTP-request CPU limit of 10 ms on Free vs 30 s default on Paid ([workers limits](https://developers.cloudflare.com/workers/platform/limits/)) applies to the calling Worker, not the Durable Object invocation, whose limit is listed separately at 30 s.

## 3. Decoding GTFS-RT protobuf in Workers

Source: [gtfs-realtime-bindings nodejs package.json](https://raw.githubusercontent.com/MobilityData/gtfs-realtime-bindings/master/nodejs/package.json), [README](https://raw.githubusercontent.com/MobilityData/gtfs-realtime-bindings/master/nodejs/README.md), [generated gtfs-realtime.js](https://raw.githubusercontent.com/MobilityData/gtfs-realtime-bindings/master/nodejs/gtfs-realtime.js), npm registry metadata for `gtfs-realtime-bindings` and `protobufjs` (fetched from registry.npmjs.org), [Node.js compatibility](https://developers.cloudflare.com/workers/runtime-apis/nodejs/), [Workers limits](https://developers.cloudflare.com/workers/platform/limits/).

- `gtfs-realtime-bindings` latest is **2.2.0** (published 2026-07-29); `main` is `gtfs-realtime.js`, `types` is `gtfs-realtime.d.ts`; dependencies `protobufjs ^8.2.1` and `protobufjs-cli ^2.2.1`; `engines.node >= 22`; unpacked size 687,935 bytes. No `exports` or `module` field (CommonJS). (registry metadata; package.json)
- The generated file requires exactly one module, `require("protobufjs/minimal")`, and reaches `Long` through `$protobuf.util`. It contains no `require("fs")` or `require("buffer")` (grep of the 518,707-byte file). `protobufjs@8.2.1`'s `dist/minimal/protobuf.min.js` is 23,266 bytes (unpkg). `protobufjs` latest is 8.8.1 with one dependency, `long ^5.3.2`.
- Usage per the README: `GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(new Uint8Array(buffer))` on `await response.arrayBuffer()`. The README says the bindings "are designed to be used in the Node.js environment, but with some effort, they can probably be used in other JavaScript environments as well," and that 2.0.0+ "requires Node.js 22 or later."
- Compatibility: nothing in the decode path needs Node APIs beyond what `protobufjs/minimal` probes for. Workers' `nodejs_compat` flag (required for compatibility dates 2024-09-23 through 2026-08-03; enabled automatically from 2026-08-04 onward) provides `Buffer`, `util`, and the other "supported" modules natively, and Wrangler injects unenv polyfills for the rest. ([nodejs](https://developers.cloudflare.com/workers/runtime-apis/nodejs/)) TanStack Start's Cloudflare template already sets `nodejs_compat` (section 6).
- Bundle size: the Worker size limit is 64 MiB uncompressed on both plans, and the global scope must execute within 1 second. ([workers limits](https://developers.cloudflare.com/workers/platform/limits/)) Roughly 0.5 MB of unminified generated code plus 23 KB of protobufjs is far inside that, and the bundler minifies it. If startup time ever matters, a hand-trimmed `.proto` compiled with `protobufjs-cli` (only `FeedMessage`, `VehiclePosition`, `TripUpdate`) would shrink it, but nothing forces that now.
- The `engines.node >= 22` field is advisory for npm; the Workers runtime is not Node, so it does not block install or bundling.

## 4. Durable Object SQLite storage

Source: [Durable Object limits](https://developers.cloudflare.com/durable-objects/platform/limits/), [FAQ](https://developers.cloudflare.com/durable-objects/reference/faq/), [Pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/), [SQLite storage API](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/), [Storage API](https://developers.cloudflare.com/durable-objects/api/storage-api/), [Access storage](https://developers.cloudflare.com/durable-objects/best-practices/access-durable-objects-storage/).

| Limit | Workers Free | Workers Paid | Page |
| --- | --- | --- | --- |
| Storage per object (SQLite) | 1 GB | 10 GB | [FAQ](https://developers.cloudflare.com/durable-objects/reference/faq/) ("10 GB on Workers Paid, or 1 GB on the Free plan"); [DO limits](https://developers.cloudflare.com/durable-objects/platform/limits/) (10 GB) |
| Storage per account | 5 GB | Unlimited | [DO limits](https://developers.cloudflare.com/durable-objects/platform/limits/) |
| Durable Object classes per account | 100 | 500 | [DO limits](https://developers.cloudflare.com/durable-objects/platform/limits/) |
| Rows per table | unlimited, within per-object storage | same | [DO limits](https://developers.cloudflare.com/durable-objects/platform/limits/) |
| Columns per table | 100 | 100 | [DO limits](https://developers.cloudflare.com/durable-objects/platform/limits/) |
| String, BLOB, or row size | 2 MB | 2 MB | [DO limits](https://developers.cloudflare.com/durable-objects/platform/limits/) |
| SQL statement length | 100 KB | 100 KB | [DO limits](https://developers.cloudflare.com/durable-objects/platform/limits/) |
| Bound parameters per query | 100 | 100 | [DO limits](https://developers.cloudflare.com/durable-objects/platform/limits/) |
| Rows read | 5 million / day | 25 billion / month included, then $0.001 per million | [pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/) |
| Rows written | 100,000 / day | 50 million / month included, then $1.00 per million | [pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/) |
| Stored data | 5 GB total | 5 GB-month included, then $0.20 per GB-month | [pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/) |

Storage is measured in decimal GB (1 GB = 1,000,000,000 bytes). When an object reaches its storage limit, writes fail. An empty SQLite database uses about 12 KB. ([DO limits](https://developers.cloudflare.com/durable-objects/platform/limits/), [FAQ](https://developers.cloudflare.com/durable-objects/reference/faq/)) SQLite storage billing has a target start date of January 7, 2026; usage after that date is charged. ([pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/))

**Row and query costs.** Billing is by rows, not statements: each row affected by `INSERT`/`UPDATE`/`DELETE` is one row written, deletes count as writes, and "every row update of an index counts as an additional row." Reads count rows scanned; `cursor.rowsRead` and `cursor.rowsWritten` on the `sql.exec()` cursor expose the billed counts. ([sqlite-storage-api](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/), [pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/)) The 14-day prune (`DELETE ... WHERE t < ?`) is therefore paid twice: once as rows written on insert, once on delete, plus index rows each time. Query pricing and limits are "intended to be identical" between D1 and SQLite-backed Durable Objects. ([access storage](https://developers.cloudflare.com/durable-objects/best-practices/access-durable-objects-storage/))

**Write throughput at one batch per 10 s.** `sql.exec()` is synchronous and a single call may contain multiple semicolon-separated statements; `transactionSync()` wraps a synchronous callback. ([sqlite-storage-api](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/)) Writes with no intervening `await` are coalesced and "submitted atomically," and by default the runtime will "pause outgoing network messages from the Durable Object until all previous writes have been confirmed flushed to disk" (output gate), so a tick's inserts are durable before any WebSocket broadcast leaves the object. `allowUnconfirmed: true` opts out; `sync()` waits for pending writes. ([storage-api](https://developers.cloudflare.com/durable-objects/api/storage-api/)) The pages publish no rows-per-second ceiling; the only throughput figure is the soft limit of 1,000 requests per second per object. One batch of a few dozen rows every 10 s is nowhere near any published limit; the binding constraint is the Free plan's 100,000 rows written per day (section 8).

**Recovery.** Point-in-time recovery can restore the whole embedded database "to any point in time in the past 30 days" via bookmarks (`getCurrentBookmark()`, `getBookmarkForTime()`, `onNextSessionRestoreBookmark()`); not available in local dev. ([sqlite-storage-api](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/)) Enable SQLite via a migration with `new_sqlite_classes`; new KV-backed namespaces are no longer created for accounts without one, and Free accounts get SQLite only. ([access storage](https://developers.cloudflare.com/durable-objects/best-practices/access-durable-objects-storage/), [DO limits](https://developers.cloudflare.com/durable-objects/platform/limits/))

## 5. D1 as an archive

Source: [D1 limits](https://developers.cloudflare.com/d1/platform/limits/), [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/), [D1Database binding API](https://developers.cloudflare.com/d1/worker-api/d1-database/), [DurableObject base class](https://developers.cloudflare.com/durable-objects/api/base/), [Workers limits](https://developers.cloudflare.com/workers/platform/limits/).

| Limit | Workers Free | Workers Paid | Page |
| --- | --- | --- | --- |
| Databases per account | 10 | 50,000 | [D1 limits](https://developers.cloudflare.com/d1/platform/limits/) |
| Max database size | 500 MB | 10 GB (cannot be raised) | [D1 limits](https://developers.cloudflare.com/d1/platform/limits/) |
| Total storage per account | 5 GB | 1 TB | [D1 limits](https://developers.cloudflare.com/d1/platform/limits/) |
| Queries per Worker invocation | 50 | 1,000 | [D1 limits](https://developers.cloudflare.com/d1/platform/limits/) |
| Simultaneous connections to D1 per invocation | 6 | 6 | [D1 limits](https://developers.cloudflare.com/d1/platform/limits/) |
| Max SQL query duration | 30 s | 30 s | [D1 limits](https://developers.cloudflare.com/d1/platform/limits/) |
| Columns / row size / statement length / bound params | 100 / 2 MB / 100 KB / 100 | same | [D1 limits](https://developers.cloudflare.com/d1/platform/limits/) |
| Time Travel window | 7 days | 30 days | [D1 limits](https://developers.cloudflare.com/d1/platform/limits/) |
| Rows read | 5 million / day | 25 billion / month included, then $0.001 per million | [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/) |
| Rows written | 100,000 / day | 50 million / month included, then $1.00 per million | [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/) |
| Storage | 5 GB total | 5 GB included, then $0.75 per GB-month | [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/) |

Row accounting matches Durable Object SQLite: reads count rows scanned, not returned; a write to an indexed column counts as two rows written. On Free, hitting the daily read or write cap blocks queries until 00:00 UTC; hitting the storage cap blocks inserts. No egress charge. ([D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/)) Note that D1 storage beyond the included 5 GB costs $0.75 per GB-month against $0.20 for Durable Object SQLite, so D1 is not the cheaper place for bulk rows; its advantage is the dashboard/CLI, Time Travel, and that it can be queried by a Worker without going through the collector object.

**How a Durable Object writes to it.** The Durable Object constructor receives `env`, which "contains the environment bindings available to this Durable Object, as defined in your Wrangler configuration." ([base](https://developers.cloudflare.com/durable-objects/api/base/)) A `d1_databases` binding in `wrangler.jsonc` is therefore available as `this.env.ARCHIVE` inside `alarm()`. Each D1 call is a subrequest (section 2). `env.DB.batch([...prepared])` sends many statements in one round trip; "Batched statements are SQL transactions" that abort or roll back on failure, and results carry `meta.rows_read` / `meta.rows_written`. The page states no maximum statements per batch; per-statement limits (100 bound parameters, 100 KB) apply to each. `exec()` is for one-shot maintenance only. ([d1-database](https://developers.cloudflare.com/d1/worker-api/d1-database/)) A nightly alarm branch that copies the previous day's rows into D1 in a few `batch()` calls stays well under 50 queries per invocation even on Free.

## 6. TanStack Start on Workers

Source: [TanStack Start hosting guide](https://tanstack.com/start/latest/docs/framework/react/guide/hosting), [Cloudflare framework guide: TanStack Start](https://developers.cloudflare.com/workers/framework-guides/web-apps/tanstack-start/), [Vite plugin](https://developers.cloudflare.com/workers/vite-plugin/), [Vite plugin API](https://developers.cloudflare.com/workers/vite-plugin/reference/api/), [Static assets billing](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/), [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/).

**Deploy path.** TanStack lists Cloudflare as one of three "Official Hosting Partners" (Cloudflare, Netlify, Railway); "The official Cloudflare Workers setup currently uses Vite through `@cloudflare/vite-plugin`." Steps from the two guides, which agree:

1. `npm create cloudflare@latest -- my-app --framework=tanstack-start` for a new app, or add `@cloudflare/vite-plugin` and `wrangler` as dev dependencies to an existing one. Running `npx wrangler deploy` in a project with no Wrangler config detects TanStack Start and generates one.
2. `vite.config.ts`: `plugins: [cloudflare({ viteEnvironment: { name: 'ssr' } }), tanstackStart(), viteReact()]`, in that order. Remove any `nitro()` plugin.
3. `wrangler.jsonc`: `"main": "@tanstack/react-start/server-entry"`, `"compatibility_flags": ["nodejs_compat"]`, a current `compatibility_date` (TanStack's example uses `2025-09-02`), `"observability": { "enabled": true }`. Neither guide shows an `assets` block; the Vite plugin handles asset output.
4. Scripts: `dev: vite dev`, `build: vite build`, `preview: vite preview`, `deploy: npm run build && wrangler deploy`, `cf-typegen: wrangler types`. Remove the Node `start` script.
5. Bindings: `import { env } from "cloudflare:workers"` in server code; declare bindings in Wrangler; rerun `cf-typegen`.

**Known gaps and caveats.**

- Durable Objects need a custom entry. The Cloudflare guide says that to add Queues, Cron Triggers, Durable Objects, or Workflows you create your own server entry that imports the TanStack handler and exports `fetch` (and `queue`/`scheduled` as needed), point `main` at that file, and enable `upload_source_maps`. The collector class is exported from this same file. This is the one structural requirement for this project.
- "Cloudflare does not support TanStack Start projects that use Rsbuild." Vite only. ([framework guide](https://developers.cloudflare.com/workers/framework-guides/web-apps/tanstack-start/))
- Prerendering runs at build time against local env vars and local binding storage; use remote bindings for production data. In CI set `CLOUDFLARE_INCLUDE_PROCESS_ENV=true` if secrets are missing at build. ([framework guide](https://developers.cloudflare.com/workers/framework-guides/web-apps/tanstack-start/))
- The Vite plugin runs Workers code in Miniflare locally and `vite preview` works on the build output; `remoteBindings` defaults to `true`; state persists in `.wrangler/state`. The plugin pages do not list Durable Objects or alarms as a dev feature either way. ([vite-plugin](https://developers.cloudflare.com/workers/vite-plugin/), [api](https://developers.cloudflare.com/workers/vite-plugin/reference/api/))
- Static assets: "Requests to static assets are free and unlimited," no storage charge, 20,000 files per version on Free and 100,000 on Paid, 25 MiB per file. SSR requests are billed as Worker requests: 100,000 / day on Free; on Paid 10 million / month included then $0.30 per million, with 30 million CPU-ms included then $0.02 per million. With `run_worker_first` on Free, requests over the daily cap get a 429 rather than falling back to assets. ([static assets billing](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/), [workers limits](https://developers.cloudflare.com/workers/platform/limits/), [workers pricing](https://developers.cloudflare.com/workers/platform/pricing/))

Nothing read this session blocks TanStack Start on Workers for this app.

## 7. Free-plan versus paid-plan differences that matter here

| Item | Workers Free | Workers Paid ($5 / month minimum) |
| --- | --- | --- |
| Durable Object requests (incl. alarms) | 100,000 / day | 1M / month, then $0.15 / M |
| Durable Object duration | 13,000 GB-s / day | 400,000 GB-s / month, then $12.50 / M GB-s |
| SQLite rows written (incl. `setAlarm`, index rows, deletes) | 100,000 / day, then writes fail until 00:00 UTC | 50M / month, then $1.00 / M |
| SQLite rows read | 5M / day | 25B / month, then $0.001 / M |
| Storage per object | 1 GB | 10 GB |
| Storage per account (DO) | 5 GB | Unlimited |
| Subrequests per invocation | 50 | 10,000 |
| Worker HTTP request CPU | 10 ms | 30 s default, 5 min max |
| Worker requests (SSR) | 100,000 / day | 10M / month, then $0.30 / M |
| D1 database size | 500 MB | 10 GB |
| D1 queries per invocation | 50 | 1,000 |
| Static asset files per version | 20,000 | 100,000 |

Pages: [DO pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/), [DO limits](https://developers.cloudflare.com/durable-objects/platform/limits/), [FAQ](https://developers.cloudflare.com/durable-objects/reference/faq/), [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/), [D1 limits](https://developers.cloudflare.com/d1/platform/limits/).

## 8. Implications for the collector

**What a 10 s alarm loop costs per month.** One alarm every 10 s is 8,640 alarms per day, or 259,200 per 30-day month. Both feeds share this one loop (one alarm per object), with the GTFS-RT feed fetched on every tick or every other tick.

- Requests: 8,640 / day is under the Free cap of 100,000 / day with room for browser WebSocket traffic; on Paid, 259,200 / month is inside the 1M included, so $0.
- Duration, worst case (object resident and billed every second of the month): 0.128 GB x 86,400 s = 11,059 GB-s / day, under the Free 13,000 GB-s / day; 0.128 GB x 2,592,000 s = 331,776 GB-s / month, under the Paid 400,000 GB-s included, so $0. The margin on Free is thin (about 15 percent), and it assumes no second object. If the object hibernates between ticks (no timers, no open sockets using the standard API, no pending I/O), billed duration is much lower; browsers connected via the Hibernation WebSocket API do not prevent that.
- `setAlarm()` writes: 8,640 rows / day, about 9 percent of the Free write budget before any monitoring record is stored.
- Paid total for the alarm loop alone: $5 (plan minimum), everything else inside included amounts.

**Does 14 days x ~150k rows fit one Durable Object's SQLite?** Reading the ticket's figure as about 150k monitoring-record rows per day (position fixes plus arrival predictions for the CAT fleet at a 10 s cadence), the retained set is about 2.1M rows.

- Size: the per-object ceiling is 1 GB on Free and 10 GB on Paid. 2.1M rows fit in 1 GB if the average row plus its index entries stays under about 475 bytes; a position fix (vehicle id, fix time, lat, lon, heading, speed, source, trip id) is well under that, so 14 days fits on Free and is a rounding error on Paid. If the figure is instead 150k rows total over 14 days, everything below is 14x more comfortable.
- Rows written: 150k inserts / day already exceeds the Free plan's 100,000 rows written / day, and each index roughly doubles the count, and the 14-day prune charges each row again as a delete. On Free the collector would stop writing partway through each day. On Paid: about 150k x (1 + indexes + 1 delete) ~ 450k–600k rows / day, roughly 13.5–18M / month, inside the 50M included, so $0. This is the one limit that forces Paid at this volume. Ways to stay on Free: fewer, wider rows (one row per transit vehicle per tick carrying both sources, about 30 vehicles x 8,640 ticks = 260k / day, still over), or one row per tick holding a JSON blob of all position fixes (8,640 rows / day, under the cap, at the cost of per-row queries); or write monitoring records in 10 s batches to D1 instead, which has the identical 100,000 / day Free write cap, so that does not help on Free.
- Rows read: 5M / day on Free covers monitoring queries if they use indexes; a full scan of 2.1M rows twice would exhaust it. Index on (vehicle, fix time) and on fix time for the prune.
- Account storage: 5 GB on Free is shared with D1; one object at under 1 GB is fine.

**Does anything block TanStack Start on Workers?** No. The documented deploy path is Vite + `@cloudflare/vite-plugin` + Wrangler, and Cloudflare is an official TanStack hosting partner. The one requirement specific to this project is a custom server entry that re-exports the TanStack `fetch` handler alongside the collector's Durable Object class, with `main` pointed at it. Rsbuild is unsupported, which does not affect a Vite project.

**Design notes that fall out of the limits.**

- Make `alarm()` idempotent (at-least-once delivery, rerun on another machine after termination); key position fixes on (source, vehicle, fix time) with `INSERT OR IGNORE`.
- Never let `alarm()` throw on feed-vendor errors; record the failure as a monitoring record and reschedule. Schedule from the intended tick time to avoid drift.
- In the constructor, call `getAlarm()` and only `setAlarm()` when it returns `null`.
- Keep per-tick writes in one synchronous `transactionSync()` so they coalesce into one atomic flush; the output gate then guarantees browsers never see a position fix that was not persisted.
- Prune once a day, not every tick, and keep the prune behind an index on fix time so rows read stay small.
- D1 archive is optional and no cheaper per GB ($0.75 vs $0.20); adopt it only for the dashboard/Time Travel benefits or when a single object approaches 1 GB on Free.

## Sources

Cloudflare:
- https://developers.cloudflare.com/durable-objects/api/alarms/
- https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/
- https://developers.cloudflare.com/durable-objects/api/storage-api/
- https://developers.cloudflare.com/durable-objects/api/base/
- https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/
- https://developers.cloudflare.com/durable-objects/reference/in-memory-state/
- https://developers.cloudflare.com/durable-objects/reference/faq/
- https://developers.cloudflare.com/durable-objects/best-practices/access-durable-objects-storage/
- https://developers.cloudflare.com/durable-objects/platform/limits/
- https://developers.cloudflare.com/durable-objects/platform/pricing/
- https://developers.cloudflare.com/workers/platform/limits/
- https://developers.cloudflare.com/workers/platform/pricing/
- https://developers.cloudflare.com/workers/runtime-apis/nodejs/
- https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/
- https://developers.cloudflare.com/workers/framework-guides/web-apps/tanstack-start/
- https://developers.cloudflare.com/workers/vite-plugin/
- https://developers.cloudflare.com/workers/vite-plugin/reference/api/
- https://developers.cloudflare.com/d1/platform/limits/
- https://developers.cloudflare.com/d1/platform/pricing/
- https://developers.cloudflare.com/d1/worker-api/d1-database/

TanStack:
- https://tanstack.com/start/latest/docs/framework/react/guide/hosting

gtfs-realtime-bindings / protobufjs:
- https://raw.githubusercontent.com/MobilityData/gtfs-realtime-bindings/master/nodejs/package.json
- https://raw.githubusercontent.com/MobilityData/gtfs-realtime-bindings/master/nodejs/README.md
- https://raw.githubusercontent.com/MobilityData/gtfs-realtime-bindings/master/nodejs/gtfs-realtime.js
- https://registry.npmjs.org/gtfs-realtime-bindings
- https://registry.npmjs.org/protobufjs
- https://unpkg.com/protobufjs@8.2.1/dist/minimal/protobuf.min.js

Not read this session (returned 404/403): tanstack.com/.../framework/react/hosting (moved to /guide/hosting), developers.cloudflare.com/durable-objects/best-practices/access-durable-objects-from-a-worker/, npmjs.com package page (registry JSON used instead).
