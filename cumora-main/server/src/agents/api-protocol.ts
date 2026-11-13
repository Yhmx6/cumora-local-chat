import { randomUUID } from 'node:crypto'
import { ConnectionError } from '../role-connection-http.js'

type Obj = Record<string,any>
function blocks(value:any):Obj[] { return typeof value === 'string' ? [{type:'text',text:value}] : Array.isArray(value) ? value : [] }
function content(value:any):Obj[] {
  return blocks(value).flatMap<Obj>(b=>{
    if(b.type==='text') return [{type:'text',text:String(b.text ?? '')}]
    if(b.type==='image' && b.source?.type==='base64') return [{type:'image_url',image_url:{url:`data:${b.source.media_type};base64,${b.source.data}`}}]
    if(b.type==='image' && b.source?.type==='url') return [{type:'image_url',image_url:{url:b.source.url}}]
    if(['thinking','redacted_thinking','tool_use','tool_result'].includes(b.type)) return []
    throw new ConnectionError('该内容类型暂不支持 OpenAI 兼容接口，请使用 Anthropic 兼容接口')
  })
}
export function toOpenAI(b:Obj,official=false):Obj {
  const messages:Obj[]=[]
  if(b.system) messages.push({role:'system',content:blocks(b.system).map(x=>x.text ?? '').join('\n')})
  for(const m of b.messages ?? []) {
    const parts=blocks(m.content)
    if(m.role==='assistant') {
      const calls=parts.filter(p=>p.type==='tool_use').map(p=>({id:p.id,type:'function',function:{name:p.name,arguments:JSON.stringify(p.input ?? {})}}))
      messages.push({role:'assistant',...(m.openai_reasoning!==undefined?{reasoning_content:m.openai_reasoning}:{}),content:parts.filter(p=>p.type==='text').map(p=>p.text).join('\n') || null,...(calls.length?{tool_calls:calls}:{})})
    } else {
      for(const p of parts.filter(p=>p.type==='tool_result')) messages.push({role:'tool',tool_call_id:p.tool_use_id,content:typeof p.content==='string'?p.content:blocks(p.content).map(x=>x.text ?? '[非文本工具结果]').join('\n')})
      const text=content(parts)
      if(text.length) messages.push({role:'user',content:text})
    }
  }
  const result:Obj={model:b.model,messages,stream:false,[official?'max_completion_tokens':'max_tokens']:b.max_tokens ?? 4096}
  if (b.tools?.length) {
    result.tools=b.tools.map((t:Obj)=>{
      if (!t.name || !t.input_schema) throw new ConnectionError('当前接口仅支持普通函数工具')
      return {type:'function',function:{name:t.name,description:t.description ?? '',parameters:t.input_schema}}
    })
    if(b.tool_choice?.type==='tool') result.tool_choice={type:'function',function:{name:b.tool_choice.name}}
    else if(b.tool_choice?.type==='any') result.tool_choice='required'
    else if(b.tool_choice?.type==='none') result.tool_choice='none'
    else result.tool_choice='auto'
    if (b.tool_choice?.disable_parallel_tool_use) result.parallel_tool_calls=false
  }
  return result
}
export function fromOpenAI(data:Obj,model:string):Obj {
  const choice=data.choices?.[0], m=choice?.message
  if(!m) throw new ConnectionError('接口未返回有效的聊天结果',502)
  const output:Obj[]=[]
  if(m.content || m.refusal) output.push({type:'text',text:m.content || m.refusal})
  for(const call of m.tool_calls ?? []) {
    let input:unknown
    try { input=JSON.parse(call.function.arguments) } catch { throw new ConnectionError('模型返回了无效的工具参数',502) }
    output.push({type:'tool_use',id:call.id,name:call.function.name,input})
  }
  const usage=data.usage ?? {}, cached=usage.prompt_tokens_details?.cached_tokens ?? usage.prompt_cache_hit_tokens ?? 0
  return {id:`msg_${randomUUID()}`,type:'message',role:'assistant',model,...(typeof m.reasoning_content==='string'?{openai_reasoning:m.reasoning_content}:{}),content:output,stop_reason:m.tool_calls?.length?'tool_use':choice.finish_reason==='length'?'max_tokens':'end_turn',stop_sequence:null,
    usage:{input_tokens:Math.max(0,(usage.prompt_tokens ?? 0)-cached),output_tokens:usage.completion_tokens ?? 0,cache_read_input_tokens:cached,cache_creation_input_tokens:0}}
}
