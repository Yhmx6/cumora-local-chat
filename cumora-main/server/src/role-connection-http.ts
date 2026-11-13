import { lookup } from 'node:dns/promises'
import { request } from 'node:https'
import { BlockList, isIP } from 'node:net'
import type { RoleConnectionInput } from '../../shared/role-connection.js'
import { parseModelId } from './agents/computer/model-id.js'

export class ConnectionError extends Error {
  constructor(message:string,public status=400) { super(message) }
}
const blocked4 = new BlockList(), blocked6 = new BlockList()
for (const [net,bits] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',4],['240.0.0.0',4]] as const) blocked4.addSubnet(net,bits,'ipv4')
for (const [net,bits] of [['::',96],['::ffff:0:0',96],['64:ff9b::',96],['64:ff9b:1::',48],['100::',64],['2001::',23],['2002::',16],['fc00::',7],['fe80::',10],['fec0::',10],['ff00::',8]] as const) blocked6.addSubnet(net,bits,'ipv6')
export function publicAddress(address:string):boolean {
  const family = isIP(address)
  return family===4 ? !blocked4.check(address,'ipv4') : family===6 ? !blocked6.check(address,'ipv6') : false
}
export function connectionUrl(raw:unknown):string {
  try {
    if (typeof raw !== 'string' || raw.length > 2048 || /[\x00-\x20\x7f]/.test(raw)) throw new Error()
    const u = new URL(raw)
    const host = u.hostname.replace(/^\[|\]$/g,'').replace(/\.$/,'')
    if (u.protocol !== 'https:' || u.username || u.password || u.search || u.hash || (u.port && u.port !== '443')
      || host === 'localhost' || host.endsWith('.local') || host.endsWith('.localhost') || host.endsWith('.arpa')
      || (isIP(host) && !publicAddress(host))) throw new Error()
    if (/\/(messages|chat\/completions|responses)$/.test(u.pathname)) throw new ConnectionError('请填写基础地址，不要包含 /messages、/chat/completions 或 /responses')
    return u.href.replace(/\/+$/,'')
  } catch(e) { if(e instanceof ConnectionError) throw e; throw new ConnectionError('接口地址必须是有效的公网 HTTPS 基础地址，不能包含密钥或查询参数') }
}
function field(raw:unknown,max:number,label:string):string {
  if (typeof raw !== 'string' || !raw.trim() || raw.length > max || /[\x00-\x1f\x7f]/.test(raw)) throw new ConnectionError(`请填写有效的${label}`)
  return raw.trim()
}
export function validateConnection(raw:unknown,previous?:RoleConnectionInput):RoleConnectionInput & {apiKey:string} {
  const b = raw as RoleConnectionInput
  if (!b || typeof b !== 'object' || !['openai','anthropic'].includes(b.protocol) || !['bearer','api-key'].includes(b.authType)) throw new ConnectionError('请选择接口协议和认证方式')
  const normalized = connectionUrl(b.baseUrl)
  const baseUrl = b.protocol === 'anthropic' ? normalized.replace(/\/v1$/,'') : normalized
  const apiKey = b.apiKey === undefined || b.apiKey === '' ? previous?.apiKey : b.apiKey
  if (!b.apiKey && previous && (baseUrl !== previous.baseUrl || b.protocol !== previous.protocol || b.authType !== previous.authType)) throw new ConnectionError('修改地址、协议或认证方式后，请重新填写密钥')
  const model=field(b.model,128,'模型 ID'),fastModel=field(b.fastModel || b.model,128,'快速模型 ID')
  try {parseModelId(model);parseModelId(fastModel)}catch{throw new ConnectionError('模型 ID 格式不正确，请复制服务商提供的完整 ID')}
  return {label:field(b.label,80,'服务商名称'),protocol:b.protocol,baseUrl,model,fastModel,authType:b.authType,apiKey:field(apiKey,8192,'API Key')}
}
/** DNS is checked and pinned to the TLS request. Redirects are never followed;
 * vendor bodies never enter errors/logs (some gateways echo credentials). */
export async function connectionRequest(c:RoleConnectionInput & {apiKey:string},body:unknown,signal?:AbortSignal,operation:'message'|'models'='message'):Promise<any> {
  const base = connectionUrl(c.baseUrl)
  const url = new URL(base + (operation==='models' ? (c.protocol==='openai'||/\/v1$/.test(base)?'/models':'/v1/models') : c.protocol === 'openai' ? '/chat/completions' : /\/v1$/.test(base) ? '/messages' : '/v1/messages'))
  if(operation==='models') {
    if(url.hostname==='api.deepseek.com'&&base.endsWith('/anthropic'))url.pathname='/models'
    if(url.hostname==='api.moonshot.cn'&&base.endsWith('/anthropic'))url.pathname='/v1/models'
    if(url.hostname==='ark.cn-beijing.volces.com'&&base.endsWith('/api/compatible'))url.pathname='/api/v3/models'
  }
  const abort = AbortSignal.any([AbortSignal.timeout(120_000),...(signal ? [signal] : [])])
  const addresses = await lookup(url.hostname.replace(/^\[|\]$/g,''),{all:true})
  if (!addresses.length || addresses.some(a=>!publicAddress(a.address))) throw new ConnectionError('接口域名解析到了受限地址')
  const selected = addresses[0], payload = operation==='models'?'':JSON.stringify(body)
  return new Promise((resolve,reject)=>{
    const req = request({hostname:selected.address,family:selected.family,servername:url.hostname,path:url.pathname,method:operation==='models'?'GET':'POST',agent:false,signal:abort,
      headers:{host:url.host,'content-type':'application/json','content-length':Buffer.byteLength(payload),'anthropic-version':'2023-06-01',
        ...(c.authType === 'api-key' ? {'x-api-key':c.apiKey} : {authorization:`Bearer ${c.apiKey}`})}},res=>{
      const chunks:Buffer[]=[];let bytes=0
      res.on('data',chunk=>{bytes+=chunk.length;if(bytes>16*1024*1024){res.destroy();reject(new ConnectionError('接口返回内容过大',502))}else chunks.push(chunk)})
      res.on('error',()=>reject(new ConnectionError('接口响应中断，请重试',502)))
      res.on('end',()=>{
        if (!res.statusCode || res.statusCode<200 || res.statusCode>=300) {
          const unavailable=/Endpoint is unavailable/i.test(Buffer.concat(chunks).toString())
          reject(new ConnectionError(unavailable ? `服务商返回 HTTP ${res.statusCode}：上游模型端点不可用，可稍后重试或更换接口、模型` : `接口返回 HTTP ${res.statusCode ?? 0}，请检查地址、密钥、模型及额度`,502));return
        }
        try { resolve(JSON.parse(Buffer.concat(chunks).toString())) } catch { reject(new ConnectionError('接口未返回有效 JSON',502)) }
      })
    })
    req.on('error',()=>reject(new ConnectionError(abort.aborted ? '接口连接超时或已取消' : '无法连接接口，请检查网络和地址',502)))
    req.end(payload)
  })
}
