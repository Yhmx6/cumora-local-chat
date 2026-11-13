/** Cumora's built-in API loop. No CLI process, shell, filesystem tool, or model
 * access to credentials. All chat actions use the authenticated runtime broker. */
import { mkdir, readFile, realpath, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join, relative, sep } from 'node:path'
import { readRoleVault } from './role-vault.js'
import { readLegacyProviderProfiles } from './provider-profiles.js'
import { ConnectionError, connectionRequest } from '../../role-connection-http.js'
import { fromOpenAI, toOpenAI } from '../api-protocol.js'
import type { RoleConnectionInput } from '../../../../shared/role-connection.js'
import type { EngineAdapter, EngineClassifyArgs, EngineClassifyResult, EngineProbeArgs, EngineRunArgs, EngineRunResult, EngineUsage } from './engine.js'

type Connection = RoleConnectionInput & {apiKey:string}
type Block = Record<string,any>
const TOOL_NAME='mcp__cumora__cli'
const tool={name:TOOL_NAME,description:'Read conversations, reply, react, and remember via Cumora. Pass literal command arguments, without a shell. Examples: {"argv":["messages","conversation-id","--tail","20"]}, {"argv":["reply","conversation-id","message text"]}, {"argv":["glance","conversation-id"]}. No local commands or files.',input_schema:{type:'object',properties:{argv:{type:'array',items:{type:'string'},minItems:1,maxItems:40}},required:['argv'],additionalProperties:false}}
const COMMANDS=new Set(['help','--help','whoami','participants','participants-status','conversations','groups','directs','members','inbox','messages','thread','topic','search','glance','reply','react','memory'])
export function directApiArgv(raw:unknown):string[] {
  if(!Array.isArray(raw)||raw.length<1||raw.length>40||raw.some(x=>typeof x!=='string'||x.length>18000||x.includes('\0'))) throw new Error('工具参数必须是命令字符串数组')
  const argv=raw[0]==='cumora'?raw.slice(1):raw
  if(!COMMANDS.has(argv[0]) || argv.some(x=>/^--(?:as|server|token|file|stdin)(?:=|$)/.test(x))) throw new Error('API 群聊仅支持会话与相处记忆操作，不能执行本机命令或改变身份')
  if(argv[0]==='memory' && !['remember','recall','--help'].includes(argv[1])) throw new Error('请使用 memory remember 或 memory recall 管理相处记忆')
  return argv
}
export function resolveDirectConnection(env:NodeJS.ProcessEnv):Connection {
  const id=env.CUMORA_API_PROFILE_ID
  if(!id) throw new ConnectionError('角色尚未配置 API，请打开模型连接设置')
  const dir=join(homedir(),'.cumora')
  const saved=readRoleVault(dir).find(r=>r.id===id)
  if(saved) return saved.config
  const old=readLegacyProviderProfiles(join(dir,'providers.json')).find(p=>p.id===id)
  if(!old) throw new ConnectionError('角色的 API 配置不存在')
  return {label:old.label,protocol:'anthropic',baseUrl:old.baseUrl,model:old.model,fastModel:old.fastModel,authType:'apiKey' in old.auth?'api-key':'bearer',apiKey:'apiKey' in old.auth?old.auth.apiKey:old.auth.authToken}
}
async function images(home:string,paths:readonly string[]):Promise<Block[]> {
  const root=await realpath(home),output:Block[]=[];let total=0
  for(const file of [...new Set(paths)].slice(0,6)) {
    const resolved=await realpath(file),rel=relative(root,resolved)
    if(!rel||rel==='..'||rel.startsWith('..'+sep)||isAbsolute(rel)) throw new ConnectionError('图片不属于当前角色的附件目录')
    const info=await stat(resolved);total+=info.size
    if(!info.isFile()||info.size>10*1024*1024||total>20*1024*1024)throw new ConnectionError('图片过大，请减少图片数量或压缩后重试')
    const bytes=await readFile(resolved)
    const mime=bytes[0]===0x89&&bytes[1]===0x50?'image/png':bytes[0]===0xff&&bytes[1]===0xd8?'image/jpeg':bytes.subarray(0,4).toString()==='RIFF'?'image/webp':bytes.subarray(0,3).toString()==='GIF'?'image/gif':null
    if(!mime)continue
    output.push({type:'image',source:{type:'base64',media_type:mime,data:bytes.toString('base64')}})
  }
  return output
}
export class DirectApiAdapter implements EngineAdapter {
  readonly id='api' as const
  readonly bin='cumora-internal-api'
  constructor(private request=connectionRequest,private resolve=resolveDirectConnection){}
  async seedHome(home:string):Promise<void>{await mkdir(home,{recursive:true,mode:0o700})}
  async probeWake(){return {ok:true,detail:'Cumora 内置 API，不启动外部引擎',skipped:true}}
  async probe(args:EngineProbeArgs):Promise<EngineClassifyResult>{return this.classify({...args,prompt:'Reply OK only.',model:undefined})}
  private async completion(c:Connection,body:Block,signal:AbortSignal):Promise<Block>{
    const result=await this.request(c,c.protocol==='openai'?toOpenAI(body,new URL(c.baseUrl).hostname==='api.openai.com'):body,signal)
    return c.protocol==='openai'?fromOpenAI(result,body.model):result
  }
  async classify(args:EngineClassifyArgs):Promise<EngineClassifyResult>{
    try {
      const c=this.resolve(args.env),model=args.model||c.fastModel
      const answer=await this.completion(c,{model,max_tokens:1024,messages:[{role:'user',content:args.prompt}]},args.signal)
      return {text:(answer.content??[]).filter((b:Block)=>b.type==='text').map((b:Block)=>b.text).join('\n'),usage:answer.usage,model:answer.model||model}
    }catch(e){return {text:'',error:e instanceof ConnectionError?e.message:'API 分流调用失败'}}
  }
  async run(args:EngineRunArgs):Promise<EngineRunResult>{
    const usage:EngineUsage={};let model=args.model??undefined
    let c:Connection|undefined;let reminder=false,posted=false
    const completed=new Map<string,{text?:string;exitCode?:number;error?:string}>()
    try {
      c=this.resolve(args.env);model=model||c.model
      if(!args.runTool)throw new ConnectionError('Cumora 聊天工具未连接')
      const messages:Block[]=[{role:'user',content:[{type:'text',text:args.prompt},...await images(args.home,args.localImages??[])]}]
      for(let hop=1;hop<=10;hop++){
        args.signal.throwIfAborted()
        const start=Date.now()
        const response=await this.completion(c,{model,max_tokens:4096,system:'You are the Cumora teammate defined in the current prompt. Use mcp__cumora__cli to read and send real chat messages. Ordinary completion text is private reasoning and is NOT posted. Never execute a shell or access local files. You may stay silent when appropriate.',messages,tools:[tool]},args.signal)
        if(!Array.isArray(response.content))throw new ConnectionError('模型未返回有效消息',502)
        const calls=response.content.filter((b:Block)=>b.type==='tool_use')
        if(response.usage)for(const key of ['input_tokens','output_tokens','cache_read_input_tokens','cache_creation_input_tokens'] as const)usage[key]=(usage[key]??0)+(Number(response.usage[key])||0)
        args.onHopUsage?.({model:response.model||model,usage:response.usage,latencyMs:Date.now()-start,hopIndex:hop,toolUses:calls.length,textChars:response.content.filter((b:Block)=>b.type==='text').reduce((n:number,b:Block)=>n+String(b.text).length,0)})
        if(!calls.length){
          if(!posted&&!reminder&&response.content.some((b:Block)=>b.type==='text'&&b.text?.trim())){reminder=true;messages.push({role:'assistant',content:response.content},{role:'user',content:'Your text was not posted. If you intended to answer, read the conversation and use the reply tool. Otherwise end without text.'});continue}
          return {exitCode:0,usage,model}
        }
        if(calls.length>12)throw new ConnectionError('模型一次请求了过多操作，已停止本轮')
        messages.push({role:'assistant',content:response.content,...(response.openai_reasoning!==undefined?{openai_reasoning:response.openai_reasoning}:{})})
        const results:Block[]=[]
        for(const call of calls){
          args.signal.throwIfAborted()
          try {
            if(call.name!==TOOL_NAME)throw new Error('只允许使用 Cumora 会话工具')
            const argv=directApiArgv(call.input?.argv)
            const cacheKey=JSON.stringify(argv),dedupe=['reply','react','memory'].includes(argv[0])
            const result=(dedupe?completed.get(cacheKey):undefined)??await args.runTool(argv,args.signal)
            if(dedupe&&result.exitCode===0&&!/\bheld\b/i.test(result.text??''))completed.set(cacheKey,result)
            if(argv[0]==='reply'&&result.exitCode===0&&!/\bheld\b/i.test(result.text??''))posted=true
            const text=String(result.error||result.text||'完成').slice(0,32000)
            results.push({type:'tool_result',tool_use_id:call.id,content:text,is_error:result.exitCode!==0})
          }catch(e){results.push({type:'tool_result',tool_use_id:call.id,content:args.signal.aborted?'本轮已取消':(e as Error).message,is_error:true})}
        }
        messages.push({role:'user',content:results})
      }
      throw new ConnectionError('已达到本轮操作上限，避免重复发言，下一条消息可继续')
    }catch(e){
      const error=args.signal.aborted?'API 调用已停止':e instanceof ConnectionError?e.message:'API 调用失败，请检查模型连接'
      const safe=c?error.split(c.apiKey).join('[redacted]'):error
      return {exitCode:1,error:safe,usage,model,failure:{kind:/HTTP (401|403)/.test(safe)?'authentication':/HTTP 429/.test(safe)?'rate-limit':'transport',message:safe,diagnostic:safe}}
    }
  }
}
