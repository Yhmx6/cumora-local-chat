import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,readFileSync,writeFileSync,rmSync,statSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {readRoleVault,writeRoleVault,roleRuntimeProfile,type VaultConnection} from '../agents/computer/role-vault.js'
import {readProviderProfiles,providerProfileMetadata} from '../agents/computer/provider-profiles.js'
import {validateConnection,connectionUrl,publicAddress} from '../role-connection-http.js'
import {toOpenAI,fromOpenAI,writeMessageStream} from '../role-openai-bridge.js'
import {authFailureHint} from '../agents/computer/daemon.js'

const config={label:'Example',protocol:'anthropic' as const,baseUrl:'https://api.example.com',model:'model-a',fastModel:'model-a',authType:'bearer' as const,apiKey:'secret-test-never-return'}
test('upstream endpoint failures do not instruct users to buy credits or sign in to Claude',()=>{
  const hint=authFailureHint('claude','authentication_failed API Error: 403 Upstream request failed: Endpoint is unavailable.')
  assert.match(hint,/上游模型端点不可用/);assert.doesNotMatch(hint,/sign in|credits/)
})
test('blank key retains only the same address/protocol/auth and invalid values do not echo secrets',()=>{
  assert.equal(validateConnection({...config,apiKey:''},config).apiKey,config.apiKey)
  for(const patch of [{baseUrl:'https://other.example.com'},{protocol:'openai'},{authType:'api-key'}]) assert.throws(()=>validateConnection({...config,...patch,apiKey:''},config),/重新填写/)
  assert.throws(()=>validateConnection({...config,apiKey:''}),/API Key/)
  assert.throws(()=>validateConnection({...config,apiKey:'bad\nkey'}),/API Key/)
  assert.equal(validateConnection({...config,fastModel:''}).fastModel,config.model)
})
test('credentials in URLs, private destinations and complete operation paths are rejected',()=>{
  for(const url of ['http://api.example.com','https://u:secret@example.com','https://example.com?key=secret','https://127.0.0.1','https://169.254.169.254','https://[::1]','https://localhost','https://example.com:9090','https://example.com/v1/messages','https://example.com/v1/chat/completions']) assert.throws(()=>connectionUrl(url))
  for(const address of ['127.0.0.1','10.1.2.3','192.168.1.1','169.254.169.254','::1','::ffff:127.0.0.1','fe80::1','fc00::1']) assert.equal(publicAddress(address),false,address)
  assert.equal(publicAddress('8.8.8.8'),true)
})
test('vault encrypts secrets, preserves legacy profiles and rejects tampered ciphertext',()=>{
  const root=mkdtempSync(join(tmpdir(),'role-vault-'))
  try {
    const row:VaultConnection={id:'role-test',companyId:'c',ownerKey:'agent:a',revision:'r1',bridgeToken:'bridge-secret',config}
    writeRoleVault(root,[row])
    assert.deepEqual(readRoleVault(root),[row])
    const file=join(root,'role-connections.enc'),cipher=readFileSync(file,'utf8')
    assert.ok(!cipher.includes(config.apiKey));assert.ok(!cipher.includes('bridge-secret'))
    if(process.platform!=='win32')assert.equal(statSync(file).mode&0o777,0o600)
    assert.deepEqual(readProviderProfiles(join(root,'providers.json'))[0].auth,{authToken:config.apiKey})
    assert.ok(!JSON.stringify(providerProfileMetadata(roleRuntimeProfile(row))).includes(config.apiKey))
    const sealed=JSON.parse(cipher);sealed.tag=Buffer.alloc(16).toString('base64');writeFileSync(file,JSON.stringify(sealed))
    assert.throws(()=>readRoleVault(root),/decrypted/)
  } finally {rmSync(root,{recursive:true,force:true})}
})
test('OpenAI profiles give the engine only a role-scoped bridge credential',()=>{
  const p=roleRuntimeProfile({id:'role-a',companyId:'c',ownerKey:'agent:a',revision:'r',bridgeToken:'bridge-only',config:{...config,protocol:'openai'}})
  assert.match(p.baseUrl,/127\.0\.0\.1.*role-a/)
  assert.ok(!JSON.stringify(p).includes(config.apiKey));assert.deepEqual(p.auth,{authToken:'bridge-only'})
})
test('protocol translation keeps system text, images, tool calls and tool results in order',()=>{
  const result=toOpenAI({model:'m',max_tokens:128,system:[{type:'text',text:'personality'}],messages:[{role:'user',content:'hello'},{role:'assistant',content:[{type:'thinking',thinking:'hidden'},{type:'text',text:'wait'},{type:'tool_use',id:'t1',name:'bash',input:{command:'hi'}}]},{role:'user',content:[{type:'tool_result',tool_use_id:'t1',content:'done'},{type:'image',source:{type:'base64',media_type:'image/png',data:'abc'}}]}],tools:[{name:'bash',input_schema:{type:'object'}}],tool_choice:{type:'tool',name:'bash'}},true)
  assert.equal(result.messages[0].role,'system');assert.equal(result.messages[2].tool_calls[0].function.arguments,'{"command":"hi"}')
  assert.equal(result.messages[3].role,'tool');assert.equal(result.messages[3].tool_call_id,'t1')
  assert.equal(result.messages[4].content[0].image_url.url,'data:image/png;base64,abc')
  assert.equal(result.max_completion_tokens,128);assert.equal(result.tool_choice.function.name,'bash');assert.ok(!JSON.stringify(result).includes('hidden'))
})
test('bridge returns accurate cache usage, valid streamed tool events, and rejects malformed tool JSON',()=>{
  const message=fromOpenAI({choices:[{message:{tool_calls:[{id:'t1',function:{name:'bash',arguments:'{"ok":true}'}}]},finish_reason:'tool_calls'}],usage:{prompt_tokens:100,completion_tokens:10,prompt_tokens_details:{cached_tokens:20}}},'m')
  assert.equal(message.usage.input_tokens,80);assert.equal(message.usage.cache_read_input_tokens,20);assert.equal(message.stop_reason,'tool_use')
  let output='';writeMessageStream({write:(s:string)=>{output+=s},end:()=>{}} as any,message)
  assert.match(output,/event: message_start/);assert.match(output,/input_json_delta/);assert.match(output,/event: message_stop/)
  assert.throws(()=>fromOpenAI({choices:[{message:{tool_calls:[{function:{arguments:'not-json'}}]}}]},'m'),/无效/)
})
