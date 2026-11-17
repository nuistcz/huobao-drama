import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGraph } from './bridge.mjs';

const body = { model: 'MiniMax-H3', duration: 5, resolution: '768P', content: [{ type: 'text', text: 'A quiet garden.' }] };
test('all H3 modes sample through the selected attention backend after Turbo LoRA', () => {
  for (const refs of [[], [{type:'image_url',role:'reference_image',file:'a.png'}]]) {
    const g = buildGraph(body, refs);
    assert.equal(g['29'].inputs.attention, process.env.H3_ATTENTION_BACKEND || 'comfy kitchen attention');
    assert.deepEqual(g['29'].inputs.model, ['28',0]);
    assert.deepEqual(g['6'].inputs.model, ['29',0]);
    assert.deepEqual(g['9'].inputs.model, ['29',0]);
    assert.equal(g['6'].inputs.steps, 6);
  }
});
test('text to video uses FL2VA and native frame grid', () => {
  const g = buildGraph({ ...body, ratio: '9:16' });
  assert.match(g['1'].inputs.unet_name, /fl2va/);
  assert.equal(g['5'].inputs.length,124);
  assert.equal(g['5'].inputs.width,768);
  assert.equal(g['5'].inputs.height,1344);
});
test('H3 text encoder can use the locally installed compatible variant', () => {
  const original = process.env.H3_TEXT_ENCODER;
  try {
    process.env.H3_TEXT_ENCODER = 'compatible-h3-encoder.safetensors';
    assert.equal(buildGraph(body)['2'].inputs.clip_name, 'compatible-h3-encoder.safetensors');
  } finally {
    if (original === undefined) delete process.env.H3_TEXT_ENCODER;
    else process.env.H3_TEXT_ENCODER = original;
  }
});
test('legacy Huobao image markers become native H3 references without losing dialogue', () => {
  const g = buildGraph({ ...body, content: [{type:'text',text:'@图片2爸爸 说：「别担心。」 <Picture 1> 是走廊。'}] });
  assert.equal(g['5'].inputs.prompt, '<Picture 2> 爸爸 说：「别担心。」 <Picture 1> 是走廊。');
});
test('first and last frames preserve endpoint roles and image aspect', () => {
  const g = buildGraph(body,[{ type: 'image_url', role: 'first_frame', file: 'a.png', size: [768,1344] },{ type: 'image_url', role: 'last_frame', file: 'b.png' }]);
  assert.deepEqual(g['5'].inputs.first_frame,['40',0]);
  assert.deepEqual(g['5'].inputs.last_frame,['42',0]);
  assert.equal(g['5'].inputs.height,1344);
});
test('reference images videos and audio use REF2VA sockets', () => {
  const g = buildGraph(body,[{ type: 'image_url', role: 'reference_image', file: 'a.png' },{ type: 'video_url', role: 'reference_video', file: 'a.mp4' },{ type: 'audio_url', role: 'reference_audio', file: 'a.wav' }]);
  assert.match(g['1'].inputs.unet_name,/ref2va/);
  assert.deepEqual(g['5'].inputs['ref_images.ref_image_0'],['40',0]);
  assert.deepEqual(g['5'].inputs['ref_videos.ref_video_0'],['43',0]);
  assert.deepEqual(g['5'].inputs['ref_audios.ref_audio_0'],['44',0]);
});
test('reject unsupported mixed modes and resolution instead of silently dropping inputs', () => {
  assert.throws(() => buildGraph({ ...body, resolution: '2K' }),/768P/);
  assert.throws(() => buildGraph(body,[{ type: 'image_url', role: 'first_frame' },{ type: 'image_url', role: 'reference_image' }]),/不能混用/);
});
