// 계획 + 행 작업 결과 → 탭 뷰. 판정을 다시 하지 않고 표시용 SP로 산술·조회만 한다. 비용 O(행 × 33).
import { conditionMovePower, type SpTable } from '../core'
import type { Snapshot, StatId } from '../data/schema'
import { cardItems, compareItems, itemStates, type CardItemRef, type ItemState } from './items'
import { judgedMoveType } from './moveType'
import {
  cardDefault,
  cardExplore,
  cardPending,
  filterState,
  neededVariants,
  opponentKey,
  pairReady,
  primaryCardIds,
  probeKey,
  rowChanges,
  rowJudgements,
  shownItemKey,
  taskKey,
  type RowJudgements,
} from './schedule'
import { tierRank, type JudgementSide, type RollTier } from '../core'
import { cellLabel, pairTarget, singleTarget } from './target'
import { pairCurrentCategory, sumBandOf, type SumBandInput } from './sumBand'
import { variantNature } from './natures'
import { NATURE_VARIANTS } from './types'
import type {
  BoundaryView,
  CardSpec,
  CardView,
  CellView,
  CompactCell,
  DefaultItemView,
  ErrorReason,
  Headline,
  ItemView,
  NatureVariant,
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
  /** 표시 자격(판정 준비와 무관한 노출 조건: 행·안내가 있고 반감열매가 관여함) */
  visible: boolean
  /** 기본 항목이 정해졌고(래더는 그 항목의 1·2단계까지) 화면에 낼 수 있음. 사용자가 고른 항목이면 판정 전이어도 참 */
  ready: boolean
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

type RowHead = Pick<RowView, 'id' | 'kind' | 'order' | 'moveId' | 'moveType' | 'power' | 'sweepStat' | 'refs' | 'basis'>

function headOf(game: Snapshot, spec: RowSpec): RowHead {
  const head: RowHead = { id: spec.id, kind: spec.kind, order: spec.order }
  if (spec.moveId !== undefined) head.moveId = spec.moveId
  const moveType = spec.moveId === undefined ? undefined : judgedMoveType(game, spec.moveId, spec)
  if (moveType !== undefined) head.moveType = moveType
  const power = spec.moveId === undefined ? undefined : conditionMovePower(spec.moveId, spec.conditions)
  if (power !== undefined) head.power = power
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

/**
 * 쌍 결과가 아직 없는데 쌍 작업이 끝내 생기지 않는 이유(행·변형 스윕 오류). 기다리는 결과가 있거나 쌍 작업이 생길 수 있으면 undefined.
 */
function pairBlocked(ctx: Ctx, card: CardSpec, filterId: string): ErrorReason | undefined {
  const { plan, results } = ctx
  if (pairReady(plan, card, filterId, results)) return undefined
  let reason: ErrorReason | undefined
  for (const rowId of card.rowIds) {
    const spec = plan.rows[rowId]
    if (spec.gate !== filterId) continue
    if (spec.error !== undefined) {
      reason ??= spec.error
      continue
    }
    const ends = results.get(taskKey({ kind: 'ends', rowId }))
    if (ends === undefined) return undefined
    if (ends.kind === 'error') {
      reason ??= ends.reason
      continue
    }
    const swept = results.get(taskKey({ kind: 'sweep', rowId, stage: 2 }))
    if (swept === undefined) return undefined
    if (swept.kind === 'error') {
      reason ??= swept.reason
      continue
    }
    for (const nature of neededVariants(plan, spec)) {
      const v = results.get(taskKey({ kind: 'variant', rowId, nature }))
      if (v === undefined) return undefined
      if (v.kind === 'error') reason ??= v.reason
    }
  }
  return reason
}

/**
 * 통과한 극단 필터의 내구 합계 띠. 두 변형 쌍 결과가 다 나와야 띠가 있다(alt 범례에 다른 변형이 필요).
 * 쌍 결과 오류·쌍 작업이 끝내 생기지 않는 오류면 error. 현재 판정 = pairCurrentCategory(드래그로 두 행이 다 갱신 대기면 생략).
 * 띠 기준 변형 = 현재 성격과 같은 변형, 어느 쪽도 아니면 무보정 + fallback(이유: B/D 하락 성격 또는 그 밖).
 */
function pairBand(ctx: Ctx, card: CardSpec, filterId: string, rows: readonly RowView[]): NonNullable<CardView['pair']> {
  const spec = card.rowIds.map((id) => ctx.plan.rows[id]).find((r) => r.gate === filterId && r.natures !== undefined)
  const points: Partial<Record<NatureVariant, readonly PairPoint[]>> = {}
  let missing = false
  for (const nature of NATURE_VARIANTS) {
    const r = ctx.results.get(taskKey({ kind: 'pair', filterId, nature }))
    if (r?.kind === 'error') return { error: r.reason }
    if (r?.kind === 'pair') points[nature] = r.points
    else missing = true
  }
  if (missing || spec?.natures === undefined) {
    const error = pairBlocked(ctx, card, filterId)
    return error === undefined ? {} : { error }
  }
  const natures = spec.natures
  const mine = NATURE_VARIANTS.find((v) => variantNature(natures, v) === spec.defender.nature)
  const defenseStat = ctx.plan.filters[filterId].stats[1]
  const category = pairCurrentCategory(rows, defenseStat)
  const label = category === undefined ? undefined : cellLabel('defense', { category })
  const current: SumBandInput['current'] = { hp: ctx.displaySp.hp, defense: ctx.displaySp[defenseStat] }
  if (label !== undefined) current.label = label as RollTier
  const band = sumBandOf({ points: points as Record<NatureVariant, readonly PairPoint[]>, nature: mine ?? 'neutral', fallback: mine === undefined, defenseStat, current, max: ctx.plan.spMaxPerStat })
  if (mine === undefined) {
    const id = spec.defender.nature
    const all = ctx.plan.game.data.natures
    const entry = Object.prototype.hasOwnProperty.call(all, id) ? all[id] : undefined
    band.fallbackReason = entry !== undefined && entry.minus === defenseStat && entry.plus !== entry.minus ? 'minus' : 'other'
  }
  return { band }
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
  const row: RowView = { ...headOf(ctx.plan.game, spec), status: stale ? 'stale' : 'ok', noChange, cells: views, current, boundaries, nearest: nearestOf(boundaries) }
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
 * 첫 ok 행(동률 순서 tieKey) → 계산 불가 → 행 없음(no-change). 공격·방어 탭의 행은 보이는 항목 하나의 행이다.
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
    const tie = tieKey(row, slotOf)
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

/** 항목 상태 → 목록 항목(채용률 순, compareItems) */
function itemViews(plan: TabPlan, refs: readonly CardItemRef[], states: readonly ItemState[]): ItemView[] {
  const byKey = new Map(refs.map((r) => [r.key, r]))
  return [...states].sort(compareItems).map((st) => {
    const ref = byKey.get(st.key) as CardItemRef
    const v: ItemView = { key: st.key, moveId: st.moveId, share: st.share, order: st.moveOrder, priority: st.priority, status: st.probe.kind }
    const c = ref.candidate
    const spec = c.target === 'row' ? plan.rows[c.id] : c.target === 'filter' ? plan.filters[c.id] : plan.fixed[c.id]
    const moveType = spec === undefined ? undefined : judgedMoveType(plan.game, st.moveId, spec)
    if (moveType !== undefined) v.moveType = moveType
    const power = spec === undefined ? undefined : conditionMovePower(st.moveId, spec.conditions)
    if (power !== undefined) v.power = power
    if (ref.basis !== undefined) v.basis = ref.basis
    if (ref.candidate.added === true) v.added = true
    if (st.probe.kind === 'ok' || st.probe.kind === 'immune') v.cell = st.probe.cell
    if (st.probe.kind === 'error') v.error = st.probe.reason
    if (st.variability.kind === 'variable') v.variable = true
    else if (st.variability.kind === 'fixed') v.variable = false
    return v
  })
}

/**
 * 카드 하나를 조립한다. 공격·방어 탭은 보이는 항목(사용자가 고른 항목, 없으면 기본 항목) 하나의 행만 낸다.
 * 래더 카드는 기본 항목이 정해지고 그 1·2단계(양 끝·변화 스윕)가 끝난 뒤에만 낼 수 있다(기본 항목·분류 깜박임 방지).
 * 사용자가 고른 항목은 판정 전이어도 바로 낸다(행은 갱신 중).
 */
function buildCard(ctx: Ctx, card: CardSpec, pending: PendingTasks, selected: string | undefined): CardBuild {
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
    const view: CardView = { ...base, error: cardError(card), rows: [], headline, variable: false, items: [], selected: false }
    // 반감열매 변형의 해석 실패는 기본 카드가 같은 이유로 보이므로 따로 보이지 않는다.
    return { view, visible: card.berry === undefined, ready: true, mySetReasons: [] }
  }

  const rows: RowView[] = []
  const reasons: ErrorReason[] = []
  const fail = (reason: ErrorReason): ErrorReason => {
    if (reason.field?.startsWith(`${plan.mySide}.`)) reasons.push(reason)
    return reason
  }
  const filterHead = (gate: string, spec: RowSpec): RowHead => {
    const filter = plan.filters[gate]
    const head: RowHead = { id: JSON.stringify(['filter', gate]), kind: filter.basis ? 'rank' : 'base', order: spec.order, moveId: filter.moveId }
    if (filter.basis !== undefined) head.basis = filter.basis
    if (spec.refs !== undefined) head.refs = spec.refs
    const moveType = judgedMoveType(plan.game, filter.moveId, filter)
    if (moveType !== undefined) head.moveType = moveType
    const power = conditionMovePower(filter.moveId, filter.conditions)
    if (power !== undefined) head.power = power
    return head
  }
  const filterDone = new Set<string>()
  /** 스윕 행 하나(방어 탭 필터 행이면 필터 상태까지) */
  const pushRow = (rowId: string) => {
    const spec = plan.rows[rowId]
    if (spec.error !== undefined) {
      rows.push(bareRow(ctx, headOf(ctx.plan.game, spec), 'error', { error: spec.error }))
      return
    }
    if (spec.gate !== undefined) {
      const f = filterState(results, spec.gate)
      if (f.kind === 'pending') {
        rows.push(bareRow(ctx, headOf(ctx.plan.game, spec), 'pending'))
        return
      }
      if (f.kind !== 'passed') {
        if (filterDone.has(spec.gate)) return
        filterDone.add(spec.gate)
        const head = filterHead(spec.gate, spec)
        if (f.kind === 'error') rows.push(bareRow(ctx, head, 'error', { error: fail(f.result.reason) }))
        else rows.push(bareRow(ctx, head, 'ok', { category: f.result.low.category, noChange: true }))
        return
      }
    }
    const stat = spec.sweep?.stat
    if (stat === undefined) throw new Error(`행 ${rowId}에 스윕 대상이 없다`)
    const ends = results.get(taskKey({ kind: 'ends', rowId }))
    if (ends === undefined) {
      rows.push(bareRow(ctx, headOf(ctx.plan.game, spec), 'pending'))
      return
    }
    if (ends.kind === 'error') {
      rows.push(bareRow(ctx, headOf(ctx.plan.game, spec), 'error', { error: fail(ends.reason) }))
      return
    }
    if (ends.kind !== 'ends') throw new Error(`행 ${rowId}의 양 끝 결과 종류가 ${ends.kind}다`)
    const swept = results.get(taskKey({ kind: 'sweep', rowId, stage: 2 }))
    if (swept === undefined) {
      rows.push(bareRow(ctx, headOf(ctx.plan.game, spec), 'pending'))
      return
    }
    if (swept.kind === 'error') {
      rows.push(bareRow(ctx, headOf(ctx.plan.game, spec), 'error', { error: fail(swept.reason) }))
      return
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
    rows.push(row)
  }
  const pushFixed = (fixedId: string, order: number) => {
    const spec = plan.fixed[fixedId]
    const head: RowHead = { id: JSON.stringify(['fixed', fixedId]), kind: 'base', order, moveId: spec.moveId }
    const moveType = judgedMoveType(plan.game, spec.moveId, spec)
    if (moveType !== undefined) head.moveType = moveType
    const r = results.get(taskKey({ kind: 'fixed', fixedId }))
    if (r === undefined) rows.push(bareRow(ctx, head, 'pending'))
    else if (r.kind === 'error') rows.push(bareRow(ctx, head, 'error', { error: fail(r.reason) }))
    else if (r.kind !== 'fixed') throw new Error(`고정 판정 ${fixedId}의 결과 종류가 ${r.kind}다`)
    else rows.push(bareRow(ctx, head, 'ok', { category: r.cell.category, noChange: true, fixedCell: r.cell }))
  }
  const fixedOrder = card.rowIds.reduce((m, id) => Math.max(m, plan.rows[id].order + 1), 0)
  const settled = pending.stage1.length === 0 && pending.stage2.length === 0

  // 후보가 없는 카드(스피드 탭): 모든 행.
  if (card.conditions.length === 0) {
    for (const rowId of card.rowIds) pushRow(rowId)
    card.fixedIds.forEach((id, i) => pushFixed(id, fixedOrder + i))
    rows.sort((a, b) => a.order - b.order)
    const headline = headlineOf(card, rows, slotOrder(plan, card))
    const view: CardView = { ...base, rows, headline, variable: isVariable(rows), items: [], selected: false }
    return { view, visible: rows.length > 0 || card.notices.length > 0, ready: ladder ? settled : true, mySetReasons: reasons }
  }

  const refs = cardItems(plan, card)
  const states = itemStates(plan, card, refs, results)
  const def = cardDefault(plan, card, results, refs)
  const shown = shownItemKey(refs, def, selected)
  const isSelected = shown !== undefined && shown === selected
  const ref = refs.find((r) => r.key === shown)
  let pair: CardView['pair']
  if (ref !== undefined) {
    const c = ref.candidate
    const probeError = c.target !== 'fixed' ? results.get(probeKey(c)) : undefined
    if (probeError?.kind === 'error') {
      const spec = c.target === 'row' ? plan.rows[c.id] : plan.rows[card.rowIds.find((id) => plan.rows[id].gate === c.id) as string]
      const head = c.target === 'row' ? headOf(ctx.plan.game, spec) : filterHead(c.id, spec)
      rows.push(bareRow(ctx, head, 'error', { error: fail(probeError.reason) }))
    } else if (c.target === 'row') {
      pushRow(c.id)
    } else if (c.target === 'filter') {
      for (const rowId of card.rowIds) if (plan.rows[rowId].gate === c.id) pushRow(rowId)
      if (filterState(results, c.id).kind === 'passed') pair = pairBand(ctx, card, c.id, rows)
    } else {
      pushFixed(c.id, fixedOrder)
    }
  }
  rows.sort((a, b) => a.order - b.order)
  const headline: Headline = shown === undefined ? { kind: 'updating' } : headlineOf(card, rows, slotOrder(plan, card))
  const view: CardView = { ...base, rows, headline, variable: isVariable(rows), items: itemViews(plan, refs, states), selected: isSelected }
  if (shown !== undefined) view.shownItem = shown
  if (pair !== undefined) view.pair = pair
  if (def.kind === 'ready') {
    const d: DefaultItemView = { key: def.key, viaPriority: def.viaPriority }
    if (def.fallback) d.fallback = true
    const basis = states.find((st) => st.key === def.basis)
    if (basis?.probe.kind === 'ok') d.basisCell = basis.probe.cell
    view.defaultItem = d
  }
  // 반감열매 변형 카드는 보이는 항목의 기술이 그 열매를 발동시킬 때만 보인다.
  const engaged = card.berry === undefined || (ref !== undefined && card.berry.triggers.includes(ref.candidate.moveId))
  const visible = (rows.length > 0 || card.notices.length > 0) && engaged
  const ready = isSelected || (def.kind === 'ready' && (!ladder || settled))
  return { view, visible, ready, mySetReasons: reasons }
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
    for (const c of group.candidates) if (c.target !== 'fixed' && !(c.target === 'row' && plan.rows[c.id].error !== undefined)) done += has(probeKey(c))
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
  /** 기술 선택 메뉴를 열었을 때의 항목 변동 판정 작업(cardExplore, 처음 요청할 때 만든다) */
  explore?: PendingTasks
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
  /** 사용자 기술 선택(상대 키 opponentKey → 항목 키). 선택이 바뀐 상대의 카드만 다시 계산한다. 바뀐 카드가 있으면 true */
  setSelections(selections: ReadonlyMap<string, string>): boolean
  /** pendingTasks(plan, results)와 같은 값(카드 순 → 행 순). only가 있으면 그 카드들만 */
  pending(results: ResultMap, only?: (cardId: string) => boolean): PendingTasks
  /** 그 카드들의 모든 항목 변동 판정 작업(cardExplore, 카드 순 → 행 순) */
  explore(results: ResultMap, cardIds: ReadonlySet<string>): PendingTasks
  assemble(results: ResultMap, displaySp?: SpTable): TabView
}

const sameSp = (a: SpTable, b: SpTable): boolean => STAT_KEYS.every((k) => a[k] === b[k])

export function createTabAssembler(plan: TabPlan, initialSelections: ReadonlyMap<string, string> = new Map()): TabAssembler {
  const memo = new Map<string, CardMemo>()
  let builtSp: SpTable | null = null
  let selections = initialSelections
  const primary = primaryCardIds(plan)
  const selectedOf = (card: CardSpec) => selections.get(opponentKey(card.opponent))
  const entry = (card: CardSpec, results: ResultMap): CardMemo => {
    let m = memo.get(card.id)
    if (m === undefined) {
      m = { pending: cardPending(plan, card, results, selectedOf(card)), done: cardDone(plan, card, results) }
      memo.set(card.id, m)
    }
    return m
  }
  return {
    invalidate(cardId) {
      memo.delete(cardId)
    },
    setSelections(next) {
      let changed = false
      for (const card of plan.cards) {
        const k = opponentKey(card.opponent)
        if (selections.get(k) === next.get(k)) continue
        memo.delete(card.id)
        changed = true
      }
      selections = next
      return changed
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
    explore(results, cardIds) {
      const out = { stage1: [] as RowTask[], stage2: [] as RowTask[], stage3: [] as RowTask[], stage4: [] as RowTask[], stage5: [] as RowTask[] }
      for (const card of plan.cards) {
        if (!cardIds.has(card.id)) continue
        const m = entry(card, results)
        m.explore ??= cardExplore(plan, card, results)
        for (const k of STAGE_KEYS) for (const t of m.explore[k]) out[k].push(t)
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
        m.build ??= buildCard(ctx, card, m.pending, selectedOf(card))
        return m.build
      })
      // 같은 상대의 먼저 계산할 카드(분류마다 기본 배분·사용자 추가·커스텀, 반감열매 변형 제외)가 모두 준비되기 전에는 그 상대를 보이지 않는다:
      // 처음 보이는 분류(물리·특수)가 두 분류의 기본 항목을 견줘 정해지므로, 한쪽만 준비됐을 때 보이면 분류가 바뀌며 깜박인다.
      const waiting = new Set<string>()
      plan.cards.forEach((card, i) => {
        if (card.berry === undefined && primary.has(card.id) && builds[i].visible && !builds[i].ready) waiting.add(opponentKey(card.opponent))
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
      const shown = builds.filter((b, i) => b.visible && b.ready && (plan.cards[i].berry !== undefined || !waiting.has(opponentKey(plan.cards[i].opponent))))
      return { ...shell, status: plan.status, cards: shown.map((b) => b.view) }
    },
  }
}

/** displaySp 기본값은 계획 시점 SP. 카드 순서는 계획 순서 그대로다(한 번 조립: 캐시 없음). */
export function assembleTab(plan: TabPlan, results: ResultMap, displaySp: SpTable = plan.mySp, selections: ReadonlyMap<string, string> = new Map()): TabView {
  return createTabAssembler(plan, selections).assemble(results, displaySp)
}
