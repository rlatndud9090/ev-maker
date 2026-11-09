// 행 작업 하나를 코어 판정으로 계산한다. 범주는 코어가 낸 값을 그대로 옮긴다.
import { CoreError, CoreInputError, judgeDamage, judgeSpeed, sweepDamage, sweepSpeed } from '../core'
import type { CellJudgement, DamageResult, PokemonSet, SpeedResult, SweepResult } from '../core'
import type { StatId } from '../data/schema'
import { judgementKey } from './key'
import type { CompactCell, ErrorReason, JudgementCache, RowSpec, RowTask, RowTaskResult, TabPlan } from './types'

const IGNORE_TOTAL = { ignoreSpTotal: true } as const
const OVER_BUDGET = { judgeOverBudget: true } as const

function withSps(set: PokemonSet, stats: readonly StatId[], sp: number): PokemonSet {
  const next = { ...set.sp }
  for (const s of stats) next[s] = sp
  return { ...set, sp: next }
}

function compactDamage(sp: number, j: CellJudgement<DamageResult>): CompactCell {
  const v = j.value
  if (v.kind === 'damage') {
    return { sp, category: j.category, ohkoChance: v.ohkoChance, minPercent: v.minPercent, maxPercent: v.maxPercent }
  }
  return { sp, category: j.category, immune: true, ohkoChance: 0 }
}

function compactSpeed(plan: TabPlan, sp: number, j: CellJudgement<SpeedResult>): CompactCell {
  const mine = plan.mySide === 'attacker'
  return {
    sp,
    category: j.category,
    mySpeed: mine ? j.value.attackerSpeed : j.value.defenderSpeed,
    opponentSpeed: mine ? j.value.defenderSpeed : j.value.attackerSpeed,
  }
}

function compactSweep<T>(result: SweepResult<T>, toCell: (sp: number, j: CellJudgement<T>) => CompactCell): CompactCell[] {
  return result.cells.map((c) => {
    if (c.kind !== 'ok') throw new Error(`judgeOverBudget 스윕에 판정하지 않은 칸(sp ${c.sp})이 있다`)
    return toCell(c.sp, c)
  })
}

function rowSpec(plan: TabPlan, rowId: string): RowSpec & { sweep: NonNullable<RowSpec['sweep']> } {
  const spec = plan.rows[rowId]
  if (spec?.sweep === undefined) throw new Error(`행 ${rowId}에 스윕 대상이 없다`)
  return spec as RowSpec & { sweep: NonNullable<RowSpec['sweep']> }
}

/** 스윕 능력치를 0과 최대로 덮어쓴 두 판정. */
function computeEnds(plan: TabPlan, rowId: string): CompactCell[] {
  const spec = rowSpec(plan, rowId)
  const { side, stat } = spec.sweep
  return [0, plan.spMaxPerStat].map((sp) => {
    const a = side === 'attacker' ? withSps(spec.attacker, [stat], sp) : spec.attacker
    const d = side === 'defender' ? withSps(spec.defender, [stat], sp) : spec.defender
    if (spec.judge === 'speed') return compactSpeed(plan, sp, judgeSpeed(plan.game, a, d, spec.conditions, IGNORE_TOTAL))
    return compactDamage(sp, judgeDamage(plan.game, side, a, d, moveOf(spec), spec.conditions, undefined, IGNORE_TOTAL))
  })
}

function moveOf(spec: RowSpec): string {
  if (spec.moveId === undefined) throw new Error(`대미지 행 ${spec.id}에 기술이 없다`)
  return spec.moveId
}

function computeSweep(plan: TabPlan, rowId: string): CompactCell[] {
  const spec = rowSpec(plan, rowId)
  if (spec.judge === 'speed') {
    return compactSweep(sweepSpeed(plan.game, spec.attacker, spec.defender, spec.conditions, OVER_BUDGET), (sp, j) =>
      compactSpeed(plan, sp, j),
    )
  }
  const r = sweepDamage(plan.game, spec.sweep, spec.attacker, spec.defender, moveOf(spec), spec.conditions, undefined, OVER_BUDGET)
  return compactSweep(r, compactDamage)
}

function computeExtreme(plan: TabPlan, filterId: string): CompactCell[] {
  const spec = plan.filters[filterId]
  if (spec === undefined) throw new Error(`극단 필터 ${filterId}가 계획에 없다`)
  return [0, plan.spMaxPerStat].map((sp) =>
    compactDamage(
      sp,
      judgeDamage(plan.game, 'defender', spec.attacker, withSps(spec.defender, spec.stats, sp), spec.moveId, spec.conditions, undefined, IGNORE_TOTAL),
    ),
  )
}

/** 내 SP와 무관한 판정이라 칸 sp는 0으로 둔다. */
function computeFixed(plan: TabPlan, fixedId: string): CompactCell[] {
  const spec = plan.fixed[fixedId]
  if (spec === undefined) throw new Error(`고정 판정 ${fixedId}가 계획에 없다`)
  return [compactDamage(0, judgeDamage(plan.game, 'attacker', spec.attacker, spec.defender, spec.moveId, spec.conditions))]
}

function compute(plan: TabPlan, task: RowTask): CompactCell[] {
  switch (task.kind) {
    case 'ends':
      return computeEnds(plan, task.rowId)
    case 'sweep':
      return computeSweep(plan, task.rowId)
    case 'extreme':
      return computeExtreme(plan, task.filterId)
    case 'fixed':
      return computeFixed(plan, task.fixedId)
  }
}

function toResult(task: RowTask, cells: readonly CompactCell[]): RowTaskResult {
  switch (task.kind) {
    case 'ends':
      return { kind: 'ends', rowId: task.rowId, low: cells[0], high: cells[1] }
    case 'sweep':
      return { kind: 'sweep', rowId: task.rowId, cells }
    case 'extreme':
      return { kind: 'extreme', filterId: task.filterId, low: cells[0], high: cells[1] }
    case 'fixed':
      return { kind: 'fixed', fixedId: task.fixedId, cell: cells[0] }
  }
}

/** CoreError는 첫 상세를 이유로 쓴다. */
export function errorReason(e: CoreError | CoreInputError): ErrorReason {
  if (e instanceof CoreInputError) return { code: 'INPUT', field: e.field, message: e.message }
  const d = e.details[0]
  if (d === undefined) return { code: 'INPUT', message: e.message }
  return d.field === undefined ? { code: d.code, message: d.message } : { code: d.code, field: d.field, message: d.message }
}

/** 코어 도메인 오류만 결과로 담고 그 밖 예외는 다시 던진다. 오류는 캐시하지 않는다. */
export function computeRowTask(plan: TabPlan, task: RowTask, cache?: JudgementCache): RowTaskResult {
  try {
    const key = cache === undefined ? undefined : judgementKey(plan, task)
    const hit = key === undefined ? undefined : cache?.get(key)
    if (hit !== undefined) return toResult(task, hit)
    const cells = compute(plan, task)
    if (key !== undefined) cache?.set(key, cells)
    return toResult(task, cells)
  } catch (e) {
    if (e instanceof CoreError || e instanceof CoreInputError) return { kind: 'error', task, reason: errorReason(e) }
    throw e
  }
}
