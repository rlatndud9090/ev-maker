// 판정 캐시. Map 삽입 순서를 최근 사용 순으로 쓰는 LRU.
import type { CompactCell, JudgementCache } from './types'

export const DEFAULT_CACHE_LIMIT = 5000

/** limit은 항목 수(정수 ≥ 1). 넘치면 가장 오래 쓰지 않은 항목부터 버린다. */
export function createLruCache(limit: number = DEFAULT_CACHE_LIMIT): JudgementCache {
  if (!Number.isInteger(limit) || limit < 1) throw new Error(`캐시 상한은 1 이상 정수여야 한다(받은 값: ${limit})`)
  const map = new Map<string, readonly CompactCell[]>()
  return {
    get(key) {
      const v = map.get(key)
      if (v !== undefined) {
        map.delete(key)
        map.set(key, v)
      }
      return v
    },
    set(key, cells) {
      map.delete(key)
      map.set(key, cells)
      while (map.size > limit) map.delete(map.keys().next().value as string)
    },
    clear() {
      map.clear()
    },
    get size() {
      return map.size
    },
  }
}
