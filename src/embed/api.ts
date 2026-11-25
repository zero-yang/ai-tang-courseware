import { send, subscribe } from './bridge'
import type { Slide, SlideTheme } from '@/types/slides'

export interface CoursewareDocument {
  format_version: 1
  width: number
  height: number
  theme: SlideTheme
  slides: Slide[]
}
export interface SavedCourseware {
  id: string
  revision: number
  version_no: number
  current_version_no: number
  version_count: number
  updated_at: string
  document: CoursewareDocument
}

export class CoursewareApiError extends Error {
  constructor(message: string, readonly status: number, readonly unavailableAssets: string[] = []) {
    super(message)
  }
}
const apiBase = import.meta.env.VITE_API_BASE_URL.replace(/\/$/, '')
let credentials: { token: string; expiresAt: number } | undefined
let pendingToken: Promise<string> | undefined
export function getToken(): Promise<string> {
  if (credentials && credentials.expiresAt > Date.now() + 60000) return Promise.resolve(credentials.token)
  if (pendingToken) return pendingToken
  pendingToken = new Promise<string>((resolve, reject) => {
    const requestId = crypto.randomUUID()
    const dispose = subscribe(message => {
      if (message.requestId !== requestId || !['TOKEN', 'TOKEN_ERROR'].includes(message.type)) return
      clearTimeout(timer)
      dispose()
      if (message.type === 'TOKEN' && typeof message.payload.token === 'string' && typeof message.payload.expires_in === 'number') {
        credentials = { token: message.payload.token, expiresAt: Date.now() + message.payload.expires_in * 1000 }
        resolve(credentials.token)
      }
      else reject(new Error('登录凭证获取失败，请返回管理端重新登录'))
    })
    const timer = window.setTimeout(() => {
      dispose(); reject(new Error('获取登录凭证超时'))
    }, 15000)
    send('TOKEN_REQUEST', {}, requestId)
  }).finally(() => {
    pendingToken = undefined
  })
  return pendingToken
}
export async function api(lessonId: string, path = '', init: RequestInit = {}): Promise<Response> {
  const token = await getToken()
  const response = await fetch(`${apiBase}/lessons/${encodeURIComponent(lessonId)}/courseware${path}`, {
    ...init, credentials: 'omit', signal: init.signal || AbortSignal.timeout(120000),
    headers: { ...init.headers, Authorization: `Bearer ${token}` },
  })
  if (!response.ok) {
    if (response.status === 401) credentials = undefined
    const error = await response.json().catch(() => ({}))
    const unavailable = Array.isArray(error.details) ? error.details
      .filter((issue: { type?: string; loc?: unknown[] }) => issue?.type === 'asset_unavailable' && issue.loc?.[0] === 'assets')
      .map((issue: { loc: string[] }) => 'asset:' + issue.loc[1]) : []
    throw new CoursewareApiError(error.message || `请求失败（${response.status}）`, response.status, unavailable)
  }
  return response
}

export class MediaSession {
  private stableReferences = new Map<string, string>()
  private uploads = new Map<string, Promise<string>>()
  private loaded = new Map<string, Promise<string>>()
  private urls = new Set<string>()
  private disposed = false
  constructor(private lessonId: string) {}
  private async map(value: unknown, transform: (value: string) => Promise<string>): Promise<unknown> {
    if (typeof value === 'string') return transform(value)
    if (Array.isArray(value)) {
      const result = []
      for (const child of value) result.push(await this.map(child, transform))
      return result
    }
    if (value && typeof value === 'object') {
      const result: Record<string, unknown> = {}
      for (const [key, child] of Object.entries(value)) result[key] = await this.map(child, transform)
      return result
    }
    return value
  }
  invalidate(references: string[]) {
    const missing = new Set(references)
    const recoverable = new Set<string>()
    for (const [source, reference] of this.stableReferences) {
      if (missing.has(reference)) {
        this.stableReferences.delete(source)
        this.uploads.delete(source)
        this.loaded.delete(reference)
        recoverable.add(reference)
      }
    }
    return recoverable.size === missing.size
  }
  async persist(document: CoursewareDocument): Promise<CoursewareDocument> {
    return await this.map(document, async value => {
      if (this.stableReferences.has(value)) return this.stableReferences.get(value)!
      if (!value.startsWith('blob:') && !value.startsWith('data:')) return value
      let upload = this.uploads.get(value)
      if (!upload) {
        upload = (async () => {
          if (value.startsWith('blob:')) this.urls.add(value)
          const blob = await fetch(value).then(response => response.blob()).catch(() => {
            throw new Error('本地素材已失效，请重新选择素材后保存')
          })
          if (blob.size > 50 * 1024 * 1024) throw new Error('单个媒体不能超过 50 MB')
          if (!/^(image|audio|video)\//.test(blob.type)) throw new Error('无法识别媒体类型，请重新上传支持的图片、音频或视频')
          const result = await (await api(this.lessonId, '/assets', { method: 'POST', body: blob, headers: { 'Content-Type': blob.type } })).json()
          this.stableReferences.set(value, result.reference)
          return result.reference as string
        })()
        this.uploads.set(value, upload)
        upload.catch(() => this.uploads.delete(value))
      }
      return await upload
    }) as CoursewareDocument
  }
  async hydrate(document: CoursewareDocument): Promise<CoursewareDocument> {
    return await this.map(document, async value => {
      if (!/^asset:[1-9][0-9]*$/.test(value)) return value
      let pending = this.loaded.get(value)
      if (!pending) {
        pending = (async () => {
          const response = await api(this.lessonId, `/assets/${value.slice(6)}`)
          const blob = await response.blob()
          if (this.disposed) throw new Error('课件已关闭')
          const url = URL.createObjectURL(blob)
          this.urls.add(url)
          this.stableReferences.set(url, value)
          return url
        })()
        this.loaded.set(value, pending)
        const request = pending
        request.catch(() => {
          if (this.loaded.get(value) === request) this.loaded.delete(value)
        })
      }
      return await pending
    }) as CoursewareDocument
  }
  dispose() {
    this.disposed = true
    for (const url of this.urls) URL.revokeObjectURL(url); this.urls.clear()
  }
}
