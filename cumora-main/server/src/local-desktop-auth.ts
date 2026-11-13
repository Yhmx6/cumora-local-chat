import { createHash, timingSafeEqual } from 'node:crypto'
import type { Request, Response } from 'express'
import { pool } from './db/pool.js'
import { createSession } from './auth.js'

/** Opt-in bootstrap for a single Windows account. Never enables anonymous API access. */
export function localDesktopKeyValid(key:unknown, hash:unknown): boolean {
  if(typeof key !== 'string' || !/^[A-Za-z0-9_-]{43,128}$/.test(key) || typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash)) return false
  return timingSafeEqual(createHash('sha256').update(key).digest(),Buffer.from(hash,'hex'))
}
export async function localDesktopSession(req:Request,res:Response) {
  res.setHeader('Cache-Control','no-store')
  const user = process.env.LOCAL_DESKTOP_USER_ID
  const company = process.env.LOCAL_DESKTOP_COMPANY_ID
  if(!user || !company || !process.env.LOCAL_DESKTOP_KEY_HASH) {res.status(404).json({error:'本机自动进入未配置'});return}
  // Electron main's fetch has no Origin. Browser scripts, even on localhost,
  // cannot use this endpoint; the bootstrap key stays outside the renderer.
  if(req.headers.origin || !['localhost:5181','127.0.0.1:5181'].includes(req.headers.host ?? '') ||
    !localDesktopKeyValid(req.headers['x-cumora-desktop-key'],process.env.LOCAL_DESKTOP_KEY_HASH)) {
    res.status(403).json({error:'本机身份校验失败'});return
  }
  const r = await pool.query(`SELECT u.id FROM users u JOIN company_members cm ON cm.user_id=u.id
    WHERE u.id=$1 AND cm.company_id=$2 AND cm.role='owner' AND u.deleted_at IS NULL AND u.suspended_at IS NULL`,[user,company])
  if(!r.rowCount) {res.status(403).json({error:'原本机账号已不可用'});return}
  const session = await createSession(user,{ip:req.ip,ua:'Cumora local desktop'})
  res.json({token:session.token,companyId:company})
}
