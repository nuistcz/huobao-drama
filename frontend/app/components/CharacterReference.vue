<template>
  <section class="character-reference" :aria-label="referenceTitle" @click.stop @keydown.stop>
    <div class="reference-heading">
      <strong>{{ video ? '视频单人参考图' : '角色参考照片' }}</strong>
      <button type="button" class="btn btn-sm" :disabled="busy" @click="fileInput?.click()">{{ busy ? '保存中…' : referenceUrl ? '替换照片' : '上传参考照片' }}</button>
      <input ref="fileInput" hidden type="file" accept="image/jpeg,image/png,image/webp" :disabled="busy" aria-label="上传角色参考照片" @change="upload" />
    </div>
    <div v-if="referenceUrl" class="reference-preview">
      <button type="button" class="reference-image-button" :aria-label="`放大预览${referenceTitle}`" @click="emit('preview', referenceUrl, referenceTitle)">
        <img :src="referenceUrl" :alt="referenceTitle" />
        <span>点击放大</span>
      </button>
      <button type="button" class="btn btn-sm" :disabled="busy" @click="save([])">移除参考图</button>
    </div>
    <template v-if="video">
      <p>上传符合角色画风和服装的单人正面图，视频生成时优先使用。避免多视图、拼图或多人合影；不替换原角色资产。</p>
      <p>移除后恢复使用原角色资产。JPG / PNG / WebP，最大 20 MB。</p>
      <p v-if="character.video_appearance_lock || character.videoAppearanceLock">固定外观：{{ character.video_appearance_lock || character.videoAppearanceLock }}</p>
    </template>
    <template v-else>
      <p>可上传现实生活照片。生成时参考人物长相，并保留原始角色设定、服装和画面风格。</p>
      <p>使用 Qwen Image 2.1 Turbo、Noct Q V4 等支持参考图的模型；JPG / PNG / WebP，最大 20 MB。</p>
    </template>
  </section>
</template>

<script setup lang="ts">
import { toast } from 'vue-sonner'
import { characterAPI, uploadAPI } from '~/composables/useApi'
import { toastError } from '~/composables/useToast'
const props = defineProps<{ video?: boolean; character: { id: number; name?: string; reference_images?: string | null; referenceImages?: string | null; video_reference_image_url?: string | null; videoReferenceImageUrl?: string | null; video_appearance_lock?: string | null; videoAppearanceLock?: string | null } }>()
const emit = defineEmits<{ updated: [id: number, references: string | null]; preview: [src: string, title: string] }>()
const referenceTitle = computed(() => `${props.character.name || '角色'} · ${props.video ? '视频单人参考图' : '角色参考照片'}`)
const fileInput = ref<HTMLInputElement | null>(null)
const busyIds = useState<number[]>('character-reference-busy', () => [])
const busy = computed(() => busyIds.value.includes(props.character.id))
const referenceUrl = computed(() => {
  try {
    const value = props.video ? props.character.video_reference_image_url ?? props.character.videoReferenceImageUrl : JSON.parse(props.character.reference_images ?? props.character.referenceImages ?? '[]')[0]
    return typeof value === 'string' ? (value.startsWith('static/') ? `/${value}` : value) : ''
  } catch { return '' }
})
async function persist(id: number, refs: string[]) {
  await characterAPI.update(id, props.video ? { video_reference_image_url: refs[0] || null } : { reference_images: refs })
  emit('updated', id, props.video ? refs[0] || null : refs.length ? JSON.stringify(refs) : null)
  toast.success(refs.length ? '参考照片已保存，下次生成时生效' : '已移除参考照片')
}
async function save(refs: string[]) {
  if (busy.value) return
  const id = props.character.id
  busyIds.value.push(id)
  try { await persist(id, refs) } catch (e) { toastError(e) }
  finally { busyIds.value = busyIds.value.filter(v => v !== id) }
}
async function upload(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file || busy.value) return
  if (!/\.(png|jpe?g|webp)$/i.test(file.name) || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) { toast.error('请选择 JPG、PNG 或 WebP 图片'); return }
  if (!file.size || file.size > 20 * 1024 * 1024) { toast.error('图片不能为空，且不能超过 20 MB'); return }
  const id = props.character.id
  busyIds.value.push(id)
  try {
    const result = await uploadAPI.image(file)
    await persist(id, [result.path])
  } catch (e) { toastError(e) }
  finally { busyIds.value = busyIds.value.filter(v => v !== id) }
}
</script>

<style scoped>
.character-reference { border-top: 1px solid var(--border); padding-top: 12px; margin-top: 8px; cursor: default; }
.reference-heading, .reference-preview { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.reference-heading strong { font-size: 12px; color: var(--text-1); }
.reference-preview { justify-content: flex-start; margin-top: 10px; }
.reference-preview img { width: 72px; height: 88px; object-fit: contain; border-radius: 6px; background: var(--bg-2); }
.reference-image-button { display: grid; gap: 4px; padding: 4px; border: 1px solid var(--border); border-radius: 8px; background: transparent; color: var(--text-2); cursor: zoom-in; }
.reference-image-button span { font-size: 10px; }
.reference-image-button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
p { margin: 8px 0 0; font-size: 11px; line-height: 1.6; color: var(--text-3); }
</style>
