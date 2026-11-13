import { pool } from '../db/pool.js'
import { env } from '../env.js'
import type { AgentUsageRow, AgentUsageSummary, UsageCounts, UsagePeriod } from '../../../shared/usage.js'

export async function getAgentUsageSummary(companyId: string, period: UsagePeriod, timezone: string, now = new Date()): Promise<AgentUsageSummary> {
  // Calendar ranges in the user's timezone, not a UTC day or a rolling 24h.
  const { rows: bounds } = await pool.query<{ start: Date }>(
    `SELECT (CASE $1::text
      WHEN 'today' THEN date_trunc('day', $3::timestamptz AT TIME ZONE $2)
      WHEN 'week' THEN date_trunc('day', $3::timestamptz AT TIME ZONE $2) - INTERVAL '6 days'
      ELSE date_trunc('month', $3::timestamptz AT TIME ZONE $2)
    END AT TIME ZONE $2) AS start`, [period, timezone, now],
  )
  const from = bounds[0].start
  const { rows } = await pool.query<{
    agent_id: string | null; name: string | null; departed: boolean; models: string[] | null
    calls: string; failed: string; measured: string; input: string; cached: string; writes: string; output: string; cost: string
  }>(
    `WITH scoped AS MATERIALIZED (
       SELECT * FROM llm_calls WHERE company_id = $1 AND created_at >= $2 AND created_at <= $3
     ), buckets AS (
       SELECT id AS agent_id FROM participants WHERE company_id = $1 AND kind = 'agent' AND departed_at IS NULL
       UNION SELECT agent_id FROM scoped
     )
     SELECT b.agent_id, p.name, (p.departed_at IS NOT NULL) AS departed,
       array_agg(DISTINCT l.model ORDER BY l.model) FILTER (WHERE l.id IS NOT NULL) AS models,
       COUNT(l.id)::text AS calls,
       COUNT(l.id) FILTER (WHERE l.status <> 'ok')::text AS failed,
       COUNT(l.id) FILTER (WHERE l.measured)::text AS measured,
       COALESCE(SUM(l.input_tokens) FILTER (WHERE l.measured), 0)::text AS input,
       COALESCE(SUM(l.cached_input_tokens) FILTER (WHERE l.measured), 0)::text AS cached,
       COALESCE(SUM(l.cache_creation_tokens) FILTER (WHERE l.measured), 0)::text AS writes,
       COALESCE(SUM(l.output_tokens) FILTER (WHERE l.measured), 0)::text AS output,
       COALESCE(SUM(l.cost_usd) FILTER (WHERE l.measured), 0)::text AS cost
     FROM buckets b
     LEFT JOIN participants p ON p.company_id = $1 AND p.id = b.agent_id
     LEFT JOIN scoped l ON l.agent_id IS NOT DISTINCT FROM b.agent_id
     GROUP BY b.agent_id, p.name, p.departed_at
     ORDER BY (b.agent_id IS NULL), (p.departed_at IS NOT NULL), p.name NULLS LAST, b.agent_id`,
    [companyId, from, now],
  )
  const agents: AgentUsageRow[] = rows.map(r => {
    const inputTokens = Number(r.input), cachedInputTokens = Number(r.cached)
    const cacheCreationTokens = Number(r.writes), outputTokens = Number(r.output)
    return {
      agentId:r.agent_id, name:r.name, departed:r.departed, models:r.models ?? [],
      calls:Number(r.calls), failedCalls:Number(r.failed), measuredCalls:Number(r.measured),
      unmeasuredCalls:Number(r.calls) - Number(r.measured),
      inputTokens, cachedInputTokens, cacheCreationTokens, outputTokens,
      totalTokens:inputTokens + cachedInputTokens + cacheCreationTokens + outputTokens,
      referenceCostUsd:Number(r.cost),
    }
  })
  const totals: UsageCounts = { calls:0, failedCalls:0, measuredCalls:0, unmeasuredCalls:0, inputTokens:0, cachedInputTokens:0, cacheCreationTokens:0, outputTokens:0, totalTokens:0, referenceCostUsd:0 }
  for (const row of agents) for (const key of Object.keys(totals) as Array<keyof UsageCounts>) totals[key] += row[key]
  const retentionDays = env.DB_GC_LLM_CALLS_DAYS
  return { period, timezone, from:from.toISOString(), to:now.toISOString(), retentionDays,
    retentionLimited:retentionDays > 0 && from.getTime() < now.getTime() - retentionDays * 86400000,
    rows:agents, totals }
}
