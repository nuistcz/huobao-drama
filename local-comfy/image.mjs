import { randomInt } from 'node:crypto';

const node = (class_type, inputs) => ({ class_type, inputs });
export const imageModels = ['z-image-turbo', 'qwen-image-2.1-turbo', 'noct-q-v4'];

export function buildImageGraph(body, references = []) {
  if (!imageModels.includes(body.model)) throw new Error(`图片模型请选择 ${imageModels.join(' / ')}`);
  if (references.length && body.model === 'z-image-turbo') throw new Error('Z-Image Turbo 仅支持文生图；参考图编辑请选择 Qwen Image 2.1 Turbo 或 Noct Q V4');
  if (references.length > 16) throw new Error('最多支持 16 张参考图');
  if (!String(body.prompt || '').trim()) throw new Error('请填写图片提示词');
  if (body.n != null && Number(body.n) !== 1) throw new Error('每个任务仅生成一张图片');
  const size = !body.size || body.size === 'auto' ? '1024x1024' : body.size;
  const match = /^(\d+)x(\d+)$/.exec(size);
  if (!match) throw new Error('图片尺寸格式应为 1024x1024');
  const [width, height] = match.slice(1).map(Number);
  const alignment = body.model === 'z-image-turbo' ? 16 : 32;
  const latentWidth = Math.ceil(width / alignment) * alignment;
  const latentHeight = Math.ceil(height / alignment) * alignment;
  if ([width,height].some(x => x < 256 || x > 2048) || latentWidth * latentHeight > 2097152) {
    throw new Error(`图片边长须为 256–2048，按 ${alignment} 对齐后的总像素不超过 2097152`);
  }
  if (body.model !== 'z-image-turbo') return buildQwenGraph(body,references,{width,height,latentWidth,latentHeight});
  return {
    '1': node('UNETLoader', { unet_name: 'z_image_turbo_bf16.safetensors', weight_dtype: 'default' }),
    '2': node('CLIPLoader', { clip_name: 'qwen_3_4b.safetensors', type: 'lumina2', device: 'default' }),
    '3': node('VAELoader', { vae_name: 'ae.safetensors' }),
    '4': node('CLIPTextEncode', { clip: ['2',0], text: body.prompt }),
    '5': node('ConditioningZeroOut', { conditioning: ['4',0] }),
    '6': node('EmptySD3LatentImage', { width: latentWidth, height: latentHeight, batch_size: 1 }),
    '7': node('ModelSamplingAuraFlow', { model: ['1',0], shift: 3 }),
    '8': node('KSampler', { model: ['7',0], positive: ['4',0], negative: ['5',0], latent_image: ['6',0], seed: randomInt(2 ** 48 - 1), steps: 8, cfg: 1, sampler_name: 'res_multistep', scheduler: 'simple', denoise: 1 }),
    '9': node('VAEDecode', { samples: ['8',0], vae: ['3',0] }),
    '11': node('ImageCrop', { image: ['9',0], width, height, x: Math.floor((latentWidth-width)/2), y: Math.floor((latentHeight-height)/2) }),
    '10': node('SaveImage', { images: ['11',0], filename_prefix: 'huobao/z-image' }),
  };
}

function buildQwenGraph(body,references,{width,height,latentWidth,latentHeight}) {
  const turbo = body.model === 'qwen-image-2.1-turbo';
  const g = {
    '1': node('UNETLoader',{unet_name: turbo ? 'qwen_image_2.1_turbo_bf16.safetensors' : 'NoctQ_V4_int8_convrot.safetensors',weight_dtype:'default'}),
    '2': node('CLIPLoader',{clip_name:'qwen3vl_8b_int8_convrot.safetensors',type:'qwen_image',device:'default'}),
    '3': node('VAELoader',{vae_name:'qwen_image_2.1_vae_bf16.safetensors'}),
    '4': node('TextEncodeQwenImage21',{clip:['2',0],prompt:body.prompt,negative_prompt:turbo ? '' : 'artifacts, washed-out colors, low quality, low resolution, blurry, missing fingers, badly drawn hands',resolution:0}),
    '6': node('EmptyLatentImage',{width:latentWidth,height:latentHeight,batch_size:1}),
    '9': node('VAEDecode',{samples:['8',0],vae:['3',0]}),
    '11': node('ImageCrop',{image:['9',0],width,height,x:Math.floor((latentWidth-width)/2),y:Math.floor((latentHeight-height)/2)}),
    '10': node('SaveImage',{images:['11',0],filename_prefix:`huobao/${body.model}`}),
  };
  let latent = ['6',0];
  if (references.length) {
    g['4'].inputs.vae=['3',0];
    references.forEach((ref,i) => {
      const id=String(40+i*2);
      g[id]=node('LoadImage',{image:ref.file});
      const scaled=String(41+i*2);
      // Match the first reference and output latent as required by Qwen 2.1 editing.
      if (i===0) {
        g[scaled]=node('ImageScale',{image:[id,0],upscale_method:'lanczos',width:latentWidth,height:latentHeight,crop:'center'});
      } else {
        g[scaled]=node('ImageScaleToTotalPixels',{image:[id,0],upscale_method:'lanczos',megapixels:1,resolution_steps:32});
      }
      g['4'].inputs[`images.image_${i+1}`]=[scaled,0];
    });
    latent=['4',2];
    delete g['6'];
  }
  const seed=randomInt(2 ** 48 - 1);
  if (turbo) {
    g['12']=node('RandomNoise',{noise_seed:seed});
    g['13']=node('BasicGuider',{model:['1',0],conditioning:['4',0]});
    g['14']=node('KSamplerSelect',{sampler_name:'euler'});
    g['15']=node('ManualSigmas',{sigmas:'1.0, 0.978453, 0.95418, 0.926626, 0.89508, 0.845148, 0.704534, 0.414568, 0'});
    g['8']=node('SamplerCustomAdvanced',{noise:['12',0],guider:['13',0],sampler:['14',0],sigmas:['15',0],latent_image:latent});
  } else {
    g['8']=node('KSampler',{model:['1',0],positive:['4',0],negative:['4',1],latent_image:latent,seed,steps:25,cfg:3,sampler_name:'euler',scheduler:'simple',denoise:1});
  }
  return g;
}

export async function pollImageTask(id, api, comfy, publicBase) {
  const history = await api(`/history/${encodeURIComponent(id)}`);
  const entry = history[id];
  if (entry) {
    if (entry.status?.status_str === 'error') {
      const failure = entry.status.messages?.find(x => x[0] === 'execution_error');
      return { status: 'failed', error: { message: failure?.[1]?.exception_message || 'ComfyUI 图片生成失败或中断' } };
    }
    const image = entry.outputs?.['10']?.images?.find(x => /\.(png|jpe?g|webp)$/i.test(x.filename));
    if (image) return { status: 'completed', image_url: publicBase ? `${publicBase}/images/${encodeURIComponent(id)}.png` : `${comfy}/view?${new URLSearchParams(image)}` };
    if (entry.status?.completed) return { status: 'failed', error: { message: 'ComfyUI 未返回图片' } };
  }
  const queue = await api('/queue');
  if ([...queue.queue_running,...queue.queue_pending].some(x => x[1] === id)) return { status: 'processing' };
  return { status: 'failed', error: { message: 'ComfyUI 任务不存在或历史已清除' } };
}
