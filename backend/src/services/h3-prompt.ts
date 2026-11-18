import { createHash } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { getTextConfig, getTextProviderBaseUrl } from './ai.js'
import { H3_REWRITE_INSTRUCTIONS, h3SourcePrompt, normalizeH3ShotMarkers, validateH3Prompt, type H3PromptInput, type H3Reference } from './h3-prompt-format.js'

export async function h3ReferenceMetadata(urls: string[], storyboardId?: number): Promise<H3Reference[]> {
  if (!storyboardId) return urls.map((_, i) => ({ index:i+1, kind:'reference', name:`Reference ${i+1}` }))
  const [sb] = await db.select().from(schema.storyboards).where(eq(schema.storyboards.id, storyboardId))
  if (!sb) throw new Error('H3 分镜不存在')
  const characters = await db.select({ character:schema.characters }).from(schema.storyboardCharacters)
    .innerJoin(schema.characters, eq(schema.characters.id, schema.storyboardCharacters.characterId))
    .where(eq(schema.storyboardCharacters.storyboardId, storyboardId))
  const props = await db.select({ prop:schema.props }).from(schema.storyboardProps)
    .innerJoin(schema.props, eq(schema.props.id, schema.storyboardProps.propId))
    .where(eq(schema.storyboardProps.storyboardId, storyboardId))
  const scenes = sb.sceneId ? await db.select().from(schema.scenes).where(eq(schema.scenes.id,sb.sceneId)) : []
  return urls.map((url, i) => {
    const index = i+1
    const character = characters.map(r=>r.character).find(c=>[c.videoReferenceImageUrl,c.imageUrl].includes(url))
    if (character) return {index,kind:'character',name:character.name,appearance:character.videoAppearanceLock || [character.appearance,character.styling].filter(Boolean).join('; ')}
    const scene = scenes.find(s=>s.imageUrl===url)
    if (scene) return {index,kind:'scene',name:scene.location || 'Environment'}
    const prop = props.map(r=>r.prop).find(p=>p.imageUrl===url)
    if (prop) return {index,kind:'prop',name:prop.name,appearance:prop.description || ''}
    return {index,kind:'reference',name:`Reference ${index}`}
  })
}

type Rewrite = (input:H3PromptInput, feedback?:string) => Promise<string>
export async function requestH3Rewrite(input:H3PromptInput, feedback?:string):Promise<string> {
  const config = await getTextConfig()
  if (!['openai','volcengine'].includes(config.provider)) throw new Error('本地 H3 提示词转换需要 OpenAI 兼容的文本配置（例如 DeepSeek）')
  const url = getTextProviderBaseUrl(config).replace(/\/$/,'') + '/chat/completions'
  const response = await fetch(url, {
    method:'POST', headers:{'Content-Type':'application/json',Authorization:`Bearer ${config.apiKey}`},
    body:JSON.stringify({model:config.model,temperature:0.2,max_tokens:5000,
      ...(new URL(config.baseUrl).hostname === 'api.deepseek.com' ? {thinking:{type:'disabled'}} : {}),
      messages:[
      {role:'system',content:H3_REWRITE_INSTRUCTIONS},
      {role:'user',content:JSON.stringify({...input, source:h3SourcePrompt(input.source), ...(feedback?{corrections:feedback}:{})})},
    ]}), signal:AbortSignal.timeout(120000),
  })
  if (!response.ok) throw new Error(`H3 提示词转换失败（文本服务 HTTP ${response.status}），尚未提交视频`)
  const data:any = await response.json()
  const text = data.choices?.[0]?.message?.content
  if (typeof text !== 'string' || !text.trim()) throw new Error('H3 提示词转换返回空结果，尚未提交视频')
  return text.trim().replace(/^```(?:text)?\s*\n/,'').replace(/\n```$/,'').trim()
}

const cache = new Map<string, Promise<string>>()
export async function compileH3ReferencePrompt(input:H3PromptInput, requestRewrite:Rewrite = requestH3Rewrite):Promise<string> {
  const normalized = normalizeH3ShotMarkers(input.source.trim(),input)
  if (!validateH3Prompt(normalized,input).length) return normalized
  const key = createHash('sha256').update(JSON.stringify(input)).digest('hex')
  if (requestRewrite === requestH3Rewrite && cache.has(key)) return cache.get(key)!
  const run = async () => {
    let feedback:string|undefined
    let errorSummary = ''
    for(let attempt=0;attempt<2;attempt++) {
      const prompt = normalizeH3ShotMarkers(await requestRewrite(input,feedback),input)
      const errors = validateH3Prompt(prompt,input)
      if (!errors.length) return prompt
      errorSummary = errors.join('; ')
      feedback = errorSummary + '\nRepair this previous draft without changing its story:\n' + prompt
    }
    throw new Error(`H3 提示词校验失败，未提交视频：${errorSummary}`)
  }
  const pending = run()
  if(requestRewrite===requestH3Rewrite) {
    if(cache.size>=100) cache.delete(cache.keys().next().value!)
    cache.set(key,pending)
  }
  try { return await pending } catch(error) { if(requestRewrite===requestH3Rewrite)cache.delete(key);throw error }
}
