import { createHash } from 'node:crypto'
export const SOCIAL_MEMORIES_SQL = `
ALTER TABLE participants ADD COLUMN social_memory_enabled BOOLEAN NOT NULL DEFAULT TRUE;
CREATE TABLE agent_social_memories (
 id TEXT PRIMARY KEY,
 agent_id TEXT NOT NULL,
 company_id TEXT NOT NULL,
 body TEXT NOT NULL CHECK (length(body) <= 500),
 kind TEXT NOT NULL CHECK (kind IN ('preference','event','opinion')),
 conversation_id TEXT,
 source_message_id TEXT,
 source_excerpt TEXT,
 origin TEXT NOT NULL CHECK (origin IN ('agent','human')),
 revision INTEGER NOT NULL DEFAULT 1,
 deleted_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 FOREIGN KEY (agent_id,company_id) REFERENCES participants(id,company_id) ON DELETE CASCADE,
 FOREIGN KEY (conversation_id,company_id) REFERENCES conversations(id,company_id) ON DELETE CASCADE,
 CHECK (source_message_id IS NULL OR conversation_id IS NOT NULL)
);
CREATE UNIQUE INDEX social_memories_source ON agent_social_memories(agent_id,source_message_id) WHERE source_message_id IS NOT NULL;
CREATE INDEX social_memories_scope ON agent_social_memories(company_id,agent_id,conversation_id,updated_at DESC);
`
export function socialMemoriesChecksum(): string {
  return createHash('sha256').update(SOCIAL_MEMORIES_SQL).digest('hex')
}
