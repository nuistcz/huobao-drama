import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { h3SourcePrompt, isLocalH3, normalizeH3ShotMarkers, validateH3Prompt, type H3PromptInput } from '../src/services/h3-prompt-format.ts'
import { MiniMaxVideoAdapter } from '../src/services/adapters/minimax-video.ts'

const input:H3PromptInput = {source:'0-3秒：@图片1甲 说：「请坐。」',references:[{index:1,kind:'character',name:'甲'}],duration:6}
const native = `subject_definitions:
<Subject 1> is the person in <Picture 1>.
summary:
[reference generation] One person speaks.
retention_analysis:
<Subject 1> (appears in [Shot 1]): fully_preserved - The image defines the face and clothes.
detailed_description:
A softly lit scene.
[Shot 1] <Subject 1> (S1) says <d>[Chinese] 请坐。</d>.
overall_soundscape:
Quiet room tone.
non_diegetic_music:
N/A`

test('native reference format preserves dialogue and rejects unbound references',()=>{
  assert.deepEqual(validateH3Prompt(native,input),[])
  assert.ok(validateH3Prompt(native.replace('请坐。','您好。'),input).some(e=>e.includes('changed')))
  assert.ok(validateH3Prompt(native.replace('<Picture 1>','<Picture 2>'),input).some(e=>e.includes('Unbound')))
  assert.ok(validateH3Prompt(native.replace('overall_soundscape:','sound:'),input).length)
  assert.ok(validateH3Prompt(native.replace('(S1)',''),input).some(e=>e.includes('speaker ID')))
  assert.ok(validateH3Prompt(native.replace('[Chinese]',''),input).some(e=>e.includes('language tag')))
  assert.ok(validateH3Prompt(native,{...input,source:'她说：“你好。”'}).some(e=>e.includes('changed')))
})
test('cut markers must be sequential with real cut times inside the clip',()=>{
  const two = native.replace('overall_soundscape:', '[Shot 2] At 00:03.000, the camera cuts closer to <Subject 1>.\noverall_soundscape:')
  assert.deepEqual(validateH3Prompt(two,input),[])
  assert.ok(validateH3Prompt(two.replace('00:03.000','00:06.000'),input).length)
  assert.ok(validateH3Prompt(two.replace('[Shot 2]','[Shot 3]'),input).length)
})
test('legacy UI wrappers are stripped without dropping the shot plan or style',()=>{
  const old='Watercolor.\nsubject_definitions:\nGeneric glasses and panels.\nsummary:\nCast list.\nretention_analysis:\nUnrelated instructions.\ndetailed_description:\n'+input.source
  assert.equal(h3SourcePrompt(old),'Watercolor.\n'+input.source)
  assert.equal(h3SourcePrompt(native),native)
})
test('an explicitly timed inline cut becomes a numbered shot without changing its dialogue or time',()=>{
  const draft = native.replace('overall_soundscape:', 'At 00:02.000, the camera cuts to <Subject 1> sitting down.\n[Shot 2] At 00:04.000, the camera cuts to <Subject 1> standing.\noverall_soundscape:')
  assert.ok(validateH3Prompt(draft,input).length)
  const corrected=normalizeH3ShotMarkers(draft,input)
  assert.match(corrected,/\[Shot 2\] At 00:02.000/)
  assert.match(corrected,/\[Shot 3\] At 00:04.000/)
  assert.ok(corrected.includes('<d>[Chinese] 请坐。</d>'))
  assert.deepEqual(validateH3Prompt(corrected,input),[])
})
test('local H3 accepts deterministic seeds without changing hosted provider requests',()=>{
  assert.equal(isLocalH3('http://localhost:8189','MiniMax-H3'),true)
  assert.equal(isLocalH3('https://api.example.com','MiniMax-H3'),false)
  const adapter=new MiniMaxVideoAdapter()
  const record={id:1,prompt:'A wave',model:'MiniMax-H3',seed:0}
  const config={provider:'minimax',model:'MiniMax-H3',apiKey:'test',baseUrl:'http://127.0.0.1:8189'}
  assert.equal((adapter.buildGenerateRequest(config,record).body as any).seed,0)
  assert.equal((adapter.buildGenerateRequest({...config,baseUrl:'https://api.example.com'},record).body as any).seed,undefined)
})
test('compiler repairs a malformed draft, fails closed, and reuses native input',async()=>{
  process.env.SQLITE_PATH=path.join(mkdtempSync(path.join(tmpdir(),'huobao-h3-prompt-')),'test.sqlite3')
  process.env.MYSQL_AUTO_IMPORT='false'
  const {compileH3ReferencePrompt}=await import('../src/services/h3-prompt.ts')
  let calls=0
  const result=await compileH3ReferencePrompt(input,async(_,feedback)=>{
    calls++
    if(calls===1)return native.replace('请坐。','Wrong dialogue')
    assert.match(feedback!,/changed/)
    return native
  })
  assert.equal(result,native)
  assert.equal(calls,2)
  await assert.rejects(compileH3ReferencePrompt(input,async()=> 'bad'),/未提交视频/)
  assert.equal(await compileH3ReferencePrompt({...input,source:native},async()=>{throw new Error('unneeded rewrite')}),native)
})
