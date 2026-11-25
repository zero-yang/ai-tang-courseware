import { debounce, throttle} from 'lodash'
import { useSnapshotStore } from '@/store'

export default () => {
  const snapshotStore = useSnapshotStore()

  // 添加历史快照(历史记录)
  const addSnapshot = debounce(function(generation: number) {
    snapshotStore.addSnapshot(generation)
  }, 300, { trailing: true })
  const addHistorySnapshot = () => addSnapshot(snapshotStore.snapshotGeneration)

  // 重做
  const redo = throttle(function() {
    snapshotStore.reDo()
  }, 100, { leading: true, trailing: false })

  // 撤销
  const undo = throttle(function() {
    snapshotStore.unDo()
  }, 100, { leading: true, trailing: false })

  return {
    addHistorySnapshot,
    redo,
    undo,
  }
}
