// 기술이 대미지 계산에서 참조하는 능력치. 엔진(@smogon/calc 0.12.0 mechanics/champions)의 판별을 그대로 옮긴다.
import type { Snapshot, StatId } from '../data/schema'
import { coreError, hasOwn } from './errors'
import { SPEED_DEPENDENT_MOVES, engineMoveOverrides } from './engine'
import type { MoveStatRefs } from './types'

type Offense = NonNullable<MoveStatRefs['offense']>

/** 엔진이 기술 이름으로 공격 능력치·주체를 바꾸는 기술(move.named('Foul Play' | 'Body Press')). */
export const OFFENSE_BY_NAME: Readonly<Record<string, Offense>> = {
  foulplay: { owner: 'target', stat: 'atk' },
  bodypress: { owner: 'self', stat: 'def' },
}

/** 엔진이 능력치 비교로 분류를 바꾸는 기술(move.named('Shell Side Arm')). */
export const CATEGORY_VARIES: readonly string[] = ['shellsidearm']

/** 대미지가 사용자 HP 실수치로 정해지는 기술. 현재/최대 HP 비율 기술(분출·바둥바둥 등)은 앱이 만피로 계산해 HP SP와 무관하다(섭동 테스트가 지킨다). */
export const ATTACKER_HP_MOVES: readonly string[] = ['finalgambit']

const uniq = (xs: StatId[]): StatId[] => [...new Set(xs)]

/** 스냅샷 기술 id → 참조 능력치. 스냅샷에 없는 기술은 CoreError UNKNOWN_MOVE. */
export function moveStatRefs(snapshot: Snapshot, moveId: string): MoveStatRefs {
  if (typeof moveId !== 'string' || !hasOwn(snapshot.data.moves, moveId)) {
    throw coreError('UNKNOWN_MOVE', 'move', `기술 ${String(moveId)}이 레귤레이션에 없다`)
  }
  const { category } = snapshot.data.moves[moveId]
  const speedDependent = SPEED_DEPENDENT_MOVES.includes(moveId)
  const categoryVaries = CATEGORY_VARIES.includes(moveId)
  if (category === 'Status') {
    return { moveId, category, offense: null, defense: null, categoryVaries, speedDependent, attackerStats: [], defenderStats: ['hp'] }
  }
  // 엔진 미지원 기술은 엔진 표시가 없으므로 분류만으로 정한다(계산은 assertMoveUsable이 거부한다).
  const overrides = snapshot.manifest.engineUnsupported.moves.includes(moveId) ? {} : engineMoveOverrides(moveId)
  const defense = overrides.defensiveStat === 'def' || category === 'Physical' ? 'def' : 'spd'
  const offense: Offense = OFFENSE_BY_NAME[moveId] ?? { owner: 'self', stat: category === 'Physical' ? 'atk' : 'spa' }

  const attackerStats: StatId[] = []
  const defenderStats: StatId[] = ['hp', defense]
  if (offense.owner === 'self') attackerStats.push(offense.stat)
  else defenderStats.push(offense.stat)
  if (ATTACKER_HP_MOVES.includes(moveId)) attackerStats.push('hp')
  if (categoryVaries) {
    attackerStats.push('atk', 'spa', 'def', 'spd')
    defenderStats.push('atk', 'spa', 'def', 'spd')
  }
  if (speedDependent) {
    attackerStats.push('spe')
    defenderStats.push('spe')
  }
  return {
    moveId,
    category,
    offense,
    defense,
    categoryVaries,
    speedDependent,
    attackerStats: uniq(attackerStats),
    defenderStats: uniq(defenderStats),
  }
}
