<template>
  <Teleport to="body">
    <div v-if="src" class="image-preview-overlay" @click.self="emit('close')">
      <section ref="dialog" class="image-preview-dialog" role="dialog" aria-modal="true" :aria-label="title || '图片预览'" tabindex="-1" @keydown="onKeydown">
        <header>
          <strong>{{ title || '图片预览' }}</strong>
          <div class="image-preview-controls">
            <button type="button" class="btn btn-sm" aria-label="缩小图片" :disabled="zoom <= 1" @click="changeZoom(-0.25)">−</button>
            <output aria-live="polite">{{ Math.round(zoom * 100) }}%</output>
            <button type="button" class="btn btn-sm" aria-label="放大图片" :disabled="zoom >= 4" @click="changeZoom(0.25)">＋</button>
            <button type="button" class="btn btn-sm" @click="zoom = 1">适应窗口</button>
            <button type="button" class="btn btn-sm" aria-label="关闭图片预览" @click="emit('close')">关闭</button>
          </div>
        </header>
        <div class="image-preview-viewport" :class="{ 'can-pan': zoom > 1 }" @wheel.prevent="changeZoom($event.deltaY < 0 ? 0.25 : -0.25)" @pointerdown="startPan" @pointermove="pan" @pointerup="endPan" @pointercancel="endPan">
          <div class="image-preview-canvas" :style="{ width: `${zoom * 100}%`, height: `${zoom * 100}%` }">
            <img :src="src" :alt="title || '图片预览'" draggable="false" />
          </div>
        </div>
        <p>滚轮或 ＋ / − 缩放 · 放大后拖动查看细节 · Esc 关闭</p>
      </section>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
const props = defineProps<{ src: string; title?: string }>()
const emit = defineEmits<{ close: [] }>()
const zoom = ref(1)
const dialog = ref<HTMLElement | null>(null)
let returnFocus: HTMLElement | null = null
let drag: { x: number; y: number; left: number; top: number } | null = null
function startPan(event: PointerEvent) {
  if (zoom.value <= 1 || event.button !== 0) return
  const el = event.currentTarget as HTMLElement
  drag = { x: event.clientX, y: event.clientY, left: el.scrollLeft, top: el.scrollTop }
  el.setPointerCapture(event.pointerId)
}
function pan(event: PointerEvent) {
  if (!drag) return
  const el = event.currentTarget as HTMLElement
  el.scrollLeft = drag.left + drag.x - event.clientX
  el.scrollTop = drag.top + drag.y - event.clientY
}
function endPan(event: PointerEvent) {
  drag = null
  const el = event.currentTarget as HTMLElement
  if (el.hasPointerCapture(event.pointerId)) el.releasePointerCapture(event.pointerId)
}
function changeZoom(delta: number) { zoom.value = Math.max(1, Math.min(4, zoom.value + delta)) }
function restoreFocus() {
  if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true })
  returnFocus = null
}
watch(() => props.src, async (src, previous) => {
  zoom.value = 1
  if (typeof document === 'undefined') return
  if (!src) { restoreFocus(); return }
  if (!previous && document.activeElement instanceof HTMLElement) returnFocus = document.activeElement
  await nextTick()
  dialog.value?.focus({ preventScroll: true })
}, { immediate: true })
onBeforeUnmount(restoreFocus)
function onKeydown(event: KeyboardEvent) {
  event.stopPropagation()
  if (event.key === 'Escape') { event.preventDefault(); emit('close') }
  if (event.key === '+' || event.key === '=') { event.preventDefault(); changeZoom(0.25) }
  if (event.key === '-') { event.preventDefault(); changeZoom(-0.25) }
  if (event.key !== 'Tab') return
  const buttons = [...(dialog.value?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') || [])]
  const first = buttons[0], last = buttons.at(-1)
  if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.value)) {
    event.preventDefault(); last?.focus()
  } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
}
</script>

<style scoped>
.image-preview-overlay { position: fixed; inset: 0; z-index: 10000; display: grid; place-items: center; padding: 16px; background: rgba(0,0,0,.78); }
.image-preview-dialog { width: min(1200px, 96vw); background: var(--bg-1, #202024); border: 1px solid var(--border); border-radius: 12px; padding: 14px; color: var(--text-1); box-shadow: 0 16px 64px #0008; outline: none; }
header { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-bottom: 10px; }
strong { font-size: 14px; overflow-wrap: anywhere; }
.image-preview-controls { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
output { font-size: 12px; min-width: 40px; text-align: center; }
.image-preview-viewport { height: min(72vh, 850px); overflow: auto; background: var(--bg-2, #151518); border-radius: 8px; overscroll-behavior: contain; }
.can-pan { cursor: grab; touch-action: none; }
.can-pan:active { cursor: grabbing; }
.image-preview-canvas { display: flex; align-items: center; justify-content: center; }
img { width: 100%; height: 100%; max-width: none; object-fit: contain; display: block; }
p { margin: 10px 0 0; color: var(--text-3); font-size: 11px; }
@media (max-width: 600px) { .image-preview-overlay { padding: 8px; } .image-preview-dialog { padding: 10px; } .image-preview-viewport { height: 62vh; } }
</style>
