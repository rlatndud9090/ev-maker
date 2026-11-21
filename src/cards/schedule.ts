// 행 작업 대기열. 계획과 지금까지의 결과에서 남은 작업을 단계별로 낸다(판정 없음).
import { STAT_IDS, TIER_ORDER, tierRank } from '../core'
import type { Snapshot, StatId } from '../data/schema'
import { cardItems, itemStates, resolveDefault, type CardItemRef, type DefaultResult } from './items'
import type { Branch } from './lock'
import { rowNature, strictVariants } from './lockNature'
import { findLockTarget } from './lockTarget'
import { variantNature } from './natures'
import { NATURE_VARIANTS } from './types'
import type {
  CardSpec,
  CompactCell,
  ExtremeSpec,
  MoveCandidate,
  NatureVariant,
  OpponentHeader,
  PendingTasks,
  ResultMap,
  RowLockSpec,
  RowSpec,
  RowTask,
  RowTaskResult,
  SpOverride,
  TabPlan,
} from './types'

/** 기술 선택의 상대 단위 키(반감열매 변형 카드도 같은 키 — 같은 포켓몬의 선택을 공유한다) */
export const opponentKey = (o: Pick<OpponentHeader, 'source' | 'id'>): string => JSON.stringify([o.source, o.id])

const spKey = (sp: SpOverride | undefined): unknown => (sp === undefined ? null : STAT_IDS.filter((s) => sp[s] !== undefined).map((s) => [s, sp[s]]))

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
    case 'stairs':
      return JSON.stringify(['stairs', task.filterId, task.nature, task.rank, task.hpMin, spKey(task.sp)])
    case 'branch':
      return JSON.stringify(['branch', task.rowId, task.nature, spKey(task.sp)])
  }
}

/** 실행 순서상 다음 단계(1 → 2 → 3 → 4 → 5 중 처음 비지 않은 것). 모두 비면 빈 배열. */
export function nextStage(p: PendingTasks): readonly RowTask[] {
  for (const stage of [p.stage1, p.stage2, p.stage3, p.stage4, p.stage5]) if (stage.length > 0) return stage
  return []
}

const myNature = (plan: TabPlan, spec: RowSpec): string => (plan.mySide === 'attacker' ? spec.attacker : spec.defender).nature

/** 고정 계획에서 엄격 상승이 없는 행·필터는 상승 변형을 만들지 않는다 */
const variantsOf = (lock: RowLockSpec | undefined): readonly NatureVariant[] => (lock?.strict.plus === null ? ['neutral'] : NATURE_VARIANTS)

/** 현재 성격과 다른 변형만(같은 변형은 현재 스윕을 그대로 쓴다). */
export function neededVariants(plan: TabPlan, spec: RowSpec): NatureVariant[] {
  const natures = spec.natures
  if (natures === undefined) return []
  return variantsOf(spec.lock).filter((v) => variantNature(natures, v) !== myNature(plan, spec))
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
export function pairReady(plan: TabPlan, card: CardSpec, filterId: string, results: ResultMap): boolean {
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

/** 카드의 기본 항목 결정(items.resolveDefault). 방어 탭은 주력 중 변동 우선, 내가 확실히 빠를 때(speedEdge) 선공기 우선 규칙을 쓴다 */
export function cardDefault(plan: TabPlan, card: CardSpec, results: ResultMap, refs: readonly CardItemRef[] = cardItems(plan, card)): DefaultResult {
  return resolveDefault(itemStates(plan, card, refs, results), { priorityRule: plan.tab === 'defense' && card.speedEdge === true, variableFirst: plan.tab === 'defense' })
}

/** 보이는 항목: 사용자가 고른 항목이 이 카드에 있으면 그것, 아니면 정해진 기본 항목 */
export function shownItemKey(refs: readonly CardItemRef[], def: DefaultResult, selected: string | undefined): string | undefined {
  if (selected !== undefined && refs.some((r) => r.key === selected)) return selected
  return def.kind === 'ready' ? def.key : undefined
}

/** 결정용 행: 변동이 정해질 만큼만(양 끝이 다르면 끝, 같으면 성격 변형과 현재와 같은 변형 대신 쓰는 현재 스윕) */
function decideRowTasks(plan: TabPlan, results: ResultMap, rowId: string, early: (t: RowTask) => void, late: (t: RowTask) => void): void {
  const spec = plan.rows[rowId]
  if (spec.error !== undefined || spec.sweep === undefined) return
  if (spec.gate !== undefined && filterState(results, spec.gate).kind !== 'passed') return
  const ends = results.get(taskKey({ kind: 'ends', rowId }))
  if (ends === undefined) return early({ kind: 'ends', rowId })
  if (ends.kind !== 'ends' || ends.range.low.category !== ends.range.high.category) return
  const needed = neededVariants(plan, spec)
  for (const nature of needed) late({ kind: 'variant', rowId, nature })
  if (spec.natures !== undefined && needed.length < 2) late({ kind: 'sweep', rowId, stage: 2 })
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
  const decideRow = (rowId: string) => decideRowTasks(plan, results, rowId, (t) => push(stage1, t), (t) => push(stage2, t))
  const gatedRows = (filterId: string) => card.rowIds.filter((id) => plan.rows[id].gate === filterId)
  const pairs = (filterId: string) => {
    const spec = plan.filters[filterId]
    if (!pairReady(plan, card, filterId, results)) return
    // 계단 모드(H 또는 B/D 고정)의 목표·갈래는 계단으로 내고, 쌍 결과는 합계 띠에만 쓴다(계단 먼저)
    if (spec.lock?.viewLocked === true) for (const t of baseStairsTasks(plan, spec, results)) push(stage5, t)
    const missing = variantsOf(spec.lock).filter((nature) => !results.has(taskKey({ kind: 'pair', filterId, nature })))
    for (const nature of missing) stage5.push({ kind: 'pair', filterId, nature })
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

/**
 * 기술 선택 메뉴를 연 카드의 모든 항목 변동 판정 작업(단건 판정 → 극단 필터·양 끝 → 성격 변형·현재 스윕). 기본 항목 결정·보이는 항목과 겹치는
 * 작업도 낼 수 있다(결과가 있으면 실행기가 건너뛴다). error·후보 없는 카드는 없다. 판정 입력이 아니라 계산 순서만 정한다.
 */
export function cardExplore(plan: TabPlan, card: CardSpec, results: ResultMap): PendingTasks {
  const stage1: RowTask[] = []
  const stage2: RowTask[] = []
  const out: PendingTasks = { stage1, stage2, stage3: [], stage4: [], stage5: [] }
  if (card.state === 'error' || card.conditions.length === 0) return out
  const push = (stage: RowTask[]) => (task: RowTask) => {
    if (!results.has(taskKey(task))) stage.push(task)
  }
  for (const r of cardItems(plan, card)) {
    const c = r.candidate
    if (c.target === 'fixed') {
      push(stage1)({ kind: 'fixed', fixedId: c.id })
      continue
    }
    if (c.target === 'row') {
      if (plan.rows[c.id].error === undefined) push(stage1)({ kind: 'probe', target: 'row', id: c.id })
      decideRowTasks(plan, results, c.id, push(stage1), push(stage2))
      continue
    }
    push(stage1)({ kind: 'probe', target: 'filter', id: c.id })
    push(stage1)({ kind: 'extreme', filterId: c.id })
    for (const rowId of card.rowIds) if (plan.rows[rowId].gate === c.id) decideRowTasks(plan, results, rowId, push(stage1), push(stage2))
  }
  return out
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
    case 'stairs':
      return plan.filters[task.filterId].cardId
    case 'fixed':
      return plan.fixed[task.fixedId].cardId
    case 'branch':
      return plan.rows[task.rowId].cardId
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

/**
 * 고정이 있을 때 미리 계산 기본 대상(화면이 알린 보이는 카드는 실행기가 더한다): 먼저 계산할 카드와 그 카드 묶음의 도구 변형 카드.
 * 도구(열매·화력 도구) 변형은 따로 그룹이 되어 그 카드가 그 그룹 기본 선택이므로 함께 든다.
 */
export function precomputeCardIds(plan: TabPlan): Set<string> {
  const primary = primaryCardIds(plan)
  const keyOf = (c: TabPlan['cards'][number]) => JSON.stringify([c.opponent.source, c.opponent.id, c.category, c.bundle.key])
  const keys = new Set(plan.cards.filter((c) => primary.has(c.id)).map(keyOf))
  return new Set(plan.cards.filter((c) => primary.has(c.id) || (c.berry !== undefined && keys.has(keyOf(c)))).map((c) => c.id))
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

// ---------- 컷 고정 ----------

const DEFENSE_TOP = TIER_ORDER.defense.length - 1

/** 필터 현재 세트 단건 판정의 방어 순위(판정 전·오류·순위 밖이면 null) */
function currentRank(results: ResultMap, filterId: string): number | null {
  const r = results.get(taskKey({ kind: 'probe', target: 'filter', id: filterId }))
  if (r?.kind !== 'probe' || !(TIER_ORDER.defense as readonly string[]).includes(r.cell.category)) return null
  return tierRank('defense', r.cell.category)
}

const stageRanks = new WeakMap<TabPlan, ReadonlyMap<string, readonly number[]>>()

/** 필터 id → 그 필터를 대상으로 하는 활성 방어 고정의 단계 순위 */
function lockedStageRanks(plan: TabPlan): ReadonlyMap<string, readonly number[]> {
  const hit = stageRanks.get(plan)
  if (hit !== undefined) return hit
  const out = new Map<string, number[]>()
  if (plan.lock?.mode === 'main') {
    const { derivation } = plan.lock
    for (const lock of derivation.locks) {
      if (lock.kind !== 'defense' || derivation.statuses.get(lock.seq)?.kind !== 'active') continue
      const ref = findLockTarget(plan, lock)
      if (ref === null || !('filterId' in ref)) continue
      const list = out.get(ref.filterId) ?? []
      list.push(tierRank('defense', lock.stage))
      out.set(ref.filterId, list)
    }
  }
  stageRanks.set(plan, out)
  return out
}

export const lockedHp = (plan: TabPlan, branch: Branch): number =>
  plan.lock?.mode === 'main' && plan.lock.derivation.lockedStats.includes('hp') ? (branch.lockedSp.hp ?? 0) : 0

/** 계단 모드 필터의 기준 갈래 계단: 현재 순위·한 단계 위·그 필터 고정 단계 × 엄격 두 성격, H 하한 = 고정 H */
function baseStairsTasks(plan: TabPlan, spec: ExtremeSpec, results: ResultMap): RowTask[] {
  if (plan.lock?.mode !== 'main' || spec.lock === undefined) return []
  const cur = currentRank(results, spec.id)
  if (cur === null) return []
  const ranks = [...new Set([cur, Math.min(cur + 1, DEFENSE_TOP), ...(lockedStageRanks(plan).get(spec.id) ?? [])])]
  const hpMin = lockedHp(plan, plan.lock.base)
  const out: RowTask[] = []
  for (const nature of [spec.lock.strict.neutral, spec.lock.strict.plus]) {
    if (nature === null) continue
    for (const rank of ranks) out.push({ kind: 'stairs', filterId: spec.id, nature, rank, hpMin })
  }
  return out
}

type BoostableStat = Exclude<StatId, 'hp'>

/** 성격의 능력치 보정 부호(+1·0·−1). 스냅샷에 없는 성격은 null */
function natureSignOf(game: Snapshot, id: string, stat: StatId): number | null {
  if (!Object.prototype.hasOwnProperty.call(game.data.natures, id)) return null
  const n = game.data.natures[id]
  if (n.plus === undefined || n.plus === n.minus) return 0
  return n.plus === stat ? 1 : n.minus === stat ? -1 : 0
}

/** 두 성격이 v·H를 뺀 관여 능력치에서 같은 배수를 주는가(그 행의 v 스윕 결과를 그대로 쓸 수 있다) */
export function branchEquivalent(game: Snapshot, natureA: string, natureB: string, relevant: readonly StatId[], v: StatId): boolean {
  if (natureA === natureB) return true
  return relevant.every((s) => {
    if (s === v || s === 'hp') return true
    const a = natureSignOf(game, natureA, s)
    return a !== null && a === natureSignOf(game, natureB, s)
  })
}

export interface BranchVariants {
  branch: Branch
  strict: { neutral: string; plus: string | null }
  sp?: SpOverride
}

/** 기준이 아닌 갈래마다 그 행의 엄격 변형과 SP 덮어쓰기(하락 자리가 없는 갈래는 뺀다) */
export function otherBranches(plan: TabPlan, branches: readonly Branch[], v: BoostableStat, relevant: readonly StatId[], dependsOn: readonly StatId[]): BranchVariants[] {
  if (plan.lock?.mode !== 'main') return []
  const { derivation, base } = plan.lock
  const locked = derivation.lockedStats
  const avoid = [...new Set<StatId>([...locked, ...relevant, v])]
  const out: BranchVariants[] = []
  for (const branch of branches) {
    if (branch.id === base.id) continue
    const rn = rowNature(plan.game, branch.nature, branch.plus, avoid)
    if (rn.dropWarning) continue
    const allowPlus = branch.plus === v || (branch.plus === 'out' && !locked.includes(v))
    const st = strictVariants(plan.game, rn.nature, v, allowPlus, avoid)
    const sp: Partial<Record<StatId, number>> = {}
    for (const s of dependsOn) if (locked.includes(s) && (branch.lockedSp[s] ?? 0) !== (base.lockedSp[s] ?? 0)) sp[s] = branch.lockedSp[s] ?? 0
    const item: BranchVariants = { branch, strict: { neutral: st.neutral, plus: st.plus } }
    if (Object.keys(sp).length > 0) item.sp = sp
    out.push(item)
  }
  return out
}
