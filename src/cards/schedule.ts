// 행 작업 대기열. 계획과 지금까지의 결과에서 남은 작업을 단계별로 낸다(판정 없음).
import type { CardSpec, PendingTasks, ResultMap, RowTask, RowTaskResult, TabPlan } from './types'

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
  }
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
  if (card.state === 'error') return { stage1, stage2, stage3 }
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
    if (ends.kind !== 'ends' || results.has(taskKey({ kind: 'sweep', rowId, stage: 2 }))) continue
    if (ends.low.category !== ends.high.category) stage2.push({ kind: 'sweep', rowId, stage: 2 })
    else stage3.push({ kind: 'sweep', rowId, stage: 3 })
  }
  for (const fixedId of card.fixedIds) {
    if (!results.has(taskKey({ kind: 'fixed', fixedId }))) stage1.push({ kind: 'fixed', fixedId })
  }
  return { stage1, stage2, stage3 }
}

/** 카드 순 → 행 순. 결과(오류 포함)가 있는 작업은 다시 내지 않는다. */
export function pendingTasks(plan: TabPlan, results: ResultMap): PendingTasks {
  const stage1: RowTask[] = []
  const stage2: RowTask[] = []
  const stage3: RowTask[] = []
  for (const card of plan.cards) {
    const p = cardPending(plan, card, results)
    stage1.push(...p.stage1)
    stage2.push(...p.stage2)
    stage3.push(...p.stage3)
  }
  return { stage1, stage2, stage3 }
}
