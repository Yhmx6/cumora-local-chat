import {createHash} from 'node:crypto'
export const RUNTIME_NOTICES_SQL = `
CREATE TABLE runtime_notices (
 id TEXT PRIMARY KEY,
 company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
 conversation_id TEXT NOT NULL,
 agent_id TEXT NOT NULL,
 notice_kind TEXT NOT NULL,
 text TEXT NOT NULL,
 dedupe_key TEXT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX runtime_notices_company_time ON runtime_notices(company_id,created_at DESC,id DESC);
CREATE INDEX runtime_notices_dedupe ON runtime_notices(company_id,conversation_id,dedupe_key,created_at DESC);
CREATE FUNCTION pg_temp.notice_payload(raw TEXT) RETURNS JSONB LANGUAGE plpgsql AS $$
BEGIN RETURN raw::jsonb; EXCEPTION WHEN others THEN RETURN NULL; END;
$$;
INSERT INTO runtime_notices(id,company_id,conversation_id,agent_id,notice_kind,text,dedupe_key,created_at)
 SELECT m.id,m.company_id,m.conversation_id,m.author_id,COALESCE(p->>'noticeKind','runtime_notice'),p->>'text',m.client_id,m.created_at
 FROM messages m CROSS JOIN LATERAL (SELECT pg_temp.notice_payload(m.body) AS p) parsed
 WHERE m.kind='system' AND m.company_id IS NOT NULL AND p->>'kind'='notice' AND jsonb_typeof(p->'text')='string'
 ON CONFLICT(id) DO NOTHING;
`
export function runtimeNoticesChecksum(){return createHash('sha256').update(RUNTIME_NOTICES_SQL).digest('hex')}
