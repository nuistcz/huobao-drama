import http from 'node:http';
import { randomUUID, randomInt } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildImageGraph, pollImageTask, imageModels } from './image.mjs';

const comfy = process.env.COMFY_URL || 'http://127.0.0.1:8188';
const port = Number(process.env.H3_BRIDGE_PORT || 8189);
const h3Attention = process.env.H3_ATTENTION_BACKEND || 'comfy kitchen attention';
if (!['comfy kitchen attention', 'pytorch attention'].includes(h3Attention)) throw new Error('Invalid H3_ATTENTION_BACKEND');
const node = (class_type, inputs) => ({ class_type, inputs });

async function api(route, options = {}) {
  const response = await fetch(comfy + route, { ...options, signal: AbortSignal.timeout(120000) });
  const data = await response.json();
  if (!response.ok) throw new Error(JSON.stringify(data));
  return data;
}

export function buildGraph(body, media = []) {
  const prompt = (body.content || []).filter(x => x.type === 'text').map(x => x.text).join('\n').trim()
    .replace(/@图片(\d+)/g, '<Picture $1> ');
  if (!prompt) throw new Error('请提供视频提示词');
  if (!String(body.model || '').toLowerCase().startsWith('minimax-h3')) throw new Error('仅支持 MiniMax-H3 模型');
  if (body.resolution && body.resolution !== '768P') throw new Error('本地 H3 当前配置支持 768P，请选择 720p/768P');
  const refs = media.filter(x => !['first_frame', 'last_frame'].includes(x.role));
  const endpoints = media.filter(x => ['first_frame', 'last_frame'].includes(x.role));
  if (refs.length && endpoints.length) throw new Error('本地 H3 请分别使用首尾帧模式或参考素材模式，不能混用');
  if (media.filter(x => x.type === 'image_url').length > 9 || media.filter(x => x.type === 'video_url').length > 3 || media.filter(x => x.type === 'audio_url').length > 3) throw new Error('参考素材数量超限');
  const sizes = { '16:9': [1344,768], '9:16': [768,1344], '1:1': [960,960], '4:3': [1152,864], '3:4': [864,1152], '21:9': [1536,672] };
  const [width,height] = body.ratio ? (sizes[body.ratio] || sizes['16:9']) : (endpoints[0]?.size || sizes['16:9']);
  const duration = Number(body.duration || 5);
  if (body.seed != null && (!Number.isSafeInteger(body.seed) || body.seed < 0)) throw new Error('seed 须为非负安全整数');
  if (!Number.isFinite(duration) || duration < 4 || duration > 15) throw new Error('时长须在 4–15 秒之间');
  const length = Math.ceil((duration * 24 - 5) / 17) * 17 + 5;
  const graph = {
    '1': node('UNETLoader', { unet_name: `minimax_h3_${refs.length ? 'ref2va' : 'fl2va'}_pruned_int8_convrot.safetensors`, weight_dtype: 'default' }),
    '2': node('CLIPLoader', { clip_name: process.env.H3_TEXT_ENCODER || 'qwen3vl_32b_h3_ultra_uncensored_heretic_int8_convrot.safetensors', type: 'minimax', device: 'default' }),
    '3': node('VAELoader', { vae_name: 'minimax_h3_video_vae_fp16.safetensors' }),
    '4': node('VAELoader', { vae_name: 'minimax_h3_audio_vae_fp32.safetensors' }),
    '5': node(refs.length ? 'MiniMaxH3ReferenceToVideo' : 'MiniMaxH3ImageToVideo', { clip: ['2',0], vae: ['3',0], prompt, width, height, length }),
    '6': node('BasicScheduler', { model: ['29',0], scheduler: 'simple', steps: 6, denoise: 1 }),
    '7': node('MiniMaxH3TurboSampler', {}),
    '8': node('RandomNoise', { noise_seed: body.seed ?? randomInt(2 ** 48 - 1) }),
    '9': node('BasicGuider', { model: ['29',0], conditioning: ['5',0] }),
    '10': node('SamplerCustomAdvanced', { noise: ['8',0], guider: ['9',0], sampler: ['7',0], sigmas: ['6',0], latent_image: ['5',1] }),
    '11': node('VAEDecode', { samples: ['10',0], vae: ['3',0] }),
    '12': node('VAEDecodeAudio', { samples: ['10',0], vae: ['4',0] }),
    '13': node('CreateVideo', { images: ['11',0], audio: ['12',0], fps: 24, bit_depth: 8 }),
    '14': node('SaveVideo', { video: ['13',0], filename_prefix: 'huobao/h3', format: 'mp4', codec: 'auto' }),
    '28': node('MiniMaxH3TurboLoRA', { model: ['1',0], lora_name: 'minimax_h3_turbo_v4_step600_ema.safetensors', strength: 1, low_vram: false }),
    '29': node('ModelAttentionBackend', { model: ['28',0], attention: h3Attention }),
  };
  if (refs.length) Object.assign(graph['5'].inputs, { audio_vae: ['4',0], ref_image_size: 'match' });
  const counts = { image_url: 0, video_url: 0, audio_url: 0 };
  media.forEach((item, index) => {
    const id = String(40 + index * 2);
    const n = counts[item.type]++;
    if (item.type === 'image_url') {
      graph[id] = node('LoadImage', { image: item.file });
      graph['5'].inputs[endpoints.length ? item.role : `ref_images.ref_image_${n}`] = [id,0];
    } else if (item.type === 'video_url') {
      graph[id] = node('LoadVideo', { file: item.file });
      const parts = String(Number(id) + 1);
      graph[parts] = node('GetVideoComponents', { video: [id,0] });
      graph['5'].inputs[`ref_videos.ref_video_${n}`] = [parts,0];
    } else {
      graph[id] = node('LoadAudio', { audio: item.file });
      graph['5'].inputs[`ref_audios.ref_audio_${n}`] = [id,0];
    }
  });
  return graph;
}

async function prepareMedia(content) {
  const result = [];
  for (const item of content || []) {
    if (item.type === 'text') continue;
    if (!['image_url','video_url','audio_url'].includes(item.type)) throw new Error('不支持的参考素材类型');
    const url = item[item.type]?.url;
    if (typeof url !== 'string' || !/^(https?:|data:)/.test(url)) throw new Error('参考素材必须是 HTTP URL 或 data URL');
    const response = await fetch(url, { signal: AbortSignal.timeout(120000) });
    if (!response.ok) throw new Error(`读取参考素材失败: ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    let ext = item.type === 'image_url' ? '.png' : item.type === 'video_url' ? '.mp4' : '.wav';
    let size;
    if (item.type === 'image_url') {
      const { default: sharp } = await import('../backend/node_modules/sharp/lib/index.js');
      const info = await sharp(bytes).metadata();
      ext = ({ jpeg: '.jpg', png: '.png', webp: '.webp' })[info.format] || '.png';
      const scale = Math.min(1, Math.sqrt(1344 * 768 / (info.width * info.height)));
      size = [info.width, info.height].map(n => Math.max(32, Math.round(n * scale / 32) * 32));
    } else if (url.startsWith('http')) {
      const suffix = path.extname(new URL(url).pathname).toLowerCase();
      if (['.mp4','.webm','.mov','.wav','.mp3','.m4a','.flac','.ogg'].includes(suffix)) ext = suffix;
    }
    const form = new FormData();
    form.append('image', new Blob([bytes]), `${randomUUID()}${ext}`);
    form.append('subfolder','huobao');
    form.append('type','input');
    const uploaded = await api('/upload/image', { method: 'POST', body: form });
    const file = `${uploaded.subfolder}/${uploaded.name}`;
    result.push({ ...item, file, size });
  }
  return result;
}

export async function pollTask(id) {
  const history = await api(`/history/${encodeURIComponent(id)}`);
  const entry = history[id];
  if (entry) {
    if (entry.status?.status_str === 'error') {
      const failure = entry.status.messages?.find(x => x[0] === 'execution_error' || x[0] === 'execution_interrupted');
      return { task: { status: 'failed', error: failure?.[1]?.exception_message || 'ComfyUI 任务失败或被中断' } };
    }
    const outputs = Object.values(entry.outputs || {}).flatMap(x => [...(x.images || []), ...(x.gifs || [])]);
    const video = outputs.find(x => /\.(mp4|webm|mov)$/i.test(x.filename));
    if (video) return { task: { status: 'succeeded', duration: entry.prompt?.[2]?.['5']?.inputs?.length / 24, content: { url: `${comfy}/view?${new URLSearchParams(video)}` } } };
    if (entry.status?.completed) return { task: { status: 'failed', error: 'ComfyUI 未返回视频文件' } };
  }
  const queue = await api('/queue');
  if ([...queue.queue_running, ...queue.queue_pending].some(x => x[1] === id)) return { task: { status: 'processing' } };
  return { task: { status: 'failed', error: 'ComfyUI 任务不存在或历史记录已被清除' } };
}

function json(res, code, value) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(value));
}

export function createServer() {
  return http.createServer(async (req,res) => {
    try {
      const url = new URL(req.url, `http://127.0.0.1:${port}`);
      if (req.method === 'GET' && url.pathname === '/v1/models') {
        await api('/system_stats');
        return json(res,200,{ object: 'list', data: imageModels.map(id => ({id,object:'model',owned_by:'local-comfyui'})) });
      }
      if (req.method === 'POST' && url.pathname === '/v1/images/edits') {
        const chunks=[];
        let total=0;
        for await (const chunk of req) {
          total+=chunk.length;
          if (total>100*1024*1024) throw new Error('参考图请求超过 100 MB');
          chunks.push(chunk);
        }
        const request=new Request(`http://127.0.0.1:${port}/v1/images/edits`,{method:'POST',headers:{'Content-Type':req.headers['content-type']},body:Buffer.concat(chunks)});
        const form=await request.formData();
        const body={model:form.get('model'),prompt:form.get('prompt'),size:form.get('size'),n:form.get('n') || 1};
        buildImageGraph(body);
        if (body.model==='z-image-turbo') throw new Error('Z-Image Turbo 仅支持文生图；参考图编辑请选择 Qwen Image 2.1 Turbo 或 Noct Q V4');
        const files=[...form.getAll('image[]'),...form.getAll('image')];
        if (!files.length || files.length>16) throw new Error('请上传 1–16 张参考图片');
        const content=[];
        for (const file of files) {
          if (typeof file==='string' || !file.type.startsWith('image/')) throw new Error('参考素材必须是图片文件');
          content.push({type:'image_url',image_url:{url:`data:${file.type};base64,${Buffer.from(await file.arrayBuffer()).toString('base64')}`}});
        }
        const refs=await prepareMedia(content);
        const graph=buildImageGraph(body,refs);
        const submitted=await api('/prompt',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt:graph,client_id:'huobao-local-image'})});
        return json(res,200,{task_id:submitted.prompt_id});
      }
      if (req.method === 'POST' && url.pathname === '/v1/images/generations') {
        const chunks = [];
        let total = 0;
        for await (const chunk of req) {
          total += chunk.length;
          if (total > 1024 * 1024) throw new Error('图片请求体超过 1 MB');
          chunks.push(chunk);
        }
        const body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
        const graph = buildImageGraph(body);
        const submitted = await api('/prompt', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: graph, client_id: 'huobao-local-image' }) });
        return json(res,200,{ task_id: submitted.prompt_id });
      }
      if (req.method === 'GET' && url.pathname.startsWith('/v1/images/task/')) return json(res,200,await pollImageTask(url.pathname.split('/').pop(),api,comfy,`http://127.0.0.1:${port}`));
      const imageMatch = /^\/images\/([a-f0-9-]+)\.png$/.exec(url.pathname);
      if (req.method === 'GET' && imageMatch) {
        const result = await pollImageTask(imageMatch[1],api,comfy);
        if (result.status !== 'completed') return json(res,404,{ error: '图片尚未生成' });
        const response = await fetch(result.image_url, { signal: AbortSignal.timeout(120000) });
        if (!response.ok) throw new Error(`读取生成图片失败: ${response.status}`);
        res.writeHead(200,{ 'Content-Type': 'image/png' });
        return res.end(Buffer.from(await response.arrayBuffer()));
      }
      if (req.method === 'GET' && url.pathname === '/health') {
        await api('/system_stats');
        return json(res,200,{ status: 'ok', comfy, model: 'MiniMax-H3', resolution: '768P', steps: 6, attention: h3Attention });
      }
      if (req.method === 'POST' && url.pathname === '/v2/video_generation') {
        const chunks = [];
        let total = 0;
        for await (const chunk of req) {
          total += chunk.length;
          if (total > 100 * 1024 * 1024) throw new Error('请求体超过 100 MB');
          chunks.push(chunk);
        }
        const body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
        if (!Object.keys(body).length) { await api('/system_stats'); return json(res,200,{ status: 'ok', message: '本地 ComfyUI H3 已连接' }); }
        buildGraph(body);
        const media = await prepareMedia(body.content);
        const graph = buildGraph(body,media);
        const submitted = await api('/prompt', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: graph, client_id: 'huobao-local-h3' }) });
        return json(res,200,{ task_id: submitted.prompt_id });
      }
      if (req.method === 'GET' && url.pathname.startsWith('/v2/query/video_generation/')) return json(res,200,await pollTask(url.pathname.split('/').pop()));
      json(res,404,{ error: 'Not found' });
    } catch (error) {
      console.error(error.message);
      json(res,400,{ error: { message: error.message } });
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  createServer().listen(port,'127.0.0.1', () => console.log(`Local H3 bridge: http://127.0.0.1:${port} -> ${comfy}`));
}
