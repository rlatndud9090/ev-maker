// 행 작업 하나를 코어 판정으로 계산한다. 범주는 코어가 낸 값을 그대로 옮긴다.
import { CoreError, CoreInputError, judgeDamage, judgeSpeed, sweepDamage, sweepSpeed } from '../core'
import type { CellJudgement, DamageResult, PokemonSet, RollTier, SpeedResult, SweepResult } from '../core'
import type { StatId } from '../data/schema'
import { judgementKey } from './key'
import { variantNature, withNature } from './natures'
import { minPairPoints } from './target'
import type { CachedJudgement, CompactCell, ErrorReason, JudgementCache, NatureVariant, PairPoint, RowSpec, RowTask, RowTaskResult, TabPlan } from './types'

const IGNORE_TOTAL = { ignoreSpTotal: true } as const
const OVER_BUDGET = { judgeOverBudget: true } as const

/** 내 쪽 세트의 성격을 nature로 바꾼 행 명세(같으면 그대로) */
export function specWithNature(plan: TabPlan, spec: RowSpec, nature: string): RowSpec {
  if (plan.mySide === 'attacker') return spec.attacker.nature === nature ? spec : { ...spec, attacker: withNature(spec.attacker, nature) }
  return spec.defender.nature === nature ? spec : { ...spec, defender: withNature(spec.defender, nature) }
}

/** 변형 성격 id. 행에 변형이 없으면 오류(계획 버그) */
export function rowVariantNature(spec: RowSpec, which: NatureVariant): string {
  if (spec.natures === undefined) throw new Error(`행 ${spec.id}에 성격 변형이 없다`)
  return variantNature(spec.natures, which)
}

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

function endCell(plan: TabPlan, spec: RowSpec & { sweep: NonNullable<RowSpec['sweep']> }, sp: number): CompactCell {
  const { side, stat } = spec.sweep
  const a = side === 'attacker' ? withSps(spec.attacker, [stat], sp) : spec.attacker
  const d = side === 'defender' ? withSps(spec.defender, [stat], sp) : spec.defender
  if (spec.judge === 'speed') return compactSpeed(plan, sp, judgeSpeed(plan.game, a, d, spec.conditions, IGNORE_TOTAL))
  return compactDamage(sp, judgeDamage(plan.game, side, a, d, moveOf(spec), spec.conditions, undefined, { ...IGNORE_TOTAL, rollSteps: plan.rollSteps }))
}

/** [현재 0, 현재 최대, 무보정 0, 상승 최대]. 변형이 현재 성격과 같으면 그 칸을 다시 판정하지 않는다. */
function computeEnds(plan: TabPlan, rowId: string): CompactCell[] {
  const spec = rowSpec(plan, rowId)
  const max = plan.spMaxPerStat
  const low = endCell(plan, spec, 0)
  const high = endCell(plan, spec, max)
  const neutral = specWithNature(plan, spec, rowVariantNature(spec, 'neutral')) as typeof spec
  const plus = specWithNature(plan, spec, rowVariantNature(spec, 'plus')) as typeof spec
  return [low, high, neutral === spec ? low : endCell(plan, neutral, 0), plus === spec ? high : endCell(plan, plus, max)]
}

function moveOf(spec: RowSpec): string {
  if (spec.moveId === undefined) throw new Error(`대미지 행 ${spec.id}에 기술이 없다`)
  return spec.moveId
}

function computeSweep(plan: TabPlan, rowId: string, nature?: NatureVariant): CompactCell[] {
  const base = rowSpec(plan, rowId)
  const spec = nature === undefined ? base : (specWithNature(plan, base, rowVariantNature(base, nature)) as typeof base)
  if (spec.judge === 'speed') {
    return compactSweep(sweepSpeed(plan.game, spec.attacker, spec.defender, spec.conditions, OVER_BUDGET), (sp, j) =>
      compactSpeed(plan, sp, j),
    )
  }
  const r = sweepDamage(plan.game, spec.sweep, spec.attacker, spec.defender, moveOf(spec), spec.conditions, undefined, { ...OVER_BUDGET, rollSteps: plan.rollSteps })
  return compactSweep(r, compactDamage)
}

/** 낮은 극단 = H0·B/D0·무보정, 높은 극단 = H최대·B/D최대·상승. */
function computeExtreme(plan: TabPlan, filterId: string): CompactCell[] {
  const spec = plan.filters[filterId]
  if (spec === undefined) throw new Error(`극단 필터 ${filterId}가 계획에 없다`)
  const ends = [
    { sp: 0, nature: spec.natures.neutral },
    { sp: plan.spMaxPerStat, nature: spec.natures.plus },
  ]
  return ends.map(({ sp, nature }) =>
    compactDamage(
      sp,
      judgeDamage(plan.game, 'defender', spec.attacker, withSps(withNature(spec.defender, nature), spec.stats, sp), spec.moveId, spec.conditions, undefined, {
        ...IGNORE_TOTAL,
        rollSteps: plan.rollSteps,
      }),
    ),
  )
}

/** 극단 필터와 같은 세트(성격만 변형)에서 H·B/D를 따로 덮어쓴 판정으로 최소 조합을 찾는다. */
function computePair(plan: TabPlan, filterId: string, which: NatureVariant): PairPoint[] {
  const spec = plan.filters[filterId]
  if (spec === undefined) throw new Error(`극단 필터 ${filterId}가 계획에 없다`)
  const [hpStat, defStat] = spec.stats
  const base = withNature(spec.defender, variantNature(spec.natures, which))
  return minPairPoints((hp, d) => {
    const defender = { ...base, sp: { ...base.sp, [hpStat]: hp, [defStat]: d } }
    const options = { ...IGNORE_TOTAL, rollSteps: plan.rollSteps }
    return judgeDamage(plan.game, 'defender', spec.attacker, defender, spec.moveId, spec.conditions, undefined, options).category as RollTier
  }, plan.spMaxPerStat)
}

/** 후보 기술의 현재 세트 단건 판정(가장 센 기술 고르기 전용, 칸 sp는 0). 방어 탭 필터는 상대 → 나, 비교 전용 후보는 그 명세의 관점. */
function computeProbe(plan: TabPlan, task: Extract<RowTask, { kind: 'probe' }>): CompactCell[] {
  const options = { rollSteps: plan.rollSteps }
  if (task.target === 'filter') {
    const spec = plan.filters[task.id]
    if (spec === undefined) throw new Error(`극단 필터 ${task.id}가 계획에 없다`)
    return [compactDamage(0, judgeDamage(plan.game, 'defender', spec.attacker, spec.defender, spec.moveId, spec.conditions, undefined, options))]
  }
  if (task.target === 'probe') {
    const spec = plan.probes[task.id]
    if (spec === undefined) throw new Error(`비교 판정 ${task.id}가 계획에 없다`)
    return [compactDamage(0, judgeDamage(plan.game, spec.side, spec.attacker, spec.defender, spec.moveId, spec.conditions, undefined, options))]
  }
  const spec = rowSpec(plan, task.id)
  return [compactDamage(0, judgeDamage(plan.game, spec.sweep.side, spec.attacker, spec.defender, moveOf(spec), spec.conditions, undefined, options))]
}

/** 내 SP와 무관한 판정이라 칸 sp는 0으로 둔다. */
function computeFixed(plan: TabPlan, fixedId: string): CompactCell[] {
  const spec = plan.fixed[fixedId]
  if (spec === undefined) throw new Error(`고정 판정 ${fixedId}가 계획에 없다`)
  return [compactDamage(0, judgeDamage(plan.game, 'attacker', spec.attacker, spec.defender, spec.moveId, spec.conditions, undefined, { rollSteps: plan.rollSteps }))]
}

function compute(plan: TabPlan, task: RowTask): CachedJudgement {
  switch (task.kind) {
    case 'probe':
      return computeProbe(plan, task)
    case 'ends':
      return computeEnds(plan, task.rowId)
    case 'sweep':
      return computeSweep(plan, task.rowId)
    case 'variant':
      return computeSweep(plan, task.rowId, task.nature)
    case 'extreme':
      return computeExtreme(plan, task.filterId)
    case 'fixed':
      return computeFixed(plan, task.fixedId)
    case 'pair':
      return computePair(plan, task.filterId, task.nature)
  }
}

/** 캐시 키에 작업 종류가 들어가므로 값 모양은 task.kind로 정해진다. */
function toResult(task: RowTask, value: CachedJudgement): RowTaskResult {
  if (task.kind === 'pair') return { kind: 'pair', filterId: task.filterId, nature: task.nature, points: value as readonly PairPoint[] }
  const cells = value as readonly CompactCell[]
  switch (task.kind) {
    case 'probe':
      return { kind: 'probe', id: task.id, cell: cells[0] }
    case 'ends':
      return { kind: 'ends', rowId: task.rowId, low: cells[0], high: cells[1], range: { low: cells[2], high: cells[3] } }
    case 'sweep':
      return { kind: 'sweep', rowId: task.rowId, cells }
    case 'variant':
      return { kind: 'variant', rowId: task.rowId, nature: task.nature, cells }
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
    const value = compute(plan, task)
    if (key !== undefined) cache?.set(key, value)
    return toResult(task, value)
  } catch (e) {
    if (e instanceof CoreError || e instanceof CoreInputError) return { kind: 'error', task, reason: errorReason(e) }
    throw e
  }
}
