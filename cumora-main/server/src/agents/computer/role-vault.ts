/** Local connection vault shared by the API service and its paired daemon.
 * Never mounted into agent workspaces; discovery exposes metadata only. */
import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto'
import { closeSync, constants, fstatSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { RoleConnectionInput } from '../../../../shared/role-connection.js'
import type { ProviderProfile } from './provider-profiles.js'

export interface VaultConnection {
  id: string; companyId: string; ownerKey: string; revision: string; bridgeToken: string
  createdAt?: number
  config: RoleConnectionInput & { apiKey: string }
}
function privateRead(file:string):Buffer {
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  try {
    const st = fstatSync(fd)
    if (!st.isFile() || st.size > 1024*1024 || (process.platform !== 'win32' && ((st.mode & 0o077) || st.uid !== process.getuid?.()))) throw new Error('Private connection file permissions invalid')
    return readFileSync(fd)
  } finally { closeSync(fd) }
}
export function readRoleVault(dir:string):VaultConnection[] {
  let blob:Buffer
  try { blob = privateRead(join(dir,'role-connections.enc')) }
  catch(e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return []; throw new Error('Cannot read local connections') }
  try {
    const key = privateRead(join(dir,'role-connections.key'))
    const data = JSON.parse(blob.toString())
    if (data.version !== 1) throw new Error()
    const decipher = createDecipheriv('aes-256-gcm',key,Buffer.from(data.iv,'base64'))
    decipher.setAAD(Buffer.from('cumora-role-connections-v1'))
    decipher.setAuthTag(Buffer.from(data.tag,'base64'))
    const plain = Buffer.concat([decipher.update(Buffer.from(data.data,'base64')),decipher.final()])
    const rows = JSON.parse(plain.toString())
    if (!Array.isArray(rows) || rows.length > 50) throw new Error()
    return rows
  } catch { throw new Error('Local connections could not be decrypted') }
}
export function writeRoleVault(dir:string,rows:VaultConnection[]):void {
  if (rows.length > 50) throw new Error('最多保存 50 个角色接口')
  mkdirSync(dir,{recursive:true,mode:0o700})
  const keyFile = join(dir,'role-connections.key')
  try { writeFileSync(keyFile,randomBytes(32),{flag:'wx',mode:0o600}) }
  catch(e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw new Error('Cannot create local connection key') }
  const key = privateRead(keyFile), iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm',key,iv)
  cipher.setAAD(Buffer.from('cumora-role-connections-v1'))
  const data = Buffer.concat([cipher.update(JSON.stringify(rows)),cipher.final()])
  const file = join(dir,'role-connections.enc'), tmp = `${file}.${randomUUID()}.tmp`
  try {
    writeFileSync(tmp,JSON.stringify({version:1,iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),data:data.toString('base64')}),{flag:'wx',mode:0o600})
    renameSync(tmp,file)
  } finally { try { unlinkSync(tmp) } catch { /* already renamed */ } }
}
export function roleRuntimeProfile(row:VaultConnection):ProviderProfile {
  const c = row.config
  return {
    id:row.id,label:c.label,model:c.model,fastModel:c.fastModel,
    baseUrl:c.protocol === 'anthropic' ? c.baseUrl : `http://127.0.0.1:${process.env.PORT || '5181'}/local-models/${row.id}`,
    auth:c.protocol === 'openai' ? {authToken:row.bridgeToken} : c.authType === 'api-key' ? {apiKey:c.apiKey} : {authToken:c.apiKey},
  }
}
