import { Router, type Request } from 'express'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import { pool } from '../db/pool.js'
import { readProviderProfiles, providerProfileMetadata } from '../agents/computer/provider-profiles.js'
import { readRoleVault, writeRoleVault, type VaultConnection } from '../agents/computer/role-vault.js'
import { ConnectionError, connectionRequest, validateConnection } from '../role-connection-http.js'
import { toOpenAI, fromOpenAI } from '../role-openai-bridge.js'
import type { RoleConnectionInput, RoleConnectionView } from '../../../shared/role-connection.js'

const dir=()=>join(homedir(),'.cumora')
function publicConfig(config:RoleConnectionInput,revision:string):RoleConnectionView {
  return {label:config.label,protocol:config.protocol,baseUrl:config.baseUrl,model:config.model,fastModel:config.fastModel,authType:config.authType,hasKey:!!config.apiKey,revision}
}
async function localComputer(companyId:string):Promise<string|null> {
  if(process.env.CUMORA_ROLE_CONNECTIONS!=='1') return null
  // The fixed local pairing file determines the host; no paths/tokens from the renderer.
  let id:string
  try {id=JSON.parse(readFileSync(join(dir(),'computer.json'),'utf8')).computerId} catch {return null}
  const result=await pool.query("SELECT id FROM computers WHERE id=$1 AND company_id=$2 AND revoked_at IS NULL AND kind<>'cloud' AND available_engines ? 'api' AND COALESCE(unsandboxed_active,false)=false",[id,companyId])
  return result.rowCount ? id : null
}
async function previousConnection(companyId:string,computerId:string,agentId:unknown,draftId?:unknown) {
  if(agentId!==undefined && agentId!==null && (typeof agentId!=='string'||!agentId||agentId.length>150)) throw new ConnectionError('无效角色')
  if(agentId) {
    const {rows}=await pool.query('SELECT provider_profile,computer_id,model,fast_model FROM participants WHERE id=$1 AND company_id=$2 AND kind=\'agent\' AND departed_at IS NULL',[agentId,companyId])
    if(!rows[0]) throw new ConnectionError('角色不存在',404)
    const p=rows[0]
    if(p.computer_id===computerId && p.provider_profile) {
      const managed=readRoleVault(dir()).find(r=>r.id===p.provider_profile && r.companyId===companyId)
      if(managed) return {ownerKey:`agent:${agentId}`,config:{...managed.config,model:p.model||managed.config.model,fastModel:p.fast_model||managed.config.fastModel},revision:managed.revision}
      const legacy=readProviderProfiles(join(dir(),'providers.json')).find(r=>r.id===p.provider_profile)
      if(legacy) return {ownerKey:`agent:${agentId}`,config:{label:legacy.label,protocol:'anthropic' as const,baseUrl:legacy.baseUrl,model:p.model||legacy.model,fastModel:p.fast_model||legacy.fastModel,authType:'apiKey' in legacy.auth?'api-key' as const:'bearer' as const,apiKey:'apiKey' in legacy.auth?legacy.auth.apiKey:legacy.auth.authToken},revision:createHash('sha256').update(JSON.stringify(legacy)).digest('hex')}
    }
    return {ownerKey:`agent:${agentId}`,config:undefined,revision:''}
  }
  if(draftId!==undefined && (typeof draftId!=='string'||!/^[a-zA-Z0-9_-]{8,100}$/.test(draftId))) throw new ConnectionError('无效的新角色标识')
  const ownerKey=`draft:${draftId ?? ''}`
  const existing=draftId ? readRoleVault(dir()).filter(r=>r.ownerKey===ownerKey && r.companyId===companyId).sort((a,b)=>(b.createdAt??0)-(a.createdAt??0))[0] : undefined
  return {ownerKey,config:existing?.config,revision:existing?.revision ?? ''}
}
export function createRoleConnectionsRouter(authorize:(req:Request)=>Promise<{companyId:string;userId:string}>) {
  const router=Router()
  router.use(async(req,res,next)=>{
    try {res.locals.roleAuth=await authorize(req);res.setHeader('Cache-Control','no-store');next()}catch(e){res.status((e as {status?:number}).status ?? 403).json({error:'需要工作区管理员权限'})}
  })
  router.get('/',async(req,res)=>{
    const companyId=res.locals.roleAuth.companyId,computerId=await localComputer(companyId)
    if(!computerId){res.json({enabled:false,computerId:null,connection:null});return}
    const previous=await previousConnection(companyId,computerId,req.query.agentId)
    res.json({enabled:true,computerId,connection:previous.config?publicConfig(previous.config,previous.revision):null})
  })
  for(const action of ['prepare','test','models'] as const) router.post(`/${action}`,async(req,res)=>{
    const companyId=res.locals.roleAuth.companyId,computerId=await localComputer(companyId)
    if(!computerId) throw new ConnectionError('本机尚未启用角色接口配置，或运行环境不可用',409)
    if(!req.body?.agentId && !req.body?.draftId) throw new ConnectionError('请选择角色')
    const client=await pool.connect()
    try {
      await client.query('BEGIN')
      // File mutations and inventory publication serialize across API workers.
      await client.query('SELECT pg_advisory_xact_lock(71852341)')
      const previous=await previousConnection(companyId,computerId,req.body.agentId,req.body.draftId)
      if((req.body.revision ?? '')!==previous.revision) throw new ConnectionError('接口配置已被修改，请重新打开角色卡',409)
      const config=validateConnection(action==='models'?{...req.body.connection,model:'catalog-check',fastModel:'catalog-check'}:req.body.connection,previous.config)
      if(action==='models') {
        await client.query('COMMIT')
        const result=await connectionRequest(config,undefined,undefined,'models')
        const models=(Array.isArray(result.data)?result.data:[]).map((m:any)=>m.id).filter((id:unknown)=>typeof id==='string'&&id.length>0&&id.length<=128).slice(0,500)
        res.json({models});return
      }
      if(action==='test') {
        await client.query('COMMIT')
        const usages:any[]=[]
        for(const model of [...new Set([config.model,config.fastModel])]) {
        const body={model,max_tokens:1024,messages:[{role:'user',content:'Connection check. Call connection_check with status ok.'}],tools:[{name:'connection_check',description:'Confirm connection.',input_schema:{type:'object',properties:{status:{type:'string',enum:['ok']}},required:['status']}}]}
        const output=await connectionRequest(config,config.protocol==='openai'?toOpenAI(body,new URL(config.baseUrl).hostname==='api.openai.com'):body)
        const result=config.protocol==='openai'?fromOpenAI(output,config.model):output
        if(!result.content?.some((b:{type:string;name?:string;input?:{status?:string}})=>b.type==='tool_use'&&b.name==='connection_check'&&b.input?.status==='ok')) throw new ConnectionError('接口已连通，但工具调用检查未通过；该角色可能无法发送群聊消息',422)
        usages.push(result.usage)
        }
        res.json({ok:true,message:'连接成功，所选模型的聊天工具调用已通过',usage:usages});return
      }
      const rows=readRoleVault(dir())
      // Immutable prepared versions: until the normal assignment commits, the
      // running agent retains its old endpoint, credentials and model together.
      const id='role-'+createHash('sha256').update(companyId+'\0'+previous.ownerKey+'\0'+JSON.stringify(config)).digest('hex').slice(0,32)
      const existing=rows.find(r=>r.id===id)
      const row:VaultConnection={id,companyId,ownerKey:previous.ownerKey,config,revision:existing?.revision ?? randomUUID(),bridgeToken:existing?.bridgeToken ?? randomBytes(32).toString('base64url'),createdAt:existing?.createdAt ?? Date.now()}
      const references=await client.query('SELECT DISTINCT provider_profile FROM participants WHERE provider_profile IS NOT NULL')
      const used=new Set(references.rows.map(r=>r.provider_profile))
      const retained=rows.filter(r=>r.id!==id && (used.has(r.id) || Date.now()-(r.createdAt ?? 0)<86400000))
      writeRoleVault(dir(),[...retained,row])
      const profiles=readProviderProfiles(join(dir(),'providers.json')).map(providerProfileMetadata)
      await client.query(`UPDATE computers SET detected_engines=(SELECT jsonb_agg(CASE WHEN e->>'id'='api' THEN jsonb_set(e,'{providerProfiles}',$2::jsonb) ELSE e END) FROM jsonb_array_elements(detected_engines) e), detect_requested_at=NOW() WHERE id=$1 AND company_id=$3`,[computerId,JSON.stringify(profiles),companyId])
      await client.query('COMMIT')
      res.json({computerId,providerProfile:id,connection:publicConfig(config,row.revision)})
    } catch(e) {await client.query('ROLLBACK');throw e} finally {client.release()}
  })
  router.use((error:unknown,_req:Request,res:import('express').Response,_next:import('express').NextFunction)=>{
    res.status(error instanceof ConnectionError?error.status:500).json({error:error instanceof ConnectionError?error.message:'角色接口操作失败，请稍后重试'})
  })
  return router
}
