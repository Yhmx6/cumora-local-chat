import { useId, useState } from 'react'
import { Input } from './Input'
import { CONNECTION_PRESETS, type RoleConnectionInput } from '../../shared/role-connection'

export function RoleConnectionFields({value,onChange,hasKey,disabled,testing,result,onTest,onLoadModels}:{
  value:RoleConnectionInput;onChange:(v:RoleConnectionInput)=>void;hasKey:boolean;disabled:boolean;testing:boolean;result:string|null;onTest:()=>void;onLoadModels:()=>Promise<string[]>
}) {
  const listId=useId();const [models,setModels]=useState<string[]>([]);const [loading,setLoading]=useState(false);const [modelNote,setModelNote]=useState('')
  const load=async()=>{setLoading(true);try{const ids=await onLoadModels();setModels(ids);setModelNote(ids.length?'已读取，可选择或手动填写模型':'服务商未返回模型列表，请手动填写')}catch{setModelNote('暂时无法读取模型列表，可直接填写模型 ID')}finally{setLoading(false)}}
  const change=(patch:Partial<RoleConnectionInput>)=>onChange({...value,...patch})
  const selectClass='w-full rounded-[10px] border border-ink-100 bg-paper px-3 py-2 text-[13px]'
  return <div className="space-y-3">
    <label className="block text-[12px] text-ink-600">服务商预设
      <select aria-label="服务商预设" disabled={disabled} className={selectClass}
        value={CONNECTION_PRESETS.find(p=>p.baseUrl===value.baseUrl&&p.protocol===value.protocol&&p.authType===value.authType)?.id ?? 'custom'}
        onChange={e=>{const p=CONNECTION_PRESETS.find(p=>p.id===e.target.value);if(p) change({label:p.label,protocol:p.protocol,baseUrl:p.baseUrl,authType:p.authType,apiKey:'',model:'',fastModel:''})}}>
        <option value="custom">自定义接口</option>
        {CONNECTION_PRESETS.map(p=><option key={p.id} value={p.id}>{p.label}</option>)}
      </select>
    </label>
    <label className="block text-[12px] text-ink-600">API Key <span className="text-skype-deep">{hasKey?'· 已配置，留空保留':''}</span>
      <Input aria-label="API Key" type="password" autoComplete="new-password" disabled={disabled} value={value.apiKey ?? ''} onChange={e=>change({apiKey:e.target.value})} placeholder={hasKey?'输入新密钥以替换':'粘贴此角色使用的 API Key'} spellCheck={false}/>
      <span className="text-[11px] text-ink-400">保存时会在本机加密密钥，不会回显；修改地址或协议后需重新填写</span>
    </label>
    <label className="block text-[12px] text-ink-600">模型 ID
      <Input aria-label="接口模型 ID" list={listId} disabled={disabled} value={value.model} onChange={e=>change({model:e.target.value,...(value.fastModel===value.model?{fastModel:''}:{})})} placeholder="填写账号已开通的模型 ID" spellCheck={false}/>
    </label>
    <datalist id={listId}>{models.map(id=><option key={id} value={id}/>)}</datalist>
    <div className="text-[11px] text-ink-500"><button type="button" disabled={disabled||loading||(!hasKey&&!value.apiKey)} onClick={()=>void load()} className="text-skype-deep disabled:opacity-50">{loading?'正在读取…':'读取可用模型'}</button>{modelNote&&<p role="status">{modelNote}</p>}</div>
    <details className="text-[12px] text-ink-600"><summary className="cursor-pointer">高级设置</summary>
      <div className="space-y-3 pt-3">    <div className="grid grid-cols-2 gap-3">
      <label className="text-[12px] text-ink-600">服务商名称<Input aria-label="服务商名称" disabled={disabled} value={value.label} onChange={e=>change({label:e.target.value})}/></label>
      <label className="text-[12px] text-ink-600">接口协议
        <select aria-label="接口协议" className={selectClass} disabled={disabled} value={value.protocol} onChange={e=>change({protocol:e.target.value as RoleConnectionInput['protocol'],apiKey:''})}>
          <option value="anthropic">Anthropic Messages</option><option value="openai">OpenAI Chat Completions</option>
        </select>
      </label>
    </div>
    <label className="block text-[12px] text-ink-600">接口基础地址
      <Input aria-label="接口基础地址" type="url" disabled={disabled} value={value.baseUrl} onChange={e=>change({baseUrl:e.target.value})} placeholder="https://api.example.com/v1" spellCheck={false}/>
      <span className="text-[11px] text-ink-400">使用服务商的基础地址，不要填写完整的消息接口路径</span>
    </label>

        <label className="block">快速模型 ID（留空使用同一模型）<Input aria-label="接口快速模型 ID" disabled={disabled} value={value.fastModel} onChange={e=>change({fastModel:e.target.value})}/></label>
        <label className="block">认证方式<select aria-label="认证方式" className={selectClass} disabled={disabled} value={value.authType} onChange={e=>change({authType:e.target.value as RoleConnectionInput['authType'],apiKey:''})}><option value="bearer">Bearer Token</option><option value="api-key">x-api-key</option></select></label>
      </div>
    </details>
    <div className="flex items-center gap-3">
      <button type="button" disabled={disabled||testing||!value.baseUrl||!value.model||(!hasKey&&!value.apiKey)} onClick={onTest} className="px-3 py-2 rounded-lg border border-ink-100 text-[12px] disabled:opacity-50">{testing?'正在检查…':'测试连接'}</button>
      <span className="text-[11px] text-ink-400">会检查所选模型，产生少量用量</span>
    </div>
    {result&&<p role="status" className="text-[12px] leading-relaxed text-ink-600">{result}</p>}
  </div>
}
