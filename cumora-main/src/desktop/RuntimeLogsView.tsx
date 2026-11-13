import {useEffect,useState} from 'react'
import {api} from '@/api/client'
import {useAuth} from '@/stores/auth'
import {useParticipants} from '@/stores/participants'
import type {RuntimeNoticePage} from '../../shared/runtime-notices'

export function RuntimeLogsView(){
  const companyId=useAuth(s=>s.activeCompanyId)
  const people=useParticipants(s=>s.byId)
  const [agent,setAgent]=useState(''),[refresh,setRefresh]=useState(0)
  const [page,setPage]=useState<RuntimeNoticePage|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(false)
  const [cursor,setCursor]=useState<{at:string;id:string}|undefined>()
  useEffect(()=>{setCursor(undefined);setPage(null)},[companyId,agent])
  useEffect(()=>{
    let stale=false;setLoading(true);setError('');setPage(null)
    if(!companyId){setLoading(false);return}
    api.getRuntimeLogs(agent,cursor).then(result=>{if(!stale)setPage(result)}).catch(e=>{if(!stale)setError(e instanceof Error?e.message:'暂时无法读取日志')}).finally(()=>{if(!stale)setLoading(false)})
    return()=>{stale=true}
  },[companyId,agent,cursor,refresh])
  const agents=Object.values(people).filter(p=>p.kind==='agent'&&!p.rosterDeletedAt).sort((a,b)=>a.name.localeCompare(b.name))
  return <main className="h-full overflow-y-auto bg-[#f5f5f5] p-6 md:p-8">
    <div className="max-w-[1100px] mx-auto">
      <header className="flex flex-wrap justify-between gap-4 mb-6">
        <div><h1 className="text-[25px] font-semibold">运行日志</h1><p className="mt-2 text-[13px] text-ink-500">模型接口和运行异常集中显示在这里，不会发送到群聊。历史记录不代表当前仍有故障。</p></div>
        <div className="flex items-center gap-3">
          <select aria-label="筛选 AI" value={agent} onChange={e=>{setCursor(undefined);setAgent(e.target.value)}} className="bg-white border border-ink-100 rounded-lg px-3 py-2 text-sm"><option value="">全部 AI</option>{agents.map(p=><option key={p.id} value={p.id}>{p.name}{p.departedAt?'（已卸任）':''}</option>)}</select>
          <button disabled={loading} onClick={()=>{setCursor(undefined);setRefresh(v=>v+1)}} className="bg-white border border-ink-100 rounded-lg px-4 py-2 text-sm disabled:opacity-50">{loading?'正在读取…':'刷新'}</button>
        </div>
      </header>
      {error&&<p role="alert" className="bg-white border border-ink-100 rounded-xl p-4 text-sm text-coral-deep">{error}</p>}
      {!loading&&!error&&page?.rows.length===0&&<div className="rounded-xl bg-white border border-ink-100 p-12 text-center text-ink-500">暂无运行异常</div>}
      <div className="space-y-3">{page?.rows.map(row=><article key={row.id} className="bg-white border border-ink-100 rounded-xl p-4">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm"><strong>{row.agentName}</strong><span className="text-ink-400">{row.conversationName}</span><time className="ml-auto text-xs text-ink-400" dateTime={row.at}>{new Date(row.at).toLocaleString('zh-CN',{hour12:false})}</time></div>
        <p className="mt-3 text-[13px] text-ink-700 whitespace-pre-wrap break-words leading-relaxed">{row.text}</p>
      </article>)}</div>
      {page?.next&&<button disabled={loading} onClick={()=>setCursor(page.next!)} className="mt-5 border border-ink-100 bg-white rounded-lg px-4 py-2 text-sm">查看更早记录</button>}
    </div>
  </main>
}
