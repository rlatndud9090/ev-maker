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
    case 'pair':
      return JSON.stringify(['pair', task.filterId])
  }
}

/** 실행 순서상 다음 단계(1 → 2 → 3 → 4 중 처음 비지 않은 것). 모두 비면 빈 배열. */
export function nextStage(p: PendingTasks): readonly RowTask[] {
  for (const stage of [p.stage1, p.stage2, p.stage3, p.stage4]) if (stage.length > 0) return stage
  return []
}

/** 방금 결과가 담긴 sweep 작업이 그 필터의 마지막 행 스윕이라 쌍 작업이 새로 생길 수 있는지(실행기 대기열 갱신 기준). */
export function mayUnlockPair(plan: TabPlan, results: ResultMap, task: RowTask): boolean {
  if (task.kind !== 'sweep') return false
  const gate = plan.rows[task.rowId]?.gate
  if (gate === undefined) return false
  const card = plan.cards.find((c) => c.id === plan.rows[task.rowId].cardId)
  if (card === undefined) return false
  return card.rowIds.every((id) => plan.rows[id].gate !== gate || results.has(taskKey({ kind: 'sweep', rowId: id, stage: 2 })))
}

/** 쌍 최소 조합이 필요한지: 필터 통과, 그 필터의 두 행 스윕이 모두 끝났고 적어도 한 행은 칸 범주가 바뀐다. */
function pairReady(plan: TabPlan, card: CardSpec, filterId: string, results: ResultMap): boolean {
  if (filterState(results, filterId).kind !== 'passed') return false
  let changes = false
  let rows = 0
  for (const rowId of card.rowIds) {
    if (plan.rows[rowId].gate !== filterId) continue
    rows++
    const r = results.get(taskKey({ kind: 'sweep', rowId, stage: 2 }))
    if (r?.kind !== 'sweep') return false
    const first = r.cells[0]?.category
    if (r.cells.some((c) => c.category !== first)) changes = true
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
  if (card.state === 'error') return { stage1, stage2, stage3, stage4 }
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
  for (const filterId of card.filterIds) {
    if (!results.has(taskKey({ kind: 'pair', filterId })) && pairReady(plan, card, filterId, results)) stage4.push({ kind: 'pair', filterId })
  }
  return { stage1, stage2, stage3, stage4 }
}

/** 카드 순 → 행 순. 결과(오류 포함)가 있는 작업은 다시 내지 않는다. */
export function pendingTasks(plan: TabPlan, results: ResultMap): PendingTasks {
  const stage1: RowTask[] = []
  const stage2: RowTask[] = []
  const stage3: RowTask[] = []
  const stage4: RowTask[] = []
  for (const card of plan.cards) {
    const p = cardPending(plan, card, results)
    stage1.push(...p.stage1)
    stage2.push(...p.stage2)
    stage3.push(...p.stage3)
    stage4.push(...p.stage4)
  }
  return { stage1, stage2, stage3, stage4 }
}
