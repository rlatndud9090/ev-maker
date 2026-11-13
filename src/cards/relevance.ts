// 판정이 의존하는 능력치(관여 능력치). 캐시 키와 드래그 "갱신 대기"가 같은 규칙을 쓴다.
import { SPEED_DEPENDENT_ATTACKER_ABILITIES, STAT_IDS, type MoveStatRefs } from '../core'
import type { StatId } from '../data/schema'
import type { RowSpec } from './types'

export interface RelevantStats {
  attacker: readonly StatId[]
  defender: readonly StatId[]
}

const ordered = (stats: Iterable<StatId>): StatId[] => {
  const set = new Set(stats)
  return STAT_IDS.filter((s) => set.has(s))
}

/**
 * damage: 공격측 = refs.attackerStats, 방어측 = refs.defenderStats ∪ {hp}. 스피드 의존 기술이거나
 * 공격측 계산 특성이 스피드 의존 특성이면 양쪽에 spe를 더한다. refs가 없으면 모든 능력치(보수적).
 * speed: 양쪽 spe.
 */
export function relevantStats(
  judge: 'damage' | 'speed',
  refs: MoveStatRefs | undefined,
  attackerAbility?: string,
): RelevantStats {
  if (judge === 'speed') return { attacker: ['spe'], defender: ['spe'] }
  if (!refs) return { attacker: [...STAT_IDS], defender: [...STAT_IDS] }
  const attacker: StatId[] = [...refs.attackerStats]
  const defender: StatId[] = ['hp', ...refs.defenderStats]
  const speed =
    refs.speedDependent ||
    (attackerAbility !== undefined && (SPEED_DEPENDENT_ATTACKER_ABILITIES as readonly string[]).includes(attackerAbility))
  if (speed) {
    attacker.push('spe')
    defender.push('spe')
  }
  return { attacker: ordered(attacker), defender: ordered(defender) }
}

/** 내 쪽 관여 능력치에서 스윕 능력치와 exclude를 뺀 것(STAT_IDS 순). attackerAbility는 공격측 계산 특성. */
export function myDependsOn(
  spec: Pick<RowSpec, 'judge' | 'refs' | 'sweep'>,
  mySide: 'attacker' | 'defender',
  exclude: readonly StatId[] = [],
  attackerAbility?: string,
): StatId[] {
  const rel = relevantStats(spec.judge, spec.refs, attackerAbility)
  const drop = new Set<StatId>(exclude)
  if (spec.sweep) drop.add(spec.sweep.stat)
  return (mySide === 'attacker' ? rel.attacker : rel.defender).filter((s) => !drop.has(s))
}
