export type ApiProtocol = 'anthropic' | 'openai'
export interface RoleConnectionInput {
  label: string
  protocol: ApiProtocol
  baseUrl: string
  model: string
  fastModel: string
  authType: 'bearer' | 'api-key'
  apiKey?: string
}
export interface RoleConnectionView extends Omit<RoleConnectionInput, 'apiKey'> {
  hasKey: boolean
  revision: string
}
export interface RoleConnectionState {
  enabled: boolean
  computerId: string | null
  connection: RoleConnectionView | null
}
// Model IDs are intentionally not guessed: users supply the ID their account can run.
export const CONNECTION_PRESETS: Array<{id:string;label:string;protocol:ApiProtocol;baseUrl:string;authType:'bearer'|'api-key'}> = [
  {id:'openai',label:'OpenAI',protocol:'openai',baseUrl:'https://api.openai.com/v1',authType:'bearer'},
  {id:'deepseek',label:'DeepSeek',protocol:'anthropic',baseUrl:'https://api.deepseek.com/anthropic',authType:'bearer'},
  {id:'kimi',label:'Kimi 国内开放平台',protocol:'anthropic',baseUrl:'https://api.moonshot.cn/anthropic',authType:'bearer'},
  {id:'ark',label:'火山方舟',protocol:'anthropic',baseUrl:'https://ark.cn-beijing.volces.com/api/compatible',authType:'bearer'},
  {id:'claude',label:'Anthropic',protocol:'anthropic',baseUrl:'https://api.anthropic.com',authType:'api-key'},
  {id:'opencode',label:'OpenCode Zen',protocol:'anthropic',baseUrl:'https://opencode.ai/inference/anthropic',authType:'bearer'},
]
