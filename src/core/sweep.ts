// SP 0~최대 스윕. 칸 판정 함수를 받아 칸 결과와 경계(구간이 sp−1과 다른 sp)를 만든다.
import type { Snapshot, StatId } from '../data/schema'
import type { BandThresholds, BattleConditions, DamageResult, PokemonSet, SpeedResult, SweepCell, SweepResult } from './types'
import { CoreInputError, oneOf } from './errors'
import { remainingBudget, validateSet, withSp } from './set'
import { calcDamage } from './damage'
import { compareSpeed } from './speed'
import { attackBand, defenseBand } from './bands'
import { STAT_IDS } from './stats'

export interface CellJudgement<T> {
  value: T
  category: string
}

/** set의 stat만 바꿔 가며 judge를 부른다. 다른 능력치와 합쳐 SP 합계 상한을 넘는 칸은 판정하지 않는다. */
export function sweep<T>(
  snapshot: Snapshot,
  set: PokemonSet,
  stat: StatId,
  judge: (cellSet: PokemonSet, sp: number) => CellJudgement<T>,
): SweepResult<T> {
  oneOf(stat, STAT_IDS, 'stat')
  validateSet(snapshot, set)
  const remaining = remainingBudget(snapshot, set, stat)
  const cells: SweepCell<T>[] = []
  for (let sp = 0; sp <= snapshot.manifest.rules.spMaxPerStat; sp++) {
    if (sp > remaining) {
      cells.push({ sp, kind: 'over-budget' })
    } else {
      const { value, category } = judge(withSp(set, stat, sp), sp)
      cells.push({ sp, kind: 'ok', value, category })
    }
  }
  return { cells, boundaries: boundariesOf(cells) }
}

export function boundariesOf<T>(cells: SweepCell<T>[]): number[] {
  const out: number[] = []
  for (let i = 1; i < cells.length; i++) {
    const prev = cells[i - 1]
    const cur = cells[i]
    if (prev.kind === 'ok' && cur.kind === 'ok' && prev.category !== cur.category) out.push(cur.sp)
  }
  return out
}

const ATTACK_STATS: readonly StatId[] = ['atk', 'spa']
const DEFENSE_STATS: readonly StatId[] = ['hp', 'def', 'spd']

export interface DamageSweepTarget {
  side: 'attacker' | 'defender'
  stat: StatId
}

/**
 * 공격측 공격·특공 스윕은 공격 관점 구간, 방어측 HP·방어·특방 스윕은 방어 관점 구간을 범주로 쓴다.
 * 면역 칸은 1타 확률 0의 구간으로 매긴다. 변화기는 판정 대상이 아니라 거부한다.
 */
export function sweepDamage(
  snapshot: Snapshot,
  target: DamageSweepTarget,
  attacker: PokemonSet,
  defender: PokemonSet,
  moveId: string,
  conditions?: BattleConditions,
  thresholds?: Partial<BandThresholds>,
): SweepResult<DamageResult> {
  const side = oneOf(target?.side, ['attacker', 'defender'] as const, 'target.side')
  const allowed = side === 'attacker' ? ATTACK_STATS : DEFENSE_STATS
  const stat = oneOf(target.stat, allowed, 'target.stat')
  const run = (a: PokemonSet, d: PokemonSet): CellJudgement<DamageResult> => {
    const r = calcDamage(snapshot, a, d, moveId, conditions, thresholds)
    if (r.kind === 'status') throw new CoreInputError('move', `${moveId}은 변화기라 대미지 스윕을 할 수 없다`)
    const chance = r.kind === 'damage' ? r.ohkoChance : 0
    return { value: r, category: side === 'attacker' ? attackBand(chance, thresholds) : defenseBand(chance, thresholds) }
  }
  return side === 'attacker'
    ? sweep(snapshot, attacker, stat, (a) => run(a, defender))
    : sweep(snapshot, defender, stat, (d) => run(attacker, d))
}

/** set의 스피드 SP를 스윕하며 opponent와의 행동 순서(first/tie/second)를 범주로 쓴다. */
export function sweepSpeed(
  snapshot: Snapshot,
  set: PokemonSet,
  opponent: PokemonSet,
  conditions?: BattleConditions,
): SweepResult<SpeedResult> {
  return sweep(snapshot, set, 'spe', (s) => {
    const r = compareSpeed(snapshot, s, opponent, conditions)
    return { value: r, category: r.order }
  })
}
