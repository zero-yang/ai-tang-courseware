<template>
  <div class="embedded-app" :inert="busy || !!savingVersion">
    <header v-if="!readOnly" class="editor-header">
      <div class="editor-heading">
        <button type="button" class="text-button editor-back" @click="send('RETURN_REQUEST')">‹ 返回</button>
        <div class="editor-brand"><span aria-hidden="true">Ai</span><strong>课件编辑</strong></div>
        <div v-if="initialized" class="editor-document">
          <strong class="editor-document-title" :title="heading">{{ heading }}</strong>
          <span>{{ version ? `${historical ? '正在编辑' : '当前版本'} ${formatVersion(version)}` : '待保存 v1.0' }} ｜ 已保留 {{ versionCount }}/3 个版本</span>
        </div>
      </div>
      <div v-if="initialized" class="editor-actions">
        <span class="editor-status" role="status">{{ statusLabel }}</span>
        <button type="button" class="text-button" :disabled="busy" @click="enterScreening">预览</button>
        <button type="button" class="editor-button save-button" :disabled="!canSaveCurrent" @click="void save('current')">保存</button>
        <span class="version-action" :tabindex="versionCount >= 3 ? 0 : undefined" :aria-describedby="versionCount >= 3 ? 'version-limit' : undefined">
          <button type="button" class="editor-button new-version-button" :disabled="!canSaveVersion" @click="void save('version')">另存为新版本</button>
          <span v-if="versionCount >= 3" id="version-limit" role="tooltip" class="version-limit">已达到 3 个版本上限，无法另存为新版本。你可保存当前版本。</span>
        </span>
      </div>
    </header>
    <div v-if="!readOnly && initialized" class="file-toolbar">
      <button type="button" class="editor-button" :disabled="busy" @click="pptxInput?.click()">导入 PPTX</button>
      <input ref="pptxInput" type="file" accept=".pptx" hidden @change="importFile" />
      <button type="button" class="editor-button" :disabled="busy || !!saveKind || !!pendingAnimation" @click="jsonInput?.click()">导入课件 JSON</button>
      <input ref="jsonInput" type="file" accept=".json,application/json" hidden @change="importDocument" />
      <button type="button" class="editor-button" :disabled="busy" @click="exportDocument">导出 JSON</button>
      <span class="file-divider" aria-hidden="true"></span>
      <button type="button" class="editor-button animation-import-button" :disabled="busy" @click="animationInput?.click()">导入动画变更</button>
      <input ref="animationInput" type="file" accept=".json" hidden @change="importAnimations" />
      <div class="prompt-action">
        <Popover trigger="mouseenter focusin" placement="bottom-start" append-to="parent" :offset="0" :hide-on-click="false">
          <button type="button" class="editor-button" :disabled="busy">GPT提示词与示例</button>
          <template #content>
            <section class="prompt-panel" aria-labelledby="animation-prompt-title" @keydown.stop @keyup.stop>
              <div class="prompt-panel-heading">
                <strong id="animation-prompt-title">GPT提示词与示例</strong>
                <button type="button" class="editor-button" @click="copyPrompt">复制</button>
              </div>
              <pre>{{ prompt }}</pre>
            </section>
          </template>
        </Popover>
      </div>
      <button type="button" class="editor-button" :disabled="busy" @click="downloadSkill">下载GPT动画Skill</button>
    </div>
    <div v-if="importNotice" role="status" class="import-notice">{{ importNotice }}</div>
    <div v-if="error && !pendingAnimation" role="alert" class="embed-error">{{ error }}</div>
    <div v-if="!initialized && error" class="embed-loading">请返回管理端重试</div>
    <div v-if="initialized" class="embedded-content" :class="{ 'embedded-content--editing': !readOnly }">
      <Screen v-if="screening" />
      <Editor v-else-if="!readOnly" :key="editorDocumentKey" />
    </div>
    <dialog v-if="!readOnly" ref="documentImportDialog" class="animation-dialog" aria-labelledby="document-import-title"
      aria-describedby="document-import-description" @close="resolveDocumentImport" @keydown.stop @keyup.stop @paste.stop>
      <h2 id="document-import-title">覆盖当前课件？</h2>
      <p id="document-import-description" class="document-import-description">导入将替换当前编辑内容，并重置撤销记录。</p>
      <form method="dialog" class="animation-dialog-actions">
        <button type="submit" class="animation-dialog-button" value="cancel" autofocus>取消</button>
        <button type="submit" class="animation-dialog-button animation-dialog-button--confirm" value="replace">确认覆盖</button>
      </form>
    </dialog>
    <dialog v-if="!readOnly" ref="animationDialog" class="animation-dialog" aria-labelledby="animation-dialog-title"
      @cancel.prevent @keydown.stop @keyup.stop @paste.stop>
      <h2 id="animation-dialog-title">动画已校验，请预览后确认保存。</h2>
      <p v-if="error" role="alert" class="animation-dialog-error">{{ error }}</p>
      <div class="animation-dialog-actions">
        <button type="button" class="animation-dialog-button" autofocus :disabled="busy || !!saveKind" @click="previewAnimations">预览动画</button>
        <button type="button" class="animation-dialog-button animation-dialog-button--confirm" :disabled="!animationPreviewed || !(historical ? canSaveVersion : canSaveCurrent)"
          @click="void save(historical ? 'version' : 'current')">{{ saveKind ? '保存中…' : '确认保存动画' }}</button>
        <button type="button" class="animation-dialog-button" :disabled="busy || !!saveKind" @click="cancelAnimations">取消变更</button>
      </div>
    </dialog>
    <dialog v-if="!readOnly" ref="versionNoteDialog" class="version-note-dialog" aria-labelledby="version-note-title"
      @close="resolveVersionNote" @keydown.stop @keyup.stop @paste.stop>
      <form @submit.prevent="confirmVersionNote">
        <h2 id="version-note-title">另存为新版本</h2>
        <label for="version-note">更新说明（必填）</label>
        <textarea id="version-note" v-model="versionNote" rows="4" required autofocus></textarea>
        <div class="version-note-actions">
          <button type="button" class="editor-button" @click="versionNoteDialog?.close()">取消</button>
          <button type="submit" class="editor-button new-version-button" :disabled="!versionNote.trim()">另存为新版本</button>
        </div>
      </form>
    </dialog>
  </div>
  <CoursewareLoading v-if="importTip" :tip="importTip" />
  <FullscreenSpin class="embed-export-loading-mask" :loading="exportingDocument" tip="正在导出课件…" />
  <div v-if="savingVersion" class="courseware-loading-overlay courseware-loading-overlay--saving" role="status" aria-live="polite">
    <div class="courseware-loading-content version-saving-card">
      <span class="courseware-loading-spinner" aria-hidden="true"></span>
      <strong class="courseware-loading-title">正在保存为新版本{{ formatVersion(savingVersion) }}，</strong>
      <span>保存完成前，请勿关闭或刷新页面</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import 'dayjs/locale/zh-cn'
import { saveAs } from 'file-saver'
import animationSkill from '../../.agents/skills/courseware-animation/SKILL.md?raw'
import { applyAnimations, effects, fingerprint, prompt } from './animationExchange'
import { nanoid } from 'nanoid'
import { useMainStore, useSlidesStore, useScreenStore, useSnapshotStore } from '@/store'
import useImport from '@/hooks/useImport'
import useHistorySnapshot from '@/hooks/useHistorySnapshot'
import useScreening from '@/hooks/useScreening'
import CoursewareLoading from '@/components/CoursewareLoading.vue'
import FullscreenSpin from '@/components/FullscreenSpin.vue'
import Popover from '@/components/Popover.vue'
import { copyText } from '@/utils/clipboard'
import { resolveLineConnections } from '@/utils/element'
import message from '@/utils/message'
import Editor from '@/views/Editor/index.vue'
import Screen from '@/views/Screen/index.vue'
import { bridgeAllowed, readOnly, send, subscribe } from './bridge'
import { api, CoursewareApiError, getToken, MediaSession, type CoursewareDocument, type SavedCourseware } from './api'
import { readCoursewareDocument } from './documentImport'
import { getEditableSnapshot } from './editableSnapshot'

dayjs.extend(relativeTime)

const emit = defineEmits<{ (event: 'startupComplete'): void }>()
const { addHistorySnapshot } = useHistorySnapshot()
const mainStore = useMainStore()
const slidesStore = useSlidesStore()
const screenStore = useScreenStore()
const snapshotStore = useSnapshotStore()
const { importPPTXFile } = useImport()
const { enterScreening } = useScreening()
const screening = computed(() => screenStore.screening)
const initialized = ref(false)
const error = ref('')
const importTip = ref('')
const exportingDocument = ref(false)
const busy = computed(() => !!importTip.value || exportingDocument.value)
const importNotice = ref('')
const editorDocumentKey = ref(0)
const heading = ref('课件')
const savedEditableSnapshot = ref('')
const pendingAnimation = ref<CoursewareDocument>()
const animationPreviewed = ref(false)
const animationDialog = ref<HTMLDialogElement>()
const documentImportDialog = ref<HTMLDialogElement>()
const pptxInput = ref<HTMLInputElement>()
const jsonInput = ref<HTMLInputElement>()
const animationInput = ref<HTMLInputElement>()
const version = ref(0)
const currentVersion = ref(0)
const versionCount = ref(0)
const savedAt = ref('')
const clock = ref(Date.now())
type SaveKind = 'current' | 'version'
const saveKind = ref<SaveKind>()
const savingVersion = ref(0)
const versionNoteDialog = ref<HTMLDialogElement>()
const versionNote = ref('')
const historical = computed(() => !!version.value && version.value !== currentVersion.value)
const canSaveCurrent = computed(() => initialized.value && !busy.value && !saveKind.value && !historical.value)
const canSaveVersion = computed(() => initialized.value && !busy.value && !saveKind.value && !!version.value && versionCount.value < 3)
let lessonId = ''
let coursewareId: string | undefined
let revision: number | undefined
let media: MediaSession | undefined
let saveRequest: { body: string; key: string } | undefined
let pendingSave: Promise<boolean> | undefined
let finishVersionNote: ((note?: string) => void) | undefined
let finishDocumentImport: ((confirmed: boolean) => void) | undefined
let starting = false
let stopped = false
let refreshTimer = 0
let clockTimer = 0
const serialize = (): CoursewareDocument => ({ format_version: 1,
  width: slidesStore.viewportSize, height: slidesStore.viewportSize * slidesStore.viewportRatio,
  theme: slidesStore.theme, slides: slidesStore.slides })
const snapshot = computed(() => JSON.stringify(serialize()))
const draftSnapshot = computed(() => pendingAnimation.value ? JSON.stringify(pendingAnimation.value) : snapshot.value)
const editableSnapshot = computed(() => getEditableSnapshot(serialize()))
const draftEditableSnapshot = computed(() => pendingAnimation.value ? getEditableSnapshot(pendingAnimation.value) : editableSnapshot.value)
const dirty = computed(() => initialized.value && !readOnly && draftEditableSnapshot.value !== savedEditableSnapshot.value)
const statusLabel = computed(() => {
  if (saveKind.value) return '保存中…'
  if (editableSnapshot.value !== savedEditableSnapshot.value || !savedAt.value) return '未保存修改'
  return `已保存·${dayjs(savedAt.value).locale('zh-cn').from(dayjs(clock.value))}`
})
watch(() => initialized.value || !!error.value, complete => {
  if (complete) emit('startupComplete')
}, { flush: 'post' })
watch([dirty, saveKind], () => {
  if (!readOnly) send('EDITOR_STATE', { dirty: dirty.value, saving: !!saveKind.value })
})
watch([pendingAnimation, savingVersion], ([draft, saving]) => {
  const dialog = animationDialog.value
  if (draft && !saving) dialog?.showModal()
  else dialog?.close()
}, { flush: 'post' })

function formatVersion(value: number) {
  return `v${Math.floor(value / 10)}.${value % 10}`
}

function applySavedMetadata(result: SavedCourseware) {
  version.value = result.version_no
  currentVersion.value = result.current_version_no
  versionCount.value = result.version_count
  savedAt.value = result.updated_at
  clock.value = Date.now()
  revision = result.revision
}

function failure(cause: unknown) {
  error.value = cause instanceof Error ? cause.message : '操作失败，请重试'
  send('ERROR', { message: error.value })
}
async function initialize(payload: Record<string, unknown>) {
  const previewDocument = readOnly ? payload.previewDocument as CoursewareDocument | undefined : undefined
  if (starting || (!previewDocument && !/^[1-9]\d*$/.test(String(payload.lessonId))) || (payload.mode === 'play') !== readOnly) return
  starting = true
  lessonId = previewDocument ? '' : String(payload.lessonId)
  if (!readOnly && typeof payload.lessonName === 'string' && payload.lessonName) {
    heading.value = `${payload.lessonName}·课件`
  }
  coursewareId = typeof payload.coursewareId === 'string' ? payload.coursewareId : undefined
  if (lessonId) media = new MediaSession(lessonId)
  try {
    if (previewDocument) {
      if (previewDocument.format_version !== 1 || !Array.isArray(previewDocument.slides) || !previewDocument.slides.length
        || previewDocument.slides.length > 200 || !(previewDocument.width > 0) || !(previewDocument.height > 0)) {
        throw new Error('预览数据无效，请返回编辑器重试')
      }
      slidesStore.setSlides(previewDocument.slides, previewDocument.theme)
      slidesStore.setViewportSize(previewDocument.width)
      slidesStore.setViewportRatio(previewDocument.height / previewDocument.width)
    }
    else if (coursewareId && media) {
      await getToken()
      const versionPath = typeof payload.versionNo === 'number' ? `/versions/${payload.versionNo}` : ''
      const result: SavedCourseware = await (await api(lessonId, `/${coursewareId}${versionPath}`)).json()
      if (!readOnly && result.version_no !== result.current_version_no && result.version_count >= 3) {
        send('VERSIONS_CHANGED')
        throw new Error('已保留 3 个版本，请先返回并删除一个其他旧版本')
      }
      const document = await media.hydrate(result.document)
      if (stopped) return
      slidesStore.setSlides(document.slides, document.theme)
      slidesStore.setViewportSize(document.width)
      slidesStore.setViewportRatio(document.height / document.width)
      applySavedMetadata(result)
    }
    else {
      if (readOnly) throw new Error('请选择已保存的课件')
      slidesStore.setSlides([{ id: nanoid(10), elements: [] }])
    }
    const startIndex = Number(payload.startIndex)
    slidesStore.updateSlideIndex(previewDocument && Number.isInteger(startIndex)
      ? Math.max(0, Math.min(startIndex, slidesStore.slides.length - 1)) : 0)
    if (!readOnly) await snapshotStore.initSnapshotDatabase()
    savedEditableSnapshot.value = editableSnapshot.value
    screenStore.setScreening(readOnly)
    initialized.value = true
    send('READY', { pageCount: slidesStore.slides.length, coursewareId })
    if (!readOnly) {
      clockTimer = window.setInterval(() => {
        clock.value = Date.now()
      }, 1000)
    }
    refreshTimer = window.setInterval(() => {
      if (lessonId) void getToken().catch(failure)
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
  if (!file || busy.value || pendingAnimation.value) return
  if (!/\.pptx$/i.test(file.name) || file.size > 100 * 1024 * 1024) {
    failure(new Error('请选择不超过 100 MB 的 PPTX 文件')); return
  }
  if ((coursewareId || dirty.value && slidesStore.slides.some(slide => slide.elements.length)) && !window.confirm('导入将替换当前课件内容，是否继续？')) return
  importTip.value = '正在导入 PPTX…'
  error.value = ''
  const before = JSON.parse(snapshot.value) as CoursewareDocument
  try {
    const result = await importPPTXFile([file], { cover: true })
    importNotice.value = 'PPTX 已转换；当前导入不保留原文件的元素动画和翻页切换，可在编辑器中重新设置动画。请核对排版和字体。'
      + (result.unsupportedMediaCount ? `有 ${result.unsupportedMediaCount} 个音视频未能导入，请重新上传。` : '')
  }
  catch (cause) {
    slidesStore.setSlides(before.slides, before.theme)
    slidesStore.setViewportSize(before.width)
    slidesStore.setViewportRatio(before.height / before.width)
    failure(cause)
  }
  finally {
    importTip.value = ''
  }
}

function confirmDocumentImport() {
  const dialog = documentImportDialog.value
  if (!dialog) return Promise.resolve(false)
  dialog.returnValue = ''
  dialog.showModal()
  return new Promise<boolean>(resolve => {
    finishDocumentImport = resolve
  })
}

function resolveDocumentImport() {
  const finish = finishDocumentImport
  finishDocumentImport = undefined
  finish?.(documentImportDialog.value?.returnValue === 'replace')
}

async function importDocument(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file || readOnly || !media || busy.value || saveKind.value || pendingAnimation.value || finishVersionNote || finishDocumentImport) return
  importTip.value = '正在校验课件 JSON…'
  try {
    const imported = await readCoursewareDocument(file)
    if (stopped) return
    if (coursewareId || dirty.value) {
      importTip.value = ''
      if (!await confirmDocumentImport() || stopped) return
    }

    error.value = ''
    importTip.value = '正在导入课件素材…'
    const document = await media.hydrate(imported).catch(cause => {
      if (cause instanceof CoursewareApiError && cause.status === 403) {
        throw new Error('没有权限在当前单课读取课件素材')
      }
      if (cause instanceof CoursewareApiError && [404, 422].includes(cause.status)) {
        throw new Error('课件素材已失效，请重新选择素材')
      }
      throw cause
    })
    if (stopped) return

    const slides = document.slides.map(slide => ({ ...slide, elements: resolveLineConnections(slide.elements) }))
    await snapshotStore.resetSnapshotDatabase(slides, 0).catch(() => {
      throw new Error('无法重置课件撤销记录，请重试')
    })
    if (stopped) return

    slidesStore.$patch(state => {
      state.slides = slides
      state.theme = document.theme
      state.viewportSize = document.width
      state.viewportRatio = document.height / document.width
      state.slideIndex = 0
    })
    mainStore.$patch({
      activeElementIdList: [], handleElementId: '', activeGroupElementId: '', hiddenElementIdList: [],
      selectedSlidesIndex: [], selectedTableCells: [], clipingImageElementId: '',
      creatingElement: null, creatingCustomShape: false, textFormatPainter: null, shapeFormatPainter: null,
    })
    editorDocumentKey.value++
    importNotice.value = '课件 JSON 已导入'
  }
  catch (cause) {
    if (stopped) return
    importNotice.value = ''
    failure(cause)
  }
  finally {
    importTip.value = ''
  }
}

function previewAnimations() {
  if (!pendingAnimation.value || busy.value || saveKind.value) return
  send('PREVIEW', { document: JSON.parse(draftSnapshot.value), startIndex: 0 })
  animationPreviewed.value = true
}
async function copyPrompt() {
  try {
    await copyText(prompt)
    message.success('提示词已复制')
  }
  catch {
    message.error('复制失败，请选中文本手动复制')
  }
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
  exportingDocument.value = true
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
    exportingDocument.value = false
  }
}
async function importAnimations(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file || busy.value || pendingAnimation.value) return
  importTip.value = '正在校验动画变更…'
  error.value = ''
  try {
    if (file.size > 5 * 1024 * 1024) throw new Error('动画变更文件不能超过 5 MB')
    const document = await stableDocument()
    const before = JSON.parse(snapshot.value) as CoursewareDocument
    pendingAnimation.value = applyAnimations(JSON.parse(await file.text()), await fingerprint(document), before)
    animationPreviewed.value = false
  }
  catch (cause) {
    failure(cause)
  }
  finally {
    importTip.value = ''
  }
}
function cancelAnimations() {
  if (!pendingAnimation.value || busy.value || saveKind.value) return
  pendingAnimation.value = undefined
  animationPreviewed.value = false
  error.value = ''
}
function requestVersionNote(): Promise<string | undefined> {
  const dialog = versionNoteDialog.value
  if (!dialog || finishVersionNote) return Promise.resolve(undefined)
  dialog.returnValue = ''
  dialog.showModal()
  return new Promise(resolve => {
    finishVersionNote = resolve
  })
}

function confirmVersionNote() {
  if (versionNote.value.trim()) versionNoteDialog.value?.close('save')
}

function resolveVersionNote() {
  const note = versionNoteDialog.value?.returnValue === 'save' ? versionNote.value.trim() : undefined
  if (!note) versionNote.value = ''
  const finish = finishVersionNote
  finishVersionNote = undefined
  finish?.(note)
}

async function save(kind: SaveKind): Promise<boolean> {
  if (readOnly || finishVersionNote || finishDocumentImport || !(kind === 'version' ? canSaveVersion.value : canSaveCurrent.value)) return false
  if (pendingAnimation.value && !animationPreviewed.value) {
    failure(new Error('请先预览动画变更，再保存课件'))
    return false
  }
  let changeNote: string | undefined
  if (kind === 'version') {
    changeNote = await requestVersionNote()
    if (!changeNote || stopped || !canSaveVersion.value) return false
  }

  const captured = draftSnapshot.value
  const confirmedAnimation = pendingAnimation.value
  const nextVersion = kind === 'version' ? currentVersion.value + 1 : 0
  saveKind.value = kind
  savingVersion.value = nextVersion
  error.value = ''
  pendingSave = persistSnapshot(captured, nextVersion, changeNote, confirmedAnimation).finally(() => {
    pendingSave = undefined
    savingVersion.value = 0
    saveKind.value = undefined
  })
  return pendingSave
}

async function persistSnapshot(captured: string, nextVersion: number, changeNote?: string, confirmedAnimation?: CoursewareDocument) {
  try {
    const draft: CoursewareDocument = JSON.parse(captured)
    if (draft.slides.length > 200) throw new Error('课件最多支持 200 页')
    if (!media) throw new Error('课件尚未初始化，请重新打开编辑器')
    const document = await media.persist(draft)
    const body = JSON.stringify(nextVersion
      ? { document, revision, source_version_no: version.value, next_version_no: nextVersion, change_note: changeNote }
      : { document, revision })
    const path = nextVersion ? `/${coursewareId}/versions` : coursewareId ? `/${coursewareId}` : ''
    const method = !nextVersion && coursewareId ? 'PUT' : 'POST'
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (method === 'POST') {
      if (saveRequest?.body !== body) saveRequest = { body, key: crypto.randomUUID() }
      headers['Idempotency-Key'] = saveRequest.key
    }
    const result: SavedCourseware = await (await api(lessonId, path, {
      method, body, headers,
    })).json()
    if (stopped) return false
    coursewareId = result.id
    applySavedMetadata(result)
    if (nextVersion) versionNote.value = ''
    if (confirmedAnimation && pendingAnimation.value === confirmedAnimation) {
      for (const [index, slide] of confirmedAnimation.slides.entries()) {
        const current = slidesStore.slides[index]
        if (JSON.stringify(slide.animations) !== JSON.stringify(current.animations)) {
          slidesStore.updateSlide({ animations: slide.animations }, slide.id)
        }
      }
      addHistorySnapshot()
      pendingAnimation.value = undefined
      animationPreviewed.value = false
    }
    savedEditableSnapshot.value = getEditableSnapshot(draft)
    saveRequest = undefined
    send('SAVED', { coursewareId, revision, versionNo: version.value, versionCount: versionCount.value,
      updatedAt: savedAt.value, dirty: dirty.value })
    return true
  }
  catch (cause) {
    if (stopped) return false
    if (cause instanceof CoursewareApiError && cause.unavailableAssets.length) {
      const recoverable = media?.invalidate(cause.unavailableAssets)
      failure(new Error(recoverable ? '素材已过期，请再次保存以重新上传' : '素材已失效，请重新选择素材后保存'))
      return false
    }
    failure(cause)
    if (cause instanceof CoursewareApiError && (cause.status === 409 || cause.status === 404)) {
      send('VERSIONS_CHANGED')
      if (coursewareId) {
        try {
          const versions: { version_no: number; is_current: boolean }[] =
            await (await api(lessonId, `/${coursewareId}/versions`)).json()
          currentVersion.value = versions.find(item => item.is_current)?.version_no ?? currentVersion.value
          versionCount.value = versions.length
        }
        catch { /* Keep the draft and the original error when metadata cannot be refreshed. */ }
      }
    }
    return false
  }
}

async function respondToReturn(requestId: string, saveChanges: boolean) {
  if (readOnly) return
  send('RETURN_ACK', {}, requestId)
  const finished = pendingSave ? await pendingSave : true
  let outcome = 'blocked'
  if (finished && !busy.value && !finishVersionNote && !finishDocumentImport) {
    if (!dirty.value) outcome = 'allow'
    else if (!saveChanges) outcome = 'dirty'
    else {
      const saved = await save(historical.value ? 'version' : 'current')
      outcome = saved && !dirty.value ? 'allow' : 'blocked'
    }
  }
  send('RETURN_RESULT', { outcome, historical: historical.value }, requestId)
}

const dispose = subscribe(message => {
  if (message.type === 'INIT') void initialize(message.payload)
  else if (message.type === 'RETURN_CHECK') void respondToReturn(message.requestId, false)
  else if (message.type === 'RETURN_SAVE') void respondToReturn(message.requestId, true)
})
let helloTimer = 0
function blockEditorInput(event: Event) {
  if (!busy.value && !savingVersion.value) return
  event.preventDefault()
  event.stopPropagation()
}
function beforeUnload(event: BeforeUnloadEvent) {
  if (dirty.value || saveKind.value) {
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
  finishVersionNote?.()
  finishDocumentImport?.(false)
  dispose()
  clearInterval(helloTimer)
  clearInterval(refreshTimer)
  clearInterval(clockTimer)
  media?.dispose()
  document.removeEventListener('keydown', blockEditorInput, true)
  document.removeEventListener('paste', blockEditorInput, true)
  window.removeEventListener('beforeunload', beforeUnload)
})
</script>

<style scoped>
.embedded-app {
  --editor-primary: #0091ff;
  --editor-primary-fill: #dff1ff;
  --editor-border: #d0d7e2;
  --editor-divider: #e0e6ed;
  --editor-muted: #858b95;
  --editor-ink: #303133;
  --editor-surface: #fff;
  --editor-control-radius: 5px;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: #f4f6f8;
}
.editor-header, .file-toolbar {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  padding-inline: 18px;
  border-bottom: 1px solid var(--editor-divider);
  font: 13px/1.5 "PingFang SC", system-ui, sans-serif;
}
.editor-header {
  min-height: 65px;
  gap: 12px;
  justify-content: space-between;
  background: #f1f6ff;
}
.editor-heading, .editor-actions, .editor-brand { display: flex; align-items: center; }
.editor-heading { flex: 1; min-width: 0; }
.editor-actions { gap: 12px; }
.text-button {
  border: 0;
  background: transparent;
  color: var(--editor-primary);
  padding: 0;
  cursor: pointer;
  white-space: nowrap;
  font: inherit;
}
.text-button:disabled { color: var(--editor-muted); cursor: default; }
.editor-back { width: 72px; text-align: left; flex-shrink: 0; border-right: 1px solid #d8e3f2; min-height: 25px; }
.editor-brand {
  width: 172px;
  flex-shrink: 0;
  gap: 18px;
  min-height: 32px;
  padding-inline: 18px 20px;
  border-right: 1px solid #d8e3f2;
  color: #173f71;
  font-size: 16px;
}
.editor-brand span { width: 32px; color: var(--editor-primary); font-size: 24px; font-weight: 600; }
.editor-document { display: grid; flex: 1; min-width: 0; margin-left: 20px; color: var(--editor-muted); font-size: 11px; }
.editor-document > span { white-space: nowrap; }
.editor-document-title {
  color: var(--editor-ink);
  font: 600 17px/26px "PingFang SC", system-ui, sans-serif;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.editor-status {
  min-width: 90px;
  padding: 3px 7px;
  border-radius: 4px;
  background: #fff6e6;
  color: #b77714;
  text-align: center;
  white-space: nowrap;
  font-size: 11px;
}
.editor-actions > .text-button { min-width: 58px; }
.editor-button {
  display: inline-flex;
  justify-content: center;
  align-items: center;
  gap: 6px;
  min-height: 32px;
  padding-inline: 12px;
  border: 1px solid var(--editor-border);
  border-radius: var(--editor-control-radius);
  background: var(--editor-surface);
  color: var(--editor-muted);
  cursor: pointer;
  white-space: nowrap;
  font: inherit;
}
.editor-button:not(:disabled):hover { border-color: var(--editor-primary); color: var(--editor-primary); }
.editor-button:disabled { border-color: #0000001a; background: #7d7d7d1a; color: #00000040; cursor: default; }
.save-button { min-width: 72px; }
.new-version-button { min-width: 119px; border-color: var(--editor-primary); color: var(--editor-primary); background: var(--editor-primary-fill); }
.version-action { position: relative; display: inline-flex; }
.version-limit {
  position: absolute;
  z-index: 30;
  inset: calc(100% + 7px) -8px auto auto;
  visibility: hidden;
  width: min(282px, calc(100vw - 24px));
  padding: 12px 10px;
  border: 1px solid var(--editor-border);
  border-radius: 6px;
  background: var(--editor-surface);
  box-shadow: 0 4px 16px #27344726;
  color: var(--editor-ink);
  font-size: 14px;
}
.version-limit::before {
  position: absolute;
  content: '';
  top: -5px;
  right: 88px;
  width: 8px;
  height: 8px;
  border-top: 1px solid var(--editor-border);
  border-left: 1px solid var(--editor-border);
  background: var(--editor-surface);
  transform: rotate(45deg);
}
.version-action:hover .version-limit, .version-action:focus-visible .version-limit { visibility: visible; }
.file-toolbar { min-height: 43px; flex-wrap: wrap; gap: 10px; background: var(--editor-surface); }
.file-toolbar > button { min-width: 106px; }
.file-toolbar > .animation-import-button { min-width: 126px; }
.file-divider { height: 18px; margin-inline: 8px 9px; border-left: 1px solid var(--editor-divider); }
.prompt-panel {
  width: min(520px, calc(100vw - 42px));
  color: var(--editor-ink);
  font: 13px/1.5 "PingFang SC", system-ui, sans-serif;
}
.prompt-panel-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
}
.prompt-panel pre {
  max-height: min(360px, 50vh);
  overflow: auto;
  overscroll-behavior: contain;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
  user-select: text;
  font: inherit;
}
.embedded-content { flex: 1; min-height: 0; min-width: 0; }
.embedded-content--editing { overflow-x: auto; }
.embedded-content--editing > :deep(.pptist-editor) { min-width: 1080px; }
.embed-export-loading-mask { z-index: 10000; cursor: wait; }
.embed-loading { margin: auto; color: #666; }
.import-notice { padding: 8px 10px; color: #7a4b00; background: #fffbe6; font-size: 13px; }
.embed-error { padding: 10px; color: #b42318; background: #fff1f0; }
.version-note-dialog, .animation-dialog {
  box-sizing: border-box;
  width: min(416px, calc(100% - 32px));
  padding: 24px;
  border: 0;
  border-radius: 10px;
  background: var(--editor-surface);
  color: var(--editor-ink);
  font: 14px/1.5 "PingFang SC", system-ui, sans-serif;
}
.version-note-dialog::backdrop, .animation-dialog::backdrop { background: #2734474d; }
.animation-dialog h2 { margin: 0; color: #000; font-size: 18px; font-weight: 700; }
.document-import-description { margin: 12px 0 0; }
.animation-dialog-error { margin: 12px 0 0; color: #b42318; }
.animation-dialog-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; margin-top: 16px; }
.animation-dialog-button {
  min-height: 40px;
  padding: 0 16px;
  border: 1px solid currentColor;
  border-radius: 4px;
  background: var(--editor-surface);
  color: rgb(0 0 0 / 50%);
  cursor: pointer;
  white-space: nowrap;
  font: inherit;
  font-weight: 400;
  line-height: 20px;
}
.animation-dialog-button--confirm {
  border-radius: 8px;
  background: #def1ff;
  color: var(--editor-primary);
}
.animation-dialog-button:focus-visible { outline: 2px solid currentColor; outline-offset: 2px; }
.animation-dialog-button:disabled { opacity: 0.55; cursor: default; }
.version-note-dialog h2 { margin-bottom: 16px; font-size: 18px; }
.version-note-dialog textarea {
  display: block;
  box-sizing: border-box;
  width: 100%;
  margin-top: 6px;
  padding: 8px 10px;
  border: 1px solid var(--editor-border);
  border-radius: var(--editor-control-radius);
  font: inherit;
  resize: vertical;
}
.version-note-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
.courseware-loading-overlay--saving { z-index: 10001; background: #2734474d; }
.version-saving-card {
  width: min(432px, calc(100vw - 32px));
  min-height: 208px;
  padding: 23px 16px;
  border-radius: 10px;
  background: #fff;
  color: #858b95;
  font-size: 13px;
}
@media (max-width: 800px) {
  .editor-header { flex-wrap: wrap; gap: 5px; padding-block: 8px; }
  .editor-heading { flex-basis: 100%; }
  .editor-actions { justify-content: flex-end; width: 100%; gap: 7px; }
}
@media (max-width: 490px) {
  .animation-dialog { padding-inline: 16px; }
  .editor-header, .file-toolbar { padding-inline: 9px; }
  .editor-brand { width: auto; gap: 5px; padding-inline: 8px; }
  .editor-brand span { width: auto; }
  .editor-back { width: 50px; }
  .editor-document { margin-left: 8px; }
  .editor-actions { flex-wrap: wrap; }
  .editor-actions > .text-button, .save-button { min-width: 45px; }
  .file-toolbar { gap: 5px; padding-block: 5px; }
  .file-toolbar > button, .file-toolbar > .animation-import-button, .prompt-action .editor-button { min-width: 0; padding-inline: 8px; }
  .file-divider { margin-inline: 4px; }
}
</style>
