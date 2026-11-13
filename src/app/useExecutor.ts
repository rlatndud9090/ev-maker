// 실행기를 컴포넌트 수명에 묶고 스냅샷을 구독한다.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createExecutor } from './executor'
import type { Executor, ExecutorSnapshot } from './executor'
import { createBrowserScheduler } from './scheduler'

export function useExecutor(): { executor: Executor; snapshot: ExecutorSnapshot } {
  const [executor] = useState(() => createExecutor({ scheduler: createBrowserScheduler() }))
  const pendingDispose = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    // StrictMode의 개발용 언마운트→재마운트는 같은 실행기를 다시 쓰므로 해제를 한 틱 미뤘다가 취소한다.
    if (pendingDispose.current !== null) clearTimeout(pendingDispose.current)
    pendingDispose.current = null
    return () => {
      pendingDispose.current = setTimeout(() => executor.dispose(), 0)
    }
  }, [executor])
  const snapshot = useSyncExternalStore(executor.subscribe, executor.getSnapshot)
  return { executor, snapshot }
}
