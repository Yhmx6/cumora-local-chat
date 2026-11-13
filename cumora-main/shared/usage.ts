export type UsagePeriod = 'today' | 'week' | 'month'

export interface UsageCounts {
  calls: number
  failedCalls: number
  measuredCalls: number
  unmeasuredCalls: number
  inputTokens: number
  cachedInputTokens: number
  cacheCreationTokens: number
  outputTokens: number
  totalTokens: number
  referenceCostUsd: number
}

export interface AgentUsageRow extends UsageCounts {
  agentId: string | null
  name: string | null
  departed: boolean
  models: string[]
}

export interface AgentUsageSummary {
  period: UsagePeriod
  timezone: string
  from: string
  to: string
  retentionDays: number
  retentionLimited: boolean
  rows: AgentUsageRow[]
  totals: UsageCounts
}
