import { embedded, readOnly, send } from '@/embed/bridge'
import { useScreenStore, useSlidesStore } from '@/store'
import { enterFullscreen, exitFullscreen, isFullscreen } from '@/utils/fullscreen'

export default () => {
  const screenStore = useScreenStore()
  const slidesStore = useSlidesStore()

  // 进入放映状态（从当前页开始）
  const enterScreening = () => {
    if (embedded && !readOnly) {
      send('PREVIEW', { document: JSON.parse(JSON.stringify({ format_version: 1, title: slidesStore.title,
        width: slidesStore.viewportSize, height: slidesStore.viewportSize * slidesStore.viewportRatio,
        theme: slidesStore.theme, slides: slidesStore.slides })),
      startIndex: slidesStore.slideIndex })
      return
    }
    if (!embedded) enterFullscreen()
    screenStore.setScreening(true)
  }

  // 进入放映状态（从第一页开始）
  const enterScreeningFromStart = () => {
    const previousIndex = slidesStore.slideIndex
    slidesStore.updateSlideIndex(0)
    enterScreening()
    if (embedded && !readOnly) slidesStore.updateSlideIndex(previousIndex)
  }

  // 退出放映状态
  const exitScreening = () => {
    if (embedded && readOnly) {
      send('CLOSE_PREVIEW')
      return
    }
    screenStore.setScreening(false)
    if (isFullscreen()) exitFullscreen()
  }

  return {
    enterScreening,
    enterScreeningFromStart,
    exitScreening,
  }
}