# Does party-db fit the collector?

Research for ticket [#4](https://github.com/mhsnook/transit-map/issues/4), part of map issue [#1](https://github.com/mhsnook/transit-map/issues/1). Researched 2026-10-23 from primary sources (the party-db repo and npm record, the PartyServer and PartyKit docs, Cloudflare's Durable Objects docs, TanStack DB and Drizzle docs). Every claim links the source that states it.

## Fit verdict

**Fits with caveats.** Use party-db for the *live* collections (newest position fix per transit vehicle, current arrival predictions), which are small. Do **not** declare the monitoring record (≈2.1M rows at day 14) as a party-db collection: party-db's connect path sends a `SELECT *` snapshot of every declared table to every fresh client, and that does not scale to millions of rows. Keep the monitoring record as plain SQLite tables in the same Durable Object, written and read with Drizzle (or `ctx.storage.sql`), and served over HTTP or a non-realtime TanStack Query collection.

Three caveats that need action before the collector is built:

1. **TanStack DB version pin.** party-db's peer range is `@tanstack/db ^0.6.10`; the current TanStack DB release is 0.15.2 (2026-10-21). The maintainer deferred the 0.8 adoption review (party-db [#53](https://github.com/mhsnook/party-db/issues/53)). A fresh TanStack Start + TanStack DB project will need party-db's peer range bumped and retested.
2. **Workers Paid plan.** ≈150k rows/day exceeds the Free plan's 100,000 rows written/day before index rows are counted, and the Free plan caps a Durable Object at 1 GB.
3. **No upsert on the wire.** Writes are TanStack `ChangeMessage`s: `insert`, `update`, `delete`. The collector must know whether a transit vehicle's live row exists before it commits (an `update` that hits no row throws). This is a few lines, not a blocker.

If those are unacceptable, the best alternative is a **plain PartyServer `Server` on the same SQLite-backed Durable Object**, with Drizzle for the tables, `onAlarm` for the poll loop, and `this.broadcast()` of newest-position JSON to the sockets, feeding a hand-written TanStack DB `sync` function on the client. That is what party-db wraps; the trade is writing the sync/settlement code yourself and losing `?since` delta reconnects.

## What party-db is

Several unrelated projects share the name. The one for Cloudflare Durable Objects is **`party-db` on npm, source at [github.com/mhsnook/party-db](https://github.com/mhsnook/party-db)**, described as "Multiplexed TanStack DB collection sync over a PartyKit transport" ([npm record](https://registry.npmjs.org/party-db)). The others are not related: **Part-DB** ([Part-DB/Part-DB-server](https://github.com/Part-DB/Part-DB-server)), a PHP/Symfony electronics inventory system; several empty hobby repos named `partyDB`/`partydb`; and `@dataparty/api` / `nedb-party` on npm, which are different products.

- **Maintainer:** `msnook` on npm; repo owner `mhsnook` on GitHub. This is the same person who owns the transit-map repo, so the project author is also the library's maintainer.
- **License:** MIT ([npm record](https://registry.npmjs.org/party-db), [repo](https://github.com/mhsnook/party-db)).
- **Maturity:** The README's first line is "> incubating." Repo created 2026-06-24; last push 2026-10-23; 2 stars; no GitHub release. npm versions 0.0.1 (2026-08-25) through 0.0.5 (2026-09-15), all pre-1.0 ([npm record](https://registry.npmjs.org/party-db)). Open issues include a design for client RPCs ([#34](https://github.com/mhsnook/party-db/issues/34)) and a tombstone column ([#55](https://github.com/mhsnook/party-db/issues/55)). The README lists milestones 0, 1 and 2a as shipped: transparent mode, "RDBMS mode" with the authoritative copy in Durable Object SQLite or D1, and a Postgres write path ([README](https://github.com/mhsnook/party-db#readme)).
- **What it does:** "PartyDB connects your TanStack DB collections to your Database with optimistic updates and realtime sync … over a Cloudflare Durable Object via PartyKit." The server is a `PartyDbServer` class; the client is `createPartyDb(transport, [definePartyCollection(...)])` and "db.todos is a normal TanStack DB collection" ([README](https://github.com/mhsnook/party-db#readme)).

### Relationship to PartyKit and PartyServer

- **PartyServer** is Cloudflare's library: "The core library for building real-time applications with Durable Objects," in the [cloudflare/partykit](https://github.com/cloudflare/partykit) monorepo ("Powered by Durable Objects, Inspired by PartyKit"; the README calls the repo "a Work in Progress"). Latest npm release `partyserver` 0.5.10 (2026-08-03), ISC license ([npm record](https://registry.npmjs.org/partyserver)).
- **party-db depends on PartyServer, not PartyKit.** Its peer dependencies are `partyserver ^0.5.8`, `partysocket ^1.3.0`, `@tanstack/db ^0.6.10`, `zod ^4.0.0`, `@standard-schema/spec ^1.1.0` ([package.json on main](https://github.com/mhsnook/party-db/blob/main/package.json)). `PartyDbServer` is `extends Server<Env>` from `partyserver` with `static options = { hibernate: true }` ([src/server/party-db-server.ts](https://github.com/mhsnook/party-db/blob/main/src/server/party-db-server.ts)). The "PartyKit transport" in the description means the PartyServer/PartySocket wire, routed by PartyServer's `routePartykitRequest`.
- **The hosted PartyKit platform shuts down today.** docs.partykit.io states: "The hosted PartyKit platform is shutting down. Deploys stop on 16 October and the platform shuts down on 23 October 2026." The [migration guide](https://docs.partykit.io/guides/migrate-to-partyserver/) says PartyServer "runs as a plain Cloudflare Worker with Durable Objects in your own account" and that "the Workers free plan includes SQLite-backed Durable Objects." This project would deploy with Wrangler to Cloudflare directly, so the shutdown does not affect it.

## Can the Durable Object poll every ≈10 s and write rows?

**Yes.** Nothing in party-db prevents it, and the pieces are Cloudflare's, not party-db's.

- **Alarms.** PartyServer exposes `onAlarm()`, scheduled with `this.ctx.storage.setAlarm(Date)`; its README says alarms are "the only way to run code after the server has been evicted" ([PartyServer README](https://github.com/cloudflare/partykit/blob/main/packages/partyserver/README.md)). Cloudflare: each Durable Object holds one alarm; "If you call `setAlarm` when there is already one scheduled, it will override the existing alarm"; "Alarms have guaranteed at-least-once execution and are retried automatically when the `alarm()` handler throws"; "Only one instance of `alarm()` will ever run at a given time per Durable Object instance" ([Alarms API](https://developers.cloudflare.com/durable-objects/api/alarms/)). A 10 s loop is `onAlarm() { poll(); this.ctx.storage.setAlarm(Date.now() + 10_000) }`; Cloudflare's own example uses `setAlarm(Date.now() + 1000 * 10)` ([alarms example](https://developers.cloudflare.com/durable-objects/examples/alarms-api/)). The docs state no minimum interval. Limits: 30 s CPU per invocation, 15 min wall time per alarm invocation ([DO limits](https://developers.cloudflare.com/durable-objects/platform/limits/)).
- **Kick-off.** A Durable Object is created on demand, so something must set the first alarm: `onStart` with a `getAlarm()` check (the Alarms doc warns a waking object "runs its constructor before the alarm handler", so check before setting), plus a Workers cron `scheduled` handler as a watchdog that pings the collector ([migration guide](https://docs.partykit.io/guides/migrate-to-partyserver/) covers `triggers.crons`). party-db's `PartyDbServer.onStart` builds its core; a subclass chains `return super.onStart()` ([README](https://github.com/mhsnook/party-db#readme)).
- **Outbound fetch.** The JSON API and GTFS-RT feed are two subrequests per tick; the Workers limit is 50 per request on Free and 10,000 on Paid ([Workers limits](https://developers.cloudflare.com/workers/platform/limits/)). Ticket #5 covers these constraints in depth.
- **Writing rows.** Two paths, and the distinction matters:
  - **Declared collections (live rows the browsers watch):** write with `this.commit(batches)`. README: "When the code writing it is your own — a job, an agent, a webhook handler running inside the room's Durable Object — call `this.commit()` instead of your own `INSERT`, and the row syncs like any other write: a `seq`, an `_oplog` entry, and fan-out to every socket in the room." And: "Writing the same row with raw SQL instead would reach a freshly-connecting client (through the snapshot) and *never* an already-connected one, because only the oplog feeds the stream" ([README](https://github.com/mhsnook/party-db#readme); [cookbook 09](https://github.com/mhsnook/party-db/blob/main/docs/cookbooks/09-server-originated-writes.md); [architecture §14](https://github.com/mhsnook/party-db/blob/main/docs/architecture.md)). `commit()` shares the write queue with `POST /write`, so order equals `seq` order, and a database rejection throws.
  - **Undeclared tables (the monitoring record):** party-db never touches them. The SQLite adapter "assumes: your structured tables already exist … We never DDL them — your database is the authority" and only owns `_oplog` and blob tables ([src/server/sqlite-adapter.ts](https://github.com/mhsnook/party-db/blob/main/src/server/sqlite-adapter.ts)). Plain `INSERT`s (via Drizzle or `ctx.storage.sql.exec`) are correct here because no client subscribes to these tables.
- **Upsert.** `WriteEvent` is TanStack's `ChangeMessage` minus `key` ([src/protocol.ts](https://github.com/mhsnook/party-db/blob/main/src/protocol.ts)), so ops are `insert` / `update` / `delete`. "An update whose key matches **no row** … is rejected, not silently dropped" ([README](https://github.com/mhsnook/party-db#readme)). The collector keeps a set of transit vehicles it has inserted (or calls `adapter.readRows`) and picks the op accordingly.

## How browsers subscribe, and TanStack DB fit

- **Transport.** One hibernatable WebSocket per client per room (down) and `POST /write` (up). A fresh client "gets a full snapshot followed by a `ready` sentinel"; a reconnecting client sends `?since=<seq>` and "the server replays `_oplog WHERE seq > since`" ([architecture §8](https://github.com/mhsnook/party-db/blob/main/docs/architecture.md)). Many collections multiplex over one socket (§3). The server broadcasts every channel; per-connection subscriptions are an open item ([unspecified.md](https://github.com/mhsnook/party-db/blob/main/docs/unspecified.md), "Subscription / filtering").
- **TanStack DB fit.** This is party-db's whole purpose. The client's `applyBatch` "drives TanStack's `sync`" and the wire format "is TanStack DB's `write()` argument" ([README file table](https://github.com/mhsnook/party-db#readme); [architecture §2](https://github.com/mhsnook/party-db/blob/main/docs/architecture.md)). `useLiveQuery(db.vehicles)` on the map works as with any TanStack DB collection. party-db's own survey says no shipped TanStack DB adapter gives "both realtime sync and an all-in-one-DO backend"; "That gap is exactly what party-db fills" ([collection-types.md](https://github.com/mhsnook/party-db/blob/main/docs/collection-types.md)). TanStack DB's collection-options guide confirms the pattern: a WebSocket source writes the initial rows in one transaction, calls `markReady()`, and wraps each live message in `begin()/write()/commit()` ([TanStack DB guide](https://tanstack.com/db/latest/docs/guides/collection-options-creator)).
- **Snapshot size is the constraint.** The snapshot is `SELECT * FROM "<table>"` for every declared collection, materialized with `.toArray()` and sent as JSON `insert` ops ([sqlite-adapter.ts `snapshot()`](https://github.com/mhsnook/party-db/blob/main/src/server/sqlite-adapter.ts)). TanStack DB's overview recommends eager loading ("Loads entire collection upfront") for "<10k rows of mostly static data" and on-demand loading for ">50k rows" ([TanStack DB overview](https://tanstack.com/db/latest/docs/overview)). party-db's read-slicing design ("Electric-style shapes") is unbuilt ([unspecified.md](https://github.com/mhsnook/party-db/blob/main/docs/unspecified.md)). So declared collections must stay small: one row per transit vehicle for the newest position fix, and the current arrival predictions. The monitoring record is read through other means.
- **Version pin.** Peer `@tanstack/db ^0.6.10` vs. latest 0.15.2 (2026-10-21, [npm](https://registry.npmjs.org/@tanstack/db)). party-db #53 records that 0.8 adoption was "deferred until another dependency bump forces the peer range past `^0.6.10`" ([#53](https://github.com/mhsnook/party-db/issues/53)). Expect to do that bump.
- **Zod v4 required** for structured columns ([#57](https://github.com/mhsnook/party-db/issues/57); peer `zod ^4.0.0`). The collections' Zod schemas drive the column allowlist ([src/server/columns.ts](https://github.com/mhsnook/party-db/blob/main/src/server/columns.ts) via the README file table).

## Storage ceiling and the 14-day monitoring record

Cloudflare limits ([DO limits](https://developers.cloudflare.com/durable-objects/platform/limits/)):

- "Each SQLite-backed Durable Object has a storage limit of 10 GB on a Workers Paid plan" ("or 1 GB on the Free plan"); Free accounts are "limited to 5 GB total Durable Objects storage."
- "Maximum string, BLOB or table row size: 2 MB"; key + value combined 2 MB; SQL statement 100 KB; 100 columns per table; 100 bound parameters per query; no cap on rows per table.
- When full: "database or disk is full: SQLITE_FULL" on writes; reads keep working.
- `ctx.storage.sql.databaseSize` reports current bytes ([SQL storage API](https://developers.cloudflare.com/durable-objects/api/sql-storage/)); point-in-time recovery covers 30 days.

Pricing ([DO pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/)): Free plan "100,000 / day" rows written and "5 million / day" rows read, failing when exceeded; Paid includes "First 50 million / month" rows written, "First 25 billion / month" rows read, 5 GB-month storage then $0.20/GB-month. "Writing to columns referenced in an index will add at least one (1) additional row written" ([storage best practices](https://developers.cloudflare.com/durable-objects/best-practices/access-durable-objects-storage/)).

What 14 days × ≈150k rows/day means:

- **Rows:** ≈2.1M rows in the monitoring record. A position fix row (ids, lat/lon, heading, speed, fix time, received time, source) is on the order of 100–300 bytes; with two or three indexes, budget ≈0.5–1 KB per row. Estimate **≈1–2 GB** at day 14, i.e. 10–20% of the Paid 10 GB cap and over the Free 1 GB per-object cap. Each row is far below the 2 MB row limit. (Estimate: ours, not Cloudflare's.)
- **Writes:** ≈150k rows/day + index rows ≈ 300–600k rows written/day, i.e. 9–18M/month, within Paid's 50M included; above Free's 100k/day. **The Paid plan is required.**
- **The `_oplog`:** `PartyDbServer.oplogRetention = 10_000` by default, compacted after each write; 0 means unbounded ([party-db-server.ts](https://github.com/mhsnook/party-db/blob/main/src/server/party-db-server.ts); [architecture §8](https://github.com/mhsnook/party-db/blob/main/docs/architecture.md)). One `commit()` per 10 s tick is ≈8,640 oplog rows/day, so the default retention covers about a day of reconnect deltas; older cursors get a reset snapshot of the (small) live tables. If the monitoring record were committed through party-db, 2.1M `_oplog` JSON rows would roughly double storage and every fresh client would receive 2.1M rows over the socket. That is the reason not to declare it.
- **Retention job:** a daily `DELETE FROM position_fix WHERE received_at < now - 14d` in `onAlarm` keeps the ceiling flat. If the ceiling bites anyway, D1 as archive is the standing decision in #1.

## Drizzle and the query layer

- **party-db's own query layer** is hand-built SQL over `ctx.storage.sql.exec` and `ctx.storage.transactionSync`, through a `SqlEngine` interface `{ exec, transaction }` ([sqlite-adapter.ts](https://github.com/mhsnook/party-db/blob/main/src/server/sqlite-adapter.ts)). It expects your structured tables to exist with columns matching the Zod schema; it CRUDs with `RETURNING` and never runs DDL.
- **Drizzle can target the same storage.** Drizzle ships `drizzle-orm/durable-sqlite` (export present in drizzle-orm 0.45.4, [npm](https://registry.npmjs.org/drizzle-orm)): `drizzle(ctx.storage)` and `migrate(db, migrations)` from `drizzle-orm/durable-sqlite/migrator`, run inside `ctx.blockConcurrencyWhile` on start; wrangler needs `new_sqlite_classes`, a `Text` rule for `**/*.sql`, and `nodejs_compat` ([Drizzle docs](https://orm.drizzle.team/docs/connect-cloudflare-do)). Both libraries address one SQLite database, so Drizzle migrations create the tables party-db CRUDs over, and Drizzle reads the monitoring record.
- **Division of labour:** Drizzle owns DDL/migrations and all monitoring-record reads and writes; party-db owns writes to the live collections (`commit()`) and their fan-out. Never write a declared collection's table through Drizzle (architecture §14). The Zod schemas party-db needs must match the Drizzle table shape; keep them side by side or derive one from the other.

## Alternatives

1. **Plain PartyServer `Server` + SQLite storage + Drizzle (best alternative).** Same Durable Object, same `onAlarm` loop, same tables. Replace party-db with `this.broadcast(JSON.stringify(liveRows))` after each tick and a ~50-line TanStack DB `sync` function on the client (`begin/write/commit/markReady`, per the [TanStack guide](https://tanstack.com/db/latest/docs/guides/collection-options-creator)). You lose `?since` deltas and optimistic writes (not needed: browsers never write), and you write the ordering/dedupe yourself. Lower dependency risk (no 0.6.x pin, no Zod v4 requirement), slightly more code. Reasonable if the TanStack DB bump in party-db turns out to be heavy.
2. **Workers + D1.** D1 has no WebSocket or alarm; a Worker cron cannot poll every 10 s (Cron Triggers take five-field expressions, so the finest schedule is "At every minute", [Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/)), and realtime would still need a Durable Object. party-db's own docs note D1 is "a farther-away box" with async persistence ([architecture, Roadmap](https://github.com/mhsnook/party-db/blob/main/docs/architecture.md)). D1 remains the archive option from #1, not the collector.

## Sources

- party-db npm record: https://registry.npmjs.org/party-db (also https://www.npmjs.com/package/party-db)
- party-db repo and README: https://github.com/mhsnook/party-db
- party-db architecture: https://github.com/mhsnook/party-db/blob/main/docs/architecture.md
- party-db open questions: https://github.com/mhsnook/party-db/blob/main/docs/unspecified.md
- party-db collection types survey: https://github.com/mhsnook/party-db/blob/main/docs/collection-types.md
- party-db cookbook 09, server-originated writes: https://github.com/mhsnook/party-db/blob/main/docs/cookbooks/09-server-originated-writes.md
- party-db server class: https://github.com/mhsnook/party-db/blob/main/src/server/party-db-server.ts
- party-db SQLite adapter: https://github.com/mhsnook/party-db/blob/main/src/server/sqlite-adapter.ts
- party-db core (connect path): https://github.com/mhsnook/party-db/blob/main/src/server/core.ts
- party-db protocol: https://github.com/mhsnook/party-db/blob/main/src/protocol.ts
- party-db package.json: https://github.com/mhsnook/party-db/blob/main/package.json
- party-db issue #53 (TanStack DB 0.8 review deferred): https://github.com/mhsnook/party-db/issues/53
- party-db issue #57 (Zod v4): https://github.com/mhsnook/party-db/issues/57
- PartyServer monorepo: https://github.com/cloudflare/partykit
- PartyServer README: https://github.com/cloudflare/partykit/blob/main/packages/partyserver/README.md
- partyserver npm record: https://registry.npmjs.org/partyserver
- PartyKit docs (shutdown notice): https://docs.partykit.io/
- PartyKit → PartyServer migration guide: https://docs.partykit.io/guides/migrate-to-partyserver/
- Cloudflare Durable Objects limits: https://developers.cloudflare.com/durable-objects/platform/limits/
- Cloudflare Durable Objects pricing: https://developers.cloudflare.com/durable-objects/platform/pricing/
- Cloudflare Alarms API: https://developers.cloudflare.com/durable-objects/api/alarms/
- Cloudflare alarms example: https://developers.cloudflare.com/durable-objects/examples/alarms-api/
- Cloudflare SQL storage API: https://developers.cloudflare.com/durable-objects/api/sql-storage/
- Cloudflare storage best practices: https://developers.cloudflare.com/durable-objects/best-practices/access-durable-objects-storage/
- Cloudflare Workers limits: https://developers.cloudflare.com/workers/platform/limits/
- Cloudflare Cron Triggers: https://developers.cloudflare.com/workers/configuration/cron-triggers/
- Drizzle, Cloudflare Durable Objects SQLite: https://orm.drizzle.team/docs/connect-cloudflare-do
- drizzle-orm npm record: https://registry.npmjs.org/drizzle-orm
- TanStack DB overview: https://tanstack.com/db/latest/docs/overview
- TanStack DB collection options creator guide: https://tanstack.com/db/latest/docs/guides/collection-options-creator
- @tanstack/db npm record: https://registry.npmjs.org/@tanstack/db
- Unrelated namesake, Part-DB: https://github.com/Part-DB/Part-DB-server
