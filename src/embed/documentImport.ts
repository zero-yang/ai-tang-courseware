import DOMPurify from 'dompurify'
import { createDefaultSlideTheme } from '../configs/defaultSlideTheme'
import { CLIPPATHS } from '../configs/imageClip'
import { SHAPE_PATH_FORMULAS } from '../configs/shapes'
import type { ShapePathFormulasKeys, Slide, SlideTheme } from '@/types/slides'
import type { CoursewareDocument } from './api'

const maxFileSize = 100 * 1024 * 1024
const assetReference = /^asset:[1-9][0-9]{0,18}$/
const mediaDataURL = /^data:(image|audio|video)\//i
const elementTypes = ['text', 'image', 'shape', 'line', 'chart', 'table', 'latex', 'video', 'audio']
const chartTypes = ['bar', 'column', 'line', 'pie', 'ring', 'area', 'radar', 'scatter']

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function isPair(value: unknown): boolean {
  return Array.isArray(value) && value.length === 2 && value.every(isNumber)
}

function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string')
}

function isNumberList(value: unknown): value is number[] {
  return Array.isArray(value) && value.every(isNumber)
}

function checkValues(value: unknown, depth = 0) {
  if (depth >= 64) throw new Error('课件 JSON 的数据层级过深')
  if (Array.isArray(value)) {
    for (const item of value) checkValues(item, depth + 1)
  }
  else if (isObject(value)) {
    for (const [key, item] of Object.entries(value)) {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') throw new Error('课件 JSON 包含无效字段')
      checkValues(item, depth + 1)
    }
  }
  else if (typeof value === 'string') {
    if (value.startsWith('blob:')) throw new Error('课件 JSON 包含临时素材地址，请从已保存的课件重新导出')
    if (value.startsWith('asset:') && !assetReference.test(value)) throw new Error('课件 JSON 包含无效的私有素材引用')
    if (value.startsWith('data:') && !mediaDataURL.test(value)) throw new Error('课件 JSON 包含不支持的内嵌素材')
  }
  else if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('课件 JSON 包含无效数值')
}

function isMediaSource(value: unknown): boolean {
  if (!isId(value)) return false
  if (assetReference.test(value) || mediaDataURL.test(value)) return true
  return isWebURL(value, 'https://courseware.invalid')
}

function isWebURL(value: unknown, base?: string): boolean {
  if (!isId(value)) return false
  try {
    return ['https:', 'http:'].includes(new URL(value, base).protocol)
  }
  catch {
    return false
  }
}

function isGradient(value: unknown): boolean {
  return isObject(value) && (value.type === 'linear' || value.type === 'radial') && isNumber(value.rotate)
    && Array.isArray(value.colors) && value.colors.length > 0
    && value.colors.every(stop => isObject(stop) && isNumber(stop.pos) && typeof stop.color === 'string')
}

function isTheme(value: unknown): value is Record<string, unknown> & Partial<SlideTheme> {
  if (!isObject(value)) return false
  const { themeColors, backgroundColor, fontName, fontColor, outline, shadow } = value
  return (themeColors === undefined || isStringList(themeColors) && themeColors.length > 0)
    && [backgroundColor, fontName, fontColor].every(field => field === undefined || typeof field === 'string')
    && (outline === undefined || isObject(outline))
    && (shadow === undefined || isObject(shadow) && [shadow.h, shadow.v, shadow.blur].every(isNumber) && typeof shadow.color === 'string')
}

function isBackground(value: unknown): boolean {
  if (!isObject(value)) return false
  if (value.type === 'solid') return typeof value.color === 'string'
  if (value.type === 'image') return isObject(value.image) && isMediaSource(value.image.src)
  return value.type === 'gradient' && isGradient(value.gradient)
}

function isTable(value: Record<string, unknown>): boolean {
  const { colWidths, data, rowHeights } = value
  if (!Array.isArray(data) || !data.length || !isNumberList(colWidths) || !colWidths.length
    || !isObject(value.outline) || !isNumber(value.cellMinHeight)
    || (rowHeights !== undefined && !isNumberList(rowHeights))) return false
  return data.every((row, rowIndex) => Array.isArray(row) && row.length === colWidths.length
    && row.every((cell, columnIndex) => isObject(cell) && isId(cell.id) && typeof cell.text === 'string'
      && isSpan(cell.colspan, colWidths.length - columnIndex) && isSpan(cell.rowspan, data.length - rowIndex)))
}

function isSpan(value: unknown, limit: number): boolean {
  return isNumber(value) && Number.isInteger(value) && value >= 1 && value <= limit
}

function isImageClip(value: unknown): boolean {
  return isObject(value) && Array.isArray(value.range) && value.range.length === 2 && value.range.every(isPair)
    && (value.shape === undefined || value.shape === '' || typeof value.shape === 'string'
      && Object.prototype.hasOwnProperty.call(CLIPPATHS, value.shape))
}

function isShapePath(value: Record<string, unknown>): boolean {
  const { pathFormula, keypoints } = value
  if (pathFormula === undefined) return keypoints === undefined || isNumberList(keypoints)
  if (typeof pathFormula !== 'string' || !Object.prototype.hasOwnProperty.call(SHAPE_PATH_FORMULAS, pathFormula)) return false
  const formula = SHAPE_PATH_FORMULAS[pathFormula as ShapePathFormulasKeys]
  return keypoints === undefined || isNumberList(keypoints) && keypoints.length <= (formula.getBaseSize?.length ?? 0)
}

function isElement(value: unknown): value is Record<string, unknown> & { id: string } {
  if (!isObject(value) || !isId(value.id) || typeof value.type !== 'string' || !elementTypes.includes(value.type)
    || ![value.left, value.top, value.width].every(isNumber)) return false
  const { link } = value
  if (link !== undefined && (!isObject(link) || !(link.type === 'web' && isWebURL(link.target)
    || link.type === 'slide' && isId(link.target)))) return false

  if (value.type === 'line') {
    return isPair(value.start) && isPair(value.end) && isStringList(value.points) && value.points.length === 2
      && [value.broken, value.broken2, value.curve].every(point => point === undefined || isPair(point))
      && (value.cubic === undefined || Array.isArray(value.cubic) && value.cubic.length === 2 && value.cubic.every(isPair))
  }
  if (!isNumber(value.height) || !isNumber(value.rotate)) return false

  switch (value.type) {
    case 'text':
      return typeof value.content === 'string'
    case 'image':
      return isMediaSource(value.src) && (value.clip === undefined || isImageClip(value.clip))
    case 'audio':
      return isMediaSource(value.src)
    case 'video':
      return isMediaSource(value.src) && (value.poster === undefined || value.poster === '' || isMediaSource(value.poster))
    case 'shape':
      return isPair(value.viewBox) && typeof value.path === 'string' && isShapePath(value)
        && (value.text === undefined || isObject(value.text) && typeof value.text.content === 'string')
        && (value.gradient === undefined || isGradient(value.gradient))
        && (value.pattern === undefined || value.pattern === '' || isMediaSource(value.pattern))
    case 'latex':
      return isPair(value.viewBox) && typeof value.path === 'string' && typeof value.latex === 'string'
    case 'chart':
      return typeof value.chartType === 'string' && chartTypes.includes(value.chartType) && isObject(value.data) && isStringList(value.themeColors)
        && isStringList(value.data.labels) && isStringList(value.data.legends) && Array.isArray(value.data.series)
        && value.data.series.length > 0 && value.data.series.every(row => Array.isArray(row) && row.every(item => item === null || isNumber(item)))
    case 'table':
      return isTable(value)
    default:
      return false
  }
}

function checkSlides(slides: unknown[]): asserts slides is Slide[] {
  const slideIds = new Set<string>()
  for (const [index, slide] of slides.entries()) {
    if (!isObject(slide) || !isId(slide.id) || slideIds.has(slide.id) || !Array.isArray(slide.elements)) {
      throw new Error(`第 ${index + 1} 页的页面结构无效或 ID 重复`)
    }
    slideIds.add(slide.id)
    const elementIds = new Set<string>()
    for (const element of slide.elements) {
      if (!isElement(element) || elementIds.has(element.id)) throw new Error(`第 ${index + 1} 页的元素结构、链接或 ID 无效`)
      elementIds.add(element.id)
    }
    if (slide.animations !== undefined && (!Array.isArray(slide.animations) || !slide.animations.every(animation =>
      isObject(animation) && isId(animation.id) && isId(animation.elId) && typeof animation.effect === 'string'
      && typeof animation.type === 'string' && typeof animation.trigger === 'string' && isNumber(animation.duration)))) {
      throw new Error(`第 ${index + 1} 页的动画结构无效`)
    }
    if (slide.background !== undefined && !isBackground(slide.background)) throw new Error(`第 ${index + 1} 页的背景结构无效`)
    if (slide.remark !== undefined && typeof slide.remark !== 'string') throw new Error(`第 ${index + 1} 页的备注格式无效`)
    if (slide.notes !== undefined && (!Array.isArray(slide.notes) || !slide.notes.every(note =>
      isObject(note) && (note.replies === undefined || Array.isArray(note.replies) && note.replies.every(isObject))))) {
      throw new Error(`第 ${index + 1} 页的批注结构无效`)
    }
  }
}

function sanitizeMarkup(document: CoursewareDocument) {
  const sanitize = (value: string) => DOMPurify.sanitize(value, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['form', 'style', 'template'],
  })
  for (const slide of document.slides) {
    if (slide.remark) slide.remark = sanitize(slide.remark)
    for (const element of slide.elements) {
      if (element.type === 'text') element.content = sanitize(element.content)
      if (element.type === 'shape' && element.text) element.text.content = sanitize(element.text.content)
      if (element.type === 'table') {
        for (const row of element.data) {
          for (const cell of row) cell.text = sanitize(cell.text)
        }
      }
    }
  }
}

export function parseCoursewareDocument(text: string): CoursewareDocument {
  let value: unknown
  try {
    value = JSON.parse(text.replace(/^\uFEFF/, ''))
  }
  catch {
    throw new Error('无法解析课件 JSON，请检查文件内容')
  }
  if (isObject(value) && 'changes' in value && 'base_id' in value && !('document' in value)) {
    throw new Error('这是动画变更文件，请使用「导入动画变更」')
  }
  const document = isObject(value) && 'document' in value ? value.document : value
  if (!isObject(document) || document.format_version !== 1) throw new Error('请选择版本 1 的完整课件 JSON 文件')
  const { width, height, theme, slides } = document
  if (!isNumber(width) || !isNumber(height) || width <= 0 || height <= 0 || width > 10000 || height > 10000
    || !Number.isFinite(height / width) || height / width <= 0) throw new Error('课件画布宽高必须大于 0 且不超过 10000')
  if (!isTheme(theme)) throw new Error('课件主题格式无效')
  if (!Array.isArray(slides) || !slides.length || slides.length > 200) throw new Error('课件须包含 1–200 页')

  checkValues({ theme, slides })
  checkSlides(slides)
  // 历史课件可能只包含部分主题属性，缺省值来自编辑器的默认主题。
  for (const [key, fallback] of Object.entries(createDefaultSlideTheme())) {
    if (theme[key] === undefined) theme[key] = fallback
  }
  const result: CoursewareDocument = { format_version: 1, width, height, theme: theme as SlideTheme, slides }
  sanitizeMarkup(result)
  return result
}

export async function readCoursewareDocument(file: File) {
  if (!/\.json$/i.test(file.name) || file.size > maxFileSize) throw new Error('请选择不超过 100 MiB 的课件 JSON 文件')
  const text = await file.text().catch(() => {
    throw new Error('无法读取课件 JSON 文件，请重新选择')
  })
  return parseCoursewareDocument(text)
}
