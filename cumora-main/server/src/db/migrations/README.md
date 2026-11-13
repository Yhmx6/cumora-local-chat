# Schema migrations

Migrations run from a pre-deploy Job while the previous server pods are
still serving. `ensureSchema` sets `lock_timeout = 5s` on that session.
`npm run guard:migration-locks` rejects the two patterns below. The longer
contributor notes are in the repository `CONTRIBUTING.md`.

## Checklist

- Append a new file under this directory. Do not edit SQL that has already
  been applied. The manifest stores a SHA-256 of that SQL, and startup
  compares it.
- Register the next contiguous version in `manifest.ts`. Keep
  `MIN_SUPPORTED_SCHEMA_VERSION` and `MAX_SUPPORTED_SCHEMA_VERSION` honest.
  Today both equal the manifest tip, so a migration moves the only schema
  this build will boot. The previous image then refuses the new ledger.
  `docs/RELEASE.md` is the recovery document; do not describe that deploy as
  something `kubectl rollout undo` can finish.
- Prefer the shape of `0002-normalized-conversation-members.ts`: add the new
  structure, name the foreign keys, and write down `ON DELETE` behavior.
  `conversation_members` references `participants` with `ON DELETE RESTRICT`,
  which is why workspace deletion deletes conversations before participants.
- `ADD COLUMN … DEFAULT <volatile>` rewrites the table under
  `ACCESS EXCLUSIVE`. `gen_random_uuid()`, `random()`, and `nextval()` are
  volatile. `now()` is `STABLE` and is fine. Use nullable column, batched
  backfill, `SET DEFAULT`, `CHECK (… IS NOT NULL) NOT VALID`, then
  `VALIDATE CONSTRAINT`.
- `CREATE INDEX` on an existing table must be `CREATE INDEX CONCURRENTLY`
  with `transactional: false`. Indexing a table the same migration creates
  can stay inside the transaction.
- Transactional migrations that lose the lock race are retried. A
  non-transactional migration is not.

## Required indexes

`verifyRequiredIndexes` runs after the pending-migration loop, including
when nothing is pending. A missing or invalid name in
`REQUIRED_SCHEMA_INDEXES` (`server/src/db/migrate.ts`) fails the Job before
the Deployment rolls.

`buildConcurrentIndexes` and `ensureMessageClientIdIndex` run from the
legacy baseline path, not on every later deploy. Putting a name into the
required list without a migration that creates it on databases past version
1 means the next deploy cannot rebuild it.

To retire an index: delete the name from `REQUIRED_SCHEMA_INDEXES` and drop
the index in the same commit, in that order. Do not drop
`idx_conversations_members_gin` just because an older comment said the
rollback window had closed. It is still required, and this build does not
have a rollback window onto the previous image.
