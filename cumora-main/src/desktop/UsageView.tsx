import { useEffect, useMemo, useState } from 'react'
import { api } from '@/api/client'
import { useAuth } from '@/stores/auth'
import { useT, type MessageKey } from '@/lib/i18n'
import type { AgentUsageSummary, UsagePeriod } from '../../shared/usage'

const periods: Array<[UsagePeriod, MessageKey]> = [['today','usage.today'],['week','usage.week'],['month','usage.month']]
const columns: MessageKey[] = ['usage.ai','usage.input','usage.cacheRead','usage.cacheWrite','usage.output','usage.total','usage.calls','usage.failed','usage.missing','usage.cost']

export function UsageView() {
  const t = useT()
  const companyId = useAuth(s => s.activeCompanyId)
  const [period, setPeriod] = useState<UsagePeriod>('today')
  const [refresh, setRefresh] = useState(0)
  const [snapshot, setSnapshot] = useState<{companyId:string; data:AgentUsageSummary} | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const timezone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Singapore', [])
  const number = (value: number) => value.toLocaleString()
  const data = snapshot?.companyId === companyId && snapshot.data.period === period ? snapshot.data : null
  useEffect(() => {
    let cancelled = false
    setLoading(true); setError(null)
    if (!companyId) { setLoading(false); return }
    api.getAgentUsage(period, timezone).then(result => {
      if (!cancelled) setSnapshot({companyId, data:result})
    }).catch(e => {
      if (!cancelled) setError(e instanceof Error ? e.message : String(e))
    }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [companyId, period, timezone, refresh])
  const totals = data?.totals
  const missingNames = data?.rows.filter(r => r.calls > 0 && r.measuredCalls === 0).map(r => `${r.name ?? r.agentId ?? t('usage.shared')}${r.departed ? ` (${t('usage.former')})` : ''}`) ?? []
  const showTokens = (value: number, calls: number, measured: number) => calls > 0 && measured === 0 ? '—' : number(value)
  return (
    <main className="overflow-y-auto bg-[#f5f5f5] p-6 md:p-8 text-ink-900">
      <div className="max-w-[1400px] mx-auto">
        <header className="flex flex-wrap items-start justify-between gap-4 mb-6">
          <div><h1 className="text-[25px] font-semibold">{t('nav.usage')}</h1><p className="mt-2 text-[13px] text-ink-500">{t('usage.subtitle')}</p></div>
          <div className="flex items-center gap-3">
            <div className="flex bg-white border border-ink-100 rounded-lg p-1" aria-label={t('usage.period')}>
              {periods.map(([value,label]) => <button key={value} type="button" aria-pressed={period === value} onClick={() => setPeriod(value)}
                className={`px-4 py-1.5 rounded-md text-[13px] transition ${period === value ? 'bg-[#e7f5eb] text-[#078443] font-semibold' : 'text-ink-500 hover:bg-paper'}`}>{t(label)}</button>)}
            </div>
            <button type="button" disabled={loading} onClick={() => setRefresh(v => v + 1)} className="px-4 py-2 rounded-lg bg-white border border-ink-100 text-[13px] disabled:opacity-50">{t(loading ? 'usage.loading' : 'usage.refresh')}</button>
          </div>
        </header>
        {error && <div role="alert" className="p-4 mb-4 bg-white border border-coral-deep rounded-lg text-[13px] text-coral-deep">{t('usage.error')} {error}</div>}
        {!data && loading && <p role="status" className="text-ink-500 py-10 text-center">{t('usage.loading')}</p>}
        {data && totals && <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-5" aria-busy={loading}>
            <Summary label={t('usage.recordedTokens')} value={showTokens(totals.totalTokens,totals.calls,totals.measuredCalls)} detail={t('usage.tokenSum')} />
            <Summary label={t('usage.calls')} value={number(totals.calls)} detail={t('usage.failureCount',{count:number(totals.failedCalls)})} />
            <Summary label={t('usage.reporting')} value={totals.calls ? `${Math.round(totals.measuredCalls / totals.calls * 100)}%` : '—'}
              detail={t('usage.reportingDetail',{measured:number(totals.measuredCalls),missing:number(totals.unmeasuredCalls)})} />
          </div>
          <p className="text-[12px] text-ink-500 mb-4">{new Date(data.from).toLocaleDateString()} — {new Date(data.to).toLocaleString()} · {data.timezone}</p>
          {missingNames.length > 0 && <div role="status" className="mb-4 px-4 py-3 rounded-lg bg-[#fff8e8] text-[#785820] text-[13px]">{t('usage.noReport',{names:missingNames.join('、')})}</div>}
          {data.retentionLimited && <p role="status" className="mb-4 text-[13px] text-[#785820]">{t('usage.retentionWarning',{days:data.retentionDays})}</p>}
          <div className="bg-white border border-ink-100 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1050px] text-[13px]" aria-label={t('nav.usage')}>
                <thead className="bg-[#fafafa] border-b border-ink-100 text-ink-500"><tr>{columns.map((key,i) => <th scope="col" key={key} className={`px-4 py-3 font-medium whitespace-nowrap ${i ? 'text-right' : 'text-left'}`}>{t(key)}</th>)}</tr></thead>
                <tbody>{data.rows.map(row => <tr key={row.agentId ?? '__shared__'} className="border-b border-ink-100 last:border-0 hover:bg-[#fafcfb]">
                  <th scope="row" className="px-4 py-4 text-left font-normal min-w-[170px] max-w-[230px]">
                    <div className="font-semibold">{row.name ?? row.agentId ?? t('usage.shared')}{row.departed && <span className="ml-2 text-[11px] font-normal text-ink-500">{t('usage.former')}</span>}</div>
                    <div className="mt-1 text-[11px] text-ink-500 break-words" title={row.models.join(', ')}>{row.models.length ? `${t('usage.recordedModels')}${row.models.join(' · ')}` : t('usage.noCalls')}</div>
                    {row.unmeasuredCalls > 0 && <div className="mt-1 text-[11px] text-[#936619]">{t(row.measuredCalls ? 'usage.partial' : 'usage.unavailable')}</div>}
                  </th>
                  {[row.inputTokens,row.cachedInputTokens,row.cacheCreationTokens,row.outputTokens,row.totalTokens].map((value,i) => <td key={i} className={`px-4 py-4 text-right tabular-nums whitespace-nowrap ${i === 4 ? 'font-semibold' : ''}`}>{showTokens(value,row.calls,row.measuredCalls)}</td>)}
                  <td className="px-4 py-4 text-right tabular-nums">{number(row.calls)}</td>
                  <td className="px-4 py-4 text-right tabular-nums">{number(row.failedCalls)}</td>
                  <td className={`px-4 py-4 text-right tabular-nums ${row.unmeasuredCalls ? 'text-[#936619]' : ''}`}>{number(row.unmeasuredCalls)}</td>
                  <td className="px-4 py-4 text-right tabular-nums whitespace-nowrap">{row.measuredCalls ? `≈ $${row.referenceCostUsd.toFixed(4)}` : '—'}</td>
                </tr>)}</tbody>
              </table>
            </div>
            {data.rows.length === 0 && <p className="p-10 text-center text-ink-500">{t('usage.empty')}</p>}
          </div>
          <div className="mt-5 space-y-2 text-[12px] leading-relaxed text-ink-500">
            <p>{t('usage.measureNote')}</p><p>{t('usage.costNote')}</p><p>{t('usage.rangeNote',{days:data.retentionDays})}</p>
          </div>
        </>}
      </div>
    </main>
  )
}

function Summary({label,value,detail}:{label:string;value:string;detail:string}) {
  return <div className="bg-white border border-ink-100 rounded-xl px-5 py-4"><div className="text-[13px] text-ink-500">{label}</div><div className="text-[27px] font-semibold tabular-nums my-2">{value}</div><div className="text-[12px] text-ink-500">{detail}</div></div>
}
