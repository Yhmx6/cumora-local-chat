import { useCallback, useEffect, useState } from 'react'
import { api } from '@/api/client'
import { useParticipants } from '@/stores/participants'
import { useAuth } from '@/stores/auth'
import { Avatar } from '@/components/Avatar'
import type { Participant } from '@/types'
import type { SocialMemory, SocialMemoryKind, SocialMemoryList } from '../../shared/social-memory'

const kinds: Record<SocialMemoryKind,string> = {preference:'偏好与习惯',event:'共同经历',opinion:'观点与变化'}
const button = 'rounded-md border border-ink-100 bg-white px-3 py-1.5 text-sm disabled:opacity-40 hover:bg-ink-50'

export function MemoriesView() {
  const company = useAuth(s => s.activeCompanyId)
  const roster = useParticipants(s => s.byId)
  const agents = Object.values(roster).filter(p => p.kind === 'agent' && !p.departedAt)
  const [selected,setSelected] = useState('')
  const active = agents.find(p => p.id === selected) ?? agents[0]
  return <main className="h-full min-h-0 overflow-auto bg-[#f5f5f5] p-7">
    <div className="mx-auto max-w-4xl">
      <h1 className="text-xl font-semibold">相处记忆</h1>
      <p className="mt-2 text-sm text-ink-400">每位 AI 各自记住与你相处中有用的小事。你随时可以纠正，也可以让她忘记。</p>
      <div className="my-6 flex flex-wrap gap-2" aria-label="选择 AI">
        {agents.map(p => <button key={p.id} onClick={() => setSelected(p.id)} aria-pressed={active?.id === p.id}
          className={`flex items-center gap-2 rounded-lg border px-3 py-2 ${active?.id === p.id ? 'border-[#07c160] bg-[#e8f7ed]' : 'border-ink-100 bg-white'}`}>
          <Avatar p={p} size={28} showStatus={false}/><span>{p.name}</span>
        </button>)}
      </div>
      {active ? <MemoryPanel key={`${company}:${active.id}`} agent={active}/> : <p>还没有可用的 AI。</p>}
    </div>
  </main>
}

function MemoryPanel({agent}:{agent:Participant}) {
  const [data,setData] = useState<SocialMemoryList|null>(null)
  const [error,setError] = useState('')
  const [busy,setBusy] = useState(false)
  const [search,setSearch] = useState('')
  const [kindFilter,setKindFilter] = useState('')
  const [editor,setEditor] = useState<SocialMemory|'new'|null>(null)
  const [body,setBody] = useState('')
  const [kind,setKind] = useState<SocialMemoryKind>('preference')
  const [deleting,setDeleting] = useState<SocialMemory|null>(null)
  const reload = useCallback(async () => { setData(await api.getSocialMemories(agent.id)) },[agent.id])
  useEffect(() => { let live=true; void api.getSocialMemories(agent.id).then(r => {if(live)setData(r)}).catch(e => {if(live)setError(String(e.message))}); return () => {live=false} },[agent.id])
  async function run(action:()=>Promise<unknown>) {
    setBusy(true);setError('')
    try { await action(); await reload() } catch(e) {setError(e instanceof Error ? e.message : '操作失败，请重试')} finally {setBusy(false)}
  }
  function edit(memory:SocialMemory|'new') {
    setEditor(memory); setBody(memory === 'new' ? '' : memory.body); setKind(memory === 'new' ? 'preference' : memory.kind);setDeleting(null)
  }
  const memories = data?.memories.filter(m => (!kindFilter || m.kind === kindFilter) && `${m.body} ${m.conversationTitle ?? ''}`.toLowerCase().includes(search.toLowerCase())) ?? []
  return <section aria-label={`${agent.name}的相处记忆`}>
    <div className="rounded-xl border border-ink-100 bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h2 className="font-semibold">{agent.name} 记住的事 <span className="ml-2 text-sm font-normal text-ink-400">{data?.memories.length ?? '…'} / 300</span></h2>
          <p className="mt-1 text-xs text-ink-400">自动记忆仅用于来源会话；手动添加的资料可用于这位 AI 的所有会话。</p></div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={data?.enabled ?? false} disabled={!data || busy}
          onChange={e => void run(() => api.setSocialMemoryEnabled(agent.id,e.target.checked))}/>启用相处记忆</label>
      </div>
      {data && !data.enabled && <p className="mt-3 text-sm text-amber-700">已暂停自动保存和使用记忆，已保存的内容仍可整理。</p>}
      <div className="mt-4 flex flex-wrap gap-2">
        <input aria-label="搜索记忆" placeholder="搜索记忆或来源会话" value={search} onChange={e => setSearch(e.target.value)} className="min-w-40 flex-1 rounded-md border border-ink-100 px-3 py-2 text-sm"/>
        <select aria-label="记忆类型筛选" value={kindFilter} onChange={e => setKindFilter(e.target.value)} className={button}><option value="">全部类型</option>{Object.entries(kinds).map(([k,v]) => <option key={k} value={k}>{v}</option>)}</select>
        <button className={button} disabled={busy} onClick={() => void run(reload)}>刷新</button>
        <button className={`${button} !border-[#07c160] !bg-[#07c160] !text-white`} disabled={busy || !data} onClick={() => edit('new')}>添加记忆</button>
      </div>
    </div>
    {error && <p role="alert" className="my-3 rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    {editor && <form className="mt-4 rounded-xl border border-[#07c160] bg-white p-5" onSubmit={e => {e.preventDefault();void run(async () => {
      if(editor === 'new') await api.addSocialMemory(agent.id,{body,kind,conversationId:null})
      else await api.editSocialMemory(agent.id,editor.id,{body,kind,revision:editor.revision})
      setEditor(null)
    })}}>
      <h3 className="mb-3 font-semibold">{editor === 'new' ? '添加一条跨会话记忆' : '修改记忆'}</h3>
      <label className="mb-3 flex items-center gap-3 text-sm">类型<select value={kind} onChange={e => setKind(e.target.value as SocialMemoryKind)} className={button}>{Object.entries(kinds).map(([k,v]) => <option key={k} value={k}>{v}</option>)}</select></label>
      <textarea autoFocus aria-label="记忆内容" placeholder="例如：我喜欢直接说重点，回答尽量一两句话。" value={body} onChange={e => setBody(e.target.value)} maxLength={500} required rows={3} className="w-full resize-y rounded-md border border-ink-100 p-3 text-sm"/>
      <div className="mt-2 flex items-center justify-between"><span className="text-xs text-ink-400">{body.length} / 500 · 不要填写密码或 API 密钥</span><div className="flex gap-2"><button type="button" className={button} disabled={busy} onClick={() => setEditor(null)}>取消</button><button className={button} disabled={busy || !body.trim()}>保存</button></div></div>
    </form>}
    {!data && !error && <p className="py-10 text-center text-sm text-ink-400">正在读取记忆…</p>}
    {data && !memories.length && <div className="py-14 text-center text-ink-400"><p>{search || kindFilter ? '没有找到匹配的记忆' : '还没有保存的相处记忆'}</p><p className="mt-2 text-sm">可以手动添加，也可以在聊天中说“记住这件事”。不会自动补写过去的经历。</p></div>}
    <div className="mt-4 space-y-3">{memories.map(m => <article key={m.id} className="rounded-xl border border-ink-100 bg-white p-5">
      <div className="flex items-center justify-between gap-3 text-xs text-ink-400"><span>{kinds[m.kind]} · {m.origin === 'human' ? '你已确认或编辑' : 'AI 自动记录'}</span><span>{new Date(m.updatedAt).toLocaleString('zh-CN')}</span></div>
      <p className="my-3 whitespace-pre-wrap break-words text-[15px] leading-7">{m.body}</p>
      <p className="text-xs text-ink-400">适用范围：{m.conversationId ? (m.conversationTitle || '来源会话') : '这位 AI 的所有会话'}</p>
      {m.sourceExcerpt && <details className="mt-2 text-xs text-ink-400"><summary className="cursor-pointer">查看来源消息</summary><blockquote className="mt-2 whitespace-pre-wrap border-l-2 border-ink-100 pl-3">{m.sourceExcerpt}</blockquote></details>}
      {deleting?.id === m.id ? <div className="mt-4 rounded-md bg-red-50 p-3 text-sm"><p>确定删除这条记忆？原聊天消息仍保留，已开始的回复可能仍包含旧记忆。</p><div className="mt-2 flex gap-2"><button className={button} disabled={busy} onClick={() => void run(async () => {await api.deleteSocialMemory(agent.id,m.id,m.revision);setDeleting(null)})}>确认删除</button><button className={button} disabled={busy} onClick={() => setDeleting(null)}>取消</button></div></div> :
      <div className="mt-3 flex justify-end gap-2"><button className={button} disabled={busy} onClick={() => edit(m)}>修改</button><button className={`${button} text-red-600`} disabled={busy} onClick={() => {setDeleting(m);setEditor(null)}}>删除</button></div>}
    </article>)}</div>
    <p className="my-5 text-xs leading-6 text-ink-400">修改、删除或暂停从下一轮回复起生效。删除记忆不会删除聊天记录。每轮只读取当前会话可用的最近 20 条记忆，优先使用你确认的内容。</p>
  </section>
}
