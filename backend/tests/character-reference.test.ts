import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { characterReferences, withCharacterReference } from '../src/services/character-image-reference.ts'

test('reference instructions preserve original prompt and do not accumulate', () => {
  const original = '水彩风格，年轻医生，白大褂，三视图'
  assert.equal(withCharacterReference(original, []), original)
  const refs = characterReferences('["static/uploads/portrait.png"]')
  const result = withCharacterReference(original, refs)
  assert.ok(result.startsWith(original + '\n\n'))
  assert.match(result, /五官比例/)
  assert.equal(withCharacterReference(original, refs), result)
  assert.deepEqual(characterReferences('invalid'), [])
})

test('reference binding persists independently from artwork and prompt, and can be removed', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'huobao-reference-'))
  process.env.SQLITE_PATH = path.join(root, 'test.sqlite3')
  process.env.MYSQL_AUTO_IMPORT = 'false'
  const { db, schema } = await import('../src/db/index.ts')
  const app = new Hono().route('/characters', (await import('../src/routes/characters.ts')).default)
  const char = db.insert(schema.characters).values({ dramaId: 1, name: '测试角色', imageUrl: 'existing.png', finalPrompt: '原始设定', createdAt: 'now', updatedAt: 'now' }).returning().get()
  const update = (refs: unknown) => app.request(`/characters/${char.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reference_images: refs }) })
  assert.equal((await update(['static/uploads/photo.png'])).status, 200)
  const saved = db.select().from(schema.characters).where(eq(schema.characters.id, char.id)).get()!
  assert.deepEqual(characterReferences(saved.referenceImages), ['static/uploads/photo.png'])
  assert.equal(saved.imageUrl, 'existing.png')
  assert.equal(saved.finalPrompt, '原始设定')
  const videoUpdate = (url: unknown) => app.request(`/characters/${char.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({video_reference_image_url:url}) })
  assert.equal((await videoUpdate('static/uploads/single.png')).status, 200)
  const withVideo = db.select().from(schema.characters).where(eq(schema.characters.id, char.id)).get()!
  assert.equal(withVideo.videoReferenceImageUrl, 'static/uploads/single.png')
  assert.equal(withVideo.imageUrl, 'existing.png')
  assert.equal(withVideo.referenceImages, saved.referenceImages)
  const lockUpdate = (value: unknown) => app.request(`/characters/${char.id}`, { method: 'PUT', headers: { 'Content-Type':'application/json' }, body:JSON.stringify({video_appearance_lock:value}) })
  assert.equal((await lockUpdate('cream dress, brown ponytail')).status, 200)
  assert.equal(db.select().from(schema.characters).where(eq(schema.characters.id,char.id)).get()!.videoAppearanceLock, 'cream dress, brown ponytail')
  assert.equal((await lockUpdate('x'.repeat(501))).status, 400)
  assert.equal((await videoUpdate('../../private.png')).status, 400)
  assert.equal((await videoUpdate(null)).status, 200)
  assert.equal(db.select().from(schema.characters).where(eq(schema.characters.id,char.id)).get()!.videoAppearanceLock, null)
  assert.equal((await update(['../../private.png'])).status, 400)
  assert.equal((await update([])).status, 200)
  assert.equal(db.select().from(schema.characters).where(eq(schema.characters.id, char.id)).get()!.referenceImages, null)
})
