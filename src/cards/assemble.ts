// 계획 + 행 작업 결과 → 탭 뷰. 판정을 다시 하지 않고 표시용 SP로 산술·조회만 한다. 비용 O(행 × 33).
import type { SpTable } from '../core'
import type { StatId } from '../data/schema'
import {
  candidateStates,
  cardPending,
  filterState,
  neededVariants,
  probeKey,
  rowChanges,
  rowJudgements,
  taskKey,
  type CandidateState,
  type RowJudgements,
} from './schedule'
import { tierRank, type JudgementSide } from '../core'
import { cellLabel, pairTarget, singleTarget } from './target'
import { NATURE_VARIANTS } from './types'
import type {
  BoundaryView,
  CardSpec,
  CardView,
  CellView,
  CompactCell,
  ErrorReason,
  Headline,
  PairPoint,
  PendingTasks,
  ResultMap,
  RowKind,
  RowSpec,
  RowTask,
  RowTaskResult,
  RowView,
  TabPlan,
  TabStatus,
  TabView,
  TargetView,
} from './types'

/** 계획의 기본 조건 그룹 id(plan BASE_CONDITION과 같은 값) */
const BASE_CONDITION_ID = JSON.stringify(['base'])
const KIND_RANK: Readonly<Record<RowKind, number>> = { base: 0, rank: 1, scarf: 2, 'non-scarf': 2 }
const STAT_KEYS: readonly StatId[] = ['hp', 'atk', 'def', 'spa', 'spd', 'spe']
const STAGE_KEYS = ['stage1', 'stage2', 'stage3', 'stage4', 'stage5'] as const

interface Ctx {
  plan: TabPlan
  results: ResultMap
  displaySp: SpTable
  spSum: number
}

interface CardBuild {
  view: CardView
  displayed: boolean
  mySetReasons: ErrorReason[]
}

function cellViews(ctx: Ctx, cells: readonly CompactCell[], stat: StatId): CellView[] {
  const available = ctx.plan.spTotal - (ctx.spSum - ctx.displaySp[stat])
  return cells.map((c) => {
    const need = Math.max(0, c.sp - available)
    return { ...c, overBudget: need > 0, need }
  })
}

function boundariesOf(cells: readonly CellView[], current: number): BoundaryView[] {
  const out: BoundaryView[] = []
  for (let i = 1; i < cells.length; i++) {
    const prev = cells[i - 1]
    const cur = cells[i]
    if (prev.category !== cur.category) {
      out.push({ sp: cur.sp, from: prev.category, to: cur.category, delta: cur.sp - current, need: cur.need })
    }
  }
  return out
}

function nearestOf(boundaries: readonly BoundaryView[]): RowView['nearest'] {
  const nearest: { up?: BoundaryView; down?: BoundaryView } = {}
  for (const b of boundaries) {
    if (b.delta > 0 && (nearest.up === undefined || b.delta < nearest.up.delta)) nearest.up = b
    if (b.delta <= 0 && (nearest.down === undefined || b.delta > nearest.down.delta)) nearest.down = b
  }
  return nearest
}

type RowHead = Pick<RowView, 'id' | 'kind' | 'order' | 'moveId' | 'sweepStat' | 'refs' | 'basis'>

function headOf(spec: RowSpec): RowHead {
  const head: RowHead = { id: spec.id, kind: spec.kind, order: spec.order }
  if (spec.moveId !== undefined) head.moveId = spec.moveId
  if (spec.sweep !== undefined) head.sweepStat = spec.sweep.stat
  if (spec.refs !== undefined) head.refs = spec.refs
  if (spec.basis !== undefined) head.basis = spec.basis
  return head
}

/** 칸이 없는 행(판정 전·오류·고정 범주). */
function bareRow(ctx: Ctx, head: RowHead, status: RowView['status'], extra: { error?: ErrorReason; category?: string; noChange?: boolean; fixedCell?: CompactCell } = {}): RowView {
  const current: RowView['current'] = { sp: head.sweepStat === undefined ? 0 : ctx.displaySp[head.sweepStat] }
  if (extra.category !== undefined) current.category = extra.category
  const row: RowView = { ...head, status, noChange: extra.noChange ?? false, cells: [], current, boundaries: [], nearest: {} }
  if (extra.error !== undefined) row.error = extra.error
  if (extra.fixedCell !== undefined) row.fixedCell = extra.fixedCell
  return row
}

const sideOf = (ctx: Ctx, spec: RowSpec): JudgementSide => (spec.judge === 'speed' ? 'speed' : ctx.plan.mySide === 'attacker' ? 'attack' : 'defense')

/**
 * 방어 탭(필터가 있는 행)은 성격 변형별 쌍 결과, 그 밖은 그 행의 성격 변형별 33칸에서 목표를 낸다.
 * 필요한 변형 결과(방어 탭은 두 쌍 결과)가 다 나오기 전이나 그중 오류가 있으면 목표 없음(오류를 "불가"로 보이지 않는다).
 */
function targetOf(ctx: Ctx, spec: RowSpec, stat: StatId, j: RowJudgements, at: CellView | undefined): TargetView | undefined {
  const { plan } = ctx
  const side = sideOf(ctx, spec)
  const label = at === undefined ? undefined : cellLabel(side, at)
  if (label === undefined || spec.natures === undefined || !j.variantsDone || j.variantError) return undefined
  const plusStat = spec.natures.stat
  if (spec.gate === undefined) {
    const views = (cells: readonly CompactCell[] | undefined) => (cells === undefined ? undefined : cellViews(ctx, cells, stat))
    return singleTarget(side, stat, plusStat, label, { neutral: views(j.neutral), plus: views(j.plus) })
  }
  const points: { neutral?: PairPoint[]; plus?: PairPoint[] } = {}
  for (const nature of NATURE_VARIANTS) {
    const r = ctx.results.get(taskKey({ kind: 'pair', filterId: spec.gate, nature }))
    if (r === undefined || r.kind !== 'pair') return undefined
    points[nature] = [...r.points]
  }
  const current = { hp: ctx.displaySp.hp, defense: ctx.displaySp[plusStat] }
  return pairTarget(points, label, plusStat, current, plan.spTotal - ctx.spSum)
}

/** 칸들 중 그 관점 가장 유리한 판정(관점 순서 밖 범주는 건너뛴다). 없으면 undefined */
function bestOf(side: JudgementSide, cells: readonly Pick<CompactCell, 'category'>[]): string | undefined {
  let best: string | undefined
  for (const c of cells) {
    const label = cellLabel(side, c)
    if (label !== undefined && (best === undefined || tierRank(side, label) > tierRank(side, best))) best = label
  }
  return best
}

/**
 * 변화 있는 행의 도달 가능한 최선 판정(RowView.best). 방어 쌍 행 = 극단 필터 높은 극단(쌍 최소 조합의 상한과 같다),
 * 그 밖 = 변형 범위 끝·현재 성격 양 끝·현재·변형 스윕 칸 중 최선(변형 스윕이 남았으면 아직 없음, 변형 오류면 나온 칸으로).
 */
function bestReachable(ctx: Ctx, spec: RowSpec, ends: Extract<RowTaskResult, { kind: 'ends' }>, j: RowJudgements): string | undefined {
  const side = sideOf(ctx, spec)
  if (spec.gate !== undefined) {
    const f = filterState(ctx.results, spec.gate)
    return f.kind === 'passed' ? bestOf(side, [f.result.high, f.result.low]) : undefined
  }
  if (!j.variantsDone && !j.variantError) return undefined
  return bestOf(side, [ends.range.high, ends.range.low, ends.high, ends.low, ...(j.current ?? []), ...(j.neutral ?? []), ...(j.plus ?? [])])
}

function sweptRow(ctx: Ctx, spec: RowSpec, stat: StatId, j: RowJudgements, noChange: boolean): RowView {
  const cells = j.current
  if (cells === undefined) throw new Error(`행 ${spec.id}의 현재 성격 스윕이 없다`)
  const views = cellViews(ctx, cells, stat)
  const sp = ctx.displaySp[stat]
  const boundaries = boundariesOf(views, sp)
  const stale = spec.dependsOn.some((s) => ctx.displaySp[s] !== ctx.plan.mySp[s])
  const current: RowView['current'] = { sp }
  const at = views.find((c) => c.sp === sp)
  if (at !== undefined) current.category = at.category
  const row: RowView = { ...headOf(spec), status: stale ? 'stale' : 'ok', noChange, cells: views, current, boundaries, nearest: nearestOf(boundaries) }
  const target = noChange ? undefined : targetOf(ctx, spec, stat, j, at)
  if (target !== undefined) row.target = target
  return row
}

const SWEEP_STAT_RANK: Readonly<Partial<Record<StatId, number>>> = { hp: 0 }

/** 동률 순서: kind → 기술 슬롯(카드 행에서 그 기술이 처음 나온 순서) → H 행 먼저 → 카드 안 순번. */
function tieKey(row: RowView, slotOf: ReadonlyMap<string, number>): readonly number[] {
  const slot = row.moveId === undefined ? 0 : (slotOf.get(row.moveId) ?? 0)
  const stat = row.sweepStat === undefined ? 0 : (SWEEP_STAT_RANK[row.sweepStat] ?? 1)
  return [KIND_RANK[row.kind], slot, stat, row.order]
}

function lexLess(a: readonly number[], b: readonly number[]): boolean {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i]
  return false
}

/**
 * 대표 행: 변화 있는 행 중 경계까지 SP 차이가 가장 작은 행 → (판정 전·갱신 대기·잠정 변화 없음 행이 있으면 updating) →
 * 기본 조건의 가장 센 기술 행(선공기 행 아님, 동률 순서 tieKey) → 계산 불가 → 행 없음(no-change).
 */
function headlineOf(card: CardSpec, rows: readonly RowView[], slotOf: ReadonlyMap<string, number> = new Map()): Headline {
  if (card.state === 'error') return { kind: 'error', reason: cardError(card) }
  let best: { row: RowView; score: number; tie: readonly number[] } | undefined
  for (const row of rows) {
    if (row.status !== 'ok' || row.noChange || row.cells.length === 0) continue
    // 현재 성격 칸에 경계가 없는 행(성격 변형으로만 판정이 바뀜)은 경계 있는 행 뒤에 둔다.
    const score = row.boundaries.length === 0 ? Infinity : Math.min(...row.boundaries.map((b) => Math.abs(b.delta)))
    const tie = tieKey(row, slotOf)
    if (best === undefined || score < best.score || (score === best.score && lexLess(tie, best.tie))) best = { row, score, tie }
  }
  if (best !== undefined) return { kind: 'row', rowId: best.row.id }
  // 잠정 변화 없음 행(변형 스윕 대기)은 나중에 변동 가능으로 바뀔 수 있어 대표로 세우지 않는다.
  if (rows.some((r) => r.status === 'stale' || r.status === 'pending' || r.provisional)) return { kind: 'updating' }
  let fallback: { row: RowView; tie: readonly number[] } | undefined
  for (const row of rows) {
    if (row.status !== 'ok') continue
    // 선공기 행은 다른 ok 행이 없을 때만(그때도 동률 순서로).
    const tie = [row.keptAsPriority ? 1 : 0, ...tieKey(row, slotOf)]
    if (fallback === undefined || lexLess(tie, fallback.tie)) fallback = { row, tie }
  }
  if (fallback !== undefined) return { kind: 'row', rowId: fallback.row.id }
  const errored = rows.find((r) => r.status === 'error')
  if (errored?.error !== undefined) return { kind: 'error', reason: errored.error }
  const fixed: string[] = []
  for (const r of rows) {
    if (r.current.category !== undefined && !fixed.includes(r.current.category)) fixed.push(r.current.category)
  }
  return { kind: 'no-change', fixed }
}

/**
 * "변동 가능" 카드: 칸이 있는 ok·stale 행 중 변화 있는 행이 있음. 대표 행과 따로 센다 — noChange는 SP 0~최대 전체 기준이라
 * 표시 SP와 무관하므로 드래그 중(stale, 대표가 updating)에도 태그가 사라졌다 돌아오지 않는다.
 */
function isVariable(rows: readonly RowView[]): boolean {
  return rows.some((r) => (r.status === 'ok' || r.status === 'stale') && !r.noChange && r.cells.length > 0)
}

function cardError(card: CardSpec): ErrorReason {
  if (card.error === undefined) throw new Error(`error 카드 ${card.id}에 이유가 없다`)
  return card.error
}

/**
 * 카드 하나를 조립한다. 래더·커스텀 모두 변화 없음 행·판정 전 행을 rows에 남긴다(판정 변화와 무관하게 상대를 보인다).
 * 래더 카드는 1·2단계(가장 센 기술 고르기·양 끝·변화 스윕)가 끝난 뒤에만 표시한다(분류 사이 가장 센 기술이 정해지기 전 깜박임 방지).
 */
function buildCard(ctx: Ctx, card: CardSpec, pending: PendingTasks): CardBuild {
  const { plan, results } = ctx
  const ladder = card.opponent.source === 'ladder'
  const base: Pick<CardView, 'id' | 'order' | 'state' | 'notices' | 'opponent' | 'category' | 'bundle' | 'berry'> = {
    id: card.id,
    order: card.order,
    state: card.state,
    notices: card.notices,
    opponent: card.opponent,
    category: card.category,
    bundle: card.bundle,
  }
  if (card.berry !== undefined) base.berry = { item: card.berry.item, share: card.berry.share }
  if (card.state === 'error') {
    const headline = headlineOf(card, [])
    const view: CardView = { ...base, error: cardError(card), rows: [], headline, variable: false, moreRows: 0 }
    // 반감열매 변형의 해석 실패는 기본 카드가 같은 이유로 보이므로 따로 보이지 않는다.
    return { view, displayed: card.berry === undefined, mySetReasons: [] }
  }

  const rows: RowView[] = []
  const reasons: ErrorReason[] = []
  const fail = (reason: ErrorReason): ErrorReason => {
    if (reason.field?.startsWith(`${plan.mySide}.`)) reasons.push(reason)
    return reason
  }

  const states = candidateStates(card, results)
  const probeErrors = new Map<string, ErrorReason>()
  for (const group of card.conditions) {
    for (const c of group.candidates) {
      const r = results.get(probeKey(c))
      if (c.target !== 'fixed' && r?.kind === 'error') probeErrors.set(c.id, r.reason)
    }
  }
  const filterDone = new Set<string>()
  const filterHead = (gate: string, spec: RowSpec): RowHead => {
    const filter = plan.filters[gate]
    const head: RowHead = { id: JSON.stringify(['filter', gate]), kind: filter.basis ? 'rank' : 'base', order: spec.order, moveId: filter.moveId }
    if (filter.basis !== undefined) head.basis = filter.basis
    if (spec.refs !== undefined) head.refs = spec.refs
    return head
  }
  for (const rowId of card.rowIds) {
    const spec = plan.rows[rowId]
    if (spec.error !== undefined) {
      rows.push(bareRow(ctx, headOf(spec), 'error', { error: spec.error }))
      continue
    }
    const candidate = spec.gate ?? rowId
    const state: CandidateState | undefined = states.get(candidate)
    if (state === 'dropped') continue
    if (berryIdle(card, spec.moveId, state)) continue
    if (state === 'probing') {
      rows.push(bareRow(ctx, headOf(spec), 'pending'))
      continue
    }
    if (state === 'error') {
      const reason = probeErrors.get(candidate) as ErrorReason
      if (spec.gate === undefined) rows.push(bareRow(ctx, headOf(spec), 'error', { error: fail(reason) }))
      else if (!filterDone.has(spec.gate)) {
        filterDone.add(spec.gate)
        rows.push(bareRow(ctx, filterHead(spec.gate, spec), 'error', { error: fail(reason) }))
      }
      continue
    }
    if (spec.gate !== undefined) {
      const f = filterState(results, spec.gate)
      if (f.kind === 'pending') {
        rows.push(bareRow(ctx, headOf(spec), 'pending'))
        continue
      }
      if (f.kind !== 'passed') {
        if (filterDone.has(spec.gate)) continue
        filterDone.add(spec.gate)
        const head = filterHead(spec.gate, spec)
        if (f.kind === 'error') rows.push(bareRow(ctx, head, 'error', { error: fail(f.result.reason) }))
        else {
          const blocked = bareRow(ctx, head, 'ok', { category: f.result.low.category, noChange: true })
          // 가장 센 기술이 아니지만 선공기라 남은 극단 필터 행도 선공기 표지를 단다(스윕 행과 같은 규칙).
          if (state === 'priority') blocked.keptAsPriority = true
          rows.push(blocked)
        }
        continue
      }
    }
    const stat = spec.sweep?.stat
    if (stat === undefined) throw new Error(`행 ${rowId}에 스윕 대상이 없다`)
    const ends = results.get(taskKey({ kind: 'ends', rowId }))
    if (ends === undefined) {
      rows.push(bareRow(ctx, headOf(spec), 'pending'))
      continue
    }
    if (ends.kind === 'error') {
      rows.push(bareRow(ctx, headOf(spec), 'error', { error: fail(ends.reason) }))
      continue
    }
    if (ends.kind !== 'ends') throw new Error(`행 ${rowId}의 양 끝 결과 종류가 ${ends.kind}다`)
    const swept = results.get(taskKey({ kind: 'sweep', rowId, stage: 2 }))
    if (swept === undefined) {
      rows.push(bareRow(ctx, headOf(spec), 'pending'))
      continue
    }
    if (swept.kind === 'error') {
      rows.push(bareRow(ctx, headOf(spec), 'error', { error: fail(swept.reason) }))
      continue
    }
    if (swept.kind !== 'sweep') throw new Error(`행 ${rowId}의 스윕 결과 종류가 ${swept.kind}다`)
    if (swept.cells.length === 0) throw new Error(`행 ${rowId}의 스윕 칸이 비어 있다`)
    const j = rowJudgements(plan, results, rowId)
    // 변형 스윕이 남았으면 지금까지의 칸으로 잠정 판정하고 provisional 표지를 단다(나중에 "변동 가능"으로 바뀔 수 있다).
    const same = !rowChanges(ends, j)
    const row = sweptRow(ctx, spec, stat, j, same)
    if (same && !j.variantsDone) row.provisional = true
    if (!same) {
      const best = bestReachable(ctx, spec, ends, j)
      if (best !== undefined) row.best = best
    }
    if (state === 'priority') row.keptAsPriority = true
    rows.push(row)
  }

  const fixedOrder = card.rowIds.reduce((m, id) => Math.max(m, plan.rows[id].order + 1), 0)
  card.fixedIds.forEach((fixedId, i) => {
    const spec = plan.fixed[fixedId]
    const head: RowHead = { id: JSON.stringify(['fixed', fixedId]), kind: 'base', order: fixedOrder + i, moveId: spec.moveId }
    const r = results.get(taskKey({ kind: 'fixed', fixedId }))
    const state = states.get(fixedId)
    if (state === 'dropped') return
    if (berryIdle(card, spec.moveId, state)) return
    if (r === undefined || state === 'probing') {
      rows.push(bareRow(ctx, head, 'pending'))
    } else if (r.kind === 'error') {
      rows.push(bareRow(ctx, head, 'error', { error: fail(r.reason) }))
    } else if (r.kind !== 'fixed') {
      throw new Error(`고정 판정 ${fixedId}의 결과 종류가 ${r.kind}다`)
    } else {
      const row = bareRow(ctx, head, 'ok', { category: r.cell.category, noChange: true, fixedCell: r.cell })
      if (state === 'priority') row.keptAsPriority = true
      rows.push(row)
    }
  })

  rows.sort((a, b) => a.order - b.order)
  const settled = pending.stage1.length === 0 && pending.stage2.length === 0
  const headline = headlineOf(card, rows, slotOrder(plan, card))
  const view: CardView = { ...base, rows, headline, variable: isVariable(rows), moreRows: Math.max(0, rows.length - 1) }
  // 안내(notices)가 있는 카드는 행이 없어도 표시한다: 카드 머리가 안내의 유일한 화면 경로다(AC 11a).
  // 다른 분류 기술이 가장 세 행이 하나도 남지 않은 카드는 뺀다(그 상대의 다른 분류 카드가 보인다).
  const visible = (rows.length > 0 || card.notices.length > 0) && (card.berry === undefined || berryEngaged(card, states))
  return { view, displayed: ladder ? settled && visible : visible, mySetReasons: reasons }
}

/**
 * 반감열매 변형 카드가 보일 자격: 기본 조건에서 고른 가장 센 기술(다른 분류 비교 후보 포함)이 그 열매가 발동하는 기술(triggers)이다.
 * 아직 고르지 못했거나(판정 중·계산 불가) 열매가 발동하지 않는 기술이 가장 세면 열매는 판정에 관여하지 않아 보이지 않는다.
 */
export function berryEngaged(card: CardSpec, states: ReadonlyMap<string, CandidateState>): boolean {
  if (card.berry === undefined) return true
  const base = card.conditions.find((g) => g.id === BASE_CONDITION_ID)
  const chosen = base?.candidates.find((c) => states.get(c.id) === 'chosen')
  return chosen !== undefined && card.berry.triggers.includes(chosen.moveId)
}

/**
 * 반감열매 변형 카드 안에서 열매가 관여하지 않는 행: 조건별로 고른 가장 센 기술(또는 함께 남긴 선공기)이 그 열매가 발동하지 않는 기술이면
 * 그 행은 기본 카드의 같은 조건 행과 판정이 같으므로 열매 카드에서 뺀다(랭크 조건 행 포함). 아직 고르지 못한 후보(판정 중)는 남긴다.
 */
export function berryIdle(card: CardSpec, moveId: string | undefined, state: CandidateState | undefined): boolean {
  if (card.berry === undefined || moveId === undefined) return false
  return (state === 'chosen' || state === 'priority') && !card.berry.triggers.includes(moveId)
}

/** 계획은 기본 행을 슬롯 순(공격 탭 내 기술 슬롯, 방어 탭 상대 기술 사용률 순)으로 먼저 쌓는다. */
function slotOrder(plan: TabPlan, card: CardSpec): Map<string, number> {
  const out = new Map<string, number>()
  for (const id of card.rowIds) {
    const moveId = plan.rows[id].moveId
    if (moveId !== undefined && !out.has(moveId)) out.set(moveId, out.size)
  }
  return out
}

/** 한 카드의 끝난 작업 수(진행률 분자). */
function cardDone(plan: TabPlan, card: CardSpec, results: ResultMap): number {
  if (card.state === 'error') return 0
  let done = 0
  const has = (key: string) => (results.has(key) ? 1 : 0)
  for (const group of card.conditions) {
    for (const c of group.candidates) if (c.target !== 'fixed') done += has(probeKey(c))
  }
  for (const filterId of card.filterIds) {
    done += has(taskKey({ kind: 'extreme', filterId }))
    for (const nature of NATURE_VARIANTS) done += has(taskKey({ kind: 'pair', filterId, nature }))
  }
  for (const rowId of card.rowIds) {
    done += has(taskKey({ kind: 'ends', rowId })) + has(taskKey({ kind: 'sweep', rowId, stage: 2 }))
    for (const nature of neededVariants(plan, plan.rows[rowId])) done += has(taskKey({ kind: 'variant', rowId, nature }))
  }
  for (const fixedId of card.fixedIds) done += has(taskKey({ kind: 'fixed', fixedId }))
  return done
}

/** 카드별 조립 캐시 항목. 카드 결과가 바뀌면(invalidate) 통째로 버린다. */
interface CardMemo {
  pending: PendingTasks
  done: number
  /** 그 표시용 SP로 조립한 카드(SP가 바뀌면 다시) */
  build?: CardBuild
}

/**
 * 한 탭 계획의 증분 조립기. 카드 판정은 그 카드 작업 결과에만 기대므로, 결과가 바뀐 카드(invalidate)만 다시 계산하고
 * 나머지 카드의 남은 작업·진행 수·조립 결과는 재사용한다. 결과 맵을 바꾸는 쪽이 그 작업의 카드를 invalidate해야 한다.
 */
export interface TabAssembler {
  invalidate(cardId: string): void
  /** pendingTasks(plan, results)와 같은 값(카드 순 → 행 순). only가 있으면 그 카드들만 */
  pending(results: ResultMap, only?: (cardId: string) => boolean): PendingTasks
  assemble(results: ResultMap, displaySp?: SpTable): TabView
}

const sameSp = (a: SpTable, b: SpTable): boolean => STAT_KEYS.every((k) => a[k] === b[k])

export function createTabAssembler(plan: TabPlan): TabAssembler {
  const memo = new Map<string, CardMemo>()
  let builtSp: SpTable | null = null
  const entry = (card: CardSpec, results: ResultMap): CardMemo => {
    let m = memo.get(card.id)
    if (m === undefined) {
      m = { pending: cardPending(plan, card, results), done: cardDone(plan, card, results) }
      memo.set(card.id, m)
    }
    return m
  }
  return {
    invalidate(cardId) {
      memo.delete(cardId)
    },
    pending(results, only) {
      const out = { stage1: [] as RowTask[], stage2: [] as RowTask[], stage3: [] as RowTask[], stage4: [] as RowTask[], stage5: [] as RowTask[] }
      for (const card of plan.cards) {
        if (only !== undefined && !only(card.id)) continue
        const p = entry(card, results).pending
        for (const k of STAGE_KEYS) for (const t of p[k]) out[k].push(t)
      }
      return out
    },
    assemble(results, displaySp = plan.mySp) {
      if (builtSp === null || !sameSp(builtSp, displaySp)) {
        for (const m of memo.values()) delete m.build
        builtSp = { ...displaySp }
      }
      const entries = plan.cards.map((card) => entry(card, results))
      let done = 0
      const left = { stage1: 0, stage2: 0, stage3: 0, stage4: 0, stage5: 0 }
      for (const m of entries) {
        done += m.done
        for (const k of STAGE_KEYS) left[k] += m.pending[k].length
      }
      const total = done + left.stage1 + left.stage2 + left.stage3 + left.stage4 + left.stage5
      const stage12Done = left.stage1 === 0 && left.stage2 === 0
      const shell = {
        tab: plan.tab,
        rollSteps: plan.rollSteps,
        source: plan.source,
        progress: { done, total },
        stage12Done,
        complete: stage12Done && left.stage3 === 0 && left.stage4 === 0 && left.stage5 === 0,
        customTargetConflicts: plan.customTargetConflicts,
        notices: plan.notices,
      }
      if (plan.status.kind !== 'ok') return { ...shell, status: plan.status, cards: [] }

      const ctx: Ctx = { plan, results, displaySp, spSum: STAT_KEYS.reduce((sum, k) => sum + displaySp[k], 0) }
      const builds = plan.cards.map((card, i) => {
        const m = entries[i]
        m.build ??= buildCard(ctx, card, m.pending)
        return m.build
      })
      const reasons: ErrorReason[] = []
      const seen = new Set<string>()
      for (const r of builds.flatMap((b) => b.mySetReasons)) {
        const k = JSON.stringify([r.code, r.field ?? null, r.message])
        if (!seen.has(k)) {
          seen.add(k)
          reasons.push(r)
        }
      }
      if (reasons.length > 0) {
        const status: TabStatus = { kind: 'my-set-error', reasons }
        return { ...shell, status, cards: [] }
      }
      return { ...shell, status: plan.status, cards: builds.filter((b) => b.displayed).map((b) => b.view) }
    },
  }
}

/** displaySp 기본값은 계획 시점 SP. 카드 순서는 계획 순서 그대로다(한 번 조립: 캐시 없음). */
export function assembleTab(plan: TabPlan, results: ResultMap, displaySp: SpTable = plan.mySp): TabView {
  return createTabAssembler(plan).assemble(results, displaySp)
}
