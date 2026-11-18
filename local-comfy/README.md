# 本地 ComfyUI 与角色一致性扩展

本目录提供火宝到本机 ComfyUI 的桥接服务。保留上游的云端供应商支持；本地图片使用 OpenAI 图片适配器，视频使用 MiniMax H3 适配器。桥接协议包含火宝使用的异步任务轮询，并非完整的 OpenAI API 实现。

## 本分支改动

- 接入 MiniMax-H3 文生视频、首尾帧和多模态参考视频，输出原生音画同步视频。6 步 Turbo LoRA 后接 Kitchen INT8 attention，可切换回 PyTorch。
- 接入 Qwen Image 2.1 Turbo、Noct Q V4 和 Z-Image Turbo；前两者支持参考图编辑。输出尺寸先对齐 latent，再裁切回请求大小，支持 1920×1080 等资产尺寸。
- 角色资产卡片和详情页支持上传、替换、移除现实照片。单个及批量生图在提交时补充人脸参考要求，不覆盖保存的原始设定或最终提示词。
- 项目素材库和剧集资产页同步展示、编辑角色参考照片与视频单人参考图，卡片和详情页共享角色记录。
- 资产图片、参考照片、视频单人图及任务图片共用大图预览，支持滚轮和按钮缩放、拖动查看细节、适应窗口及 Esc 关闭；关闭后恢复原入口焦点。
- 独立保存视频单人参考图，视频引用优先使用它；没有绑定时回退到原角色资产。H3 提示词按实际参考图顺序生成 Picture / Subject 对应关系，区分人物、场景和道具，约束重复人物与跨镜头服装、发型和面部变化。
- 新增可空字段 `video_reference_image_url` 和 `video_appearance_lock`，启动时幂等补齐旧 SQLite 库。更换或移除参考图时清除旧外观约束。
- Windows 启动脚本支持独立本地配置、后台启动和端口复用；依赖锁文件中的私有镜像地址改为公共 npm registry，版本及完整性校验不变。

## 环境与模型

已验证环境：Windows、RTX 5090 32 GB、ComfyUI v0.45.0、comfy-kitchen 0.2.41。模型文件和 Python 环境不随仓库分发。

1. 按火宝主 README 安装 Node.js 和前后端依赖：分别在 `backend`、`frontend` 运行 `npm ci`。
2. 准备支持 `MiniMaxH3ReferenceToVideo`、`MiniMaxH3ImageToVideo`、`TextEncodeQwenImage21`、`ModelAttentionBackend` 的 ComfyUI；旧版本缺少节点时需要升级。
3. 安装 [ComfyUI-MiniMax-H3-Turbo](https://github.com/Larryvrh/ComfyUI-MiniMax-H3-Turbo) 自定义节点及其依赖。H3 使用 [MiniMax-H3 Turbo LoRA](https://huggingface.co/larryvrh/MiniMax-H3-Turbo-Lora) 的 v4 step600 EMA 权重。
4. 将所选模型需要的文件放入下表目录。文件名对应 `bridge.mjs` / `image.mjs` 中的节点输入；可以只安装需要使用的模型。

| 功能 | `ComfyUI/models/` 下的文件 |
| --- | --- |
| H3 主模型 | `diffusion_models/minimax_h3_fl2va_pruned_int8_convrot.safetensors`、`diffusion_models/minimax_h3_ref2va_pruned_int8_convrot.safetensors` |
| H3 编码器 | `text_encoders/qwen3vl_32b_h3_ultra_uncensored_heretic_int8_convrot.safetensors`；其他兼容 H3 编码器可通过 `H3_TEXT_ENCODER` 设置实际文件名 |
| H3 VAE / LoRA | `vae/minimax_h3_video_vae_fp16.safetensors`、`vae/minimax_h3_audio_vae_fp32.safetensors`、`loras/minimax_h3_turbo_v4_step600_ema.safetensors` |
| Qwen 2.1 Turbo | `diffusion_models/qwen_image_2.1_turbo_bf16.safetensors` |
| Noct Q V4 | `diffusion_models/NoctQ_V4_int8_convrot.safetensors` |
| Qwen / Noct 共用 | `text_encoders/qwen3vl_8b_int8_convrot.safetensors`、`vae/qwen_image_2.1_vae_bf16.safetensors` |
| Z-Image Turbo | `diffusion_models/z_image_turbo_bf16.safetensors`、`text_encoders/qwen_3_4b.safetensors`、`vae/ae.safetensors` |

若 Qwen 2.1 Turbo 是包含两个 safetensors 分片的 transformer 目录，可以在安装了 torch / safetensors 的 Python 环境中运行：

```powershell
python local-comfy/merge-qwen-shards.py "C:/models/Qwen-Image-2.1-Turbo/transformer" "C:/AI/ComfyUI_windows_portable/ComfyUI/models/diffusion_models/qwen_image_2.1_turbo_bf16.safetensors"
```

脚本流式复制张量，检查重复张量和输出文件；目标文件或 `.partial` 临时文件已存在时拒绝覆盖。请从对应模型作者处获取权重并遵守各自许可。

## 启动与火宝配置

Windows 需要 `node.exe`、`ffmpeg.exe` 和 `ffprobe.exe` 在 PATH 中（后两者也可通过 `FFMPEG_BIN` / `FFPROBE_BIN` 指定）。复制 `local-comfy/settings.example.psd1` 为 `local-comfy/settings.local.psd1`，填写自己的 ComfyUI portable 目录，然后运行根目录 `start-local.cmd`。

也可使用 `./start-local.ps1 -ComfyRoot 'C:/AI/ComfyUI_windows_portable'`，或通过 `COMFY_ROOT` 指定目录。已有 ComfyUI 服务时使用 `-SkipComfyStart`；独立启动桥接可运行 `node local-comfy/bridge.mjs`。其他操作系统可以分别启动前后端与桥接服务。

| 服务 | 默认地址 |
| --- | --- |
| 火宝前端 | `http://localhost:3013` |
| 火宝后端 | `http://127.0.0.1:5679` |
| 桥接 | `http://127.0.0.1:8189` |
| ComfyUI | `http://127.0.0.1:8188` |

在火宝模型设置中新增以下配置，并在剧集生成页面选中对应配置：

| 类型 / 供应商 | Base URL | 模型名 |
| --- | --- | --- |
| 视频 / MiniMax | `http://127.0.0.1:8189` | `MiniMax-H3` |
| 图片 / OpenAI | `http://127.0.0.1:8189` | `qwen-image-2.1-turbo` |
| 图片 / OpenAI | `http://127.0.0.1:8189` | `noct-q-v4` |
| 图片 / OpenAI | `http://127.0.0.1:8189` | `z-image-turbo` |

本地桥接不验证 API key；表单要求填写时可用占位值 `local-comfy`。它只监听回环地址，按本机单用户服务设计。文本/剧本模型仍需在火宝中单独配置。

支持的环境变量：`COMFY_URL`（默认 `http://127.0.0.1:8188`）、`H3_BRIDGE_PORT`（默认 8189）、`H3_TEXT_ENCODER`、`H3_ATTENTION_BACKEND`。修改后重启桥接进程；启动脚本会复用占用端口的服务，不自动重启它们。

Kitchen 不可用时设置 `H3_ATTENTION_BACKEND=pytorch attention`；默认是 `comfy kitchen attention`。该设置只作用于 H3。健康检查使用 `GET /health`；列出图片模型使用 `GET /v1/models`。健康检查只验证 ComfyUI 可访问，不代表所有模型文件或节点均已安装。

## 角色参考的使用方式与边界

资产制作中的“角色参考照片”用于下次角色生图，需选择 Qwen / Noct 等支持编辑的模型。Z-Image Turbo 不支持参考图编辑，会明确返回错误。

“视频单人参考图”用于分镜视频，建议使用一张已确认脸型、服装和画风的单人图；角色原多视图资产继续保留。可通过现有角色更新接口 `PUT /api/v1/characters/:id` 写入 `video_reference_image_url` 与可选 `video_appearance_lock`（最多 500 字符）。引用本地图片采用 `static/uploads/...` 或 `static/images/...` 路径。外观约束在界面只读显示，当前未提供自动裁图、自动人物检测或自动提取服装描述功能。

本地 H3 参考图任务在后端提交时自动转换为[官方原生参考提示词格式](https://huggingface.co/MiniMaxAI/MiniMax-H3/blob/main/docs/VIDEO_PROMPT_WRITING_GUIDE_ref_en.md)：六个固定段落、英文视觉描述、Picture / Subject 绑定、带时间的 Shot 切镜，以及保留原文的对白与说话人编号。转换按实际上传顺序读取已绑定角色的单人图和外观设定，不再附加通用的眼镜、分屏或多视图禁令清单。旧中文分镜与直接 API 请求也经过同一路径，原始提示词保留，编译结果写入任务参数以供重试复用。

该转换需要可用的 OpenAI 兼容文本配置（OpenAI 或火山供应商；已验证 DeepSeek）。格式、参考编号、切镜时间或原始引号内台词校验失败时自动重写一次，再失败则停止任务，不提交 GPU。已有正确原生格式可直接使用。该逻辑仅针对回环地址上的 MiniMax-H3 参考图任务，首尾帧模式与云端服务不受影响。生成质量仍需检查；格式正确不能保证每个种子、复杂调度都完全消除重复人物或服装漂移。

本地视频接口支持可选的非负安全整数 `seed`，包含 `0`，一路传到 ComfyUI 的噪声节点。省略时仍随机；同种子测试还需保持模型、LoRA、步数、素材顺序、尺寸和帧数一致。

H3 当前设置为 6 步、LoRA 强度 1、`low_vram=false`、24 fps，时长 4–15 秒并向上对齐原生 `17n+5` 帧网格。参考素材模式与首尾帧模式不能混用。其他显存容量未验证。图片与视频进入同一 ComfyUI 队列，加载/卸载由 ComfyUI 自身显存管理负责；本扩展没有要求两类模型同时常驻显存。

## 已有速度对比

一次 RTX 5090 测试采用同种子 20261118、1344×768、294 帧（12.25 秒）、4 张参考图、相同 v4 LoRA 和 6 步配置：

| Attention | 总耗时 | 采样耗时（约） |
| --- | ---: | ---: |
| PyTorch | 441.826 秒 | 399 秒 |
| Kitchen INT8 | 213.221 秒 | 180 秒 |

该样本采样约快 2.2 倍，总耗时减少约 52%。Kitchen 复用了前处理缓存，总耗时并非完全冷启动对比。逐秒抽帧未发现明显新增画质退化，但两组仍有重复人物；音视频解码通过，未做对白听辨。这是单样本记录，不是通用性能或质量保证。原始剧集、图片、工作流和视频不随仓库发布。

## 验证与排错

2026-11-18 补测原生提示词：固定图片、种子、1344×768、6 步和 Kitchen，分别对比旧前端包装与原生格式。单人 107 帧样本旧版 60.176 秒、新版 63.220 秒；每秒两帧检查中，旧版出现额外人物、眼镜与分屏，新版保持单人和完整画面。四参考图、294 帧多角色样本旧版 216.709 秒、新版 228.697 秒；两版该样本均未见明显分屏，新版恢复了空镜并改善人物景别，抽帧未见重复角色或前后衣服变化。以上是有限样本的质量检查，不代表所有种子均可保证；未做对白听辨。原始测试媒体保留在本机，不随仓库分发。

部署后从火宝任务接口提交中文参考图提示词，已验证自动转换、原提示词保留、完成后转换结果持久化、种子传递到 REF2VA 工作流、视频下载与解码；该 4.458 秒单人视频约 66 秒完成，抽帧未见重复人物或分屏。相关自动测试共 30 项通过，后端类型检查和前端生产构建通过。

从仓库根目录运行：

```powershell
node --test local-comfy/bridge.test.mjs local-comfy/image.test.mjs
node --test frontend/tests/h3-reference-prompt.test.mjs
npm --prefix backend run typecheck
npm --prefix frontend run build
```

在 `backend` 目录运行 `node --import tsx --test tests/h3-prompt.test.ts tests/video-delivery.test.ts tests/character-reference.test.ts`，验证原生提示词校验、切镜修正、原文保留、固定种子、视频落盘与独立临时 SQLite 库中的角色参考绑定。

日志在 `local-comfy/logs/`：`comfy.stderr.log` 记录模型加载与采样错误，`h3-bridge.stderr.log` 记录接口错误，`backend.stdout.log` / `backend.stderr.log` 记录火宝任务。任务缺失、被中断、失败或未返回素材时，桥接会向火宝返回失败状态。

本地配置、日志、数据库、模型、素材、性能测试原始记录及一次性队列恢复工具均不纳入本扩展提交。上游项目的许可证与署名保持不变。

本次发布检查：上述桥接、连续性、参考绑定及角色尺寸测试共 19 项通过，后端类型检查、前端构建、启动脚本语法检查和分片合并小样本检查通过。额外运行的上游结构测试中有 8 项失败，已在未修改的上游提交 76bf150 上复现：asset-crud-structure（3 项，旧英文错误文案断言）、asset-library-structure（4 项，旧 pages 路径）、video-direct-generation-config（1 项，过时的 Wan 预设断言）。未将这些已有问题计为本次通过的检查。
