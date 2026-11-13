// 행 작업 대기열. 계획과 지금까지의 결과에서 남은 작업을 단계별로 낸다(판정 없음).
import { cardItems, itemStates, resolveDefault, type CardItemRef, type DefaultResult } from './items'
import { variantNature } from './natures'
import { NATURE_VARIANTS } from './types'
import type { CardSpec, CompactCell, MoveCandidate, NatureVariant, OpponentHeader, PendingTasks, ResultMap, RowSpec, RowTask, RowTaskResult, TabPlan } from './types'

/** 기술 선택의 상대 단위 키(반감열매 변형 카드도 같은 키 — 같은 포켓몬의 선택을 공유한다) */
export const opponentKey = (o: Pick<OpponentHeader, 'source' | 'id'>): string => JSON.stringify([o.source, o.id])

/** 결과 맵 키. sweep은 stage와 무관하게 같은 키다. */
export function taskKey(task: RowTask): string {
  switch (task.kind) {
    case 'probe':
      return JSON.stringify(['probe', task.id])
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

/** 후보의 단건 판정 결과 키: 고정 판정은 그 결과 자체가 단건 판정이다. */
export function probeKey(c: MoveCandidate): string {
  return c.target === 'fixed' ? taskKey({ kind: 'fixed', fixedId: c.id }) : taskKey({ kind: 'probe', target: c.target, id: c.id })
}

/** 카드의 기본 항목 결정(items.resolveDefault). 방어 탭은 내가 확실히 빠를 때(speedEdge) 선공기 우선 규칙을 쓴다 */
export function cardDefault(plan: TabPlan, card: CardSpec, results: ResultMap, refs: readonly CardItemRef[] = cardItems(plan, card)): DefaultResult {
  return resolveDefault(itemStates(plan, card, refs, results), { priorityRule: plan.tab === 'defense' && card.speedEdge === true })
}

/** 보이는 항목: 사용자가 고른 항목이 이 카드에 있으면 그것, 아니면 정해진 기본 항목 */
export function shownItemKey(refs: readonly CardItemRef[], def: DefaultResult, selected: string | undefined): string | undefined {
  if (selected !== undefined && refs.some((r) => r.key === selected)) return selected
  return def.kind === 'ready' ? def.key : undefined
}

/**
 * 한 카드의 남은 작업. error 카드는 작업이 없다. 후보가 없는 카드(스피드 탭)는 모든 행이 대상이다.
 * 후보 카드: 모든 후보 단건 판정(1단계) → 기본 항목 결정에 필요한 항목의 변동 판정(극단 필터·양 끝 1단계, 현재·변형 스윕 2단계) →
 * 보이는 항목(selected = 사용자가 고른 항목 키)의 행 작업 전부(기존 단계).
 */
export function cardPending(plan: TabPlan, card: CardSpec, results: ResultMap, selected?: string): PendingTasks {
  const stage1: RowTask[] = []
  const stage2: RowTask[] = []
  const stage3: RowTask[] = []
  const stage4: RowTask[] = []
  const stage5: RowTask[] = []
  if (card.state === 'error') return { stage1, stage2, stage3, stage4, stage5 }
  const push = (stage: RowTask[], task: RowTask) => {
    if (!results.has(taskKey(task))) stage.push(task)
  }

  /** 보이는 행: 양 끝 → 판정 변화 스윕(2단계)·확인 스윕(3단계) → 성격 변형(4단계, 결정용이면 2단계) */
  const fullRow = (rowId: string, decide: boolean) => {
    const spec = plan.rows[rowId]
    if (spec.error !== undefined || spec.sweep === undefined) return
    if (spec.gate !== undefined && filterState(results, spec.gate).kind !== 'passed') return
    const ends = results.get(taskKey({ kind: 'ends', rowId }))
    if (ends === undefined) return push(stage1, { kind: 'ends', rowId })
    if (ends.kind !== 'ends') return
    for (const nature of neededVariants(plan, spec)) push(decide ? stage2 : stage4, { kind: 'variant', rowId, nature })
    if (results.has(taskKey({ kind: 'sweep', rowId, stage: 2 }))) return
    if (rowChanges(ends, { variantsDone: false })) stage2.push({ kind: 'sweep', rowId, stage: 2 })
    else stage3.push({ kind: 'sweep', rowId, stage: 3 })
  }
  /** 결정용 행: 변동이 정해질 만큼만(양 끝이 다르면 끝, 같으면 성격 변형과 현재와 같은 변형 대신 쓰는 현재 스윕) */
  const decideRow = (rowId: string) => {
    const spec = plan.rows[rowId]
    if (spec.error !== undefined || spec.sweep === undefined) return
    if (spec.gate !== undefined && filterState(results, spec.gate).kind !== 'passed') return
    const ends = results.get(taskKey({ kind: 'ends', rowId }))
    if (ends === undefined) return push(stage1, { kind: 'ends', rowId })
    if (ends.kind !== 'ends' || ends.range.low.category !== ends.range.high.category) return
    const needed = neededVariants(plan, spec)
    for (const nature of needed) push(stage2, { kind: 'variant', rowId, nature })
    if (spec.natures !== undefined && needed.length < 2) push(stage2, { kind: 'sweep', rowId, stage: 2 })
  }
  const gatedRows = (filterId: string) => card.rowIds.filter((id) => plan.rows[id].gate === filterId)
  const pairs = (filterId: string) => {
    const missing = NATURE_VARIANTS.filter((nature) => !results.has(taskKey({ kind: 'pair', filterId, nature })))
    if (missing.length > 0 && pairReady(plan, card, filterId, results)) for (const nature of missing) stage5.push({ kind: 'pair', filterId, nature })
  }

  if (card.conditions.length === 0) {
    for (const filterId of card.filterIds) push(stage1, { kind: 'extreme', filterId })
    for (const rowId of card.rowIds) fullRow(rowId, false)
    for (const fixedId of card.fixedIds) push(stage1, { kind: 'fixed', fixedId })
    for (const filterId of card.filterIds) pairs(filterId)
    return { stage1, stage2, stage3, stage4, stage5 }
  }

  const refs = cardItems(plan, card)
  for (const r of refs) {
    const c = r.candidate
    if (c.target === 'fixed') push(stage1, { kind: 'fixed', fixedId: c.id })
    else if (c.target === 'filter' || plan.rows[c.id].error === undefined) push(stage1, { kind: 'probe', target: c.target, id: c.id })
  }
  const def = cardDefault(plan, card, results, refs)
  const decide = new Set(def.kind === 'pending' ? def.need : [])
  const shown = shownItemKey(refs, def, selected)
  for (const r of refs) {
    const c = r.candidate
    const isShown = r.key === shown
    if (!isShown && !decide.has(r.key)) continue
    if (c.target === 'row') {
      if (isShown) fullRow(c.id, decide.has(r.key))
      else decideRow(c.id)
      continue
    }
    if (c.target !== 'filter') continue
    push(stage1, { kind: 'extreme', filterId: c.id })
    for (const rowId of gatedRows(c.id)) {
      if (isShown) fullRow(rowId, decide.has(r.key))
      else decideRow(rowId)
    }
    if (isShown) pairs(c.id)
  }
  return { stage1, stage2, stage3, stage4, stage5 }
}

/** 작업이 속한 카드 id(그 결과가 바뀌면 그 카드만 다시 조립하면 된다). */
export function taskCardId(plan: TabPlan, task: RowTask): string {
  switch (task.kind) {
    case 'probe':
      return task.target === 'row' ? plan.rows[task.id].cardId : plan.filters[task.id].cardId
    case 'ends':
    case 'sweep':
    case 'variant':
      return plan.rows[task.rowId].cardId
    case 'extreme':
    case 'pair':
      return plan.filters[task.filterId].cardId
    case 'fixed':
      return plan.fixed[task.fixedId].cardId
  }
}

/**
 * 먼저 계산할 카드: 래더 상대·분류마다 관측 최대 묶음 카드(계획 순 첫 관측 카드 = 기본 선택)와 사용자 추가 배분 카드, 커스텀 카드 전부.
 * 나머지(낮은 점유율 묶음)는 같은 단계 안에서 뒤로 미룬다(첫 카드·체감 속도용, 판정 결과는 같다).
 */
export function primaryCardIds(plan: TabPlan): Set<string> {
  const out = new Set<string>()
  const seen = new Set<string>()
  for (const card of plan.cards) {
    if (card.opponent.source !== 'ladder' || card.bundle.userAdded !== undefined) {
      out.add(card.id)
      continue
    }
    const k = JSON.stringify([card.opponent.id, card.category])
    if (seen.has(k)) continue
    seen.add(k)
    out.add(card.id)
  }
  return out
}

/** 카드 순 → 행 순. 결과(오류 포함)가 있는 작업은 다시 내지 않는다. selections = 상대 그룹 키(groupKey) → 사용자가 고른 항목 키 */
export function pendingTasks(plan: TabPlan, results: ResultMap, selections: ReadonlyMap<string, string> = new Map()): PendingTasks {
  const stage1: RowTask[] = []
  const stage2: RowTask[] = []
  const stage3: RowTask[] = []
  const stage4: RowTask[] = []
  const stage5: RowTask[] = []
  for (const card of plan.cards) {
    const p = cardPending(plan, card, results, selections.get(opponentKey(card.opponent)))
    stage1.push(...p.stage1)
    stage2.push(...p.stage2)
    stage3.push(...p.stage3)
    stage4.push(...p.stage4)
    stage5.push(...p.stage5)
  }
  return { stage1, stage2, stage3, stage4, stage5 }
}
