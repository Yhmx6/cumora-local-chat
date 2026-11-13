import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {DirectApiAdapter,directApiArgv} from '../agents/computer/direct-api-engine.js'
import {getAdapter,evaluateRunnableEngines} from '../agents/computer/engine.js'
import {ConnectionError} from '../role-connection-http.js'
import {fromOpenAI,toOpenAI} from '../agents/api-protocol.js'
const connection={label:'fixture',protocol:'anthropic' as const,baseUrl:'https://example.com',model:'fixture',fastModel:'fixture',apiKey:'fixture-secret',authType:'bearer' as const}
const tool=(id:string,argv:string[])=>({type:'tool_use',id,name:'mcp__cumora__cli',input:{argv}})
test('built-in adapter is runnable without Claude Code or its sandbox dependencies',async()=>{
  assert.equal(getAdapter('api').id,'api')
  assert.deepEqual((await evaluateRunnableEngines(['api'],{},'win32')).runnable,['api'])
})
test('literal tools read and reply through runtime, preserve tool results, account each hop',async()=>{
  const home=await mkdtemp(join(tmpdir(),'direct-api-'));let hop=0;const commands:string[][]=[],reports:any[]=[]
  const adapter=new DirectApiAdapter(async(_c,raw)=>{
    const body=raw as any;hop++
    assert.equal(body.model,'fixture');assert.equal(JSON.stringify(body).includes('fixture-secret'),false)
    if(hop===2)assert.equal(body.messages.at(-1).content[0].content,'history')
    return {content:hop===1?[tool('read',['messages','room','--tail','20'])]:hop===2?[tool('reply',['reply','room','确实 这个更方便'])]:[],usage:{input_tokens:10,output_tokens:2}}
  },()=>connection)
  try{
    const result=await adapter.run({home,prompt:'Reply to room',env:{},signal:new AbortController().signal,onLog:()=>{},onHopUsage:r=>reports.push(r),runTool:async argv=>{commands.push(argv);return {exitCode:0,text:argv[0]==='messages'?'history':'sent'}}})
    assert.equal(result.exitCode,0);assert.deepEqual(result.usage,{input_tokens:30,output_tokens:6,cache_read_input_tokens:0,cache_creation_input_tokens:0})
    assert.equal(reports.length,3);assert.deepEqual(commands.map(c=>c[0]),['messages','reply'])
  }finally{await rm(home,{recursive:true,force:true})}
})
test('tool arguments cannot execute shell, read files or impersonate another agent',()=>{
  for(const argv of [['bash','ls'],['reply','room','text','--as=other'],['reply','room','--file','/tmp/key'],['memory','delete','all']])assert.throws(()=>directApiArgv(argv))
  assert.deepEqual(directApiArgv(['reply','room','$(cat key); hello']),['reply','room','$(cat key); hello'])
})
test('cancellation stops later tools; upstream failure never posts or exposes key',async()=>{
  const home=await mkdtemp(join(tmpdir(),'direct-api-')),abort=new AbortController();let posts=0
  try{
    const adapter=new DirectApiAdapter(async()=>({content:[tool('a',['reply','room','one']),tool('b',['reply','room','two'])]}),()=>connection)
    const result=await adapter.run({home,env:{},prompt:'test',signal:abort.signal,onLog:()=>{},runTool:async()=>{posts++;abort.abort();return {exitCode:0,text:'sent'}}})
    assert.equal(posts,1);assert.equal(result.exitCode,1)
    const failed=new DirectApiAdapter(async()=>{throw new ConnectionError('HTTP 403 fixture-secret',502)},()=>connection)
    const error=await failed.run({home,env:{},prompt:'test',signal:new AbortController().signal,onLog:()=>{},runTool:async()=>{posts++;return {exitCode:0}}})
    assert.equal(posts,1);assert.equal(error.failure?.kind,'authentication');assert.ok(!JSON.stringify(error).includes('fixture-secret'))
  }finally{await rm(home,{recursive:true,force:true})}
})
test('OpenAI tool continuation retains provider reasoning privately and cached usage',()=>{
  const response=fromOpenAI({choices:[{message:{reasoning_content:'private thought',tool_calls:[{id:'t',function:{name:'mcp__cumora__cli',arguments:'{"argv":["messages","room"]}'}}]}}],usage:{prompt_tokens:10,completion_tokens:3,prompt_cache_hit_tokens:4}},'fixture')
  const next=toOpenAI({model:'fixture',messages:[response,{role:'user',content:[{type:'tool_result',tool_use_id:'t',content:'history'}]}]})
  assert.equal(next.messages[0].reasoning_content,'private thought');assert.equal(next.messages[1].role,'tool');assert.equal(response.usage.input_tokens,6)
  assert.ok(!response.content.some((b:any)=>b.type==='text'))
})
test('repeated successful replies within a turn are returned from cache without reposting',async()=>{
  const home=await mkdtemp(join(tmpdir(),'direct-api-'));let hop=0,posts=0
  try{
    const adapter=new DirectApiAdapter(async()=>({content:++hop<=2?[tool('call-'+hop,['reply','fixture','OK'])]:[]}),()=>connection)
    const result=await adapter.run({home,env:{},prompt:'Check',signal:new AbortController().signal,onLog:()=>{},runTool:async()=>{posts++;return {exitCode:0,text:'Sent'}}})
    assert.equal(result.exitCode,0);assert.equal(posts,1);assert.equal(hop,3)
  }finally{await rm(home,{recursive:true,force:true})}
})
