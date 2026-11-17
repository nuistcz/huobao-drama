import test from 'node:test';
import assert from 'node:assert/strict';
import { buildImageGraph, pollImageTask } from './image.mjs';

test('Qwen Turbo uses the checkpoint sigma schedule and shared quantized encoder', () => {
  const g=buildImageGraph({model:'qwen-image-2.1-turbo',prompt:'garden',size:'1920x1080'});
  assert.equal(g['6'].inputs.height,1088);
  assert.equal(g['11'].inputs.height,1080);
  assert.equal(g['15'].inputs.sigmas.split(',').length,9);
  assert.equal(g['8'].class_type,'SamplerCustomAdvanced');
  assert.equal(g['2'].inputs.clip_name,'qwen3vl_8b_int8_convrot.safetensors');
});
test('Noct uses 25 steps CFG 3 and edits use reference-matched latent', () => {
  const g=buildImageGraph({model:'noct-q-v4',prompt:'garden',size:'1024x1024'},[{file:'one.png'},{file:'two.png'}]);
  assert.equal(g['8'].inputs.steps,25);
  assert.equal(g['8'].inputs.cfg,3);
  assert.deepEqual(g['8'].inputs.latent_image,['4',2]);
  assert.deepEqual(g['4'].inputs['images.image_2'],['43',0]);
  assert.equal(g['6'],undefined);
  assert.throws(()=>buildImageGraph({model:'z-image-turbo',prompt:'garden'},[{file:'one.png'}]),/仅支持文生图/);
});

test('image graph uses installed model bundle and requested aspect', () => {
  const g = buildImageGraph({ model: 'z-image-turbo', prompt: 'A garden', size: '1536x1024' });
  assert.equal(g['6'].inputs.width,1536);
  assert.equal(g['6'].inputs.height,1024);
  assert.equal(g['2'].inputs.type,'lumina2');
  assert.equal(g['8'].inputs.steps,8);
});
test('reject malformed or excessive sizes and empty prompts', () => {
  for (const size of ['bad','128x128','2048x2048','4096x4096']) assert.throws(() => buildImageGraph({ model:'z-image-turbo',prompt:'garden',size }));
  assert.throws(() => buildImageGraph({ model:'z-image-turbo',prompt:'' }));
});
test('Huobao full HD requests generate aligned latents and crop to exact requested size', () => {
  for (const [width,height] of [[1920,1080],[1080,1920],[1025,1024]]) {
    const g=buildImageGraph({model:'z-image-turbo',prompt:'garden',size:`${width}x${height}`});
    assert.equal(g['6'].inputs.width % 16,0);
    assert.equal(g['6'].inputs.height % 16,0);
    assert.equal(g['11'].inputs.width,width);
    assert.equal(g['11'].inputs.height,height);
    assert.deepEqual(g['10'].inputs.images,['11',0]);
  }
});
test('image polling returns a downloadable URL or ComfyUI error', async () => {
  const success = await pollImageTask('a',async () => ({a:{ outputs:{'10':{images:[{filename:'sample.png',subfolder:'huobao',type:'output'}]}} }}),'http://127.0.0.1:8188');
  assert.equal(success.status,'completed');
  assert.match(success.image_url,/filename=sample.png/);
  const publicResult = await pollImageTask('a',async () => ({a:{outputs:{'10':{images:[{filename:'sample.png',type:'output'}]}}}}),'http://127.0.0.1:8188','http://127.0.0.1:8189');
  assert.equal(publicResult.image_url,'http://127.0.0.1:8189/images/a.png');
  const failure = await pollImageTask('b',async () => ({b:{status:{status_str:'error',messages:[['execution_error',{exception_message:'out of memory'}]]}}}),'');
  assert.equal(failure.error.message,'out of memory');
});
