import { timingSafeEqual } from 'node:crypto'
import { Router, json, type Response } from 'express'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { readRoleVault } from './agents/computer/role-vault.js'
import { connectionRequest, ConnectionError } from './role-connection-http.js'
import { pool } from './db/pool.js'

import { toOpenAI, fromOpenAI } from './agents/api-protocol.js'
export { toOpenAI, fromOpenAI } from './agents/api-protocol.js'
type Obj = Record<string,any>
export function writeMessageStream(res:Response,message:Obj):void {
  const emit=(type:string,body:Obj)=>res.write(`event: ${type}\ndata: ${JSON.stringify({type,...body})}\n\n`)
  emit('message_start',{message:{...message,content:[],stop_reason:null,usage:{...message.usage,output_tokens:0}}})
  message.content.forEach((block:Obj,index:number)=>{
    emit('content_block_start',{index,content_block:block.type==='text'?{type:'text',text:''}:{...block,input:{}}})
    emit('content_block_delta',{index,delta:block.type==='text'?{type:'text_delta',text:block.text}:{type:'input_json_delta',partial_json:JSON.stringify(block.input)}})
    emit('content_block_stop',{index})
  })
  emit('message_delta',{delta:{stop_reason:message.stop_reason,stop_sequence:null},usage:{output_tokens:message.usage.output_tokens}})
  emit('message_stop',{})
  res.end()
}
export function createRoleModelBridge(requestModel=connectionRequest) {
  const router=Router()
  router.use(json({limit:'16mb'}))
  router.post('/:id/v1/messages',async(req,res)=>{
    if(process.env.CUMORA_ROLE_CONNECTIONS!=='1') {res.sendStatus(404);return}
    const row=readRoleVault(join(homedir(),'.cumora')).find(r=>r.id===String(req.params.id))
    const token=Buffer.from(String(req.headers.authorization ?? '').replace(/^Bearer /,''))
    if(!row || row.config.protocol!=='openai' || token.length!==Buffer.byteLength(row.bridgeToken) || !timingSafeEqual(token,Buffer.from(row.bridgeToken))) {res.sendStatus(401);return}
    const active=await pool.query('SELECT 1 FROM participants WHERE company_id=$1 AND provider_profile=$2 AND kind=\'agent\' AND departed_at IS NULL LIMIT 1',[row.companyId,row.id])
    if(!active.rowCount) {res.sendStatus(403);return}
    if(![row.config.model,row.config.fastModel].includes(req.body?.model)) {res.status(400).json({type:'error',error:{type:'invalid_request_error',message:'模型与角色配置不一致'}});return}
    const controller=new AbortController()
    res.on('close',()=>controller.abort())
    let ping:ReturnType<typeof setInterval>|undefined
    try {
      if(req.body.stream) {
        res.setHeader('Content-Type','text/event-stream');res.setHeader('Cache-Control','no-cache');res.flushHeaders()
        ping=setInterval(()=>res.write('event: ping\ndata: {"type":"ping"}\n\n'),10000)
      }
      const result=fromOpenAI(await requestModel(row.config,toOpenAI(req.body,new URL(row.config.baseUrl).hostname==='api.openai.com'),controller.signal),req.body.model)
      if(req.body.stream) writeMessageStream(res,result);else res.json(result)
    } catch(e) {
      const error={type:'error',error:{type:'api_error',message:e instanceof ConnectionError?e.message:'模型接口暂不可用'}}
      if(res.headersSent) res.end(`event: error\ndata: ${JSON.stringify(error)}\n\n`)
      else res.status(502).json(error)
    } finally {if(ping) clearInterval(ping)}
  })
  return router
}
