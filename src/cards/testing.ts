/// <reference types="node" />
// 테스트 전용 픽스처. 앱 코드에서 import하지 않는다.
import { loadMetaSnapshotSync, loadSnapshotSync } from '../data/testing'
import type { MetaEntry, MetaSnapshot } from '../data/meta-schema'
import type { Snapshot } from '../data/schema'
import type { PokemonSet } from '../core'
import { createMetaView } from '../meta'
import type { MetaView } from '../meta'
import { DEFAULT_CRITERIA, DEFAULT_TOP_N } from './types'
import type { CardInput } from './types'

let cached: { game: Snapshot; bo1: MetaView; bo3: MetaView } | undefined

/** 기본 레귤레이션 스냅샷과 그 Bo1·Bo3 기본 메타 뷰(모듈 수준 캐시). */
export function realData(): { game: Snapshot; bo1: MetaView; bo3: MetaView } {
  if (cached) return cached
  const game = loadSnapshotSync()
  const regulation = game.manifest.regulation.id
  cached = {
    game,
    bo1: createMetaView(loadMetaSnapshotSync({ regulation, match: 'bo1' }), game),
    bo3: createMetaView(loadMetaSnapshotSync({ regulation, match: 'bo3' }), game),
  }
  return cached
}

/** base를 깊은 복제한 뒤 patch 필드를 덮어쓴다. */
export function syntheticEntry(base: MetaEntry, patch: Partial<MetaEntry>): MetaEntry {
  return { ...structuredClone(base), ...patch }
}

/** entries로 base 메타를 대체한 뷰. rank는 사용률 내림차순·동률 id 순으로 1부터 다시 매긴다. */
export function syntheticView(game: Snapshot, base: MetaSnapshot, entries: MetaEntry[]): MetaView {
  const ranked = [...entries]
    .sort((a, b) => b.usage - a.usage || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((e, i) => ({ ...e, rank: i + 1 }))
  return createMetaView({ ...base, entries: ranked }, game)
}

/** 기본값: 실데이터 Bo1·DEFAULT_CRITERIA·상위 DEFAULT_TOP_N·선택 없음·순풍 off·커스텀 없음. */
export function cardInput(partial: Partial<CardInput> & { mySet: PokemonSet }): CardInput {
  const { game, bo1 } = realData()
  return {
    game,
    view: bo1,
    conditions: { myTailwind: false, opponentTailwind: false },
    criteria: { ...DEFAULT_CRITERIA },
    filters: { topN: DEFAULT_TOP_N, selected: [] },
    customTargets: [],
    ...partial,
  }
}
