// 공격·방어 고정 레인: 대상 상대 하나만 계획하는 미니 입력, 레인 작업, 결과 → 고정 해석, 기준 갈래 계획 입력. 판정은 하지 않는다.
import { TIER_ORDER, tierRank } from '../core'
import type { CutLock, LockDerivation, LockOptions, LockResolution, Stairs } from './lock'
import type { LockTargetRef } from './lockTarget'
import { taskKey } from './schedule'
import type { CardInput, CompactCell, ResultMap, RowTask, TabPlan } from './types'

/** 고정 대상 상대 하나만 계획하는 입력(상위 N·선택 필터 밖 래더 상대도 계획된다). 스피드 고정은 레인이 없다 */
export function laneInput(input: CardInput, lock: Pick<CutLock, 'target'>): CardInput {
  const t = lock.target
  if (t.kind === 'speed') throw new Error('스피드 고정은 고정 레인이 없다')
  return {
    ...input,
    filters: { topN: input.filters.topN, selected: [t.opponentId] },
    customTargets: t.source === 'custom' ? input.customTargets.filter((c) => c.rosterId === t.opponentId) : [],
    lock: { mode: 'lane' },
  }
}

/** 방어 H 최대 고정의 단계 정확 검사용 한 단계 위 순위(없으면 null) */
function upperRank(lock: Pick<CutLock, 'stage' | 'allocation'>): number | null {
  if (lock.allocation !== 'h-max') return null
  const up = tierRank('defense', lock.stage) + 1
  return up < TIER_ORDER.defense.length ? up : null
}

/**
 * 공격 = 대상 행의 엄격 두 변형 재스윕, 방어 = 대상 필터의 고정 단계 계단(H 0부터) × 엄격 두 성격.
 * 방어 H 최대 고정(위 단계가 있을 때)은 같은 두 성격의 한 단계 위 계단을 더한다
 */
export function laneTasks(plan: TabPlan, lock: Pick<CutLock, 'stage' | 'allocation'>, target: LockTargetRef): RowTask[] {
  if ('rowId' in target) {
    const strict = plan.rows[target.rowId]?.lock?.strict
    if (strict === undefined) return []
    return [strict.neutral, strict.plus].filter((n): n is string => n !== null).map((nature) => ({ kind: 'branch', rowId: target.rowId, nature }))
  }
  const strict = plan.filters[target.filterId]?.lock?.strict
  if (strict === undefined) return []
  const rank = tierRank('defense', lock.stage)
  const up = upperRank(lock)
  const natures = [strict.neutral, strict.plus].filter((n): n is string => n !== null)
  const tasks: RowTask[] = natures.map((nature) => ({ kind: 'stairs', filterId: target.filterId, nature, rank, hpMin: 0 }))
  if (up !== null) for (const nature of natures) tasks.push({ kind: 'stairs', filterId: target.filterId, nature, rank: up, hpMin: 0 })
  return tasks
}

const minSpAt = (cells: readonly CompactCell[], rank: number): number | null =>
  cells.find((c) => (TIER_ORDER.attack as readonly string[]).includes(c.category) && tierRank('attack', c.category) >= rank)?.sp ?? null

const reachable = (s: Stairs): boolean => s.some((v) => v !== null)

type Picked<T> = { value: T | null } | { error: string }

/**
 * 레인 결과 → 고정 해석. results에는 laneTasks의 결과가 모두 있어야 한다(없으면 예외).
 * 코어 오류 결과는 unreachable(reason = 오류 문구), 비단조 계단은 unreachable(reason 'non-monotonic')이다.
 */
export function laneResolution(plan: TabPlan, lock: Pick<CutLock, 'stage' | 'allocation'>, target: LockTargetRef | null, results: ResultMap): LockResolution {
  if (plan.status.kind === 'my-set-error') return { kind: 'set-error' }
  if (target === null) return { kind: 'missing' }
  const get = (t: RowTask) => {
    const r = results.get(taskKey(t))
    if (r === undefined) throw new Error(`레인 작업 ${taskKey(t)}의 결과가 없다`)
    return r
  }
  const settle = <T>(neutral: Picked<T>, plus: Picked<T>, ok: (n: T | null, p: T | null) => LockResolution): LockResolution => {
    if ('error' in neutral) return { kind: 'unreachable', reason: neutral.error }
    if ('error' in plus) return { kind: 'unreachable', reason: plus.error }
    if (neutral.value === null && plus.value === null) return { kind: 'unreachable' }
    return ok(neutral.value, plus.value)
  }
  if ('rowId' in target) {
    const spec = plan.rows[target.rowId]
    if (spec?.lock === undefined || spec.sweep === undefined) return { kind: 'missing' }
    const stat = spec.sweep.stat
    const rank = tierRank('attack', lock.stage)
    const pick = (nature: string | null): Picked<number> => {
      if (nature === null) return { value: null }
      const r = get({ kind: 'branch', rowId: target.rowId, nature })
      if (r.kind === 'error') return { error: r.reason.message }
      if (r.kind !== 'branch') throw new Error(`레인 작업 결과 종류가 ${r.kind}다`)
      return { value: minSpAt(r.cells, rank) }
    }
    return settle(pick(spec.lock.strict.neutral), pick(spec.lock.strict.plus), (neutral, plus) => ({ kind: 'ok', options: { shape: 'single', stat, neutral, plus } }))
  }
  const spec = plan.filters[target.filterId]
  if (spec?.lock === undefined) return { kind: 'missing' }
  const defense = spec.stats[1]
  const rank = tierRank('defense', lock.stage)
  const pickAt = (nature: string | null, at: number): Picked<Stairs> => {
    if (nature === null) return { value: null }
    const r = get({ kind: 'stairs', filterId: target.filterId, nature, rank: at, hpMin: 0 })
    if (r.kind === 'error') return { error: r.reason.message }
    if (r.kind !== 'stairs') throw new Error(`레인 작업 결과 종류가 ${r.kind}다`)
    if (r.stairs === 'non-monotonic') return { error: 'non-monotonic' }
    return { value: reachable(r.stairs) ? r.stairs : null }
  }
  const { neutral: nn, plus: pn } = spec.lock.strict
  const up = upperRank(lock)
  return settle(pickAt(nn, rank), pickAt(pn, rank), (neutral, plus) => {
    const options: Extract<LockOptions, { shape: 'pair' }> = { shape: 'pair', defense, neutral, plus }
    if (up !== null) {
      // 위 단계 계단이 오류면 next를 두지 않는다(H 최대를 검사할 수 없어 합 최소로 둔다)
      const n = pickAt(nn, up)
      const p = pickAt(pn, up)
      if ('value' in n && 'value' in p) options.next = { neutral: n.value, plus: p.value }
    }
    return { kind: 'ok', options }
  })
}

/** 기준 갈래 계획 입력: 고정 능력치 SP = 기준 갈래 고정 SP, 성격 = 기준 갈래 성격. 기준 갈래가 없으면 입력 그대로(고정 없는 경로) */
export function lockedInput(input: CardInput, derivation: LockDerivation): CardInput {
  const base = derivation.branches.find((b) => b.id === derivation.baseId)
  if (base === undefined) return input
  return {
    ...input,
    mySet: { ...input.mySet, nature: base.nature, sp: { ...input.mySet.sp, ...base.lockedSp } },
    lock: { mode: 'main', derivation, base },
  }
}
