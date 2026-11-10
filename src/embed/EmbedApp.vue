<template>
  <div class="embedded-app" :inert="!!loadingTip">
    <div v-if="!readOnly && initialized" class="embedded-toolbar">
      <input v-model="slidesStore.title" aria-label="课件名称" maxlength="200" :disabled="busy || !!pendingAnimation" />
      <label class="import-button">导入 PPTX<input type="file" accept=".pptx" :disabled="busy || !!pendingAnimation" @change="importFile" /></label>
      <button :disabled="busy || !!pendingAnimation" @click="exportDocument">导出课件 JSON</button>
      <label class="import-button">导入动画变更<input type="file" accept=".json" :disabled="busy || !!pendingAnimation" @change="importAnimations" /></label>
      <button :disabled="busy" @click="downloadGuide">GPT 提示词与示例</button>
      <button :disabled="busy" @click="downloadSkill">下载 GPT 动画 Skill</button>
      <button :disabled="busy" @click="preview">预览</button>
      <button :disabled="busy || !!pendingAnimation" @click="save(false)">保存</button>
      <button :disabled="busy || !!pendingAnimation" @click="save(true)">保存并返回</button>
      <span>{{ busy ? '处理中…' : dirty ? '未保存' : '已保存' }}</span>
    </div>
    <div v-if="pendingAnimation" class="import-notice">
      动画已校验，请预览后确认保存。
      <button :disabled="busy" @click="preview">预览动画</button>
      <button :disabled="busy || !animationPreviewed" @click="save(false)">确认保存动画</button>
      <button :disabled="busy" @click="cancelAnimations">取消变更</button>
    </div>
    <div v-if="importNotice" role="status" class="import-notice">{{ importNotice }}</div>
    <div v-if="error" role="alert" class="embed-error">{{ error }}</div>
    <div v-if="!initialized && error" class="embed-loading">请返回管理端重试</div>
    <div v-if="initialized" class="embedded-content">
      <Screen v-if="screening" />
      <Editor v-else-if="!readOnly && !pendingAnimation" />
    </div>
  </div>
  <FullscreenSpin class="embed-loading-mask" :loading="!!loadingTip" :tip="loadingTip" />
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { saveAs } from 'file-saver'
import animationSkill from '../../.agents/skills/courseware-animation/SKILL.md?raw'
import { applyAnimations, effects, fingerprint, prompt } from './animationExchange'
import { nanoid } from 'nanoid'
import { useSlidesStore, useScreenStore, useSnapshotStore } from '@/store'
import useImport from '@/hooks/useImport'
import useHistorySnapshot from '@/hooks/useHistorySnapshot'
import useScreening from '@/hooks/useScreening'
import FullscreenSpin from '@/components/FullscreenSpin.vue'
import Editor from '@/views/Editor/index.vue'
import Screen from '@/views/Screen/index.vue'
import { bridgeAllowed, readOnly, send, subscribe } from './bridge'
import { api, getToken, requestCourse, MediaSession, type CoursewareDocument, type SavedCourseware } from './api'

const { addHistorySnapshot } = useHistorySnapshot()
const slidesStore = useSlidesStore()
const screenStore = useScreenStore()
const snapshotStore = useSnapshotStore()
const { importPPTXFile } = useImport()
const { enterScreening } = useScreening()
const screening = computed(() => screenStore.screening)
const initialized = ref(false)
const error = ref('')
const operationTip = ref('')
const busy = computed(() => !!operationTip.value)
const loadingTip = computed(() => operationTip.value || (!initialized.value && !error.value ? '正在连接管理端并加载课件…' : ''))
const importNotice = ref('')
const savedSnapshot = ref('')
const pendingAnimation = ref<CoursewareDocument>()
const animationPreviewed = ref(false)
let courseId = ''
let coursewareId: string | undefined
let revision: number | undefined
let media: MediaSession | undefined
let creationKey = crypto.randomUUID()
let attemptedCreation = ''
let starting = false
let stopped = false
let refreshTimer = 0
const serialize = (): CoursewareDocument => ({ format_version: 1, title: slidesStore.title,
  width: slidesStore.viewportSize, height: slidesStore.viewportSize * slidesStore.viewportRatio,
  theme: slidesStore.theme, slides: slidesStore.slides })
const snapshot = computed(() => JSON.stringify(serialize()))
const dirty = computed(() => initialized.value && !readOnly && snapshot.value !== savedSnapshot.value)
watch(dirty, value => send('DIRTY', { dirty: value }))
function failure(cause: unknown) {
  error.value = cause instanceof Error ? cause.message : '操作失败，请重试'
  send('ERROR', { message: error.value })
}
async function initialize(payload: Record<string, unknown>) {
  const previewDocument = readOnly ? payload.previewDocument as CoursewareDocument | undefined : undefined
  const draft = payload.draft === true && !readOnly && !payload.courseId && !payload.coursewareId
  if (starting || (!draft && !previewDocument && !/^\d+$/.test(String(payload.courseId))) || (payload.mode === 'play') !== readOnly) return
  starting = true
  courseId = draft || previewDocument ? '' : String(payload.courseId)
  coursewareId = typeof payload.coursewareId === 'string' ? payload.coursewareId : undefined
  if (courseId) media = new MediaSession(courseId)
  try {
    if (previewDocument) {
      if (previewDocument.format_version !== 1 || !Array.isArray(previewDocument.slides) || !previewDocument.slides.length
        || previewDocument.slides.length > 200 || !(previewDocument.width > 0) || !(previewDocument.height > 0)) {
        throw new Error('预览数据无效，请返回编辑器重试')
      }
      slidesStore.setTitle(previewDocument.title)
      slidesStore.setSlides(previewDocument.slides, previewDocument.theme)
      slidesStore.setViewportSize(previewDocument.width)
      slidesStore.setViewportRatio(previewDocument.height / previewDocument.width)
    }
    else if (coursewareId && media) {
      await getToken()
      const result: SavedCourseware = await (await api(courseId, `/${coursewareId}`)).json()
      const document = await media.hydrate(result.document)
      if (stopped) return
      slidesStore.setTitle(document.title)
      slidesStore.setSlides(document.slides, document.theme)
      slidesStore.setViewportSize(document.width)
      slidesStore.setViewportRatio(document.height / document.width)
      revision = result.revision
    }
    else {
      if (readOnly) throw new Error('请选择已保存的课件')
      slidesStore.setSlides([{ id: nanoid(10), elements: [] }])
      slidesStore.setTitle('未命名课件')
    }
    const startIndex = Number(payload.startIndex)
    slidesStore.updateSlideIndex(previewDocument && Number.isInteger(startIndex)
      ? Math.max(0, Math.min(startIndex, slidesStore.slides.length - 1)) : 0)
    if (!readOnly) await snapshotStore.initSnapshotDatabase()
    savedSnapshot.value = coursewareId ? snapshot.value : ''
    screenStore.setScreening(readOnly)
    initialized.value = true
    send('READY', { pageCount: slidesStore.slides.length, coursewareId })
    refreshTimer = window.setInterval(() => {
      if (courseId) void getToken().catch(failure)
    }, 240000)
  }
  catch (cause) {
    failure(cause)
  }
}
async function importFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file || busy.value) return
  if (!/\.pptx$/i.test(file.name) || file.size > 100 * 1024 * 1024) {
    failure(new Error('请选择不超过 100 MB 的 PPTX 文件')); return
  }
  if ((coursewareId || dirty.value && slidesStore.slides.some(slide => slide.elements.length)) && !window.confirm('导入将替换当前课件内容，是否继续？')) return
  operationTip.value = '正在导入 PPTX…'
  error.value = ''
  const before = JSON.parse(snapshot.value) as CoursewareDocument
  try {
    const result = await importPPTXFile([file], { cover: true })
    importNotice.value = 'PPTX 已转换；当前导入不保留原文件的元素动画和翻页切换，可在编辑器中重新设置动画。请核对排版和字体。'
      + (result.unsupportedMediaCount ? `有 ${result.unsupportedMediaCount} 个音视频未能导入，请重新上传。` : '')
    slidesStore.setTitle(file.name.replace(/\.pptx$/i, ''))
  }
  catch (cause) {
    slidesStore.setSlides(before.slides, before.theme)
    slidesStore.setViewportSize(before.width)
    slidesStore.setViewportRatio(before.height / before.width)
    failure(cause)
  }
  finally {
    operationTip.value = ''
  }
}
function preview() {
  if (pendingAnimation.value) animationPreviewed.value = true
  enterScreening()
}
function downloadGuide() {
  saveAs(new Blob([prompt], { type: 'text/plain;charset=utf-8' }), 'GPT动画提示词与示例.txt')
}
function downloadSkill() {
  saveAs(new Blob([animationSkill], { type: 'text/markdown;charset=utf-8' }), 'SKILL.md')
}
function stableDocument() {
  if (!coursewareId || dirty.value || !media) throw new Error('请先保存当前课件，再导出或导入动画变更')
  return media.persist(JSON.parse(snapshot.value))
}
async function exportDocument() {
  if (busy.value || pendingAnimation.value) return
  operationTip.value = '正在导出课件…'
  error.value = ''
  try {
    const document = await stableDocument()
    const data = { base_id: await fingerprint(document), document, allowed_effects: effects, instructions: prompt }
    saveAs(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), '课件.json')
  }
  catch (cause) {
    failure(cause)
  }
  finally {
    operationTip.value = ''
  }
}
async function importAnimations(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file || busy.value || pendingAnimation.value) return
  operationTip.value = '正在校验动画变更…'
  error.value = ''
  try {
    if (file.size > 5 * 1024 * 1024) throw new Error('动画变更文件不能超过 5 MB')
    const document = await stableDocument()
    const before = JSON.parse(snapshot.value) as CoursewareDocument
    const updated = applyAnimations(JSON.parse(await file.text()), await fingerprint(document), before)
    pendingAnimation.value = before
    animationPreviewed.value = false
    slidesStore.setSlides(updated.slides, updated.theme)
    slidesStore.updateSlideIndex(0)
  }
  catch (cause) {
    failure(cause)
  }
  finally {
    operationTip.value = ''
  }
}
function cancelAnimations() {
  if (!pendingAnimation.value || busy.value) return
  slidesStore.setSlides(pendingAnimation.value.slides, pendingAnimation.value.theme)
  pendingAnimation.value = undefined
  animationPreviewed.value = false
}
async function save(returnAfterSave: boolean) {
  if (busy.value || readOnly || pendingAnimation.value && !animationPreviewed.value) return
  operationTip.value = '正在保存课件…'
  error.value = ''
  try {
    if (!slidesStore.title.trim()) throw new Error('请输入课件名称')
    if (slidesStore.slides.length > 200) throw new Error('课件最多支持 200 页')
    if (!courseId) {
      courseId = await requestCourse()
      if (stopped) return
      media = new MediaSession(courseId)
    }
    if (!media) throw new Error('课件尚未初始化，请重新打开编辑器')
    const captured = snapshot.value
    const document = await media.persist(JSON.parse(captured))
    const body = JSON.stringify({ document, revision })
    // A changed payload gets a new creation key; an unchanged uncertain retry retains its key.
    if (!coursewareId && attemptedCreation && attemptedCreation !== body) creationKey = crypto.randomUUID()
    attemptedCreation = body
    const result: SavedCourseware = await (await api(courseId, coursewareId ? `/${coursewareId}` : '', {
      method: coursewareId ? 'PUT' : 'POST', body,
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': creationKey },
    })).json()
    coursewareId = result.id
    revision = result.revision
    if (pendingAnimation.value) addHistorySnapshot()
    pendingAnimation.value = undefined
    savedSnapshot.value = captured
    send('SAVED', { coursewareId, revision, returnAfterSave: returnAfterSave && !dirty.value, dirty: dirty.value })
  }
  catch (cause) {
    failure(cause)
  }
  finally {
    operationTip.value = ''
  }
}
const dispose = subscribe(message => {
  if (message.type === 'INIT') void initialize(message.payload)
})
let helloTimer = 0
function blockEditorInput(event: Event) {
  if (!busy.value) return
  event.preventDefault()
  event.stopPropagation()
}
function beforeUnload(event: BeforeUnloadEvent) {
  if (dirty.value) {
    event.preventDefault(); event.returnValue = ''
  }
}
onMounted(() => {
  if (!bridgeAllowed) {
    failure(new Error('当前页面只能由允许的管理端嵌入')); return
  }
  send('INIT_REQUEST')
  helloTimer = window.setInterval(() => {
    if (!starting) send('INIT_REQUEST')
  }, 1000)
  document.addEventListener('keydown', blockEditorInput, true)
  document.addEventListener('paste', blockEditorInput, true)
  window.addEventListener('beforeunload', beforeUnload)
})
onUnmounted(() => {
  stopped = true
  dispose()
  clearInterval(helloTimer)
  clearInterval(refreshTimer)
  media?.dispose()
  document.removeEventListener('keydown', blockEditorInput, true)
  document.removeEventListener('paste', blockEditorInput, true)
  window.removeEventListener('beforeunload', beforeUnload)
})
</script>

<style scoped>
.embedded-app { height: 100%; display: flex; flex-direction: column; background: #fff; }
.embedded-toolbar { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; padding: 10px; border-bottom: 1px solid #ddd; font-size: 13px; }
.embedded-toolbar > input { min-width: 100px; flex: 1; padding: 7px; border: 1px solid #ccc; border-radius: 4px; }
.embedded-toolbar button, .import-button { padding: 7px 12px; border: 1px solid #ccc; border-radius: 4px; cursor: pointer; background: #fff; white-space: nowrap; }
.import-button input { display: none; }
.embedded-content { flex: 1; min-height: 0; }
.embed-loading-mask { z-index: 10000; cursor: wait; }
.embed-loading { margin: auto; color: #666; }
.import-notice { padding: 8px 10px; color: #7a4b00; background: #fffbe6; font-size: 13px; }
.embed-error { padding: 10px; color: #b42318; background: #fff1f0; }
</style>
