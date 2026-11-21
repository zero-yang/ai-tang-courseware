import type { PPTElement } from '@/types/slides'
import type { CoursewareDocument } from './api'

function editableElement(element: PPTElement) {
  // 渲染画布会重新测量表格高度，以及自适应文本框的高度或宽度。
  if (element.type === 'table') return { ...element, height: undefined }
  if (element.type === 'text' && !element.fixedHeight) {
    if (element.vertical) return { ...element, width: undefined }
    return { ...element, height: undefined }
  }
  return element
}

export function getEditableSnapshot(document: CoursewareDocument) {
  return JSON.stringify({
    ...document,
    slides: document.slides.map(slide => ({ ...slide, elements: slide.elements.map(editableElement) })),
  })
}
