// 래더 범위: 상위 N 또는 선택 종. 탭 계획·스피드 차트·판정 질의가 같은 범위를 쓴다.
import type { MetaEntry } from '../data/meta-schema'
import type { MetaView } from '../meta'
import type { CardFilters } from './types'

/** 선택 종이 있으면 그 종만(사용률 순), 없으면 사용률 상위 topN */
export function ladderInRange(view: MetaView, filters: CardFilters): MetaEntry[] {
  const selected = new Set(filters.selected)
  return selected.size > 0 ? view.ranking.filter((e) => selected.has(e.id)) : view.ranking.slice(0, filters.topN)
}

export interface LadderOpponent {
  entry: MetaEntry
  /** 범위 밖이지만 그 탭에 사용자 추가 배분이 있어 나타난 상대 */
  addedOnly: boolean
}

/** 사용률 순: 범위 안 상대 + 범위 밖이지만 hasAdded(id)인 상대(addedOnly). 추가 배분이 사라지면 함께 빠진다 */
export function ladderOpponents(view: MetaView, filters: CardFilters, hasAdded: (entryId: string) => boolean): LadderOpponent[] {
  const inRange = new Set(ladderInRange(view, filters).map((e) => e.id))
  const out: LadderOpponent[] = []
  for (const entry of view.ranking) {
    if (inRange.has(entry.id)) out.push({ entry, addedOnly: false })
    else if (hasAdded(entry.id)) out.push({ entry, addedOnly: true })
  }
  return out
}

/** 그 래더 상대가 범위 안인가 */
export const isInRange = (view: MetaView, filters: CardFilters, entryId: string): boolean => ladderInRange(view, filters).some((e) => e.id === entryId)
