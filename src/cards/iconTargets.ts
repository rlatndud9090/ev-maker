// R14 도구 아이콘 대상 집합 = 화면이 아이콘으로 표시할 수 있는 "판정에 관여하는 도구". 검사 전용(앱 런타임은 쓰지 않는다).
// 가정 세트·프리셋 규칙과 스피드 지원 판정은 앱과 같은 함수를 부른다.
import { SPEED_ITEM_MODIFIERS, speedSupport, type PokemonSet } from '../core'
import type { MetaSnapshot } from '../data/meta-schema'
import type { Snapshot } from '../data/schema'
import { RESIST_BERRIES } from './berries'
import { POWER_ITEMS } from './powerItems'
import { presetAssumption } from './presets'
import { ladderBaseSet } from './speedChart'
import type { PresetIndex } from './types'

/**
 * 집합에 넣은 근거. existing = 반감열매·화력 도구(공격·방어 변형 줄), speed-item = 스피드 배수를 거는 도구(core 표),
 * speed-rejection = 래더 가정 세트·목록 밖 타겟 스피드 프리셋에서 순서 비교 불가의 원인이 된 도구
 */
export type IconTargetSource = 'existing' | 'speed-item' | 'speed-rejection'

const PRESETS: readonly PresetIndex[] = [0, 1, 2]

/** 스피드 비교 거부 원인이 도구면 그 도구 */
function rejectedItem(game: Snapshot, set: PokemonSet): string | undefined {
  try {
    const r = speedSupport(game, set)
    return r?.field === 'item' ? r.id : undefined
  } catch {
    return undefined
  }
}

/**
 * game 한 레귤레이션의 대상 집합: 도구 id → 근거(정렬). metas는 그 레귤레이션에 번들된 모든 메타 선택(월·매치 방식)이고
 * 상위 N과 무관하게 전 항목을 본다.
 */
export function iconTargets(game: Snapshot, metas: readonly MetaSnapshot[]): ReadonlyMap<string, readonly IconTargetSource[]> {
  const out = new Map<string, Set<IconTargetSource>>()
  const add = (id: string | undefined, source: IconTargetSource) => {
    if (id === undefined) return
    const s = out.get(id) ?? new Set<IconTargetSource>()
    s.add(source)
    out.set(id, s)
  }

  for (const id of [...Object.keys(RESIST_BERRIES), ...POWER_ITEMS]) add(id, 'existing')
  for (const id of Object.keys(SPEED_ITEM_MODIFIERS)) add(id, 'speed-item')

  for (const meta of metas) {
    for (const entry of meta.entries) add(rejectedItem(game, ladderBaseSet(game, entry).set), 'speed-rejection')
  }

  for (const rosterId of Object.keys(game.data.species)) {
    for (const preset of PRESETS) add(rejectedItem(game, presetAssumption(game, rosterId, [], 'speed', null, preset).set), 'speed-rejection')
  }

  return new Map([...out].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([id, s]) => [id, [...s].sort()]))
}
