/** Runtime diagnostics belong in the log view, not chat timelines. */
export function isRuntimeNotice(message:{kind:string;body:string}):boolean {
  if(message.kind!=='system')return false
  try {const value=JSON.parse(message.body);return value?.kind==='notice'&&typeof value.text==='string'}catch{return false}
}
export interface RuntimeNotice {
  id:string;agentId:string;agentName:string;conversationName:string;kind:string;text:string;at:string
}
export interface RuntimeNoticePage {rows:RuntimeNotice[];next:{at:string;id:string}|null}
