# HTTP and WebSocket contract

There is no `/v1` prefix and no generated OpenAPI document. The machine-readable
snapshot of the rules below is [`api-contract.json`](api-contract.json).
Per-route request and response fields live in `src/api/client.ts` and
`server/src/agents/runtime/client.ts`. Those TypeScript types are the schema.
A test checks that `api-contract.json` names every `WsEvent` variant.

## Authentication

Human `/api/*` requests identify the caller with `Authorization: Bearer` or
`x-session-token`. There is no cookie session. `authMiddleware` always calls
`next()`; a handler that needs a user calls `requireAuth` or `requireCompany`
itself. `requireCompany` falls back to the caller's oldest membership when
`x-company-id` is absent or not one of theirs.

`/runtime/*` is a different surface. The pod sends `Authorization: Bearer`
with the agent-runtime JWT. Identity is taken from that token, not from the
JSON body. It is mounted beside `/api`, not under it.

`POST /webhooks/email/inbound` does not use either of those. It checks
`x-cumora-signature` against `EMAIL_INBOUND_HMAC_SECRET`. The signature
proves the worker sent the body. The worker's `authVerdict` and
`envelopeFrom` are what prove the `From:` header. The server attributes the
message to a workspace member only when the verdict is `aligned` and the
envelope mailbox matches. See [email.md](email.md).

## Errors, pagination, idempotency

Handlers that fail with `HttpError` respond `{ "error": "<message>" }` and
an HTTP status. The process-level handler uses the same shape. That message
is the server's text, not a stable error code.

Pagination is not one vocabulary. Message history uses `before` (a sequence)
and `limit`. Admin collections use `limit` and `offset` and return `total`.
Other lists are unpaged. Clients must not assume a cursor field exists.

Some creates accept a client `requestId` and store it in a partial unique
index (`uniq_messages_client_id`, `uniq_participants_agent_creation_request`,
`uniq_board_creation_request`, `uniq_document_creation_request`,
`uniq_calendar_event_creation_request`). Those indexes are the idempotency
mechanism. There is not one shared idempotency header.

Numeric ceilings are in [LIMITS.md](LIMITS.md).

## WebSocket

The browser opens one socket per user, not per workspace. After the ticket
handshake the server sends the frames below. Routed Redis events without a
`companyId` are dropped. Delivery is then by user id
(`resolveWsEventRecipientUserIds`), not by filtering the socket's company
set. A connected user therefore receives frames for every workspace they
belong to. The client `WsEvent` union records `companyId` only on
`participants.added` (optional) and `workspace.membership`.

`doc.sync`, `doc.update`, `doc.awareness`, and `doc.error` are per document
subscription. The other variants are broadcast frames.

## Daemon compatibility

The BYOA daemon and this server are released from the same tree. There is
no compatibility table that lets an older daemon speak a newer runtime.
[BYOA.md](BYOA.md) describes the daemon's commands and endpoints; it is not
a second schema.
