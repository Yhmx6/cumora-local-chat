import { createHash } from 'node:crypto'

// Keep the participant as the identity behind historical messages. Deletion
// removes only the former-team entry and permanently disables rehire.
export const FORMER_AGENT_DELETION_SQL = `
ALTER TABLE participants ADD COLUMN roster_deleted_at TIMESTAMPTZ;
ALTER TABLE participants ADD CONSTRAINT participants_roster_deleted_departed
  CHECK (roster_deleted_at IS NULL OR (kind = 'agent' AND departed_at IS NOT NULL)) NOT VALID;
ALTER TABLE participants VALIDATE CONSTRAINT participants_roster_deleted_departed;
`

export function formerAgentDeletionChecksum(): string {
  return createHash('sha256').update(FORMER_AGENT_DELETION_SQL).digest('hex')
}
