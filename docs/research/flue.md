# Research: What is flue, and can it query a Durable Object?

Ticket: [#6](https://github.com/mhsnook/transit-map/issues/6), part of [#1](https://github.com/mhsnook/transit-map/issues/1).
Question: for the `/chat` page that answers questions about the monitoring record held in a Durable Object's SQLite, is flue a fit, and can a flue tool run read-only SQL against that monitoring record?

Researched 2026-10-23 against the flue repo, npm, the flue docs site, the Cloudflare Agents and Durable Objects docs, the Pi repo, and the Anthropic TypeScript SDK. Versions quoted are the ones live on that date.

## Short answer

- **flue is real and maintained.** It is `withastro/flue`, the Astro team's TypeScript "agent harness framework" (Apache-2.0, 2.3.0 released 2026-10-12). It is the only framework with that name in the agent space; the npm name `flue` itself is unrelated and the published packages are scoped `@flue/*`.
- **It runs on Cloudflare Workers.** Each agent function becomes a Durable Object class that extends the Cloudflare Agents SDK `Agent`, with the conversation stored in that object's SQLite.
- **A flue tool can reach the monitoring record, but only indirectly.** Durable Object storage is private to its object, so the tool must call an RPC method on the collector Durable Object through a binding (`import { env } from 'cloudflare:workers'`), and the collector method runs the SQL. The same is true for every alternative; it is a Durable Objects rule, not a flue limit.
- **Fit verdict: poor fit for `/chat` as described.** flue is built for autonomous, sandboxed, long-running agents and wants to own the Vite build and the HTTP route map. The Cloudflare Agents SDK chat agent (`AIChatAgent`) or the plain Anthropic SDK tool runner gives the `/chat` page what it needs with far less machinery. Details in the Fit verdict section.

## 1. What flue is

### Identity

| Fact | Value | Source |
| --- | --- | --- |
| Repo | `github.com/withastro/flue`, "The sandbox agent framework." | GitHub API |
| Maintainer | Astro team (`withastro` org); npm maintainers `fredkschott`, `matthewp`; 22 GitHub contributors | GitHub API, npm registry |
| License | Apache-2.0 (repo `LICENSE` and `@flue/runtime` package.json) | GitHub, npm |
| Docs | `flueframework.com` | README |
| Created | 2026-02-07 | GitHub API |
| First npm publish | `@flue/runtime` 0.6.0 on 2026-05-13/14 | npm registry, CHANGELOG |
| 1.0 beta | 1.0.0-beta.1 on 2026-06-16; Cloudflare announced it 2026-06-17 | CHANGELOG, Cloudflare blog |
| First stable | 2.0.0 on 2026-07-31 | CHANGELOG |
| Current | `@flue/runtime` 2.3.0, published 2026-10-12; last push 2026-10-17 | npm registry, GitHub API |
| Stars / open issues | 8,520 stars, 47 open issues | GitHub API |

Maturity reading: eight months old, five months on npm, under three months since the first stable release, with releases every one to two weeks. Active, but young; the Cloudflare target docs still describe tracing as "open beta" and the persisted format carries a version that refuses to open databases from newer versions "with no in-place migration".

### Shape

flue sits at the top of a three-layer stack that Cloudflare's post describes: **framework** (flue: project structure, CLI, integrations) over **harness** (Pi, the open agent loop behind OpenClaw: `@earendil-works/pi-ai` and `pi-agent-core`, MIT, 1.4.0) over **runtime** (Cloudflare Agents SDK or Node). flue's own docs: "Flue builds on Pi, the open agent harness behind OpenClaw" and "the harness is the core of the framework, not a feature of it."

An agent is a function in a `'use agent'` module. Hooks run on every render (before every model call) and the return value is the system instruction:

```ts
'use agent';
import { useModel, useTool } from '@flue/runtime';

export function Assistant() {
  useModel('anthropic/claude-haiku-4-5');
  return 'You are a helpful assistant. Keep replies short.';
}
```

(Verbatim from the Getting Started page; the model id is theirs, not a recommendation.)

Packages: `@flue/runtime` (harness, sessions, tools, sandbox), `@flue/vite` (build for Node and Cloudflare), `@flue/cli` (`flue run`, blueprints), `@flue/sdk` (client), `@flue/react` (hooks), plus adapters for Postgres, libSQL, MySQL, MongoDB, Redis, OpenTelemetry and channel packages for Slack, Teams, Discord, GitHub, Linear, WhatsApp, Zendesk and others.

### What it adds over calling the Claude API directly with tool use

What the docs claim, and what it means for us:

- **Durable conversation log.** "Every accepted submission reaches exactly one durable terminal outcome"; "at-least-once execution over exactly-once recording". On Cloudflare the log is the Durable Object's SQLite, recovery runs on wake, and interrupted work is retried only when flue can prove the model call never started. A hand-rolled loop has none of this.
- **Agent composition hooks.** `useModel`, `useTool`, `useSkill`, `useSubagent`, `useInstruction`, `useSandbox`, `useMcpConnection`, `usePersistentState`, `useDataWriter`, lifecycle hooks. Tools can be mounted conditionally per render.
- **Skills, subagents, MCP, sandboxes.** Markdown skills, delegated subagents, remote MCP servers, and virtual or container sandboxes with bash/read/write/glob/grep tools built in. None of these are needed to answer "how is service running today?" from a monitoring record.
- **Client plumbing.** `createAgentRouter` (Hono routes `POST /:id`, `GET /:id`, `POST /:id/abort`, attachments), `@flue/sdk` client, `@flue/react` `useFlueAgent` with history catch-up and SSE live updates.
- **Model-provider neutrality via Pi.** Model strings are `provider/model`; Pi's generated catalog includes `claude-opus-5-5`, `claude-sonnet-5-5`, `claude-haiku-5-5` and `claude-fable-5`, and `useModel` takes `thinkingLevel: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'`. An Anthropic model id not in Pi's catalog throws, so new models wait on a Pi release.

Costs that come with it:

- Schemas are **Valibot**, not Zod (the rest of our stack and the Cloudflare chat agent use Zod).
- `@flue/runtime` depends on `@earendil-works/pi-ai`, which depends on `openai`, `@google/genai`, `@aws-sdk/client-bedrock-runtime` and `@anthropic-ai/sdk` together (4.3 MB unpacked). Vite tree-shaking will drop some of it; flue publishes no bundle-size guidance.
- Requires `nodejs_compat`, `compatibility_date >= 2026-04-01`, a Vite build with `@cloudflare/vite-plugin`, a Hono `app.ts` as the required route map, and migrations listing every generated `Flue<Name>Agent` class in `new_sqlite_classes`.
- The router "has no built-in auth". Fine for a personal tool with no login, but worth knowing.

## 2. Runtime fit: Workers, Durable Objects, bundle size, streaming

**Workers and Durable Objects.** The Cloudflare target is first-class. Every exported capitalized function in a `'use agent'` module gets its own Durable Object class named `Flue<Name>Agent` and a binding `FLUE_<NAME>_AGENT`; flue writes these into a generated `.flue-vite.wrangler.jsonc` and never edits the authored one. The generated class extends the Cloudflare Agents SDK `Agent` (the source comment in `packages/runtime/src/cloudflare/flue-agent-class.ts`: "The Cloudflare Agents SDK `Agent` class (the generated entry imports it from the user's `agents` package)"). Cloudflare's post says the same: "Flue agents extend the Agents SDK `Agent` class, backed by a Durable Object." Each conversation id is one Durable Object instance; "Canonical conversation streams, immutable attachments, and accepted submissions live in the owning Durable Object's SQLite storage automatically."

**Execution model.** A `POST /agents/<name>/<id>` returns `202` on admission; "Accepted work runs inside the Durable Object's alarm, as one platform-visible invocation per response. Admission returns first, and the response starts on the next alarm tick." One alarm runs at a time per object, so scheduled callbacks that fall due during a response wait. The 15-minute alarm wall-time limit on Durable Objects bounds a turn.

**Streaming.** Not a streamed HTTP response from the POST. Clients read the event stream separately: "Live updates default to SSE, falling back to Durable Streams long-polling"; events are stored and replayable from any offset. `@flue/react`'s `useFlueAgent({ url })` loads the canonical snapshot, then follows live updates; partial text is best-effort and the completed message is authoritative. Tool `log.*` lines and `useDataWriter` parts stream to the client as events the model never sees.

**Bundle size.** No official figure. `@flue/runtime` is 2.65 MB unpacked (all targets, types included); Pi adds the multi-provider SDK set above. The Workers limits page (read 2026-10-23) gives a 64 MiB uncompressed script limit with no compressed limit, so size is not a blocker; cold-start weight is the practical concern and would need measuring.

**Stack friction.** flue wants to own the Vite config (`flue()` before `cloudflare()`) and a Hono default export in `app.ts`; `src/cloudflare.ts` "must not export a default `fetch`". Our map app is TanStack Start on its own Worker. The documented way to combine them is a second Worker for the agents and a service binding: `createFlueClient({ fetch: (input, init) => env.AGENT_APP.fetch(new Request(input, init)) })`. Running both in one Worker is not documented. `flue run` is Node-only and fails for agents that import `cloudflare:*`, so local runs go through `vite dev`.

## 3. How tools are defined, and whether a tool can reach a Durable Object's SQLite

### Tool definition

`defineTool({ name, description, input?, output?, harness?, durable?, run })` validates and freezes the definition. `input` is a top-level Valibot object schema; `output` is optional and validated when present. `run` receives a `ToolContext` with `data` (parsed input), `signal` (AbortSignal), `log` (`info`/`warn`/`error`, streamed to clients, hidden from the model), `toolCallId`, plus `harness` when `harness: true` (sandbox, scratch `prompt()`) and `step` when `durable: true` (`step.do(name, fn)` records a side effect so recovery replays it). It returns `{ output?, terminate? }` or a bare string; a thrown error becomes a tool error the model sees. `useTool(tool)` mounts it for the current render; reserved names (`task`, `activate_skill`, `read_skill_resource`) and duplicates throw.

The hooks reference says `run` executes outside the render, so no hooks inside it; agent state comes in through closures (`usePersistentState` setters are safe to call there).

### Reaching the monitoring record

Three facts decide this:

1. **Durable Object storage is private to its object.** Cloudflare: "A Durable Object's attached storage is private to its unique instance and cannot be accessed by other objects." The SQL API is `ctx.storage.sql` inside the object. So no caller, flue or otherwise, opens the collector's SQLite from outside; it calls a method on the collector and the collector runs `sql.exec`.
2. **flue tools reach bindings through `env`.** The Cloudflare target guide: "Agents reach bindings through `env`. In an agent module, the sandbox example imports `env` from `'cloudflare:workers'`"; custom Durable Objects are exported from `src/cloudflare.ts`, declared in `wrangler.jsonc`, and "access them through `env`". Nothing in `ToolContext` carries `env`; the import is the documented path.
3. **Durable Object RPC.** With `compatibility_date >= 2024-04-03`, public methods on a `DurableObject` subclass are callable on a stub: `const stub = env.MY_DURABLE_OBJECT.getByName("foo"); await stub.sayHello();`.

So yes, with this shape:

```ts
// tools/monitoring.ts (flue Cloudflare target)
import { defineTool } from '@flue/runtime';
import { env } from 'cloudflare:workers';
import * as v from 'valibot';

export const queryMonitoringRecord = defineTool({
  name: 'query_monitoring_record',
  description: 'Run one read-only SQL SELECT against the monitoring record (position fixes, arrival predictions, observed arrivals, position staleness, datasource divergence).',
  input: v.object({ sql: v.string() }),
  async run({ data }) {
    const collector = (env as Env).COLLECTOR.getByName('cat');
    const rows = await collector.readOnlyQuery(data.sql); // RPC into the collector Durable Object
    return JSON.stringify(rows);
  },
});
```

The collector Durable Object owns the read-only rule. `sql.exec` runs any statement, so `readOnlyQuery` must reject anything that is not a single `SELECT`/`WITH`, cap rows, and bound the result size (the model sees the whole `output`). `durable: true` is unnecessary for a read.

What flue does **not** give here: a shortcut to the collector's SQLite. `@flue/runtime/cloudflare` exports `getCloudflareContext()` with `storage.sql`, but that is the flue agent's own Durable Object (the conversation store), and the Cloudflare target rejects a user `db.ts`. Folding the collector into the flue agent class via `extend({ base, wrap })` (which can add `onStart()` / `scheduleEvery()`) is possible in principle but ties collector identity to a conversation id, since each conversation is its own object. Keep the collector separate.

## 4. Alternatives

### A. Cloudflare Agents SDK chat agent (recommended)

`agents` 0.30.0 (MIT, 2026-10-22) plus `@cloudflare/ai-chat` 0.12.2 (MIT). `Agent` extends `Server` from partyserver, which extends `DurableObject` ("agents *are* Durable Objects"); it has `this.env`, `this.sql` (a tagged template over `this.ctx.storage.sql`), `this.state`/`setState`, `onRequest`, `onConnect`, scheduling, and `routeAgentRequest` for `/agents/:agent/:instance` URLs. `AIChatAgent` adds message persistence and "automatic resumable streaming". The documented chat shape:

- Server: `class ChatAgent extends AIChatAgent`, `onChatMessage()` calls the AI SDK `streamText({ model, messages: await convertToModelMessages(this.messages), tools, stopWhen: stepCountIs(5) })` and returns `result.toUIMessageStreamResponse()`.
- Tools: AI SDK `tool({ description, inputSchema: z.object(...), execute })`; `execute` closes over `this.env`, so `this.env.COLLECTOR.getByName('cat').readOnlyQuery(sql)` is one line. Tools without `execute` run in the browser; `needsApproval` gates a tool on a user click.
- Claude: either `createAnthropic({ apiKey: this.env.ANTHROPIC_API_KEY })` from `@ai-sdk/anthropic` with `anthropic("claude-opus-5-5")`, or route through AI Gateway with `createAI({ binding: env.AI })` from `agents/models/ai-sdk` and `ai(anthropic("claude-opus-5-5"), { vendorKey: "request" })` (`createAI` is beta; it replaces `workers-ai-provider` and `ai-gateway-provider`, which are deprecated as of 2026-10-21).
- Client: `useAgent({ agent: "ChatAgent" })` from `agents/react` over WebSocket, `useAgentChat({ agent })` from `@cloudflare/ai-chat/react` for `messages`, `sendMessage`, `status`.
- Wrangler: a `durable_objects` binding for `ChatAgent` and a migration with `new_sqlite_classes: ["ChatAgent"]`.

Why it fits: Zod and React like the rest of the stack, one Durable Object per conversation with built-in persistence and resumable streaming, direct streamed responses, and it is the layer flue itself is built on. The TanStack Start Worker can forward `/agents/*` to `routeAgentRequest`, or the chat agent can live in its own small Worker.

### B. Plain Anthropic SDK with the tool runner

`@anthropic-ai/sdk` 1.2.0 (Apache-2.0) lists Cloudflare Workers as a supported runtime. `client.beta.messages.toolRunner({ model, max_tokens, tools, messages, stream: true })` with `betaZodTool({ name, description, inputSchema, run })` drives the tool loop; the `run` closure holds `env.COLLECTOR`. The runner is beta and does not auto-resume `pause_turn` (only relevant with server tools). Defaults from the Claude API skill: model `claude-opus-5-5`, thinking left adaptive (omit `thinking` or `{ type: "adaptive" }`), `output_config.effort` set explicitly (`medium` is the Opus 5.5 default), streaming, and server-side refusal fallbacks (`betas: ["server-side-fallback-2026-07-01"]`, `fallbacks: "default"`) unless we decide against them.

```ts
import Anthropic from '@anthropic-ai/sdk';
import { betaZodTool } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';

export async function answer(env: Env, question: string) {
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const queryMonitoringRecord = betaZodTool({
    name: 'query_monitoring_record',
    description: 'Run one read-only SQL SELECT against the monitoring record.',
    inputSchema: z.object({ sql: z.string() }),
    run: async ({ sql }) => JSON.stringify(await env.COLLECTOR.getByName('cat').readOnlyQuery(sql)),
  });
  const runner = client.beta.messages.toolRunner({
    model: 'claude-opus-5-5',
    max_tokens: 64000,
    stream: true,
    output_config: { effort: 'medium' },
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    tools: [queryMonitoringRecord],
    messages: [{ role: 'user', content: question }],
  });
  for await (const stream of runner) { /* forward stream events to the browser */ }
  return runner.done();
}
```

Why it fits: smallest dependency set and full control over the request shape. Cost: no conversation persistence, no resumable stream, no client hook; we would store history ourselves (a small chat Durable Object or the collector). Good if `/chat` is one-question-at-a-time; A is better once it is a conversation.

## Fit verdict

flue answers the ticket's literal questions with "yes": it exists, it is maintained by the Astro team under Apache-2.0, it deploys to Workers with one Durable Object per conversation, and a tool can query the monitoring record by calling the collector Durable Object through an `env` binding. But its value is durability, sandboxes, skills, subagents and channels for autonomous agents, and the price is a Vite plugin and Hono route map that want to own the Worker, a Pi dependency with four provider SDKs, Valibot schemas, admission-then-alarm execution instead of a streamed response, and a second Worker beside TanStack Start. `/chat` is a question-answering page over one SQL tool.

Recommendation: build `/chat` on the Cloudflare Agents SDK `AIChatAgent` with the AI SDK Anthropic provider (alternative A), or the plain Anthropic SDK tool runner (B) if we want no chat state at all. Either way, the collector Durable Object exposes a `readOnlyQuery` RPC method that validates and caps the statement; that method is the piece to build first, and it serves whichever agent layer sits on top. Revisit flue if `/chat` grows into scheduled, multi-step work such as writing a weekly service report with a sandbox.

## Sources

flue (primary):
- Repo and metadata: https://github.com/withastro/flue (GitHub API: license, stars, dates, contributors, releases)
- README: https://github.com/withastro/flue/blob/main/README.md
- CHANGELOG: https://github.com/withastro/flue/blob/main/CHANGELOG.md
- Runtime package manifest: https://github.com/withastro/flue/blob/main/packages/runtime/package.json
- Cloudflare agent class factory: https://github.com/withastro/flue/blob/main/packages/runtime/src/cloudflare/flue-agent-class.ts
- Cloudflare context (env, storage.sql): https://github.com/withastro/flue/blob/main/packages/runtime/src/cloudflare/context.ts
- Cloudflare public surface: https://github.com/withastro/flue/blob/main/packages/runtime/src/cloudflare/index.ts
- npm `@flue/runtime`: https://www.npmjs.com/package/@flue/runtime (registry JSON: https://registry.npmjs.org/@flue%2Fruntime)
- Docs, Why Flue: https://flueframework.com/docs/introduction/why-flue/
- Docs, Getting started: https://flueframework.com/docs/guide/getting-started/
- Docs, Tools: https://flueframework.com/docs/guide/tools/
- Docs, Cloudflare target: https://flueframework.com/docs/guide/cloudflare-target/
- Docs, Deploy to Cloudflare: https://flueframework.com/docs/ecosystem/deploy/cloudflare/
- Docs, Durability: https://flueframework.com/docs/guide/durability/
- Docs, React: https://flueframework.com/docs/guide/react/
- Docs, Agent API reference: https://flueframework.com/docs/reference/agent-api/
- Docs, Agent hooks API reference: https://flueframework.com/docs/reference/agent-hooks-api/
- Docs, Provider API reference: https://flueframework.com/docs/reference/provider-api/

Pi (flue's harness):
- Repo: https://github.com/earendil-works/pi
- Model catalog generator (Anthropic ids): https://github.com/earendil-works/pi/blob/main/packages/ai/scripts/generate-models.ts
- Providers doc: https://pi.dev/docs/latest/providers
- npm `@earendil-works/pi-ai`: https://registry.npmjs.org/@earendil-works%2Fpi-ai

Cloudflare:
- Blog, "Bringing more agent harnesses and frameworks to Cloudflare, starting with Flue" (2026-06-17): https://blog.cloudflare.com/agents-platform-flue-sdk
- Agents platform overview: https://developers.cloudflare.com/agents/
- Agent class: https://developers.cloudflare.com/agents/runtime/lifecycle/agent-class/
- State and SQL: https://developers.cloudflare.com/agents/runtime/lifecycle/state/
- Agents API: https://developers.cloudflare.com/agents/runtime/agents-api/
- Chat agents: https://developers.cloudflare.com/agents/communication-channels/chat/chat-agents/
- Chat agent example: https://developers.cloudflare.com/agents/examples/chat-agent/
- AI SDK provider (`createAI`): https://developers.cloudflare.com/agents/models/ai-sdk/
- Changelog, `createAI` replaces providers (2026-10-21): https://developers.cloudflare.com/changelog/post/2026-10-21-createai/
- Pi harness in the Agents SDK: https://developers.cloudflare.com/agents/harnesses/pi/
- What are Durable Objects: https://developers.cloudflare.com/durable-objects/concepts/what-are-durable-objects/
- Durable Object stubs and RPC: https://developers.cloudflare.com/durable-objects/best-practices/create-durable-object-stubs-and-send-requests/
- Durable Object storage access: https://developers.cloudflare.com/durable-objects/best-practices/access-durable-objects-storage/
- Durable Objects limits: https://developers.cloudflare.com/durable-objects/platform/limits/
- Workers limits: https://developers.cloudflare.com/workers/platform/limits/
- npm `agents`: https://registry.npmjs.org/agents ; npm `@cloudflare/ai-chat`: https://registry.npmjs.org/@cloudflare%2Fai-chat

Anthropic:
- TypeScript SDK README (supported runtimes): https://github.com/anthropics/anthropic-sdk-typescript/blob/main/README.md
- npm `@anthropic-ai/sdk`: https://registry.npmjs.org/@anthropic-ai%2Fsdk
- Tool runner usage and model defaults: the `claude-api` skill bundled with Claude Code (`typescript/claude-api/tool-use.md`, SKILL.md model table), 2026-10 snapshot
