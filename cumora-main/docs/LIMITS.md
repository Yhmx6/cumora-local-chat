# Limits and what happens at them

These are the ceilings enforced in code. They are not a capacity plan: the
database pool, the idle scheduler, and several list endpoints are still
shared or unbounded. Change a number in the file cited here; this page only
records it.

## HTTP bodies

| Surface | Ceiling | Over the ceiling |
| --- | --- | --- |
| `/api/*` JSON, except `POST /uploads` | 256 KB (`server/src/api/router.ts`) | Parser error before the handler |
| `POST /api/uploads` JSON | 34 MB, and only after `authMiddleware` has attached a session | Parser error |
| `/runtime/*` JSON | 4 MB (`server/src/agents/runtime/server.ts`) | Parser error |
| `PUT /runtime/fs/write` | 34 MB | Parser error |
| `POST /webhooks/email/inbound` | 25 MB raw body (`server/src/api/inbound-email.ts`) | Parser error |
| Stored chat upload | 25 MB (`MAX_UPLOAD_BYTES`) | Request rejected |
| Inbound email attachments, at the worker | 10 MB each, 18 MB total (`workers/email-gate`) | Worker forwards metadata only (`truncated`) |

## Data stores

| Resource | Ceiling | Notes |
| --- | --- | --- |
| Postgres pool | `max: 20`, 5s connect timeout, 30s idle, 60s `statement_timeout`, 30s `idle_in_transaction_session_timeout` | `server/src/db/pool.ts`. Not configurable by env. `/api/health` uses this same pool. |
| Redis commands | 2s `commandTimeout`, `maxRetriesPerRequest: 1` on the command connection | `server/src/redis.ts`. The subscriber connection does not use that retry cap. |
| WebSocket send buffer | Drop a frame above 2 MB buffered; terminate the socket above 8 MB | `server/src/ws.ts`. The client is expected to refetch. |
| Agent turn | 200 hops (`MAX_HOPS` in `server/src/agents/turn.ts`) | No separate dollar or wall-clock budget around the hop loop. |
| Low-priority wakes | 20 synthetic wakes per process per minute | `message.new` and `manual` are not counted. Idle has no cluster lock, so replicas each have this budget. |
| Agent-driven turns | 30 per agent per rolling minute | Human-driven wakes are not counted. |
| Calendar recurrence walk | 5000 indexes (`server/src/recurrence.ts`) | Past the cap, the series is treated as finished. |
| Migration DDL | `lock_timeout = 5s` while old pods are still serving | See `server/src/db/migrations/README.md`. |

## What is not limited

There is no HTTP rate-limit middleware on the API, the runtime, or the
inbound-email webhook. Admin aggregation responses are cached in process
without evicting expired keys (`server/src/api/admin-router.ts`). List
endpoints do not share one page size; messages take `before` and `limit`,
admin lists take `limit` and `offset`, and some lists return the whole
tenant set.

Rejection is per call site: a parser limit is a 4xx from the body parser,
a pool timeout surfaces as a failed query, and a hop cap ends the turn with
`max_hops`. None of those paths is a queue the client can poll.
