// R14 도구 아이콘 대상 집합. 검사 전용(앱 런타임은 쓰지 않는다). 가정 세트·스카프·프리셋 규칙은 앱과 같은 함수를 부른다.
import type { MetaSnapshot } from '../data/meta-schema'
import type { Snapshot } from '../data/schema'
import { RESIST_BERRIES } from './berries'
import { POWER_ITEMS } from './powerItems'
import { presetAssumption } from './presets'
import { ladderBaseSet, scarfConditionOf } from './speedChart'
import type { Category, PresetIndex, Tab } from './types'

/** 집합에 넣은 근거. existing = 반감열매·화력 도구, ladder-set = 래더 가정 세트 도구(메가스톤 포함) */
export type IconTargetSource = 'existing' | 'ladder-set' | 'scarf' | 'non-scarf' | 'preset'

const SCARF = 'choicescarf'
const PRESETS: readonly PresetIndex[] = [0, 1, 2]
const PRESET_ROWS: readonly (readonly [Tab, Category | null])[] = [
  ['attack', 'physical'],
  ['attack', 'special'],
  ['defense', 'physical'],
  ['defense', 'special'],
  ['speed', null],
]

/**
 * game 한 레귤레이션의 대상 집합: 도구 id → 근거(정렬). metas는 그 레귤레이션에 번들된 모든 메타 선택(월·매치 방식)이고
 * 상위 N과 무관하게 전 항목을 본다. 스카프 기준값과 무관하게 "될 수 있는" 도구를 모으려고 기준 0으로 부른다.
 */
export function iconTargets(game: Snapshot, metas: readonly MetaSnapshot[]): ReadonlyMap<string, readonly IconTargetSource[]> {
  const out = new Map<string, Set<IconTargetSource>>()
  const add = (id: string | null | undefined, source: IconTargetSource) => {
    if (id === null || id === undefined) return
    const s = out.get(id) ?? new Set<IconTargetSource>()
    s.add(source)
    out.set(id, s)
  }

  for (const id of [...Object.keys(RESIST_BERRIES), ...POWER_ITEMS]) add(id, 'existing')
  add(SCARF, 'scarf')

  for (const meta of metas) {
    for (const entry of meta.entries) {
      const { set } = ladderBaseSet(game, entry)
      add(set.item, 'ladder-set')
      if (entry.mega !== undefined) continue
      const scarf = scarfConditionOf(entry, set.item, 0)
      if (scarf?.kind === 'scarf') add(SCARF, 'scarf')
      else if (scarf?.kind === 'non-scarf') add(scarf.item, 'non-scarf')
    }
  }

  for (const rosterId of Object.keys(game.data.species)) {
    for (const [tab, category] of PRESET_ROWS) {
      for (const preset of PRESETS) add(presetAssumption(game, rosterId, [], tab, category, preset).set.item, 'preset')
    }
  }

  return new Map([...out].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([id, s]) => [id, [...s].sort()]))
}
