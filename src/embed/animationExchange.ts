import { ENTER_ANIMATIONS, EXIT_ANIMATIONS, ATTENTION_ANIMATIONS } from '@/configs/animation'
import type { CoursewareDocument } from './api'
import type { PPTAnimation } from '@/types/slides'

export const effects = {
  in: ENTER_ANIMATIONS.flatMap(group => group.children.map(item => item.value)),
  out: EXIT_ANIMATIONS.flatMap(group => group.children.map(item => item.value)),
  attention: ATTENTION_ANIMATIONS.flatMap(group => group.children.map(item => item.value)),
}

export const prompt = `请根据附件课件和我的教学要求编排动画，输出一个可下载的 JSON 文件。
输出格式为 {"format_version":1,"base_id":"原样复制导出文件的 base_id","changes":[{"slide_id":"原页面ID","animations":[{"id":"唯一动画ID","elId":"该页已有元素ID","type":"in","effect":"fadeIn","duration":1000,"trigger":"click"}]}]}。
每个 changes 项完整替换该页动画列表。请保留该页仍需使用的已有动画。省略的页面保留原动画，空数组会清空该页动画。
只使用 allowed_effects 中与 type 匹配的效果。duration 单位为毫秒，范围 100–10000。
trigger 可用 click（点击）、meantime（与上一动画同时）、auto（上一动画结束后）。每页第一条使用 click。同一并行动画组中每个元素只能出现一次。
只输出上述字段，保持页面和元素 ID，素材引用仅供理解。根据文字、元素位置和补充截图判断教学顺序。
请检查引用、效果、时长和动画顺序，返回完整变更 JSON。
我的教学要求：请在这里填写，例如标题点击淡入，三条要点依次点击出现。`

export async function fingerprint(document: CoursewareDocument): Promise<string> {
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical)
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, canonical(child)]))
    return value
  }
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(canonical(document))))
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) throw new Error('动画文件包含无效或不允许的字段')
  return value as Record<string, unknown>
}

export function applyAnimations(value: unknown, baseId: string, document: CoursewareDocument): CoursewareDocument {
  const patch = object(value, ['format_version', 'base_id', 'changes'])
  if (patch.format_version !== 1 || patch.base_id !== baseId) throw new Error('课件版本不匹配，请重新导出当前课件生成动画变更')
  if (!Array.isArray(patch.changes) || !patch.changes.length || patch.changes.length > document.slides.length) throw new Error('动画变更页面列表无效')
  const result = structuredClone(document)
  const pages = new Set<string>()
  for (const item of patch.changes) {
    const change = object(item, ['slide_id', 'animations'])
    const slide = result.slides.find(page => page.id === change.slide_id)
    if (!slide || pages.has(slide.id)) throw new Error('页面不存在或重复')
    pages.add(slide.id)
    if (!Array.isArray(change.animations) || change.animations.length > 1000) throw new Error('每页最多支持 1000 条动画')
    const ids = new Set<string>()
    const simultaneous = new Set<string>()
    slide.animations = change.animations.map((value, index) => {
      const animation = object(value, ['id', 'elId', 'type', 'effect', 'duration', 'trigger'])
      const { id, elId, type, effect, duration, trigger } = animation
      if (typeof id !== 'string' || !id || id.length > 100 || ids.has(id)) throw new Error('动画 ID 无效或重复')
      ids.add(id)
      if (typeof elId !== 'string' || !slide.elements.some(element => element.id === elId)) throw new Error('动画引用了不存在的元素')
      if (!['in', 'out', 'attention'].includes(String(type)) || !effects[type as keyof typeof effects].includes(effect as string)) throw new Error('动画效果与类型不匹配')
      if (typeof duration !== 'number' || !Number.isFinite(duration) || duration < 100 || duration > 10000) throw new Error('动画时长须为 100–10000 毫秒')
      if (!['click', 'meantime', 'auto'].includes(String(trigger)) || index === 0 && trigger !== 'click') throw new Error('动画触发方式无效，首条须为 click')
      if (trigger !== 'meantime') simultaneous.clear()
      if (simultaneous.has(elId)) throw new Error('同一并行动画组重复引用了元素')
      simultaneous.add(elId)
      return { id, elId, type, effect, duration, trigger } as PPTAnimation
    })
  }
  return result
}
