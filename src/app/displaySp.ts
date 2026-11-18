// SP 드래그 중 표시 SP 구독 저장소. 구독한 컴포넌트(스피드 차트)만 다시 그려 Workspace 전체가 드래그마다 다시 그려지지 않게 한다.
import { useSyncExternalStore } from 'react'
import type { SpTable } from '../core'

export interface DisplaySpStore {
  /** null = 드래그 중 아님(확정 SP를 쓴다) */
  get(): SpTable | null
  set(sp: SpTable | null): void
  subscribe(listener: () => void): () => void
}

export function createDisplaySpStore(): DisplaySpStore {
  let current: SpTable | null = null
  const listeners = new Set<() => void>()
  return {
    get: () => current,
    set(sp) {
      if (sp === current) return
      current = sp
      for (const l of [...listeners]) l()
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

export function useDisplaySp(store: DisplaySpStore): SpTable | null {
  return useSyncExternalStore(store.subscribe, store.get, store.get)
}
