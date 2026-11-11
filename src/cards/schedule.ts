// 행 작업 대기열. 계획과 지금까지의 결과에서 남은 작업을 단계별로 낸다(판정 없음).
import { variantNature } from './natures'
import { NATURE_VARIANTS } from './types'
import type { CardSpec, CompactCell, NatureVariant, PendingTasks, ResultMap, RowSpec, RowTask, RowTaskResult, TabPlan } from './types'

/** 결과 맵 키. sweep은 stage와 무관하게 같은 키다. */
export function taskKey(task: RowTask): string {
  switch (task.kind) {
    case 'ends':
      return JSON.stringify(['ends', task.rowId])
    case 'sweep':
      return JSON.stringify(['sweep', task.rowId])
    case 'extreme':
      return JSON.stringify(['extreme', task.filterId])
    case 'fixed':
      return JSON.stringify(['fixed', task.fixedId])
    case 'variant':
      return JSON.stringify(['variant', task.rowId, task.nature])
    case 'pair':
      return JSON.stringify(['pair', task.filterId, task.nature])
  }
}

/** 실행 순서상 다음 단계(1 → 2 → 3 → 4 → 5 중 처음 비지 않은 것). 모두 비면 빈 배열. */
export function nextStage(p: PendingTasks): readonly RowTask[] {
  for (const stage of [p.stage1, p.stage2, p.stage3, p.stage4, p.stage5]) if (stage.length > 0) return stage
  return []
}

const myNature = (plan: TabPlan, spec: RowSpec): string => (plan.mySide === 'attacker' ? spec.attacker : spec.defender).nature

/** 현재 성격과 다른 변형만(같은 변형은 현재 스윕을 그대로 쓴다). */
export function neededVariants(plan: TabPlan, spec: RowSpec): NatureVariant[] {
  const natures = spec.natures
  if (natures === undefined) return []
  return NATURE_VARIANTS.filter((v) => variantNature(natures, v) !== myNature(plan, spec))
}

/**
 * 한 행의 현재·변형 스윕 칸. 결과가 없거나 오류면 undefined. variantsDone = 필요한 변형 결과(오류 포함)가 모두 있음.
 * variantError = 변형 결과 중 오류가 있음(그 변형 칸이 비어도 "SP 0~32에서 불가"가 아니라 판정 못 함이다).
 */
export interface RowJudgements {
  current?: readonly CompactCell[]
  neutral?: readonly CompactCell[]
  plus?: readonly CompactCell[]
  variantsDone: boolean
  variantError?: true
}

export function rowJudgements(plan: TabPlan, results: ResultMap, rowId: string): RowJudgements {
  const spec = plan.rows[rowId]
  const swept = results.get(taskKey({ kind: 'sweep', rowId, stage: 2 }))
  const current = swept?.kind === 'sweep' ? swept.cells : undefined
  const out: RowJudgements = { variantsDone: true }
  if (current !== undefined) out.current = current
  const needed = neededVariants(plan, spec)
  for (const v of spec.natures === undefined ? [] : NATURE_VARIANTS) {
    if (!needed.includes(v)) {
      if (current !== undefined) out[v] = current
      continue
    }
    const r = results.get(taskKey({ kind: 'variant', rowId, nature: v }))
    if (r === undefined) out.variantsDone = false
    else if (r.kind === 'variant') out[v] = r.cells
    else out.variantError = true
  }
  return out
}

/**
 * {무보정, 상승} × SP 0~32 판정 중 범주가 하나라도 다른지: 변형 범위 끝(무보정 0·상승 최대)과 나온 변형 스윕 칸만 본다.
 * 현재 성격 칸은 넣지 않는다(하락 보정은 노출 판단에 관여하지 않음 — 사용자 결정 2026-11-11, 방어 극단 필터와 같은 규칙).
 */
export function rowChanges(ends: Extract<RowTaskResult, { kind: 'ends' }>, j: RowJudgements): boolean {
  const first = ends.range.low.category
  const cells = [ends.range.high, ...(j.neutral ?? []), ...(j.plus ?? [])]
  return cells.some((c) => c.category !== first)
}

/** 행의 노출 판단이 끝났는지: 현재 스윕 결과(오류 포함)와 필요한 변형 결과가 모두 있다. */
function rowSettled(plan: TabPlan, results: ResultMap, rowId: string): boolean {
  return results.has(taskKey({ kind: 'sweep', rowId, stage: 2 })) && rowJudgements(plan, results, rowId).variantsDone
}

/** 방금 결과가 담긴 sweep·variant 작업이 그 필터의 마지막 행 작업이라 쌍 작업이 새로 생길 수 있는지(실행기 대기열 갱신 기준). */
export function mayUnlockPair(plan: TabPlan, results: ResultMap, task: RowTask): boolean {
  if (task.kind !== 'sweep' && task.kind !== 'variant') return false
  const gate = plan.rows[task.rowId]?.gate
  if (gate === undefined) return false
  const card = plan.cards.find((c) => c.id === plan.rows[task.rowId].cardId)
  if (card === undefined) return false
  return card.rowIds.every((id) => plan.rows[id].gate !== gate || rowSettled(plan, results, id))
}

/** 쌍 최소 조합이 필요한지: 필터 통과, 그 필터의 두 행 현재·변형 스윕이 모두 끝났고 적어도 한 행은 판정이 바뀐다. */
function pairReady(plan: TabPlan, card: CardSpec, filterId: string, results: ResultMap): boolean {
  if (filterState(results, filterId).kind !== 'passed') return false
  let changes = false
  let rows = 0
  for (const rowId of card.rowIds) {
    if (plan.rows[rowId].gate !== filterId) continue
    rows++
    const ends = results.get(taskKey({ kind: 'ends', rowId }))
    const j = rowJudgements(plan, results, rowId)
    if (ends?.kind !== 'ends' || j.current === undefined || !j.variantsDone) return false
    if (rowChanges(ends, j)) changes = true
  }
  return rows > 0 && changes
}

export type FilterState =
  | { kind: 'pending' }
  | { kind: 'error'; result: Extract<RowTaskResult, { kind: 'error' }> }
  | { kind: 'passed' | 'blocked'; result: Extract<RowTaskResult, { kind: 'extreme' }> }

/** 필터 통과 = 두 극단 범주가 다름. */
export function filterState(results: ResultMap, filterId: string): FilterState {
  const r = results.get(taskKey({ kind: 'extreme', filterId }))
  if (r === undefined) return { kind: 'pending' }
  if (r.kind === 'error') return { kind: 'error', result: r }
  if (r.kind !== 'extreme') throw new Error(`필터 ${filterId}의 결과 종류가 ${r.kind}다`)
  return { kind: r.low.category !== r.high.category ? 'passed' : 'blocked', result: r }
}

/** 한 카드의 남은 작업. error 카드는 작업이 없다. */
export function cardPending(plan: TabPlan, card: CardSpec, results: ResultMap): PendingTasks {
  const stage1: RowTask[] = []
  const stage2: RowTask[] = []
  const stage3: RowTask[] = []
  const stage4: RowTask[] = []
  const stage5: RowTask[] = []
  if (card.state === 'error') return { stage1, stage2, stage3, stage4, stage5 }
  for (const filterId of card.filterIds) {
    if (!results.has(taskKey({ kind: 'extreme', filterId }))) stage1.push({ kind: 'extreme', filterId })
  }
  for (const rowId of card.rowIds) {
    const spec = plan.rows[rowId]
    if (spec.error !== undefined || spec.sweep === undefined) continue
    if (spec.gate !== undefined && filterState(results, spec.gate).kind !== 'passed') continue
    const ends = results.get(taskKey({ kind: 'ends', rowId }))
    if (ends === undefined) {
      stage1.push({ kind: 'ends', rowId })
      continue
    }
    if (ends.kind !== 'ends') continue
    for (const nature of neededVariants(plan, spec)) {
      if (!results.has(taskKey({ kind: 'variant', rowId, nature }))) stage4.push({ kind: 'variant', rowId, nature })
    }
    if (results.has(taskKey({ kind: 'sweep', rowId, stage: 2 }))) continue
    if (rowChanges(ends, { variantsDone: false })) stage2.push({ kind: 'sweep', rowId, stage: 2 })
    else stage3.push({ kind: 'sweep', rowId, stage: 3 })
  }
  for (const fixedId of card.fixedIds) {
    if (!results.has(taskKey({ kind: 'fixed', fixedId }))) stage1.push({ kind: 'fixed', fixedId })
  }
  for (const filterId of card.filterIds) {
    const missing = NATURE_VARIANTS.filter((nature) => !results.has(taskKey({ kind: 'pair', filterId, nature })))
    if (missing.length > 0 && pairReady(plan, card, filterId, results)) for (const nature of missing) stage5.push({ kind: 'pair', filterId, nature })
  }
  return { stage1, stage2, stage3, stage4, stage5 }
}

/** 카드 순 → 행 순. 결과(오류 포함)가 있는 작업은 다시 내지 않는다. */
export function pendingTasks(plan: TabPlan, results: ResultMap): PendingTasks {
  const stage1: RowTask[] = []
  const stage2: RowTask[] = []
  const stage3: RowTask[] = []
  const stage4: RowTask[] = []
  const stage5: RowTask[] = []
  for (const card of plan.cards) {
    const p = cardPending(plan, card, results)
    stage1.push(...p.stage1)
    stage2.push(...p.stage2)
    stage3.push(...p.stage3)
    stage4.push(...p.stage4)
    stage5.push(...p.stage5)
  }
  return { stage1, stage2, stage3, stage4, stage5 }
}
