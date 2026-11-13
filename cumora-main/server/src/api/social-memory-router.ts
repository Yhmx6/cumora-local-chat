import { Router, type Request } from 'express'
import { addSocialMemory, changeSocialMemory, listSocialMemories, memoryContent, setSocialMemoryEnabled, SocialMemoryError } from '../agents/social-memory.js'

export function createSocialMemoryRouter(authorize: (req: Request) => Promise<{ userId:string;companyId:string }>) {
  const router = Router({ mergeParams:true })
  router.use(async (req,res,next) => {
    try { res.locals.memoryAuth = await authorize(req); next() } catch (e) { next(e) }
  })
  router.get('/', async (req,res) => {
    const { companyId,userId } = res.locals.memoryAuth
    res.json(await listSocialMemories(companyId,String((req as Request).params.agentId),userId))
  })
  router.post('/', async (req,res) => {
    const { companyId,userId } = res.locals.memoryAuth
    const content = memoryContent(req.body)
    const conversation = req.body?.conversationId
    if (conversation !== null && (typeof conversation !== 'string' || !conversation || conversation.length > 150)) throw new SocialMemoryError(400,'请选择会话或所有会话')
    res.json(await addSocialMemory({ company:companyId,agentId:String((req as Request).params.agentId),userId,...content,conversationId:conversation }))
  })
  router.put('/settings', async (req,res) => {
    await setSocialMemoryEnabled(res.locals.memoryAuth.companyId,String((req as Request).params.agentId),req.body?.enabled)
    res.json({ok:true})
  })
  router.put('/:memoryId', async (req,res) => {
    const { companyId,userId } = res.locals.memoryAuth
    await changeSocialMemory(companyId,String((req as Request).params.agentId),userId,String(req.params.memoryId),req.body?.revision,req.body)
    res.json({ok:true})
  })
  router.delete('/:memoryId', async (req,res) => {
    const { companyId,userId } = res.locals.memoryAuth
    await changeSocialMemory(companyId,String((req as Request).params.agentId),userId,String(req.params.memoryId),req.body?.revision,null)
    res.json({ok:true})
  })
  router.use((error: unknown,_req:Request,res:import('express').Response,next:import('express').NextFunction) => {
    if (error instanceof SocialMemoryError) res.status(error.status).json({error:error.message})
    else next(error)
  })
  return router
}
