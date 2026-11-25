import { defineStore } from 'pinia'
import type { Slide } from '@/types/slides'
import { db, type Snapshot } from '@/utils/database'

import { useSlidesStore } from './slides'
import { useMainStore } from './main'

export interface ScreenState {
  snapshotCursor: number
  snapshotLength: number
  snapshotGeneration: number
}

let snapshotWrites = Promise.resolve()

function writeSnapshots(write: () => Promise<void>) {
  const pending = snapshotWrites.then(write)
  snapshotWrites = pending.catch(() => {})
  return pending
}

export const useSnapshotStore = defineStore('snapshot', {
  state: (): ScreenState => ({
    snapshotCursor: -1, // 历史快照指针
    snapshotLength: 0, // 历史快照长度
    snapshotGeneration: 0,
  }),

  getters: {
    canUndo(state) {
      return state.snapshotCursor > 0
    },
    canRedo(state) {
      return state.snapshotCursor < state.snapshotLength - 1
    },
  },

  actions: {
    setSnapshotCursor(cursor: number) {
      this.snapshotCursor = cursor
    },
    setSnapshotLength(length: number) {
      this.snapshotLength = length
    },

    async initSnapshotDatabase() {
      const slidesStore = useSlidesStore()
      await this.resetSnapshotDatabase(slidesStore.slides, slidesStore.slideIndex)
    },

    resetSnapshotDatabase(slides: Slide[], index: number) {
      const initial = { index, slides: JSON.parse(JSON.stringify(slides)) }
      return writeSnapshots(async () => {
        await db.transaction('rw', db.snapshots, async () => {
          await db.snapshots.clear()
          await db.snapshots.add(initial)
        })
        this.snapshotGeneration++
        this.setSnapshotCursor(0)
        this.setSnapshotLength(1)
      })
    },

    addSnapshot(generation: number) {
      if (generation !== this.snapshotGeneration) return
      const slidesStore = useSlidesStore()
      const snapshot = {
        index: slidesStore.slideIndex,
        slides: JSON.parse(JSON.stringify(slidesStore.slides)),
      }
      return writeSnapshots(async () => {
        // 丢弃覆盖课件前防抖或排队的编辑快照。
        if (generation !== this.snapshotGeneration) return
        const length = await db.transaction('rw', db.snapshots, async () => {
          const keys = await db.snapshots.toCollection().primaryKeys()
          const previous = this.snapshotCursor < 0 ? keys.length - 1 : this.snapshotCursor
          const deleteKeys = keys.slice(previous + 1)
          const length = previous + 2
          if (length > 20) deleteKeys.push(keys[0])
          await db.snapshots.add(snapshot)
          // 撤销后维持操作开始时的页面焦点。
          if (previous >= 0) await db.snapshots.update(keys[previous], { index: snapshot.index })
          await db.snapshots.bulkDelete(deleteKeys)
          return Math.min(length, 20)
        })
        this.setSnapshotCursor(length - 1)
        this.setSnapshotLength(length)
      })
    },
  
    async unDo() {
      if (this.snapshotCursor <= 0) return

      const slidesStore = useSlidesStore()
      const mainStore = useMainStore()
  
      const snapshotCursor = this.snapshotCursor - 1
      const generation = this.snapshotGeneration
      const snapshots: Snapshot[] = await db.snapshots.orderBy('id').toArray()
      const snapshot = snapshots[snapshotCursor]
      if (!snapshot || generation !== this.snapshotGeneration) return
      const { index, slides } = snapshot
  
      const slideIndex = index > slides.length - 1 ? slides.length - 1 : index
  
      slidesStore.setSlides(slides)
      slidesStore.updateSlideIndex(slideIndex)
      this.setSnapshotCursor(snapshotCursor)
      mainStore.setActiveElementIdList([])
    },
  
    async reDo() {
      if (this.snapshotCursor >= this.snapshotLength - 1) return

      const slidesStore = useSlidesStore()
      const mainStore = useMainStore()
  
      const snapshotCursor = this.snapshotCursor + 1
      const generation = this.snapshotGeneration
      const snapshots: Snapshot[] = await db.snapshots.orderBy('id').toArray()
      const snapshot = snapshots[snapshotCursor]
      if (!snapshot || generation !== this.snapshotGeneration) return
      const { index, slides } = snapshot
  
      const slideIndex = index > slides.length - 1 ? slides.length - 1 : index
  
      slidesStore.setSlides(slides)
      slidesStore.updateSlideIndex(slideIndex)
      this.setSnapshotCursor(snapshotCursor)
      mainStore.setActiveElementIdList([])
    },
  },
})
