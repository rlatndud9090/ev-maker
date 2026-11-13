// 판정 행 기술 선택 항목: 항목 키·단건 판정 상태·변동 판정·정렬·기본 항목 결정. 판정은 하지 않는다(결과 조회만).
import { filterState, neededVariants, probeKey, rowChanges, rowJudgements, taskKey } from './schedule'
import type { CardSpec, CompactCell, ConditionGroup, ErrorReason, MoveCandidate, RankBasis, ResultMap, TabPlan } from './types'

/** 계획의 기본 조건 그룹 id(plan BASE_CONDITION과 같은 값) */
export const BASE_CONDITION_ID = JSON.stringify(['base'])

/** 항목(기술 × 랭크 조건)의 안정 키. 카드(배분·분류) id를 담지 않아 같은 상대의 모든 카드에서 같다 */
export const itemKey = (moveId: string, conditionId: string): string => JSON.stringify([moveId, conditionId])

export type ItemProbe =
  | { kind: 'pending' }
  | { kind: 'ok'; cell: CompactCell }
  | { kind: 'immune'; cell: CompactCell }
  | { kind: 'error'; reason: ErrorReason }

export type ItemVariability = { kind: 'pending' } | { kind: 'variable' } | { kind: 'fixed'; category: string } | { kind: 'error'; reason: ErrorReason }

/** 카드 안 항목 하나(후보 하나). moveOrder = 기본 조건 후보 순서(공격 탭 기술 슬롯, 방어 탭 상대 사용률), conditionOrder = 조건 그룹 순서 */
export interface CardItemRef {
  key: string
  conditionId: string
  candidate: MoveCandidate
  rankBefore: boolean
  basis?: RankBasis
  moveOrder: number
  conditionOrder: number
}

function basisOf(plan: TabPlan, c: MoveCandidate): RankBasis | undefined {
  if (c.target === 'filter') return plan.filters[c.id].basis
  if (c.target === 'row') {
    const b = plan.rows[c.id].basis
    return b?.kind === 'rank' ? b : undefined
  }
  return undefined
}

/** 카드의 항목(조건 순 → 후보 순). 같은 기술·같은 조건은 하나다 */
export function cardItems(plan: TabPlan, card: CardSpec): CardItemRef[] {
  const moveOrder = new Map<string, number>()
  const order = (moveId: string) => {
    if (!moveOrder.has(moveId)) moveOrder.set(moveId, moveOrder.size)
    return moveOrder.get(moveId) as number
  }
  const groups: readonly ConditionGroup[] = card.conditions
  for (const g of groups) for (const c of g.candidates) order(c.moveId)
  const out: CardItemRef[] = []
  groups.forEach((g, gi) => {
    for (const c of g.candidates) {
      const ref: CardItemRef = { key: itemKey(c.moveId, g.id), conditionId: g.id, candidate: c, rankBefore: g.id === BASE_CONDITION_ID, moveOrder: order(c.moveId), conditionOrder: gi }
      const basis = basisOf(plan, c)
      if (basis !== undefined) ref.basis = basis
      out.push(ref)
    }
  })
  return out
}

/** 후보의 현재 세트 단건 판정 상태(고정 판정은 그 결과, 계획 단계 계산 불가 행은 그 오류) */
export function itemProbe(plan: TabPlan, c: MoveCandidate, results: ResultMap): ItemProbe {
  if (c.target === 'row') {
    const error = plan.rows[c.id].error
    if (error !== undefined) return { kind: 'error', reason: error }
  }
  const r = results.get(probeKey(c))
  if (r === undefined) return { kind: 'pending' }
  if (r.kind === 'error') return { kind: 'error', reason: r.reason }
  const cell = r.kind === 'probe' || r.kind === 'fixed' ? r.cell : undefined
  if (cell === undefined) throw new Error(`후보 ${c.id}의 단건 판정 결과 종류가 ${r.kind}다`)
  return cell.immune === true ? { kind: 'immune', cell } : { kind: 'ok', cell }
}

/** 스윕 행 하나의 변동 판정: 변형 범위 양 끝이 다르면 바로 변동, 같으면 성격 변형 스윕까지 본다 */
export function rowVariability(plan: TabPlan, results: ResultMap, rowId: string): ItemVariability {
  const spec = plan.rows[rowId]
  if (spec.error !== undefined) return { kind: 'error', reason: spec.error }
  const ends = results.get(taskKey({ kind: 'ends', rowId }))
  if (ends === undefined) return { kind: 'pending' }
  if (ends.kind === 'error') return { kind: 'error', reason: ends.reason }
  if (ends.kind !== 'ends') throw new Error(`행 ${rowId}의 양 끝 결과 종류가 ${ends.kind}다`)
  if (ends.range.low.category !== ends.range.high.category) return { kind: 'variable' }
  const j = rowJudgements(plan, results, rowId)
  if (!j.variantsDone) return { kind: 'pending' }
  // 현재 성격과 같은 변형은 현재 스윕을 쓴다(그 스윕이 아직 없거나 오류면 판정 전·불가).
  if (spec.natures !== undefined && neededVariants(plan, spec).length < 2) {
    const swept = results.get(taskKey({ kind: 'sweep', rowId, stage: 2 }))
    if (swept === undefined) return { kind: 'pending' }
    if (swept.kind === 'error') return { kind: 'error', reason: swept.reason }
  }
  if (j.variantError) {
    for (const nature of neededVariants(plan, spec)) {
      const r = results.get(taskKey({ kind: 'variant', rowId, nature }))
      if (r?.kind === 'error') return { kind: 'error', reason: r.reason }
    }
  }
  return rowChanges(ends, j) ? { kind: 'variable' } : { kind: 'fixed', category: ends.range.low.category }
}

/**
 * 항목의 변동 판정. 방어 탭 필터 = 극단 필터를 통과하고 H 행 또는 B/D 행이 변동이면 변동, 걸리면 그 극단 판정으로 고정.
 * 내 SP와 무관한 고정 판정(공격 탭 속임수)은 늘 고정.
 */
export function itemVariability(plan: TabPlan, card: CardSpec, c: MoveCandidate, results: ResultMap): ItemVariability {
  if (c.target === 'row') return rowVariability(plan, results, c.id)
  if (c.target === 'fixed') {
    const r = results.get(taskKey({ kind: 'fixed', fixedId: c.id }))
    if (r === undefined) return { kind: 'pending' }
    if (r.kind === 'error') return { kind: 'error', reason: r.reason }
    if (r.kind !== 'fixed') throw new Error(`고정 판정 ${c.id}의 결과 종류가 ${r.kind}다`)
    return { kind: 'fixed', category: r.cell.category }
  }
  const f = filterState(results, c.id)
  if (f.kind === 'pending') return { kind: 'pending' }
  if (f.kind === 'error') return { kind: 'error', reason: f.result.reason }
  if (f.kind === 'blocked') return { kind: 'fixed', category: f.result.low.category }
  let pending = false
  let fixed: string | undefined
  for (const rowId of card.rowIds) {
    if (plan.rows[rowId].gate !== c.id) continue
    const v = rowVariability(plan, results, rowId)
    if (v.kind === 'variable') return v
    if (v.kind === 'error') return v
    if (v.kind === 'pending') pending = true
    else fixed ??= v.category
  }
  if (pending || fixed === undefined) return { kind: 'pending' }
  return { kind: 'fixed', category: fixed }
}

/** 기본 항목 결정·정렬에 쓰는 항목 상태(판정 결과를 이미 조회한 값). 테스트는 이 값을 직접 넣는다 */
export interface ItemState {
  key: string
  moveId: string
  rankBefore: boolean
  /** 우선도 > 0 기술 */
  priority: boolean
  probe: ItemProbe
  variability: ItemVariability
  moveOrder: number
  conditionOrder: number
}

const probeClass = (p: ItemProbe): number => (p.kind === 'ok' ? 0 : p.kind === 'pending' ? 1 : p.kind === 'error' ? 2 : 3)

/**
 * 목록 정렬(가장 세게 치는 순): 정상 → 판정 전 → 계산 불가 → 무효. 정상끼리 현재 SP 1타 확률 → 최대 대미지 비율이 큰 순,
 * 같으면 같은 기술의 랭크 전이 먼저 → 기술 순서 → 조건 순서.
 */
export function compareItems(a: Pick<ItemState, 'probe' | 'moveId' | 'rankBefore' | 'moveOrder' | 'conditionOrder'>, b: typeof a): number {
  const ca = probeClass(a.probe)
  const cb = probeClass(b.probe)
  if (ca !== cb) return ca - cb
  if (a.probe.kind === 'ok' && b.probe.kind === 'ok') {
    const pa = a.probe.cell.ohkoChance ?? 0
    const pb = b.probe.cell.ohkoChance ?? 0
    if (pa !== pb) return pb - pa
    const ma = a.probe.cell.maxPercent ?? 0
    const mb = b.probe.cell.maxPercent ?? 0
    if (ma !== mb) return mb - ma
  }
  if (a.moveId === b.moveId && a.rankBefore !== b.rankBefore) return a.rankBefore ? -1 : 1
  if (a.moveOrder !== b.moveOrder) return a.moveOrder - b.moveOrder
  return a.conditionOrder - b.conditionOrder
}

export type DefaultResult =
  /** need = 결정에 필요한데 아직 변동 판정이 나오지 않은 항목 키(단건 판정이 남았으면 비어 있다) */
  | { kind: 'pending'; need: readonly string[] }
  /** viaPriority = 방어 탭 선공기 우선으로 정해짐. basis = 기준 기술 랭크 전 항목(분류 사이 비교용) */
  | { kind: 'ready'; key: string; viaPriority: boolean; basis: string }

const GUARANTEED_OHKO = 'guaranteed-ohko'
const GUARANTEED_SURVIVE = 'guaranteed-survive'
const valid = (i: ItemState): boolean => i.probe.kind === 'ok'

type Step<T> = { kind: 'need'; keys: string[] } | { kind: 'done'; value: T }

/** 랭크 후 항목 Q: 변동인 것 중 가장 센 것, 없으면 가장 센 것(정상 항목만, 정렬된 입력). 변동 판정이 남았으면 need */
function chooseQ(qs: readonly ItemState[]): Step<ItemState | undefined> {
  const waiting = qs.filter((q) => q.variability.kind === 'pending').map((q) => q.key)
  if (waiting.length > 0) return { kind: 'need', keys: waiting }
  return { kind: 'done', value: qs.find((q) => q.variability.kind === 'variable') ?? qs[0] }
}

/** 기준 기술의 랭크 전 P·후 Q 비교(위에서부터 처음 맞는 줄) */
function pickPQ(sorted: readonly ItemState[], moveId: string): Step<ItemState> {
  const p = sorted.find((i) => i.moveId === moveId && i.rankBefore)
  const qs = sorted.filter((i) => i.moveId === moveId && !i.rankBefore)
  if (p === undefined) return { kind: 'done', value: qs[0] }
  if (qs.length === 0) return { kind: 'done', value: p }
  const validQs = qs.filter(valid)
  if (!valid(p)) {
    if (validQs.length === 0) return { kind: 'done', value: p }
    const q = chooseQ(validQs)
    return q.kind === 'need' ? q : { kind: 'done', value: q.value as ItemState }
  }
  const pv = p.variability
  if (pv.kind === 'pending') return { kind: 'need', keys: [p.key] }
  // 변동이면 Q와 무관하게 P. 확정1타 고정이면 랭크업 없이도 1타(랭크업은 판정 능력치를 올려 Q도 확정1타 고정이다).
  if (pv.kind !== 'fixed' || pv.category === GUARANTEED_OHKO) return { kind: 'done', value: p }
  if (validQs.length === 0) return { kind: 'done', value: p }
  const q = chooseQ(validQs)
  if (q.kind === 'need') return q
  const qv = (q.value as ItemState).variability
  if (qv.kind === 'variable') return { kind: 'done', value: q.value as ItemState }
  if (qv.kind === 'fixed' && qv.category === GUARANTEED_SURVIVE) return { kind: 'done', value: q.value as ItemState }
  return { kind: 'done', value: p }
}

/**
 * 기본 항목(사용자가 고르지 않았을 때 보이는 항목):
 * 1. 기준 기술 = 정렬상 가장 센 랭크 전 항목의 기술(정상 항목이 없으면 정렬 첫 항목이 기본)
 * 2. 방어 탭에서 내가 확실히 빠르면(speedEdge) 랭크 전·후 중 하나라도 변동인 상대 선공기 중 가장 센 것을 기준 기술로
 * 3. 기준 기술의 랭크 전 P·후 Q를 비교(pickPQ)
 */
export function resolveDefault(items: readonly ItemState[], opts: { priorityRule: boolean }): DefaultResult {
  if (items.length === 0) return { kind: 'pending', need: [] }
  if (items.some((i) => i.probe.kind === 'pending')) return { kind: 'pending', need: [] }
  const sorted = [...items].sort(compareItems)
  const pre = sorted.filter((i) => i.rankBefore && valid(i))
  if (pre.length === 0) return { kind: 'ready', key: sorted[0].key, viaPriority: false, basis: sorted[0].key }
  if (opts.priorityRule) {
    for (const p of pre) {
      if (!p.priority) continue
      const group = sorted.filter((i) => i.moveId === p.moveId && valid(i))
      if (group.some((i) => i.variability.kind === 'variable')) {
        const r = pickPQ(sorted, p.moveId)
        return r.kind === 'need' ? { kind: 'pending', need: r.keys } : { kind: 'ready', key: r.value.key, viaPriority: true, basis: p.key }
      }
      const waiting = group.filter((i) => i.variability.kind === 'pending').map((i) => i.key)
      if (waiting.length > 0) return { kind: 'pending', need: waiting }
    }
  }
  const basis = pre[0]
  const r = pickPQ(sorted, basis.moveId)
  return r.kind === 'need' ? { kind: 'pending', need: r.keys } : { kind: 'ready', key: r.value.key, viaPriority: false, basis: basis.key }
}

/** 카드 항목의 상태를 결과에서 조회한다 */
export function itemStates(plan: TabPlan, card: CardSpec, refs: readonly CardItemRef[], results: ResultMap): ItemState[] {
  return refs.map((r) => ({
    key: r.key,
    moveId: r.candidate.moveId,
    rankBefore: r.rankBefore,
    priority: r.candidate.priority,
    probe: itemProbe(plan, r.candidate, results),
    variability: itemVariability(plan, card, r.candidate, results),
    moveOrder: r.moveOrder,
    conditionOrder: r.conditionOrder,
  }))
}
