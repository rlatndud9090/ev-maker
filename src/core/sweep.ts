// SP 0~최대 스윕. 칸 판정 함수를 받아 칸 결과와 경계(구간이 sp−1과 다른 sp)를 만든다.
import type { Snapshot, StatId } from '../data/schema'
import type {
  BandThresholds,
  BattleConditions,
  DamageResult,
  EvalOptions,
  PokemonSet,
  SpeedResult,
  SweepCell,
  SweepOptions,
  SweepResult,
} from './types'
import { CoreInputError, oneOf } from './errors'
import { remainingBudget, validateSet, withSp } from './set'
import { calcDamage } from './damage'
import { compareSpeed } from './speed'
import { attackBand, defenseBand, normalizeRollSteps, rollTier } from './bands'
import { STAT_IDS } from './stats'

export interface CellJudgement<T> {
  value: T
  category: string
}

const IGNORE_TOTAL: EvalOptions = { ignoreSpTotal: true }
const cellOptions = (overBudget: boolean): EvalOptions | undefined => (overBudget ? IGNORE_TOTAL : undefined)

/**
 * set의 stat만 바꿔 가며 judge를 부른다. 다른 능력치와 합쳐 SP 합계 상한을 넘는 칸은 기본적으로 판정하지 않고,
 * judgeOverBudget이면 그 칸도 judge(세 번째 인자 true)해 overBudget: true를 단다.
 */
export function sweep<T>(
  snapshot: Snapshot,
  set: PokemonSet,
  stat: StatId,
  judge: (cellSet: PokemonSet, sp: number, overBudget: boolean) => CellJudgement<T>,
  options?: SweepOptions,
): SweepResult<T> {
  oneOf(stat, STAT_IDS, 'stat')
  const judgeOver = options?.judgeOverBudget === true
  validateSet(snapshot, set, judgeOver ? IGNORE_TOTAL : undefined)
  const remaining = remainingBudget(snapshot, set, stat)
  const cells: SweepCell<T>[] = []
  for (let sp = 0; sp <= snapshot.manifest.rules.spMaxPerStat; sp++) {
    const over = sp > remaining
    if (over && !judgeOver) {
      cells.push({ sp, kind: 'over-budget' })
    } else {
      const { value, category } = judge(withSp(set, stat, sp), sp, over)
      cells.push(over ? { sp, kind: 'ok', value, category, overBudget: true } : { sp, kind: 'ok', value, category })
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

/** 공격측은 바디프레스의 방어, 방어측은 속임수의 공격까지 포함한 합집합 */
const ATTACK_STATS: readonly StatId[] = ['atk', 'spa', 'def']
const DEFENSE_STATS: readonly StatId[] = ['hp', 'def', 'spd', 'atk']

/** rollSteps를 주면 칸 범주가 3단 구간 대신 5단 판정(rollTier)이 된다(공격·방어 같은 척도). */
export interface DamageCategoryOptions {
  rollSteps?: number
}

function categoryOf(side: 'attacker' | 'defender', chance: number, thresholds: Partial<BandThresholds> | undefined, rollSteps: number | undefined): string {
  if (rollSteps !== undefined) return rollTier(chance, rollSteps)
  return side === 'attacker' ? attackBand(chance, thresholds) : defenseBand(chance, thresholds)
}

export interface DamageSweepTarget {
  side: 'attacker' | 'defender'
  stat: StatId
}

/**
 * 대미지 단건 판정. side 'attacker'는 공격 관점 구간, 'defender'는 방어 관점 구간을 범주로 쓴다(options.rollSteps면 5단 판정).
 * 면역은 1타 확률 0의 구간으로 매긴다. 변화기는 판정 대상이 아니라 거부한다.
 */
export function judgeDamage(
  snapshot: Snapshot,
  side: 'attacker' | 'defender',
  attacker: PokemonSet,
  defender: PokemonSet,
  moveId: string,
  conditions?: BattleConditions,
  thresholds?: Partial<BandThresholds>,
  options?: EvalOptions & DamageCategoryOptions,
): CellJudgement<DamageResult> {
  const s = oneOf(side, ['attacker', 'defender'] as const, 'side')
  const steps = options?.rollSteps === undefined ? undefined : normalizeRollSteps(options.rollSteps)
  const r = calcDamage(snapshot, attacker, defender, moveId, conditions, thresholds, options)
  if (r.kind === 'status') throw new CoreInputError('move', `${moveId}은 변화기라 대미지 판정을 할 수 없다`)
  const chance = r.kind === 'damage' ? r.ohkoChance : 0
  return { value: r, category: categoryOf(s, chance, thresholds, steps) }
}

/** 행동 순서(first/tie/second) 단건 판정. set이 a(attacker 쪽 조건)다. */
export function judgeSpeed(
  snapshot: Snapshot,
  set: PokemonSet,
  opponent: PokemonSet,
  conditions?: BattleConditions,
  options?: EvalOptions,
): CellJudgement<SpeedResult> {
  const r = compareSpeed(snapshot, set, opponent, conditions, options)
  return { value: r, category: r.order }
}

/** target.side 쪽 세트의 target.stat을 스윕한다. 칸 범주는 judgeDamage와 같다. */
export function sweepDamage(
  snapshot: Snapshot,
  target: DamageSweepTarget,
  attacker: PokemonSet,
  defender: PokemonSet,
  moveId: string,
  conditions?: BattleConditions,
  thresholds?: Partial<BandThresholds>,
  options?: SweepOptions & DamageCategoryOptions,
): SweepResult<DamageResult> {
  const side = oneOf(target?.side, ['attacker', 'defender'] as const, 'target.side')
  const allowed = side === 'attacker' ? ATTACK_STATS : DEFENSE_STATS
  const stat = oneOf(target.stat, allowed, 'target.stat')
  const tier: DamageCategoryOptions = options?.rollSteps === undefined ? {} : { rollSteps: normalizeRollSteps(options.rollSteps) }
  const opts = (over: boolean): EvalOptions & DamageCategoryOptions => ({ ...cellOptions(over), ...tier })
  return side === 'attacker'
    ? sweep(snapshot, attacker, stat, (a, _sp, over) => judgeDamage(snapshot, side, a, defender, moveId, conditions, thresholds, opts(over)), options)
    : sweep(snapshot, defender, stat, (d, _sp, over) => judgeDamage(snapshot, side, attacker, d, moveId, conditions, thresholds, opts(over)), options)
}

/** set의 스피드 SP를 스윕하며 opponent와의 행동 순서(first/tie/second)를 범주로 쓴다. */
export function sweepSpeed(
  snapshot: Snapshot,
  set: PokemonSet,
  opponent: PokemonSet,
  conditions?: BattleConditions,
  options?: SweepOptions,
): SweepResult<SpeedResult> {
  return sweep(snapshot, set, 'spe', (s, _sp, over) => judgeSpeed(snapshot, s, opponent, conditions, cellOptions(over)), options)
}
